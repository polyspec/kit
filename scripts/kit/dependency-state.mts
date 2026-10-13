// The dependency state of a checkout as its files record it, read without a network. The gate
// scripts/kit/check-dependency-policy.mts compares it with the review record config/dependency-review.json; the developer
// command scripts/kit/dependency-review.mts compares it with the registries and writes that record.
//
// Scope: a registry dependency is an entry of `dependencies` or `devDependencies` of the root package.json or of a
// workspace package.json, of `require` or `require-dev` of a Composer manifest that config/dependency-policy.json
// names (`composerPlatforms`), or a requirement of a Python manifest of the policy (`pythonManifests`: `build-system.requires`
// and each extra of `project.optional-dependencies`, each pinned exactly as `name==version`), that a registry resolves. Peer dependencies are not read. A URL dependency names its source itself, a package
// of this repository (an npm workspace or a Composer path repository) is built from the checkout, a polyspec package
// taken from a GitHub tag (`taggedNpmPackages` of the policy, linked with `file:`) is the release of that tag,
// and a Composer platform requirement (`php`, `ext-*`, ...) names the runtime: "latest stable release" has no meaning
// for them, so they are not registry dependencies. The check reads a package of this repository and a tagged package
// against its lock entry.
//
// The locks are the npm locks that the policy names (`npmLocks`, each read with the package.json beside it and its
// workspaces), the composer.lock of each Composer manifest and every Cargo.lock of the checkout;
// the review records the sha256 and the advisories of each. A Cargo lock has no registry dependencies in the review:
// its advisories come from RustSec.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { checkedFiles } from './tracked-files.mts';
import { readJson } from './bootstrap/files.mts';
import { toolchainConfig } from './bootstrap/toolchain-declared.mts';
import { readPylock } from './pylock.mts';

export const POLICY = 'config/dependency-policy.json';
export const RECORD = 'config/dependency-review.json';
export const NPM_MANIFEST = 'package.json';
export const TOOLCHAIN = 'config/toolchain.json';

/** A polyspec package taken from a GitHub tag, an entry of `taggedNpmPackages` of the policy. */
export type TaggedRelease = { directory: string; repository: string; tag: string; version: string; fix: string };

/** The part of config/dependency-policy.json (scripts/kit/schema/dependency-policy.schema.json) that the state reads. */
export type DependencyPolicy = {
  npmLocks: string[];
  composerPlatforms?: { manifest: string }[];
  pythonLocks?: { lock: string }[];
  pythonManifests?: string[];
  taggedNpmPackages?: TaggedRelease[];
};

/** The kind of a requirement of a pyproject.toml: build-system.requires or an extra. */
export type PythonRequirementKind = 'build-system' | `optional:${string}`;

/** The fields of every registry dependency: its manifest, specification and locked version. */
type DependencyFields = { ecosystem: string; manifest: string; package: string; spec: string; version: string | null };

/**
 * A registry dependency, by its kind: a package of a PEP 751 lock (`lock`) names the lock and its writer; an entry of an
 * npm or Composer manifest, a Go requirement, a requirement of a pyproject.toml or the ruff pin of the toolchain names its
 * lock, or null when it has none.
 */
export type Dependency =
  | DependencyFields & { kind: 'lock'; lock: string; createdBy: string | null }
  | DependencyFields & { kind: 'dependencies' | 'devDependencies' | 'require' | 'require-dev' | 'toolchain' | PythonRequirementKind; lock: string | null };

/**
 * A package of this repository that an npm manifest names: the directory of its lock (`base`), the directory that the lock
 * entry links or copies, the version of that entry and the version and name of the manifest of the directory.
 */
export type NpmLocalPackage = {
  ecosystem: 'npm';
  manifest: string;
  package: string;
  spec: string;
  kind: string;
  base: string;
  lock: string;
  directory: string | null;
  lockVersion: string | null;
  version: string | null;
  name: string | null;
};

