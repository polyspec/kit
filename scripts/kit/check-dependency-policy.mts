#!/usr/bin/env node
// The dependency gate of `make dependency-policy-check`. It reads only files of the checkout and queries no registry, so
// one tree gives one result at any time. It compares the manifests and locks with the policy
// config/dependency-policy.json and with the review record config/dependency-review.json, which the developer command
// `make dependency-review RECORD=1` writes from the registries. It reports every finding with the rule that the finding
// breaks and its fix, one line each, and fails when there is one.
//
//   node scripts/kit/check-dependency-policy.mts [--root <checkout>]
import { existsSync } from 'node:fs';
import path from 'node:path';
import { POLICY, RECORD, UPDATE, acceptedText, advisoryExceptions, advisoryKey, completeAdvisoryException, dependencyKey, lockEcosystem, lockFix, localSpecDirectory, readState, advisoryRelease } from './dependency-state.mts';
import { isPrerelease, isVersionText, older } from './version.mts';
import { isMain, repositoryRoot } from './paths.mts';
import { execute } from './process.mts';
import { fileDigest } from './bootstrap/digest.mts';
import { ConfigError, readConfig, readConfigFindings } from './schema-validate.mts';
import { readComposerLock, readComposerManifest, readNpmManifest } from './manifests.mts';
import type { DependencyPolicy } from './dependency-state.mts';
import { present } from './present.mts';
import { checkedFiles } from './tracked-files.mts';
import { copiesOf, runningKit, writtenByKit } from './kit-check.mts';
import { SYMBOLS } from './install-symbols.mts';
import { CONFIG as RELEASE_CONFIG } from './release.mts';
import type { ConsumerConfig } from './release-consumer-config.mts';

export const RULES = {
  policy: `${POLICY} names its Composer platforms and Python manifests and declares each exception for a registry dependency with a reason, a removal condition and verification commands`,
  platform: 'each Composer manifest resolves its lock for the declared minimum PHP of the policy',
  composerLock: 'each Composer lock is current for its manifest, as composer validate --strict reads it without a network',
  composerPackage: 'each published Composer manifest of packages/ is valid, as composer validate reads it without a lock and without a network',
  composerCoverage: `each Composer manifest of the checkout is checked: composerPlatforms of ${POLICY} names it, or a manifest that it names requires it through a path repository; a manifest that kit writes and the Composer consumer project of the release are not`,
  local: 'a package of this repository is required at its own version and locked at it',
  tagged: 'a polyspec package taken from a GitHub tag is linked to the checkout of its tag, has the version of that tag and is locked at it',
  pythonLock: 'each Python lock that the policy names is a PEP 751 pylock.toml with lock-version 1.0 and created-by, every registry file has a sha256, every git package is pinned by a full commit and no package is a local directory',
  npmLock: 'each npm lock that the policy names records the dependencies of every npm manifest that it resolves',
  record: 'every registry dependency and every lock has an entry in the review record that matches the committed manifests and locks',
  latest: 'a registry dependency is locked at the latest stable release known at its review, unless the policy holds an exception for it',
  stale: 'an exception names a dependency that its review found at the latest stable release',
  advisory: 'a lock had no known advisory at its review (npm: moderate, high or critical; Composer: every advisory and abandoned package), unless advisoryExceptions of the policy accepts it with its reason and removal condition',
  staleAdvisory: 'an advisory exception names an advisory that the review of its lock found',
};
export const REVIEW = 'make dependency-review RECORD=1';

/** The rule of a finding: a key of RULES. */
export type Rule = keyof typeof RULES;
/** A finding of the gate: the rule it breaks, its subject, the problem and the fix. */
export type Finding = { rule: Rule; subject: string; problem: string; fix: string };
/** An advisory that the review found for a package of a lock. */
export type Advisory = { package: string; version?: string; range?: string; id: string; severity: string; title: string; url?: string };
/** A git package of a lock as the review recorded it: its URL, requested revision and commit. */
type ReviewedPin = { lock: string; package: string; url: string; requestedRevision: string; commitId: string };
/**
 * The review record config/dependency-review.json (schema scripts/kit/schema/dependency-review.schema.json), in the fields
 * that the gate reads.
 */
