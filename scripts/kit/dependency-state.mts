// The dependency state of a checkout as its files record it, read without a network. The gate
// scripts/kit/check-dependency-policy.mts compares it with the review record config/dependency-review.json; the developer
// command scripts/kit/dependency-review.mts compares it with the registries and writes that record.
//
// Scope: a registry dependency is an entry of `dependencies` or `devDependencies` of the root package.json or of a
// workspace package.json, of `require` or `require-dev` of a Composer manifest that config/dependency-policy.json
// names (`composerPlatforms`) and of `require` of each package that a path repository of such a manifest provides (a
// published package of a Composer monorepo, at the version of the root lock; K168), or a requirement of a Python manifest of the policy (`pythonManifests`: `build-system.requires`
// each extra of `project.optional-dependencies` and each group of `dependency-groups` with its included groups (PEP 735,
// K177), each pinned exactly as `name==version`), that a registry resolves. Peer dependencies are not read. A URL dependency names its source itself, a package
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
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import picomatch from 'picomatch';
import semver from 'semver';

import { checkedFiles } from './tracked-files.mts';
import { readComposerLock, readComposerManifest, readNpmLock, readNpmManifest, type ComposerPackage, type NpmLock, type NpmLockEntry } from './manifests.mts';
import { readConfig } from './schema-validate.mts';
import { LINK_LOCK, judgedComposerFiles } from './composer-project.mts';
import { goWorkFile, readGoMod, readGoWork } from './toolchain-files.mts';
import { declaredMiseTools } from './toolchain-mise.mts';
import { readPylock } from './pylock.mts';
import { isStringArray, isTable, readToml } from './toml.mts';
import { dependencyArrays, dependencyGroups } from './pyproject-dependencies.mts';
import type { Ecosystem } from './version.mts';
import { present } from './present.mts';

export const POLICY = 'config/dependency-policy.json';
export const RECORD = 'config/dependency-review.json';
export const NPM_MANIFEST = 'package.json';
export const TOOLCHAIN = 'mise.toml';

/** A polyspec package taken from a GitHub tag, an entry of `taggedNpmPackages` of the policy. */
export type TaggedRelease = { directory: string; repository: string; tag: string; version: string; fix: string };

/** The part of config/dependency-policy.json (scripts/kit/schema/dependency-policy.schema.json) that the state reads. */
export type DependencyPolicy = {
  npmLocks: string[];
  composerPlatforms: { manifest: string }[];
  pythonLocks: { lock: string }[];
  pythonManifests: string[];
  taggedNpmPackages?: TaggedRelease[];
  advisoryExceptions?: Record<string, unknown>[];
};

/**
 * The release of the package of an advisory as a line names it: the version that the lock holds, or the range of the
 * advisory (npm audit) when the lock holds the package at no path of its own name.
 */
export const advisoryRelease = (advisory: { version?: string | undefined; range?: string | undefined }): string =>
  advisory.version !== undefined ? advisory.version : `in range ${advisory.range}`;

/** The policy of `root` validated against dependency-policy.schema.json; throws with every error of the schema. */
export function readPolicy<Policy extends DependencyPolicy = DependencyPolicy>(root: string): Policy {
  return readConfig<Policy>(root, POLICY, 'dependency-policy.schema.json');
}

/** The kind of a requirement of a pyproject.toml: build-system.requires, an extra or a dependency group. */
export type PythonRequirementKind = 'build-system' | `optional:${string}` | `group:${string}`;

/** The fields of every registry dependency: its manifest, specification and locked version. */
type DependencyFields = { ecosystem: Ecosystem; manifest: string; package: string; spec: string; version: string | null };

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

export type { NpmLock, NpmLockEntry } from './manifests.mts';
type Pylock = ReturnType<typeof readPylock>;
type VcsSource = NonNullable<Pylock['packages'][number]['vcs']>;

const LOCAL_SPEC = /^(file|link|workspace):/;

