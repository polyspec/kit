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
import { POLICY, RECORD, UPDATE, acceptedText, advisoryExceptions, advisoryKey, completeAdvisoryException, lockEcosystem, lockFix, readState, advisoryRelease } from './dependency-state.mts';
import { fileDigest } from './bootstrap/digest.mts';
import { isMain, repositoryRoot } from './paths.mts';
import { execute } from './process.mts';
import { ConfigError, readConfigFindings } from './schema-validate.mts';
import { readComposerManifest, readComposerManifestFile, readNpmManifest } from './manifests.mts';
import type { DependencyPolicy } from './dependency-state.mts';
import { checkedFiles } from './tracked-files.mts';
import { libraryFolders } from './php-extension.mts';

export const RULES = {
  record: 'every audited lock has a review record of its current contents',
  advisory: 'a lock had no known advisory at its review (npm: moderate, high or critical; Composer: every advisory and abandoned package), unless advisoryExceptions of the policy accepts it with its reason and removal condition',
  staleAdvisory: 'an advisory exception names an advisory that the review of its lock found',
  policy: `${POLICY} names its Composer platforms and Python manifests and declares each exception for a registry dependency with a reason, a removal condition and verification commands`,
  platform: 'each entry of composerPlatforms names a manifest, and a root manifest declares each repository that a polyspec package it requires declares, since Composer reads repositories only from the root',
  composerPackage: 'each published Composer manifest of packages/ is valid, as composer validate reads it without a lock and without a network',
  pythonLock: 'each Python lock that the policy names is a PEP 751 pylock.toml with lock-version 1.0 and created-by, every registry file has a sha256, every git package is pinned by a full commit and no package is a local directory',
  npmLock: 'each npm lock that the policy names records the dependencies of every npm manifest that it resolves',
  rootRemote: 'each remote tarball that an npm lock resolves has a matching dependency name and URL, either in a root or workspace dependency spec or in a root override for that direct dependency, as allow-remote=root permits root and workspace edges only',
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


// The application frameworks that a PHP library of S10 may not require in require: an internal class cannot extend a userland class.
const APPLICATION_FRAMEWORKS = ['symfony/console', 'symfony/framework-bundle', 'symfony/http-kernel', 'laravel/framework', 'laminas/laminas-mvc'];


// A remote tarball of an npm lock: an http(s) URL of a .tgz that is not on registry.npmjs.org, the registry of npm. No helper
// of kit names the registry of a lock, so the host is the only test.
const isRemoteTarball = (resolved: string) => {
  let url: URL;
  try {
    url = new URL(resolved);
  } catch (error) {
    // new URL throws a TypeError for a text that is no URL, such as a file path; no other failure means that.
    if (!(error instanceof TypeError)) throw error;
    return false;
  }
  return (url.protocol === 'https:' || url.protocol === 'http:') && url.hostname !== 'registry.npmjs.org' && url.pathname.endsWith('.tgz');
};

/** What identifies a repository to Composer: its type and url, or the name and version of a package repository. */
const repositoryKey = (repository: { type?: string; url?: string; package?: { name?: string; version?: string } }) =>
  repository.type === 'package' ? `package ${repository.package?.name ?? ''}@${repository.package?.version ?? ''}` : `${repository.type ?? ''} ${repository.url ?? ''}`;

/**
 * Composer reads `repositories` only from the root manifest (K330), so a root that requires a polyspec package must itself declare
 * each repository that the package declares. The package is read from the vendor, where the link points it at its checkout (K448).
 */
function providerRepositoryFindings(root: string, directory: string, manifestPath: string, manifest: ReturnType<typeof readComposerManifest>, add: (rule: Rule, subject: string, problem: string, fix: string) => void) {
  const declared = new Set((manifest.repositories ?? []).map(repositoryKey));
  for (const name of Object.keys({ ...manifest.require, ...manifest['require-dev'] }).filter(item => item.startsWith('polyspec/'))) {
    const file = path.join(root, directory, 'vendor', name, 'composer.json');
    if (!existsSync(file)) continue;
    for (const repository of readComposerManifestFile(file).repositories ?? []) {
      if (repository.type === 'path' || declared.has(repositoryKey(repository))) continue;
      add('platform', manifestPath, `requires ${name}, whose composer.json declares the repository ${repositoryKey(repository)} that this root manifest lacks; Composer reads repositories only from the root`, `add the repository ${JSON.stringify(repository)} to repositories of ${manifestPath}`);
    }
  }
}

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
    // Every rule of the Composer project judges its tracked composer.json and composer.lock: a linked package is a symbolic link of
    // the vendor and changes neither (K591).
    const manifest = path.posix.join(directory, 'composer.json');
    const composerManifest = readComposerManifest(root, manifest);
    providerRepositoryFindings(root, directory, manifest, composerManifest, add);
    // K602: the lock is not judged against the manifest: the installs of the polyspec packages are links, so the lock records the
    // release that the development manifest has left.
  }

  // The published Composer manifests have no lock: the development root composer.json resolves them.
  const published = state.local.filter(item => item.ecosystem === 'composer').map(item => path.posix.join(path.posix.dirname(item.manifest), item.directory, 'composer.json'));
  for (const manifestPath of published) {
    const failure = composerValidation(composer, ['--no-check-lock', '--no-check-publish', '--no-interaction'], path.join(root, path.posix.dirname(manifestPath)));
    if (failure) add('composerPackage', manifestPath, `composer validate failed: ${failure}`, `fix ${manifestPath}`);
  }

  // A PHP library of S10 is library code only (K425): its require names no application framework, and its application is a package beside it.
  // An application on a userland framework is no library (K433): libraryFolders leaves it out.
  const tracked = checkedFiles(root);
  for (const folder of libraryFolders(tracked, file => (tracked.includes(file) ? readFileSync(path.join(root, file), 'utf8') : undefined))) {
    const manifestPath = path.posix.join(folder, 'composer.json');
    const manifest = readComposerManifest(root, manifestPath);
    for (const name of APPLICATION_FRAMEWORKS.filter(item => manifest.require?.[item] !== undefined)) {
      add('libraryApplication', manifestPath, `requires ${name} in require`, `move the application on ${name} into its own Composer package that requires ${folder}, and remove ${name} from require of ${manifestPath}`);
    }
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

  // allow-remote=root permits a remote spec only on a direct project-root or workspace dependency edge (K427). A root override
  // can change that direct edge's URL without becoming a dependency itself (K564), so the package name and URL must both match.
  // The registry of the lock is registry.npmjs.org, so any other http(s) URL of a .tgz is remote.
  for (const [lock, npmLock] of state.npmLocks) {
    const named = new Map<string, Set<string>>();
    const directDependencies = new Set<string>();
    const rootOverrides = new Map<string, string>();
    const addSpec = (name: string, spec: string) => {
      const specs = named.get(name) ?? new Set<string>();
      specs.add(spec);
      named.set(name, specs);
    };
    for (const { directory, manifest: manifestPath } of state.manifests.filter(item => item.lock === lock)) {
      const json = readNpmManifest(root, manifestPath);
      for (const field of [json.dependencies, json.devDependencies, json.optionalDependencies, json.peerDependencies]) {
        for (const [name, spec] of Object.entries(field ?? {})) {
          directDependencies.add(name);
          addSpec(name, spec);
        }
      }
      if (directory === '.') {
        for (const [name, spec] of Object.entries(json.overrides ?? {})) {
          if (typeof spec === 'string') rootOverrides.set(name, spec);
        }
      }
    }
    for (const [name, spec] of rootOverrides) if (directDependencies.has(name)) addSpec(name, spec);
    const text = readFileSync(path.join(root, lock), 'utf8').split('\n');
    for (const [key, locked] of Object.entries(npmLock.packages ?? {})) {
      const resolved = locked.resolved;
      if (key === '' || locked.link === true || typeof resolved !== 'string' || !isRemoteTarball(resolved)) continue;
      const name = key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length);
      if (named.get(name)?.has(resolved)) continue;
      const line = text.findIndex(item => item.includes(`"${key}": {`)) + 1;
      add('rootRemote', `${lock} ${name}`, `${lock}:${line} resolves ${name} from ${resolved}, which no direct dependency of this name declares and no matching root override authorizes`, `declare ${name} with this URL in a root or workspace dependency, or add this URL to root overrides for a direct dependency, which allow-remote=root (K189) takes`);
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
  if (recordedLocks.size !== record.locks.length) add('record', RECORD, 'the review record names a lock more than once', REVIEW);
  for (const lock of state.locks) {
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

  return findings;
}

/** The accepted advisories of the validated record, with their reasons and removal conditions. */
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
    return packages.some(name => new RegExp(`(^|[\\s/@"'(,:])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[\\s:,)"'/])`).test(line));
  });
  // K448: no lock of this repository is compared with another repository's; each lock is the record of its own install.
  const findings = scope(check(root));
  const accepted = acceptedAdvisories(root);
  for (const note of accepted) process.stdout.write(`${note}\n`);
  if (findings.length) {
    for (const finding of findings) console.error(findingLine(finding));
    console.error(`[dependency-policy] ${findings.length} finding${findings.length === 1 ? '' : 's'}; the check reads only the files of the checkout and queries no registry`);
    process.exit(1);
  }
  // Package managers select versions; the gate separately rejects reviewed vulnerabilities.
  if (accepted.length) process.stdout.write(`[dependency-policy] ${accepted.length} accepted ${accepted.length === 1 ? 'advisory' : 'advisories'}\n`);
  process.stdout.write(`[dependency-policy] the manifests and locks of ${root} pass\n`);
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