export type ReviewRecord = {
  schema: number;
  comment: string;
  reviewed: string;
  locks: { lock: string; sha256: string; advisories?: Advisory[] }[];
  dependencies: { ecosystem: string; manifest: string; package: string; version: string; latest: string }[];
  vcs: ReviewedPin[];
};

/** config/dependency-policy.json (schema scripts/kit/schema/dependency-policy.schema.json), in the fields that the gate reads. */
type Policy = DependencyPolicy & {
  exceptions: { ecosystem: string; manifest: string; package: string; reason: string; removalCondition: string; verification: string[] }[];
  composerPlatforms: { manifest: string; php: string }[];
};

const nonEmpty = (value: unknown) => typeof value === 'string' && value.trim() !== '';

/** The output of `composer validate <args>` in `cwd` as one line when it fails, or null; COMPOSER_DISABLE_NETWORK keeps it off the network. */
function composerValidation(composer: string, args: string[], cwd: string) {
  const validate = execute(composer, ['validate', ...args], { cwd, env: { ...process.env, COMPOSER_DISABLE_NETWORK: '1' } });
  if (!validate.error && validate.status === 0) return null;
  return `${validate.error?.message ?? ''}\n${validate.stdout ?? ''}\n${validate.stderr ?? ''}`.split('\n').map(line => line.trim()).filter(Boolean).join(' ');
}