/** The polyspec packages taken from a GitHub tag, from `taggedNpmPackages` of the policy: { directory, repository, tag, version }. */
const taggedPackages = (policy: DependencyPolicy) => policy.taggedNpmPackages ?? [];
const EXACT_PYTHON_PIN = /^([A-Za-z0-9][A-Za-z0-9._-]*)==(\d+(?:\.\d+)*)$/;
const URL_SPEC = /^(?!npm:)[A-Za-z][A-Za-z0-9+.-]*:|^[^@/][^/]*\/[^/]/;
const PLATFORM_REQUIREMENT = /^(php(-64bit|-ipv6|-zts|-debug)?|hhvm|ext-.+|lib-.+|composer(-plugin-api|-runtime-api)?)$/;


/**
 * The exact requirements of a pyproject.toml: build-system.requires, every extra and every dependency group with the
 * groups that it includes (pyproject-dependencies.mts, K177), each `name==version`. A requirement that two groups reach,
 * such as one of an included group, is read once, with the first group that reaches it.
 */
export function pythonRequirements(text: string, manifest: string) {
  const data = readToml(text, manifest);
  const requirements: PythonRequirement[] = [];
  const seen = new Set<string>();
  const add = (kind: PythonRequirementKind, where: string, list: unknown) => {
    if (list === undefined) return;
    if (!isStringArray(list)) throw new Error(`${manifest}: ${where} is not an array of strings`);
    for (const item of list) {
      const pin = EXACT_PYTHON_PIN.exec(item);
      if (!pin) throw new Error(`${manifest}: ${JSON.stringify(item)} is not an exact pin name==version; pin it exactly`);
      if (kind.startsWith('group:') && seen.has(item)) continue;
      seen.add(item);
      requirements.push({ package: present(pin[1], 'pin[1]'), kind, spec: `==${pin[2]}`, version: present(pin[2], 'pin[2]') }); // The groups of the pattern are not optional.
    }
  };
  const buildSystem = data['build-system'];
  if (buildSystem !== undefined && !isTable(buildSystem)) throw new Error(`${manifest}: build-system is not a table`);
  add('build-system', 'build-system.requires', buildSystem?.['requires']);
  for (const { kind, where, list } of dependencyArrays(data, manifest)) if (kind !== 'dependencies' && kind.startsWith('optional:')) add(kind, where, list);
  for (const [group, list] of dependencyGroups(data, manifest)) add(`group:${group}`, `dependency-groups.${group}`, list);
  return requirements;
}

/** The command that reviews the dependencies and writes the review record. */
export const UPDATE = 'make dependency-review UPDATE=1';

/** The key of a dependency in the policy and the record. */
export const dependencyKey = ({ ecosystem, manifest, package: name }: { ecosystem: string; manifest: string; package: string }) => `${ecosystem}:${manifest}:${name}`;

/**
 * An entry of advisoryExceptions of the policy: an advisory of a package of a lock that no release fixes, accepted with its
 * reason until its removal condition holds. The review and the gate print an accepted advisory, never pass it in silence.
 */
export type AdvisoryException = { lock: string; package: string; advisory: string; reason: string; removalCondition: string };

/** The key of the advisory `id` of the package `name` of `lock`. */
export const advisoryKey = (lock: string, name: string, id: string) => `${lock} ${name} ${id}`;

/** Whether `exception` names its lock, package, advisory, reason and removal condition, each as text that is not blank. */
export const completeAdvisoryException = (exception: Record<string, unknown>): exception is AdvisoryException =>
  ['lock', 'package', 'advisory', 'reason', 'removalCondition'].every(field => typeof exception[field] === 'string' && exception[field].trim() !== '');

/** The complete advisory exceptions of `policy` by advisoryKey; an incomplete one accepts nothing and the gate names it. */
export const advisoryExceptions = (policy: { advisoryExceptions?: Record<string, unknown>[] }): Map<string, AdvisoryException> =>
  new Map((policy.advisoryExceptions ?? []).filter(completeAdvisoryException).map(exception => [advisoryKey(exception.lock, exception.package, exception.advisory), exception]));

