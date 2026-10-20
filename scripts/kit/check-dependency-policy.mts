#!/usr/bin/env node
// The dependency gate of `make dependency-policy-check`. It reads only files of the checkout and queries no registry, so
// one tree gives one result at any time. It compares the manifests and locks with the policy
// config/dependency-policy.json and with the review record config/dependency-review.json, which the developer command
// `make dependency-review RECORD=1` writes from the registries. It reports every finding with the rule that the finding
// breaks and its fix, one line each, and fails when there is one.
//
//   node scripts/kit/check-dependency-policy.mts [--root <checkout>]
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { POLICY, RECORD, UPDATE, acceptedText, advisoryExceptions, advisoryKey, completeAdvisoryException, dependencyKey, lockEcosystem, lockFix, localSpecDirectory, readState, advisoryRelease } from './dependency-state.mts';
import { isPrerelease, isVersionText, older } from './version.mts';
import { satisfies } from './composer-constraint.mts';
import { isMain, repositoryRoot } from './paths.mts';
import { execute } from './process.mts';
import { fileDigest } from './bootstrap/digest.mts';
import { ConfigError, readConfig, readConfigFindings } from './schema-validate.mts';
import { readComposerLock, readComposerManifest, readComposerManifestFile, readNpmLock, readNpmManifest } from './manifests.mts';
import type { ComposerPackage } from './manifests.mts';
import type { DependencyPolicy } from './dependency-state.mts';
import { present } from './present.mts';
import { isLinked } from './linked-package.mts';
import { siblingCheckouts, trackedManifests } from './link-providers.mts';
import { checkedFiles } from './tracked-files.mts';
import { copiesOf, runningKit, writtenByKit } from './kit-check.mts';
import { SYMBOLS } from './install-symbols.mts';
import { CONFIG as RELEASE_CONFIG } from './release.mts';
import type { ConsumerConfig } from './release-consumer-config.mts';
import { libraryFolders } from './php-extension.mts';

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
  sharedPin: 'a package that the repository and a sibling checkout both require directly is locked at one version from one source in both (S4)',
  libraryApplication: 'a PHP library of S10 requires no application framework in require, since an application on a userland framework is its own Composer package that requires the library (S10)',
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

// The patch of the one PHP platform: PHPUnit 13 requires PHP >= 8.4.1 (config/phpunit/composer.lock), so the platform of a
// repository is the minor of .php-version with this patch.
const PLATFORM_PATCH = 1;
const PHP_VERSION = '.php-version';

// The application frameworks that a PHP library of S10 may not require in require: an internal class cannot extend a userland class.
const APPLICATION_FRAMEWORKS = ['symfony/console', 'symfony/framework-bundle', 'symfony/http-kernel', 'laravel/framework', 'laminas/laminas-mvc'];

const nonEmpty = (value: unknown) => typeof value === 'string' && value.trim() !== '';

// The files that a link run writes beside a Composer project (link.mts, K304-1).
const LINK_MANIFEST = 'composer.link.json';
const LINK_LOCK = 'composer.link.lock';

/** The findings of the link lock of the project `directory`: a package of a path repository of the link manifest is locked from its path. */
function linkFindings(root: string, directory: string, lock: ReturnType<typeof readComposerLock>, add: (rule: Rule, subject: string, problem: string, fix: string) => void) {
  const manifest = readComposerManifest(root, path.posix.join(directory, LINK_MANIFEST));
  const names = new Set<string>();
  for (const repository of manifest.repositories ?? []) {
    const file = repository.type === 'path' && repository.url !== undefined ? path.resolve(root, directory, repository.url, 'composer.json') : undefined;
    const name = file !== undefined && existsSync(file) ? readComposerManifestFile(file).name : undefined;
    if (name !== undefined) names.add(name);
  }
  for (const item of [...(lock.packages ?? []), ...(lock['packages-dev'] ?? [])]) {
    if (names.has(item.name) && item.dist?.type !== 'path') add('platform', path.posix.join(directory, LINK_LOCK), `${item.name} is linked but locked from a ${item.dist?.type ?? 'missing'} dist, not from its path`, 'run kit link');
  }
}

