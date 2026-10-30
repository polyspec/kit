#!/usr/bin/env node
// Releases a tag of a commit of main. The release workflow (workflows/release.yml) creates the tags with release-run.mts tag
// (K911) and then runs these steps in this order, each through its make target:
//
//   node scripts/kit/release.mts assets TAG     build the archive of every package of the tag, and packages.json of its
//                                               Composer packages, into var/release/assets
//   node scripts/kit/release.mts publish TAG    create the GitHub Release of the tag as a draft, with its notes and those files
//   node scripts/kit/release.mts undraft TAG    make the draft release of the tag public
//   node scripts/kit/release.mts coverage       every package file of the checkout is classified in config/release.json
//
// The repository is data: config/release.json (schema scripts/kit/schema/release.schema.json) lists the packages that a
// tag releases as archives, the manifests that carry the version, the manifests that no tag releases and the Go modules.
// A tag `vX.Y.Z` releases the packages at the version X.Y.Z; createTags puts it and the tag `<directory>/vX.Y.Z` of every Go
// module, which a Go proxy reads, at the commit of a successful CI run (K911). No step reruns the tests: the run is the evidence.
//   TAG is `latest` for the newest release tag reachable from HEAD.
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
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
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
import { toolCommand, toolsEnvironment } from './mise-tools.mts';
import { packedPackageManifest } from './pack-manifest.mts';

export const MAIN = 'origin/main';
export const CONFIG = 'config/release.json';
export const ASSETS = 'var/release/assets';
/** The Composer repository of the Composer packages of a release, beside its archives (K871). */
export const PACKAGES_JSON = 'packages.json';
// GitHub refuses a release body over 125000 characters.
export const NOTES_LIMIT = 125000;
export const MODES: readonly string[] = ['archive', 'version', 'git-tag'];
// The files of a checkout that carry the version or the module of a package; coverage requires each to be classified.
export const PACKAGE_FILES = ['package.json', 'composer.json', 'Cargo.toml', 'pyproject.toml', 'go.mod', 'VERSION'];
const MANIFEST_FILES = PACKAGE_FILES.filter(name => name !== 'go.mod');
const TAG = /^v(?<version>(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))$/;
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

/**
 * A build artifact of a package, materialized from the committed package snapshot only while the package is packed: `make`
 * runs its target in a copy of the tagged tree (K929, K930), and every declared output must exist there afterwards.
 */
export type ReleaseGeneratedArtifact = {
  kind: 'make';
  target: string;
  outputs: string[];
};

/** config/release.json after loadConfig: the schema and the checks of loadConfig hold every value to its form. */
export interface ReleaseConfig {
  schema: 1;
  repositoryUrl: string;
  changelog: string;
  changelogTranslations: string[];
  packages: ReleasePackage[];
  manifests: Record<string, string>;
  notReleased: Record<string, string>;
  goModules: Record<string, string>;
}

/** config/release.json as the schema admits it: the values of the maps are not checked yet, two lists may be absent. */
type SchemaReleaseConfig = Omit<ReleaseConfig, 'changelogTranslations' | 'manifests' | 'notReleased' | 'goModules'> & {
  changelogTranslations?: string[];
  manifests: Record<string, unknown>;
  notReleased: Record<string, unknown>;
  goModules: Record<string, unknown>;
};

