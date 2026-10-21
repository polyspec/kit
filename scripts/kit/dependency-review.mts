#!/usr/bin/env node
// The dependency review: `make dependency-review`, a developer command that no check and no gating CI job runs. It
// asks the registries for the latest stable release of every registry dependency (scripts/kit/dependency-state.mts
// defines them) that its publisher has not deprecated, and for the advisories of every lock, and reports each newer
// stable release without an exception, each stale exception and each advisory with its fix, one line each; it fails
// when there is one.
//
//   node scripts/kit/dependency-review.mts [--root <checkout>] [--record] [--update] [--targets <file>]
//
// --record writes what it reviewed to config/dependency-review.json: the time, the sha256 and the advisories of every
// lock, and the locked and latest stable version of every registry dependency. The gate scripts/kit/check-dependency-policy.mts
// compares the checkout with that record without a network.
// --update first raises every newer dependency without an exception to its latest stable release, keeping the range
// operator of its manifest, and updates the packages with an advisory; `npm dedupe` then installs one version of each
// npm package that one version satisfies, since an install for one workspace keeps the release of the root; then it
// reviews and records again.
// The advisories of the Cargo locks come from the cargo-audit of mise.toml (its shim, mise-tools.mts; `make install-tools`
// installs it) and the RustSec advisory database, and those of the Go locks from the govulncheck of mise.toml. A PyPI dependency is pinned exactly in its pyproject.toml,
// and `--update` sets the pin of a newer release with scripts/kit/pin-python-dependency.mts.
// --targets <file> (K435) names the version of each dependency that the batch takes: a JSON file of the snapshot moment of the
// registries and of the versions by ecosystem (dependency-targets.schema.json). Each named dependency is judged against its target,
// which the registry must hold as a stable release, and `--update` moves it to exactly that version; the others are reviewed as before,
// and `--update` moves none of them. With --record the review moment is the snapshot moment.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { explain, rcompare as pep440Descending, valid as pep440Valid } from '@renovatebot/pep440';
import semver from 'semver';
import { POLICY, RECORD, TOOLCHAIN, UPDATE, acceptedText, advisoryExceptions, advisoryKey, dependencyKey, goPackagePatterns, lockEcosystem, lockFix, readPolicy, readState, advisoryRelease } from './dependency-state.mts';
import type { Dependency, DependencyPolicy } from './dependency-state.mts';
import { composerCommand, composerEnvironment as toolEnvironment } from './install-composer-project.mts';
import { toolCommand } from './mise-tools.mts';
import { MISE_TOOLS } from './toolchain-mise.mts';
import { ConfigError, parseJson, readJsonFile } from './schema-validate.mts';
import { readComposerLock } from './manifests.mts';
import { isMain, repositoryRoot, siblingTool } from './paths.mts';
import { Stop, run as runCommand } from './process.mts';
import { fileDigest } from './bootstrap/digest.mts';
import { isJsonObject, writeJson } from './bootstrap/files.mts';
import { linkGit, providers, siblingCheckouts } from './link-providers.mts';
import { isPrerelease, isVersionText, older, stableDescending } from './version.mts';
import { isLinked } from './linked-package.mts';
import { LINK_MANIFEST, judgedComposerFiles } from './composer-project.mts';
import { present } from './present.mts';
import { checkedFiles } from './tracked-files.mts';

