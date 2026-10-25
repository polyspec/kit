#!/usr/bin/env node
// Releases a tag of a commit of main. The steps run in this order from the release workflow (workflows/release.yml), each
// through its make target:
//
//   node scripts/kit/release.mts verify TAG     the tagged commit is on origin/main and its checks concluded success
//   node scripts/kit/release.mts versions TAG   every manifest of the tag has its version, CHANGELOG has its section
//   node scripts/kit/release.mts assets TAG     build the archive of every package of the tag into var/release/assets
//   node scripts/kit/release.mts publish TAG    create the GitHub Release of the tag as a draft, with its notes and archives
//   node scripts/kit/release.mts undraft TAG    make the draft release of the tag public; after the proof of the draft passed
//   node scripts/kit/release.mts go-tags TAG    every Go module has its tag <directory>/vX.Y.Z at the commit of TAG
//   node scripts/kit/release.mts coverage       every package file of the checkout is classified in config/release.json
//
// The repository is data: config/release.json (schema scripts/kit/schema/release.schema.json) lists the packages that a
// tag releases as archives, the manifests that carry the version, the manifests that no tag releases and the Go modules.
// A tag `vX.Y.Z` releases the packages at the version X.Y.Z; a tag `<Go module directory>/vX.Y.Z` releases that Go module
// and builds no archive. No step reruns the tests: every commit of main passed the full suite before it reached main.
//
// `verify` resolves the tag to its commit, requires the commit to be an ancestor of origin/main, requires for a tag vX.Y.Z
// the tag `<directory>/vX.Y.Z` of every Go module at the same commit (`go-tags`; a Go proxy reads a module from that tag
// only) and reads the check runs of the commit from `gh api repos/<repository>/commits/<sha>/check-runs` (the repository of GITHUB_REPOSITORY): the latest run
// of each configured check must be completed with the conclusion success. `versions` compares X.Y.Z with the version of
// every manifest of `manifests` and requires the section `## X.Y.Z` in the change logs; for a Go module it requires the module
//   TAG is `latest` for the newest root release tag reachable from HEAD.
// path of the go.mod. `assets` builds one archive per package, named `<package>-<language>-<version>.<ext>` with `@scope/`
// written `scope-` and `vendor/` `vendor-` (`@scope/x` is `scope-x-npm-1.0.0.tgz`, `vendor/x` is `vendor-x-php-1.0.0.zip`):
// `npm pack` of an npm package, whose output is renamed to that name, and a `git archive` zip of the directory of a Composer
// package at the tagged commit, with stored entries, the time of the commit and TZ=UTC. Declared generated files are
// appended from staged files with fixed mode and the same commit time, so a second run of the same tag writes the same
// bytes without placing generated contents in argv. Each archive carries the manifest of its package unchanged, and
// the manifest names every package of its scope by an exact version (see manifestProblems). `publish` creates the draft
// release of the tag through the API with the archives (github-release.mts createDraft) and records its id in
// var/release/<tag>.json; the notes are the section X.Y.Z, or one line that links the section when it is longer than
// NOTES_LIMIT characters, the limit of a release body. `undraft`, and the release proof, read the draft by that id: the
// list of releases shows a new draft only after a while, and its tag does not address it.
// A `wheel` package builds its PEP 427 wheel `<distribution>-<version>-py3-none-any.whl` from the tagged commit with the build
// backend of pythonBackend of config/toolchain.json (release-wheel.mts); each of its Requires-Dist lines is a registry pin or a polyspec release asset that
// its lock of consumers.wheel.lock holds (wheel-dependencies.mts).
// Each failure names the tag, the file or the check, and the expected and the actual value, and exits with status 1.
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import semver from 'semver';
import { createDraft, deleteRelease, makePublic, releaseById, releaseOf, type GitHubRelease } from './github-release.mts';
import { consumerConfigProblems } from './release-consumer-config.mts';
import { readCargoPackages, readGoMod } from './toolchain-files.mts';
import { headings } from './markdown.mts';
import { writeJson } from './bootstrap/files.mts';
import { readNpmManifest, type ComposerManifest, type NpmManifest } from './manifests.mts';
import { isTable, readToml } from './toml.mts';
import { backendFinding, buildBackend, buildWheel, metadataProblems, sourceProblems, wheelMetadata, wheelName } from './release-wheel.mts';
import { lockProblems, siblingsOf, wheelDependencyProblems } from './wheel-dependencies.mts';
import { parseJson, readConfig, readConfigFindings } from './schema-validate.mts';
import { checkedFiles } from './tracked-files.mts';
import { copiesOf, runningKit, writtenByKit } from './kit-check.mts';
import { isMain, repositoryRoot } from './paths.mts';
import { execute, run, Stop } from './process.mts';
import { present } from './present.mts';
import { toolCommand } from './mise-tools.mts';
import { installedGenStub } from './install-php-arginfo.mts';

