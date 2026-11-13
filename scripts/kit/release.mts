#!/usr/bin/env node
// Releases a tag of a commit of main. The release workflow (workflows/release.yml) creates the tags with release-run.mts tag
// (K911) and then runs these steps in this order, each through its make target:
//
//   node scripts/kit/release.mts assets TAG     build the archive of every package of the tag, and packages.json of its
//                                               Composer packages, into the asset folder that RELEASE_ASSETS names (K1102)
//   node scripts/kit/release.mts publish TAG    create the GitHub Release of the tag as a draft, with its notes and those files
//   node scripts/kit/release.mts undraft TAG    make the draft release of the tag public
//   node scripts/kit/release.mts coverage       every package file of the checkout is classified in config/release.json
//
// The repository is data: config/release.json (schema scripts/kit/schema/release.schema.json) lists the packages that a
// tag releases as archives, the manifests that carry the version, the manifests that no tag releases and the Go modules.
// A tag `vX.Y.Z` releases the packages at the version X.Y.Z; createTags puts it and the tag `<directory>/vX.Y.Z` of every Go
// module, which a Go proxy reads, at the commit of a successful CI run (K911). No step reruns the tests: the run is the evidence.
//   TAG is `latest` for the newest release tag reachable from HEAD.
// `assets` builds one archive per package under the name its packer gives (`@scope/x` is `scope-x-1.0.0.tgz` as npm pack
// writes it, a wheel keeps its PEP 427 name, and the Composer zip, which kit packs, is its label with .zip, K985), which `publish` labels
// `<vendor>-<product>-<runtime>-<version>` (P39, K980): `npm pack` of an npm package, and a `git archive` zip of the directory of a Composer
// package at the tagged commit, with stored entries, the time of the commit and TZ=UTC. Declared generated files are
// appended from staged files with fixed mode and the same commit time, so a second run of the same tag writes the same
// bytes without placing generated contents in argv. Each archive carries its unchanged manifest, except kit uses its
// canonical source-to-dist prepack transformation. `publish` creates the draft
// release of the tag through the API with the archives (github-release.mts createDraft) and records its id in
// <records>/<tag>.json, in the folder that the caller names in RELEASE_RECORDS (K1115); the notes are the section X.Y.Z, or one line that links the section when it is longer than
// NOTES_LIMIT characters, the limit of a release body. `undraft` reads the draft by that id: the
// list of releases shows a new draft only after a while, and its tag does not address it.
// A release with a Composer package also writes packages.json beside the archives (K871): one flat Composer repository, since
// release assets hold no folder, that holds each Composer package under its name and version as its composer.json of the commit
// with a dist of type zip, the URL of its release asset and the sha1 of the zip. A consumer reads it as a composer repository at
// <repositoryUrl>/releases/download/<tag>/packages.json, so it names only the tag and Composer reads the metadata itself.
// A `wheel` package builds its PEP 427 wheel `<distribution>-<version>-py3-none-any.whl` from the tagged commit with uv build,
// which installs the build-system.requires of its pyproject.toml (release-wheel.mts).
// Each failure names the tag, the file or the check, and the expected and the actual value, and exits with status 1.
import { appendFileSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createDraft, deleteRelease, makePublic, releaseById, releaseOf, repositoryParts, type GitHubRelease } from './github-release.mts';
import { headings } from './markdown.mts';
import type { ChangelogRule } from './changelog.mts';
import { fileDigest } from './bootstrap/digest.mts';
import { writeJson } from './bootstrap/files.mts';
import { type ComposerManifest, type NpmManifest, PACKAGE } from './manifests.mts';
import { buildWheel, metadataProblems, wheelMetadata, wheelName } from './release-wheel.mts';
import { parseJson, readConfig, readConfigFindings } from './schema-validate.mts';
import { checkedFiles } from './tracked-files.mts';
import { matchesAny } from './glob.mts';
import { isMain, repositoryRoot } from './paths.mts';
import { cleanupAfter, execute, run, Stop } from './process.mts';
import { present } from './present.mts';
import { linksOutsideCheckout } from './link.mts';
import { toolCommand } from './mise-tools.mts';
import { packedPackageManifest } from './pack-manifest.mts';
import { assetSets, buildPlatformAsset, extensionOf, inSet, isNative, namedSet, nativeProblems, npmNativeProblems, npmNativeRoot, npmPackName, packedNativeManifest, phpExtProblems, platformAssets, requireHost, setName, zipEntries, type AssetSet, type ExpectedAsset, type ExtensionNames, type NativeBuild } from './release-native.mts';
import { readToml, isTable } from './toml.mts';

export const CONFIG = 'config/release.json';
/** The Composer repository of the Composer packages of a release, beside its archives (K871). */
export const PACKAGES_JSON = 'packages.json';
// GitHub refuses a release body over 125000 characters.
export const NOTES_LIMIT = 125000;
export const MODES: readonly string[] = ['archive', 'version', 'git-tag'];
// The files of a checkout that carry the version or the module of a package; coverage requires each to be classified.
const TAG = /^v(?<version>(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))$/;
const EXACT_VERSION = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;
const MANIFEST_OF: Record<PackageKind, string> = { npm: 'package.json', composer: 'composer.json', wheel: 'pyproject.toml', 'wheel-abi3': 'pyproject.toml', 'php-ext': 'composer.json', 'npm-native': 'package.json', 'go-static': 'Cargo.toml' };
const NPM_DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'] as const;
const COMPOSER_DEPENDENCY_FIELDS = ['require', 'require-dev'] as const;

/** The kind of a package of config/release.json. */
export type PackageKind = 'npm' | 'composer' | 'wheel' | 'wheel-abi3' | 'php-ext' | 'npm-native' | 'go-static';