/** What identifies a repository to Composer: its type and url, or the name and version of a package repository. */
const repositoryKey = (repository: { type?: string; url?: string; package?: { name?: string; version?: string } }) =>
  repository.type === 'package' ? `package ${repository.package?.name ?? ''}@${repository.package?.version ?? ''}` : `${repository.type ?? ''} ${repository.url ?? ''}`;

/**
 * Composer reads `repositories` only from the root manifest (K330), so a root that requires a polyspec package must itself declare
 * each repository that the package declares. The package is read from the path repository of the link manifest, else from the vendor.
 */
function providerRepositoryFindings(root: string, directory: string, manifest: ReturnType<typeof readComposerManifest>, add: (rule: Rule, subject: string, problem: string, fix: string) => void) {
  const linkFile = path.posix.join(directory, LINK_MANIFEST);
  const folders = new Map<string, string>();
  if (existsSync(path.join(root, linkFile))) {
    for (const repository of readComposerManifest(root, linkFile).repositories ?? []) {
      const file = repository.type === 'path' && repository.url !== undefined ? path.resolve(root, directory, repository.url, 'composer.json') : undefined;
      const name = file !== undefined && existsSync(file) ? readComposerManifestFile(file).name : undefined;
      if (file !== undefined && name !== undefined) folders.set(name, file);
    }
  }
  const declared = new Set((manifest.repositories ?? []).map(repositoryKey));
  for (const name of Object.keys({ ...manifest.require, ...manifest['require-dev'] }).filter(item => item.startsWith('polyspec/'))) {
    const file = folders.get(name) ?? path.join(root, directory, 'vendor', name, 'composer.json');
    if (!existsSync(file)) continue;
    for (const repository of readComposerManifestFile(file).repositories ?? []) {
      if (repository.type === 'path' || declared.has(repositoryKey(repository))) continue;
      add('platform', path.posix.join(directory, 'composer.json'), `requires ${name}, whose composer.json declares the repository ${repositoryKey(repository)} that this root manifest lacks; Composer reads repositories only from the root`, `add the repository ${JSON.stringify(repository)} to repositories of ${path.posix.join(directory, 'composer.json')}`);
    }
  }
}

