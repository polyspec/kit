#!/usr/bin/env node
// The dependency gate of the verification suite (T18.10): `make dependency-policy-check`. It reads only files of the
// checkout and queries no registry, so one tree gives one result at any time. It compares the manifests and locks with
// the policy config/dependency-policy.json and with the review record config/dependency-review.json, which the
// developer command `make dependency-review RECORD=1` writes from the registries. It reports every finding with the
// rule that the finding breaks and its fix, one line each, and fails when there is one.
//
//   node scripts/check-dependency-policy.mjs [--root <checkout>]
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { POLICY, RECORD, NPM_MANIFEST, dependencyKey, digest, isPrerelease, older, readJson, readState } from './dependency-state.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

export const RULES = {
  policy: 'config/dependency-policy.json declares each exception for a registry dependency with a reason, a removal condition and verification commands',
  platform: 'each Composer manifest resolves its lock for the declared minimum PHP of the policy, and its lock is current',
  local: 'a package of this repository is locked at the version of its package.json',
  npmLock: 'package-lock.json records the dependencies of package.json',
  record: 'every registry dependency and every lock has an entry in the review record that matches the committed manifests and locks',
  latest: 'a registry dependency is locked at the latest stable release known at its review, unless the policy holds an exception for it',
  stale: 'an exception names a dependency that its review found older than the latest stable release',
  advisory: 'a lock has no known advisory at the configured severity at its review',
};
export const REVIEW = 'make dependency-review RECORD=1';
export const UPDATE = 'make dependency-review UPDATE=1';