/** The findings of the checkout at `root`: `{ rule, subject, problem, fix }`. */
export function check(root: string, { composer = 'composer' }: { composer?: string } = {}) {
  const findings: Finding[] = [];
  const add = (rule: Rule, subject: string, problem: string, fix: string) => findings.push({ rule, subject, problem, fix });

  const { value: policy, errors } = readConfigFindings<Policy>(root, POLICY, 'dependency-policy.schema.json');
  if (errors) {
    add('policy', POLICY, errors.join('; '), `restore the schema of ${POLICY} (dependency-policy.schema.json)`);
    return findings;
  }
  const state = readState(root, policy);
  const declared = new Map(state.dependencies.map(dependency => [dependencyKey(dependency), dependency]));

  const exceptions = new Map();
  for (const exception of policy.exceptions) {
    const key = dependencyKey(exception);
    const complete = ['npm', 'composer', 'pypi', 'go'].includes(exception.ecosystem) && nonEmpty(exception.manifest) && nonEmpty(exception.package)
      && nonEmpty(exception.reason) && nonEmpty(exception.removalCondition)
      && Array.isArray(exception.verification) && exception.verification.length > 0 && exception.verification.every(nonEmpty);
    if (!complete) add('policy', key, 'the exception lacks an ecosystem, manifest, package, reason, removal condition or verification command', `complete the exception in ${POLICY}`);
    if (exceptions.has(key)) add('policy', key, 'the exception is declared twice', `remove the duplicate from ${POLICY}`);
    if (!declared.has(key)) add('policy', key, 'the exception names no registry dependency of its manifest', `remove the exception from ${POLICY} or name the manifest that declares the dependency`);
    exceptions.set(key, exception);
  }

  const accepted = advisoryExceptions(policy);
  const seen = new Set<string>();
  for (const exception of policy.advisoryExceptions ?? []) {
    const key = advisoryKey(String(exception.lock), String(exception.package), String(exception.advisory));
    if (!completeAdvisoryException(exception)) add('policy', POLICY, `the advisory exception ${String(exception.advisory)} of ${String(exception.lock)} ${String(exception.package)} lacks a lock, package, advisory, reason or removal condition`, `complete the exception in ${POLICY}`);
    if (seen.has(key)) add('policy', key, 'the advisory exception is declared twice', `remove the duplicate from ${POLICY}`);
    seen.add(key);
  }

  for (const platform of policy.composerPlatforms) {
    const manifestPath = platform.manifest;
    if (typeof manifestPath !== 'string' || !/^\d+\.\d+\.\d+$/.test(platform.php)) {
      add('platform', String(manifestPath), 'the Composer platform has no manifest or no PHP version <major>.<minor>.<patch>', `correct the entry in ${POLICY}`);
      continue;
    }
    const directory = path.posix.dirname(manifestPath);
    const composerManifest = readComposerManifest(root, manifestPath);
    const lockPath = path.posix.join(directory, 'composer.lock');
    const composerLock = readComposerLock(root, lockPath);
    if (composerManifest.config?.platform?.php !== platform.php) add('platform', manifestPath, `config.platform.php is ${String(composerManifest.config?.platform?.php ?? 'absent')}, the policy declares ${platform.php}`, `set config.platform.php to ${platform.php} and run composer update --lock in ${directory}`);
    if (composerLock['platform-overrides']?.php !== platform.php) add('platform', lockPath, `the lock was resolved for PHP ${composerLock['platform-overrides']?.php ?? 'without a platform override'}, the policy declares ${platform.php}`, `run composer update --lock in ${directory}`);
    // composer validate reads the manifest and the lock; COMPOSER_DISABLE_NETWORK keeps it off the network. A published
    // composer.json declares its version, which the artifact repository of its release zip reads, so the warning on a
    // version field is not reported.
    const failure = composerValidation(composer, ['--strict', '--no-interaction', '--no-check-publish', '--no-check-version'], path.join(root, directory));
    if (failure) add('composerLock', manifestPath, `composer validate --strict failed: ${failure}`, `run composer update --lock in ${directory}`);
  }

  // The published Composer manifests have no lock: the development root composer.json resolves them.
  const published = state.local.filter(item => item.ecosystem === 'composer').map(item => path.posix.join(path.posix.dirname(item.manifest), item.directory, 'composer.json'));
  for (const manifestPath of published) {
    const failure = composerValidation(composer, ['--no-check-lock', '--no-check-publish', '--no-interaction'], path.join(root, path.posix.dirname(manifestPath)));
    if (failure) add('composerPackage', manifestPath, `composer validate failed: ${failure}`, `fix ${manifestPath}`);
  }

  // Every Composer manifest of the checkout is one of the above (K181): a manifest that no entry of composerPlatforms covers
  // escapes composer validate --strict, so its lock goes stale unnoticed, such as after a version bump without composer
  // update --lock. Not checked here: a manifest that kit writes (the copies of kit-sync and the PHPUnit project), the Composer
  // project of the symbol extractor that kit ships, and the Composer consumer project of config/release.json, which
  // make release-consumer resolves from the release archives.
  const covered = new Set([...policy.composerPlatforms.map(platform => platform.manifest), ...published]);
  const kitFile = writtenByKit(copiesOf(runningKit()));
  const shipped = path.relative(root, SYMBOLS).split(path.sep).join('/');
  // A release configuration that breaks its schema names no consumer project here; make release-coverage reports it.
  const consumer = existsSync(path.join(root, RELEASE_CONFIG)) ? readConfigFindings<ConsumerConfig>(root, RELEASE_CONFIG, 'release.schema.json').value?.consumers?.composer?.directory : undefined;
  for (const file of checkedFiles(root).filter(item => path.posix.basename(item) === 'composer.json')) {
    if (covered.has(file) || kitFile(file) || file.startsWith(`${shipped}/`) || (consumer !== undefined && file === path.posix.join(consumer, 'composer.json'))) continue;
    add('composerCoverage', file, `no entry of composerPlatforms of ${POLICY} names the manifest and no manifest that it names requires it through a path repository, so composer validate --strict never reads it or its lock`, `add { "manifest": "${file}", "php": "<the minimum PHP>" } to composerPlatforms of ${POLICY}, or require the package through a path repository of a manifest that composerPlatforms names`);
  }

  for (const item of state.local) {
    const subject = `${item.manifest} ${item.package}`;
    if (item.ecosystem === 'npm') {
      if (item.directory === null) add('local', subject, `${item.lock} links it to no package of this repository`, 'run npm install');
      else if (item.name !== item.package) add('local', subject, `${item.directory} is the package ${item.name ?? 'without a name'}`, 'run npm install');
      else if (item.spec !== item.version && localSpecDirectory(item.base, item.spec) !== item.directory) add('local', subject, `the manifest requires ${item.spec}, ${item.directory} has version ${item.version}`, `require ${item.version} and run npm install`);
      else if (item.lockVersion !== item.version) add('local', subject, `${item.lock} records version ${item.lockVersion ?? 'none'}, ${item.directory} has version ${item.version}`, 'run npm install');
    } else if (item.lockVersion !== item.version) {
      add('local', subject, `the lock records version ${item.lockVersion}, the manifest requires ${item.version}`, `run composer update --lock in ${path.posix.dirname(item.manifest)}`);
    }
  }

  for (const item of state.tagged) {
    const subject = `${item.manifest} ${item.package}`;
    const { directory, repository, tag, version } = item.release;
    if (localSpecDirectory(item.base, item.spec) !== directory) add('tagged', subject, `the manifest requires ${item.spec}, the checkout of ${repository} ${tag} is ${directory}`, `require file:${path.posix.relative(item.base, directory)} and run npm install`);
    else if (item.directory !== directory) add('tagged', subject, `${item.lock} links it to ${item.directory ?? 'no directory'}, the checkout of ${repository} ${tag} is ${directory}`, 'run npm install');
    else if (item.version !== version) add('tagged', subject, `${directory} has version ${item.version ?? 'none'}, the tag ${tag} has version ${version}`, item.release.fix);
    else if (item.name !== item.package) add('tagged', subject, `${directory} is the package ${item.name ?? 'without a name'}`, `require the package that ${directory} names and run npm install`);
    else if (item.lockVersion !== version) add('tagged', subject, `${item.lock} records version ${item.lockVersion ?? 'none'}, the tag ${tag} has version ${version}`, 'run npm install');
  }

  for (const { directory, manifest: manifestPath, lock } of state.manifests) {
    const manifest = readNpmManifest(root, manifestPath);
    const npmLock = state.npmLocks.get(lock);
    if (!npmLock) throw new Error(`${lock}: readState read no npm lock for ${manifestPath}, whose lock it names`);
    const lockEntry = npmLock.packages?.[directory === '.' ? '' : directory] ?? {};
    for (const kind of ['dependencies', 'devDependencies'] as const) {
      const inManifest = manifest[kind] ?? {};
      const inLock = lockEntry[kind] ?? {};
      for (const name of new Set([...Object.keys(inManifest), ...Object.keys(inLock)])) {
        if (inManifest[name] !== inLock[name]) add('npmLock', `${lock} ${directory} ${kind} ${name}`, `the lock records ${inLock[name] ?? 'nothing'}, ${manifestPath} declares ${inManifest[name] ?? 'nothing'}`, 'run npm install');
      }
    }
  }

  for (const { lock, createdBy, packages } of state.pythonLocks) {
    if (createdBy === null) add('pythonLock', lock, 'the lock names no tool in created-by', 'write the lock with uv export --format pylock.toml or with pip lock, which set created-by');
    for (const item of packages) {
      const subject = `${lock} ${item.name}`;
      const fix = lockFix(lock, createdBy, item.name);
      if (item.kind === 'none') add('pythonLock', subject, 'the package has no source table (vcs, archive, sdist or wheels)', fix);
      else if (item.kind === 'directory') add('pythonLock', subject, 'is a local directory; a consumer exports the lock without the project, so no local package is installed from it', `remove the local package from the project; ${fix}`);
      else if (item.kind === 'vcs' && item.vcs.type !== 'git') add('pythonLock', subject, `the vcs type is ${item.vcs.type ?? 'absent'}, only git is reviewed`, fix);
      else if (item.kind === 'vcs' && !/^[0-9a-f]{40}$/.test(String(item.vcs.commitId ?? ''))) add('pythonLock', subject, `commit-id is ${item.vcs.commitId ?? 'absent'}, a git commit is 40 hexadecimal digits`, fix);
      else if (item.kind === 'registry' || item.kind === 'archive') {
        for (const file of item.files) if (file.sha256 === null) add('pythonLock', subject, `${file.url ?? 'a file'} has no sha256`, fix);
      }
    }
  }
  if (!existsSync(path.join(root, RECORD))) {
    add('record', RECORD, 'the review record does not exist', REVIEW);
    return findings;
  }
  const { value: record, errors: recordErrors } = readConfigFindings<ReviewRecord>(root, RECORD, 'dependency-review.schema.json');
  if (recordErrors) {
    add('record', RECORD, `the record breaks dependency-review.schema.json: ${recordErrors.join('; ')}`, REVIEW);
    return findings;
  }

  // The Python lock `lock` of the state: a lock of the record whose ecosystem is pypi is one of the pythonLocks of the policy.
  const pythonLock = (lock: string) => {
    const found = state.pythonLocks.find(item => item.lock === lock);
    if (found === undefined) throw new Error(`${lock}: the lock is a pypi lock of ${RECORD} and no entry of pythonLocks in ${POLICY}`);
    return found;
  };
  const recordedLocks = new Map(record.locks.map(entry => [entry.lock, entry]));
  for (const lock of state.locks) {
    const entry = recordedLocks.get(lock);
    if (!entry) {
      add('record', lock, 'the lock has no entry in the review record', REVIEW);
      continue;
    }
    const actual = fileDigest(path.join(root, lock));
    if (entry.sha256 !== actual) add('record', lock, `the lock changed after the review of ${record.reviewed}: its sha256 is ${actual}, the review recorded ${entry.sha256}`, REVIEW);
    for (const advisory of entry.advisories ?? []) {
      if (accepted.has(advisoryKey(lock, advisory.package, advisory.id))) continue;
      const fix = lockEcosystem(lock) === 'pypi'
        ? lockFix(lock, pythonLock(lock).createdBy, advisory.package)
        : `${UPDATE}, which updates the affected package and records the review`;
      add('advisory', `${lock} ${advisory.package} ${advisoryRelease(advisory)}`, `the review of ${record.reviewed} found advisory ${advisory.id} (${advisory.severity}) ${advisory.title}${advisory.url ? ` ${advisory.url}` : ''}`, fix);
    }
  }
  for (const lock of recordedLocks.keys()) if (!state.locks.includes(lock)) add('record', lock, 'the review record names a lock that the checkout does not review', REVIEW);
  // An advisory exception names an advisory that the review recorded for its lock; otherwise it is stale.
  for (const exception of accepted.values()) {
    const advisories = recordedLocks.get(exception.lock)?.advisories ?? [];
    if (!advisories.some(advisory => advisory.package === exception.package && advisory.id === exception.advisory)) {
      add('staleAdvisory', `${exception.lock} ${exception.package}`, `the review of ${record.reviewed} found no advisory ${exception.advisory}, and ${POLICY} holds an exception for it`, `remove the exception from ${POLICY}`);
    }
  }

  // A git package of a lock is pinned by its commit: the record holds the same URL, requested revision and commit as the lock.
  const pinned = new Map(state.vcs.map(item => [`${item.lock} ${item.package}`, item]));
  const reviewedPins = new Map(record.vcs.map(item => [`${item.lock} ${item.package}`, item]));
  const pin = ({ url, requestedRevision, commitId }: { url: unknown; requestedRevision: unknown; commitId: unknown }) => JSON.stringify({ url, requestedRevision, commitId });
  for (const [key, item] of pinned) {
    const entry = reviewedPins.get(key);
    if (!entry) add('record', `${item.lock} ${item.package}`, 'the git package has no entry in the review record', REVIEW);
    else if (pin(entry) !== pin(item)) add('record', `${item.lock} ${item.package}`, `the lock pins ${item.commitId} at ${item.requestedRevision}, the review of ${record.reviewed} recorded ${entry.commitId} at ${entry.requestedRevision}`, REVIEW);
  }
  for (const key of reviewedPins.keys()) if (!pinned.has(key)) add('record', key, 'the review record names a git package that no lock pins', REVIEW);

  const recorded = new Map(record.dependencies.map(entry => [dependencyKey(entry), entry]));
  for (const [key, dependency] of declared) {
    const entry = recorded.get(key);
    const subject = `${dependency.manifest} ${dependency.package}`;
    if (!entry) {
      add('record', subject, 'the registry dependency has no entry in the review record', REVIEW);
      continue;
    }
    if (entry.version !== dependency.version) {
      add('record', subject, `the lock holds ${dependency.version ?? 'no version'}, the review of ${record.reviewed} recorded ${entry.version}`, REVIEW);
      continue;
    }
    // Composer chose the latest release under the declared minimum-stability of the manifest, so kit judges no Composer stability.
    if (!nonEmpty(entry.latest) || !isVersionText(entry.latest) || (dependency.ecosystem !== 'composer' && isPrerelease(dependency.ecosystem, entry.latest))) {
      add('record', subject, `the review recorded ${entry.latest} as the latest stable release`, REVIEW);
      continue;
    }
    const outdated = older(dependency.ecosystem, entry.version, entry.latest);
    if (outdated && !exceptions.has(key)) add('latest', subject, `${entry.version} is older than ${entry.latest}, the latest stable release at the review of ${record.reviewed}, and ${POLICY} holds no exception for it`, `${dependency.kind === 'lock' ? lockFix(dependency.lock, dependency.createdBy, dependency.package) : UPDATE}, or add an exception with its reason, removal condition and verification to ${POLICY}`);
    if (!outdated && exceptions.has(key)) add('stale', subject, `the review of ${record.reviewed} found ${entry.version}, the latest stable release, and ${POLICY} holds an exception for it`, `remove the exception from ${POLICY}`);
  }
  for (const key of recorded.keys()) if (!declared.has(key)) add('record', key, 'the review record names a dependency that no manifest declares', REVIEW);
  return findings;
}