/** A package of this repository that a Composer manifest requires from a path repository. */
export type ComposerLocalPackage = {
  ecosystem: 'composer';
  manifest: string;
  package: string;
  spec: string;
  kind: string;
  directory: string;
  lockVersion: string;
  version: string;
  name: string;
};

/** A package of this repository that a manifest names. */
export type LocalPackage = NpmLocalPackage | ComposerLocalPackage;

/** An exact requirement of a pyproject.toml. */
export type PythonRequirement = { package: string; kind: PythonRequirementKind; spec: string; version: string };

/** An entry of `packages` of an npm lock (lockfileVersion 3). */
export type NpmLockEntry = {
  version?: string;
  resolved?: string;
  link?: boolean;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
};

/** An npm lock (lockfileVersion 3). */
export type NpmLock = { packages?: Record<string, NpmLockEntry> };

// An npm manifest and a Composer manifest and lock, as far as the state reads them.
type NpmManifest = { workspaces?: string[]; overrides?: Record<string, unknown>; dependencies?: Record<string, string>; devDependencies?: Record<string, string>; version?: string; name?: string };
type ComposerManifest = { require?: Record<string, string>; 'require-dev'?: Record<string, string> };
type ComposerPackage = { name: string; version: string; dist?: { type: string; url: string } };
type ComposerLock = { packages?: ComposerPackage[]; 'packages-dev'?: ComposerPackage[] };
type Pylock = ReturnType<typeof readPylock>;
type VcsSource = NonNullable<Pylock['packages'][number]['vcs']>;

const LOCAL_SPEC = /^(file|link|workspace):/;
// A lock entry that npm installed as a copy (`install-links=true`) has `resolved: file:<directory>` and no `link`.
const COPY_PREFIX = 'file:';

/** The polyspec packages taken from a GitHub tag, from `taggedNpmPackages` of the policy: { directory, repository, tag, version }. */
const taggedPackages = (policy: DependencyPolicy) => policy.taggedNpmPackages ?? [];
const EXACT_PYTHON_PIN = /^([A-Za-z0-9][A-Za-z0-9._-]*)==(\d+(?:\.\d+)*)$/;
const URL_SPEC = /^(?!npm:)[A-Za-z][A-Za-z0-9+.-]*:|^[^@/][^/]*\/[^/]/;
const PLATFORM_REQUIREMENT = /^(php(-64bit|-ipv6|-zts|-debug)?|hhvm|ext-.+|lib-.+|composer(-plugin-api|-runtime-api)?)$/;


/** The exact requirements of a pyproject.toml: build-system.requires and every extra, each `name==version`. */
export function pythonRequirements(text: string, manifest: string) {
  const sections = text.split(/^(?=\[)/m);
  const requirements: PythonRequirement[] = [];
  const add = (kind: PythonRequirementKind, list: string) => {
    // The groups of both patterns are not optional, so every match holds them.
    for (const [, item] of list.matchAll(/"([^"]+)"/g)) {
      const pin = EXACT_PYTHON_PIN.exec(item!); // The groups of the pattern are not optional.
      if (!pin) throw new Error(`${manifest}: ${JSON.stringify(item)} is not an exact pin name==version; pin it exactly`);
      requirements.push({ package: pin[1]!, kind, spec: `==${pin[2]}`, version: pin[2]! }); // The groups of the pattern are not optional.
    }
  };
  for (const section of sections) {
    if (section.startsWith('[build-system]')) {
      const requires = /^requires\s*=\s*\[([\s\S]*?)\]/m.exec(section);
      // The groups of the patterns are not optional, so every match holds them.
      if (requires) add('build-system', requires[1]!);
    } else if (section.startsWith('[project.optional-dependencies]')) {
      // The groups of the patterns are not optional, so every match holds them.
      for (const [, extra, list] of section.matchAll(/^([A-Za-z0-9_-]+)\s*=\s*\[([\s\S]*?)\]/gm)) add(`optional:${extra}`, list!);
    }
  }
  return requirements;
}

