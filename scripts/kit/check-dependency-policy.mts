#!/usr/bin/env node
// The dependency gate of `make dependency-policy-check`. It reads only files of the checkout and queries no registry, so
// one tree gives one result at any time. It compares the manifests and locks with the policy
// config/dependency-policy.json and with the review record config/dependency-review.json, which the developer command
// `make dependency-review RECORD=1` writes from the registries. It reports every finding with the rule that the finding
// breaks and its fix, one line each, and fails when there is one.
//
//   node scripts/kit/check-dependency-policy.mts [--root <checkout>]
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { POLICY, RECORD, UPDATE, acceptedText, advisoryExceptions, advisoryKey, completeAdvisoryException, dependencyKey, lockEcosystem, lockFix, localSpecDirectory, readState, advisoryRelease } from './dependency-state.mts';
import { isPrerelease, isVersionText, older } from './version.mts';
import { satisfies } from './composer-constraint.mts';
import { isMain, repositoryRoot } from './paths.mts';
import { execute } from './process.mts';
import { fileDigest } from './bootstrap/digest.mts';
import { ConfigError, parseJson, readConfig, readConfigFindings } from './schema-validate.mts';
import { readComposerLock, readComposerManifest, readComposerManifestFile, readNpmManifest } from './manifests.mts';
import type { ComposerLock, ComposerManifest, ComposerPackage, NpmLock, NpmManifest } from './manifests.mts';
import { fileAt, git, gitResult } from './git.mts';
import type { DependencyPolicy } from './dependency-state.mts';
import { present } from './present.mts';
import { isLinked } from './linked-package.mts';
import { LINK_LOCK, LINK_MANIFEST, judgedComposerFiles } from './composer-project.mts';
import { repositoryName, siblingCheckouts } from './link-providers.mts';
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
  rootRemote: 'each remote tarball that an npm lock resolves is named by its URL in a package.json of that lock, the root or a workspace, since allow-remote=root takes only the URLs that a package.json names',
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

