#!/usr/bin/env node
// The dependency review: `make dependency-review`, a developer command that no check and no gating CI job runs. It
// asks the registries for the latest stable release of every registry dependency (scripts/kit/dependency-state.mts
// defines them) that its publisher has not deprecated, and for the advisories of every lock, and reports each newer
// stable release without an exception, each stale exception and each advisory with its fix, one line each; it fails
// when there is one.
//
//   node scripts/kit/dependency-review.mts [--root <checkout>] [--record] [--update]
//
// --record writes what it reviewed to config/dependency-review.json: the time, the sha256 and the advisories of every
// lock, and the locked and latest stable version of every registry dependency. The gate scripts/kit/check-dependency-policy.mts
// compares the checkout with that record without a network.
// --update first raises every newer dependency without an exception to its latest stable release, keeping the range
// operator of its manifest, and updates the packages with an advisory; `npm dedupe` then installs one version of each
// npm package that one version satisfies, since an install for one workspace keeps the release of the root; then it
// reviews and records again.
// The advisories of the Cargo locks come from the cargo-audit of var/tools (scripts/kit/install-cargo-audit.mts, which
// `make install-tools` runs) and the RustSec advisory database. A PyPI dependency is pinned exactly in its pyproject.toml,
// and `--update` sets the pin of a newer release with scripts/kit/pin-python-dependency.mts.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { explain, rcompare as pep440Descending, valid as pep440Valid } from '@renovatebot/pep440';
import { POLICY, RECORD, TOOLCHAIN, UPDATE, acceptedText, advisoryExceptions, advisoryKey, dependencyKey, goPackagePatterns, lockEcosystem, lockFix, readState } from './dependency-state.mts';
import type { Dependency } from './dependency-state.mts';
import { cargoAuditCommand } from './install-cargo-audit.mts';
import { govulncheckCommand } from './install-govulncheck.mts';
import { isMain, ROOT, siblingTool } from './paths.mts';
import { Stop, run as runCommand } from './process.mts';
import { fileDigest } from './bootstrap/digest.mts';
import { readJson, writeJson } from './bootstrap/files.mts';
import { isPrerelease, older, stableDescending } from './version.mts';

// npm audit reports these severities; the reviewed severity is moderate. Composer audit reports every advisory.
const NPM_SEVERITIES = new Set(['moderate', 'high', 'critical']);
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
  version: string | undefined;
  id: string;
  severity: string;
  title: string;
  url?: string | undefined;
}

/** An advisory of the review with its lock. */
export type FoundAdvisory = Advisory & { lock: string };

/** A dependency with a newer stable release; its release is undefined when its query failed with an empty message. */
export type Newer = Dependency & { latest: string | null | undefined };

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
type Audit = { advisories: Advisory[]; error?: undefined } | { error: string; advisories?: undefined };

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
interface ComposerAudit { advisories?: Record<string, ComposerAdvisory[] | Record<string, ComposerAdvisory>>; abandoned?: Record<string, string | null> }

function run(command: string, args: string[], cwd: string, statuses?: number[]): Ran {
  try {
    return { stdout: runCommand(command, args, { cwd, statuses }) };
  } catch (error) {
    if (!(error instanceof Stop)) throw error;
    return { error: error.message };
  }
}

// The JSON that `command` prints, or { error }. An empty output is an error, unless `empty` is the documented answer of the
// command that prints nothing.
function query<T>(command: string, args: string[], cwd: string, statuses?: number[], empty?: T): Answer<T> {
  const result = run(command, args, cwd, statuses);
  if (result.error) return result;
  // A result without an error message has stdout.
  if (!result.stdout!.trim()) return empty === undefined ? { error: `${command} ${args.join(' ')} printed no JSON: the output is empty` } : { value: empty };
  try {
    return { value: JSON.parse(result.stdout!) };
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    return { error: `${command} ${args.join(' ')} printed no JSON: ${error.message}` };
  }
}