/** The command that reviews the dependencies and writes the review record. */
export const UPDATE = 'make dependency-review UPDATE=1';

/** The key of a dependency in the policy and the record. */
export const dependencyKey = ({ ecosystem, manifest, package: name }: { ecosystem: string; manifest: string; package: string }) => `${ecosystem}:${manifest}:${name}`;

/** The go.mod files of the checkout: every go.mod that is tracked or new and not ignored. */
export const goModules = (root: string): string[] => checkedFiles(root).filter(file => path.posix.basename(file) === 'go.mod');

/**
 * The package patterns of the module of `lock` (a go.sum, beside its go.mod), relative to the module directory, in order:
 * `.` for the root package and `./<directory>` for each other directory of a tracked or new Go file. The advisory query
 * names these instead of `./...`, because `./...` walks every directory below the module, including a Go toolchain
 * under var/tools, which is not part of the module. As `./...` does, a directory whose name begins with `.` or `_`, or
 * is `testdata` or `vendor`, is skipped, and so is a directory below a nested module (a go.mod of its own).
 */
export function goPackagePatterns(root: string, lock: string): string[] {
  const module = path.posix.dirname(lock);
  const within = (directory: string, base: string) => base === '.' || directory === base || directory.startsWith(`${base}/`);
  const nested = goModules(root).map(file => path.posix.dirname(file)).filter(directory => directory !== module && within(directory, module));
  const patterns = new Set<string>();
  for (const file of checkedFiles(root).filter((item: string) => item.endsWith('.go'))) {
    const directory = path.posix.dirname(file);
    if (!within(directory, module) || nested.some(base => within(directory, base))) continue;
    const relative = path.posix.relative(module, directory);
    if (relative.split('/').some(part => /^[._]/.test(part) || part === 'testdata' || part === 'vendor')) continue;
    patterns.add(relative === '' ? '.' : `./${relative}`);
  }
  return [...patterns].sort();
}

/**
 * The direct requirements of a go.mod as { module, version }: the `require` lines without `// indirect`, except a module
 * that a `replace` directive points to a directory of the checkout, which is a package of this repository.
 */
export function goRequirements(text: string) {
  // The first group of each pattern below is not optional, so every match holds it.
  const replaced = new Set([...text.matchAll(/^\s*(?:replace\s+)?(\S+)(?:\s+v\S+)?\s*=>\s*(?:\.{1,2}\/|\/)\S*\s*$/gm)].map(match => match[1]!));
  const lines = [
    ...[...text.matchAll(/^require\s*\(([\s\S]*?)^\)/gm)].flatMap(match => match[1]!.split('\n')), // The groups of the pattern are not optional.
    ...[...text.matchAll(/^require\s+(\S+\s+v\S+.*)$/gm)].map(match => match[1]!), // The groups of the pattern are not optional.
  ];
  const requirements: { module: string; version: string }[] = [];
  for (const line of lines) {
    if (/\/\/\s*indirect/.test(line)) continue;
    const match = /^\s*(\S+)\s+(v\d\S*)/.exec(line);
    // Neither group of the pattern is optional, so a match holds both.
    if (match && !replaced.has(match[1]!)) requirements.push({ module: match[1]!, version: match[2]! });
  }
  return requirements;
}

/** The Cargo locks of the checkout: every Cargo.lock that is tracked or new and not ignored. */
export const cargoLocks = (root: string): string[] => checkedFiles(root).filter(file => path.posix.basename(file) === 'Cargo.lock');

// A PEP 751 lock is pylock.toml or pylock.<name>.toml.
const PYLOCK = /^pylock(\.[A-Za-z0-9_-]+)?\.toml$/;
const LOCK_ECOSYSTEMS: Record<string, string> = { 'package-lock.json': 'npm', 'composer.lock': 'composer', 'Cargo.lock': 'cargo', 'go.sum': 'go' };