export const MAIN = 'origin/main';
export const CONFIG = 'config/release.json';
export const ASSETS = 'var/release/assets';
export const DEFAULT_CHECKS = ['push-gate', 'ci-passed'];
// GitHub refuses a release body over 125000 characters.
export const NOTES_LIMIT = 125000;
export const MODES: readonly string[] = ['archive', 'version', 'git-tag'];
// The files of a checkout that carry the version or the module of a package; coverage requires each to be classified.
export const PACKAGE_FILES = ['package.json', 'composer.json', 'Cargo.toml', 'pyproject.toml', 'go.mod', 'VERSION'];
const MANIFEST_FILES = PACKAGE_FILES.filter(name => name !== 'go.mod');
const TAG = /^(?:(?<directory>[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*)\/)?v(?<version>(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))$/;
const EXACT_VERSION = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;
const MANIFEST_OF: Record<PackageKind, string> = { npm: 'package.json', composer: 'composer.json', wheel: 'pyproject.toml' };
// The language and the extension of the archive of each package kind: an npm tarball and a Composer zip.
const ARCHIVE_FORMAT: Record<Exclude<PackageKind, 'wheel'>, [string, string]> = { npm: ['npm', 'tgz'], composer: ['php', 'zip'] };
const NPM_DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'] as const;
const COMPOSER_DEPENDENCY_FIELDS = ['require', 'require-dev'] as const;

/** The kind of a package of config/release.json. */
export type PackageKind = 'npm' | 'composer' | 'wheel';

/** A package of `packages` of config/release.json. */
export interface ReleasePackage {
  kind: PackageKind;
  directory: string;
  name: string;
  generated?: ReleaseGeneratedArtifact[];
}

/** A build artifact materialized from the committed package snapshot only while its Composer archive is made. */
export type ReleaseGeneratedArtifact = {
  kind: 'php-arginfo';
  stub: string;
  output: string;
} | {
  kind: 'source-copy';
  source: string;
  output: string;
};

/** The consumer project of the npm or the Composer archives: its directory and the smoke command of each package. */
export interface ConsumerProject {
  directory: string;
  smoke: Record<string, string[]>;
  /** The entries of config/release-assets.json whose zips the Composer project holds (consumers.composer.polyspec). */
  polyspec?: string[];
}

/** The consumer of the wheels: the smoke command and the lock file of each wheel package, the polyspec repositories. */
export interface WheelConsumer {
  smoke: Record<string, string[]>;
  lock: Record<string, string>;
  polyspec: Record<string, string>;
}

/** An entry of proof.gitTag: how the release proof installs a manifest of the mode git-tag. */
export interface GitTagProof {
  kind: string;
  name: string;
  smoke: string[];
}

/** config/release.json after loadConfig: the schema and the checks of loadConfig hold every value to its form. */
export interface ReleaseConfig {
  schema: 1;
  repositoryUrl: string;
  changelog: string;
  changelogTranslations: string[];
  checks: string[];
  packages: ReleasePackage[];
  manifests: Record<string, string>;
  notReleased: Record<string, string>;
  goModules: Record<string, string>;
  consumers?: { npm?: ConsumerProject; composer?: ConsumerProject; wheel?: WheelConsumer };
  proof?: { gitTag: Record<string, GitTagProof> };
}

/** config/release.json as the schema admits it: the values of the maps are not checked yet, two lists may be absent. */
type SchemaReleaseConfig = Omit<ReleaseConfig, 'changelogTranslations' | 'checks' | 'manifests' | 'notReleased' | 'goModules'> & {
  changelogTranslations?: string[];
  checks?: string[];
  manifests: Record<string, unknown>;
  notReleased: Record<string, unknown>;
  goModules: Record<string, unknown>;
};

/** A command context of context(). A test sets `repository` in place of GITHUB_REPOSITORY. */
export interface Context {
  root: string;
  config: ReleaseConfig;
  env: NodeJS.ProcessEnv;
  log: (text: string) => void;
  repository?: string;
}

/** A parsed manifest, package.json (NpmManifest) or composer.json (ComposerManifest), in the fields that the release reads. */
export type Manifest = { name?: string; version?: string; overrides?: Record<string, unknown>; repositories?: { type?: string; url?: string }[] } & Partial<Record<typeof NPM_DEPENDENCY_FIELDS[number] | typeof COMPOSER_DEPENDENCY_FIELDS[number], Record<string, string>>>;

/** The manifest `text` of a package of `kind` (npm or composer), named `file` in an error, against its schema. */
const parseManifest = (kind: 'npm' | 'composer', text: string, file: string): Manifest =>
  (kind === 'npm' ? parseJson<NpmManifest>(text, 'npm-manifest.schema.json', file) : parseJson<ComposerManifest>(text, 'composer-manifest.schema.json', file));

/** Whether a thrown value carries the code ENOENT of a missing file. */
const missingFile = (value: unknown): value is NodeJS.ErrnoException => typeof value === 'object' && value !== null && 'code' in value && value.code === 'ENOENT';

/** The options of the command line of a release tool: the checkout, the environment and where the lines go. */
export type CommandOptions = { root?: string; env?: NodeJS.ProcessEnv; print?: (text: string) => void; error?: (text: string) => void };

/**
 * The message of a failure that a release step reports with the exit status 1: a Stop, a JSON syntax error or a missing
 * file. Any other failure is a defect of the tool and is thrown on.
 */
export function stepFailure(failure: unknown): string {
  if (!(failure instanceof Stop) && !(failure instanceof SyntaxError) && !missingFile(failure)) throw failure;
  return failure.message;
}

/**
 * The configuration of the repository at `root`: config/release.json validated against its schema and for the rules that the
 * schema cannot express (the values of the maps, the packages against the manifests). Stop with every finding.
 */
export function loadConfig(root: string): ReleaseConfig {
  const file = path.join(root, CONFIG);
  if (!existsSync(file)) throw new Stop(`${CONFIG}: the file is missing; a repository that releases declares its packages in it`);
  const { value: config, errors } = readConfigFindings<SchemaReleaseConfig>(root, CONFIG, 'release.schema.json');
  if (errors) throw new Stop(errors.join('; '));
  const problems: string[] = [];
  // Each map with the values that pass `check`, which accepts text only; each other value is a problem.
  const reason = (map: 'manifests' | 'notReleased' | 'goModules', where: string, check: (key: string, value: unknown) => string | null): Record<string, string> => {
    const read: Record<string, string> = {};
    for (const [key, value] of Object.entries(config[map])) {
      const found = check(key, value);
      if (found) problems.push(`${CONFIG}: ${where}.${key} ${found}`);
      else if (typeof value === 'string') read[key] = value;
    }
    return read;
  };
  const manifests = reason('manifests', 'manifests', (key, value) => (!MANIFEST_FILES.includes(path.posix.basename(key))
    ? `is not a ${MANIFEST_FILES.join(', ')} file`
    : typeof value === 'string' && MODES.includes(value) ? null : `is ${JSON.stringify(value)}, the allowed values are ${MODES.join(', ')}`));
  const notReleased = reason('notReleased', 'notReleased', (key, value) => (typeof value === 'string' && value.trim() ? null : 'needs a reason, a non-empty string'));
  const goModules = reason('goModules', 'goModules', (key, value) => (typeof value === 'string' && value ? null : 'needs the module path of its go.mod'));
  for (const key of Object.keys(config.manifests)) if (key in config.notReleased) problems.push(`${CONFIG}: ${key} is in both manifests and notReleased`);
  const names = new Set<string>();
  const directories = new Set<string>();
  for (const { kind, directory, name } of config.packages) {
    const shape = { npm: /^(@[a-z0-9._-]+\/)?[a-z0-9._-]+$/, composer: /^[a-z0-9._-]+\/[a-z0-9._-]+$/, wheel: /^[a-z0-9._-]+$/ }[kind];
    const form = { npm: '`name` or `@scope/name`', composer: '`vendor/name`', wheel: 'project name of PyPI' }[kind];
    if (!shape.test(name)) problems.push(`${CONFIG}: the ${kind} package ${name} is not a ${form}`);
    if (names.has(`${kind}:${name}`)) problems.push(`${CONFIG}: the ${kind} package ${name} is listed twice`);
    if (directories.has(directory)) problems.push(`${CONFIG}: the directory ${directory} holds two packages`);
    names.add(`${kind}:${name}`);
    directories.add(directory);
    const manifest = path.posix.join(directory, MANIFEST_OF[kind]);
    if (config.manifests[manifest] !== 'archive') problems.push(`${CONFIG}: the package ${name} needs manifests.${manifest} = "archive", found ${JSON.stringify(config.manifests[manifest] ?? null)}`);
    for (const generated of config.packages.find(item => item.directory === directory)?.generated ?? []) {
      if (kind !== 'composer') problems.push(`${CONFIG}: generated artifacts of ${directory} require a Composer package`);
      const valid = (file: string) => file !== '' && !file.startsWith('~') && !file.startsWith('/') && path.win32.parse(file).root === '' && !file.includes('\\') && file.split('/').every(part => part !== '' && part !== '.' && part !== '..');
      if (generated.kind === 'php-arginfo') {
        if (!valid(generated.stub) || !generated.stub.endsWith('.stub.php')) problems.push(`${CONFIG}: generated php-arginfo stub ${JSON.stringify(generated.stub)} is not a package-relative .stub.php path`);
        if (!valid(generated.output) || generated.output !== generated.stub.replace(/\.stub\.php$/, '_arginfo.h')) problems.push(`${CONFIG}: generated php-arginfo output ${JSON.stringify(generated.output)} must be the matching _arginfo.h beside its stub`);
      } else if (generated.kind === 'source-copy') {
        if (!valid(generated.source)) problems.push(`${CONFIG}: source-copy source ${JSON.stringify(generated.source)} is not a repository-relative path without empty, dot or parent segments`);
        if (!valid(generated.output)) problems.push(`${CONFIG}: source-copy output ${JSON.stringify(generated.output)} is not a package-relative path without empty, dot or parent segments`);
      }
    }
    const outputs = (config.packages.find(item => item.directory === directory)?.generated ?? []).map(item => item.output);
    for (const output of new Set(outputs)) if (outputs.filter(item => item === output).length > 1) problems.push(`${CONFIG}: generated output ${directory}/${output} is declared more than once`);
  }
  const backend = backendFinding(root, config);
  if (backend) problems.push(backend);
  const archived = new Set(config.packages.map(({ directory, kind }) => path.posix.join(directory, MANIFEST_OF[kind])));
  for (const [key, value] of Object.entries(config.manifests)) {
    if (value === 'archive' && !archived.has(key)) problems.push(`${CONFIG}: manifests.${key} is "archive" but no package of packages has that manifest`);
  }
  if (new Set(assetNames(config, '1.0.0')).size !== config.packages.length) problems.push(`${CONFIG}: two packages have the same archive name`);
  problems.push(...consumerConfigProblems(config).map(problem => `${CONFIG}: ${problem}`));
  if (problems.length) throw new Stop(problems.join('; '));
  return { ...config, checks: config.checks ?? DEFAULT_CHECKS, changelogTranslations: config.changelogTranslations ?? [], manifests, notReleased, goModules };
}

const at = (ctx: Context) => ({ cwd: ctx.root, env: ctx.env });

/** A command context: the repository root, its configuration, the environment of its commands and a log function. */
export function context(root: string, { config = loadConfig(root), env = process.env, log = () => {} }: { config?: ReleaseConfig; env?: NodeJS.ProcessEnv; log?: (text: string) => void } = {}): Context {
  return { root, config, env, log };
}

/** The newest root release tag reachable from HEAD, which resolves the argument `latest` of the release
 * commands: no release task names a version in its retry, and `make release-consumer TAG=latest` verifies the
 * release that the tree carries. */
export function latestTag(ctx: Context): string {
  const list = run('git', ['tag', '--merged', 'HEAD', '--list', 'v[0-9]*'], at(ctx));
  // A release tag is vX.Y.Z; the pattern v[0-9]* also lists tags such as v1.2 or v1.2.3-rc1, which name no release.
  const tags = list.trim().split('\n').filter(tag => tag.startsWith('v') && EXACT_VERSION.test(tag.slice(1)));
  if (tags.length === 0) throw new Stop('no release tag is reachable from HEAD, so latest names no release');
  // tags holds at least one tag, checked above, and semver reads each vX.Y.Z.
  return present(semver.rsort(tags)[0], 'semver.rsort(tags)[0]');
}

/** [Go module directory or null, version] of a release tag. */
export function parseTag(config: Pick<ReleaseConfig, 'goModules'>, tag: string): [string | null, string] {
  const found = TAG.exec(tag);
  if (!found) throw new Stop(`${tag}: a release tag is vX.Y.Z or <Go module directory>/vX.Y.Z`);
  // TAG has named groups, so a match has groups.
  const directory = present(found.groups, 'found.groups').directory ?? null;
  if (directory !== null && (directory === '.' || !(directory in config.goModules))) {
    throw new Stop(`${tag}: ${directory} is not a Go module directory; the Go modules are [${Object.keys(config.goModules).filter(item => item !== '.').sort().join(', ')}]`);
  }
  // TAG has named groups and the group version takes part in every match.
  return [directory, present(present(found.groups, 'found.groups').version, 'found.groups.version')];
}

const taggedCommit = (ctx: Context, tag: string) => run('git', ['rev-parse', '--verify', `refs/tags/${tag}^{commit}`], at(ctx)).trim();

/**
 * The problems of the Go module tags of a tag vX.Y.Z: each declared Go module below the root needs the tag
 * `<directory>/vX.Y.Z` at the commit of vX.Y.Z, because a Go proxy resolves the module from that tag. A missing tag and a tag at
 * another commit name the git command that creates it. A Go module tag releases that module only and has no sibling tags.
 */
export function goTagProblems(ctx: Context, tag: string): string[] {
  const [directory, version] = parseTag(ctx.config, tag);
  if (directory !== null) return [];
  const commit = taggedCommit(ctx, tag);
  const problems: string[] = [];
  for (const [module, modulePath] of Object.entries(ctx.config.goModules).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (module === '.') continue;
    const goTag = `${module}/v${version}`;
    const found = execute('git', ['rev-parse', '--verify', '--quiet', `refs/tags/${goTag}^{commit}`], at(ctx));
    const create = `git tag -a ${goTag} -m ${goTag} ${commit} && git push origin ${goTag}`;
    if (found.status !== 0) problems.push(`the Go module tag ${goTag} is missing; a Go proxy resolves ${modulePath} from it. Fix: ${create}`);
    else if (found.stdout.trim() !== commit) problems.push(`the Go module tag ${goTag} is at ${found.stdout.trim()}, the tag ${tag} is at ${commit}. Fix: git tag -d ${goTag} && ${create}`);
  }
  return problems;
}

/** The tagged commit is on main, its Go module tags exist and the latest run of every configured check concluded success: { commit, checks }. */
/**
 * Creates the annotated tag `tag` at origin/main and pushes it, the first step of a release that the release workflow starts from
 * a dispatch (K269); returns what it did. A second run passes when the tag already names that commit; a tag at another commit
 * stops, since a published tag is never moved. In GitHub Actions the tagger is the actor of the run.
 */
export function createTag(ctx: Context, tag: string): string {
  parseTag(ctx.config, tag);
  const main = run('git', ['rev-parse', '--verify', `${MAIN}^{commit}`], at(ctx)).trim();
  const existing = execute('git', ['rev-parse', '--verify', '--quiet', `refs/tags/${tag}^{commit}`], at(ctx));
  if (existing.status === 0) {
    const commit = existing.stdout.trim();
    if (commit !== main) throw new Stop(`the tag ${tag} is at ${commit}, not at ${MAIN} ${main}; a published tag is never moved`);
    return `the tag ${tag} is at ${main} already`;
  }
  const actor = ctx.env.GITHUB_ACTOR;
  const identity = actor ? ['-c', `user.name=${actor}`, '-c', `user.email=${actor}@users.noreply.github.com`] : [];
  run('git', [...identity, 'tag', '-a', tag, '-m', tag, main], at(ctx));
  run('git', ['push', 'origin', `refs/tags/${tag}`], at(ctx));
  return `created the tag ${tag} at ${main} and pushed it`;
}

export function verify(ctx: Context, tag: string): { commit: string; checks: string[] } {
  parseTag(ctx.config, tag);
  const repository = ctx.repository ?? ctx.env.GITHUB_REPOSITORY;
  if (!repository) throw new Stop('GITHUB_REPOSITORY is not set; it names the repository <owner>/<name> whose check runs are read');
  const commit = taggedCommit(ctx, tag);
  const problems: string[] = [];
  // A release tag is annotated: its object is a tag object that records the tagger and the time, not the commit itself.
  const kind = run('git', ['cat-file', '-t', `refs/tags/${tag}`], at(ctx)).trim();
  if (kind !== 'tag') problems.push(`the tag ${tag} has the object type ${kind}, not tag; a release tag is annotated, so create it with git tag -a ${tag} -m ${tag}`);
  const ancestry = execute('git', ['merge-base', '--is-ancestor', commit, MAIN], at(ctx));
  if (ancestry.status === 1) problems.push(`the commit is not on ${MAIN}; a release tags a commit of main`);
  else if (ancestry.status !== 0) throw new Stop(`git merge-base --is-ancestor ${commit} ${MAIN} exited with ${ancestry.status}: ${(ancestry.stderr ?? '').trim()}`);
  ctx.log(`[release] ${tag}: reading the Go module tags of ${Object.keys(ctx.config.goModules).filter(item => item !== '.').length} modules`);
  problems.push(...goTagProblems(ctx, tag));
  ctx.log(`[release] ${tag}: reading the check runs of ${commit} in ${repository}`);
  const listed = run('gh', ['api', '--paginate', `repos/${repository}/commits/${commit}/check-runs?per_page=100`, '--jq', '.check_runs[] | [.id, .name, .status, .conclusion] | @json'], at(ctx));
  // Each line is the JSON array [id, name, status, conclusion] that the --jq filter writes.
  const runs = listed.split('\n').filter(line => line.trim()).map(line => parseJson<[number, string, string, string | null]>(line, 'github-check-run.schema.json', 'gh api check-runs'));
  for (const name of ctx.config.checks) {
    const named = runs.filter(entry => entry[1] === name);
    if (named.length === 0) {
      problems.push(`the check ${name} is missing`);
      continue;
    }
    // A rerun of a check is a new run with a greater id; the latest run decides.
    const [, , status, conclusion] = named.reduce((latest, entry) => (entry[0] > latest[0] ? entry : latest));
    if (status !== 'completed' || conclusion !== 'success') problems.push(`the check ${name} is ${status} with the conclusion ${conclusion}, not success`);
  }
  if (problems.length) throw new Stop(`${tag}: the commit ${commit}: ${problems.join('; ')}`);
  return { commit, checks: [...ctx.config.checks] };
}

/**
 * The version that a manifest file declares, or null without one. A composer.json may omit it: Composer takes the tag. A
 * Cargo.toml is read by `cargo metadata --no-deps`, so a member that inherits `version.workspace` has the version of its
 * workspace; a virtual workspace manifest, which is no package, declares the `[workspace.package]` version of its members.
 */
export function manifestVersion(file: string): string | null {
  const text = readFileSync(file, 'utf8');
  const name = path.basename(file);
  if (name === 'package.json' || name === 'composer.json') return parseManifest(name === 'package.json' ? 'npm' : 'composer', text, file).version ?? null;
  if (name === 'VERSION') return text.trim() || null;
  if (name === 'Cargo.toml') return cargoVersion(file, text);
  if (name !== 'pyproject.toml') throw new Stop(`${name}: not a manifest of a release`);
  const table = readToml(text, file).project;
  return isTable(table) && typeof table.version === 'string' ? table.version : null;
}

/** The version of the Cargo manifest `file` (text `text`): its package's as cargo resolves it, or its workspace's. */
function cargoVersion(file: string, text: string): string | null {
  const manifest = path.resolve(file);
  const own = readCargoPackages(path.dirname(manifest), 'Cargo.toml', process.env).find(entry => path.resolve(entry.manifest_path) === manifest);
  if (own) return own.version;
  const workspace = readToml(text, file).workspace;
  const shared = isTable(workspace) ? workspace.package : undefined;
  return isTable(shared) && typeof shared.version === 'string' ? shared.version : null;
}

/** The level-2 heading of the section `version` of the change log `text` of `file`, with the headings of the text. */
function versionHeading(text: string, file: string, version: string) {
  const found = headings(text);
  const heading = found.find(item => item.depth === 2 && item.title === version);
  if (!heading) throw new Stop(`${file}: no section ## ${version}`);
  return { heading, found };
}

/**
 * The body of the section `## version` of the change log `file`, without the anchor of the next section: the lines after its
 * heading up to the next heading of level 1 or 2, as the Markdown tree reads them (markdown.mts).
 */
export function changelogSection(root: string, file: string, version: string): string {
  const text = readFileSync(path.join(root, file), 'utf8');
  const lines = text.split('\n').map(line => line.trimEnd());
  const { heading, found } = versionHeading(text, file, version);
  const next = found.find(item => item.line > heading.line && item.depth <= 2);
  const body = lines.slice(heading.endLine, next ? next.line - 1 : lines.length);
  // The loop reads the last entry of body only while body has one.
  while (body.length && (!present(body.at(-1), 'body.at(-1)').trim() || /^<a id="[^"]*"><\/a>$/.test(present(body.at(-1), 'body.at(-1)').trim()))) body.pop();
  // The loop reads the first entry of body only while body has one.
  while (body.length && !present(body[0], 'body[0]').trim()) body.shift();
  if (!body.length) throw new Stop(`${file}: the section ## ${version} has no entry`);
  return `${body.join('\n')}\n`;
}

/** The anchor of the section `## version`: the id of an `<a id>` block right above it, else the version without its dots. */
export function changelogAnchor(root: string, file: string, version: string): string {
  const { heading } = versionHeading(readFileSync(path.join(root, file), 'utf8'), file, version);
  const explicit = heading.htmlBefore === null ? null : /^<a id="([^"]+)"><\/a>$/.exec(heading.htmlBefore.trim());
  // The group 1 of the pattern takes part in every match.
  return explicit ? present(explicit[1], 'explicit[1]') : version.replaceAll('.', '');
}

