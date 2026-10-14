#!/usr/bin/env node
// The Python locks of the checkout: a PEP 751 pylock.toml per entry of pythonLocks in config/dependency-policy.json, each with
// its declared source: the direct requirements (a requirements file, or the static [project].dependencies of a pyproject.toml)
// and a constraints file that pins every package of the lock, transitive ones too, as name==version, or as name @ url#sha256=<digest>
// for a polyspec archive. A source may name findLinks, a directory of the checkout with local wheels.
//
//   node scripts/kit/python-lock.mts write     every lock, resolved by the uv of mise.toml (make python-lock; ONLINE, or offline with findLinks)
//   node scripts/kit/python-lock.mts check     every lock, compared with its sources, with no network (make python-lock-check)
//
// The writer runs `uv pip compile <requirements> -c <constraints> --universal --generate-hashes --format pylock.toml -o
// pylock.toml` in a temporary directory of var/tools that holds the sources under their own names, so the header of the lock
// names the source names and not the checkout path. With findLinks it adds `--no-index --find-links <directory>`; uv then writes
// each local wheel as a file URL with the checkout path, which the writer replaces by a path relative to the lock (PEP 751), so
// the lock holds no machine path. The lock is checked against the sources and renamed into place only when the check passes, so
// a refused run leaves the lock it had. The check never resolves: every package is pinned, so a lock that differs from its pins is
// a change of the lock, never of the registry. A local wheel is verified by its file (it exists and holds the sha256 of the lock).
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { satisfies } from '@renovatebot/pep440';
import { parsePipRequirementsFile, parsePipRequirementsLine, RequirementsSyntaxError, type Requirement as PipRequirement, type RequirementWithLocation } from 'pip-requirements-js';
import { POLICY } from './dependency-state.mts';
import { readPylock, type PylockFile, type PylockPackage } from './pylock.mts';
import { isStringArray, isTable, readToml, type TomlTable } from './toml.mts';
import { toolsPath } from './bootstrap/tool-wrappers.mts';
import { toolCommand } from './mise-tools.mts';
import { declaredMiseTools } from './toolchain-mise.mts';
import { isMain, repositoryRoot } from './paths.mts';
import { readConfig } from './schema-validate.mts';

const RELEASE = /^\d+(?:\.\d+)*$/;
const ARCHIVE_URL = /^(\S+?)#sha256=([0-9a-f]{64})$/;
const FILE_URL = /url = "(file:[^"]*)"/g;

/** A specifier of a requirement, such as >=2.30. */
type Specifier = { op: string; version: string };
/** A direct requirement: a name with its specifiers, or name @ url; `where` is its place and `line` its number. */
export type Requirement = { name: string; url: string | null; specifiers: Specifier[]; line: number; where: string };
/** A pin of a constraints file: name==version, or name @ url#sha256=<digest> for an archive. */
export type Pin = { name: string; version: string; line: number; url?: undefined; sha256?: undefined } | { name: string; url: string; sha256: string; line: number; version?: undefined };
/** An entry of pythonLocks in config/dependency-policy.json: the lock and its sources. */
export type LockEntry = { lock: string; source: { requirements: string; constraints: string; findLinks?: string } };
/** Adds a finding with its fix. */
type Add = (message: string, fix: string) => void;

