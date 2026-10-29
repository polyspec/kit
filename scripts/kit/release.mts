#!/usr/bin/env node
// Releases a tag of a commit of main. The steps run in this order from the release workflow (workflows/release.yml), each
// through its make target:
//
//   node scripts/kit/release.mts verify TAG     the tagged commit is on origin/main and its checks concluded success
//   node scripts/kit/release.mts assets TAG     build the archive of every package of the tag, and packages.json of its
//                                               Composer packages, into var/release/assets
//   node scripts/kit/release.mts publish TAG    create the GitHub Release of the tag as a draft, with its notes and those files
//   node scripts/kit/release.mts undraft TAG    make the draft release of the tag public
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
// of each configured check must be completed with the conclusion success.
//   TAG is `latest` for the newest root release tag reachable from HEAD.
// `assets` builds one archive per package, named `<package>-<language>-<version>.<ext>` with `@scope/`
// written `scope-` and `vendor/` `vendor-` (`@scope/x` is `scope-x-npm-1.0.0.tgz`, `vendor/x` is `vendor-x-php-1.0.0.zip`):
// `npm pack` of an npm package, whose output is renamed to that name, and a `git archive` zip of the directory of a Composer
// package at the tagged commit, with stored entries, the time of the commit and TZ=UTC. Declared generated files are
// appended from staged files with fixed mode and the same commit time, so a second run of the same tag writes the same
// bytes without placing generated contents in argv. Each archive carries its unchanged manifest, except kit uses its
// canonical source-to-dist prepack transformation. `publish` creates the draft
// release of the tag through the API with the archives (github-release.mts createDraft) and records its id in
// var/release/<tag>.json; the notes are the section X.Y.Z, or one line that links the section when it is longer than
// NOTES_LIMIT characters, the limit of a release body. `undraft` reads the draft by that id: the
// list of releases shows a new draft only after a while, and its tag does not address it.
// A release with a Composer package also writes packages.json beside the archives (K871): one flat Composer repository, since
// release assets hold no folder, that holds each Composer package under its name and version as its composer.json of the commit
// with a dist of type zip, the URL of its release asset and the sha1 of the zip. A consumer reads it as a composer repository at
// <repositoryUrl>/releases/download/<tag>/packages.json, so it names only the tag and Composer reads the metadata itself.
// A `wheel` package builds its PEP 427 wheel `<distribution>-<version>-py3-none-any.whl` from the tagged commit with uv build,
// which installs the build-system.requires of its pyproject.toml (release-wheel.mts).
// Each failure names the tag, the file or the check, and the expected and the actual value, and exits with status 1.
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import semver from 'semver';
import { createDraft, deleteRelease, makePublic, releaseById, releaseOf, type GitHubRelease } from './github-release.mts';
import { headings } from './markdown.mts';
import { fileDigest } from './bootstrap/digest.mts';
import { writeJson } from './bootstrap/files.mts';
import { type ComposerManifest, type NpmManifest } from './manifests.mts';
import { buildWheel, metadataProblems, wheelMetadata, wheelName } from './release-wheel.mts';
import { parseJson, readConfig, readConfigFindings } from './schema-validate.mts';
import { checkedFiles } from './tracked-files.mts';
import { PACKAGE, copiesOf, runningKit, writtenByKit } from './kit-check.mts';
import { isMain, repositoryRoot } from './paths.mts';
import { execute, run, Stop } from './process.mts';
import { present } from './present.mts';
import { toolCommand } from './mise-tools.mts';
import { packedPackageManifest } from './pack-manifest.mts';
import { installedGenStub } from './install-php-arginfo.mts';

export const MAIN = 'origin/main';
export const CONFIG = 'config/release.json';
export const ASSETS = 'var/release/assets';
/** The Composer repository of the Composer packages of a release, beside its archives (K871). */
export const PACKAGES_JSON = 'packages.json';
export const DEFAULT_CHECKS = ['ci-passed'];
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
export type Manifest = { name?: string; version?: string } & Partial<Record<typeof NPM_DEPENDENCY_FIELDS[number] | typeof COMPOSER_DEPENDENCY_FIELDS[number], Record<string, string>>>;

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
  const archived = new Set(config.packages.map(({ directory, kind }) => path.posix.join(directory, MANIFEST_OF[kind])));
  for (const [key, value] of Object.entries(config.manifests)) {
    if (value === 'archive' && !archived.has(key)) problems.push(`${CONFIG}: manifests.${key} is "archive" but no package of packages has that manifest`);
  }
  if (new Set(assetNames(config, '1.0.0')).size !== config.packages.length) problems.push(`${CONFIG}: two packages have the same archive name`);
  if (problems.length) throw new Stop(problems.join('; '));
  return { ...config, checks: config.checks ?? DEFAULT_CHECKS, changelogTranslations: config.changelogTranslations ?? [], manifests, notReleased, goModules };
}