/** The notes of the release of the tag: the section when it has at most NOTES_LIMIT characters, otherwise one linking line. */
export function releaseNotes(ctx: Context, tag: string): string {
  const [, version] = parseTag(ctx.config, tag);
  const { changelog, repositoryUrl } = ctx.config;
  const section = changelogSection(ctx.root, changelog, version);
  if (section.length <= NOTES_LIMIT) return section;
  const tagPath = tag.split('/').map(encodeURIComponent).join('/');
  return `The changes of ${version} are listed in [${path.posix.basename(changelog)}](${repositoryUrl}/blob/${tagPath}/${changelog}#${changelogAnchor(ctx.root, changelog, version)}).\n`;
}


/** Every manifest of the tag declares its version and the change logs have the section of the version: the version. */
export function versions(ctx: Context, tag: string): string {
  const { root, config } = ctx;
  const [directory, version] = parseTag(config, tag);
  const problems: string[] = [];
  if (directory === null) {
    for (const [name, mode] of Object.entries(config.manifests)) {
      ctx.log(`[release] ${tag}: reading the version of ${name}`);
      const declared = manifestVersion(path.join(root, name));
      // A package that is released as an archive declares its version; Composer takes it from the tag for other manifests.
      const missingOk = declared === null && path.basename(name) === 'composer.json' && mode !== 'archive';
      if (declared !== version && !missingOk) problems.push(`${name}: version ${declared ?? 'none'}, the tag ${tag} is ${version}`);
    }
  }
  for (const [module, expected] of Object.entries(config.goModules)) {
    if (directory !== null && directory !== module) continue;
    const file = `${module === '.' ? '' : `${module}/`}go.mod`;
    if (!existsSync(path.join(root, file))) {
      problems.push(`${file}: the file is missing for the tag ${tag}`);
      continue;
    }
    // go mod edit -json reads the module directive as Go does.
    const declared = readGoMod(root, file, ctx.env).Module.Path;
    if (declared !== expected) problems.push(`${file}: module ${declared}, the tag ${tag} is ${expected}`);
  }
  for (const file of [config.changelog, ...config.changelogTranslations]) {
    try {
      changelogSection(root, file, version);
    } catch (error) {
      if (!(error instanceof Stop) && !missingFile(error)) throw error;
      problems.push(`${error instanceof Stop ? error.message : `${file}: the file is missing`} for the tag ${tag}`);
    }
  }
  if (problems.length) throw new Stop(problems.join('; '));
  return version;
}