/** The line of each advisory of the review record of `root` that advisoryExceptions of its policy accepts, with its reason. */
export function acceptedAdvisories(root: string): string[] {
  if (!existsSync(path.join(root, RECORD))) return [];
  // A policy or a record that breaks its schema is a finding of check, which names its errors; it accepts no advisory.
  const { value: policy } = readConfigFindings<DependencyPolicy>(root, POLICY, 'dependency-policy.schema.json');
  const { value: record } = readConfigFindings<ReviewRecord>(root, RECORD, 'dependency-review.schema.json');
  if (!policy || !record) return [];
  const accepted = advisoryExceptions(policy);
  return (record.locks ?? []).flatMap(entry => (entry.advisories ?? []).flatMap((advisory) => {
    const exception = accepted.get(advisoryKey(entry.lock, advisory.package, advisory.id));
    return exception ? [`[dependency-policy] ${entry.lock} ${advisory.package} ${advisoryRelease(advisory)}: advisory ${advisory.id} (${advisory.severity}) ${advisory.title} ${acceptedText(exception)}`] : [];
  }));
}

/** The line of a finding. */
export const findingLine = (finding: Finding) => `[dependency-policy] ${finding.subject}: ${finding.problem}. Rule: ${RULES[finding.rule]}. Fix: ${finding.fix}.`;