const at = (ctx: Context) => ({ cwd: ctx.root, env: ctx.env });

/** A command context: the repository root, its configuration, the environment of its commands and a log function. */
export function context(root: string, { config = loadConfig(root), env = process.env, log = () => {} }: { config?: ReleaseConfig; env?: NodeJS.ProcessEnv; log?: (text: string) => void } = {}): Context {
  return { root, config, env, log };
}

/** The newest root release tag reachable from HEAD, which resolves the argument `latest` of the release
 * commands: no release task names a version in its retry. */
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
  const commit = taggedCommit(ctx, tag);
  if (directory !== null) return [];
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

/** The files of the release at `version`: the archives, and packages.json when a package is a Composer package (K871). */
function releaseFiles(config: Pick<ReleaseConfig, 'packages'>, version: string): string[] {
  return [...assetNames(config, version), ...(config.packages.some(({ kind }) => kind === 'composer') ? [PACKAGES_JSON] : [])];
}

/**
 * packages.json of the release at `version` from the archives of `folder` (K871): each Composer package as its composer.json
 * `sources[index]` at the version, with the dist of its release asset and the sha1 of its zip.
 */
function composerRepository(config: Pick<ReleaseConfig, 'packages' | 'repositoryUrl'>, version: string, folder: string, sources: string[]): string {
  const names = assetNames(config, version);
  const packages = Object.fromEntries(config.packages.flatMap(({ kind, name }, index) => {
    if (kind !== 'composer') return [];
    // names and sources hold the archive name and the manifest of each package at its index.
    const archive = present(names[index], 'names[index]');
    const manifest = parseJson<ComposerManifest>(present(sources[index], 'sources[index]'), 'composer-manifest.schema.json', `the composer.json of ${name}`);
    const dist = { type: 'zip', url: `${config.repositoryUrl}/releases/download/v${version}/${archive}`, shasum: fileDigest(path.join(folder, archive), 'sha1') };
    return [[name, { [version]: { ...manifest, version, dist } }]];
  }));
  return `${JSON.stringify({ packages }, null, 2)}\n`;
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
 * Builds the archive of every package of the tag into var/release/assets and returns their names. Each manifest of the
 * tagged commit names its package, and each archive must carry the manifest of its package at the commit byte for byte; kit alone uses its canonical prepack source-to-dist manifest. The directory is replaced as a whole.
 */
export function assets(ctx: Context, tag: string): string[] {
  const { config } = ctx;
  const [directory, version] = parseTag(config, tag);
  if (directory !== null) {
    const { root } = ctx;
    const target = path.join(root, ASSETS);
    ctx.log(`[release] ${tag}: a Go module tag builds no archive`);
    rmSync(target, { recursive: true, force: true });
    mkdirSync(target, { recursive: true });
    return [];
  }
  const retry = `make release-assets TAG=${tag}`;
  requireArchiveTools(ctx, retry);
  return assetsFromCommit(ctx, tag, taggedCommit(ctx, tag), version);
}

/** Builds archives from one committed tree through the producer shared by tagged releases and tagless candidates. */
function assetsFromCommit(ctx: Context, reference: string, commit: string, version: string): string[] {
  const { root, config } = ctx;
  const target = path.join(root, ASSETS);
  const names = assetNames(config, version);
  const files = releaseFiles(config, version);
  const sources = config.packages.map(({ kind, directory: folder }) => run('git', ['show', `${commit}:${path.posix.join(folder, MANIFEST_OF[kind])}`], at(ctx)));
  const problems = config.packages.flatMap(({ kind, directory: folder, name }, index) => {
    const file = path.posix.join(folder, MANIFEST_OF[kind]);
    if (kind === 'wheel') return [];
    // sources holds the manifest of each package at its index.
    const manifest = parseManifest(kind, present(sources[index], 'sources[index]'), file);
    return manifest.name === name ? [] : [`${file}: name ${manifest.name ?? 'none'}, ${CONFIG} declares ${name}`];
  });
  if (problems.length) throw new Stop(`${reference}: the manifests of the commit ${commit} do not install outside the repository: ${problems.join('; ')}`);
  const mtime = new Date(Number(run('git', ['show', '-s', '--format=%ct', commit], at(ctx)).trim()) * 1000).toISOString();
  const next = `${target}.next-${process.pid}`;
  const previous = `${target}.previous-${process.pid}`;
  rmSync(next, { recursive: true, force: true });
  rmSync(previous, { recursive: true, force: true });
  mkdirSync(next, { recursive: true });
  try {
    config.packages.forEach(({ kind, directory: folder, name }, index) => {
      ctx.log(`[release] ${reference}: packing ${name} from ${folder} into ${names[index]}`);
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
        buildWheel({ root, env: ctx.env, commit, directory: folder, output: next });
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
        return metadataProblems(metadata, name, version).map(problem => `${names[index]}: ${problem}`);
      }
      const file = MANIFEST_OF[kind];
      // names holds the archive name of each package at its index.
      const packed = packedManifest(ctx, path.join(next, present(names[index], 'names[index]')));
      const source = present(sources[index], 'sources[index]');
      const expected = kind === 'npm' && name === PACKAGE ? packedPackageManifest(source) : source;
      return packed === expected ? [] : [`${names[index]}: the packed ${file} differs from ${path.posix.join(folder, file)} of the commit ${commit}`];
    });
    if (failures.length) throw new Stop(`${reference}: the release assets do not install outside the repository: ${failures.join('; ')}`);
    if (files.includes(PACKAGES_JSON)) {
      writeFileSync(path.join(next, PACKAGES_JSON), composerRepository(config, version, next, sources));
      ctx.log(`[release] ${reference}: wrote ${PACKAGES_JSON}, the Composer repository of the release`);
    }
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
  return files;
}

/** Checks the native archive helper before package construction. */
function requireArchiveTools(ctx: Context, retry: string): void {
  if (!ctx.config.packages.some(item => item.generated?.length)) return;
  const zip = execute('zip', ['-v'], { cwd: ctx.root, env: ctx.env });
  if (zip.error) throw new Stop(`zip is required to append generated files to Composer release archives; install Info-ZIP (for example, brew install zip or sudo apt-get install zip), then run ${retry}`);
  if (zip.status !== 0) throw new Stop(`zip -v failed with exit status ${zip.status}; install a working Info-ZIP command, then run ${retry}`);
}

/** Builds release candidates from committed HEAD without resolving, creating or pretending to have a tag. */
export function candidateAssets(ctx: Context, version: string): string[] {
  if (!EXACT_VERSION.test(version)) throw new Stop(`candidate version ${JSON.stringify(version)} is not X.Y.Z`);
  const commit = run('git', ['rev-parse', '--verify', 'HEAD^{commit}'], at(ctx)).trim();
  const changed = run('git', ['diff', '--name-only', commit], at(ctx)).trim().split('\n').filter(Boolean);
  const untracked = run('git', ['ls-files', '--others', '--exclude-standard'], at(ctx)).trim().split('\n').filter(Boolean);
  const sourceChanges = [...new Set([...changed, ...untracked])].sort();
  if (sourceChanges.length) throw new Stop(`candidate assets require source inputs to match committed HEAD ${commit}; changed or untracked paths: ${sourceChanges.join(', ')}; commit source changes, then run make release-candidate-assets VERSION=${version}`);
  const retry = `make release-candidate-assets VERSION=${version}`;
  requireArchiveTools(ctx, retry);
  return assetsFromCommit(ctx, `HEAD candidate ${version}`, commit, version);
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
 * Creates the GitHub Release of the tag as a draft, with the notes of releaseNotes and the files of assets (the archives and packages.json), and records its
 * id (releaseRecord). A draft of an earlier run is replaced; a public release is never replaced.
 */
export function publish(ctx: Context, tag: string): string[] {
  const { root, config } = ctx;
  const [directory, version] = parseTag(config, tag);
  const notes = releaseNotes(ctx, tag);
  const names = directory === null ? releaseFiles(config, version) : [];
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
    ctx.log(`[release] ${tag}: creating the draft GitHub Release with ${names.length} assets`);
    const id = createDraft(at(ctx), config.repositoryUrl, tag, notesFile, names.map(name => path.join(target, name)));
    writeJson(path.join(root, releaseRecord(tag)), { id });
    ctx.log(`[release] ${tag}: the draft release ${id} is recorded in ${releaseRecord(tag)}`);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
  return names;
}

/**
 * Makes the draft release of the tag public. A release that is already public stays so.
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
  return problems;
}

const USAGE = 'usage: node scripts/kit/release.mts tag|verify|assets|publish|undraft|go-tags TAG | candidate-assets VERSION | coverage';

/** Runs a step of the command line; the exit status. */
export function main(argv: string[], { root = repositoryRoot(), env = process.env, print = console.log, error = console.error }: CommandOptions = {}): number {
  const [mode, latest, ...rest] = argv;
  let tag = latest;
  const tagged = mode !== undefined && ['tag', 'verify', 'assets', 'publish', 'undraft', 'go-tags'].includes(mode);
  const candidate = mode === 'candidate-assets' && latest !== undefined && rest.length === 0;
  if (!(tagged && tag && rest.length === 0) && !candidate && !(mode === 'coverage' && tag === undefined)) {
    error(USAGE);
    return 2;
  }
  try {
    const ctx = context(root, { env, log: print });
    if (candidate) {
      const names = candidateAssets(ctx, present(latest, 'candidate version'));
      print(`[release] HEAD candidate ${latest}: built ${names.join(', ')} in ${ASSETS}`);
      return 0;
    }
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