/** A command context of context(). */
export interface Context {
  root: string;
  config: ReleaseConfig;
  env: NodeJS.ProcessEnv;
  log: (text: string) => void;
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
    if (kind === 'npm' && (config.packages.find(item => item.directory === directory)?.generated?.length ?? 0) > 0) problems.push(`${CONFIG}: npm package ${name} declares generated make entries; npm builds its output in the prepack script of its package.json, not here`);
    for (const generated of config.packages.find(item => item.directory === directory)?.generated ?? []) {
      const valid = (file: string) => file !== '' && !file.startsWith('~') && !file.startsWith('/') && path.win32.parse(file).root === '' && !file.includes('\\') && file.split('/').every(part => part !== '' && part !== '.' && part !== '..');
      if (generated.kind === 'make') {
        if (!generated.outputs.length || generated.outputs.some(output => !valid(output))) problems.push(`${CONFIG}: generated make outputs of ${directory} must be one or more package-relative paths without empty, dot or parent segments`);
      }
    }
    const outputs = (config.packages.find(item => item.directory === directory)?.generated ?? []).flatMap(item => item.outputs);
    for (const output of new Set(outputs)) if (outputs.filter(item => item === output).length > 1) problems.push(`${CONFIG}: generated output ${directory}/${output} is declared more than once`);
  }
  const archived = new Set(config.packages.map(({ directory, kind }) => path.posix.join(directory, MANIFEST_OF[kind])));
  for (const [key, value] of Object.entries(config.manifests)) {
    if (value === 'archive' && !archived.has(key)) problems.push(`${CONFIG}: manifests.${key} is "archive" but no package of packages has that manifest`);
  }
  if (new Set(assetNames(config, '1.0.0')).size !== config.packages.length) problems.push(`${CONFIG}: two packages have the same archive name`);
  if (problems.length) throw new Stop(problems.join('; '));
  return { ...config, changelogTranslations: config.changelogTranslations ?? [], manifests, notReleased, goModules };
}

const at = (ctx: Context) => ({ cwd: ctx.root, env: ctx.env });

/** A command context: the repository root, its configuration, the environment of its commands and a log function. */
export function context(root: string, { config = loadConfig(root), env = process.env, log = () => {} }: { config?: ReleaseConfig; env?: NodeJS.ProcessEnv; log?: (text: string) => void } = {}): Context {
  return { root, config, env, log };
}

/** The newest release tag reachable from HEAD, which resolves the argument `latest` of the release
 * commands: no release task names a version in its retry. */
export function latestTag(ctx: Context): string {
  // git sorts version refs itself, newest first (--sort=-v:refname).
  const list = run('git', ['tag', '--merged', 'HEAD', '--list', 'v[0-9]*', '--sort=-v:refname'], at(ctx));
  // A release tag is vX.Y.Z; the pattern v[0-9]* also lists tags such as v1.2 or v1.2.3-rc1, which name no release and which
  // git may sort above a release, as v1.2.3-rc1 above v1.2.3.
  const tags = list.trim().split('\n').filter(tag => tag.startsWith('v') && EXACT_VERSION.test(tag.slice(1)));
  if (tags.length === 0) throw new Stop('no release tag is reachable from HEAD, so latest names no release');
  // tags holds at least one tag, checked above.
  return present(tags[0], 'tags[0]');
}

/** The version X.Y.Z of the release tag vX.Y.Z. */
export function parseTag(tag: string): string {
  const found = TAG.exec(tag);
  if (!found) throw new Stop(`${tag}: a release tag is vX.Y.Z`);
  // TAG has the named group version, which takes part in every match.
  return present(present(found.groups, 'found.groups').version, 'found.groups.version');
}

const taggedCommit = (ctx: Context, tag: string) => run('git', ['rev-parse', '--verify', `refs/tags/${tag}^{commit}`], at(ctx)).trim();

/**
 * Creates the annotated tag vX.Y.Z and the tag `<directory>/vX.Y.Z` of every Go module of config/release.json at `commit`, the
 * commit of a successful CI run, and pushes them (K269, K911); returns what it did per tag. A tag that names `commit` already
 * passes; a tag at another commit stops before any tag is created, since a published tag is never moved. In GitHub Actions the
 * tagger is the actor of the run.
 */
export function createTags(ctx: Context, version: string, commit: string): string[] {
  const tags = [`v${version}`, ...Object.keys(ctx.config.goModules).filter(module => module !== '.').sort().map(module => `${module}/v${version}`)];
  const existing = new Map(tags.map(tag => [tag, execute('git', ['rev-parse', '--verify', '--quiet', `refs/tags/${tag}^{commit}`], at(ctx))]));
  for (const [tag, found] of existing) {
    if (found.status === 0 && found.stdout.trim() !== commit) throw new Stop(`the tag ${tag} is at ${found.stdout.trim()}, not at ${commit}; a published tag is never moved`);
    const kind = found.status === 0 ? run('git', ['cat-file', '-t', `refs/tags/${tag}`], at(ctx)).trim() : 'tag';
    if (kind !== 'tag') throw new Stop(`the tag ${tag} is a lightweight tag (${kind}); a release tag is annotated, so delete it with git tag -d ${tag} and release again`);
  }
  const actor = ctx.env.GITHUB_ACTOR;
  const identity = actor ? ['-c', `user.name=${actor}`, '-c', `user.email=${actor}@users.noreply.github.com`] : [];
  const created = tags.filter(tag => existing.get(tag)?.status !== 0);
  for (const tag of created) run('git', [...identity, 'tag', '-a', tag, '-m', tag, commit], at(ctx));
  if (created.length) run('git', ['push', 'origin', ...created.map(tag => `refs/tags/${tag}`)], at(ctx));
  return tags.map(tag => (created.includes(tag) ? `created the tag ${tag} at ${commit} and pushed it` : `the tag ${tag} is at ${commit} already`));
}

