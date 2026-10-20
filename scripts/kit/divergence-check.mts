#!/usr/bin/env node
// The check that no implementation diverges from the contract through an escape hatch (`make divergence-check`, K315, P32).
// Every implementation of a repository holds every unit (S6); these are the ways to let one of them differ without a unit saying
// so, and each is a finding that names the file and the line:
//   1. a test of an implementation branches on the implementation, the language, the runtime or the platform to change what it
//      asserts (extension_loaded, function_exists, PHP_VERSION, PHP_OS, sys.version_info, sys.platform, process.versions,
//      process.platform, runtime.GOOS, runtime.GOARCH, cfg!, #[cfg(...)], os.name);
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
import { trackedFiles } from './tracked-files.mts';

/** The kinds of reason that kit defines for an exception of a configuration: the reason begins with the kind and a colon. */
export const REASON_KINDS = ['generated', 'fixture', 'test', 'harness', 'ecosystem', 'external'] as const;

const SOURCE = /\.(?:php|py|[cm]?[jt]sx?|go|rs)$/;
// The environment that a test branches on: a call or a name, on a line of code.
const ENVIRONMENT = /\b(?:extension_loaded|function_exists|PHP_VERSION(?:_ID)?|PHP_OS(?:_FAMILY)?|sys\.version_info|sys\.platform|process\.versions|process\.platform|runtime\.GOOS|runtime\.GOARCH|cfg!|os\.name)\b|#\[cfg\(/;
const KIT_OWN = /^(?:scripts\/kit\/|tests\/kit\/|tests\/source\/)/;

const lines = (text: string) => text.split('\n').map((line, index) => ({ number: index + 1, code: line.replace(/^\s*(?:\/\/|#(?!\[)|\*|\/\*).*$/, '') }));

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
      for (const { number, code } of lines(text)) {
        if (isTestFile(file) && ENVIRONMENT.test(code)) found.push(`${file}:${number}: a test branches on the implementation, the runtime or the platform (${ENVIRONMENT.exec(code)?.[0]}), so it asserts something else in another implementation`);
        else if (!isTestFile(file) && /\b(?:extension_loaded|function_exists)\(/.test(code)) found.push(`${file}:${number}: the code of an implementation branches on the presence of another implementation (${/\b(extension_loaded|function_exists)\(/.exec(code)?.[1]}), so the library and its extension coexist through a guard of the run time`);
      }
    }
    if (/(?:\.mk|\/Makefile|^Makefile|\.mts|\.mjs|\.sh|\.ya?ml)$/.test(file) || /^\.githooks\//.test(file)) {
      for (const { number, code } of lines(text)) if (/--exclude-group\b/.test(code)) found.push(`${file}:${number}: --exclude-group narrows the run of an implementation`);
    }
    if (file.endsWith('contracts/features.json')) {
      for (const state of ['partial', 'unsupported']) {
        text.split('\n').forEach((line, index) => { if (new RegExp(`"${state}"`).test(line)) found.push(`${file}:${index + 1}: the feature file declares an implementation ${state}; every implementation holds every unit (S6)`); });
      }
    }
    if (file === 'config/duplication.json') found.push(...reasonFindings(file, text, (JSON.parse(text) as { exclude?: { glob: string; reason: string }[] }).exclude ?? []));
    if (file === 'config/parity.json') {
      const parsed = JSON.parse(text) as { tools?: { root: string; reason: string }[]; implementations?: { name: string; internal?: { glob: string; reason: string }[] }[] };
      found.push(...reasonFindings(file, text, (parsed.tools ?? []).map(entry => ({ glob: entry.root, reason: entry.reason }))));
      found.push(...reasonFindings(file, text, (parsed.implementations ?? []).flatMap(entry => entry.internal ?? [])));
    }
  }
  return found.sort();
}

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