/** The ecosystem of a lock: npm, composer, cargo, go or pypi (a PEP 751 pylock.toml). */
export const lockEcosystem = (lock: string) => {
  const name = path.posix.basename(lock);
  if (PYLOCK.test(name)) return 'pypi';
  return LOCK_ECOSYSTEMS[name];
};

/**
 * The command that regenerates a PEP 751 lock, named by the `created-by` field of the lock, which the writer sets. A lock without
 * a writer, or with one that kit does not name, has no fix of its own: the fix says so.
 */
export function lockFix(lock: string, createdBy: string | null, name: string) {
  if (createdBy === 'uv') return `regenerate ${lock} with uv: uv lock --upgrade-package ${name}, then uv export --format pylock.toml --frozen --no-emit-project -o ${lock}, then make dependency-review RECORD=1`;
  if (createdBy === 'pip') return `regenerate ${lock} with pip: pip lock, then make dependency-review RECORD=1`;
  return `regenerate ${lock} with the tool that wrote it (created-by ${createdBy === null ? 'is absent' : JSON.stringify(createdBy)}), then make dependency-review RECORD=1`;
}

/**
 * The npm manifests of the npm project at `base` (a directory of the checkout, `.` for the root): its package.json and the
 * package.json of each workspace directory. `directory` is relative to `base`, `manifest` to the checkout.
 */
export function npmManifests(root: string, base = '.') {
  const own = path.posix.join(base, NPM_MANIFEST);
  const manifest: NpmManifest = readJson(root, own);
  const workspaces = (manifest.workspaces ?? []).flatMap((pattern) => {
    if (!pattern.endsWith('/*')) throw new Error(`${own}: unsupported workspace pattern ${pattern}`);
    const parent = pattern.slice(0, -2);
    return readdirSync(path.join(root, base, parent), { withFileTypes: true })
      .filter(entry => entry.isDirectory() && existsSync(path.join(root, base, parent, entry.name, NPM_MANIFEST)))
      .map(entry => `${parent}/${entry.name}`);
  }).sort();
  return ['.', ...workspaces].map(directory => ({ directory, manifest: path.posix.join(base, directory, NPM_MANIFEST) }));
}

/** The directory of the checkout that a `file:` specification of a manifest names, resolved from the directory `base` of its lock; null for another specification. */
export const localSpecDirectory = (base: string, spec: string) => (spec.startsWith('file:') ? path.posix.join(base, spec.slice('file:'.length)) : null);

/** The lock entry of the package `name` that a manifest in `directory` resolves: its own node_modules first. */
export function npmLockEntry(lock: NpmLock, directory: string, name: string) {
  const nested = directory === '.' ? null : lock.packages?.[`${directory}/node_modules/${name}`];
  return nested ?? lock.packages?.[`node_modules/${name}`] ?? null;
}

/**
 * The dependency state of the checkout at `root`: the registry dependencies with their kind, range and locked version, the
 * packages of this repository with their lock entries, the manifests of each npm lock, and the locks. Each npm lock of
 * `policy.npmLocks` is read with the package.json beside it and that package's workspaces; a lock entry names its package
 * relative to the directory of its lock, and `base` is that directory.
 */