/** The text that names an advisory as accepted by `exception`, with its reason and removal condition. */
export const acceptedText = (exception: AdvisoryException) => `is accepted by advisoryExceptions of ${POLICY}: ${exception.reason}; remove it when ${exception.removalCondition}`;

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
 * The direct requirements of the go.mod `file` of `root` as { module, version }, as `go mod edit -json` reads them: the
 * requirements that are not indirect, except a module that a replace directive points to a directory (a replacement without a
 * version), which is a package of this repository.
 */
export function goRequirements(root: string, file: string) {
  const mod = readGoMod(root, file, process.env);
  // go mod edit -json leaves out Require and Replace when the go.mod has none.
  const replaced = new Set((mod.Replace ?? []).filter(item => item.New.Version === undefined).map(item => item.Old.Path));
  return (mod.Require ?? []).filter(item => !item.Indirect && !replaced.has(item.Path)).map(item => ({ module: item.Path, version: item.Version }));
}

/** The Cargo locks of the checkout: every Cargo.lock that is tracked or new and not ignored. */
export const cargoLocks = (root: string): string[] => checkedFiles(root).filter(file => path.posix.basename(file) === 'Cargo.lock');

// A PEP 751 lock is pylock.toml or pylock.<name>.toml.
const PYLOCK = /^pylock(\.[A-Za-z0-9_-]+)?\.toml$/;
const LOCK_ECOSYSTEMS: Record<string, string> = { 'package-lock.json': 'npm', 'composer.lock': 'composer', [LINK_LOCK]: 'composer', 'Cargo.lock': 'cargo', 'go.sum': 'go' };

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
 * package.json of each workspace directory. `directory` is relative to `base`, `manifest` to the checkout. As npm reads
 * `workspaces` (@npmcli/map-workspaces), each entry is a path or a glob of directories that hold a package.json, matched in
 * order: an entry that starts with ! removes the directories that it matches. The directories are those of the checked files.
 */