/** The findings of the checkout at `root`: `{ rule, subject, problem, fix }`. */
export function check(root) {
  const findings = [];
  const add = (rule, subject, problem, fix) => findings.push({ rule, subject, problem, fix });

  const policy = readJson(root, POLICY);
  if (policy.schema !== 1 || !Array.isArray(policy.composerPlatforms) || !Array.isArray(policy.exceptions)) {
    add('policy', POLICY, 'the schema is not 1 with composerPlatforms and exceptions', `restore the schema of ${POLICY}`);
    return findings;
  }
  const state = readState(root, policy);
  const declared = new Map(state.dependencies.map(dependency => [dependencyKey(dependency), dependency]));

  const exceptions = new Map();
  for (const exception of policy.exceptions) {
    const key = dependencyKey(exception);
    const complete = ['npm', 'composer'].includes(exception.ecosystem) && typeof exception.manifest === 'string' && typeof exception.package === 'string'
      && typeof exception.reason === 'string' && exception.reason.trim() && typeof exception.removalCondition === 'string' && exception.removalCondition.trim()
      && Array.isArray(exception.verification) && exception.verification.length > 0;
    if (!complete) add('policy', key, 'the exception lacks an ecosystem, manifest, package, reason, removal condition or verification command', `complete the exception in ${POLICY}`);
    if (exceptions.has(key)) add('policy', key, 'the exception is declared twice', `remove the duplicate from ${POLICY}`);
    if (!declared.has(key)) add('policy', key, 'the exception names no registry dependency of its manifest', `remove the exception from ${POLICY} or name the manifest that declares the dependency`);
    exceptions.set(key, exception);
  }

  for (const platform of policy.composerPlatforms) {
    if (typeof platform.manifest !== 'string' || !/^\d+\.\d+\.\d+$/.test(platform.php)) {
      add('platform', String(platform.manifest), 'the Composer platform has no manifest or no PHP version <major>.<minor>.<patch>', `correct the entry in ${POLICY}`);
      continue;
    }
    const directory = dirname(platform.manifest);
    const manifest = readJson(root, platform.manifest);
    const lockPath = join(directory, 'composer.lock');
    const lock = readJson(root, lockPath);
    if (manifest.config?.platform?.php !== platform.php) add('platform', platform.manifest, `config.platform.php is ${manifest.config?.platform?.php ?? 'absent'}, the policy declares ${platform.php}`, `set config.platform.php to ${platform.php} and run composer update --lock in ${directory}`);
    if (lock['platform-overrides']?.php !== platform.php) add('platform', lockPath, `the lock was resolved for PHP ${lock['platform-overrides']?.php ?? 'without a platform override'}, the policy declares ${platform.php}`, `run composer update --lock in ${directory}`);
    // composer validate reads the manifest and the lock; COMPOSER_DISABLE_NETWORK keeps it off the network. Each published
    // composer.json declares its version, which an artifact repository of its release zip reads (scripts/release.mjs), so
    // the warning on a version field is not reported.
    const validate = spawnSync('composer', ['validate', '--strict', '--no-interaction', '--no-check-publish', '--no-check-version'], {
      cwd: join(root, directory), encoding: 'utf8', env: { ...process.env, COMPOSER_DISABLE_NETWORK: '1' },
    });
    if (validate.error || validate.status !== 0) {
      const output = `${validate.error?.message ?? ''}\n${validate.stdout}\n${validate.stderr}`.split('\n').map(line => line.trim()).filter(Boolean).join(' ');
      add('platform', platform.manifest, `composer validate --strict failed: ${output}`, `run composer update --lock in ${directory}`);
    }
  }

  for (const item of state.local) {
    const subject = `${item.manifest} ${item.package}`;
    if (item.manifest === NPM_MANIFEST) {
      const expected = item.spec.replace(/^(link|workspace):/, 'file:');
      if (item.lockResolved !== expected) add('local', subject, `package-lock.json resolves it to ${item.lockResolved ?? 'nothing'}, package.json declares ${item.spec}`, 'run npm install');
    }
    if (item.version === null) add('local', subject, `${item.directory} has no package.json with a version`, `declare the package in ${item.directory}`);
    else if (item.lockVersion !== item.version) add('local', subject, `the lock records version ${item.lockVersion ?? 'none'}, ${item.directory} has version ${item.version}`, 'run npm install');
  }

  const lockRoot = state.npmLock.packages?.[''] ?? {};
  for (const kind of ['dependencies', 'devDependencies']) {
    const inManifest = state.npmManifest[kind] ?? {};
    const inLock = lockRoot[kind] ?? {};
    for (const name of new Set([...Object.keys(inManifest), ...Object.keys(inLock)])) {
      if (inManifest[name] !== inLock[name]) add('npmLock', `package-lock.json ${kind} ${name}`, `the lock records ${inLock[name] ?? 'nothing'}, package.json declares ${inManifest[name] ?? 'nothing'}`, 'run npm install');
    }
  }

  if (!existsSync(join(root, RECORD))) {
    add('record', RECORD, 'the review record does not exist', REVIEW);
    return findings;
  }
  const record = readJson(root, RECORD);
  if (record.schema !== 1 || typeof record.reviewed !== 'string' || !Array.isArray(record.locks) || !Array.isArray(record.dependencies)) {
    add('record', RECORD, 'the schema is not 1 with reviewed, locks and dependencies', REVIEW);
    return findings;
  }

  const recordedLocks = new Map(record.locks.map(entry => [entry.lock, entry]));
  for (const lock of state.locks) {
    const entry = recordedLocks.get(lock);
    if (!entry) {
      add('record', lock, 'the lock has no entry in the review record', REVIEW);
      continue;
    }
    const actual = digest(root, lock);
    if (entry.sha256 !== actual) add('record', lock, `the lock changed after the review of ${record.reviewed}: its sha256 is ${actual}, the review recorded ${entry.sha256}`, REVIEW);
    for (const advisory of entry.advisories ?? []) {
      add('advisory', `${lock} ${advisory.package} ${advisory.version}`, `the review of ${record.reviewed} found advisory ${advisory.id} (${advisory.severity}) ${advisory.title}${advisory.url ? ` ${advisory.url}` : ''}`, `${UPDATE}, which updates the affected package and records the review`);
    }
  }
  for (const lock of recordedLocks.keys()) if (!state.locks.includes(lock)) add('record', lock, 'the review record names a lock that the policy does not declare', REVIEW);

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
    if (typeof entry.latest !== 'string' || isPrerelease(entry.latest)) {
      add('record', subject, `the review recorded ${entry.latest} as the latest stable release`, REVIEW);
      continue;
    }
    const outdated = older(entry.version, entry.latest);
    if (outdated && !exceptions.has(key)) add('latest', subject, `${entry.version} is older than ${entry.latest}, the latest stable release at the review of ${record.reviewed}, and ${POLICY} holds no exception for it`, `${UPDATE}, or add an exception with its reason, removal condition and verification to ${POLICY}`);
    if (!outdated && exceptions.has(key)) add('stale', subject, `the review of ${record.reviewed} found ${entry.version}, the latest stable release, and ${POLICY} holds an exception for it`, `remove the exception from ${POLICY}`);
  }
  for (const key of recorded.keys()) if (!declared.has(key)) add('record', key, 'the review record names a dependency that no manifest declares', REVIEW);
  return findings;
}

/** The line of a finding. */
export const findingLine = finding => `[dependency-policy] ${finding.subject}: ${finding.problem}. Rule: ${RULES[finding.rule]}. Fix: ${finding.fix}.`;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (!(args.length === 0 || (args.length === 2 && args[0] === '--root'))) {
    console.error('Usage: node scripts/check-dependency-policy.mjs [--root <checkout>]');
    process.exit(2);
  }
  const root = args.length ? resolve(args[1]) : ROOT;
  const findings = check(root);
  if (findings.length) {
    for (const finding of findings) console.error(findingLine(finding));
    console.error(`[dependency-policy] ${findings.length} finding${findings.length === 1 ? '' : 's'}; the check reads only the files of the checkout and queries no registry`);
    process.exit(1);
  }
  const record = readJson(root, RECORD);
  const policy = readJson(root, POLICY);
  console.log(`[dependency-policy] ${record.dependencies.length} registry dependencies and ${record.locks.length} locks match the review of ${record.reviewed}; ${policy.exceptions.length} justified stable-version exceptions; no advisory`);
}