/** The name of a package as PEP 503 compares it: lower case, and each run of - _ . as one -. */
export const normalize = (name: string) => name.toLowerCase().replace(/[-_.]+/g, '-');
const withoutFragment = (url: string) => url.replace(/#.*$/, '');
// The line of the character `index` of `text`, counted from 1.
const lineOf = (text: string, index: number) => text.slice(0, index).split('\n').length;
// A requirement line of `where` parsed by pip-requirements-js; a line that is no PEP 508 requirement or pip option throws with
// `where` and the reason of the parser.
function parseLine(text: string, where: string): PipRequirement | null {
  try {
    return parsePipRequirementsLine(text);
  } catch (error) {
    if (!(error instanceof RequirementsSyntaxError)) throw error;
    throw new Error(`${where}: ${text} is not read: ${error.message}`);
  }
}
// The entries of a requirements or constraints file as pip reads it (comments and blank lines skipped), each with its text and
// line; a file that pip-requirements-js does not read throws with the file and the reason of the parser, which names the line.
function entriesOf(text: string, file: string) {
  let located: RequirementWithLocation[];
  try {
    located = parsePipRequirementsFile(text, { includeLocations: true });
  } catch (error) {
    if (!(error instanceof RequirementsSyntaxError)) throw error;
    throw new Error(`${file}: ${error.message}`);
  }
  return located.map(({ location }) => {
    const line = text.slice(location.startIdx, location.endIdx);
    // The text is an entry that the file parser read, so the line parser reads it to a requirement.
    return { text: line, line: lineOf(text, location.startIdx), entry: parseLine(line, file)! };
  });
}
// An error that names the fix of its own, so the finding says what to write.
const failWith = (message: string, fix: string) => Object.assign(new Error(message), { fix });

/**
 * One requirement as { name, url, specifiers: [{ op, version }], line, where }, by kit's policy over PEP 508: a name with optional
 * extras and specifiers (name, name==2.34.2, name>=2.30,<3), or name @ url. A marker is not read for the pin. An option line, a
 * specifier with a version that is not a release (a wildcard, a pre-release) and ~= with one segment throw with `where`.
 */
function requirementOf(entry: PipRequirement, line: string, where: string, number: number): Requirement {
  if (entry.type === 'RequirementsFile' || entry.type === 'ConstraintsFile') throw new Error(`${where}: ${line} is not read; write name, name==version, a range such as name>=2.30,<3, or name @ url`);
  if (entry.type === 'ProjectURL') return { name: entry.name, url: entry.url, specifiers: [], line: number, where };
  const specifiers = (entry.versionSpec ?? []).map(({ operator, version }) => {
    if (!RELEASE.test(version)) throw new Error(`${where}: ${line} is not read; a specifier is ==, !=, >=, <=, >, < or ~= with a release such as 2.30, and no wildcard or pre-release`);
    if (operator === '~=' && version.split('.').length < 2) throw new Error(`${where}: ${line} is not read; ~= needs two release segments, such as ~=2.30`);
    return { op: operator, version };
  });
  return { name: entry.name, url: null, specifiers, line: number, where };
}

/** The direct requirements of a requirements file, one per line; the errors name the line. */
export function parseRequirements(text: string, file: string) {
  return entriesOf(text, file).map(({ text: line, line: number, entry }) => requirementOf(entry, line, `${file} line ${number}`, number));
}

/**
 * The direct requirements of a pyproject.toml: its static [project].dependencies. A pyproject that lists dependencies in
 * [project].dynamic is refused, since the direct requirements are then not in the file.
 */
export function parseProjectDependencies(text: string, file: string) {
  let data: TomlTable;
  try {
    data = readToml(text, file);
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    // readToml throws an Error that names the file, the line and the column.
    throw failWith(error.message, `write ${file} as valid TOML`);
  }
  const project = data.project;
  if (!isTable(project)) {
    throw failWith(`${file}: there is no [project] table`, `add [project] with dependencies to ${file}`);
  }
  if (Array.isArray(project.dynamic) && project.dynamic.includes('dependencies')) {
    throw failWith(`${file}: [project].dynamic lists dependencies, so the direct requirements are not static`, `write the requirements in [project].dependencies of ${file} and remove dependencies from [project].dynamic`);
  }
  const list = project.dependencies ?? [];
  if (!isStringArray(list)) {
    throw failWith(`${file}: [project].dependencies is not an array of strings`, `write each requirement as a string in [project].dependencies of ${file}`);
  }
  return list.map((item, index) => {
    const where = `${file} [project].dependencies item ${index + 1}`;
    const entry = parseLine(item, where);
    if (entry === null) throw new Error(`${where}: ${JSON.stringify(item)} is no requirement`);
    return requirementOf(entry, item, where, index + 1);
  });
}

/**
 * The pins of a constraints file: [{ name, version, line }] for name==version, and [{ name, url, sha256, line }] for
 * name @ url#sha256=<digest>. Any other line throws with its number, so a constraint never leaves a package unpinned.
 */
export function parseConstraints(text: string, file: string) {
  return entriesOf(text, file).map(({ text: line, line: number, entry }): Pin => {
    const plain = entry.type !== 'RequirementsFile' && entry.type !== 'ConstraintsFile' && !entry.extras?.length && !entry.environmentMarkerTree;
    if (plain && entry.type === 'ProjectName' && entry.versionSpec?.length === 1) {
      // The length check makes the specifier exist.
      const { operator, version } = entry.versionSpec[0]!;
      if (operator === '==' && !version.includes('*')) return { name: entry.name, version, line: number };
    }
    const archive = plain && entry.type === 'ProjectURL' ? ARCHIVE_URL.exec(entry.url) : null;
    // Both groups of ARCHIVE_URL are required, so a match holds them.
    if (archive && entry.type === 'ProjectURL') return { name: entry.name, url: archive[1]!, sha256: archive[2]!, line: number };
    throw new Error(`${file} line ${number}: ${line} is not name==version or a direct reference with #sha256`);
  });
}

const pinLabel = (pin: Pin) => (pin.version === undefined ? pin.name : `${pin.name}==${pin.version}`);
const requirementLabel = (requirement: Requirement) => (requirement.url !== null ? `${requirement.name} @ ${requirement.url}` : `${requirement.name}${requirement.specifiers.map(item => `${item.op}${item.version}`).join(',')}`);
const pinnedAs = (pin: Pin) => (pin.version !== undefined ? `${pin.name} ${pin.version}` : `the archive ${pin.url}`);

// The requirements of a source: a pyproject.toml gives its [project].dependencies, any other file gives its lines.
const parseRequirementSource = (file: string, text: string) => (path.basename(file) === 'pyproject.toml' ? parseProjectDependencies(text, file) : parseRequirements(text, file));

// The sources parsed: { pins, requirements, findings }; a source that does not parse yields its findings only.
function parseSources({ requirements, constraints, text }: { requirements: string; constraints: string; text: { requirements: string; constraints: string } }) {
  const findings: string[] = [];
  let pins: Pin[] | null = null;
  let reqs: Requirement[] | null = null;
  try {
    pins = parseConstraints(text.constraints, constraints);
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    findings.push(`${error.message}. Fix: write name==version in ${constraints}, or name @ url#sha256=<digest> for a polyspec archive`);
  }
  try {
    reqs = parseRequirementSource(requirements, text.requirements);
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    findings.push(`${error.message}. Fix: ${(error as Error & { fix?: string }).fix ?? `write the requirement in a form that ${requirements} reads`}`);
  }
  return { pins, requirements: reqs, findings };
}

// The findings of a lock text against its parsed sources: each sentence names the file, the package and the fix. The local
// files of the lock (a path relative to the lock) are read from `root`, so the check holds on the checkout only.
function compare({ root, lock, lockText, requirements, constraints, pins, reqs }: {
  root: string; lock: string; lockText: string; requirements: string; constraints: string; pins: Pin[]; reqs: Requirement[];
}) {
  const findings: string[] = [];
  const add: Add = (message, fix) => findings.push(`${message}. Fix: ${fix}`);
  const pinned = new Map<string, Pin>();
  for (const pin of pins) {
    const key = normalize(pin.name);
    if (pinned.has(key)) add(`${constraints} line ${pin.line}: ${pin.name} is pinned twice`, `keep one pin of ${pin.name} in ${constraints}`);
    pinned.set(key, pin);
  }
  let locked: PylockPackage[];
  try {
    locked = readPylock(lockText, lock).packages;
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    add(error.message, `write ${lock} with make python-lock`);
    return findings;
  }
  const lockedByKey = new Map<string, PylockPackage>();
  for (const item of locked) {
    const key = normalize(item.name);
    const shown = `${item.name} ${item.version}`;
    if (lockedByKey.has(key)) add(`${lock}: ${shown} is locked twice`, 'make python-lock writes one entry for each package');
    lockedByKey.set(key, item);
    if (item.kind !== 'registry' && item.kind !== 'archive') {
      add(`${lock}: ${shown} is a ${item.kind} package; the lock holds registry files and archives only`, `publish ${item.name} as a polyspec archive, and pin it in ${constraints} as name @ url#sha256=<digest>`);
      continue;
    }
    const pin = pinned.get(key);
    if (!pin) {
      add(`${lock}: ${shown} is in the lock and has no pin in ${constraints}`, `pin ${item.name}==${item.version} in ${constraints}, then make python-lock`);
      continue;
    }
    if (item.kind === 'registry') {
      if (pin.version === undefined) add(`${lock}: ${shown} is locked from a registry, but ${constraints} pins its archive ${pin.url}`, `pin ${item.name}==${item.version} in ${constraints}, or make python-lock`);
      else if (pin.version !== item.version) add(`${lock}: ${shown} is locked, ${constraints} pins ${item.name} ${pin.version}`, `make python-lock, or change ${constraints} to ${item.name}==${item.version}`);
      if (item.files.some(file => file.sha256 === null)) add(`${lock}: ${shown} has a file with no sha256`, 'make python-lock, which writes the sha256 of each file');
      for (const file of item.files) localFileFindings({ root, lock, shown, file, add });
      continue;
    }
    const file = item.files[0];
    if (pin.version !== undefined) add(`${lock}: ${shown} is locked from an archive, but ${constraints} pins ${pinLabel(pin)}`, `pin ${item.name} as name @ url#sha256=<digest> in ${constraints}, or make python-lock`);
    else if (file.url !== withoutFragment(pin.url)) add(`${lock}: ${shown} archive is ${file.url}, ${constraints} pins ${pin.url}`, `make python-lock, or correct the URL in ${constraints}`);
    else if (file.sha256 !== pin.sha256) add(`${lock}: ${shown} archive has the sha256 ${file.sha256}, ${constraints} pins ${pin.sha256}`, `make python-lock, or correct the sha256 in ${constraints}`);
  }
  for (const pin of pinned.values()) {
    if (!lockedByKey.has(normalize(pin.name))) add(`${constraints}: ${pinLabel(pin)} is pinned and the lock ${lock} does not hold ${pin.name}`, `make python-lock, or remove ${pin.name} from ${constraints}`);
  }
  for (const requirement of reqs) {
    const pin = pinned.get(normalize(requirement.name));
    const where = requirement.where;
    if (!pin) {
      add(`${where}: ${requirement.name} has no pin in ${constraints}`, `pin ${requirement.name}==<version> in ${constraints}`);
      continue;
    }
    const unsatisfied = `${where}: ${requirementLabel(requirement)} is not satisfied by ${pinnedAs(pin)} pinned in ${constraints}`;
    if (requirement.url !== null) {
      if (pin.url === undefined || withoutFragment(pin.url) !== withoutFragment(requirement.url)) add(unsatisfied, `make ${requirement.name} the archive that ${constraints} pins`);
    } else if (pin.version === undefined) {
      if (requirement.specifiers.length > 0) add(unsatisfied, `pin ${requirement.name}==<version> in ${constraints}, or change ${requirements}`);
    } else if (!satisfies(pin.version, requirement.specifiers.map(item => `${item.op}${item.version}`).join(','))) {
      add(unsatisfied, `change ${requirements}, or pin a release that satisfies it in ${constraints}`);
    }
  }
  return findings;
}

// The findings of one local file of a registry package: its path is relative to the lock, the file exists and holds the sha256.
function localFileFindings({ root, lock, shown, file, add }: { root: string; lock: string; shown: string; file: PylockFile; add: Add }) {
  if (file.path === null) return;
  if (typeof file.path !== 'string') throw new Error(`${lock}: ${shown} file path is ${JSON.stringify(file.path)}, which is no path`);
  if (path.isAbsolute(file.path)) {
    add(`${lock}: ${shown} file ${file.path} is an absolute path; the lock holds each local file by a path relative to ${lock}`, `make python-lock with findLinks, which writes the paths relative to ${lock}`);
    return;
  }
  // A local wheel belongs to the package of the lock, the directory of the lock: a path that leaves it is refused.
  if (path.posix.normalize(file.path).split('/')[0] === '..') {
    add(`${lock}: ${shown} file ${file.path} leaves ${path.posix.dirname(lock)}, the package of ${lock}`, `keep the wheels of findLinks inside ${path.posix.dirname(lock)} and make python-lock again`);
    return;
  }
  const display = path.posix.normalize(path.posix.join(path.posix.dirname(lock), file.path));
  const where = path.join(root, display);
  if (!existsSync(where) || !statSync(where).isFile()) {
    add(`${lock}: ${shown} file ${display} is missing`, `copy the wheel to ${display}, or make python-lock with a findLinks directory that holds it`);
    return;
  }
  const digest = createHash('sha256').update(readFileSync(where)).digest('hex');
  if (file.sha256 !== null && digest !== file.sha256) add(`${lock}: ${shown} file ${display} has the sha256 ${digest}, ${lock} holds ${file.sha256}`, `restore ${display}, or make python-lock with its findLinks directory`);
}

// The text of a source or the lock at `root`; a file that is missing is a finding, and null is returned.
function read(root: string, file: string, findings: string[], fix: string) {
  if (!existsSync(path.join(root, file))) {
    findings.push(`${file} is missing. Fix: ${fix}`);
    return null;
  }
  return readFileSync(path.join(root, file), 'utf8');
}

/**
 * The findings of the lock of `entry` ({ lock, source: { requirements, constraints, findLinks? } }) read from `root`, offline. Each
 * finding names the file, the package and the fix. An empty list means the lock holds exactly the pins, every requirement is
 * satisfied, every archive matches its pin, every registry file has a sha256, and every local file exists with that sha256.
 */
export function checkPythonLock({ root, entry }: { root: string; entry: LockEntry }) {
  const { lock, source } = entry;
  const findings: string[] = [];
  const requirements = read(root, source.requirements, findings, `create ${source.requirements}`);
  const constraints = read(root, source.constraints, findings, `create ${source.constraints}`);
  const lockText = read(root, lock, findings, `write ${lock} with make python-lock`);
  if (requirements === null || constraints === null || lockText === null) return findings;
  const text = { requirements, constraints };
  const parsed = parseSources({ requirements: source.requirements, constraints: source.constraints, text });
  if (parsed.findings.length > 0) return parsed.findings;
  if (parsed.pins === null || parsed.requirements === null) throw new Error(`${lock}: the sources ${source.requirements} and ${source.constraints} gave no finding and no parsed pins or requirements`);
  return compare({ root, lock, lockText, requirements: source.requirements, constraints: source.constraints, pins: parsed.pins, reqs: parsed.requirements });
}

/** The entries of pythonLocks of config/dependency-policy.json at `root`; a policy with none fails, so no lock is skipped silently. */
export function pythonLockEntries(root: string): LockEntry[] {
  const file = path.join(root, POLICY);
  if (!existsSync(file)) throw new Error(`${POLICY} is missing; declare pythonLocks in it, each lock with its source`);
  const entries = readConfig<{ pythonLocks?: LockEntry[] }>(root, POLICY, 'dependency-policy.schema.json').pythonLocks ?? [];
  if (entries.length === 0) throw new Error(`${POLICY} declares no pythonLocks, so no lock is written or checked; declare each lock with its requirements and constraints`);
  return entries;
}

// The findLinks directory of a source: a directory inside the checkout that exists.
function findLinksOf(root: string, lock: string, findLinks: string) {
  if (path.isAbsolute(findLinks) || path.normalize(findLinks).split(path.sep)[0] === '..') throw new Error(`${lock}: findLinks ${findLinks} is outside the checkout; name a directory inside it`);
  // The wheels of findLinks belong to the package of the lock, so the lock names each by a path inside that directory.
  const relative = path.relative(path.dirname(lock), path.normalize(findLinks));
  if (relative.split(path.sep)[0] === '..') throw new Error(`${lock}: findLinks ${findLinks} is outside ${path.dirname(lock)}, the package of ${lock}; name a directory inside it`);
  const directory = path.join(root, findLinks);
  if (!existsSync(directory) || !statSync(directory).isDirectory()) throw new Error(`${lock}: findLinks ${findLinks} is not a directory; create it with the wheels of the lock`);
  return directory;
}

// uv writes each local wheel as a file URL with the checkout path. The writer replaces it by the path of the wheel relative to the
// lock, so the lock holds no machine path; any other file URL is refused.
function relativeLocalPaths(text: string, root: string, lock: string) {
  const lockDirectory = path.join(realpathSync(root), path.dirname(lock));
  const rewritten = text.replace(FILE_URL, (_: string, url: string) => `path = "${path.relative(lockDirectory, fileURLToPath(url)).split(path.sep).join('/')}"`);
  if (rewritten.includes('file:')) throw new Error(`${lock}: uv wrote a file URL that is not a wheel of findLinks; the lock would hold a machine path. Fix: remove the local source from ${lock}`);
  return rewritten;
}

/**
 * Writes the lock of `entry` with the uv of mise.toml, as the header describes, and returns { file: entry.lock }. A source that does
 * not parse, a uv that fails and a lock that the check refuses throw with their findings, and the lock of the checkout is replaced
 * only by a lock that passed.
 */
export function writePythonLock({ root, entry, env = process.env, print = () => {} }: { root: string; entry: LockEntry; env?: NodeJS.ProcessEnv; print?: (text: string) => void }) {
  const uv = toolCommand(root, 'uv');
  if (!existsSync(uv)) throw new Error(`${path.relative(root, uv)} is missing; declare uv in mise.toml and run make install-tools`);
  const { lock, source } = entry;
  const names: [string, string] = [path.basename(source.requirements), path.basename(source.constraints)];
  if (names[0] === names[1] || names.includes('pylock.toml')) throw new Error(`${lock}: the requirements and the constraints need two different names, neither pylock.toml; name them differently`);
  const linksDirectory = source.findLinks === undefined ? null : findLinksOf(root, lock, source.findLinks);
  // The lower bound of the universal resolution is the declared Python minor: without --python-version, uv takes it from an
  // interpreter that it finds on the machine, so the lock would depend on the machine.
  const python = declaredMiseTools(root).python?.version.split('.').slice(0, 2).join('.');
  if (python === undefined) throw new Error(`${lock}: mise.toml declares no python, whose minor is the lower bound of the resolution; declare it`);
  const text = {
    requirements: readFileSync(path.join(root, source.requirements), 'utf8'),
    constraints: readFileSync(path.join(root, source.constraints), 'utf8'),
  };
  const sources = { requirements: source.requirements, constraints: source.constraints, text };
  const early = parseSources(sources);
  if (early.findings.length > 0) throw new Error(early.findings.join('\n'));
  mkdirSync(toolsPath(root), { recursive: true });
  const folder = mkdtempSync(toolsPath(root, 'python-lock-'));
  try {
    copyFileSync(path.join(root, source.requirements), path.join(folder, names[0]));
    copyFileSync(path.join(root, source.constraints), path.join(folder, names[1]));
    const args = ['pip', 'compile', names[0], '-c', names[1], '--universal', '--python-version', python, '--generate-hashes', '--format', 'pylock.toml', '-o', 'pylock.toml'];
    if (linksDirectory !== null) args.push('--no-index', '--find-links', linksDirectory);
    const shown = `${path.relative(root, uv)} ${args.join(' ')}`;
    print(shown);
    const result = spawnSync(uv, args, { cwd: folder, env, encoding: 'utf8' });
    if (result.error) throw new Error(`${shown} could not start: ${result.error.message}`);
    if (result.status !== 0) throw new Error(`${shown} ended with exit status ${result.status}: ${String(result.stderr).trim()}`);
    const output = path.join(folder, 'pylock.toml');
    if (!existsSync(output)) throw new Error(`${shown} wrote no pylock.toml`);
    const written = relativeLocalPaths(readFileSync(output, 'utf8'), root, lock);
    writeFileSync(output, written);
    if (early.pins === null || early.requirements === null) throw new Error(`${lock}: the sources ${source.requirements} and ${source.constraints} gave no finding and no parsed pins or requirements`);
    const findings = compare({ root, lock, lockText: written, requirements: source.requirements, constraints: source.constraints, pins: early.pins, reqs: early.requirements });
    if (findings.length > 0) throw new Error(findings.join('\n'));
    mkdirSync(path.dirname(path.join(root, lock)), { recursive: true });
    renameSync(output, path.join(root, lock));
    return { file: lock };
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

if (isMain(import.meta.url)) {
  let failed = false;
  try {
    const command = process.argv[2];
    if (command !== 'write' && command !== 'check') throw new Error('the command is write or check, for example node scripts/kit/python-lock.mts check');
    const entries = pythonLockEntries(repositoryRoot());
    for (const entry of entries) {
      if (command === 'write') {
        try {
          writePythonLock({ root: repositoryRoot(), entry, print: text => console.log(`[python-lock] ${text}`) });
          console.log(`[python-lock] wrote ${entry.lock}`);
        } catch (error) {
          if (!(error instanceof Error)) throw error;
          console.error(`[python-lock] ${entry.lock} failed: ${error.message}`);
          failed = true;
        }
      } else {
        const findings = checkPythonLock({ root: repositoryRoot(), entry });
        for (const finding of findings) console.error(`[python-lock] ${finding}`);
        if (findings.length > 0) failed = true;
      }
    }
    if (command === 'check') console.log(failed ? `[python-lock] ${entries.length} lock(s) checked, some differ from their sources` : `[python-lock] ${entries.length} lock(s) match their sources`);
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    console.error(`[python-lock] ${error.message}`);
    failed = true;
  }
  if (failed) process.exitCode = 1;
}