export function npmManifests(root: string, base = '.') {
  const own = path.posix.join(base, NPM_MANIFEST);
  const manifest = readNpmManifest(root, own);
  const directories = checkedFiles(root)
    .filter(file => path.posix.basename(file) === NPM_MANIFEST)
    .map(file => path.posix.relative(base, path.posix.dirname(file)))
    .filter(directory => directory !== '' && !directory.startsWith('..'));
  const selected = new Set<string>();
  for (const entry of manifest.workspaces ?? []) {
    const negated = entry.startsWith('!');
    const pattern = path.posix.normalize(negated ? entry.slice(1) : entry).replace(/\/+$/, '');
    const matches = picomatch(pattern);
    for (const directory of directories.filter(candidate => matches(candidate))) {
      if (negated) selected.delete(directory);
      else selected.add(directory);
    }
  }
  const workspaces = [...selected].sort();
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
    const lock = readNpmLock(root, lockPath);
    npmLocks.set(lockPath, lock);
    locks.push(lockPath);
    // A package that the overrides of the npm project install from a URL (a release archive) is not in the registry: it has no review.
    const urlOverrides = new Set(Object.entries(readNpmManifest(root, path.posix.join(base, NPM_MANIFEST)).overrides ?? {}).filter(([, value]) => typeof value === 'string' && URL_SPEC.test(value)).map(([name]) => name));
    for (const { directory, manifest: manifestPath } of npmManifests(root, base)) {
      manifests.push({ directory, manifest: manifestPath, lock: lockPath });
      const manifest = readNpmManifest(root, manifestPath);
      for (const kind of ['dependencies', 'devDependencies'] as const) {
        for (const [name, spec] of Object.entries(manifest[kind] ?? {})) {
          const entry = npmLockEntry(lock, directory, name);
          if (LOCAL_SPEC.test(spec) || entry?.link) {
            const target = entry?.link ? entry.resolved : null;
            const packageDirectory = target ? path.posix.join(base, target) : null;
            const lockVersion = target ? lock.packages?.[target]?.version ?? null : null;
            const targetManifest = packageDirectory && existsSync(path.join(root, packageDirectory, NPM_MANIFEST)) ? readNpmManifest(root, `${packageDirectory}/${NPM_MANIFEST}`) : null;
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

  for (const { manifest: manifestPath } of policy.composerPlatforms) {
    const lockPath = path.posix.join(path.posix.dirname(manifestPath), 'composer.lock');
    locks.push(lockPath);
    // The project's files are the ones that every rule judges (K326-2): while linked, the link manifest and the link lock that Composer
    // resolved and the vendor holds, since the tracked lock cannot relock while a provider is linked (K326-1).
    const judged = judgedComposerFiles(root, path.posix.dirname(manifestPath));
    // K490: the declarations are the tracked manifest's (the review record names what the tracked manifest declares); the link manifest is
    // local install state, so it only decides the versions of the lock below.
    const composer = readComposerManifest(root, manifestPath);
    const composerLock = readComposerLock(root, judged.lock);
    const locked = new Map([...(composerLock.packages ?? []), ...(composerLock['packages-dev'] ?? [])].map(item => [item.name, item]));
    // A path dist of the repository has a url relative to the project; the link lock records a provider that the link installs with
    // the absolute folder of its checkout, which is a linked dependency, judged by its link (K358).
    const own = (entry: ComposerPackage | undefined): entry is Required<ComposerPackage> => entry?.dist?.type === 'path' && !path.isAbsolute(entry.dist.url);
    for (const kind of ['require', 'require-dev'] as const) {
      for (const [name, spec] of Object.entries(composer[kind] ?? {})) {
        if (PLATFORM_REQUIREMENT.test(name)) continue;
        const entry = locked.get(name);
        if (own(entry)) {
          local.push({ ecosystem: 'composer', manifest: manifestPath, package: name, spec, kind, directory: entry.dist.url, lockVersion: entry.version, version: spec, name });
          continue;
        }
        dependencies.push({ ecosystem: 'composer', manifest: manifestPath, package: name, kind, spec, version: entry?.version ?? null, lock: lockPath });
      }
    }
    // The packages that a path repository of the root provides, which the lock records as path dist entries, are published
    // with their own requirements: those are first-party requirements of the root too, at the versions of the root lock
    // (K168). The package commits no lock; a requirement that is itself a path package is a package of this repository.
    for (const item of [...locked.values()].filter(entry => own(entry))) {
      const packageManifest = path.posix.join(path.posix.dirname(manifestPath), present(item.dist?.url, `the path of ${item.name}`), 'composer.json');
      for (const [name, spec] of Object.entries(readComposerManifest(root, packageManifest).require ?? {})) {
        if (PLATFORM_REQUIREMENT.test(name) || own(locked.get(name))) continue;
        dependencies.push({ ecosystem: 'composer', manifest: packageManifest, package: name, kind: 'require', spec, version: locked.get(name)?.version ?? null, lock: lockPath });
      }
    }
  }
  // Each Python lock named by the policy is recorded with its sha256; its packages are read by the lock format (K36).
  // Each PEP 751 lock of the policy: its registry packages are dependencies of the lock (kind `lock`), its git packages are pinned
  // by their commit and recorded with it. A lock whose packages are not read fails in readPylock with the line of the construct.
  for (const { lock: lockPath } of policy.pythonLocks) {
    locks.push(lockPath);
    const lock: Pylock = readPylock(readFileSync(path.join(root, lockPath), 'utf8'), lockPath);
    pythonLocks.push({ lock: lockPath, createdBy: lock.createdBy, packages: lock.packages });
    for (const item of lock.packages) {
      if (item.kind === 'registry') {
        dependencies.push({ ecosystem: 'pypi', manifest: lockPath, package: item.name, kind: 'lock', spec: `==${item.version}`, version: item.version, lock: lockPath, createdBy: lock.createdBy });
      } else if (item.kind === 'vcs' && item.vcs.commitId !== null) {
        vcs.push({ lock: lockPath, package: item.name, url: item.vcs.url, requestedRevision: item.vcs.requestedRevision, commitId: item.vcs.commitId });
      }
    }
  }
  for (const manifestPath of policy.pythonManifests) {
    const text = readFileSync(path.join(root, manifestPath), 'utf8');
    for (const requirement of pythonRequirements(text, manifestPath)) {
      dependencies.push({ ecosystem: 'pypi', manifest: manifestPath, ...requirement, lock: null });
    }
  }
  // The ruff of mise.toml is a PyPI release that the review checks like a requirement of a manifest.
  const ruff = declaredMiseTools(root).ruff;
  if (ruff) dependencies.push({ ecosystem: 'pypi', manifest: TOOLCHAIN, package: 'ruff', kind: 'toolchain', spec: `==${ruff.version}`, version: ruff.version, lock: null });
  // The module paths of each go.work: a requirement of a member module is a package of this repository, resolved from the
  // workspace, so it is no registry dependency and needs no go.sum.
  const workspaces = new Map<string, Set<string>>();
  const members = (manifestPath: string): Set<string> => {
    const file = goWorkFile(root, path.posix.dirname(manifestPath), process.env);
    if (file === null) return new Set();
    if (!workspaces.has(file)) {
      const used = (readGoWork(root, file, process.env).Use ?? []).map(use => path.relative(root, path.resolve(path.dirname(file), use.DiskPath, 'go.mod')));
      workspaces.set(file, new Set(used.map(mod => readGoMod(root, mod, process.env).Module.Path)));
    }
    // The line above sets the file.
    return present(workspaces.get(file), 'workspaces.get(file)');
  };
  for (const manifestPath of goModules(root)) {
    const workspace = members(manifestPath);
    const requirements = goRequirements(root, manifestPath).filter(item => !workspace.has(item.module));
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

// The range of an npm specification without its alias prefix: `npm:<name>@<range>` names the range of another package.
const npmRange = (range: string) => semver.validRange(String(range).replace(/^npm:(?:@[^/@]+\/)?[^@]+@/, '').trim());

/** Whether `version` satisfies the npm range `range` by semver; null for a version or a specification that semver does not read. */
export function npmSatisfies(version: string | undefined, range: string) {
  const parsed = semver.valid(version ?? null);
  const sets = npmRange(range);
  return parsed === null || sets === null ? null : semver.satisfies(parsed, sets);
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
        if (!copy || present(packages[copy], 'packages[copy]').link || !semver.valid(present(packages[copy], 'packages[copy]').version ?? null) || !npmRange(range)) continue;
        if (!copies.has(name)) copies.set(name, new Map());
        // The line above sets every missing name.
        const loaders = present(copies.get(name), 'copies.get(name)');
        if (!loaders.has(copy)) loaders.set(copy, []);
        // The line above sets every missing copy.
        present(loaders.get(copy), 'loaders.get(copy)').push({ range, from: location === '' ? 'the root' : location });
      }
    }
  }
  const lines: string[] = [];
  for (const name of [...copies.keys()].sort()) {
    // name is a key of copies, and each copy is a location of packages.
    const located = [...present(copies.get(name), 'copies.get(name)')].map(([copy, loaders]) => ({ version: present(packages[copy], 'packages[copy]').version, loaders }));
    const found = located.flatMap((left, index) => located.slice(index + 1).map((right): [typeof left, typeof left] => [left, right]))
      .filter(([left, right]) => left.version !== right.version)
      .map(([left, right]) => {
        // copies holds only copies whose version semver reads, and the sorted pair has two entries.
        const [low, high] = semver.compare(present(left.version, 'the version of a copy'), present(right.version, 'the version of a copy')) <= 0 ? [left, right] : [right, left];
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