/**
 * <package>-<language>-<version>.<ext>: `@scope/name` is written `scope-name` and `vendor/name` `vendor-name`, the language
 * is `npm` for an npm package and `php` for a Composer package: `@scope/x` is `scope-x-npm-1.0.0.tgz` and `vendor/x` is
 * `vendor-x-php-1.0.0.zip`.
 */
export function assetName(name: string, language: string, version: string, extension: string): string {
  return `${name.replace(/^@/, '').replaceAll('/', '-')}-${language}-${version}.${extension}`;
}

/** The file name of the archive of a package of `kind` at `version`: a wheel keeps its PEP 427 name. */
export function archiveName(kind: PackageKind, name: string, version: string): string {
  if (kind === 'wheel') return wheelName(name, version);
  return assetName(name, ARCHIVE_FORMAT[kind][0], version, ARCHIVE_FORMAT[kind][1]);
}

/** The archive names of the packages at `version`, in the order of the configuration. */
export function assetNames(config: Pick<ReleaseConfig, 'packages'>, version: string): string[] {
  return config.packages.map(({ kind, name }) => archiveName(kind, name, version));
}

const SOURCE_FORMS: [RegExp, string][] = [
  [/^(?:file|link|workspace|portal):/, 'a path of the repository'],
  [/^(?:git(?:\+[a-z]+)?:|github:|gitlab:|bitbucket:|ssh:|git@)|\.git(?:#|$)/, 'a git source'],
  [/^[a-z][a-z0-9+.-]*:\/\//i, 'a URL'],
  [/@dev\b|^dev-|-dev$/, 'a development version'],
];

/** The form of a dependency spec that is not an exact version. */
function specForm(spec: string): string {
  for (const [pattern, form] of SOURCE_FORMS) if (pattern.test(spec)) return form;
  return EXACT_VERSION.test(spec) ? 'another version' : 'a range';
}

/** The scopes of the packages of `kind`: `@scope/` of an npm package, `vendor/` of a Composer package. */
function scopesOf(config: Pick<ReleaseConfig, 'packages'>, kind: PackageKind): Set<string> {
  return new Set(config.packages.filter(item => item.kind === kind).map(({ name }) => name.slice(0, name.indexOf('/') + 1)).filter(Boolean));
}

/**
 * The problems of a manifest that an archive of `kind` carries at `version`. A consumer installs the archives together
 * without the repository, so a dependency is a registry version: no path, URL, git source or development version. A dependency on a
 * package of a scope of this repository is one exact version, and the version of a package of this repository is the
 * version of the tag. A package.json declares no `overrides`; a composer.json declares the version of the tag and no
 * `repositories`.
 */
export function manifestProblems(config: Pick<ReleaseConfig, 'packages'>, kind: PackageKind, manifest: Manifest, version: string): string[] {
  const problems: string[] = [];
  const ours = new Set(config.packages.filter(item => item.kind === kind).map(({ name }) => name));
  const scopes = scopesOf(config, kind);
  const fields = kind === 'npm' ? NPM_DEPENDENCY_FIELDS : COMPOSER_DEPENDENCY_FIELDS;
  for (const field of fields) {
    for (const [name, spec] of Object.entries(manifest[field] ?? {})) {
      const form = specForm(spec);
      const sourced = form !== 'a range' && form !== 'another version';
      const ofScope = [...scopes].some(scope => name.startsWith(scope));
      if (sourced) problems.push(`${field} ${name}: ${spec} is ${form}, not a registry version`);
      else if (ours.has(name) ? spec !== version : ofScope && !EXACT_VERSION.test(spec)) problems.push(`${field} ${name}: ${spec} is ${form}, not ${ours.has(name) ? version : 'an exact version'}`);
    }
  }
  if (kind === 'npm' && 'overrides' in manifest) problems.push(`overrides: ${JSON.stringify(manifest.overrides)}; a published package.json resolves only by name and version`);
  if (kind === 'composer') {
    if (manifest.version !== version) problems.push(`version: ${manifest.version ?? 'none'}, not ${version}`);
    if ('repositories' in manifest) problems.push(`repositories: ${JSON.stringify(manifest.repositories)}; a release zip declares none`);
  }
  return problems;
}

/** The manifest text that an archive carries: package/package.json of a tarball, composer.json at the root of a zip. */
export function packedManifest(ctx: Context, file: string): string {
  return file.endsWith('.tgz') ? run('tar', ['-xzOf', file, 'package/package.json'], at(ctx)) : run('unzip', ['-p', file, 'composer.json'], at(ctx));
}

/** Generate package artifacts from the tagged sources in a private temporary directory. */
function generatedArchiveFiles(ctx: Context, commit: string, folder: string, generated: ReleaseGeneratedArtifact[] | undefined): { directory: string; files: { output: string; file: string }[] } | null {
  if (!generated?.length) return null;
  const phpArginfo = generated.filter(item => item.kind === 'php-arginfo');
  const sourceCopies = generated.filter((item): item is Extract<ReleaseGeneratedArtifact, { kind: 'source-copy' }> => item.kind === 'source-copy');
  const temporary = mkdtempSync(path.join(tmpdir(), 'kit-release-arginfo-'));
  try {
    const files: { output: string; file: string }[] = [];
    if (phpArginfo.length) {
      const generator = installedGenStub(ctx.root);
      const php = toolCommand(ctx.root, 'php');
      for (const item of phpArginfo) {
        const stub = path.join(temporary, path.basename(item.stub));
        const source = run('git', ['show', `${commit}:${path.posix.join(folder, item.stub)}`], at(ctx));
        writeFileSync(stub, source);
        const result = execute(php, [generator.file, '--force-regeneration', stub], { cwd: temporary, env: ctx.env });
        if (result.error) throw new Stop(`${php} could not start while generating ${path.posix.join(folder, item.output)}: ${result.error.message}`);
        if (result.status !== 0) throw new Stop(`${php} ${path.basename(generator.file)} failed for ${path.posix.join(folder, item.stub)} with exit status ${result.status}: ${(result.stdout + result.stderr).trim()}`);
        const output = path.join(temporary, path.basename(item.output));
        if (!existsSync(output)) throw new Stop(`${generator.file} did not write ${path.posix.join(folder, item.output)}`);
        const staged = path.join(temporary, item.output);
        mkdirSync(path.dirname(staged), { recursive: true });
        copyFileSync(output, staged);
        files.push({ output: item.output, file: staged });
      }
    }
    const packagePrefix = folder === '.' ? '' : `${folder}/`;
    const packageFiles = run('git', ['ls-tree', '-r', '--name-only', commit, folder], at(ctx)).split('\n').filter(Boolean).map(file => (packagePrefix ? file.slice(packagePrefix.length) : file));
    for (const item of sourceCopies) {
      const staged = path.resolve(temporary, item.output);
      if (packageFiles.some(file => file === item.output || file.startsWith(`${item.output}/`) || item.output.startsWith(`${file}/`))) {
        throw new Stop(`${CONFIG}: source-copy output ${folder}/${item.output} overlaps a file or directory of the tagged package`);
      }
      const sourceFiles = run('git', ['ls-tree', '-r', '--name-only', commit, '--', item.source], at(ctx)).split('\n').filter(Boolean);
      if (!sourceFiles.includes(item.source)) throw new Stop(`${CONFIG}: source-copy source ${item.source} is not a tracked file at tagged commit ${commit}`);
      const contents = run('git', ['show', `${commit}:${item.source}`], at(ctx));
      mkdirSync(path.dirname(staged), { recursive: true });
      writeFileSync(staged, contents);
      files.push({ output: item.output, file: staged });
    }
    return { directory: temporary, files };
  } catch (error) {
    rmSync(temporary, { recursive: true, force: true });
    throw error;
  }
}

/**
 * Builds the archive of every package of the tag into var/release/assets and returns their names. The manifests of the
 * tagged commit must pass manifestProblems before a package is packed, and each archive must carry the manifest of its
 * package at the commit byte for byte, because no step rewrites a manifest. The directory is replaced as a whole.
 */
export function assets(ctx: Context, tag: string): string[] {
  const { root, config } = ctx;
  const [directory, version] = parseTag(config, tag);
  const target = path.join(root, ASSETS);
  if (directory !== null) {
    ctx.log(`[release] ${tag}: a Go module tag builds no archive`);
    rmSync(target, { recursive: true, force: true });
    mkdirSync(target, { recursive: true });
    return [];
  }
  if (config.packages.some(item => item.generated?.length)) {
    const zip = execute('zip', ['-v'], { cwd: root, env: ctx.env });
    if (zip.error) throw new Stop(`zip is required to append generated files to Composer release archives; install Info-ZIP (for example, brew install zip or sudo apt-get install zip), then run make release-assets`);
    if (zip.status !== 0) throw new Stop(`zip -v failed with exit status ${zip.status}; install a working Info-ZIP command, then run make release-assets`);
  }
  const commit = taggedCommit(ctx, tag);
  const names = assetNames(config, version);
  const sources = config.packages.map(({ kind, directory: folder }) => run('git', ['show', `${commit}:${path.posix.join(folder, MANIFEST_OF[kind])}`], at(ctx)));
  // The lock of each wheel package is read from the tagged commit, as its manifest is.
  const locks = config.packages.map(({ kind, name }) => (kind === 'wheel' ? { file: wheelLock(config, name), text: run('git', ['show', `${commit}:${wheelLock(config, name)}`], at(ctx)) } : null));
  const problems = config.packages.flatMap(({ kind, directory: folder, name }, index) => {
    const file = path.posix.join(folder, MANIFEST_OF[kind]);
    // sources and locks hold the manifest and the lock of each package at its index.
    if (kind === 'wheel') return [...sourceProblems({ file, text: present(sources[index], 'sources[index]'), name, requirement: buildBackend(root).requirement }), ...lockProblems(present(locks[index], 'locks[index]').text, present(locks[index], 'locks[index]').file)];
    // sources holds the manifest of each package at its index.
    const manifest = parseManifest(kind, present(sources[index], 'sources[index]'), file);
    return [
      ...(manifest.name === name ? [] : [`${file}: name ${manifest.name ?? 'none'}, ${CONFIG} declares ${name}`]),
      ...manifestProblems(config, kind, manifest, version).map(problem => `${file}: ${problem}`),
    ];
  });
  if (problems.length) throw new Stop(`${tag}: the manifests of the commit ${commit} do not install outside the repository: ${problems.join('; ')}`);
  const mtime = new Date(Number(run('git', ['show', '-s', '--format=%ct', commit], at(ctx)).trim()) * 1000).toISOString();
  const next = `${target}.next-${process.pid}`;
  const previous = `${target}.previous-${process.pid}`;
  rmSync(next, { recursive: true, force: true });
  rmSync(previous, { recursive: true, force: true });
  mkdirSync(next, { recursive: true });
  try {
    config.packages.forEach(({ kind, directory: folder, name }, index) => {
      ctx.log(`[release] ${tag}: packing ${name} from ${folder} into ${names[index]}`);
      if (kind === 'npm') {
        const before = new Set(readdirSync(next));
        // npm is the tool of the checkout, never the one on PATH (K393-1).
        run(toolCommand(root, 'npm'), ['pack', '--pack-destination', next], { cwd: path.join(root, folder), env: ctx.env });
        // npm pack names its output itself; the single new file is renamed to the archive name.
        const created = readdirSync(next).filter(item => !before.has(item));
        if (created.length !== 1) throw new Stop(`npm pack of ${folder} wrote [${created.join(', ')}], not one archive`);
        // created holds one file, checked above, and names holds the archive name of each package at its index.
        renameSync(path.join(next, present(created[0], 'created[0]')), path.join(next, present(names[index], 'names[index]')));
      } else if (kind === 'wheel') {
        buildWheel({ root, env: ctx.env, commit, directory: folder, output: next, buildBackend: buildBackend(root) });
      } else {
        // Stored entries, the time of the commit and TZ=UTC give the zip of a tree the same bytes on every machine and at
        // every time. Files generated from the tagged snapshot are staged with fixed mode and mtime and appended by path;
        // their contents stay out of argv, whose per-argument limit is platform-dependent.
        // names holds the archive name of each package at its index.
        const generated = generatedArchiveFiles(ctx, commit, folder, config.packages[index]?.generated);
        const archive = path.join(next, present(names[index], 'names[index]'));
        try {
          const args = ['archive', '--format=zip', '-0', `--mtime=${mtime}`, `--output=${archive}`, `${commit}:${folder}`];
          const result = execute('git', args, { cwd: root, env: { ...ctx.env, TZ: 'UTC' } });
          if (result.error) throw new Stop(`git archive could not start for ${commit}:${folder}: ${result.error.message}`);
          if (result.status !== 0) throw new Stop(`git archive of ${commit}:${folder} failed with exit status ${result.status}: ${(result.stdout + result.stderr).trim()}`);
          if (generated) {
            const epoch = Number(run('git', ['show', '-s', '--format=%ct', commit], at(ctx)).trim());
            for (const item of generated.files) {
              chmodSync(item.file, 0o644);
              utimesSync(item.file, epoch, epoch);
              const result = execute('zip', ['-q', '-0', '-X', archive, item.output], { cwd: generated.directory, env: { ...ctx.env, TZ: 'UTC' } });
              if (result.error) throw new Stop(`zip could not start while adding ${item.output} to ${names[index]}: ${result.error.message}`);
              if (result.status !== 0) throw new Stop(`zip failed while adding ${item.output} to ${names[index]} with exit status ${result.status}: ${(result.stdout + result.stderr).trim()}`);
            }
          }
        } finally {
          if (generated) rmSync(generated.directory, { recursive: true, force: true });
        }
      }
    });
    const built = readdirSync(next).sort();
    if (JSON.stringify(built) !== JSON.stringify([...names].sort())) throw new Stop(`${ASSETS} holds [${built.join(', ')}], not the archives [${[...names].sort().join(', ')}]`);
    const failures = config.packages.flatMap(({ kind, directory: folder, name }, index) => {
      if (kind === 'wheel') {
        // names holds the archive name of each package at its index.
        const metadata = wheelMetadata(root, path.join(next, present(names[index], 'names[index]')), ctx.env);
        return [
          ...metadataProblems(metadata, name, version),
          // locks holds the lock of each wheel package at its index.
          ...wheelDependencyProblems({ requiresDist: metadata.requiresDist, name, version, polyspec: wheelConsumer(config).polyspec, siblings: siblingsOf(config, name), repositoryUrl: config.repositoryUrl, lockFile: present(locks[index], 'locks[index]').file, lockText: present(locks[index], 'locks[index]').text }),
        ].map(problem => `${names[index]}: ${problem}`);
      }
      const file = MANIFEST_OF[kind];
      // names holds the archive name of each package at its index.
      const packed = packedManifest(ctx, path.join(next, present(names[index], 'names[index]')));
      return [
        ...(packed === sources[index] ? [] : [`${names[index]}: the packed ${file} differs from ${path.posix.join(folder, file)} of the commit ${commit}`]),
        ...manifestProblems(config, kind, parseManifest(kind, packed, `${present(names[index], 'names[index]')}/${file}`), version).map(problem => `${names[index]}: ${problem}`),
      ];
    });
    if (failures.length) throw new Stop(`${tag}: the release assets do not install outside the repository: ${failures.join('; ')}`);
    if (existsSync(target)) renameSync(target, previous);
    try {
      renameSync(next, target);
    } catch (error) {
      if (existsSync(previous) && !existsSync(target)) renameSync(previous, target);
      throw error;
    }
    rmSync(previous, { recursive: true, force: true });
  } finally {
    rmSync(next, { recursive: true, force: true });
    if (existsSync(previous) && !existsSync(target)) renameSync(previous, target);
  }
  return names;
}

/** The lock file of the wheel package `name` in consumers.wheel.lock. */
function wheelLock(config: ReleaseConfig, name: string): string {
  const file = wheelConsumer(config).lock[name];
  // consumerConfigProblems requires a lock of each wheel package.
  if (file === undefined) throw new Error(`${CONFIG}: consumers.wheel.lock has no lock of the wheel package ${name}`);
  return file;
}

/** consumers.wheel of the configuration, which a wheel package needs. */
function wheelConsumer(config: ReleaseConfig): WheelConsumer {
  // consumerConfigProblems requires consumers.wheel for a wheel package, so loadConfig refuses a configuration without it.
  if (!config.consumers?.wheel) throw new Error(`${CONFIG}: consumers.wheel is missing; the wheel packages of packages need it`);
  return config.consumers.wheel;
}

/** The record of the draft release that publish created for `tag`, relative to the checkout: `{ "id": <id> }`. */
export const releaseRecord = (tag: string) => `var/release/${tag}.json`;

/** The release that publish created for `tag`, read by the id of its record; a missing record is an error. */
export function recordedRelease(ctx: Pick<Context, 'root' | 'env' | 'config'>, tag: string): GitHubRelease {
  const file = releaseRecord(tag);
  if (!existsSync(path.join(ctx.root, file))) throw new Stop(`${file} is missing; make release-publish writes it`);
  const record = readConfig<{ id: number }>(ctx.root, file, 'release-record.schema.json');
  return releaseById({ cwd: ctx.root, env: ctx.env }, ctx.config.repositoryUrl, record.id);
}

/**
 * Creates the GitHub Release of the tag as a draft, with the notes of releaseNotes and the archives of assets, and records its
 * id (releaseRecord). A draft of an earlier run is replaced; a public release is never replaced.
 */
export function publish(ctx: Context, tag: string): string[] {
  const { root, config } = ctx;
  const [directory, version] = parseTag(config, tag);
  const notes = releaseNotes(ctx, tag);
  const names = directory === null ? assetNames(config, version) : [];
  const target = path.join(root, ASSETS);
  const missing = names.filter(name => !existsSync(path.join(target, name)));
  if (missing.length) throw new Stop(`${ASSETS} lacks [${missing.join(', ')}]; make release-assets builds them`);
  const earlier = releaseOf(at(ctx), config.repositoryUrl, tag);
  if (earlier && !earlier.draft) throw new Stop(`the release ${tag} is already public; a public release is not replaced`);
  if (earlier) {
    ctx.log(`[release] ${tag}: removing the draft release ${earlier.id} of an earlier run`);
    deleteRelease(at(ctx), config.repositoryUrl, earlier.id);
  }
  const folder = mkdtempSync(path.join(tmpdir(), 'kit-release-notes-'));
  try {
    const notesFile = path.join(folder, 'notes.md');
    writeFileSync(notesFile, notes);
    ctx.log(`[release] ${tag}: creating the draft GitHub Release with ${names.length} archives`);
    const id = createDraft(at(ctx), config.repositoryUrl, tag, notesFile, names.map(name => path.join(target, name)));
    writeJson(path.join(root, releaseRecord(tag)), { id });
    ctx.log(`[release] ${tag}: the draft release ${id} is recorded in ${releaseRecord(tag)}`);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
  return names;
}

/**
 * Makes the draft release of the tag public; run only after release-proof passed. A release that is already public stays so.
 * Returns true when this call made it public.
 */
export function undraft(ctx: Context, tag: string): boolean {
  const release = recordedRelease(ctx, tag);
  if (!release.draft) {
    ctx.log(`[release] ${tag}: the release is already public`);
    return false;
  }
  makePublic(at(ctx), ctx.config.repositoryUrl, release.id);
  return true;
}

/**
 * The problems of the classification of the package files of the checkout: every tracked or new file named package.json,
 * composer.json, Cargo.toml, pyproject.toml, go.mod or VERSION is a key of `manifests` or `notReleased`, or the go.mod of a
 * Go module, or a file that kit writes (writtenByKit of kit-check.mts), which is not released; a listed file exists; no file
 * is in two lists.
 */
export function coverage(ctx: Context): string[] {
  const { root, config } = ctx;
  const files = checkedFiles(root).filter(file => PACKAGE_FILES.includes(path.posix.basename(file)));
  const goFiles = Object.keys(config.goModules).map(module => `${module === '.' ? '' : `${module}/`}go.mod`);
  const lists = { manifests: Object.keys(config.manifests), notReleased: Object.keys(config.notReleased), goModules: goFiles };
  const problems: string[] = [];
  const where = new Map<string, string>();
  for (const [list, keys] of Object.entries(lists)) {
    for (const key of keys) {
      if (where.has(key)) problems.push(`${key} is in both ${where.get(key)} and ${list} of ${CONFIG}; list it once`);
      where.set(key, list);
      if (!files.includes(key)) problems.push(`${key} is listed in ${list} of ${CONFIG} but is not a package file of the checkout; remove it from the list`);
    }
  }
  const kitFile = writtenByKit(copiesOf(runningKit()));
  for (const file of files) {
    if (!where.has(file) && !kitFile(file)) problems.push(`${file} is neither released nor listed as not released; add it to manifests, notReleased or goModules in ${CONFIG}`);
  }
  problems.push(...fileDependencyProblems(root, config, files.filter(file => path.posix.basename(file) === 'package.json')));
  return problems;
}

const NPM_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'] as const;

/**
 * The problems of the file: dependencies of the package.json files `manifests`: the npm consumer project of `config`
 * (consumers.npm.directory) names the archive of a package of its smoke, file:<name>-npm-<version>.tgz, which it installs;
 * every other manifest names a folder of the repository.
 */
function fileDependencyProblems(root: string, config: ReleaseConfig, manifests: string[]): string[] {
  const consumer = config.consumers?.npm;
  const archives = new Map(Object.keys(consumer?.smoke ?? {}).map((name) => {
    // The archive name holds the version once, at the \0 that stands for it.
    const [before, after] = archiveName('npm', name, '\0').split('\0');
    if (before === undefined || after === undefined) throw new Error(`the npm archive name of ${name} holds no version`);
    return [name, new RegExp(`^file:${RegExp.escape(before)}\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?${RegExp.escape(after)}$`)];
  }));
  const problems: string[] = [];
  for (const manifest of manifests) {
    const directory = path.posix.dirname(manifest);
    const declared = readNpmManifest(root, manifest);
    for (const field of NPM_FIELDS) {
      for (const [name, spec] of Object.entries(declared[field] ?? {})) {
        if (!spec.startsWith('file:')) continue;
        const shown = `${manifest}: ${field}.${name} is ${JSON.stringify(spec)}`;
        if (consumer && directory === consumer.directory) {
          if (!archives.get(name)?.test(spec)) problems.push(`${shown}; the npm consumer project of ${CONFIG} names the archive of a package of its smoke, file:<name>-npm-<version>.tgz`);
          continue;
        }
        const target = path.posix.normalize(path.posix.join(directory, spec.slice('file:'.length)));
        const inside = !path.posix.isAbsolute(target) && target !== '..' && !target.startsWith('../');
        if (!inside || !statSync(path.join(root, target), { throwIfNoEntry: false })?.isDirectory()) {
          problems.push(`${shown}, which names no folder of the repository; a file: dependency names a folder of the repository, and only the npm consumer project${consumer ? ` ${consumer.directory}` : ''} of ${CONFIG} names archives`);
        }
      }
    }
  }
  return problems;
}

const USAGE = 'usage: node scripts/kit/release.mts tag|verify|versions|assets|publish|undraft|go-tags TAG | coverage';

/** Runs a step of the command line; the exit status. */
export function main(argv: string[], { root = repositoryRoot(), env = process.env, print = console.log, error = console.error }: CommandOptions = {}): number {
  const [mode, latest, ...rest] = argv;
  let tag = latest;
  const tagged = mode !== undefined && ['tag', 'verify', 'versions', 'assets', 'publish', 'undraft', 'go-tags'].includes(mode);
  if (!(tagged && tag && rest.length === 0) && !(mode === 'coverage' && tag === undefined)) {
    error(USAGE);
    return 2;
  }
  try {
    const ctx = context(root, { env, log: print });
    const release = tag === 'latest' ? latestTag(ctx) : tag;
    if (release !== tag) print(`[release] latest is ${release}`);
    tag = release;
    if (mode === 'coverage') {
      const problems = coverage(ctx);
      for (const problem of problems) error(`[release] coverage: ${problem}`);
      if (problems.length) {
        error(`[release] coverage failed: ${problems.length} package files are not classified`);
        return 1;
      }
      print(`[release] coverage: every package file is classified in ${CONFIG}`);
    } else if (tag === undefined) {
      throw new Error(`[release] ${mode} has no TAG, which the usage check above requires`);
    } else if (mode === 'tag') {
      print(`[release] ${createTag(ctx, tag)}`);
    } else if (mode === 'verify') {
      const { commit, checks } = verify(ctx, tag);
      print(`[release] ${tag}: the commit ${commit} is on ${MAIN} and passed ${checks.join(', ')}`);
    } else if (mode === 'go-tags') {
      const problems = goTagProblems(ctx, tag);
      for (const problem of problems) error(`[release] go-tags ${tag}: ${problem}`);
      if (problems.length) {
        error(`[release] go-tags ${tag} failed: ${problems.length} Go module tags are missing or at another commit`);
        return 1;
      }
      print(`[release] ${tag}: every Go module has its tag at the commit of ${tag}`);
    } else if (mode === 'versions') {
      const version = versions(ctx, tag);
      print(`[release] ${tag}: every manifest of the tag declares ${version} and ${ctx.config.changelog} has ## ${version}`);
    } else if (mode === 'assets') {
      const names = assets(ctx, tag);
      print(`[release] ${tag}: built ${names.length ? names.join(', ') : 'no archive (a Go module)'} in ${ASSETS}`);
    } else if (mode === 'undraft') {
      const made = undraft(ctx, tag);
      print(`[release] ${tag}: ${made ? 'made the GitHub Release public' : 'the GitHub Release is already public'}`);
    } else {
      const names = publish(ctx, tag);
      print(`[release] ${tag}: created the GitHub Release with ${names.length ? names.join(', ') : 'no archive'}`);
    }
  } catch (failure) {
    error(`[release] ${mode}${tag ? ` ${tag}` : ''} failed: ${stepFailure(failure)}`);
    return 1;
  }
  return 0;
}

if (isMain(import.meta.url)) process.exitCode = main(process.argv.slice(2));
