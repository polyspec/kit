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
import { POLICY, lockFix, readState } from './dependency-state.mts';
import { isMain, repositoryRoot } from './paths.mts';
import { execute } from './process.mts';
import { ConfigError, readConfigFindings } from './schema-validate.mts';
import { readComposerManifest, readComposerManifestFile, readNpmManifest } from './manifests.mts';
import type { DependencyPolicy } from './dependency-state.mts';
import { LINK_MANIFEST, judgedComposerFiles } from './composer-project.mts';
import { checkedFiles } from './tracked-files.mts';
import { copiesOf, runningKit, writtenByKit } from './kit-check.mts';
import { SYMBOLS } from './install-symbols.mts';
import { CONFIG as RELEASE_CONFIG } from './release.mts';
import type { ConsumerConfig } from './release-consumer-config.mts';
import { libraryFolders } from './php-extension.mts';

export const RULES = {
  policy: `${POLICY} names its Composer platforms and Python manifests and declares each exception for a registry dependency with a reason, a removal condition and verification commands`,
  platform: 'each entry of composerPlatforms names a manifest, and a root manifest declares each repository that a polyspec package it requires declares, since Composer reads repositories only from the root',
  composerLock: 'each Composer lock is current for its manifest, as composer validate --strict reads it without a network',
  composerPackage: 'each published Composer manifest of packages/ is valid, as composer validate reads it without a lock and without a network',
  composerCoverage: `each Composer manifest of the checkout is checked: composerPlatforms of ${POLICY} names it, or a manifest that it names requires it through a path repository; a manifest that kit writes and the Composer consumer project of the release are not`,
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
  } catch {
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
    providerRepositoryFindings(root, directory, judged.manifest, composerManifest, add);
    // composer validate reads the manifest and the lock; COMPOSER_DISABLE_NETWORK keeps it off the network. A published
    // composer.json declares its version, which the artifact repository of its release zip reads, so the warning on a
    // version field is not reported.
    const failure = composerValidation(composer, ['--strict', '--no-interaction', '--no-check-publish', '--no-check-version'], path.join(root, directory), judged.linked ? LINK_MANIFEST : undefined);
    if (failure) add('composerLock', judged.manifest, `composer validate --strict failed: ${failure}`, `run composer update --lock in ${directory}`);
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
  return findings;
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
  if (findings.length) {
    for (const finding of findings) console.error(findingLine(finding));
    console.error(`[dependency-policy] ${findings.length} finding${findings.length === 1 ? '' : 's'}; the check reads only the files of the checkout and queries no registry`);
    process.exit(1);
  }
  // K448: no version, pin, review or advisory is judged; each package manager and its lock decide (S4).
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