export function readState(root: string, policy: DependencyPolicy) {
  const dependencies: Dependency[] = [];
  const local: LocalPackage[] = [];
  const tagged: (NpmLocalPackage & { release: TaggedRelease })[] = [];
  const locks: string[] = [];
  const manifests: { directory: string; manifest: string; lock: string }[] = [];
  const npmLocks = new Map<string, NpmLock>();
  const pythonLocks: { lock: string; createdBy: Pylock['createdBy']; packages: Pylock['packages'] }[] = [];
  const vcs: { lock: string; package: string; url: VcsSource['url']; requestedRevision: VcsSource['requestedRevision']; commitId: VcsSource['commitId'] }[] = [];

  for (const lockPath of policy.npmLocks) {
    const base = path.posix.dirname(lockPath);
    const lock: NpmLock = readJson(root, lockPath);
    npmLocks.set(lockPath, lock);
    locks.push(lockPath);
    // A package that the overrides of the npm project install from a URL (a release archive) is not in the registry: it has no review.
    const urlOverrides = new Set(Object.entries((readJson(root, path.posix.join(base, NPM_MANIFEST)) as NpmManifest).overrides ?? {}).filter(([, value]) => typeof value === 'string' && URL_SPEC.test(value)).map(([name]) => name));
    for (const { directory, manifest: manifestPath } of npmManifests(root, base)) {
      manifests.push({ directory, manifest: manifestPath, lock: lockPath });
      const manifest: NpmManifest = readJson(root, manifestPath);
      for (const kind of ['dependencies', 'devDependencies'] as const) {
        for (const [name, spec] of Object.entries(manifest[kind] ?? {})) {
          const entry = npmLockEntry(lock, directory, name);
          const copied = !entry?.link && entry?.resolved?.startsWith(COPY_PREFIX);
          if (LOCAL_SPEC.test(spec) || entry?.link || copied) {
            // copied holds only for an entry with a resolved path.
            const target = entry?.link ? entry.resolved : copied ? entry!.resolved!.slice(COPY_PREFIX.length) : null;
            const packageDirectory = target ? path.posix.join(base, target) : null;
            // copied holds only for an entry.
            const lockVersion = copied ? entry!.version ?? null : target ? lock.packages?.[target]?.version ?? null : null;
            const targetManifest: NpmManifest | null = packageDirectory && existsSync(path.join(root, packageDirectory, NPM_MANIFEST)) ? readJson(root, `${packageDirectory}/${NPM_MANIFEST}`) : null;
            const item: NpmLocalPackage = {
              ecosystem: 'npm', manifest: manifestPath, package: name, spec, kind, base, lock: lockPath, directory: packageDirectory,
              lockVersion, version: targetManifest?.version ?? null, name: targetManifest?.name ?? null,
            };
            const release = taggedPackages(policy).find(entryRelease => entryRelease.directory === packageDirectory || localSpecDirectory(base, spec) === entryRelease.directory);
            if (release) tagged.push({ ...item, release });
            else local.push(item);
            continue;
          }
          if (URL_SPEC.test(spec) || urlOverrides.has(name)) continue;
          dependencies.push({ ecosystem: 'npm', manifest: manifestPath, package: name, kind, spec, version: entry?.version ?? null, lock: lockPath });
        }
      }
    }
  }

  for (const { manifest: manifestPath } of policy.composerPlatforms ?? []) {
    const lockPath = path.posix.join(path.posix.dirname(manifestPath), 'composer.lock');
    locks.push(lockPath);
    const composer: ComposerManifest = readJson(root, manifestPath);
    const composerLock: ComposerLock = readJson(root, lockPath);
    const locked = new Map([...(composerLock.packages ?? []), ...(composerLock['packages-dev'] ?? [])].map(item => [item.name, item]));
    for (const kind of ['require', 'require-dev'] as const) {
      for (const [name, spec] of Object.entries(composer[kind] ?? {})) {
        if (PLATFORM_REQUIREMENT.test(name)) continue;
        const entry = locked.get(name);
        if (entry?.dist?.type === 'path') {
          local.push({ ecosystem: 'composer', manifest: manifestPath, package: name, spec, kind, directory: entry.dist.url, lockVersion: entry.version, version: spec, name });
          continue;
        }
        dependencies.push({ ecosystem: 'composer', manifest: manifestPath, package: name, kind, spec, version: entry?.version ?? null, lock: lockPath });
      }
    }
  }
  // Each Python lock named by the policy is recorded with its sha256; its packages are read by the lock format (K36).
  // Each PEP 751 lock of the policy: its registry packages are dependencies of the lock (kind `lock`), its git packages are pinned
  // by their commit and recorded with it. A lock whose packages are not read fails in readPylock with the line of the construct.
  for (const { lock: lockPath } of policy.pythonLocks ?? []) {
    locks.push(lockPath);
    const lock: Pylock = readPylock(readFileSync(path.join(root, lockPath), 'utf8'), lockPath);
    pythonLocks.push({ lock: lockPath, createdBy: lock.createdBy, packages: lock.packages });
    for (const item of lock.packages) {
      if (item.kind === 'registry') {
        dependencies.push({ ecosystem: 'pypi', manifest: lockPath, package: item.name, kind: 'lock', spec: `==${item.version}`, version: item.version, lock: lockPath, createdBy: lock.createdBy });
        // readPylock gives a package of kind vcs its vcs table.
      } else if (item.kind === 'vcs' && item.vcs!.commitId !== null) {
        // readPylock gives a package of kind vcs its vcs table.
        vcs.push({ lock: lockPath, package: item.name, url: item.vcs!.url, requestedRevision: item.vcs!.requestedRevision, commitId: item.vcs!.commitId });
      }
    }
  }
  for (const manifestPath of policy.pythonManifests ?? []) {
    const text = readFileSync(path.join(root, manifestPath), 'utf8');
    for (const requirement of pythonRequirements(text, manifestPath)) {
      dependencies.push({ ecosystem: 'pypi', manifest: manifestPath, ...requirement, lock: null });
    }
  }
  // The ruff pin of config/toolchain.json is a PyPI release that the review checks like a requirement of a manifest.
  // toolchainConfig leaves the value unchecked; the cast reads ruff as toolchain.schema.json declares it, and a ruff that is no
  // such object gives an undefined version, as before.
  const ruff = toolchainConfig(root).ruff as { version: string } | undefined;
  if (ruff) dependencies.push({ ecosystem: 'pypi', manifest: TOOLCHAIN, package: 'ruff', kind: 'toolchain', spec: `==${ruff.version}`, version: ruff.version, lock: null });
  for (const manifestPath of goModules(root)) {
    const requirements = goRequirements(readFileSync(path.join(root, manifestPath), 'utf8'));
    if (requirements.length === 0) continue;
    const lockPath = path.posix.join(path.posix.dirname(manifestPath), 'go.sum');
    if (!existsSync(path.join(root, lockPath))) throw new Error(`${manifestPath} requires modules and ${lockPath} is missing; run go mod tidy in ${path.posix.dirname(manifestPath)}`);
    locks.push(lockPath);
    for (const { module, version } of requirements) {
      dependencies.push({ ecosystem: 'go', manifest: manifestPath, package: module, kind: 'require', spec: version, version, lock: lockPath });
    }
  }
  locks.push(...cargoLocks(root));
  return { dependencies, local, tagged, locks, manifests, npmLocks, pythonLocks, vcs };
}