/** The latest stable npm release of `name` that its publisher has not deprecated: { latest } or { error }. */
function npmLatest(root: string, name: string): Latest {
  const answer = query<NpmView | NpmView[]>('npm', ['view', name, 'dist-tags', 'versions', '--json'], root);
  if (answer.error) return answer;
  // A result without an error message has its value.
  const value = answer.value!;
  // npm 12 prints the fields of the one matching package as an array of one object.
  const view = Array.isArray(value) ? value[0] ?? {} : value;
  const tag = view['dist-tags']?.latest;
  const versions = Array.isArray(view.versions) ? view.versions : [view.versions].filter((version): version is string => Boolean(version));
  const candidates = stableDescending('npm', versions).filter((version: string) => !tag || isPrerelease('npm', tag) || !older('npm', tag, version));
  for (const version of candidates) {
    const deprecated = run('npm', ['view', `${name}@${version}`, 'deprecated'], root);
    if (deprecated.error) return deprecated;
    // A result without an error message has stdout.
    if (!deprecated.stdout!.trim()) return { latest: version };
  }
  return { error: `npm view ${name} reported no stable release that is not deprecated` };
}

/**
 * The highest release of a PyPI project that has files and is no pre-release or development release by PEP 440 (a post-release
 * is a release); releases: version -> files. A key that is no PEP 440 version is no release.
 */