/**
 * The version of the release that the change log `text` of `file` records: the title of its first level-2 heading that is X.Y.Z,
 * the section that the version-bump commit wrote below ## Unreleased (K924). A change log without one names no release, and one
 * with an entry under ## Unreleased holds a change that the release would not carry.
 */
export function releasedVersion(text: string, file: string): string {
  const heading = headings(text).find(item => item.depth === 2 && EXACT_VERSION.test(item.title));
  if (!heading) throw new Stop(`${file} has no section ## X.Y.Z; the version-bump commit renames ## Unreleased to the version it releases`);
  const unreleased = headings(text).find(item => item.depth === 2 && item.title === 'Unreleased');
  if (unreleased) {
    const lines = text.split('\n');
    const next = headings(text).find(item => item.line > unreleased.line && item.depth <= 2);
    const body = lines.slice(unreleased.endLine, next ? next.line - 1 : lines.length).map(line => line.trim());
    if (body.some(line => line && !/^<a id="[^"]*"><\/a>$/.test(line))) throw new Stop(`${file} has unreleased entries; the version-bump commit moves every entry of ## Unreleased into the section of the version`);
  }
  return heading.title;
}

/**
 * The change log and the Go modules that the text of config/release.json, named `source` in its errors, declares (K924):
 * release-tag reads them from the commit of the run, which an earlier kit may have checked, so it checks these two fields alone,
 * as the schema of config/release.json describes them, and leaves the rest to the steps that run the kit of the tag.
 */
export function taggedRelease(text: string, source: string): Pick<ReleaseConfig, 'changelog' | 'goModules'> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    throw new Stop(`${source} is no JSON: ${error.message}`);
  }
  const record = (item: unknown): item is Record<string, unknown> => typeof item === 'object' && item !== null && !Array.isArray(item);
  if (!record(value)) throw new Stop(`${source} is no JSON object`);
  const { changelog, goModules } = value;
  if (typeof changelog !== 'string' || !/^[^/][^\\]*\.md$/.test(changelog)) throw new Stop(`${source}: changelog ${JSON.stringify(changelog ?? null)} is not the path of a Markdown file of the repository`);
  if (!record(goModules)) throw new Stop(`${source}: goModules ${JSON.stringify(goModules ?? null)} is not an object of module paths by directory`);
  const modules: Record<string, string> = {};
  for (const [directory, module] of Object.entries(goModules)) {
    if (typeof module !== 'string' || !module) throw new Stop(`${source}: goModules.${directory} needs the module path of its go.mod`);
    modules[directory] = module;
  }
  return { changelog, goModules: modules };
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
  const version = parseTag(tag);
  const { changelog, repositoryUrl } = ctx.config;
  const section = changelogSection(ctx.root, changelog, version);
  if (section.length <= NOTES_LIMIT) return section;
  return `The changes of ${version} are listed in [${path.posix.basename(changelog)}](${repositoryUrl}/blob/${tag}/${changelog}#${changelogAnchor(ctx.root, changelog, version)}).\n`;
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

/** The regular files under dir, sorted, as paths relative to dir with slashes. */
function filesUnder(dir: string, prefix = ''): string[] {
  return readdirSync(path.join(dir, prefix), { withFileTypes: true })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .flatMap(entry => {
      const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      return entry.isDirectory() ? filesUnder(dir, relative) : [relative];
    });
}

/**
 * Runs the make target of each `make` entry (K929) in a copy of the tagged tree: the tracked files of the commit, with no link into
 * the checkout. The make run gets the tools of the checkout on its PATH (toolsEnvironment, K930), so the target calls php-config itself;
 * repository. A declared output that the commit tracks fails the pack, and each declared output must exist in the copy afterwards.
 * The outputs are staged under staging at their package-relative paths.
 */