/** The output of `composer validate <args>` in `cwd` as one line when it fails, or null; COMPOSER_DISABLE_NETWORK keeps it off the network. */
function composerValidation(composer: string, args: string[], cwd: string, manifest?: string) {
  const validate = execute(composer, ['validate', ...args], { cwd, env: { ...process.env, COMPOSER_DISABLE_NETWORK: '1', ...(manifest === undefined ? {} : { COMPOSER: manifest }) } });
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
    // While the project is linked (K326), the local checkouts are canonical: the rules of the platform and of composer validate judge the
    // link lock that Composer resolved from the path packages, and the tracked lock is judged by the check of the batch release.
    const linked = existsSync(path.join(root, directory, LINK_LOCK));
    const lockPath = path.posix.join(directory, linked ? LINK_LOCK : 'composer.lock');
    const composerLock = readComposerLock(root, lockPath);
    if (linked) linkFindings(root, directory, composerLock, add);
    providerRepositoryFindings(root, directory, composerManifest, add);
    if (composerManifest.config?.platform?.php !== platform.php) add('platform', manifestPath, `config.platform.php is ${String(composerManifest.config?.platform?.php ?? 'absent')}, the policy declares ${platform.php}`, `set config.platform.php to ${platform.php} and run composer update --lock in ${directory}`);
    if (composerLock['platform-overrides']?.php !== platform.php) add('platform', lockPath, `the lock was resolved for PHP ${composerLock['platform-overrides']?.php ?? 'without a platform override'}, the policy declares ${platform.php}`, `run composer update --lock in ${directory}`);
    // composer validate reads the manifest and the lock; COMPOSER_DISABLE_NETWORK keeps it off the network. A published
    // composer.json declares its version, which the artifact repository of its release zip reads, so the warning on a
    // version field is not reported.
    const failure = composerValidation(composer, ['--strict', '--no-interaction', '--no-check-publish', '--no-check-version'], path.join(root, directory), linked ? LINK_MANIFEST : undefined);
    if (failure) add('composerLock', manifestPath, `composer validate --strict failed: ${failure}`, `run composer update --lock in ${directory}`);
  }

  // One PHP platform (K282): every Composer manifest that declares config.platform.php, and every entry of composerPlatforms,
  // names the same PHP, and a repository that pins .php-version names its minor with the patch PLATFORM_PATCH.
  const platforms = new Map<string, string>();
  for (const platform of policy.composerPlatforms) platforms.set(platform.manifest, platform.php);
  const kitWrote = writtenByKit(copiesOf(runningKit()));
  const symbols = path.relative(root, SYMBOLS).split(path.sep).join('/');
  for (const file of checkedFiles(root).filter(item => path.posix.basename(item) === 'composer.json' && !kitWrote(item) && !item.startsWith(`${symbols}/`))) {
    const declared = readComposerManifest(root, file).config?.platform?.php;
    if (typeof declared === 'string') platforms.set(`${file} config.platform.php`, declared);
  }
  const phpPin = existsSync(path.join(root, PHP_VERSION)) ? readFileSync(path.join(root, PHP_VERSION), 'utf8').trim() : undefined;
  const expected = phpPin === undefined ? [...platforms.values()][0] : `${phpPin.split('.').slice(0, 2).join('.')}.${PLATFORM_PATCH}`;
  for (const [subject, php] of platforms) {
    if (expected !== undefined && php !== expected) add('platform', subject, `the PHP platform is ${php}, the one platform of this repository is ${expected}${phpPin === undefined ? ', that of its first manifest' : `: the minor of ${PHP_VERSION} with the patch ${PLATFORM_PATCH}, which PHPUnit 13 needs`}`, `set it to ${expected}`);
  }

  // Each locked package of a tracked Composer lock is checked against the php and ext-* that config.platform of its composer.json
  // declares (K415): a package whose require the declared platform does not satisfy fails in vendor/composer/platform_check.php of
  // a fresh worktree. A project without config.platform.php is checked against no php, and an extension that config.platform does
  // not declare is not checked.
  const tracked = checkedFiles(root);
  for (const file of tracked.filter(item => path.posix.basename(item) === 'composer.json' && !kitWrote(item) && !item.startsWith(`${symbols}/`))) {
    const lockPath = path.posix.join(path.posix.dirname(file), 'composer.lock');
    if (!tracked.includes(lockPath)) continue;
    const platform = readComposerManifest(root, file).config?.platform ?? {};
    const composerLock = readComposerLock(root, lockPath);
    for (const locked of [...(composerLock.packages ?? []), ...(composerLock['packages-dev'] ?? [])]) {
      for (const [name, constraint] of Object.entries(locked.require ?? {})) {
        const declared = platform[name];
        if ((name !== 'php' && !name.startsWith('ext-')) || typeof declared !== 'string') continue;
        let satisfied: boolean;
        try {
          satisfied = satisfies(constraint, declared);
        } catch (error) {
          add('platform', lockPath, `${locked.name} ${locked.version} requires ${name} ${constraint}, which kit does not read: ${error instanceof Error ? error.message : String(error)}`, `change the requirement of ${locked.name} in ${lockPath}, or lock a release that kit reads`);
          continue;
        }
        if (!satisfied) add('platform', lockPath, `${locked.name} ${locked.version} requires ${name} ${constraint}, the platform that ${file} declares is ${name} ${declared}`, `lock a release of ${locked.name} that ${name} ${declared} satisfies, or set config.platform.${name} of ${file} to a version that satisfies ${constraint}, and run composer update --lock in ${path.posix.dirname(file)}`);
      }
    }
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

  // A PHP library of S10 is library code only (K425): its require names no application framework, and its application is a package beside it.
  for (const folder of libraryFolders(tracked)) {
    const manifestPath = path.posix.join(folder, 'composer.json');
    const manifest = readComposerManifest(root, manifestPath);
    for (const name of APPLICATION_FRAMEWORKS.filter(item => manifest.require?.[item] !== undefined)) {
      add('libraryApplication', manifestPath, `requires ${name} in require`, `move the application on ${name} into its own Composer package that requires ${folder}, and remove ${name} from require of ${manifestPath}`);
    }
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
    // The review record holds the tracked Composer lock; while its project is linked, that lock waits for the batch release (K326).
    if (lockEcosystem(lock) === 'composer' && existsSync(path.join(root, path.posix.dirname(lock), LINK_LOCK))) continue;
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
    // A linked package is judged by its link, not against the registry (K328).
    if (isLinked(root, dependency.ecosystem, dependency.lock, dependency.package)) continue;
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

// A Composer package of a lock with the source and the dist that Composer records for it.
type SourcedPackage = ComposerPackage & { source?: { type: string; url: string; reference: string }; dist?: { type: string; url: string; reference?: string } };
// A package that a lock of a checkout locks for a name the checkout requires directly: its ecosystem, its name (an npm lock key),
// its version and source, and the lock and line of its entry.
type Pin = { ecosystem: 'composer' | 'npm'; name: string; version: string; source: string; root: string; lock: string; line: number };

// The folders of the manifests that install reads: the root, and the folder of each Composer manifest that the policy names.
function installDirectories(root: string): string[] {
  const policy = existsSync(path.join(root, POLICY)) ? readConfigFindings<Policy>(root, POLICY, 'dependency-policy.schema.json').value : undefined;
  const folders = (policy?.composerPlatforms ?? []).map(platform => path.posix.dirname(platform.manifest));
  return [...new Set(['.', ...folders].map(folder => path.posix.normalize(folder)))];
}

// The folders of a workspace pattern of package.json: a folder, or the folders directly under one that ends in /*.
function workspaceFolders(root: string, pattern: string): string[] {
  if (!pattern.endsWith('/*')) return [pattern];
  const parent = pattern.slice(0, -'/*'.length);
  if (!existsSync(path.join(root, parent))) return [];
  return readdirSync(path.join(root, parent), { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => path.posix.join(parent, entry.name));
}

/**
 * The names that the manifests of `directories` require directly: the require and require-dev of each composer.json, and
 * the dependencies, devDependencies and optionalDependencies of each package.json with those of its workspaces. A requirement
 * that only a lock holds is transitive and is no direct name.
 */
function directNames(root: string, directories: readonly string[]): { composer: Set<string>; npm: Set<string> } {
  const composer = new Set<string>();
  const npm = new Set<string>();
  const addNpm = (file: string) => {
    const json = readNpmManifest(root, file);
    for (const field of [json.dependencies, json.devDependencies, json.optionalDependencies]) for (const name of Object.keys(field ?? {})) npm.add(name);
  };
  for (const directory of directories) {
    const composerFile = path.posix.join(directory, 'composer.json');
    if (existsSync(path.join(root, composerFile))) {
      const json = readComposerManifest(root, composerFile);
      for (const name of [...Object.keys(json.require ?? {}), ...Object.keys(json['require-dev'] ?? {})]) if (name.includes('/')) composer.add(name);
    }
    const npmFile = path.posix.join(directory, 'package.json');
    if (existsSync(path.join(root, npmFile))) {
      addNpm(npmFile);
      for (const workspace of readNpmManifest(root, npmFile).workspaces ?? []) {
        for (const member of workspaceFolders(root, path.posix.join(directory, workspace))) {
          const memberFile = path.posix.join(member, 'package.json');
          if (existsSync(path.join(root, memberFile))) addNpm(memberFile);
        }
      }
    }
  }
  return { composer, npm };
}

/**
 * The locks that install reads at the root of a checkout: the composer.lock and package-lock.json of each folder of
 * installDirectories that is tracked. A lock under tests/ or a fixtures/ folder is no lock of the checkout.
 */
function installLocks(root: string, directories: readonly string[]): string[] {
  const wanted = new Set(directories.flatMap(directory => ['composer.lock', 'package-lock.json'].map(name => path.posix.join(directory, name))));
  return trackedManifests(root, ['composer.lock', 'package-lock.json']).filter(file => wanted.has(file) && !/(^|\/)(tests|fixtures)\//.test(file));
}

/**
 * The packages that the install locks of `root` lock for a name that the checkout requires directly. A polyspec package is
 * linked, not pinned across the checkouts. An npm package is taken at the top level of node_modules, the place of a direct requirement.
 */
function directPins(root: string): Pin[] {
  const directories = installDirectories(root);
  const direct = directNames(root, directories);
  const pins: Pin[] = [];
  for (const lock of installLocks(root, directories)) {
    const isComposer = path.posix.basename(lock) === 'composer.lock';
    // The line of the first entry of each name, found in one pass over the lines of the lock.
    const entryLine = new Map<string, number>();
    const entry = isComposer ? /^\s*"name": "([^"]*)"/ : /^\s*"([^"]*)": \{$/;
    readFileSync(path.join(root, lock), 'utf8').split('\n').forEach((text, index) => {
      const found = entry.exec(text)?.[1];
      if (found !== undefined && !entryLine.has(found)) entryLine.set(found, index + 1);
    });
    if (isComposer) {
      const locked = readComposerLock(root, lock);
      const items: SourcedPackage[] = [...(locked.packages ?? []), ...(locked['packages-dev'] ?? [])];
      for (const item of items.filter(item => direct.composer.has(item.name) && !item.name.startsWith('polyspec/'))) {
        const source = item.source ? `${item.source.url}@${item.source.reference}` : item.dist?.url ?? 'no source';
        pins.push({ ecosystem: 'composer', name: item.name, version: item.version, source, root, lock, line: entryLine.get(item.name) ?? 0 });
      }
    } else {
      for (const [key, locked] of Object.entries(readNpmLock(root, lock).packages ?? {})) {
        const name = key.slice('node_modules/'.length);
        if (!key.startsWith('node_modules/') || name.includes('node_modules/') || !direct.npm.has(name) || locked.link === true || name.startsWith('@polyspec/')) continue;
        pins.push({ ecosystem: 'npm', name: key, version: locked.version ?? '', source: locked.resolved ?? 'no resolved URL', root, lock, line: entryLine.get(key) ?? 0 });
      }
    }
  }
  return pins;
}

/**
 * The findings of the packages that `root` and one of its `siblings` both require directly and lock at another version or from
 * another source (K378). Only the lock of `root` is compared with the lock of each sibling; a package that one of them alone
 * locks, or that only a lock holds as a transitive requirement, is no finding. Each finding names both locks with the line of
 * their entries, the version and the source.
 */
export function sharedPinFindings(root: string, siblings: readonly string[]): Finding[] {
  // The pins of the repository by ecosystem and name, so that each pin of a sibling finds its own pins at once.
  const own = new Map<string, Pin[]>();
  for (const pin of directPins(root)) own.set(`${pin.ecosystem} ${pin.name}`, [...(own.get(`${pin.ecosystem} ${pin.name}`) ?? []), pin]);
  const findings: Finding[] = [];
  const label = (pin: Pin) => `${path.basename(pin.root)}/${pin.lock}:${pin.line}`;
  for (const sibling of siblings) {
    for (const b of directPins(sibling)) {
      for (const a of own.get(`${b.ecosystem} ${b.name}`) ?? []) {
        if (a.version === b.version && a.source === b.source) continue;
        findings.push({ rule: 'sharedPin', subject: a.name, problem: `both checkouts require it directly and lock it from different sources or at different versions: ${label(a)} locks ${a.version} from ${a.source}, and ${label(b)} locks ${b.version} from ${b.source}`, fix: 'lock the package at one version from one source in both checkouts' });
      }
    }
  }
  return findings;
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
  // The locks of the sibling checkouts beside the repository are compared with its own; without a sibling, as in CI, nothing is compared.
  const siblings = siblingCheckouts(root).checkouts;
  const findings = [...check(root), ...sharedPinFindings(root, siblings)];
  const accepted = acceptedAdvisories(root);
  for (const line of accepted) process.stdout.write(`${line}\n`);
  if (siblings.length === 0) process.stdout.write(`[dependency-policy] no sibling checkout beside ${root}: compared no lock across checkouts\n`);
  else process.stdout.write(`[dependency-policy] compared the direct pins of the install locks of this checkout with ${siblings.length} sibling ${siblings.length === 1 ? 'checkout' : 'checkouts'}: ${siblings.map(checkout => path.basename(checkout)).join(', ')}\n`);
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