// A remote tarball of an npm lock: an http(s) URL of a .tgz that is not on registry.npmjs.org, the registry of npm. No helper
// of kit names the registry of a lock, so the host is the only test.
const isRemoteTarball = (resolved: string) => {
  let url: URL;
  try {
    url = new URL(resolved);
  } catch {
    return false;
  }
  return (url.protocol === 'https:' || url.protocol === 'http:') && url.hostname !== 'registry.npmjs.org' && url.pathname.endsWith('.tgz');
};

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
function providerRepositoryFindings(root: string, directory: string, manifestPath: string, manifest: ReturnType<typeof readComposerManifest>, add: (rule: Rule, subject: string, problem: string, fix: string) => void) {
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
      add('platform', manifestPath, `requires ${name}, whose composer.json declares the repository ${repositoryKey(repository)} that this root manifest lacks; Composer reads repositories only from the root`, `add the repository ${JSON.stringify(repository)} to repositories of ${manifestPath}`);
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
    // Every rule of the Composer project judges the files that judgedComposerFiles selects: the link files while it is linked (K326-2),
    // the tracked ones otherwise.
    const judged = judgedComposerFiles(root, directory);
    const composerManifest = readComposerManifest(root, judged.manifest);
    const composerLock = readComposerLock(root, judged.lock);
    if (judged.linked) linkFindings(root, directory, composerLock, add);
    providerRepositoryFindings(root, directory, judged.manifest, composerManifest, add);
    if (composerManifest.config?.platform?.php !== platform.php) add('platform', judged.manifest, `config.platform.php is ${String(composerManifest.config?.platform?.php ?? 'absent')}, the policy declares ${platform.php}`, `set config.platform.php to ${platform.php} and run composer update --lock in ${directory}`);
    if (composerLock['platform-overrides']?.php !== platform.php) add('platform', judged.lock, `the lock was resolved for PHP ${composerLock['platform-overrides']?.php ?? 'without a platform override'}, the policy declares ${platform.php}`, `run composer update --lock in ${directory}`);
    // composer validate reads the manifest and the lock; COMPOSER_DISABLE_NETWORK keeps it off the network. A published
    // composer.json declares its version, which the artifact repository of its release zip reads, so the warning on a
    // version field is not reported.
    const failure = composerValidation(composer, ['--strict', '--no-interaction', '--no-check-publish', '--no-check-version'], path.join(root, directory), judged.linked ? LINK_MANIFEST : undefined);
    if (failure) add('composerLock', judged.manifest, `composer validate --strict failed: ${failure}`, `run composer update --lock in ${directory}`);
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
    // The project's files are the link files while it is linked (K326-2), which the tracked ones are not checked against.
    const judged = judgedComposerFiles(root, path.posix.dirname(file));
    if (!judged.linked && !tracked.includes(judged.lock)) continue;
    const lockPath = judged.lock;
    const platform = readComposerManifest(root, judged.manifest).config?.platform ?? {};
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
        if (!satisfied) add('platform', lockPath, `${locked.name} ${locked.version} requires ${name} ${constraint}, the platform that ${judged.manifest} declares is ${name} ${declared}`, `lock a release of ${locked.name} that ${name} ${declared} satisfies, or set config.platform.${name} of ${judged.manifest} to a version that satisfies ${constraint}, and run composer update --lock in ${path.posix.dirname(file)}`);
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
  // An application on a userland framework is no library (K433): libraryFolders leaves it out.
  for (const folder of libraryFolders(tracked, file => (tracked.includes(file) ? readFileSync(path.join(root, file), 'utf8') : undefined))) {
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

  // A remote tarball that an npm lock resolves is installed only when a package.json of the lock names its URL, since allow-remote=root
  // takes only those URLs (K427). The registry of the lock is registry.npmjs.org, so any other http(s) URL of a .tgz is remote.
  for (const [lock, npmLock] of state.npmLocks) {
    const named = new Set<string>();
    for (const { manifest: manifestPath } of state.manifests.filter(item => item.lock === lock)) {
      const json = readNpmManifest(root, manifestPath);
      for (const field of [json.dependencies, json.devDependencies, json.optionalDependencies, json.peerDependencies]) for (const spec of Object.values(field ?? {})) named.add(spec);
    }
    const text = readFileSync(path.join(root, lock), 'utf8').split('\n');
    for (const [key, locked] of Object.entries(npmLock.packages ?? {})) {
      const resolved = locked.resolved;
      if (key === '' || locked.link === true || typeof resolved !== 'string' || !isRemoteTarball(resolved) || named.has(resolved)) continue;
      const name = key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length);
      const line = text.findIndex(item => item.includes(`"${key}": {`)) + 1;
      add('rootRemote', `${lock} ${name}`, `${lock}:${line} resolves ${name} from ${resolved}, which no package.json of the lock names`, `declare ${name} with this URL in the root package.json, which allow-remote=root (K189) takes`);
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
    if (lockEcosystem(lock) === 'composer' && judgedComposerFiles(root, path.posix.dirname(lock)).linked) continue;
    const entry = recordedLocks.get(lock);
    if (!entry) {
      add('record', lock, 'the lock has no entry in the review record', REVIEW);
      continue;
    }
    const actual = fileDigest(path.join(root, lock));
    if (entry.sha256 !== actual) add('record', lock, `the lock changed after its review: its sha256 is ${actual}, the review recorded ${entry.sha256}`, REVIEW);
    for (const advisory of entry.advisories ?? []) {
      if (accepted.has(advisoryKey(lock, advisory.package, advisory.id))) continue;
      const fix = lockEcosystem(lock) === 'pypi'
        ? lockFix(lock, pythonLock(lock).createdBy, advisory.package)
        : `${UPDATE}, which updates the affected package and records the review`;
      add('advisory', `${lock} ${advisory.package} ${advisoryRelease(advisory)}`, `the review record found advisory ${advisory.id} (${advisory.severity}) ${advisory.title}${advisory.url ? ` ${advisory.url}` : ''}`, fix);
    }
  }
  for (const lock of recordedLocks.keys()) if (!state.locks.includes(lock)) add('record', lock, 'the review record names a lock that the checkout does not review', REVIEW);
  // An advisory exception names an advisory that the review recorded for its lock; otherwise it is stale.
  for (const exception of accepted.values()) {
    const advisories = recordedLocks.get(exception.lock)?.advisories ?? [];
    if (!advisories.some(advisory => advisory.package === exception.package && advisory.id === exception.advisory)) {
      add('staleAdvisory', `${exception.lock} ${exception.package}`, `the review record found no advisory ${exception.advisory}, and ${POLICY} holds an exception for it`, `remove the exception from ${POLICY}`);
    }
  }

  // A git package of a lock is pinned by its commit: the record holds the same URL, requested revision and commit as the lock.
  const pinned = new Map(state.vcs.map(item => [`${item.lock} ${item.package}`, item]));
  const reviewedPins = new Map(record.vcs.map(item => [`${item.lock} ${item.package}`, item]));
  const pin = ({ url, requestedRevision, commitId }: { url: unknown; requestedRevision: unknown; commitId: unknown }) => JSON.stringify({ url, requestedRevision, commitId });
  for (const [key, item] of pinned) {
    const entry = reviewedPins.get(key);
    if (!entry) add('record', `${item.lock} ${item.package}`, 'the git package has no entry in the review record', REVIEW);
    else if (pin(entry) !== pin(item)) add('record', `${item.lock} ${item.package}`, `the lock pins ${item.commitId} at ${item.requestedRevision}, the review record recorded ${entry.commitId} at ${entry.requestedRevision}`, REVIEW);
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
      add('record', subject, `the lock holds ${dependency.version ?? 'no version'}, the review record recorded ${entry.version}`, REVIEW);
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
    if (outdated && !exceptions.has(key)) add('latest', subject, `${entry.version} is older than ${entry.latest}, the latest stable release at its review, and ${POLICY} holds no exception for it`, `${dependency.kind === 'lock' ? lockFix(dependency.lock, dependency.createdBy, dependency.package) : UPDATE}, or add an exception with its reason, removal condition and verification to ${POLICY}`);
    if (!outdated && exceptions.has(key)) add('stale', subject, `the review record found ${entry.version}, the latest stable release, and ${POLICY} holds an exception for it`, `remove the exception from ${POLICY}`);
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
// its package name, its version and source, the manifest and the lock of its entry, and the line of the entry.
type Pin = { ecosystem: 'composer' | 'npm'; name: string; package: string; version: string; source: string; root: string; manifest: string; lock: string; line: number };

/**
 * The files of one checkout that the sibling rule reads: its working tree (workingSource), or the committed tree of a ref, such as
 * the main branch of a sibling (committedSource, K464). `has` tells whether the source holds the file.
 */
type Source = {
  root: string;
  has(file: string): boolean;
  text(file: string): string;
  /** The tracked files whose base name is one of `names`. */
  files(names: readonly string[]): string[];
  /** The folders directly under `parent`. */
  folders(parent: string): string[];
  /** The file as T, validated against the schema file `schema`; a ConfigError names a file that is missing. */
  json<T>(file: string, schema: string): T;
};

/**
 * The committed tree of `ref` in the checkout `root`: the files that git lists there, read with git show, so a sibling is compared by
 * what its main branch commits and not by its working tree (K464).
 */
function committedSource(root: string, ref: string): Source {
  const listed = git(root, 'ls-tree', '-r', '-z', '--name-only', ref).split('\0').filter(file => file !== '');
  const known = new Set(listed);
  const has = (file: string) => known.has(file);
  return {
    root,
    has,
    text(file: string): string {
      if (!has(file)) throw new ConfigError(`${file} is not in ${ref}`);
      return fileAt(root, ref, file);
    },
    files: names => listed.filter(file => names.includes(path.posix.basename(file))),
    folders(parent: string): string[] {
      const prefix = parent === '.' ? '' : `${parent}/`;
      return [...new Set(listed.filter(file => file.startsWith(prefix) && file.slice(prefix.length).includes('/')).map(file => `${prefix}${file.slice(prefix.length).split('/')[0]}`))].sort();
    },
    json<T>(file: string, schema: string): T {
      if (!has(file)) throw new ConfigError(`${file} is missing in ${ref}; the repository declares it (schema ${schema} of kit)`);
      return parseJson<T>(fileAt(root, ref, file), schema, `${ref}:${file}`);
    },
  };
}

// The folders of the manifests that install reads: the root, and the folder of each Composer manifest that the policy names.
function installDirectories(source: Source): string[] {
  const policy = source.has(POLICY) ? source.json<Policy>(POLICY, 'dependency-policy.schema.json') : undefined;
  const folders = (policy?.composerPlatforms ?? []).map(platform => path.posix.dirname(platform.manifest));
  return [...new Set(['.', ...folders].map(folder => path.posix.normalize(folder)))];
}

/**
 * The names that the manifests of `directories` require directly: the require and require-dev of each Composer manifest that
 * judgedComposerFiles selects, and the dependencies, devDependencies and optionalDependencies of each package.json with those of
 * its workspaces. A requirement that only a lock holds is transitive and is no direct name.
 */
function directNames(source: Source, directories: readonly string[]): { composer: Set<string>; npm: Set<string> } {
  const composer = new Set<string>();
  const npm = new Set<string>();
  const addNpm = (file: string) => {
    const json = source.json<NpmManifest>(file, 'npm-manifest.schema.json');
    for (const field of [json.dependencies, json.devDependencies, json.optionalDependencies]) for (const name of Object.keys(field ?? {})) npm.add(name);
  };
  for (const directory of directories) {
    // Shared pins compare the committed, tracked Composer declaration, never the generated link manifest (K464-1).
    const composerFile = path.posix.join(directory, 'composer.json');
    if (source.has(composerFile)) {
      const json = source.json<ComposerManifest>(composerFile, 'composer-manifest.schema.json');
      for (const name of [...Object.keys(json.require ?? {}), ...Object.keys(json['require-dev'] ?? {})]) if (name.includes('/')) composer.add(name);
    }
    const npmFile = path.posix.join(directory, 'package.json');
    if (source.has(npmFile)) {
      addNpm(npmFile);
      for (const workspace of source.json<NpmManifest>(npmFile, 'npm-manifest.schema.json').workspaces ?? []) {
        for (const member of workspaceFolders(source, path.posix.join(directory, workspace))) {
          const memberFile = path.posix.join(member, 'package.json');
          if (source.has(memberFile)) addNpm(memberFile);
        }
      }
    }
  }
  return { composer, npm };
}

// The folders of a workspace pattern of package.json: a folder, or the folders directly under one that ends in /*.
function workspaceFolders(source: Source, pattern: string): string[] {
  if (!pattern.endsWith('/*')) return [pattern];
  return source.folders(pattern.slice(0, -'/*'.length));
}

/**
 * The locks that install reads at the root of a checkout, each with the manifest that declares it: the Composer lock that
 * judgedComposerFiles selects (the link lock while linked, K326-2) and the package-lock.json of each folder of installDirectories,
 * when it is tracked. A lock under tests/ or a fixtures/ folder is no lock of the checkout.
 */
function installLocks(source: Source, directories: readonly string[]): { lock: string; manifest: string }[] {
  const tracked = new Set(source.files(['composer.lock', 'package-lock.json']));
  return directories
    .flatMap((directory) => {
      // The sibling rule compares tracked locks only; link locks are generated from sibling packages and are not comparable pins.
      const composer = { lock: path.posix.join(directory, 'composer.lock'), manifest: path.posix.join(directory, 'composer.json') };
      const npm = { lock: path.posix.join(directory, 'package-lock.json'), manifest: path.posix.join(directory, 'package.json') };
      return [composer, npm].filter(entry => tracked.has(entry.lock));
    })
    .filter(entry => !/(^|\/)(tests|fixtures)\//.test(entry.lock));
}

/**
 * The packages that the install locks of the checkout lock for a name that it requires directly. A polyspec package is
 * linked, not pinned across the checkouts. An npm package is taken at the top level of node_modules, the place of a direct requirement.
 */
function directPins(source: Source): Pin[] {
  const directories = installDirectories(source);
  const direct = directNames(source, directories);
  const pins: Pin[] = [];
  for (const { lock, manifest } of installLocks(source, directories)) {
    const isComposer = lockEcosystem(lock) === 'composer';
    // The line of the first entry of each name, found in one pass over the lines of the lock.
    const entryLine = new Map<string, number>();
    const entry = isComposer ? /^\s*"name": "([^"]*)"/ : /^\s*"([^"]*)": \{$/;
    source.text(lock).split('\n').forEach((text, index) => {
      const found = entry.exec(text)?.[1];
      if (found !== undefined && !entryLine.has(found)) entryLine.set(found, index + 1);
    });
    if (isComposer) {
      const locked = source.json<ComposerLock>(lock, 'composer-lock.schema.json');
      const items: SourcedPackage[] = [...(locked.packages ?? []), ...(locked['packages-dev'] ?? [])];
      for (const item of items.filter(item => direct.composer.has(item.name) && !item.name.startsWith('polyspec/'))) {
        const origin = item.source ? `${item.source.url}@${item.source.reference}` : item.dist?.url ?? 'no source';
        pins.push({ ecosystem: 'composer', name: item.name, package: item.name, version: item.version, source: origin, root: source.root, manifest, lock, line: entryLine.get(item.name) ?? 0 });
      }
    } else {
      const locked = source.json<NpmLock>(lock, 'npm-lock.schema.json');
      for (const [key, pinned] of Object.entries(locked.packages ?? {})) {
        const name = key.slice('node_modules/'.length);
        if (!key.startsWith('node_modules/') || name.includes('node_modules/') || !direct.npm.has(name) || pinned.link === true || name.startsWith('@polyspec/')) continue;
        pins.push({ ecosystem: 'npm', name: key, package: name, version: pinned.version ?? '', source: pinned.resolved ?? 'no resolved URL', root: source.root, manifest, lock, line: entryLine.get(key) ?? 0 });
      }
    }
  }
  return pins;
}

/** The direct pins of a checkout and the reviewed target of each package, by dependencyKey (K464). */
type Side = { pins: Pin[]; targets: Map<string, string> };

/** The direct pins of the source and the version that its review record (config/dependency-review.json) names for each one. */
function sideOf(source: Source): Side {
  const record = source.json<ReviewRecord>(RECORD, 'dependency-review.schema.json');
  return { pins: directPins(source), targets: new Map(record.dependencies.map(entry => [dependencyKey(entry), entry.version])) };
}

/** The key of a pin in ReviewRecord.dependencies: its ecosystem, manifest and package. */
const targetKey = (pin: Pin) => dependencyKey({ ecosystem: pin.ecosystem, manifest: pin.manifest, package: pin.package });

/**
 * Whether a checkout at `version`, reviewed at `target`, reports a version mismatch with a sibling at `siblingVersion`, reviewed at
 * `siblingTarget` (K464): it reports when it is not at its target, and when both are at their targets and the targets differ, since
 * the two reviews then disagree. A checkout at its target reports nothing for the pair, and no version mismatch is no finding.
 */
const reportsVersion = (version: string, target: string | undefined, siblingVersion: string, siblingTarget: string | undefined): boolean =>
  version !== siblingVersion && (version !== target || (siblingVersion === siblingTarget && target !== siblingTarget));

/** What the sibling rule found: its findings, the progress lines that name a sibling not evaluated, and the siblings it compared. */
export type SharedPinReport = { findings: Finding[]; progress: string[]; compared: string[] };

/**
 * The findings of the packages that `root` and one of its `siblings` both require directly and lock at another version or from
 * another source (K378). Both sides use committed tracked files: the current checkout's HEAD and each sibling's main (K464-1). A
 * sibling whose main cannot be read is named as not evaluated in the progress lines, never passed in silence. A version mismatch is reported by the checkout off its reviewed target
 * only (reportsVersion), and a source mismatch at one version by both. A package that one of them alone locks, or that only a lock
 * holds as a transitive requirement, is no finding. Each finding names its lock with the line of the entry, the version and the source.
 */
export function sharedPinFindings(root: string, siblings: readonly string[]): SharedPinReport {
  const findings: Finding[] = [];
  const progress: string[] = [];
  const compared: string[] = [];
  let own: Side;
  try {
    own = sideOf(committedSource(root, 'HEAD'));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    findings.push({ rule: 'sharedPin', subject: repositoryName(root), problem: `the checkout's committed HEAD cannot be evaluated for shared pins: ${reason}`, fix: 'commit the tracked manifests and locks before running dependency-policy-check' });
    return { findings, progress, compared };
  }
  // The pins of the repository by ecosystem and package, so that each pin of a sibling finds its own pins at once.
  const ownByPackage = new Map<string, Pin[]>();
  for (const pin of own.pins) ownByPackage.set(`${pin.ecosystem} ${pin.package}`, [...(ownByPackage.get(`${pin.ecosystem} ${pin.package}`) ?? []), pin]);
  // The repository is named, not its folder: a worktree of <repo> has the folder <repo>-<name>-<id>, and its finding must read as main's (K458).
  const label = (pin: Pin) => `${repositoryName(pin.root)}/${pin.lock}:${pin.line}`;
  for (const sibling of siblings) {
    const name = repositoryName(sibling);
    const main = gitResult(sibling, 'rev-parse', '--verify', '--quiet', 'refs/heads/main');
    if (main.error) throw main.error;
    if (main.status !== 0) {
      findings.push({ rule: 'sharedPin', subject: name, problem: 'the sibling has no main branch whose committed HEAD can be evaluated for shared pins', fix: 'create and commit the sibling main branch, or exclude this checkout from the sibling set' });
      continue;
    }
    let other: Side;
    try {
      other = sideOf(committedSource(sibling, 'refs/heads/main'));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      findings.push({ rule: 'sharedPin', subject: name, problem: `the sibling's committed main cannot be evaluated for shared pins: ${reason}`, fix: 'commit the required manifests, locks and review record on the sibling main, or exclude this checkout from the sibling set' });
      continue;
    }
    compared.push(name);
    for (const b of other.pins) {
      for (const a of ownByPackage.get(`${b.ecosystem} ${b.package}`) ?? []) {
        if (a.version === b.version && a.source === b.source) continue;
        if (a.version !== b.version) {
          const ownTarget = own.targets.get(targetKey(a));
          const siblingTarget = other.targets.get(targetKey(b));
          if (!reportsVersion(a.version, ownTarget, b.version, siblingTarget)) continue;
          const offTarget = a.version !== ownTarget;
          const problem = offTarget
            ? `${a.name} is locked at ${a.version} in ${a.lock} of ${repositoryName(a.root)}, not at its reviewed target ${ownTarget ?? 'none recorded'}; sibling ${name} locks ${b.version} and reviews ${siblingTarget ?? 'none recorded'}`
            : `${a.name} is locked at its reviewed target ${a.version} in ${repositoryName(a.root)}, and sibling ${name} is locked at its reviewed target ${b.version}: the two reviews disagree (${repositoryName(a.root)} reviews ${ownTarget}, ${name} reviews ${siblingTarget ?? 'none recorded'})`;
          const fix = offTarget ? `lock ${a.name} at ${ownTarget ?? 'its reviewed target'} in ${a.lock}, or review it with ${REVIEW}` : `review ${a.name} at one version in both checkouts (${REVIEW})`;
          findings.push({ rule: 'sharedPin', subject: a.name, problem, fix });
          continue;
        }
        findings.push({ rule: 'sharedPin', subject: a.name, problem: `both checkouts require it directly and lock it at one version from different sources: ${label(a)} locks ${a.version} from ${a.source}, and ${label(b)} locks ${b.version} from ${b.source}`, fix: 'lock the package from one source in both checkouts' });
      }
    }
  }
  return { findings, progress, compared };
}

/** The line of a finding. */
export const findingLine = (finding: Finding) => `[dependency-policy] ${finding.subject}: ${finding.problem}. Rule: ${RULES[finding.rule]}. Fix: ${finding.fix}.`;

function main(): void {
  const args = process.argv.slice(2);
  const usage = 'Usage: node scripts/kit/check-dependency-policy.mts [--root <checkout>] [--packages <name>[,<name>...]]';
  let rootArg: string | undefined;
  let packages: string[] | undefined;
  for (let i = 0; i < args.length; i += 2) {
    const value = args[i + 1];
    if (value === undefined || value === '') {
      console.error(usage);
      process.exit(2);
    }
    if (args[i] === '--root') rootArg = value;
    else if (args[i] === '--packages') packages = value.split(',').map(name => name.trim()).filter(name => name !== '');
    else {
      console.error(usage);
      process.exit(2);
    }
  }
  const root = rootArg === undefined ? repositoryRoot() : path.resolve(rootArg);
  // A package scope keeps the findings that name one of its packages, so a row that fixes one finding can close while the other
  // findings stay for their own rows (K493). The unscoped gate is unchanged.
  const scope = (list: Finding[]): Finding[] => packages === undefined ? list : list.filter(finding => {
    const line = findingLine(finding);
    return packages.some(name => new RegExp(`(^|[\s/@"'(,:])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[\s:,)"'/])`).test(line));
  });
  // The checkouts beside the repository are compared with its own by their committed main; without a sibling, as in CI, nothing is compared.
  const { checkouts: siblings } = siblingCheckouts(root);
  const shared = sharedPinFindings(root, siblings);
  const findings = scope([...check(root), ...shared.findings]);
  const accepted = acceptedAdvisories(root);
  for (const line of accepted) process.stdout.write(`${line}\n`);
  for (const line of shared.progress) process.stdout.write(`${line}\n`);
  if (siblings.length === 0) process.stdout.write(`[dependency-policy] no sibling checkout beside ${root}: compared no lock across checkouts\n`);
  else process.stdout.write(`[dependency-policy] compared the direct pins of the install locks of this checkout with the committed main of ${shared.compared.length} of ${siblings.length} sibling ${siblings.length === 1 ? 'checkout' : 'checkouts'}: ${shared.compared.join(', ') || 'none'}\n`);
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