// npm version ranges (https://docs.npmjs.com/cli/v11/using-npm/semver): `||` joins comparator sets, a set holds
// comparators joined by spaces, and `^`, `~`, `x` and partial versions and hyphen ranges reduce to `<`, `<=`, `>`, `>=`
// and `=`. A prerelease satisfies a set only when a comparator of the set names a prerelease of the same release.
const NPM_VERSION = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;
const NPM_PARTIAL = /^(<=|>=|<|>|=|\^|~>?|)v?(\*|x|X|\d+)(?:\.(\*|x|X|\d+))?(?:\.(\*|x|X|\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

/** A release `[major, minor, patch]`. */
type Release = [number, number, number];

/** A parsed npm version. */
type NpmVersion = { release: Release; pre: string[] };

/** A comparator of a comparator set: an operator of <, <=, >, >= and = with its version. */
type Comparator = { operator: string; version: NpmVersion };

/** A parsed npm version `{ release: [major, minor, patch], pre: [...] }`, or null. */
function npmVersion(text: string | undefined): NpmVersion | null {
  const match = String(text).match(NPM_VERSION);
  // The three groups of the release are not optional.
  return match ? { release: match.slice(1, 4).map(Number) as Release, pre: match[4] ? match[4].split('.') : [] } : null;
}

/** The order of two parsed npm versions: negative, zero or positive. */
function npmCompare(left: NpmVersion, right: NpmVersion) {
  for (let index = 0; index < 3; index += 1) {
    // index is 0, 1 or 2, a part of a release.
    if (left.release[index] !== right.release[index]) return left.release[index]! - right.release[index]!;
  }
  if (!left.pre.length || !right.pre.length) return right.pre.length - left.pre.length;
  for (let index = 0; index < Math.max(left.pre.length, right.pre.length); index += 1) {
    const a = left.pre[index];
    const b = right.pre[index];
    if (a === undefined || b === undefined) return a === undefined ? -1 : 1;
    if (a === b) continue;
    const numeric = [a, b].map(item => /^\d+$/.test(item));
    if (numeric[0] && numeric[1]) return Number(a) - Number(b);
    if (numeric[0] !== numeric[1]) return numeric[0] ? -1 : 1;
    return a < b ? -1 : 1;
  }
  return 0;
}

const comparator = (operator: string, release: Release, pre: string[] = []): Comparator => ({ operator, version: { release, pre } });
const below = (release: Release) => comparator('<', release, ['0']);

/** The comparators of one term of a comparator set, or null when the term is not a version range term. */
function npmTerm(term: string): Comparator[] | null {
  const match = term.match(NPM_PARTIAL);
  if (!match) return null;
  const [, operator, ...parts] = match;
  const wild = parts.slice(0, 3).map(part => part === undefined || /^[*xX]$/.test(part));
  // slice(0, 3) of the groups after the operator maps the three parts of the release.
  const [major, minor, patch] = parts.slice(0, 3).map(part => (part === undefined || /^[*xX]$/.test(part) ? 0 : Number(part))) as Release;
  const pre = parts[3] ? parts[3].split('.') : [];
  const level = wild[0] ? 0 : wild[1] ? 1 : wild[2] ? 2 : 3;
  const floor: Release = [major, minor, patch];
  const next: Release = level === 1 ? [major + 1, 0, 0] : [major, minor + 1, 0];
  if (operator === '' || operator === '=') {
    if (level === 0) return [];
    if (level === 3) return [comparator('=', floor, pre)];
    return [comparator('>=', floor), below(next)];
  }
  if (operator === '^') {
    if (level === 0) return [];
    const ceiling: Release = major > 0 || level === 1 ? [major + 1, 0, 0] : minor > 0 || level === 2 ? [0, minor + 1, 0] : [0, 0, patch + 1];
    return [comparator('>=', floor, pre), below(ceiling)];
  }
  // The group of the operator is not optional; it matches the empty string when no operator is written.
  if (operator!.startsWith('~')) {
    if (level === 0) return [];
    return [comparator('>=', floor, pre), below(level === 1 ? [major + 1, 0, 0] : [major, minor + 1, 0])];
  }
  if (level === 0) return operator === '<' || operator === '>' ? [below([0, 0, 0])] : [];
  // The group of the operator is not optional.
  if (level === 3) return [comparator(operator!, floor, pre)];
  if (operator === '>') return [comparator('>=', next)];
  if (operator === '>=') return [comparator('>=', floor)];
  if (operator === '<') return [below(floor)];
  return [below(next)];
}

/** The comparator sets of an npm range, or null when the specification is not a version range. */
function npmRange(range: string) {
  const text = String(range).replace(/^npm:(?:@[^/@]+\/)?[^@]+@/, '').trim();
  const sets: Comparator[][] = [];
  for (const alternative of text.split('||')) {
    const set = alternative.trim();
    const hyphen = set.match(/^(\S+)\s+-\s+(\S+)$/);
    const terms = hyphen
      ? [`>=${hyphen[1]}`, `<=${hyphen[2]}`]
      : set.replace(/(<=|>=|<|>|=|\^|~>?)\s+/g, '$1').split(/\s+/).filter(Boolean);
    const comparators: Comparator[] = [];
    for (const term of terms) {
      const parsed = npmTerm(term);
      if (!parsed) return null;
      comparators.push(...parsed);
    }
    sets.push(comparators);
  }
  return sets;
}

/** Whether `version` satisfies the npm range `range`; null for a specification that is not a version range. */
export function npmSatisfies(version: string | undefined, range: string) {
  const sets = npmRange(range);
  const parsed = npmVersion(version);
  if (!sets || !parsed) return null;
  return sets.some(set => set.every(({ operator, version: bound }) => {
    const order = npmCompare(parsed, bound);
    const holds: Record<string, boolean> = { '<': order < 0, '<=': order <= 0, '>': order > 0, '>=': order >= 0, '=': order === 0 };
    return holds[operator];
  }) && (!parsed.pre.length || set.some(({ version: bound }) => bound.pre.length > 0
    && bound.release.every((part, index) => part === parsed.release[index]))));
}

/** The lock location of the copy of `name` that a package at `location` loads: the nearest `node_modules` upward. */
function npmResolve(packages: Record<string, NpmLockEntry>, location: string, name: string) {
  const parts = location ? location.split('/') : [];
  for (let length = parts.length; length >= 0; length -= 1) {
    const candidate = [...parts.slice(0, length), 'node_modules', name].join('/');
    if (packages[candidate]) return candidate;
  }
  return null;
}

/**
 * The packages of an npm lock (lockfileVersion 3) installed at two versions although one of the two versions satisfies
 * every range that the packages loading either copy declare: their dependencies, optional and development
 * dependencies and required peer dependencies. Each package that loads a copy finds it in the nearest `node_modules`
 * upward from its own location. One line per package.
 */
export function npmDuplicates(lock: NpmLock) {
  const packages = lock.packages ?? {};
  const copies = new Map<string, Map<string, { range: string; from: string }[]>>();
  for (const [location, entry] of Object.entries(packages)) {
    for (const kind of ['dependencies', 'optionalDependencies', 'devDependencies', 'peerDependencies'] as const) {
      for (const [name, range] of Object.entries(entry[kind] ?? {})) {
        if (kind === 'peerDependencies' && entry.peerDependenciesMeta?.[name]?.optional) continue;
        const copy = npmResolve(packages, location, name);
        // npmResolve returns only a location of packages.
        if (!copy || packages[copy]!.link || !npmVersion(packages[copy]!.version) || !npmRange(range)) continue;
        if (!copies.has(name)) copies.set(name, new Map());
        // The line above sets every missing name.
        const loaders = copies.get(name)!;
        if (!loaders.has(copy)) loaders.set(copy, []);
        // The line above sets every missing copy.
        loaders.get(copy)!.push({ range, from: location === '' ? 'the root' : location });
      }
    }
  }
  const lines: string[] = [];
  for (const name of [...copies.keys()].sort()) {
    // name is a key of copies, and each copy is a location of packages.
    const located = [...copies.get(name)!].map(([copy, loaders]) => ({ version: packages[copy]!.version, loaders }));
    const found = located.flatMap((left, index) => located.slice(index + 1).map((right): [typeof left, typeof left] => [left, right]))
      .filter(([left, right]) => left.version !== right.version)
      .map(([left, right]) => {
        // copies holds only copies whose version npmVersion reads, and the sorted pair has two entries.
        const [low, high] = [left, right].sort((a, b) => npmCompare(npmVersion(a.version)!, npmVersion(b.version)!)) as [typeof left, typeof left];
        const loaders = [...left.loaders, ...right.loaders];
        const single = [high.version, low.version].find(version => loaders.every(({ range }) => npmSatisfies(version, range)));
        return single && { low: low.version, high: high.version, single, loaders };
      })
      .find(Boolean);
    if (!found) continue;
    const declared = found.loaders.map(({ range, from }) => `${range} of ${from}`);
    lines.push(`${name} is installed at ${found.low} and ${found.high}, and ${found.single} satisfies every range: ${declared.slice(0, -1).join(', ')} and ${declared.at(-1)}`);
  }
  return lines;
}