// npm audit reports these severities; the reviewed severity is moderate. Composer audit reports every advisory.
const NPM_SEVERITIES = new Set(['moderate', 'high', 'critical']);
// The tools of the plan that run from the checkout, its wrappers in var/tools/bin, never the ones on PATH (K393-1).
const CHECKOUT_TOOLS = new Set(['npm', 'go', 'composer', 'node']);
// The command of a tool of the checkout, or the message that names it as missing (toolCommand): it is reported for the lock
// whose advisory check needs it, so the review of the other locks goes on (K393-1).
const checkoutTool = (root: string, name: string): { command: string; error?: undefined } | { command?: undefined; error: string } => {
  try {
    return { command: toolCommand(root, name) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
};
const say = (text: string) => process.stdout.write(`[dependency-review] ${text}\n`);

/** The state of readState (dependency-state.mts), with the fields that the review reads. */
interface ReviewState {
  dependencies: Dependency[];
  locks: string[];
  npmLocks: Map<string, { packages?: Record<string, { version?: string }> }>;
  pythonLocks: { lock: string; createdBy: string | null; packages: { kind: string; name: string; version: string }[] }[];
  vcs: { lock: string; package: string; url: unknown; requestedRevision: unknown; commitId: unknown }[];
}

/** An advisory of a package of a lock. */
export interface Advisory {
  package: string;
  /** The version that the lock holds; an npm advisory of a package that the lock holds only nested has its range instead. */
  version?: string | undefined;
  range?: string | undefined;
  id: string;
  severity: string;
  title: string;
  url?: string | undefined;
}

/** An advisory of the review with its lock. */
export type FoundAdvisory = Advisory & { lock: string };

/** A dependency with a newer stable release; its release is undefined when its query failed with an empty message. */
export type Newer = Dependency & { latest: string | null | undefined };

/** The targets of --targets: the moment of the registry snapshot, the file that names them, and the version of each package by ecosystem. */
export interface Targets { file: string; snapshot: string; versions: Record<string, Record<string, string>> }

/** The fields of a newer dependency and of an advisory that updatePlan reads. */
type PlannedDependency = Pick<Newer, 'ecosystem' | 'manifest' | 'package' | 'spec' | 'latest'> & Partial<Pick<Newer, 'kind' | 'lock'>>;
type PlannedAdvisory = Pick<FoundAdvisory, 'lock' | 'package'>;

/**
 * The SARIF report of govulncheck (`-format sarif`), with the fields that the review reads: a rule for each vulnerability
 * that the scan found, and a result for each, whose code flows exist when the code calls the vulnerable function. The last
 * location of a code flow is the vulnerable function, and its `module` is `<module>@<version>`.
 */
export interface GovulncheckSarif {
  version?: string;
  runs: {
    tool: { driver: { name?: string; rules?: { id: string; fullDescription?: { text: string } }[] } };
    results?: { ruleId: string; codeFlows?: { threadFlows: { locations: { module?: string }[] }[] }[] }[];
  }[];
}

// The output of a command, or the message of its failure; a message is never empty.
type Ran = { stdout: string; error?: undefined } | { error: string; stdout?: undefined };
// The JSON that a command prints, or the message of its failure; a message is never empty.
type Answer<T> = { value: T; error?: undefined } | { error: string; value?: undefined };
// The latest stable release of a dependency, or the message of the failure of its query; a message is never empty.
// `upToDate` is the judgement of composer outdated (its latest-status); kit compares the versions of the other ecosystems.
type Latest = { latest: string | null; upToDate?: boolean; error?: undefined } | { error: string; latest?: undefined; upToDate?: undefined };
// The advisories of a lock, or the message of the failure of its query; a message is never empty.
// A failed Go scan carries the fix of its own cause, when it has one (K365).
type Audit = { advisories: Advisory[]; error?: undefined } | { error: string; fix?: string; advisories?: undefined };

// The JSON of npm view, npm audit, go list -m, PyPI, composer outdated, cargo audit and composer audit, with the fields
// that the review reads.
interface NpmView { 'dist-tags'?: { latest?: string }; versions?: string | string[] }
interface NpmVia { severity: string; source?: number; url: string; title: string }
interface NpmAudit { vulnerabilities?: Record<string, { range: string; via?: (string | NpmVia)[] }> }
interface GoVersions { Versions?: string[] }
interface PypiProject { releases?: Record<string, unknown[]> }
interface PypiRelease { vulnerabilities?: { id: string; summary?: string; link?: string }[] }
interface ComposerOutdated { locked?: { name: string; latest?: string; 'latest-status'?: string }[] }
interface CargoPackage { name: string; version: string }
interface CargoAudit {
  vulnerabilities?: { list?: { package: CargoPackage; advisory: { id: string; cvss?: string | null; title: string; url?: string | null } }[] };
  warnings?: Record<string, { package: CargoPackage; advisory?: { id: string; title: string; url?: string | null } | null }[]>;
}
interface ComposerAdvisory { advisoryId: string | number; severity?: string | null; title: string; link: string }
// PHP encodes an empty map as an empty list.
interface ComposerAudit { advisories?: Record<string, ComposerAdvisory[] | Record<string, ComposerAdvisory>> | []; abandoned?: Record<string, string | null> | [] }
// The metadata of a Composer package in Packagist: each release, with the PHP that it requires.
interface PackagistPackage { packages: Record<string, { version: string; require?: { php?: string } }[]> }

function run(command: string, args: string[], cwd: string, statuses?: number[], env?: NodeJS.ProcessEnv): Ran {
  try {
    return { stdout: runCommand(command, args, { cwd, statuses, env }) };
  } catch (error) {
    if (!(error instanceof Stop)) throw error;
    return { error: error.message };
  }
}

// The JSON that `command` prints as T, the type that the schema file `schema` describes, or { error }. An empty output is an
// error, unless `empty` is the documented answer of the command that prints nothing.
function query<T>(schema: string, command: string, args: string[], cwd: string, statuses?: number[], empty?: T, env?: NodeJS.ProcessEnv): Answer<T> {
  const result = run(command, args, cwd, statuses, env);
  if (result.error !== undefined) return result;
  if (!result.stdout.trim()) return empty === undefined ? { error: `${command} ${args.join(' ')} printed no JSON: the output is empty` } : { value: empty };
  try {
    return { value: parseJson<T>(result.stdout, schema, `${command} ${args.join(' ')}`) };
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    return { error: error.message };
  }
}

/**
 * The environment of a Composer command in `directory` of `root` (K340): while the project is linked (composer.link.lock exists),
 * Composer reads composer.link.json and its lock, as the policy judges them (K326), so the review never resolves a linked polyspec
 * package from its zip, never changes the tracked composer.json and composer.lock, and never reinstalls the vendor from them.
 */
export function composerEnvironment(root: string, directory: string): NodeJS.ProcessEnv | undefined {
  return judgedComposerFiles(root, directory).linked ? { ...process.env, COMPOSER: LINK_MANIFEST } : undefined;
}

/** The latest dist-tag and the versions of an npm package, from npm view: { value } or { error }. */
function npmView(root: string, name: string): Answer<{ tag: string | undefined; versions: string[] }> {
  const answer = query<NpmView | NpmView[]>('npm-view.schema.json', toolCommand(root, 'npm'), ['view', name, 'dist-tags', 'versions', '--json'], root);
  if (answer.error !== undefined) return answer;
  const value = answer.value;
  // npm 12 prints the fields of the one matching package as an array of one object.
  const view = Array.isArray(value) ? value[0] ?? {} : value;
  const versions = Array.isArray(view.versions) ? view.versions : [view.versions].filter((version): version is string => Boolean(version));
  return { value: { tag: view['dist-tags']?.latest, versions } };
}

/** The latest stable npm release of `name` that its publisher has not deprecated: { latest } or { error }. */
function npmLatest(root: string, name: string): Latest {
  const answer = npmView(root, name);
  if (answer.error !== undefined) return answer;
  const { tag, versions } = answer.value;
  const candidates = stableDescending('npm', versions).filter((version: string) => !tag || isPrerelease('npm', tag) || !older('npm', tag, version));
  for (const version of candidates) {
    const deprecated = run(toolCommand(root, 'npm'), ['view', `${name}@${version}`, 'deprecated'], root);
    if (deprecated.error !== undefined) return deprecated;
    if (!deprecated.stdout.trim()) return { latest: version };
  }
  return { error: `npm view ${name} reported no stable release that is not deprecated` };
}

/** The target version of an npm package, when the registry holds it as a stable release that its publisher has not deprecated. */
function npmTarget(root: string, name: string, version: string): Latest {
  const answer = npmView(root, name);
  if (answer.error !== undefined) return answer;
  if (!stableDescending('npm', answer.value.versions).includes(version)) return { error: `npm has no stable release ${version} of ${name}` };
  const deprecated = run(toolCommand(root, 'npm'), ['view', `${name}@${version}`, 'deprecated'], root);
  if (deprecated.error !== undefined) return deprecated;
  return deprecated.stdout.trim() ? { error: `npm release ${version} of ${name} is deprecated` } : { latest: version };
}

/** The target version of a Go module, when the registry holds it as a stable release. */
function goTarget(root: string, name: string, version: string, directory: string): Latest {
  const answer = query<GoVersions>('go-versions.schema.json', toolCommand(root, 'go'), ['list', '-m', '-versions', '-json', name], path.join(root, directory));
  if (answer.error !== undefined) return { error: answer.error };
  return stableDescending('go', answer.value.Versions ?? []).includes(version) ? { latest: version } : { error: `go list -m -versions has no stable release ${version} of ${name}` };
}

/** The target version of a PyPI project, when the registry holds it as a stable release with files. */
function pypiTarget(root: string, name: string, version: string): Latest {
  const answer = query<PypiProject>('pypi-project.schema.json', 'curl', ['-fsSL', `https://pypi.org/pypi/${name}/json`], root);
  if (answer.error !== undefined) return { error: answer.error };
  const files = answer.value.releases?.[version];
  return files !== undefined && highestStableRelease({ [version]: files }) === version ? { latest: version } : { error: `PyPI has no stable release ${version} of ${name}` };
}

/**
 * The target version of a Composer package, when Packagist holds it as a stable release whose PHP requirement the PHP platform of its
 * lock directory satisfies (`php`, the platform of config/dependency-policy.json).
 */
function composerTarget(root: string, name: string, version: string, php: string | undefined): Latest {
  const answer = query<PackagistPackage>('packagist-package.schema.json', 'curl', ['-fsSL', `https://repo.packagist.org/p2/${name}.json`], root);
  if (answer.error !== undefined) return { error: answer.error };
  const bare = version.replace(/^v/, '');
  const release = (answer.value.packages[name] ?? []).find(item => item.version.replace(/^v/, '') === bare);
  if (release === undefined) return { error: `Packagist has no release ${version} of ${name}` };
  if (!/^\d+(\.\d+)*$/.test(bare)) return { error: `${version} of ${name} is no stable release` };
  const requirement = release.require?.php;
  if (php !== undefined && requirement !== undefined) {
    // Composer joins the constraints that a comma separates, as semver joins those that a space separates.
    const range = requirement.replace(/,/g, ' ');
    if (semver.validRange(range) === null) return { error: `${name} ${version} requires php ${requirement}, which the review does not read` };
    if (!semver.satisfies(php, range)) return { error: `${name} ${version} requires php ${requirement}, and the platform of the policy is php ${php}` };
  }
  return { latest: version };
}

/** The verdict on the target `version` of a dependency: the registry holds it as a stable release, or the failure that names it. */
function targetRelease(root: string, dependency: Dependency, version: string, platforms: Map<string, string>): Latest {
  if (dependency.ecosystem === 'npm') return npmTarget(root, dependency.package, version);
  if (dependency.ecosystem === 'go') return goTarget(root, dependency.package, version, path.posix.dirname(dependency.manifest));
  if (dependency.ecosystem === 'pypi') return pypiTarget(root, dependency.package, version);
  return composerTarget(root, dependency.package, version, platforms.get(path.posix.dirname(present(dependency.lock, 'dependency.lock'))));
}

/**
 * The highest release of a PyPI project that has files and is no pre-release or development release by PEP 440 (a post-release
 * is a release); releases: version -> files. A key that is no PEP 440 version is no release.
 */
export function highestStableRelease(releases: Record<string, unknown[]>): string | null {
  // version is a key of releases, and pep440Valid checked that it reads.
  const stable = Object.keys(releases).filter(version => present(releases[version], 'releases[version]').length > 0 && pep440Valid(version) !== null && !present(explain(version), 'explain(version)').is_prerelease);
  return stable.sort(pep440Descending)[0] ?? null;
}

/** The advisories of the vulnerabilities that the code calls, from the SARIF report of govulncheck, one per advisory and module. */
export function goAdvisories(report: GovulncheckSarif): Advisory[] {
  const seen = new Set<string>();
  const list: Advisory[] = [];
  for (const run of report.runs) {
    const titles = new Map((run.tool.driver.rules ?? []).map(rule => [rule.id, rule.fullDescription?.text]));
    for (const result of run.results ?? []) {
      // A result without a code flow is a vulnerability in a module or package that the code does not call.
      for (const flow of result.codeFlows ?? []) {
        const called = flow.threadFlows[0]?.locations.at(-1)?.module;
        if (!called) continue;
        const at = called.lastIndexOf('@');
        const [module, version] = [called.slice(0, at), called.slice(at + 1)];
        const key = `${result.ruleId}:${module}`;
        if (seen.has(key)) continue;
        seen.add(key);
        list.push({ package: module, version, id: result.ruleId, severity: 'vulnerability', title: titles.get(result.ruleId) ?? result.ruleId, url: `https://pkg.go.dev/vuln/${result.ruleId}` });
      }
    }
  }
  return list;
}

/** The latest stable release of every registry dependency: key -> { latest } or { error }. */
function latestReleases(root: string, state: ReviewState, targets: Targets | undefined, platforms: Map<string, string>): Map<string, Latest> {
  const latest = new Map<string, Latest>();
  const npm = new Map<string, Latest>();
  const composer = new Map<string, Answer<ComposerOutdated>>();
  for (const dependency of state.dependencies) {
    const key = dependencyKey(dependency);
    // A linked package is judged by its link, and the comparison with its latest release belongs to the batch release (K328, K340).
    if (isLinked(root, dependency.ecosystem, dependency.lock, dependency.package)) {
      latest.set(key, { latest: present(dependency.version, 'dependency.version') });
      continue;
    }
    // A dependency that the targets name is judged against its target version, which the registry must hold as a stable release.
    const target = targets?.versions[dependency.ecosystem]?.[dependency.package];
    if (target !== undefined) {
      latest.set(key, targetRelease(root, dependency, target, platforms));
      continue;
    }
    if (dependency.ecosystem === 'npm') {
      if (!npm.has(dependency.package)) npm.set(dependency.package, npmLatest(root, dependency.package));
      // The line above sets the package.
      latest.set(key, present(npm.get(dependency.package), 'npm.get(dependency.package)'));
      continue;
    }
    if (dependency.ecosystem === 'go') {
      const directory = path.posix.dirname(dependency.manifest);
      const answer = query<GoVersions>('go-versions.schema.json', toolCommand(root, 'go'), ['list', '-m', '-versions', '-json', dependency.package], path.join(root, directory));
      if (answer.error !== undefined) {
        latest.set(key, { error: answer.error });
        continue;
      }
      // go list leaves out Versions for a module without a tagged release.
      const stable = stableDescending('go', answer.value.Versions ?? [])[0];
      latest.set(key, stable ? { latest: stable } : { error: `go list -m -versions reported no stable release of ${dependency.package}` });
      continue;
    }
    if (dependency.ecosystem === 'pypi') {
      const answer = query<PypiProject>('pypi-project.schema.json', 'curl', ['-fsSL', `https://pypi.org/pypi/${dependency.package}/json`], root);
      if (answer.error !== undefined) {
        latest.set(key, { error: answer.error });
        continue;
      }
      const stable = highestStableRelease(answer.value.releases ?? {});
      latest.set(key, stable ? { latest: stable } : { error: `PyPI reported no stable release of ${dependency.package}` });
      continue;
    }
    // readState gives every Composer dependency the lock of its root.
    const directory = path.posix.dirname(present(dependency.lock, 'dependency.lock'));
    // composer outdated reports the latest stable release of every locked package, once for each root, and the review keeps
    // the first-party requirements: those of the root and of the packages of its path repositories (K168), which --direct,
    // the requirements of the root alone, would miss. composer audit reports an abandoned package.
    if (!composer.has(directory)) composer.set(directory, query<ComposerOutdated>('composer-outdated.schema.json', toolCommand(root, 'composer'), ['outdated', '--locked', '--all', '--format=json', '--no-interaction'], path.join(root, directory), undefined, undefined, composerEnvironment(root, directory)));
    // The line above sets the directory.
    const answer = present(composer.get(directory), 'composer.get(directory)');
    if (answer.error !== undefined) {
      latest.set(key, { error: answer.error });
      continue;
    }
    const entry = (answer.value.locked ?? []).find(item => item.name === dependency.package);
    if (!entry?.latest || !isVersionText(entry.latest) || !entry['latest-status']) latest.set(key, { error: `composer outdated in ${directory} reported no release of ${dependency.package}` });
    else latest.set(key, { latest: entry.latest, upToDate: entry['latest-status'] === 'up-to-date' });
  }
  return latest;
}

/**
 * The import paths of the packages of the Go module of `lock` that govulncheck scans, or { error }: the packages of
 * goPackagePatterns that have a buildable file, by `go list -e`. A directory whose every file a build constraint excludes
 * is no package for `./...`, and govulncheck refuses it as a pattern, so it is dropped here.
 */
export function goPackages(root: string, lock: string, env?: NodeJS.ProcessEnv): { list: string[]; error?: undefined } | { error: string; list?: undefined } {
  const patterns = goPackagePatterns(root, lock);
  if (patterns.length === 0) return { list: [] };
  const answer = run(toolCommand(root, 'go'), ['list', '-e', '-f', '{{if or .GoFiles .TestGoFiles .XTestGoFiles}}{{.ImportPath}}{{end}}', ...patterns], path.join(root, path.posix.dirname(lock)), undefined, env);
  return answer.error !== undefined ? answer : { list: answer.stdout.split('\n').filter(Boolean) };
}

// The folders (of `root`) that the go.work `file` of `root` lists in its use directives. The text is read, not go work
// edit, so a scan needs no record of the go command for the file.
function goWorkUses(root: string, file: string): Set<string> {
  const uses = new Set<string>();
  let block = false;
  for (const raw of readFileSync(path.join(root, file), 'utf8').split('\n')) {
    const line = raw.replace(/\/\/.*$/, '').trim();
    let entry: string | undefined;
    if (block) {
      if (line === ')') block = false;
      else entry = line;
    } else if (line === 'use (') block = true;
    else entry = /^use\s+(.+)$/.exec(line)?.[1];
    if (entry) uses.add(path.posix.normalize(path.posix.join(path.posix.dirname(file), entry.replace(/^"(.*)"$/, '$1'))));
  }
  return uses;
}

// The environment of a Go scan of `lock` (K365, K418): GOWORK names the nearest go.work at or above the module, up to the work
// tree: the go.work beside its go.mod (which the link writes), else a tracked go.work whose use directives list the module. Without
// one the environment is the default.
function goScanEnvironment(root: string, lock: string): NodeJS.ProcessEnv | undefined {
  const module = path.posix.dirname(lock);
  const tracked = new Set(checkedFiles(root));
  for (let directory = module; ; directory = path.posix.dirname(directory)) {
    if (directory === module && existsSync(path.join(root, directory, 'go.work'))) return { ...process.env, GOWORK: path.join(root, directory, 'go.work') };
    const file = path.posix.join(directory, 'go.work');
    if (tracked.has(file) && goWorkUses(root, file).has(module)) return { ...process.env, GOWORK: path.join(root, file) };
    if (directory === '.') return undefined;
  }
}

// The fix of a failed Go scan: the output of the scan names the cause, which a module that does not compile has in its code or link.
const GO_SCAN_FIX = 'correct the cause that the output of the scan names (a module that does not compile is fixed in its code or its link), then run make dependency-review again';

/** The advisories of every lock: lock -> { advisories } or { error }. Each npm lock is audited in the directory it lies in. */
function advisories(root: string, state: ReviewState): Map<string, Audit> {
  const result = new Map<string, Audit>();
  // The value of `answer` for `lock`, or undefined once its error is the result of the lock.
  const answered = <T,>(lock: string, answer: Answer<T>): T | undefined => {
    if (answer.error === undefined) return answer.value;
    result.set(lock, { error: answer.error });
    return undefined;
  };
  for (const lock of state.locks.filter(item => lockEcosystem(item) === 'npm')) {
    // readState holds the lock of each npm lock.
    const npmVersions = present(state.npmLocks.get(lock), 'state.npmLocks.get(lock)').packages ?? {};
    const npm = query<NpmAudit>('npm-audit.schema.json', toolCommand(root, 'npm'), ['audit', '--json', '--package-lock-only'], path.join(root, path.posix.dirname(lock)), [0, 1]);
    if (npm.error !== undefined) result.set(lock, { error: npm.error });
    else {
      const list: Advisory[] = [];
      for (const [name, vulnerability] of Object.entries(npm.value.vulnerabilities ?? {})) {
        for (const via of vulnerability.via ?? []) {
          if (typeof via !== 'object' || !NPM_SEVERITIES.has(via.severity)) continue;
          const version = npmVersions[`node_modules/${name}`]?.version;
          list.push({ package: name, ...(version !== undefined ? { version } : { range: vulnerability.range }), id: String(via.source ?? via.url), severity: via.severity, title: via.title, url: via.url });
        }
      }
      result.set(lock, { advisories: list });
    }
  }
  // cargo-audit reads the RustSec advisory database from a clone in .tools; the first lock fetches it.
  let fetched = false;
  for (const lock of state.locks.filter(item => lockEcosystem(item) === 'cargo')) {
    const tool = checkoutTool(root, MISE_TOOLS.cargoAudit.command);
    const args: string[] = ['audit', '--db', path.join(root, 'var', 'tools', 'rustsec-advisory-db'), ...(fetched ? ['--no-fetch'] : []), '--file', path.join(root, lock), '--json'];
    // cargo-audit exits with 1 when it finds a vulnerability.
    const answer: Answer<CargoAudit> = tool.error !== undefined ? { error: tool.error } : query<CargoAudit>('cargo-audit.schema.json', tool.command, args, root, [0, 1]);
    fetched ||= !answer.error;
    const value = answered(lock, answer);
    if (value === undefined) continue;
    const list: Advisory[] = [];
    for (const item of value.vulnerabilities?.list ?? []) {
      list.push({ package: item.package.name, version: item.package.version, id: item.advisory.id, severity: item.advisory.cvss ? `vulnerability ${item.advisory.cvss}` : 'vulnerability', title: item.advisory.title, url: item.advisory.url ?? `https://rustsec.org/advisories/${item.advisory.id}` });
    }
    // The warnings are unmaintained, unsound and yanked crates.
    for (const [kind, warnings] of Object.entries(value.warnings ?? {})) {
      for (const warning of warnings) {
        list.push({ package: warning.package.name, version: warning.package.version, id: warning.advisory?.id ?? kind, severity: kind, title: warning.advisory?.title ?? `${kind} release`, ...(warning.advisory ? { url: warning.advisory.url ?? `https://rustsec.org/advisories/${warning.advisory.id}` } : {}) });
      }
    }
    result.set(lock, { advisories: list });
  }
  // A PEP 751 lock: the advisories of each registry package at its locked version, from the PyPI release JSON.
  for (const lock of state.locks.filter(item => lockEcosystem(item) === 'pypi')) {
    const list: Advisory[] = [];
    let failure: string | null = null;
    // readState holds each Python lock of the locks in pythonLocks.
    for (const item of present(state.pythonLocks.find(entry => entry.lock === lock), 'state.pythonLocks.find(entry => entry.lock === lock)').packages.filter(entry => entry.kind === 'registry')) {
      const answer = query<PypiRelease>('pypi-release.schema.json', 'curl', ['-fsSL', `https://pypi.org/pypi/${item.name}/${item.version}/json`], root);
      if (answer.error !== undefined) {
        failure = answer.error;
        break;
      }
      for (const vulnerability of answer.value.vulnerabilities ?? []) {
        list.push({ package: item.name, version: item.version, id: vulnerability.id, severity: 'vulnerability', title: vulnerability.summary ?? vulnerability.id, url: vulnerability.link ?? `https://osv.dev/vulnerability/${vulnerability.id}` });
      }
    }
    result.set(lock, failure ? { error: failure } : { advisories: list });
  }
  for (const lock of state.locks.filter(item => lockEcosystem(item) === 'go')) {
    const tool = checkoutTool(root, MISE_TOOLS.govulncheck.command);
    if (tool.error !== undefined) {
      result.set(lock, { error: tool.error });
      continue;
    }
    const command = tool.command;
    const env = goScanEnvironment(root, lock);
    const packages = goPackages(root, lock, env);
    if (packages.error !== undefined) {
      result.set(lock, { error: packages.error, fix: GO_SCAN_FIX });
      continue;
    }
    const list = packages.list;
    // A module with no buildable package calls no vulnerable function, and govulncheck refuses an empty pattern list.
    if (list.length === 0) {
      result.set(lock, { advisories: [] });
      continue;
    }
    const answer = run(command, ['-format', 'sarif', ...list], path.join(root, path.posix.dirname(lock)), undefined, env);
    if (answer.error !== undefined) {
      result.set(lock, { error: answer.error, fix: GO_SCAN_FIX });
      continue;
    }
    try {
      result.set(lock, { advisories: goAdvisories(parseJson<GovulncheckSarif>(answer.stdout, 'govulncheck-sarif.schema.json', `${command} -format sarif`)) });
    } catch (error) {
      if (!(error instanceof ConfigError)) throw error;
      result.set(lock, { error: error.message, fix: GO_SCAN_FIX });
    }
  }
  for (const lock of state.locks.filter(item => lockEcosystem(item) === 'composer')) {
    const directory = path.posix.dirname(lock);
    const lockData = readComposerLock(root, lock);
    const versions = new Map([...(lockData.packages ?? []), ...(lockData['packages-dev'] ?? [])].map(item => [item.name, item.version]));
    // composer audit sets bit 1 for an advisory and bit 2 for an abandoned package. For a lock without packages it prints
    // "No packages - skipping audit." to stderr and nothing to stdout (measured with Composer 2.10), which is no advisory.
    const answer = query<ComposerAudit>('composer-audit.schema.json', toolCommand(root, 'composer'), ['audit', '--locked', '--format=json', '--no-interaction'], path.join(root, directory), [0, 1, 2, 3], {}, composerEnvironment(root, directory));
    const value = answered(lock, answer);
    if (value === undefined) continue;
    const list: Advisory[] = [];
    for (const [name, entries] of Object.entries(value.advisories ?? {})) {
      for (const advisory of Object.values(entries)) list.push({ package: name, version: versions.get(name), id: String(advisory.advisoryId), severity: advisory.severity ?? 'unknown', title: advisory.title, url: advisory.link });
    }
    for (const [name, replacement] of Object.entries(value.abandoned ?? {})) {
      list.push({ package: name, version: versions.get(name), id: 'abandoned', severity: 'abandoned', title: replacement ? `abandoned, replaced by ${replacement}` : 'abandoned without a replacement' });
    }
    result.set(lock, { advisories: list });
  }
  return result;
}

/** The review of the checkout at `root`: the findings, the newer dependencies, the advisories and the record. */
export function review(root: string, targets?: Targets) {
  const policy = readPolicy<DependencyPolicy & { exceptions: { ecosystem: string; manifest: string; package: string; reason: string }[]; composerPlatforms: { manifest: string; php: string }[] }>(root);
  const exceptions = new Map<string, { reason: string }>(policy.exceptions.map(exception => [dependencyKey(exception), exception]));
  const state: ReviewState = readState(root, policy);
  // The PHP platform of each Composer lock directory, which a target of Composer must satisfy.
  const composerPlatforms: { manifest: string; php: string }[] = policy.composerPlatforms;
  const platforms = new Map(composerPlatforms.map(platform => [path.posix.dirname(platform.manifest), platform.php]));
  const latest = latestReleases(root, state, targets, platforms);
  const audits = advisories(root, state);
  const lines: string[] = [];
  const notes: string[] = [];
  const newer: Newer[] = [];
  const found: FoundAdvisory[] = [];
  // The subjects of the dependencies whose target the registry lacks.
  const failed: string[] = [];
  for (const dependency of state.dependencies) {
    const key = dependencyKey(dependency);
    const subject = `${dependency.manifest} ${dependency.package}`;
    const target = targets?.versions[dependency.ecosystem]?.[dependency.package];
    // latestReleases answers every dependency of the state.
    const answer = present(latest.get(key), 'latest.get(key)');
    if (answer.error !== undefined) {
      if (target !== undefined) {
        failed.push(subject);
        lines.push(`${subject}: the registry query failed: ${answer.error}. Fix: correct the target ${target} in ${present(targets, 'targets').file} to a stable release that the registry holds`);
        continue;
      }
      lines.push(`${subject}: the registry query failed: ${answer.error}. Fix: run make dependency-review again when the registry answers`);
      continue;
    }
    // A linked package is judged by its link, not against the registry (K328).
    if (isLinked(root, dependency.ecosystem, dependency.lock, dependency.package)) continue;
    // A dependency that its lock holds at no version is not at the latest release. A locked version above the latest release is
    // no newer release, though composer outdated reports update-possible for it: it is never a downgrade (K369).
    // A dependency that the targets name is outdated when it is not at its target, in either direction, since the target is exact.
    const outdated = target !== undefined ? dependency.version === null || dependency.version.replace(/^v/, '') !== target.replace(/^v/, '') : answer.upToDate === undefined ? dependency.version === null || !answer.latest || older(dependency.ecosystem, dependency.version, answer.latest) : !answer.upToDate && (dependency.version === null || older(dependency.ecosystem, dependency.version, String(answer.latest)));
    // The condition checks that exceptions has the key.
    if (outdated && exceptions.has(key)) notes.push(`${subject} ${dependency.version} < ${answer.latest}: kept by the exception of ${POLICY}: ${present(exceptions.get(key), 'exceptions.get(key)').reason}`);
    else if (outdated) {
      const item = { ...dependency, latest: answer.latest };
      newer.push(item);
      if (target === undefined) lines.push(`${subject} ${dependency.version} < ${answer.latest}: a newer stable release exists. Fix: ${fixOf(item)}`);
      else lines.push(`${subject} ${dependency.version} is not the target ${target} of ${present(targets, 'targets').file}. Fix: ${UPDATE} TARGETS=${present(targets, 'targets').file}`);
    } else if (exceptions.has(key)) lines.push(`${subject} ${dependency.version}: the exception of ${POLICY} is stale, ${answer.latest} is the latest stable release. Fix: remove the exception from ${POLICY}`);
  }
  // An accepted advisory is printed as a note with its reason; an exception that the review of its lock does not find is stale.
  const accepted = advisoryExceptions(policy);
  const used = new Set<string>();
  for (const lock of state.locks) {
    // advisories answers every lock of the state.
    const answer = present(audits.get(lock), 'audits.get(lock)');
    if (answer.error !== undefined) {
      lines.push(`${lock}: the advisory query failed: ${answer.error}. Fix: ${answer.fix ?? 'run make dependency-review again when the advisory database answers'}`);
      for (const key of accepted.keys()) if (key.startsWith(`${lock} `)) used.add(key);
      continue;
    }
    for (const advisory of answer.advisories) {
      const key = advisoryKey(lock, advisory.package, advisory.id);
      const exception = accepted.get(key);
      if (exception) {
        used.add(key);
        notes.push(`${lock} ${advisory.package} ${advisoryRelease(advisory)}: advisory ${advisory.id} (${advisory.severity}) ${advisory.title}${advisory.url ? ` ${advisory.url}` : ''} ${acceptedText(exception)}`);
        continue;
      }
      found.push({ lock, ...advisory });
      // readState holds each Python lock of the locks in pythonLocks.
      const fix = lockEcosystem(lock) === 'pypi' ? lockFix(lock, present(state.pythonLocks.find(item => item.lock === lock), 'state.pythonLocks.find(item => item.lock === lock)').createdBy, advisory.package) : UPDATE;
      lines.push(`${lock} ${advisory.package} ${advisoryRelease(advisory)}: advisory ${advisory.id} (${advisory.severity}) ${advisory.title}${advisory.url ? ` ${advisory.url}` : ''}. Fix: ${fix}`);
    }
  }
  for (const [key, exception] of accepted) {
    if (!used.has(key)) lines.push(`${exception.lock} ${exception.package}: the advisory exception ${exception.advisory} of ${POLICY} is stale, the review found no such advisory. Fix: remove the exception from ${POLICY}`);
  }
  const record = {
    schema: 1,
    comment: 'Written by make dependency-review RECORD=1 (scripts/kit/dependency-review.mts) from the registries; make dependency-policy-check compares the checkout with it without a network.',
    reviewed: targets?.snapshot ?? new Date().toISOString(),
    // advisories answers every lock of the state.
    locks: state.locks.map(lock => ({ lock, sha256: fileDigest(path.join(root, lock)), advisories: (present(audits.get(lock), 'audits.get(lock)').advisories ?? []).map(({ package: name, version, range, id, severity, title, url }) => ({ package: name, ...(version !== undefined ? { version } : { range }), id, severity, title, ...(url ? { url } : {}) })) })),
    // latestReleases answers every dependency of the state.
    dependencies: state.dependencies.map(dependency => ({ ecosystem: dependency.ecosystem, manifest: dependency.manifest, package: dependency.package, version: dependency.version, latest: present(latest.get(dependencyKey(dependency)), 'latest.get(dependencyKey(dependency))').latest ?? null })),
    vcs: state.vcs.map(({ lock, package: name, url, requestedRevision, commitId }) => ({ lock, package: name, url, requestedRevision, commitId })),
  };
  // advisories answers every lock of the state.
  const complete = state.locks.every(lock => !present(audits.get(lock), 'audits.get(lock)').error) && [...latest.values()].every(answer => !answer.error);
  return { lines, notes, newer, advisories: found, record, complete, failed };
}

// The fix of a newer release: the ruff of mise.toml is set by hand, and make toolchain-lock pins the digests of its archives;
// every other manifest is updated by `make dependency-review UPDATE=1`.
export const fixOf = (dependency: Newer): string => {
  if (dependency.manifest === TOOLCHAIN) return `set ruff in ${TOOLCHAIN} to ${dependency.latest}, then make toolchain-lock and make install-tools`;
  if (dependency.kind === 'lock') return lockFix(dependency.lock, dependency.createdBy, dependency.package);
  return UPDATE;
};

/** The range operator of a manifest constraint: `^`, `~` or none for an exact version. */
const operator = (spec: string) => (/^[\^~]/.test(spec) ? spec[0] : '');

/** The commands that raise the newer dependencies and update the packages with an advisory, in order. */
export function updatePlan({ newer, advisories: all, linked = () => false, targeted = false }: { newer: PlannedDependency[]; advisories: PlannedAdvisory[]; linked?: (directory: string) => boolean; targeted?: boolean }): { command: string; args: string[]; cwd: string; tracked?: boolean }[] {
  const plan: { command: string; args: string[]; cwd: string; tracked?: boolean }[] = [];
  // With --targets the plan moves only the named dependencies: an advisory fix, or the npm dedupe, would move the others too.
  const found = targeted ? [] : all;
  for (const dependency of newer) {
    // A package of a PEP 751 lock is regenerated by the tool that wrote the lock (fixOf names it), never pinned in place.
    if (dependency.manifest === TOOLCHAIN || dependency.kind === 'lock') continue;
    const version = String(dependency.latest).replace(/^v/, '');
    const range = operator(dependency.spec);
    if (dependency.ecosystem === 'npm') {
      // npm runs in the directory of the lock of the manifest, and --workspace names the manifest relative to it.
      // readState gives every npm dependency its lock.
      const base = path.posix.dirname(present(dependency.lock, 'dependency.lock'));
      const directory = path.posix.relative(base, path.posix.dirname(dependency.manifest));
      const save = dependency.kind === 'devDependencies' ? ['--save-dev'] : ['--save'];
      const workspace = directory === '' ? [] : ['--workspace', directory];
      plan.push({ command: 'npm', args: ['install', ...workspace, ...save, ...(range ? [] : ['--save-exact']), `${dependency.package}@${range}${version}`], cwd: base });
    } else if (dependency.ecosystem === 'go') {
      plan.push({ command: 'go', args: ['get', `${dependency.package}@${dependency.latest}`], cwd: path.posix.dirname(dependency.manifest) });
    } else if (dependency.ecosystem === 'pypi') {
      plan.push({ command: 'node', args: [siblingTool(import.meta.url, 'pin-python-dependency'), dependency.manifest, dependency.package, version], cwd: '.' });
    } else {
      // readState gives every Composer dependency the lock of its root.
      const base = path.posix.dirname(present(dependency.lock, 'dependency.lock'));
      const directory = path.posix.dirname(dependency.manifest);
      const dev = dependency.kind === 'require-dev' ? ['--dev'] : [];
      if (directory === base) {
        plan.push({ command: 'composer', args: ['require', ...dev, '--update-with-dependencies', '--no-interaction', `${dependency.package}:${range}${version}`], cwd: directory });
        // While the project is linked, that step writes composer.link.json alone (K392-1): the tracked manifest declares the range too.
        // The next step moves the tracked lock of a package that is no polyspec package, lock only (K392-2); the tracked lock of a
        // polyspec package waits for the release check (K326).
        if (linked(directory)) {
          plan.push({ command: 'composer', args: ['require', ...dev, '--no-update', '--no-interaction', `${dependency.package}:${range}${version}`], cwd: directory, tracked: true });
          if (!dependency.package.startsWith('polyspec/')) plan.push({ command: 'composer', args: ['update', '--with-dependencies', '--no-install', '--no-interaction', dependency.package], cwd: directory, tracked: true });
        }
      } else {
        // A published package of a path repository has no lock: its manifest is changed alone, and its root updates the lock.
        plan.push({ command: 'composer', args: ['require', ...dev, '--no-update', '--no-interaction', `${dependency.package}:${range}${version}`], cwd: directory });
        plan.push({ command: 'composer', args: ['update', '--with-dependencies', '--no-interaction', dependency.package], cwd: base });
      }
    }
  }
  for (const lock of new Set(found.filter(advisory => lockEcosystem(advisory.lock) === 'npm').map(advisory => advisory.lock))) {
    plan.push({ command: 'npm', args: ['audit', 'fix'], cwd: path.posix.dirname(lock) });
  }
  if (!targeted) for (const cwd of new Set(plan.filter(step => step.command === 'npm').map(step => step.cwd))) plan.push({ command: 'npm', args: ['dedupe'], cwd });
  const affected = new Map<string, Set<string>>();
  for (const advisory of found.filter(item => lockEcosystem(item.lock) !== 'npm')) {
    if (!affected.has(advisory.lock)) affected.set(advisory.lock, new Set());
    // The line above sets the lock.
    present(affected.get(advisory.lock), 'affected.get(advisory.lock)').add(advisory.package);
  }
  for (const [lock, packages] of affected) {
    const directory = path.posix.dirname(lock);
    if (lockEcosystem(lock) === 'go') plan.push({ command: 'go', args: ['get', ...[...packages].map(name => `${name}@latest`)], cwd: directory });
    else if (lockEcosystem(lock) === 'cargo') plan.push({ command: 'cargo', args: ['update', ...[...packages].flatMap(name => ['-p', name])], cwd: directory });
    else if (lockEcosystem(lock) === 'pypi') continue;
    else {
      plan.push({ command: 'composer', args: ['update', '--with-dependencies', '--no-interaction', ...packages], cwd: directory });
      // A linked project also moves the tracked lock of each package that is no polyspec package, lock only, and the others wait.
      const nonPolyspec = [...packages].filter(name => !name.startsWith('polyspec/'));
      if (linked(directory) && nonPolyspec.length) plan.push({ command: 'composer', args: ['update', '--with-dependencies', '--no-install', '--no-interaction', ...nonPolyspec], cwd: directory, tracked: true });
    }
  }
  for (const directory of new Set(plan.filter(step => step.command === 'go').map(step => step.cwd))) plan.push({ command: 'go', args: ['mod', 'tidy'], cwd: directory });
  return plan;
}

/** The manifest fields that Composer copies into a lock entry, in the order that Composer writes them. */
const LOCK_METADATA = ['require', 'require-dev', 'conflict', 'provide', 'replace', 'suggest', 'type', 'extra', 'autoload', 'autoload-dev', 'bin', 'include-path', 'notification-url', 'license', 'authors', 'description', 'homepage', 'keywords', 'support', 'funding', 'abandoned', 'archive'];

/** K439-2: the value that Composer writes into a lock for a manifest value; its license is a list of identifiers. */
function lockValue(key: string, value: unknown): unknown {
  return key === 'license' && typeof value === 'string' ? [value] : value;
}

/** The entry `entry` with the metadata fields of `manifest`: a field keeps its place, a missing one is dropped, and the name, the version, the dist, the source and the time stay. */
function lockEntry(entry: Record<string, unknown>, manifest: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(entry)) {
    if (!LOCK_METADATA.includes(key)) next[key] = value;
    else if (key in manifest) next[key] = lockValue(key, manifest[key]);
  }
  for (const key of LOCK_METADATA) if (!(key in next) && key in manifest) next[key] = lockValue(key, manifest[key]);
  return next;
}

/**
 * K439: the tracked composer.lock `lockText` with the metadata of each package that `providers` provides (name to its composer.json),
 * in packages and packages-dev. The version, the dist, the source and the content-hash stay, so the entry is what Composer locked; the
 * lock is written as kit writes its locks (4-space indentation, a final newline). `rewritten` names the packages that changed; with
 * none the text is returned as it was read.
 */
export function providerEntries(
  lockText: string,
  providers: ReadonlyMap<string, Record<string, unknown>>,
  manifest?: Record<string, unknown>,
  written: ReadonlyMap<string, Record<string, unknown>> = new Map(),
): { text: string; rewritten: string[] } {
  const lock: unknown = JSON.parse(lockText);
  if (!isJsonObject(lock)) throw new Error('composer.lock holds no object');
  const rewritten = new Set<string>();
  if (manifest !== undefined) {
    // K439-1: the root platform sections are what Composer computes from the require and config.platform of the manifest.
    const require = isJsonObject(manifest.require) ? manifest.require : {};
    const platform = Object.fromEntries(Object.entries(require).filter(([name]) => name === 'php' || name.startsWith('ext-') || name.startsWith('lib-')));
    const config = isJsonObject(manifest.config) ? manifest.config : {};
    const overrides = isJsonObject(config.platform) ? config.platform : {};
    if ('platform' in lock && JSON.stringify(lock.platform) !== JSON.stringify(platform)) { lock.platform = platform; rewritten.add('platform'); }
    if ('platform-overrides' in lock && JSON.stringify(lock['platform-overrides']) !== JSON.stringify(overrides)) { lock['platform-overrides'] = overrides; rewritten.add('platform-overrides'); }
  }
  for (const section of ['packages', 'packages-dev']) {
    const list = lock[section];
    if (!Array.isArray(list)) continue;
    lock[section] = list.map((entry: unknown) => {
      if (!isJsonObject(entry) || typeof entry.name !== 'string') return entry;
      const manifest = providers.get(entry.name);
      if (manifest === undefined) return entry;
      const next = written.has(entry.name) ? composerForm(entry, written.get(entry.name) ?? {}) : lockEntry(entry, manifest);
      if (JSON.stringify(next) !== JSON.stringify(entry)) rewritten.add(entry.name);
      return next;
    });
  }
  return { text: rewritten.size ? `${JSON.stringify(lock, null, 4)}\n` : lockText, rewritten: [...rewritten] };
}

/**
 * K439-2: the entry of Composer's own lock writer, with the fields that are the lock's own kept: the name, the version, the dist and the
 * source of the tracked entry. Composer's key order and forms (a license list, the type) are the written ones.
 */
function composerForm(entry: Record<string, unknown>, written: Record<string, unknown>): Record<string, unknown> {
  const kept = ['name', 'version', 'dist', 'source'];
  const next: Record<string, unknown> = {};
  for (const key of Object.keys(written)) {
    if (key === 'transport-options' || key === 'time') continue;
    next[key] = kept.includes(key) && key in entry ? entry[key] : written[key];
  }
  return next;
}

/**
 * K439-2: the entries that Composer writes for the packages `packages` (name, version, folder of the provider): Composer locks a scratch
 * project whose path repositories are the provider folders, offline, with its own writer (composer update --no-install).
 */
export function composerEntries(
  packages: readonly { name: string; version: string; folder: string }[],
  composer: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: Record<string, string> = {},
  base?: { manifest: Record<string, unknown>; lock: string; folder: string; siblings?: ReadonlyMap<string, string> },
): Map<string, Record<string, unknown>> {
  const found = new Map<string, Record<string, unknown>>();
  if (packages.length === 0) return found;
  const scratch = mkdtempSync(path.join(tmpdir(), 'kit-composer-entries-'));
  try {
    const providerRepositories = packages.map(item => ({ type: 'path', url: item.folder, options: { symlink: false, versions: { [item.name]: item.version } } }));
    const project = {
      name: 'kit/entries',
      version: '1.0.0',
      // The platform that the consumer declares (its config.platform), so the entries resolve as they would for that consumer.
      config: { platform },
      require: Object.fromEntries(packages.map(item => [item.name, item.version])),
      repositories: [{ packagist: false }, ...providerRepositories],
    };
    // K439-3: with the consumer's manifest and tracked lock as the base, the transitive requirements come from the lock: Composer updates
    // only the provided packages, offline.
    // K439-4: the consumer's own repositories follow the provided packages, so a provider wins and a root requirement that only a consumer
    // path repository provides resolves as it does for the consumer; packagist stays disabled, the first entry.
    const scratchProject = base === undefined ? project : {
      ...base.manifest,
      config: { ...(isJsonObject(base.manifest.config) ? base.manifest.config : {}), platform },
      require: { ...(isJsonObject(base.manifest.require) ? base.manifest.require : {}), ...project.require },
      repositories: [{ packagist: false }, ...providerRepositories, ...consumerRepositories(base.manifest, base.folder, base.siblings ?? new Map())],
    };
    writeFileSync(path.join(scratch, 'composer.json'), `${JSON.stringify(scratchProject, null, 4)}\n`);
    if (base !== undefined) writeFileSync(path.join(scratch, 'composer.lock'), base.lock);
    // Its own home and cache, so that no global repository of the machine (packagist) is read: the entries come from the providers only.
    const isolated = { ...env, COMPOSER_HOME: path.join(scratch, 'home'), COMPOSER_CACHE_DIR: path.join(scratch, 'cache'), COMPOSER_DISABLE_NETWORK: '1' };
    const names = packages.map(item => item.name);
    const ran = spawnSync(composer, ['update', ...(base === undefined ? [] : names), '--no-install', '--no-scripts', '--no-plugins', '--no-audit', '--no-interaction'], { cwd: scratch, env: isolated, encoding: 'utf8' });
    if (ran.status !== 0) throw new Error(`composer update of the provider entries failed (${ran.status}): ${ran.stdout}${ran.stderr}`);
    const lock: unknown = JSON.parse(readFileSync(path.join(scratch, 'composer.lock'), 'utf8'));
    const list = isJsonObject(lock) && Array.isArray(lock.packages) ? lock.packages : [];
    for (const entry of list) if (isJsonObject(entry) && typeof entry.name === 'string') found.set(entry.name, entry);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  return found;
}

/**
 * The key of a repository url that names the same repository whatever its form: https or ssh, with or without the .git suffix or a final slash.
 * A url of another form is its own key.
 */
export function repositoryKey(url: string): string {
  const match = /^(?:https:\/\/|ssh:\/\/git@|git@)([^/:]+)[:/](.+?)(?:\.git)?\/?$/i.exec(url.trim());
  return match?.[1] === undefined || match[2] === undefined ? url.trim() : `${match[1].toLowerCase()}/${match[2]}`;
}

/**
 * K439-4, K475: the repositories of a consumer manifest as Composer reads them in the folder of the consumer. A path url is relative to that folder
 * and must name a folder that exists, or the call fails naming it; no other repository stands in for it. A vcs url is read from the sibling
 * checkout whose origin names the same repository (`siblings`, origin url to folder), as a path repository of that folder, so the scratch needs
 * no network; a vcs url that no sibling checkout names fails naming it. A packagist entry is dropped, since the scratch keeps packagist disabled.
 */
function consumerRepositories(manifest: Record<string, unknown>, folder: string, siblings: ReadonlyMap<string, string>): Record<string, unknown>[] {
  const declared = manifest.repositories;
  const list: unknown[] = Array.isArray(declared) ? declared : isJsonObject(declared) ? Object.values(declared) : [];
  const byKey = new Map([...siblings].map(([url, sibling]) => [repositoryKey(url), sibling]));
  return list.flatMap((repository: unknown) => {
    if (repository === false || (isJsonObject(repository) && 'packagist' in repository)) return [];
    if (!isJsonObject(repository)) throw new Error(`a repository of the consumer is not an object: ${JSON.stringify(repository)}`);
    if (repository.type === 'vcs') {
      if (typeof repository.url !== 'string') throw new Error(`a vcs repository of the consumer has no url: ${JSON.stringify(repository)}`);
      const sibling = byKey.get(repositoryKey(repository.url));
      if (sibling === undefined) throw new Error(`the vcs repository ${repository.url} of the consumer is provided by no sibling checkout (no checkout's origin names it): the provider entries are not written`);
      return [{ type: 'path', url: sibling, options: { symlink: false } }];
    }
    if (repository.type !== 'path') return [repository];
    if (typeof repository.url !== 'string') throw new Error(`a path repository of the consumer has no url: ${JSON.stringify(repository)}`);
    const url = path.resolve(folder, repository.url);
    if (!existsSync(url) || !statSync(url).isDirectory()) throw new Error(`the path repository ${repository.url} of the consumer is not a readable folder (${url}): the provider entries are not written`);
    return [{ ...repository, url }];
  });
}

/** K439-1: a directory of a release consumer (its locks are written by make release-consumer-lock only). */
export function isReleaseConsumerDirectory(directory: string): boolean {
  return directory.split('/').includes('release-consumer');
}

/** The composer.json and the folder of each Composer package that a sibling checkout of the repository at `root` provides, by package name. */
function siblingComposerProviders(root: string): Map<string, { manifest: Record<string, unknown>; folder: string }> {
  const found = new Map<string, { manifest: Record<string, unknown>; folder: string }>();
  for (const provider of providers(siblingCheckouts(root).checkouts, undefined, root).values()) {
    if (provider.ecosystem !== 'composer') continue;
    const manifest: unknown = JSON.parse(readFileSync(path.join(provider.folder, 'composer.json'), 'utf8'));
    if (isJsonObject(manifest)) found.set(provider.name, { manifest, folder: provider.folder });
  }
  return found;
}

/** The origin url of each main checkout beside the repository of `root` (and the forks), to its folder: the vcs repositories of a consumer resolve through them (K475). */
function siblingOrigins(root: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const folder of siblingCheckouts(root).checkouts) {
    // git config exits 1 for a key that is not set; a checkout without an origin names no repository.
    const origin = linkGit(folder, 'config', '--get', 'remote.origin.url');
    if (origin.error || (origin.status !== 0 && origin.status !== 1)) throw new Error(`git config --get remote.origin.url failed in ${folder}: ${origin.error?.message ?? origin.stderr.trim()}`);
    if (origin.status === 0) found.set(origin.stdout.trim(), folder);
  }
  return found;
}

/** Applies providerEntries to the tracked composer.lock of each directory in `directories`, and says which packages it rewrote (K439-2). */
function rewriteProviderEntries(root: string, directories: readonly string[], found: Map<string, { manifest: Record<string, unknown>; folder: string }> = siblingComposerProviders(root)): void {
  const manifests = new Map([...found].map(([name, provider]) => [name, provider.manifest]));
  const siblings = siblingOrigins(root);
  // K439-2: the toolchain Composer of the checkout, as K432 runs it (COMPOSER_BIN names another one).
  const composer = process.env.COMPOSER_BIN ?? composerCommand(root, 'make composer-provider-entries');
  for (const directory of new Set(directories)) {
    if (isReleaseConsumerDirectory(directory)) continue;
    const lock = path.join(root, directory, 'composer.lock');
    if (!existsSync(lock)) continue;
    const own = path.join(root, directory, 'composer.json');
    const manifest: unknown = existsSync(own) ? JSON.parse(readFileSync(own, 'utf8')) : undefined;
    const lockText = readFileSync(lock, 'utf8');
    const parsed: unknown = JSON.parse(lockText);
    const listed: unknown[] = isJsonObject(parsed) ? ['packages', 'packages-dev'].flatMap((section): unknown[] => {
      const list: unknown = parsed[section];
      return Array.isArray(list) ? list : [];
    }) : [];
    const provided = listed.flatMap(entry => {
      if (!isJsonObject(entry) || typeof entry.name !== 'string' || typeof entry.version !== 'string') return [];
      const provider = found.get(entry.name);
      return provider === undefined ? [] : [{ name: entry.name, version: entry.version, folder: provider.folder }];
    });
    const declared = isJsonObject(manifest) && isJsonObject(manifest.config) && isJsonObject(manifest.config.platform) ? manifest.config.platform : {};
    const platform = Object.fromEntries(Object.entries(declared).filter((item): item is [string, string] => typeof item[1] === 'string'));
    const base = isJsonObject(manifest) ? { manifest, lock: lockText, folder: path.join(root, directory), siblings } : undefined;
    const written = composerEntries(provided, composer, toolEnvironment(root), platform, base);
    const { text, rewritten } = providerEntries(lockText, manifests, isJsonObject(manifest) ? manifest : undefined, written);
    if (rewritten.length === 0) continue;
    writeFileSync(lock, text);
    say(`${path.posix.join(directory, 'composer.lock')}: rewrote the metadata of ${rewritten.join(', ')}`);
  }
}

/**
 * Runs the commands of an update plan in order and returns how many failed (K439-4-1 seam: the provider entries of the composer directories of
 * the plan are rewritten after its commands; `found` names the providers, by default the sibling checkouts).
 */
export function runUpdateSteps(root: string, plan: readonly { command: string; args: string[]; cwd: string; tracked?: boolean }[], found?: Map<string, { manifest: Record<string, unknown>; folder: string }>): number {
  // K439-4-1: the provider entries of the tracked locks are written before the commands run on them, so a stale polyspec entry (php >=8.5 of an
  // older release) does not fail Composer's platform check of the update; they are written again after, for the locks the commands changed.
  const directories = plan.filter(step => step.command === 'composer').map(step => step.cwd);
  rewriteProviderEntries(root, directories, found);
  let failed = 0;
  for (const step of plan) {
    say(`run ${step.command} ${step.args.join(' ')} in ${step.cwd}`);
    const outcome = spawnSync(CHECKOUT_TOOLS.has(step.command) ? toolCommand(root, step.command) : step.command, step.args, { cwd: path.join(root, step.cwd), stdio: 'inherit', ...(step.command === 'composer' && !step.tracked ? { env: composerEnvironment(root, step.cwd) ?? process.env } : {}) });
    if (outcome.error || outcome.status !== 0) {
      failed += 1;
      say(`${step.command} ${step.args.join(' ')} in ${step.cwd} ended with ${outcome.error?.message ?? `exit status ${outcome.status}`}`);
    }
  }
  rewriteProviderEntries(root, directories, found);
  return failed;
}

function print(result: { notes: string[]; lines: string[] }) {
  for (const note of result.notes) say(note);
  for (const line of result.lines) say(`${line}.`);
  say(result.lines.length
    ? `${result.lines.length} finding${result.lines.length === 1 ? '' : 's'}`
    : 'no newer stable release without an exception and no advisory without an exception');
}

/** The targets of the file of --targets, checked against dependency-targets.schema.json */
function readTargets(file: string): Targets {
  const value = readJsonFile<{ snapshot: string; targets: Record<string, Record<string, string>> }>(path.resolve(file), 'dependency-targets.schema.json');
  return { file, snapshot: value.snapshot, versions: value.targets };
}

function main(): void {
  const args = process.argv.slice(2);
  let root = repositoryRoot();
  let record = false;
  let update = false;
  let providerOnly = false;
  let targetsFile: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    // The condition checks that the argument after --root is present.
    if (args[index] === '--root' && args[index + 1]) root = path.resolve(present(args[++index], 'args[++index]'));
    else if (args[index] === '--record') record = true;
    else if (args[index] === '--update') update = true;
    else if (args[index] === '--provider-entries') providerOnly = true;
    else if (args[index] === '--targets' && args[index + 1]) targetsFile = present(args[++index], 'args[++index]');
    else {
      console.error('Usage: node scripts/kit/dependency-review.mts [--root <checkout>] [--record] [--update] [--provider-entries] [--targets <file>]');
      process.exit(2);
    }
  }
  if (providerOnly) {
    rewriteProviderEntries(root, checkedFiles(root).filter(file => path.posix.basename(file) === 'composer.lock').map(file => path.posix.dirname(file)));
    return;
  }
  const targets = targetsFile === undefined ? undefined : readTargets(targetsFile);
  // A dependency that the targets name, and so the only one that a targeted update moves
  const named = (item: { ecosystem: string; package: string }) => targets?.versions[item.ecosystem]?.[item.package] !== undefined;
  let result = review(root, targets);
  if (update) {
    print(result);
    // A target that the registry lacks fails before any dependency changes
    if (targets !== undefined && result.failed.length) {
      say(`no dependency is updated: the target of ${result.failed.join(', ')} is not a stable release of the registry`);
      process.exitCode = 1;
      return;
    }
    // A linked package is moved by its link, not by the update (K340).
    const plan = updatePlan({ newer: result.newer.filter(item => !isLinked(root, item.ecosystem, item.lock, item.package) && (targets === undefined || named(item))), advisories: result.advisories.filter(item => item.lock === undefined || item.package === undefined || lockEcosystem(item.lock) === undefined || !isLinked(root, present(lockEcosystem(item.lock), 'lockEcosystem'), item.lock, item.package)), linked: directory => composerEnvironment(root, directory) !== undefined, targeted: targets !== undefined });
    const failed = runUpdateSteps(root, plan);
    say(`${plan.length - failed} of ${plan.length} update commands passed; reviewing again`);
    result = review(root, targets);
  }
  print(result);
  if (record || update) {
    if (!result.complete) {
      say(`${RECORD} is unchanged: a registry or advisory query failed`);
      process.exit(1);
    }
    writeJson(path.join(root, RECORD), result.record);
    say(`wrote ${RECORD}: ${result.record.dependencies.length} registry dependencies and ${result.record.locks.length} locks reviewed at ${result.record.reviewed}`);
  }
  process.exitCode = result.lines.length ? 1 : 0;
}

if (isMain(import.meta.url)) {
  try {
    main();
  } catch (error) {
    // A missing configuration is a message for the developer; every other error keeps its stack (K146).
    if (!(error instanceof ConfigError)) throw error;
    console.error(`[dependency-review] ${error.message}`);
    process.exit(1);
  }
}