function madeFiles(ctx: Context, commit: string, folder: string, makes: ReleaseGeneratedArtifact[], staging: string): { output: string; file: string }[] {
  const tracked = run('git', ['ls-tree', '-r', '--name-only', commit, folder], at(ctx)).split('\n').filter(Boolean);
  for (const { outputs } of makes) {
    for (const output of outputs) {
      const declared = path.posix.join(folder, output);
      if (tracked.some(file => file === declared || file.startsWith(`${declared}/`))) throw new Stop(`${declared} is tracked at commit ${commit}: a make output is generated and Git tracks no generated output (P34)`);
    }
  }
  const copy = mkdtempSync(path.join(tmpdir(), 'kit-release-make-'));
  try {
    const tree = path.join(copy, 'tree');
    const archive = path.join(copy, 'source.tar');
    mkdirSync(tree);
    run('git', ['archive', '--format=tar', `--output=${archive}`, commit], at(ctx));
    run('tar', ['-xf', archive, '-C', tree], at(ctx));
    const env = toolsEnvironment(ctx.root, ctx.env);
    const files: { output: string; file: string }[] = [];
    for (const { target, outputs } of makes) {
      ctx.log(`[release] ${commit}: make ${target} in the copy of ${folder}`);
      const result = execute('make', ['-C', tree, target], { cwd: tree, env });
      if (result.error) throw new Stop(`make could not start for ${target}: ${result.error.message}`);
      if (result.status !== 0) throw new Stop(`make ${target} failed at ${commit} with exit status ${result.status}: ${(result.stdout + result.stderr).trim()}`);
      for (const output of outputs) {
        const written = path.join(tree, folder, output);
        if (!existsSync(written)) throw new Stop(`make ${target} did not write ${path.posix.join(folder, output)} at ${commit}`);
        // A declared directory is packed as the files under it, each at its package-relative path.
        const relatives = statSync(written).isDirectory() ? filesUnder(written) : [''];
        for (const relative of relatives) {
          const name = relative === '' ? output : path.posix.join(output, relative);
          const staged = path.join(staging, name);
          mkdirSync(path.dirname(staged), { recursive: true });
          copyFileSync(relative === '' ? written : path.join(written, relative), staged);
          files.push({ output: name, file: staged });
        }
      }
    }
    return files;
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
}

/** Generate package artifacts from the tagged sources in a private temporary directory (K929, K930): the outputs of the make entries of the package. */
function generatedArchiveFiles(ctx: Context, commit: string, folder: string, generated: ReleaseGeneratedArtifact[] | undefined): { directory: string; files: { output: string; file: string }[] } | null {
  if (!generated?.length) return null;
  const temporary = mkdtempSync(path.join(tmpdir(), 'kit-release-generated-'));
  try {
    return { directory: temporary, files: madeFiles(ctx, commit, folder, generated, temporary) };
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
  const version = parseTag(tag);
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
        // The generated files of the wheel are staged like those of a Composer archive and removed after its build (K929).
        const generated = generatedArchiveFiles(ctx, commit, folder, config.packages[index]?.generated);
        try {
          buildWheel({ root, env: ctx.env, commit, directory: folder, output: next, generated: generated?.files ?? [] });
        } finally {
          if (generated) rmSync(generated.directory, { recursive: true, force: true });
        }
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
  const version = parseTag(tag);
  const notes = releaseNotes(ctx, tag);
  const names = releaseFiles(config, version);
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

const USAGE = 'usage: node scripts/kit/release.mts assets|publish|undraft TAG | candidate-assets VERSION | coverage';

/** Runs a step of the command line; the exit status. */
export function main(argv: string[], { root = repositoryRoot(), env = process.env, print = console.log, error = console.error }: CommandOptions = {}): number {
  const [mode, latest, ...rest] = argv;
  let tag = latest;
  const tagged = mode !== undefined && ['assets', 'publish', 'undraft'].includes(mode);
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
    } else if (mode === 'assets') {
      const names = assets(ctx, tag);
      print(`[release] ${tag}: built ${names.join(', ')} in ${ASSETS}`);
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
