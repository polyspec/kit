#!/usr/bin/env node
// The check that no implementation diverges from the contract through an escape hatch (`make divergence-check`, K315, P32).
// Every implementation of a repository holds every unit (S6); these are the ways to let one of them differ without a unit saying
// so, and each is a finding that names the file and the line:
//   1. a test of an implementation branches on the implementation, the language, the runtime or the platform to change what it
//      asserts (extension_loaded, function_exists, PHP_VERSION, PHP_OS, sys.version_info, sys.platform, process.versions,
//      process.platform, runtime.GOOS, runtime.GOARCH, cfg!, #[cfg(...)], os.name); a statement that only asserts its environment,
//      with no branch, declares it and is none (K543);
//   2. the code of an implementation branches on the presence of another implementation (extension_loaded and function_exists: the
//      PHP library reading whether its extension is loaded, or defining a function only when the extension does not), also in
//      the sources that a build generates before the gate and Git ignores (K329);
//   3. a run of an implementation is narrowed by a flag (--exclude-group);
//   4. contracts/features.json declares an implementation partial or unsupported;
//   5. a configuration exception carries a reason that names no kind that kit defines (REASON_KINDS), in config/duplication.json,
//      and in the tools and internal tests of config/parity.json.
// The skipped and narrowed tests are the markers of test-markers-check; the vendored tools and tests of kit are left out.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { isTestFile } from './check-commits.mts';
import { implementationFolders } from './parity-declaration.mts';
import { isMain, repositoryRoot } from './paths.mts';
import { isJsonObject } from './bootstrap/files.mts';
import { trackedFiles } from './tracked-files.mts';

/** The kinds of reason that kit defines for an exception of a configuration: the reason begins with the kind and a colon. */
export const REASON_KINDS = ['generated', 'fixture', 'test', 'harness', 'ecosystem', 'external'] as const;