/** A package of `packages` of config/release.json. */
export interface ReleasePackage {
  kind: PackageKind;
  directory: string;
  name: string;
  product: string;
  runtime: string;
  generated?: ReleaseGeneratedArtifact[];
  /** The platforms of a per-platform package (K1189). */
  platforms?: string[];
  /** The PHP minors of a php-ext package (K1189). */
  php?: string[];
}

/**
 * A build artifact of a package, materialized from the committed package snapshot only while the package is packed: `make`
 * runs its target in the checkout, which requireCheckout has checked to be the tagged commit (K929, K930, K939), and every declared
 * output must exist there afterwards.
 */
export type ReleaseGeneratedArtifact = {
  kind: 'make';
  target: string;
  outputs: string[];
};

/** config/release.json after loadConfig: the schema and the checks of loadConfig hold every value to its form. */
export interface ReleaseConfig {
  repositoryUrl: string;
  changelog: string;
  changelogTranslations: string[];
  packages: ReleasePackage[];
  manifests: Record<string, string>;
  notReleased: Record<string, string>;
  goModules: Record<string, string>;
  // The names of the package files that coverage classifies, the package files that tools write and no tag releases, and the
  // fixtures that the checks leave out (K1114): the repository's own lists.
  packageFiles?: string[];
  writtenFiles?: string[];
  fixtures?: string[];
  /** The repository's own rule that an existing release tag is annotated (K1084); without it a tag at the commit passes. */
  annotatedTags?: boolean;
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
  /** The remote-tracking ref `<remote>/<branch>` of main that a released commit is on, as the caller names it; none when unnamed (K1102). */
  main: string | undefined;
  /** The folder of the assets, relative to the checkout or absolute, as the caller names it; none when unnamed (K1102). */
  assets: string | undefined;
  /** The folder of the release records, relative to the checkout or absolute, as the caller names it; none when unnamed (K1115). */
  records: string | undefined;
  /** The asset set that the caller names in RELEASE_PLATFORM and RELEASE_PHP; the set without a platform when it names none (K1189). */
  set: AssetSet;
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
  // A manifest is a package file that the repository names, other than the go.mod of a Go module, which goModules lists (K1114).
  const manifestFiles = (config.packageFiles ?? []).filter(name => name !== 'go.mod');
  const manifests = reason('manifests', 'manifests', (key, value) => (manifestFiles.length > 0 && !manifestFiles.includes(path.posix.basename(key))
    ? `is not a ${manifestFiles.join(', ')} file`
    : typeof value === 'string' && MODES.includes(value) ? null : `is ${JSON.stringify(value)}, the allowed values are ${MODES.join(', ')}`));
  const notReleased = reason('notReleased', 'notReleased', (key, value) => (typeof value === 'string' && value.trim() ? null : 'needs a reason, a non-empty string'));
  const goModules = reason('goModules', 'goModules', (key, value) => (typeof value === 'string' && value ? null : 'needs the module path of its go.mod'));
  for (const key of Object.keys(config.manifests)) if (key in config.notReleased) problems.push(`${CONFIG}: ${key} is in both manifests and notReleased`);
  const names = new Set<string>();
  const directories = new Set<string>();
  for (const item of config.packages) {
    const { kind, directory, name } = item;
    const npmShape = /^(@[a-z0-9._-]+\/)?[a-z0-9._-]+$/;
    const composerShape = /^[a-z0-9._-]+\/[a-z0-9._-]+$/;
    const shape = { npm: npmShape, composer: composerShape, wheel: /^[a-z0-9._-]+$/, 'wheel-abi3': /^[a-z0-9._-]+$/, 'php-ext': composerShape, 'npm-native': npmShape, 'go-static': /^[a-z0-9_-]+$/ }[kind];
    const form = { npm: '`name` or `@scope/name`', composer: '`vendor/name`', wheel: 'project name of PyPI', 'wheel-abi3': 'project name of PyPI', 'php-ext': '`vendor/name`', 'npm-native': '`name` or `@scope/name`', 'go-static': 'Cargo package name' }[kind];
    problems.push(...nativeProblems(item, CONFIG));
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
  const archiveNames = assetNames(config, '1.0.0');
  if (new Set(archiveNames).size !== archiveNames.length) problems.push(`${CONFIG}: two packages have the same archive name`);
  // Every asset of every set carries a label of its own: two packages with the same product and runtime would share one.
  const labels = assetSets(config.packages).flatMap(set => (set.platform === undefined ? assetLabels(config, '1.0.0') : platformAssets(config.packages, config.repositoryUrl, '1.0.0', set, {}).map(item => item.label)));
  if (new Set(labels).size !== labels.length) problems.push(`${CONFIG}: two packages have the same product and runtime, so their assets would have the same label`);
  if (problems.length) throw new Stop(problems.join('; '));
  return { ...config, changelogTranslations: config.changelogTranslations ?? [], manifests, notReleased, goModules };
}

const at = (ctx: Context) => ({ cwd: ctx.root, env: ctx.env });

/**
 * A command context: the repository root, its configuration, the environment of its commands, a log function, and the main ref
 * the asset folder and the folder of the release records that the caller names, in its options or in RELEASE_MAIN, RELEASE_ASSETS
 * and RELEASE_RECORDS of the environment; kit names none of them, and an empty value names none (K1102, K1115).
 */
export function context(root: string, { config = loadConfig(root), env = process.env, log = () => {}, main = env.RELEASE_MAIN || undefined, assets = env.RELEASE_ASSETS || undefined, records = env.RELEASE_RECORDS || undefined, set = namedSet(env.RELEASE_PLATFORM || undefined, env.RELEASE_PHP || undefined) }: { config?: ReleaseConfig; env?: NodeJS.ProcessEnv; log?: (text: string) => void; main?: string | undefined; assets?: string | undefined; records?: string | undefined; set?: AssetSet } = {}): Context {
  return { root, config, env, log, main, assets, records, set };
}

/** The asset folder of `ctx`, which a step that builds or publishes the assets needs; the caller names it in RELEASE_ASSETS (K1102). */
export function assetFolder(ctx: Pick<Context, 'assets'>): string {
  if (ctx.assets === undefined) throw new Stop('no asset folder is named; the caller names it in RELEASE_ASSETS');
  return ctx.assets;
}

/** The newest release tag reachable from HEAD, which resolves the argument `latest` of the release
 * commands: no release task names a version in its retry. */
export function latestTag(ctx: Context): string {
  const tag = newestReleaseTag(ctx, true);
  if (tag === undefined) throw new Stop('no release tag is reachable from HEAD, so latest names no release');
  return tag;
}

/**
 * The newest release tag vX.Y.Z, reachable from HEAD or, when `reachable` is false, anywhere in the repository (K941); undefined
 * when there is none.
 */
export function newestReleaseTag(ctx: Context, reachable: boolean): string | undefined {
  // git sorts version refs itself, newest first (--sort=-v:refname).
  const list = run('git', ['tag', ...(reachable ? ['--merged', 'HEAD'] : []), '--list', 'v[0-9]*', '--sort=-v:refname'], at(ctx));
  // A release tag is vX.Y.Z; the pattern v[0-9]* also lists tags such as v1.2 or v1.2.3-rc1, which name no release and which
  // git may sort above a release, as v1.2.3-rc1 above v1.2.3.
  const tags = list.trim().split('\n').filter(tag => tag.startsWith('v') && EXACT_VERSION.test(tag.slice(1)));
  // tags[0] is the newest of the release tags that git sorts.
  return tags[0];
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
 * passes, a lightweight one too unless config/release.json names annotatedTags (K1084); a tag at another commit stops before any
 * tag is created, since a published tag is never moved. In GitHub Actions the
 * tagger is the actor of the run.
 */
export function createTags(ctx: Context, version: string, commit: string): string[] {
  const tags = [`v${version}`, ...Object.keys(ctx.config.goModules).filter(module => module !== '.').sort().map(module => `${module}/v${version}`)];
  const existing = new Map(tags.map(tag => [tag, execute('git', ['rev-parse', '--verify', '--quiet', `refs/tags/${tag}^{commit}`], at(ctx))]));
  for (const [tag, found] of existing) {
    if (found.status === 0 && found.stdout.trim() !== commit) throw new Stop(`the tag ${tag} is at ${found.stdout.trim()}, not at ${commit}; a published tag is never moved`);
    if (found.status !== 0 || ctx.config.annotatedTags !== true) continue;
    const kind = run('git', ['cat-file', '-t', `refs/tags/${tag}`], at(ctx)).trim();
    if (kind !== 'tag') throw new Stop(`the tag ${tag} is a lightweight tag (${kind}); config/release.json names annotatedTags, so delete it with git tag -d ${tag} and release again`);
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
 * the section that the version-bump commit wrote below ## Unreleased (K924). A change log without one names no release; one with an
 * entry under ## Unreleased is refused only where the repository names `unreleased-empty-at-release` in `rules`, its changelogRules
 * (K1084).
 */
export function releasedVersion(text: string, file: string, rules: readonly string[] = []): string {
  const version = topVersion(text);
  if (version === undefined) throw new Stop(`${file} has no section ## X.Y.Z; the version-bump commit renames ## Unreleased to the version it releases`);
  if (rules.includes('unreleased-empty-at-release' satisfies ChangelogRule) && hasUnreleasedEntries(text)) throw new Stop(`${file} has unreleased entries; the version-bump commit moves every entry of ## Unreleased into the section of the version`);
  return version;
}

/** The title of the first level-2 heading of the change log `text` that is X.Y.Z, the newest version it records, or undefined. */
export function topVersion(text: string): string | undefined {
  return headings(text).find(item => item.depth === 2 && EXACT_VERSION.test(item.title))?.title;
}

/** Whether the ## Unreleased section of the change log `text` holds an entry; an anchor line alone is none. */
export function hasUnreleasedEntries(text: string): boolean {
  const unreleased = headings(text).find(item => item.depth === 2 && item.title === 'Unreleased');
  if (!unreleased) return false;
  const lines = text.split('\n');
  const next = headings(text).find(item => item.line > unreleased.line && item.depth <= 2);
  const body = lines.slice(unreleased.endLine, next ? next.line - 1 : lines.length).map(line => line.trim());
  return body.some(line => line && !/^<a id="[^"]*"><\/a>$/.test(line));
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
 * The archives of the set without a platform at `version`, in the order of the configuration (P39): each package that the set
 * builds, by its index in the configuration, with the name its packer gives and its label. npm pack writes `@scope/x` as
 * `scope-x-1.0.0.tgz` (K980), the root package of an npm-native package too, a wheel keeps its PEP 427 name, and the Composer zip,
 * which kit packs and which no standard names, is the label of its package with .zip, `<vendor>-<product>-<runtime>-<version>.zip`
 * (K985). The label is `<vendor>-<product>-<runtime>-<version>`, the vendor the owner of repositoryUrl, and the product and the
 * runtime those the package declares, never read from its name (K980).
 */
export function sourceAssets(config: Pick<ReleaseConfig, 'packages' | 'repositoryUrl'>, version: string): (ExpectedAsset & { name: string })[] {
  const vendor = repositoryParts(config.repositoryUrl).repo.split('/')[0];
  return config.packages.flatMap(({ kind, name, product, runtime }, index) => {
    if (!inSet({ kind, directory: '', name, product, runtime }, {})) return [];
    const label = `${vendor}-${product}-${runtime}-${version}`;
    const file = kind === 'wheel' ? wheelName(name, version) : kind === 'composer' ? `${label}.zip` : npmPackName(name, version);
    return [{ index, name: file, label }];
  });
}

/** The archive names of the set without a platform at `version`, in the order of the configuration (sourceAssets). */
export const assetNames = (config: Pick<ReleaseConfig, 'packages' | 'repositoryUrl'>, version: string): string[] => sourceAssets(config, version).map(item => item.name);

/** The GitHub labels of the archives of the set without a platform at `version`, in the order of the configuration (sourceAssets). */
export const assetLabels = (config: Pick<ReleaseConfig, 'packages' | 'repositoryUrl'>, version: string): string[] => sourceAssets(config, version).map(item => item.label);

/** Whether the release writes packages.json: a Composer or php-ext package is in it (K871, K1189). */
const hasComposerRepository = (config: Pick<ReleaseConfig, 'packages'>): boolean => config.packages.some(({ kind }) => kind === 'composer' || kind === 'php-ext');

/** The files of the set without a platform at `version`: its archives, and packages.json when a package is a Composer package (K871). */
function releaseFiles(config: Pick<ReleaseConfig, 'packages' | 'repositoryUrl'>, version: string): string[] {
  return [...assetNames(config, version), ...(hasComposerRepository(config) ? [PACKAGES_JSON] : [])];
}

/**
 * packages.json of the release at `version` from the archives of `folder` (K871): each Composer package as its composer.json
 * `sources[index]` at the version, with the dist of its release asset and the sha1 of its zip. A php-ext package is listed under
 * the version vX.Y.Z, the tag, since PIE finds the release of its binaries by the version of the package and names them with it,
 * and its dist is the source archive of the tag (K1189).
 */
function composerRepository(config: Pick<ReleaseConfig, 'packages' | 'repositoryUrl'>, version: string, folder: string, sources: string[]): string {
  const archives = new Map(sourceAssets(config, version).map(item => [item.index, item.name]));
  const { repo } = repositoryParts(config.repositoryUrl);
  const packages = Object.fromEntries(config.packages.flatMap(({ kind, name }, index) => {
    if (kind !== 'composer' && kind !== 'php-ext') return [];
    // sources holds the manifest of each package at its index.
    const manifest = parseJson<ComposerManifest>(present(sources[index], 'sources[index]'), 'composer-manifest.schema.json', `the composer.json of ${name}`);
    if (kind === 'php-ext') return [[name, { [`v${version}`]: { ...manifest, version: `v${version}`, dist: { type: 'zip', url: `https://api.github.com/repos/${repo}/zipball/v${version}` } } }]];
    // archives holds the archive of each Composer package by its index.
    const archive = present(archives.get(index), 'archives.get(index)');
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
 * Runs the make target of each `make` entry (K929) in the checkout, which requireCheckout has checked to hold the commit with no
 * changed, untracked or outside-linked path (K939): the target installs nothing of its own, so the kit that its Makefile includes is
 * the one the checkout installs (P34). Each declared output is deleted before its target runs, so a stale output of an earlier run is never
 * packed. A declared output that the commit tracks fails the pack, and each declared output must exist after its target. The outputs are
 * staged under staging at their package-relative paths, then deleted from the checkout, so a declared path that the checkout held before the pack is removed by it.
 */
function madeFiles(ctx: Context, commit: string, folder: string, makes: ReleaseGeneratedArtifact[], staging: string): { output: string; file: string }[] {
  const tracked = run('git', ['ls-tree', '-r', '--name-only', commit, folder], at(ctx)).split('\n').filter(Boolean);
  for (const { outputs } of makes) {
    for (const output of outputs) {
      const declared = path.posix.join(folder, output);
      if (tracked.some(file => file === declared || file.startsWith(`${declared}/`))) throw new Stop(`${declared} is tracked at commit ${commit}: a make output is generated and Git tracks no generated output (P34)`);
    }
  }
  const { root } = ctx;
  const files: { output: string; file: string }[] = [];
  try {
    for (const { target, outputs } of makes) {
      for (const output of outputs) rmSync(path.join(root, folder, output), { recursive: true, force: true });
      ctx.log(`[release] ${commit}: make ${target} in the checkout, for ${folder}`);
      const result = execute('make', ['-C', root, target], { cwd: root, env: ctx.env });
      if (result.error) throw new Stop(`make could not start for ${target}: ${result.error.message}`);
      if (result.status !== 0) throw new Stop(`make ${target} failed at ${commit} ${result.signal ? `on signal ${result.signal}` : `with exit status ${result.status}`}: ${(result.stdout + result.stderr).trim()}`);
      // A byproduct of the target, changed or untracked and not declared, would enter the checkout unpacked; the declared outputs of
      // every make entry of the package are excluded, since each is a path the target writes by declaration.
      const declared = makes.flatMap(item => item.outputs.map(output => path.posix.join(folder, output)));
      const byproducts = checkoutChanges(ctx, commit).filter(file => !declared.some(output => file === output || file.startsWith(`${output}/`)));
      if (byproducts.length) throw new Stop(`make ${target} left changed or untracked paths: ${byproducts.join(', ')}; remove them or declare them as outputs`);
      for (const output of outputs) {
        const written = path.join(root, folder, output);
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
  } finally {
    for (const { outputs } of makes) for (const output of outputs) rmSync(path.join(root, folder, output), { recursive: true, force: true });
  }
  return files;
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
 * Builds the archive of every package of the tag into the asset folder of the context and returns their names. Each manifest of the
 * tagged commit names its package, and each archive must carry the manifest of its package at the commit byte for byte; kit alone uses its canonical prepack source-to-dist manifest. The directory is replaced as a whole.
 */
export function assets(ctx: Context, tag: string): string[] {
  const version = parseTag(tag);
  const retry = `make release-assets TAG=${tag}`;
  requireArchiveTools(ctx, retry);
  const commit = taggedCommit(ctx, tag);
  requireCheckout(ctx, tag, commit, retry);
  return assetsFromCommit(ctx, tag, commit, version);
}

/** The tracked paths that differ from `commit` and the untracked paths of the checkout, sorted (K939). */
function checkoutChanges(ctx: Context, commit: string): string[] {
  const changed = run('git', ['diff', '--name-only', commit], at(ctx)).trim().split('\n').filter(Boolean);
  const untracked = run('git', ['ls-files', '--others', '--exclude-standard'], at(ctx)).trim().split('\n').filter(Boolean);
  return [...new Set([...changed, ...untracked])].sort();
}

/**
 * Refuses a checkout that does not hold the commit it packs (K939, P34): HEAD is not `commit`, a tracked or untracked path differs from
 * it, or a dependency of the checkout is linked from outside it. npm pack and the make entries read the checkout, so the pack must
 * read only what the commit holds, and no link may bring in another tree.
 */
function requireCheckout(ctx: Context, reference: string, commit: string, retry: string): void {
  const head = run('git', ['rev-parse', '--verify', 'HEAD^{commit}'], at(ctx)).trim();
  if (head !== commit) throw new Stop(`${reference}: HEAD ${head} is not ${commit}, the commit that is packed; check out ${commit}, then run ${retry}`);
  const sourceChanges = checkoutChanges(ctx, commit);
  if (sourceChanges.length) throw new Stop(`${reference} packs the committed tree ${commit}, but the checkout holds changed or untracked paths: ${sourceChanges.join(', ')}; commit or remove them, then run ${retry}`);
  const links = linksOutsideCheckout(ctx.root, ctx.env).map(link => path.relative(ctx.root, link));
  if (links.length) throw new Stop(`${reference}: a dependency linked from outside the checkout: ${links.join(', ')}; remove those links, then run ${retry}`);
}

/**
 * Why the asset folder `assets` cannot hold the assets of the checkout `root`, or undefined: a build replaces the folder as a whole,
 * so it is never the checkout or a folder that holds it (K1102).
 */
export function assetsFolderProblem(root: string, assets: string): string | undefined {
  const up = path.relative(path.resolve(root, assets), path.resolve(root));
  const outside = up === '..' || up.startsWith(`..${path.sep}`) || path.isAbsolute(up);
  return outside ? undefined : `the asset folder ${assets} is the checkout or a folder that holds it; name a folder of its own in RELEASE_ASSETS`;
}

/**
 * Runs `build` with a copy of the whole tree of `commit` that holds the outputs of the make entries of `packages` at their paths,
 * and a target folder for cargo, both in a temporary folder of the run that is removed afterwards (K1189): a native package reads
 * the Cargo workspace of the repository, so its build needs the tree, not its directory alone.
 */
function withNativeSource<T>(ctx: Context, commit: string, epoch: number, output: string, packages: readonly ReleasePackage[], build: (native: NativeBuild) => T): T {
  const work = mkdtempSync(path.join(tmpdir(), 'kit-release-native-'));
  try {
    const archive = path.join(work, 'source.tar');
    run('git', ['archive', '--format=tar', `--output=${archive}`, commit], at(ctx));
    const source = path.join(work, 'source');
    mkdirSync(source);
    run('tar', ['-xf', archive, '-C', source], at(ctx));
    rmSync(archive);
    for (const item of packages) {
      const generated = generatedArchiveFiles(ctx, commit, item.directory, item.generated);
      if (!generated) continue;
      try {
        for (const file of generated.files) {
          const placed = path.join(source, item.directory, file.output);
          mkdirSync(path.dirname(placed), { recursive: true });
          copyFileSync(file.file, placed);
        }
      } finally {
        rmSync(generated.directory, { recursive: true, force: true });
      }
    }
    return build({ root: ctx.root, env: ctx.env, log: ctx.log, source, target: path.join(work, 'target'), output, work, epoch });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/**
 * The problems of the manifest `text` of the package `item` at the commit: it names the package that config/release.json declares, and
 * the manifest of an npm-native or php-ext package holds what its tools read (K1196).
 */
function manifestProblems(item: ReleasePackage, text: string): string[] {
  const file = path.posix.join(item.directory, MANIFEST_OF[item.kind]);
  if (item.kind === 'wheel' || item.kind === 'wheel-abi3') return [];
  if (item.kind === 'go-static') {
    const table = readToml(text, file);
    const name = isTable(table.package) ? table.package.name : undefined;
    return name === item.name ? [] : [`${file}: name ${typeof name === 'string' ? name : 'none'}, ${CONFIG} declares ${item.name}`];
  }
  const manifest = parseManifest(item.kind === 'npm' || item.kind === 'npm-native' ? 'npm' : 'composer', text, file);
  const named = manifest.name === item.name ? [] : [`${file}: name ${manifest.name ?? 'none'}, ${CONFIG} declares ${item.name}`];
  if (item.kind === 'npm-native') return [...named, ...npmNativeProblems(parseJson<NpmManifest>(text, 'npm-manifest.schema.json', file), item, file)];
  if (item.kind === 'php-ext') return [...named, ...phpExtProblems(parseJson<ComposerManifest>(text, 'composer-manifest.schema.json', file), file)];
  return named;
}

/** Whether the file name `file` is the asset `expected`: its predicted name, or a name that its pattern matches. */
const isAsset = (expected: ExpectedAsset, file: string): boolean => (expected.name === undefined ? expected.pattern?.test(file) === true : expected.name === file);

/**
 * The files of the folder `files` for the assets `expected`, in their order: each asset matches exactly one file and every file is
 * an asset of them; otherwise Stop with what is missing, doubled or not declared.
 */
export function matchAssets(expected: readonly ExpectedAsset[], files: readonly string[], where: string): string[] {
  const problems: string[] = [];
  const matched = expected.map((item) => {
    const found = files.filter(file => isAsset(item, file));
    if (found.length !== 1) problems.push(`${found.length === 0 ? 'no file is' : `${found.length} files [${found.join(', ')}] are`} the asset ${item.name ?? String(item.pattern)} (${item.label})`);
    return found[0] ?? '';
  });
  const extra = files.filter(file => !expected.some(item => isAsset(item, file)));
  if (extra.length) problems.push(`[${extra.join(', ')}] ${extra.length === 1 ? 'is' : 'are'} no asset of the release`);
  if (problems.length) throw new Stop(`${where}: ${problems.join('; ')}`);
  return matched;
}

/** Builds archives from one committed tree through the producer shared by tagged releases and tagless candidates. */
function assetsFromCommit(ctx: Context, reference: string, commit: string, version: string): string[] {
  const { root, config, set } = ctx;
  requireHost(set);
  const folder = assetFolder(ctx);
  const unusable = assetsFolderProblem(root, folder);
  if (unusable !== undefined) throw new Stop(unusable);
  const target = path.resolve(root, folder);
  const sources = config.packages.map(({ kind, directory: folder }) => run('git', ['show', `${commit}:${path.posix.join(folder, MANIFEST_OF[kind])}`], at(ctx)));
  // sources holds the manifest of each package at its index.
  // Every set checks the manifest of every package, also of one that another set builds, before any tool runs (K1196).
  const problems = config.packages.flatMap((item, index) => manifestProblems(item, present(sources[index], 'sources[index]')));
  if (problems.length) throw new Stop(`${reference}: the manifests of the commit ${commit} do not release their packages: ${problems.join('; ')}`);
  const extensions: ExtensionNames = Object.fromEntries(config.packages.flatMap((item, index) => (item.kind === 'php-ext' ? [[index, extensionOf(parseManifest('composer', present(sources[index], 'sources[index]'), item.directory), path.posix.join(item.directory, 'composer.json'))]] : [])));
  const expected = set.platform === undefined ? sourceAssets(config, version) : platformAssets(config.packages, config.repositoryUrl, version, set, extensions);
  if (expected.length === 0 && set.platform !== undefined) throw new Stop(`${reference}: no package of ${CONFIG} builds ${setName(set)}; the sets are ${assetSets(config.packages).map(setName).join(', ')}`);
  const names = expected.map(item => item.name ?? '');
  const epoch = Number(run('git', ['show', '-s', '--format=%ct', commit], at(ctx)).trim());
  const mtime = new Date(epoch * 1000).toISOString();
  const next = `${target}.next-${process.pid}`;
  const previous = `${target}.previous-${process.pid}`;
  // The work folder goes and the previous assets come back when the new ones did not take their place; a failure of this after an
  // error keeps that error (K1144).
  const restore = () => {
    rmSync(next, { recursive: true, force: true });
    if (existsSync(previous) && !existsSync(target)) renameSync(previous, target);
  };
  rmSync(next, { recursive: true, force: true });
  rmSync(previous, { recursive: true, force: true });
  mkdirSync(next, { recursive: true });
  let files: string[] = [];
  try {
    const native = config.packages.filter(item => isNative(item.kind) && inSet(item, set));
    const build = (native: NativeBuild | undefined) => expected.forEach((asset) => {
      // expected names the index of its package in the configuration.
      const item = present(config.packages[asset.index], 'config.packages[asset.index]');
      const { kind, directory: folder, name } = item;
      ctx.log(`[release] ${reference}: packing ${name} from ${folder} into ${asset.name ?? String(asset.pattern)}`);
      if (native !== undefined && set.platform !== undefined) buildPlatformAsset(native, item, asset, set, version, extensions[asset.index]);
      else if (native !== undefined && kind === 'npm-native') npmNativeRoot(native, item, version);
      else if (kind === 'npm') {
        const before = new Set(readdirSync(next));
        // npm is the tool of the checkout, never the one on PATH (K393-1).
        run(toolCommand(root, 'npm'), ['pack', '--pack-destination', next], { cwd: path.join(root, folder), env: ctx.env });
        // npm pack names its output itself, and that name is the archive name (K980).
        const created = readdirSync(next).filter(entry => !before.has(entry));
        if (created.length !== 1 || created[0] !== asset.name) throw new Stop(`npm pack of ${folder} wrote [${created.join(', ')}], not the one archive ${asset.name ?? ''}`);
      } else if (kind === 'wheel') {
        // The generated files of the wheel are staged like those of a Composer archive and removed after its build (K929).
        const generated = generatedArchiveFiles(ctx, commit, folder, item.generated);
        try {
          buildWheel({ root, env: ctx.env, commit, directory: folder, output: next, generated: generated?.files ?? [] });
        } finally {
          if (generated) rmSync(generated.directory, { recursive: true, force: true });
        }
      } else {
        // Stored entries, the time of the commit and TZ=UTC give the zip of a tree the same bytes on every machine and at
        // every time. Files generated from the tagged snapshot are staged with fixed mode and mtime and appended by path;
        // their contents stay out of argv, whose per-argument limit is platform-dependent.
        const generated = generatedArchiveFiles(ctx, commit, folder, item.generated);
        const archive = path.join(next, asset.name ?? '');
        try {
          const args = ['archive', '--format=zip', '-0', `--mtime=${mtime}`, `--output=${archive}`, `${commit}:${folder}`];
          const result = execute('git', args, { cwd: root, env: { ...ctx.env, TZ: 'UTC' } });
          if (result.error) throw new Stop(`git archive could not start for ${commit}:${folder}: ${result.error.message}`);
          if (result.status !== 0) throw new Stop(`git archive of ${commit}:${folder} failed ${result.signal ? `on signal ${result.signal}` : `with exit status ${result.status}`}: ${(result.stdout + result.stderr).trim()}`);
          if (generated) zipEntries({ folder: generated.directory, entries: generated.files.map(entry => entry.output), archive, epoch, env: ctx.env });
        } finally {
          if (generated) rmSync(generated.directory, { recursive: true, force: true });
        }
      }
    });
    if (native.length) withNativeSource(ctx, commit, epoch, next, native, build);
    else build(undefined);
    const built = readdirSync(next).sort();
    files = set.platform === undefined ? names : matchAssets(expected, built, `${reference}: ${folder} after ${setName(set)}`);
    if (set.platform === undefined && JSON.stringify(built) !== JSON.stringify([...names].sort())) throw new Stop(`${folder} holds [${built.join(', ')}], not the archives [${[...names].sort().join(', ')}]`);
    const failures = expected.flatMap((asset, position) => {
      // expected names the index of its package in the configuration, and files the file of each asset at its position.
      const { kind, directory: folder, name } = present(config.packages[asset.index], 'config.packages[asset.index]');
      const file = present(files[position], 'files[position]');
      if (kind === 'wheel' || kind === 'wheel-abi3') return metadataProblems(wheelMetadata(root, path.join(next, file), ctx.env), name, version).map(problem => `${file}: ${problem}`);
      if (kind !== 'npm' && kind !== 'composer' && !(kind === 'npm-native' && set.platform === undefined)) return [];
      const manifest = MANIFEST_OF[kind];
      const packed = packedManifest(ctx, path.join(next, file));
      const source = present(sources[asset.index], 'sources[asset.index]');
      // The root package of an npm-native package carries the platform packages that the release writes into its manifest (K1200).
      const item = present(config.packages[asset.index], 'config.packages[asset.index]');
      const expectedManifest = kind === 'npm' && name === PACKAGE ? packedPackageManifest(source) : kind === 'npm-native' ? packedNativeManifest(source, item, version, path.posix.join(folder, manifest)) : source;
      return packed === expectedManifest ? [] : [`${file}: the packed ${manifest} differs from ${path.posix.join(folder, manifest)} of the commit ${commit}`];
    });
    if (failures.length) throw new Stop(`${reference}: the release assets do not install outside the repository: ${failures.join('; ')}`);
    if (set.platform === undefined && hasComposerRepository(config)) {
      writeFileSync(path.join(next, PACKAGES_JSON), composerRepository(config, version, next, sources));
      ctx.log(`[release] ${reference}: wrote ${PACKAGES_JSON}, the Composer repository of the release`);
      files = [...files, PACKAGES_JSON];
    }
    if (existsSync(target)) renameSync(target, previous);
    renameSync(next, target);
    rmSync(previous, { recursive: true, force: true });
  } catch (error) {
    cleanupAfter(error, restore);
  }
  restore();
  return files;
}

/** Checks the native archive helper before package construction. */
function requireArchiveTools(ctx: Context, retry: string): void {
  if (!ctx.config.packages.some(item => item.generated?.length)) return;
  const zip = execute('zip', ['-v'], { cwd: ctx.root, env: ctx.env });
  if (zip.error) throw new Stop(`zip is required to append generated files to Composer release archives; install Info-ZIP (for example, brew install zip or sudo apt-get install zip), then run ${retry}`);
  if (zip.status !== 0) throw new Stop(`zip -v failed ${zip.signal ? `on signal ${zip.signal}` : `with exit status ${zip.status}`}; install a working Info-ZIP command, then run ${retry}`);
}

/** Builds release candidates from committed HEAD without resolving, creating or pretending to have a tag. */
export function candidateAssets(ctx: Context, version: string): string[] {
  if (!EXACT_VERSION.test(version)) throw new Stop(`candidate version ${JSON.stringify(version)} is not X.Y.Z`);
  const commit = run('git', ['rev-parse', '--verify', 'HEAD^{commit}'], at(ctx)).trim();
  const retry = `make release-candidate-assets VERSION=${version}`;
  requireCheckout(ctx, `HEAD candidate ${version}`, commit, retry);
  requireArchiveTools(ctx, retry);
  return assetsFromCommit(ctx, `HEAD candidate ${version}`, commit, version);
}

/** The record of the draft release that publish created for `tag`, relative to the checkout: `{ "id": <id> }`. */
/** The record of the draft release of `tag` in the folder of the release records that the caller names (RELEASE_RECORDS, K1115). */
export function releaseRecord(ctx: Pick<Context, 'records'>, tag: string): string {
  if (ctx.records === undefined) throw new Stop('no folder of the release records is named; the caller names it in RELEASE_RECORDS');
  return path.join(ctx.records, `${tag}.json`);
}

/** The release that publish created for `tag`, read by the id of its record; a missing record is an error. */
export function recordedRelease(ctx: Pick<Context, 'root' | 'env' | 'config' | 'records'>, tag: string): GitHubRelease {
  const file = releaseRecord(ctx, tag);
  if (!existsSync(path.resolve(ctx.root, file))) throw new Stop(`${file} is missing; make release-publish writes it`);
  // The folder may lie outside the checkout, so the record is read relative to the checkout whatever its place.
  const record = readConfig<{ id: number }>(ctx.root, path.relative(ctx.root, path.resolve(ctx.root, file)), 'release-record.schema.json');
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
  const assets = assetFolder(ctx);
  const target = path.resolve(root, assets);
  const files = releaseFiles(config, version);
  const missing = files.filter(name => !existsSync(path.join(target, name)));
  if (missing.length) throw new Stop(`${assets} lacks [${missing.join(', ')}]; make release-assets builds them`);
  // The assets of the platform sets, which their runs built on their own platforms and the workflow gathered here (K1189): each
  // asset of every set is one file, and no other file is in the folder.
  const extensions: ExtensionNames = Object.fromEntries(config.packages.flatMap((item, index) => (item.kind === 'php-ext' ? [[index, extensionOf(readComposerManifestAt(root, item.directory), path.posix.join(item.directory, 'composer.json'))]] : [])));
  const platform = assetSets(config.packages).flatMap(set => platformAssets(config.packages, config.repositoryUrl, version, set, extensions));
  const others = readdirSync(target).filter(name => !files.includes(name)).sort();
  const platformFiles = matchAssets(platform, others, `${assets} for the release ${tag}`);
  const names = [...files, ...platformFiles];
  // Only a package archive carries a label; packages.json is a file of the release, not a package (P39).
  const labels = [...assetLabels(config, version), ...(hasComposerRepository(config) ? [undefined] : []), ...platform.map(item => item.label)];
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
    const id = createDraft(at(ctx), config.repositoryUrl, tag, notesFile, names.map((name, index) => ({ file: path.join(target, name), label: labels[index] })));
    const record = releaseRecord(ctx, tag);
    writeJson(path.resolve(root, record), { id });
    ctx.log(`[release] ${tag}: the draft release ${id} is recorded in ${record}`);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
  return names;
}

/** The composer.json of the package in `directory` of the checkout, which publish reads at the tag that it checked out. */
const readComposerManifestAt = (root: string, directory: string): ComposerManifest => readConfig<ComposerManifest>(root, path.posix.join(directory, 'composer.json'), 'composer-manifest.schema.json');

/** The asset sets of the release as the include list of a GitHub matrix: each set with its platform and PHP minor, empty when it has none (K1189). */
export function matrix(config: Pick<ReleaseConfig, 'packages'>): { include: { platform: string; php: string }[] } {
  return { include: assetSets(config.packages).map(set => ({ platform: set.platform ?? '', php: set.php ?? '' })) };
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
 * The problems of the classification of the package files of the checkout: every tracked or new file named by `packageFiles` of
 * the config, such as package.json or go.mod, is a key of `manifests` or `notReleased`, or the go.mod of a Go module, or a file
 * that a glob of `writtenFiles` matches, which a tool writes and no tag releases (K167, K1114); a listed file exists; no file is
 * in two lists. A config that names no package file has nothing to classify, which is a problem itself.
 */
export function coverage(ctx: Context): string[] {
  const { root, config } = ctx;
  const packageFiles = config.packageFiles ?? [];
  if (packageFiles.length === 0) return [`${CONFIG} names no packageFiles, so coverage classifies nothing; declare the names of the package files of the repository, such as package.json`];
  const written = config.writtenFiles ?? [];
  const files = checkedFiles(root).filter(file => packageFiles.includes(path.posix.basename(file)));
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
  for (const file of files) {
    if (!where.has(file) && !matchesAny(written, file)) problems.push(`${file} is neither released nor listed as not released; add it to manifests, notReleased or goModules in ${CONFIG}`);
  }
  return problems;
}

const USAGE = 'usage: node scripts/kit/release.mts assets|publish|undraft TAG | candidate-assets VERSION | coverage | sets';

/** Runs a step of the command line; the exit status. */
export function main(argv: string[], { root = repositoryRoot(), env = process.env, print = console.log, error = console.error }: CommandOptions = {}): number {
  const [mode, latest, ...rest] = argv;
  let tag = latest;
  const tagged = mode !== undefined && ['assets', 'publish', 'undraft'].includes(mode);
  const candidate = mode === 'candidate-assets' && latest !== undefined && rest.length === 0;
  if (!(tagged && tag && rest.length === 0) && !candidate && !((mode === 'coverage' || mode === 'sets') && tag === undefined)) {
    error(USAGE);
    return 2;
  }
  // The steps that build or publish the assets need the asset folder that the caller names; without it, or with the checkout or a
  // folder that holds it, nothing runs (K1102).
  const named = env.RELEASE_ASSETS || undefined;
  if (mode !== undefined && ['assets', 'candidate-assets', 'publish'].includes(mode)) {
    const unusable = named === undefined ? `${mode} needs the asset folder; name it in RELEASE_ASSETS` : assetsFolderProblem(root, named);
    if (unusable !== undefined) {
      error(`[release] ${mode} failed: ${unusable}`);
      return 2;
    }
  }
  // publish writes the record of its draft and undraft reads it, in the folder that the caller names; without it nothing runs (K1115).
  if ((mode === 'publish' || mode === 'undraft') && !env.RELEASE_RECORDS) {
    error(`[release] ${mode} failed: ${mode} needs the folder of the release record; name it in RELEASE_RECORDS`);
    return 2;
  }
  try {
    const ctx = context(root, { env, log: print });
    if (mode === 'sets') {
      // The sets of the release, which the release workflow builds in a matrix: printed, and written to GITHUB_OUTPUT as sets (K1189).
      const sets = JSON.stringify(matrix(ctx.config));
      print(sets);
      if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `sets=${sets}\n`);
      return 0;
    }
    if (candidate) {
      const names = candidateAssets(ctx, present(latest, 'candidate version'));
      print(`[release] HEAD candidate ${latest}: built ${names.join(', ')} in ${assetFolder(ctx)}`);
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
      print(`[release] ${tag}: built ${ctx.set.platform === undefined ? '' : `${setName(ctx.set)}: `}${names.join(', ')} in ${assetFolder(ctx)}`);
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