export function highestStableRelease(releases: Record<string, unknown[]>): string | null {
  // version is a key of releases, and pep440Valid checked that it reads.
  const stable = Object.keys(releases).filter(version => releases[version]!.length > 0 && pep440Valid(version) !== null && !explain(version)!.is_prerelease);
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
function latestReleases(root: string, state: ReviewState): Map<string, Latest> {
  const latest = new Map<string, Latest>();
  const npm = new Map<string, Latest>();
  const composer = new Map<string, Answer<ComposerOutdated>>();
  for (const dependency of state.dependencies) {
    const key = dependencyKey(dependency);
    if (dependency.ecosystem === 'npm') {
      if (!npm.has(dependency.package)) npm.set(dependency.package, npmLatest(root, dependency.package));
      // The line above sets the package.
      latest.set(key, npm.get(dependency.package)!);
      continue;
    }
    if (dependency.ecosystem === 'go') {
      const directory = path.posix.dirname(dependency.manifest);
      const answer = query<GoVersions>('go', ['list', '-m', '-versions', '-json', dependency.package], path.join(root, directory));
      if (answer.error) {
        latest.set(key, { error: answer.error });
        continue;
      }
      // A module without a stable release has nothing newer than the version that go.mod requires.
      // A result without an error message has its value.
      latest.set(key, { latest: stableDescending('go', answer.value!.Versions ?? [])[0] ?? dependency.version });
      continue;
    }
    if (dependency.ecosystem === 'pypi') {
      const answer = query<PypiProject>('curl', ['-fsSL', `https://pypi.org/pypi/${dependency.package}/json`], root);
      if (answer.error) {
        latest.set(key, { error: answer.error });
        continue;
      }
      // A result without an error message has its value.
      const stable = highestStableRelease(answer.value!.releases ?? {});
      latest.set(key, stable ? { latest: stable } : { error: `PyPI reported no stable release of ${dependency.package}` });
      continue;
    }
    const directory = path.posix.dirname(dependency.manifest);
    // composer outdated reports the latest stable release of each direct requirement; composer audit reports an
    // abandoned package.
    if (!composer.has(directory)) composer.set(directory, query('composer', ['outdated', '--direct', '--locked', '--all', '--format=json', '--no-interaction'], path.join(root, directory)));
    // The line above sets the directory.
    const answer = composer.get(directory)!;
    if (answer.error) {
      latest.set(key, { error: answer.error });
      continue;
    }
    // A result without an error message has its value.
    const entry = (answer.value!.locked ?? []).find(item => item.name === dependency.package);
    if (!entry?.latest || !entry['latest-status']) latest.set(key, { error: `composer outdated in ${directory} reported no release of ${dependency.package}` });
    else latest.set(key, { latest: entry.latest, upToDate: entry['latest-status'] === 'up-to-date' });
  }
  return latest;
}

/**
 * The import paths of the packages of the Go module of `lock` that govulncheck scans, or { error }: the packages of
 * goPackagePatterns that have a buildable file, by `go list -e`. A directory whose every file a build constraint excludes
 * is no package for `./...`, and govulncheck refuses it as a pattern, so it is dropped here.
 */
export function goPackages(root: string, lock: string): { list: string[]; error?: undefined } | { error: string; list?: undefined } {
  const patterns = goPackagePatterns(root, lock);
  if (patterns.length === 0) return { list: [] };
  const answer = run('go', ['list', '-e', '-f', '{{if or .GoFiles .TestGoFiles .XTestGoFiles}}{{.ImportPath}}{{end}}', ...patterns], path.join(root, path.posix.dirname(lock)));
  // A result without an error message has stdout.
  return answer.error ? answer : { list: answer.stdout!.split('\n').filter(Boolean) };
}

/** The advisories of every lock: lock -> { advisories } or { error }. Each npm lock is audited in the directory it lies in. */
function advisories(root: string, state: ReviewState): Map<string, Audit> {
  const result = new Map<string, Audit>();
  for (const lock of state.locks.filter(item => lockEcosystem(item) === 'npm')) {
    // readState holds the lock of each npm lock.
    const npmVersions = state.npmLocks.get(lock)!.packages ?? {};
    const npm = query<NpmAudit>('npm', ['audit', '--json', '--package-lock-only'], path.join(root, path.posix.dirname(lock)), [0, 1]);
    if (npm.error) result.set(lock, { error: npm.error });
    else {
      const list: Advisory[] = [];
      // A result without an error message has its value.
      for (const [name, vulnerability] of Object.entries(npm.value!.vulnerabilities ?? {})) {
        for (const via of vulnerability.via ?? []) {
          if (typeof via !== 'object' || !NPM_SEVERITIES.has(via.severity)) continue;
          list.push({ package: name, version: npmVersions[`node_modules/${name}`]?.version ?? vulnerability.range, id: String(via.source ?? via.url), severity: via.severity, title: via.title, url: via.url });
        }
      }
      result.set(lock, { advisories: list });
    }
  }
  // cargo-audit reads the RustSec advisory database from a clone in .tools; the first lock fetches it.
  let fetched = false;
  for (const lock of state.locks.filter(item => lockEcosystem(item) === 'cargo')) {
    const command = cargoAuditCommand(root);
    const args: string[] = ['audit', '--db', path.join(root, 'var', 'tools', 'rustsec-advisory-db'), ...(fetched ? ['--no-fetch'] : []), '--file', path.join(root, lock), '--json'];
    // cargo-audit exits with 1 when it finds a vulnerability.
    const answer: Answer<CargoAudit> = existsSync(command) ? query(command, args, root, [0, 1]) : { error: `${path.relative(root, command)} is not installed; run make install-tools` };
    fetched ||= !answer.error;
    if (answer.error) {
      result.set(lock, { error: answer.error });
      continue;
    }
    // A result without an error message has its value.
    const value = answer.value!;
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
    for (const item of state.pythonLocks.find(entry => entry.lock === lock)!.packages.filter(entry => entry.kind === 'registry')) {
      const answer = query<PypiRelease>('curl', ['-fsSL', `https://pypi.org/pypi/${item.name}/${item.version}/json`], root);
      if (answer.error) {
        failure = answer.error;
        break;
      }
      // A result without an error message has its value.
      for (const vulnerability of answer.value!.vulnerabilities ?? []) {
        list.push({ package: item.name, version: item.version, id: vulnerability.id, severity: 'vulnerability', title: vulnerability.summary ?? vulnerability.id, url: vulnerability.link ?? `https://osv.dev/vulnerability/${vulnerability.id}` });
      }
    }
    result.set(lock, failure ? { error: failure } : { advisories: list });
  }
  for (const lock of state.locks.filter(item => lockEcosystem(item) === 'go')) {
    const command = govulncheckCommand(root);
    if (!existsSync(command)) {
      result.set(lock, { error: `${path.relative(root, command)} is not installed; run make install-tools` });
      continue;
    }
    const packages = goPackages(root, lock);
    if (packages.error) {
      result.set(lock, { error: packages.error });
      continue;
    }
    // A result without an error message has its list.
    const list = packages.list!;
    // A module with no buildable package calls no vulnerable function, and govulncheck refuses an empty pattern list.
    if (list.length === 0) {
      result.set(lock, { advisories: [] });
      continue;
    }
    const answer = run(command, ['-format', 'sarif', ...list], path.join(root, path.posix.dirname(lock)));
    if (answer.error) {
      result.set(lock, { error: answer.error });
      continue;
    }
    // A result without an error message has stdout.
    result.set(lock, { advisories: goAdvisories(JSON.parse(answer.stdout!)) });
  }
  for (const lock of state.locks.filter(item => lockEcosystem(item) === 'composer')) {
    const directory = path.posix.dirname(lock);
    const lockData = readJson(root, lock);
    const versions = new Map([...(lockData.packages ?? []), ...(lockData['packages-dev'] ?? [])].map(item => [item.name, item.version]));
    // composer audit sets bit 1 for an advisory and bit 2 for an abandoned package. For a lock without packages it prints
    // "No packages - skipping audit." to stderr and nothing to stdout (measured with Composer 2.10), which is no advisory.
    const answer = query<ComposerAudit>('composer', ['audit', '--locked', '--format=json', '--no-interaction'], path.join(root, directory), [0, 1, 2, 3], {});
    if (answer.error) {
      result.set(lock, { error: answer.error });
      continue;
    }
    // A result without an error message has its value.
    const value = answer.value!;
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
export function review(root: string) {
  const policy = readJson(root, POLICY);
  const exceptions = new Map<string, { reason: string }>(policy.exceptions.map((exception: { ecosystem: string; manifest: string; package: string; reason: string }) => [dependencyKey(exception), exception]));
  const state: ReviewState = readState(root, policy);
  const latest = latestReleases(root, state);
  const audits = advisories(root, state);
  const lines: string[] = [];
  const notes: string[] = [];
  const newer: Newer[] = [];
  const found: FoundAdvisory[] = [];
  for (const dependency of state.dependencies) {
    const key = dependencyKey(dependency);
    const subject = `${dependency.manifest} ${dependency.package}`;
    // latestReleases answers every dependency of the state.
    const answer = latest.get(key)!;
    if (answer.error) {
      lines.push(`${subject}: the registry query failed: ${answer.error}. Fix: run make dependency-review again when the registry answers`);
      continue;
    }
    // A dependency that its lock holds at no version is not at the latest release.
    const outdated = answer.upToDate === undefined ? dependency.version === null || !answer.latest || older(dependency.ecosystem, dependency.version, answer.latest) : !answer.upToDate;
    // The condition checks that exceptions has the key.
    if (outdated && exceptions.has(key)) notes.push(`${subject} ${dependency.version} < ${answer.latest}: kept by the exception of ${POLICY}: ${exceptions.get(key)!.reason}`);
    else if (outdated) {
      const item = { ...dependency, latest: answer.latest };
      newer.push(item);
      lines.push(`${subject} ${dependency.version} < ${answer.latest}: a newer stable release exists. Fix: ${fixOf(item)}`);
    } else if (exceptions.has(key)) lines.push(`${subject} ${dependency.version}: the exception of ${POLICY} is stale, ${answer.latest} is the latest stable release. Fix: remove the exception from ${POLICY}`);
  }
  // An accepted advisory is printed as a note with its reason; an exception that the review of its lock does not find is stale.
  const accepted = advisoryExceptions(policy);
  const used = new Set<string>();
  for (const lock of state.locks) {
    // advisories answers every lock of the state.
    const answer = audits.get(lock)!;
    if (answer.error) {
      lines.push(`${lock}: the advisory query failed: ${answer.error}. Fix: run make dependency-review again when the advisory database answers`);
      for (const key of accepted.keys()) if (key.startsWith(`${lock} `)) used.add(key);
      continue;
    }
    // A result without an error message has its advisories.
    for (const advisory of answer.advisories!) {
      const key = advisoryKey(lock, advisory.package, advisory.id);
      const exception = accepted.get(key);
      if (exception) {
        used.add(key);
        notes.push(`${lock} ${advisory.package} ${advisory.version}: advisory ${advisory.id} (${advisory.severity}) ${advisory.title}${advisory.url ? ` ${advisory.url}` : ''} ${acceptedText(exception)}`);
        continue;
      }
      found.push({ lock, ...advisory });
      // readState holds each Python lock of the locks in pythonLocks.
      const fix = lockEcosystem(lock) === 'pypi' ? lockFix(lock, state.pythonLocks.find(item => item.lock === lock)!.createdBy, advisory.package) : UPDATE;
      lines.push(`${lock} ${advisory.package} ${advisory.version}: advisory ${advisory.id} (${advisory.severity}) ${advisory.title}${advisory.url ? ` ${advisory.url}` : ''}. Fix: ${fix}`);
    }
  }
  for (const [key, exception] of accepted) {
    if (!used.has(key)) lines.push(`${exception.lock} ${exception.package}: the advisory exception ${exception.advisory} of ${POLICY} is stale, the review found no such advisory. Fix: remove the exception from ${POLICY}`);
  }
  const record = {
    schema: 1,
    comment: 'Written by make dependency-review RECORD=1 (scripts/kit/dependency-review.mts) from the registries; make dependency-policy-check compares the checkout with it without a network.',
    reviewed: new Date().toISOString(),
    // advisories answers every lock of the state.
    locks: state.locks.map(lock => ({ lock, sha256: fileDigest(path.join(root, lock)), advisories: (audits.get(lock)!.advisories ?? []).map(({ package: name, version, id, severity, title, url }) => ({ package: name, version, id, severity, title, ...(url ? { url } : {}) })) })),
    // latestReleases answers every dependency of the state.
    dependencies: state.dependencies.map(dependency => ({ ecosystem: dependency.ecosystem, manifest: dependency.manifest, package: dependency.package, version: dependency.version, latest: latest.get(dependencyKey(dependency))!.latest ?? null })),
    vcs: state.vcs.map(({ lock, package: name, url, requestedRevision, commitId }) => ({ lock, package: name, url, requestedRevision, commitId })),
  };
  // advisories answers every lock of the state.
  const complete = state.locks.every(lock => !audits.get(lock)!.error) && [...latest.values()].every(answer => !answer.error);
  return { lines, notes, newer, advisories: found, record, complete };
}

// The fix of a newer release: the ruff pin of config/toolchain.json is set by hand, with the sha256 of its wheels, because
// the sha256 is read from the registry of each platform; every other manifest is updated by `make dependency-review UPDATE=1`.
export const fixOf = (dependency: Newer): string => {
  if (dependency.manifest === TOOLCHAIN) return `set ruff in ${TOOLCHAIN} to ${dependency.latest} with the sha256 of each wheel, then make install-tools`;
  if (dependency.kind === 'lock') return lockFix(dependency.lock, dependency.createdBy, dependency.package);
  return UPDATE;
};

/** The range operator of a manifest constraint: `^`, `~` or none for an exact version. */
const operator = (spec: string) => (/^[\^~]/.test(spec) ? spec[0] : '');

/** The commands that raise the newer dependencies and update the packages with an advisory, in order. */
export function updatePlan({ newer, advisories: found }: { newer: PlannedDependency[]; advisories: PlannedAdvisory[] }): { command: string; args: string[]; cwd: string }[] {
  const plan: { command: string; args: string[]; cwd: string }[] = [];
  for (const dependency of newer) {
    // A package of a PEP 751 lock is regenerated by the tool that wrote the lock (fixOf names it), never pinned in place.
    if (dependency.manifest === TOOLCHAIN || dependency.kind === 'lock') continue;
    const version = String(dependency.latest).replace(/^v/, '');
    const range = operator(dependency.spec);
    if (dependency.ecosystem === 'npm') {
      // npm runs in the directory of the lock of the manifest, and --workspace names the manifest relative to it.
      // readState gives every npm dependency its lock.
      const base = path.posix.dirname(dependency.lock!);
      const directory = path.posix.relative(base, path.posix.dirname(dependency.manifest));
      const save = dependency.kind === 'devDependencies' ? ['--save-dev'] : ['--save'];
      const workspace = directory === '' ? [] : ['--workspace', directory];
      plan.push({ command: 'npm', args: ['install', ...workspace, ...save, ...(range ? [] : ['--save-exact']), `${dependency.package}@${range}${version}`], cwd: base });
    } else if (dependency.ecosystem === 'go') {
      plan.push({ command: 'go', args: ['get', `${dependency.package}@${dependency.latest}`], cwd: path.posix.dirname(dependency.manifest) });
    } else if (dependency.ecosystem === 'pypi') {
      plan.push({ command: 'node', args: [siblingTool(import.meta.url, 'pin-python-dependency'), dependency.manifest, dependency.package, version], cwd: '.' });
    } else {
      plan.push({ command: 'composer', args: ['require', ...(dependency.kind === 'require-dev' ? ['--dev'] : []), '--update-with-dependencies', '--no-interaction', `${dependency.package}:${range}${version}`], cwd: path.posix.dirname(dependency.manifest) });
    }
  }
  for (const lock of new Set(found.filter(advisory => lockEcosystem(advisory.lock) === 'npm').map(advisory => advisory.lock))) {
    plan.push({ command: 'npm', args: ['audit', 'fix'], cwd: path.posix.dirname(lock) });
  }
  for (const cwd of new Set(plan.filter(step => step.command === 'npm').map(step => step.cwd))) plan.push({ command: 'npm', args: ['dedupe'], cwd });
  const affected = new Map<string, Set<string>>();
  for (const advisory of found.filter(item => lockEcosystem(item.lock) !== 'npm')) {
    if (!affected.has(advisory.lock)) affected.set(advisory.lock, new Set());
    // The line above sets the lock.
    affected.get(advisory.lock)!.add(advisory.package);
  }
  for (const [lock, packages] of affected) {
    const directory = path.posix.dirname(lock);
    if (lockEcosystem(lock) === 'go') plan.push({ command: 'go', args: ['get', ...[...packages].map(name => `${name}@latest`)], cwd: directory });
    else if (lockEcosystem(lock) === 'cargo') plan.push({ command: 'cargo', args: ['update', ...[...packages].flatMap(name => ['-p', name])], cwd: directory });
    else if (lockEcosystem(lock) === 'pypi') continue;
    else plan.push({ command: 'composer', args: ['update', '--with-dependencies', '--no-interaction', ...packages], cwd: directory });
  }
  for (const directory of new Set(plan.filter(step => step.command === 'go').map(step => step.cwd))) plan.push({ command: 'go', args: ['mod', 'tidy'], cwd: directory });
  return plan;
}

function print(result: { notes: string[]; lines: string[] }) {
  for (const note of result.notes) say(note);
  for (const line of result.lines) say(`${line}.`);
  say(result.lines.length
    ? `${result.lines.length} finding${result.lines.length === 1 ? '' : 's'}`
    : 'no newer stable release without an exception and no advisory without an exception');
}

if (isMain(import.meta.url)) {
  const args = process.argv.slice(2);
  let root = ROOT;
  let record = false;
  let update = false;
  for (let index = 0; index < args.length; index += 1) {
    // The condition checks that the argument after --root is present.
    if (args[index] === '--root' && args[index + 1]) root = path.resolve(args[++index]!);
    else if (args[index] === '--record') record = true;
    else if (args[index] === '--update') update = true;
    else {
      console.error('Usage: node scripts/kit/dependency-review.mts [--root <checkout>] [--record] [--update]');
      process.exit(2);
    }
  }
  let result = review(root);
  if (update) {
    print(result);
    const plan = updatePlan(result);
    let failed = 0;
    for (const step of plan) {
      say(`run ${step.command} ${step.args.join(' ')} in ${step.cwd}`);
      const outcome = spawnSync(step.command, step.args, { cwd: path.join(root, step.cwd), stdio: 'inherit' });
      if (outcome.error || outcome.status !== 0) {
        failed += 1;
        say(`${step.command} ${step.args.join(' ')} in ${step.cwd} ended with ${outcome.error?.message ?? `exit status ${outcome.status}`}`);
      }
    }
    say(`${plan.length - failed} of ${plan.length} update commands passed; reviewing again`);
    result = review(root);
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