const SOURCE = /\.(?:php|py|[cm]?[jt]sx?|go|rs)$/;
// The environment that a test branches on: a call or a name, on a line of code.
const ENVIRONMENT = /\b(?:extension_loaded|function_exists|PHP_VERSION(?:_ID)?|PHP_OS(?:_FAMILY)?|sys\.version_info|sys\.platform|process\.versions|process\.platform|runtime\.GOOS|runtime\.GOARCH|cfg!|os\.name)\b|#\[cfg\(/;
const KIT_OWN = /^(?:scripts\/kit\/|tests\/kit\/|tests\/source\/)/;
// K543: a statement that asserts, with the assertion call of its language, and holds no branch: a test that declares its environment and
// asserts it fails loudly where the environment differs, so its probe changes nothing that the test asserts.
const ASSERTION = /^\s*(?:\$this->assert\w*\(|(?:self|static)::assert\w*\(|self\.assert\w*\(|assert[\s(.]|assert(?:_eq|_ne)?!\(|expect\()/;
const PHP_ASSERTION_START = /^\s*(?:\$this->assert\w*\(|(?:self|static)::assert\w*\()/;
const BRANCH = /\?[^?:]*:|\bif\b|&&|\|\||\bmatch\b|\bswitch\b|\bskip/i;
/** Whether the line of code `code` asserts its environment without branching on it (K543). */
const assertsEnvironment = (code: string): boolean => ASSERTION.test(code) && !BRANCH.test(code) && !/#\[cfg/.test(code);

const lines = (text: string) => text.split('\n').map((line, index) => ({ number: index + 1, code: line.replace(/^\s*(?:\/\/|#(?!\[)|\*|\/\*).*$/, '') }));

/** Maps each line of a multiline PHP assertion call to the full call, so its arguments are judged together (K543-1). */
function phpAssertionLines(sourceLines: readonly { number: number; code: string }[]): Map<number, string> {
  const assertions = new Map<number, string>();
  for (let start = 0; start < sourceLines.length; start++) {
    const firstLine = sourceLines[start];
    if (firstLine === undefined || !PHP_ASSERTION_START.test(firstLine.code)) continue;
    let depth = 0;
    let quote: string | undefined;
    let escaped = false;
    let complete = false;
    const call: string[] = [];
    for (let index = start; index < sourceLines.length && !complete; index++) {
      const sourceLine = sourceLines[index];
      if (sourceLine === undefined) continue;
      const code = sourceLine.code;
      call.push(code);
      for (let offset = 0; offset < code.length; offset++) {
        const character = code[offset];
        if (quote !== undefined) {
          if (escaped) escaped = false;
          else if (character === '\\') escaped = true;
          else if (character === quote) quote = undefined;
          continue;
        }
        if (character === "'" || character === '"' || character === '`') quote = character;
        else if (character === '(') depth++;
        else if (character === ')') {
          depth--;
          if (depth === 0) {
            complete = true;
            break;
          }
        }
      }
      if (complete) {
        const fullCall = call.join('\n');
        for (let line = start; line <= index; line++) {
          const assertionLine = sourceLines[line];
          if (assertionLine !== undefined) assertions.set(assertionLine.number, fullCall);
        }
      }
    }
  }
  return assertions;
}

/** The implementation roots of the repository: those that config/parity.json declares, else the package folders of each runtime. */
export function implementationRoots(files: readonly string[], read: (file: string) => string | undefined): string[] {
  const declaration = read('config/parity.json');
  if (declaration !== undefined) {
    const parsed: unknown = JSON.parse(declaration);
    const implementations = typeof parsed === 'object' && parsed !== null ? (parsed as { implementations?: { roots?: string[] }[] }).implementations : undefined;
    return (implementations ?? []).flatMap(entry => entry.roots ?? []);
  }
  return implementationFolders(files);
}

const within = (root: string, file: string) => file === root || file.startsWith(`${root.replace(/\/$/, '')}/`);

/** The line of the first `needle` in `text`, or 1. */
const lineOf = (text: string, needle: string) => Math.max(1, text.split('\n').findIndex(line => line.includes(needle)) + 1);

/** A reason is of a kind that kit defines when it begins with the kind and a colon. */
export const reasonKind = (reason: string): boolean => REASON_KINDS.some(kind => reason.startsWith(`${kind}:`));

/** The findings of the checked `files` of a repository; `read` gives the text of a file. */
export function divergenceFindings(files: readonly string[], read: (file: string) => string | undefined): string[] {
  const roots = implementationRoots(files, read);
  const found: string[] = [];
  for (const file of files) {
    if (KIT_OWN.test(file)) continue;
    const text = read(file);
    if (text === undefined) continue;
    const inRoot = roots.some(root => within(root, file));
    if (inRoot && SOURCE.test(file)) {
      const sourceLines = lines(text);
      const assertionLines = file.endsWith('.php') && isTestFile(file) ? phpAssertionLines(sourceLines) : new Map<number, string>();
      for (const { number, code } of sourceLines) {
        const assertion = assertionLines.get(number) ?? code;
        if (isTestFile(file) && ENVIRONMENT.test(code) && !assertsEnvironment(assertion)) found.push(`${file}:${number}: a test branches on the implementation, the runtime or the platform (${ENVIRONMENT.exec(code)?.[0]}), so it asserts something else in another implementation`);
        else if (!isTestFile(file) && /\b(?:extension_loaded|function_exists)\(/.test(code)) found.push(`${file}:${number}: the code of an implementation branches on the presence of another implementation (${/\b(extension_loaded|function_exists)\(/.exec(code)?.[1]}), so the library and its extension coexist through a guard of the run time`);
      }
    }
    if (/(?:\.mk|\/Makefile|^Makefile|\.mts|\.mjs|\.sh|\.ya?ml)$/.test(file) || file.startsWith('.githooks/')) {
      for (const { number, code } of lines(text)) if (/--exclude-group\b/.test(code)) found.push(`${file}:${number}: --exclude-group narrows the run of an implementation`);
    }
    if (file.endsWith('contracts/features.json')) {
      for (const state of ['partial', 'unsupported']) {
        text.split('\n').forEach((line, index) => { if (new RegExp(`"${state}"`).test(line)) found.push(`${file}:${index + 1}: the feature file declares an implementation ${state}; every implementation holds every unit (S6)`); });
      }
    }
    if (file === 'config/duplication.json') found.push(...reasonFindings(file, text, reasoned(rootOf(text).exclude, 'glob')));
    if (file === 'config/parity.json') {
      const parsed = rootOf(text);
      found.push(...reasonFindings(file, text, reasoned(parsed.tools, 'root')));
      found.push(...reasonFindings(file, text, objects(parsed.implementations).flatMap(entry => reasoned(entry.internal, 'glob'))));
    }
  }
  return found.sort();
}

/** The JSON object of a configuration file, or an empty one for any other JSON. */
function rootOf(text: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(text);
  return isJsonObject(parsed) ? parsed : {};
}

/** The objects of a list in a configuration, else none. */
function objects(value: unknown): Record<string, unknown>[] {
  const list: unknown[] = Array.isArray(value) ? value : [];
  return list.filter(isJsonObject);
}

/** The exceptions of a list in a configuration: the value of `key` as the glob, and the reason. */
const reasoned = (value: unknown, key: string): { glob: string; reason: string }[] =>
  objects(value).map(entry => ({ glob: typeof entry[key] === 'string' ? entry[key] : '', reason: typeof entry.reason === 'string' ? entry.reason : '' }));

/** A finding for each entry of `entries` whose reason names no kind of REASON_KINDS. */
function reasonFindings(file: string, text: string, entries: readonly { glob: string; reason: string }[]): string[] {
  return entries.filter(entry => !reasonKind(entry.reason)).map(entry => `${file}:${lineOf(text, entry.glob)}: the exception ${entry.glob} gives a reason of no kind that kit defines; begin it with one of ${REASON_KINDS.map(kind => `${kind}:`).join(' ')}`);
}

/**
 * The files that the check reads: the tracked files, and the files on the disk below the implementation roots, since the sources
 * that a build generates before the gate are not tracked and are the code of the implementation as well (K329).
 */
export function checkedSources(root: string, tracked: readonly string[], read: (file: string) => string | undefined): string[] {
  const found = new Set(tracked);
  for (const directory of implementationRoots(tracked, read)) {
    const folder = path.join(root, directory);
    if (!existsSync(folder)) continue;
    for (const entry of readdirSync(folder, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const file = path.relative(root, path.join(entry.parentPath, entry.name)).split(path.sep).join('/');
      if (!/(?:^|\/)(?:vendor|node_modules|target|\.venv|var|dist|build)\//.test(file)) found.add(file);
    }
  }
  return [...found].sort();
}

if (isMain(import.meta.url)) {
  const root = repositoryRoot();
  const tracked = trackedFiles(root);
  const read = (file: string): string | undefined => { try { return readFileSync(path.join(root, file), 'utf8'); } catch { return undefined; } };
  const found = divergenceFindings(checkedSources(root, tracked, read), read);
  for (const finding of found) console.error(`[divergence-check] ${finding}`);
  if (found.length) {
    console.error(`[divergence-check] ${found.length} divergences; an implementation holds every unit of the contract and is tested as the others are`);
    process.exitCode = 1;
  } else console.log('[divergence-check] no implementation diverges through a branch, a narrowing, a feature state or an exception without a kind');
}