function main(): void {
  const args = process.argv.slice(2);
  if (!(args.length === 0 || (args.length === 2 && args[0] === '--root'))) {
    console.error('Usage: node scripts/kit/check-dependency-policy.mts [--root <checkout>]');
    process.exit(2);
  }
  // The usage check above accepts no argument or two, so args[1] exists when args is not empty.
  const root = args.length ? path.resolve(present(args[1], 'args[1]')) : repositoryRoot();
  const findings = check(root);
  const accepted = acceptedAdvisories(root);
  for (const line of accepted) process.stdout.write(`${line}\n`);
  if (findings.length) {
    for (const finding of findings) console.error(findingLine(finding));
    console.error(`[dependency-policy] ${findings.length} finding${findings.length === 1 ? '' : 's'}; the check reads only the files of the checkout and queries no registry`);
    process.exit(1);
  }
  const record = readConfig<ReviewRecord>(root, RECORD, 'dependency-review.schema.json');
  const policy = readConfig<Policy>(root, POLICY, 'dependency-policy.schema.json');
  process.stdout.write(`[dependency-policy] ${record.dependencies.length} registry dependencies and ${record.locks.length} locks match the review of ${record.reviewed}; ${policy.exceptions.length} stable-version exceptions; ${accepted.length ? `${accepted.length} accepted ${accepted.length === 1 ? 'advisory' : 'advisories'}` : 'no advisory'}\n`);
}

if (isMain(import.meta.url)) {
  try {
    main();
  } catch (error) {
    // A missing configuration is a message for the developer; every other error keeps its stack (K146).
    if (!(error instanceof ConfigError)) throw error;
    console.error(`[dependency-policy] ${error.message}`);
    process.exit(1);
  }
}
