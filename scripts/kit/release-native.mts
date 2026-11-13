// The per-platform assets of a release (K1189): a Rust core and its generated bindings, released for each platform as an abi3
// wheel (`wheel-abi3`), a PIE pre-packaged binary for each PHP minor (`php-ext`), an npm package that selects its napi-rs
// platform package with those platform packages (`npm-native`), and a Go static library (`go-static`). Each asset is built
// with the tool of its ecosystem, which the repository declares and kit pins not (S4): uv build with the maturin of the
// build-system.requires of the wheel, cargo with the toolchain of rust-toolchain.toml, and the napi CLI of the repository.
//
// The assets are built in sets, one set per run, since each platform builds its own (release.mts assets): the set without a
// platform, the set of a platform, and the set of a platform and a PHP minor. A set builds only on its own platform; no tool
// cross-compiles here. Every native build reads the Cargo workspace of the repository, so it runs in a copy of the whole tagged
// tree with the outputs of the make entries of its package, and cargo writes into a target folder of the run; both are
// removed after the run.
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { execute, run, Stop } from './process.mts';
import { parseJson } from './schema-validate.mts';
import { toolCommand } from './mise-tools.mts';
import { readToml, isStringArray, isTable } from './toml.mts';
import { distributionOf } from './release-wheel.mts';
import type { ComposerManifest, NpmManifest } from './manifests.mts';

/** The kinds of the per-platform packages of config/release.json. */
export const NATIVE_KINDS = ['wheel-abi3', 'php-ext', 'npm-native', 'go-static'] as const;
export type NativeKind = typeof NATIVE_KINDS[number];

/** Whether `kind` is a kind of a per-platform package. */
export const isNative = (kind: string): kind is NativeKind => (NATIVE_KINDS as readonly string[]).includes(kind);

/**
 * The platforms of the release (T-2), by the names that napi-rs gives them: the Node.js platform and architecture of each, its
 * Rust triple, the architecture, operating system and libc of PIE, and the pattern of a platform tag of a wheel that maturin writes
 * there.
 */
export const PLATFORMS = {
  'linux-x64-gnu': { os: 'linux', cpu: 'x64', glibc: true, triple: 'x86_64-unknown-linux-gnu', pie: 'x86_64-linux-glibc', wheel: String.raw`(?:manylinux_\d+_\d+_x86_64|manylinux2014_x86_64)` },
  'linux-arm64-gnu': { os: 'linux', cpu: 'arm64', glibc: true, triple: 'aarch64-unknown-linux-gnu', pie: 'arm64-linux-glibc', wheel: String.raw`(?:manylinux_\d+_\d+_aarch64|manylinux2014_aarch64)` },
  'darwin-arm64': { os: 'darwin', cpu: 'arm64', glibc: false, triple: 'aarch64-apple-darwin', pie: 'arm64-darwin-bsdlibc', wheel: String.raw`macosx_\d+_\d+_arm64` },
} as const;
export type Platform = keyof typeof PLATFORMS;
export const PLATFORM_NAMES = Object.keys(PLATFORMS);

/** Whether `name` names a platform of the release. */
export const isPlatform = (name: string): name is Platform => PLATFORM_NAMES.includes(name);

/** The platform of this machine, or undefined when it is none of the platforms of the release (a musl Linux, an x64 Mac). */
export function hostPlatform(): Platform | undefined {
  const report = process.report.getReport();
  const header = typeof report === 'object' && report !== null && 'header' in report ? report.header : undefined;
  const glibc = typeof header === 'object' && header !== null && 'glibcVersionRuntime' in header && typeof header.glibcVersionRuntime === 'string';
  return PLATFORM_NAMES.filter(isPlatform).find(name => PLATFORMS[name].os === process.platform && PLATFORMS[name].cpu === process.arch && PLATFORMS[name].glibc === glibc);
}

/** A package of config/release.json in the fields that the native assets read. */
export type NativePackage = { kind: string; directory: string; name: string; product: string; runtime: string; platforms?: string[]; php?: string[] };

/** An asset set: the set without a platform, the set of a platform, or the set of a platform and a PHP minor. */
export type AssetSet = { platform?: Platform | undefined; php?: string | undefined };

/** The set that `platform` and `php` name, as the caller names them in RELEASE_PLATFORM and RELEASE_PHP; an empty value names none. */
export function namedSet(platform: string | undefined, php: string | undefined): AssetSet {
  if (php && !platform) throw new Stop(`RELEASE_PHP ${php} names a PHP minor without a platform; name the platform in RELEASE_PLATFORM`);
  if (!platform) return {};
  if (!isPlatform(platform)) throw new Stop(`RELEASE_PLATFORM ${platform} is not a platform of the release; the platforms are ${PLATFORM_NAMES.join(', ')}`);
  return php ? { platform, php } : { platform };
}

/** The text of a set in a message. */
export const setName = (set: AssetSet): string => (set.platform === undefined ? 'the set without a platform' : set.php === undefined ? `the set of ${set.platform}` : `the set of ${set.platform} and PHP ${set.php}`);

/**
 * The sets of the packages of a configuration, in order: the set without a platform, then for each platform of the release that a
 * package declares its set, when a package other than php-ext declares it, and the set of each PHP minor of its php-ext packages.
 */
export function assetSets(packages: readonly NativePackage[]): AssetSet[] {
  const sets: AssetSet[] = [{}];
  for (const platform of PLATFORM_NAMES.filter(isPlatform)) {
    const on = packages.filter(item => isNative(item.kind) && (item.platforms ?? []).includes(platform));
    if (on.some(item => item.kind !== 'php-ext')) sets.push({ platform });
    const minors = [...new Set(on.filter(item => item.kind === 'php-ext').flatMap(item => item.php ?? []))].sort();
    for (const php of minors) sets.push({ platform, php });
  }
  return sets;
}

/** Whether the package `item` builds an asset in `set`: an npm-native package in the set without a platform, too, its root package. */
export function inSet(item: NativePackage, set: AssetSet): boolean {
  if (!isNative(item.kind)) return set.platform === undefined;
  if (set.platform === undefined) return item.kind === 'npm-native';
  if (!(item.platforms ?? []).includes(set.platform)) return false;
  return item.kind === 'php-ext' ? set.php !== undefined && (item.php ?? []).includes(set.php) : set.php === undefined;
}

/** The problems of the platforms and the PHP minors of a package of config/release.json (loadConfig). */
export function nativeProblems(item: NativePackage, where: string): string[] {
  const problems: string[] = [];
  if (!isNative(item.kind)) {
    if (item.platforms !== undefined || item.php !== undefined) problems.push(`${where}: the ${item.kind} package ${item.name} is built once; platforms and php belong to ${NATIVE_KINDS.join(', ')}`);
    return problems;
  }
  const platforms = item.platforms ?? [];
  if (platforms.length === 0) problems.push(`${where}: the ${item.kind} package ${item.name} needs platforms, the platforms it is built for: ${PLATFORM_NAMES.join(', ')}`);
  for (const platform of platforms) if (!isPlatform(platform)) problems.push(`${where}: the platform ${platform} of ${item.name} is not one of ${PLATFORM_NAMES.join(', ')}`);
  if (new Set(platforms).size !== platforms.length) problems.push(`${where}: ${item.name} lists a platform twice`);
  if (item.kind === 'php-ext') {
    const php = item.php ?? [];
    if (php.length === 0) problems.push(`${where}: the php-ext package ${item.name} needs php, the PHP minors X.Y it is built for, since the extension ABI differs for each minor`);
    if (new Set(php).size !== php.length) problems.push(`${where}: ${item.name} lists a PHP minor twice`);
  } else if (item.php !== undefined) problems.push(`${where}: php belongs to a php-ext package, not to the ${item.kind} package ${item.name}`);
  return problems;
}

/** The vendor of the release, the owner of repositoryUrl. */
const vendorOf = (repositoryUrl: string): string => new URL(repositoryUrl).pathname.split('/').filter(Boolean)[0] ?? '';

/** The npm pack name of an npm package `name` at `version`: `@scope/x` is `scope-x-1.0.0.tgz` (K980). */
export const npmPackName = (name: string, version: string): string => `${name.replace(/^@/, '').replace('/', '-')}-${version}.tgz`;

/** The pattern of a regular expression that matches `text` literally. */
const literal = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * An asset that a set builds: the package of config/release.json at `index`, the file `name` that kit predicts or, for a name that
 * the tool or the PHP chooses, the `pattern` of the name; and its GitHub label (P39).
 */
export type ExpectedAsset = { index: number; name?: string; pattern?: RegExp; label: string };

/** The extension name of a php-ext package, read from its composer.json; asset names need it before the build. */
export type ExtensionNames = Record<number, string>;

/**
 * The assets of the native packages of `packages` in the platform set `set` at `version`, each with its label (P39, K1189): the
 * wheel that maturin names, the PIE binary that PIE looks for, the platform package that npm pack names and the zip of the Go
 * static library that kit names by its label. `extensions` names the extension of each php-ext package by its index.
 */
export function platformAssets(packages: readonly NativePackage[], repositoryUrl: string, version: string, set: AssetSet, extensions: ExtensionNames): ExpectedAsset[] {
  const { platform, php } = set;
  if (platform === undefined) return [];
  const vendor = vendorOf(repositoryUrl);
  return packages.flatMap((item, index): ExpectedAsset[] => {
    if (!isNative(item.kind) || !inSet(item, set)) return [];
    const label = `${vendor}-${item.product}-${item.runtime}-${version}${php === undefined ? '' : `-php${php}`}-${platform}`;
    // The wheel of a platform carries the platform tags of that platform alone, one or more joined by dots (PEP 425).
    const tag = PLATFORMS[platform].wheel;
    if (item.kind === 'wheel-abi3') return [{ index, pattern: new RegExp(`^${literal(distributionOf(item.name))}-${literal(version)}-cp\\d+-abi3-${tag}(?:\\.${tag})*\\.whl$`), label }];
    if (item.kind === 'php-ext') return [{ index, pattern: new RegExp(`^${literal(pieName(extensions[index] ?? '', version, php ?? '', platform))}(?:-debug)?-(?:nts|zts)\\.zip$`), label }];
    if (item.kind === 'npm-native') return [{ index, name: npmPackName(`${item.name}-${platform}`, version), label }];
    return [{ index, name: `${label}.zip`, label }];
  });
}

/**
 * The PIE pre-packaged binary name of the extension `extension` at the tag vX.Y.Z for the PHP minor `php` on `platform`, without
 * its debug and thread-safety suffixes: `php_<extension>-v<version>_php<X.Y>-<arch>-<os>-<libc>`. PIE finds the release by the
 * version of the package and names the asset with that version, and packages.json gives the package the tag as its version.
 */
export const pieName = (extension: string, version: string, php: string, platform: Platform): string => `php_${extension}-v${version}_php${php}-${PLATFORMS[platform].pie}`;

/** The context of a native build: the checkout, the environment, a log, the copy of the tagged tree, the target folder and the output. */
export type NativeBuild = { root: string; env: NodeJS.ProcessEnv; log: (text: string) => void; source: string; target: string; output: string; work: string; epoch: number };

/** The parsed messages of cargo build: the files of the compiler-artifact message of the package whose manifest is `manifest`. */
type CargoMessage = { reason: string; manifest_path?: string; target?: { kind: string[] }; filenames?: string[] };

/** The Cargo package name of the Cargo.toml of `directory` in `source`, and the real path of that Cargo.toml. */
export function cargoPackage(source: string, directory: string): { name: string; manifest: string } {
  const manifest = path.join(source, directory, 'Cargo.toml');
  if (!existsSync(manifest)) throw new Stop(`${directory}/Cargo.toml is missing; a native package is a Cargo package`);
  const table = readToml(readFileSync(manifest, 'utf8'), `${directory}/Cargo.toml`);
  const name = isTable(table.package) ? table.package.name : undefined;
  if (typeof name !== 'string') throw new Stop(`${directory}/Cargo.toml names no [package] name`);
  return { name, manifest: realpathSync(manifest) };
}

/** The crate types that the [lib] of the Cargo.toml text `text` declares. */
export function crateTypes(text: string, file: string): string[] {
  const table = readToml(text, file);
  const types = isTable(table.lib) ? table.lib['crate-type'] : undefined;
  return isStringArray(types) ? types : [];
}

/**
 * Builds the package of `directory` of the Cargo workspace `source` with cargo build --release --locked, the cargo of the checkout
 * `root`, into the target folder `target`, and returns the file of the `kind` library (cdylib or staticlib) that cargo names in its
 * compiler-artifact message (K1189, K1192).
 */
export function cargoBuild({ root, source, directory, kind, env, target, log }: { root: string; source: string; directory: string; kind: 'cdylib' | 'staticlib'; env: NodeJS.ProcessEnv; target: string; log: (text: string) => void }): string {
  if (!crateTypes(readFileSync(path.join(source, directory, 'Cargo.toml'), 'utf8'), `${directory}/Cargo.toml`).includes(kind)) throw new Stop(`${directory}/Cargo.toml declares no ${kind} in crate-type of [lib]; the build needs a ${kind} of it`);
  const { name, manifest } = cargoPackage(source, directory);
  log(`cargo build --release --locked -p ${name}`);
  const result = execute(toolCommand(root, 'cargo'), ['build', '--release', '--locked', '-p', name, '--message-format=json-render-diagnostics'], { cwd: source, env: { ...env, CARGO_TARGET_DIR: target } });
  if (result.error) throw new Stop(`cargo could not start for ${name}: ${result.error.message}`);
  if (result.status !== 0) throw new Stop(`cargo build of ${name} failed ${result.signal ? `on signal ${result.signal}` : `with exit status ${result.status}`}: ${result.stderr.trim()}`);
  const files = result.stdout.split('\n').filter(line => line.trim()).flatMap((line) => {
    const message = parseJson<CargoMessage>(line, 'cargo-artifact.schema.json', `a message of cargo build -p ${name}`);
    if (message.reason !== 'compiler-artifact' || message.manifest_path === undefined || realpathSync(message.manifest_path) !== manifest || !(message.target?.kind ?? []).includes(kind)) return [];
    return (message.filenames ?? []).filter(file => (kind === 'staticlib' ? file.endsWith('.a') : /\.(so|dylib)$/.test(file)));
  });
  const [file] = files;
  if (files.length !== 1 || file === undefined) throw new Stop(`cargo build of ${name} names ${files.length} ${kind} files [${files.join(', ')}]; expected one`);
  return file;
}

/** Builds the `kind` library of the package of `directory` in the copy of the tagged tree of `build`. */
const cargoLibrary = (build: NativeBuild, directory: string, kind: 'cdylib' | 'staticlib', env: NodeJS.ProcessEnv): string => cargoBuild({ root: build.root, source: build.source, directory, kind, env, target: build.target, log: text => build.log(`[release] ${text}`) });

/**
 * Adds the files `entries` of `folder` to the zip `archive`, one call of zip each, with the time `epoch`, mode 0644, TZ=UTC and no
 * extra fields, so a second run writes the same bytes; `deflate` compresses, else the entries are stored. A missing archive is
 * created.
 */
export function zipEntries({ folder, entries, archive, epoch, env, deflate = false }: { folder: string; entries: readonly string[]; archive: string; epoch: number; env: NodeJS.ProcessEnv; deflate?: boolean }): void {
  for (const entry of entries) {
    chmodSync(path.join(folder, entry), 0o644);
    utimesSync(path.join(folder, entry), epoch, epoch);
    const result = execute('zip', ['-q', deflate ? '-9' : '-0', '-X', archive, entry], { cwd: folder, env: { ...env, TZ: 'UTC' } });
    if (result.error) throw new Stop(`zip could not start while adding ${entry} to ${path.basename(archive)}: ${result.error.message}`);
    if (result.status !== 0) throw new Stop(`zip failed while adding ${entry} to ${path.basename(archive)} ${result.signal ? `on signal ${result.signal}` : `with exit status ${result.status}`}: ${(result.stdout + result.stderr).trim()}`);
  }
}

/** The PHP of the checkout as the php-build schema reads it: its minor, thread safety and debug build. */
type PhpBuild = { minor: string; zts: boolean; debug: boolean };

const PHP_BUILD = 'echo json_encode(["minor" => PHP_MAJOR_VERSION . "." . PHP_MINOR_VERSION, "zts" => PHP_ZTS === 1, "debug" => PHP_DEBUG === 1]);';

/** The PHP code that prints the extensions of the PHP, one on each line. */
const PHP_EXTENSIONS = 'echo implode("\\n", get_loaded_extensions());';

/** The extension name and the download methods that the composer.json of a php-ext package names, or the problems of them. */
/**
 * The problems of the composer.json of a php-ext package `file`: the name of the extension that PIE installs and the binary carries,
 * and pre-packaged-binary among its download methods, so that PIE looks for the binaries of the release (K1196).
 */
export function phpExtProblems(manifest: ComposerManifest, file: string): string[] {
  const pie = manifest['php-ext'];
  const name = pie?.['extension-name'];
  const methods = pie?.['download-url-method'];
  const list = methods === undefined ? [] : typeof methods === 'string' ? [methods] : methods;
  return [
    ...(name !== undefined && /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? [] : [`${file} names no php-ext.extension-name, the name of the extension that PIE installs and the binary carries`]),
    ...(list.includes('pre-packaged-binary') ? [] : [`${file} lists no pre-packaged-binary in php-ext.download-url-method, so PIE would not look for the binaries of the release`]),
  ];
}

/** The name of the extension of the php-ext package `file`; Stop with every problem of its composer.json. */
export function extensionOf(manifest: ComposerManifest, file: string): string {
  const name = manifest['php-ext']?.['extension-name'];
  const problems = phpExtProblems(manifest, file);
  if (problems.length || name === undefined) throw new Stop(problems.join('; '));
  return name;
}

/** Builds the PIE binary of a php-ext package for the PHP of the checkout, which must be the minor of the set; returns its name. */
function phpExtension(build: NativeBuild, item: NativePackage, extension: string, set: { platform: Platform; php: string }, version: string): string {
  const php = toolCommand(build.root, 'php');
  const info = parseJson<PhpBuild>(run(php, ['-n', '-r', PHP_BUILD], { cwd: build.root, env: build.env }), 'php-build.schema.json', `the build of ${php}`);
  if (info.minor !== set.php) throw new Stop(`the php of the checkout is PHP ${info.minor}, and ${setName(set)} builds for PHP ${set.php}; set up PHP ${set.php} before the run`);
  const env = { ...build.env, PHP: php, PHP_CONFIG: toolCommand(build.root, 'php-config') };
  const library = cargoLibrary(build, item.directory, 'cdylib', env);
  const folder = path.join(build.work, `php-${set.php}`);
  mkdirSync(folder, { recursive: true });
  const module = `${extension}.so`;
  copyFileSync(library, path.join(folder, module));
  // The binary loads into the PHP it was built for, with no php.ini of the machine, before it is packed.
  const loaded = execute(php, ['-n', '-d', `extension=${path.join(folder, module)}`, '-r', `exit(extension_loaded(${JSON.stringify(extension)}) ? 0 : 1);`], { cwd: build.root, env: build.env });
  if (loaded.error || loaded.status !== 0) {
    // PHP loads a binary whose module names another extension without a message, so the extensions that the binary adds to those of
    // the PHP are what it registered (K1203).
    const extensions = (binary: string[]) => {
      const listed = execute(php, ['-n', ...binary, '-r', PHP_EXTENSIONS], { cwd: build.root, env: build.env });
      return listed.error || listed.status !== 0 ? [] : listed.stdout.split('\n').filter(Boolean);
    };
    const own = new Set(extensions([]));
    const registered = extensions(['-d', `extension=${path.join(folder, module)}`]).filter(name => !own.has(name));
    if (registered.length) throw new Stop(`PHP ${set.php} loads the binary that cargo built from ${item.directory} as the extension ${registered.join(', ')}, not as ${extension}, the php-ext.extension-name of its composer.json; the module of the crate names the extension that the binary registers`);
    throw new Stop(`PHP ${set.php} does not load the extension ${extension} that cargo built from ${item.directory}: ${(loaded.error?.message ?? `${loaded.stdout}${loaded.stderr}`).trim() || 'php printed nothing'}`);
  }
  const name = `${pieName(extension, version, set.php, set.platform)}${info.debug ? '-debug' : ''}-${info.zts ? 'zts' : 'nts'}.zip`;
  zipEntries({ folder, entries: [module], archive: path.join(build.output, name), epoch: build.epoch, env: build.env, deflate: true });
  return name;
}

/** Builds the zip of the Go static library of a go-static package: the lib<name>.a that cargo writes, under its label. */
function goStatic(build: NativeBuild, item: NativePackage, label: string): string {
  const library = cargoLibrary(build, item.directory, 'staticlib', build.env);
  const folder = path.join(build.work, 'go-static', item.directory);
  mkdirSync(folder, { recursive: true });
  copyFileSync(library, path.join(folder, path.basename(library)));
  const name = `${label}.zip`;
  zipEntries({ folder, entries: [path.basename(library)], archive: path.join(build.output, name), epoch: build.epoch, env: build.env, deflate: true });
  return name;
}

/** Builds the abi3 wheel of a wheel-abi3 package with uv build, which runs the maturin of its build-system.requires; returns its name. */
function abi3Wheel(build: NativeBuild, item: NativePackage, expected: ExpectedAsset, platform: Platform): string {
  const built = path.join(build.work, 'wheel', item.directory);
  mkdirSync(built, { recursive: true });
  build.log(`[release] uv build --wheel ${item.directory}`);
  // maturin reads MATURIN_PEP517_ARGS as the arguments of its build, so cargo resolves from Cargo.lock alone.
  run(toolCommand(build.root, 'uv'), ['build', '--wheel', '--python', toolCommand(build.root, 'python3'), '--out-dir', built, path.join(build.source, item.directory)], { cwd: build.work, env: { ...build.env, MATURIN_PEP517_ARGS: '--locked', CARGO_TARGET_DIR: build.target, SOURCE_DATE_EPOCH: String(build.epoch) } });
  const wheels = readdirSync(built).filter(name => name.endsWith('.whl'));
  const [wheel] = wheels;
  if (wheels.length !== 1 || wheel === undefined || expected.pattern?.test(wheel) !== true) throw new Stop(`uv build of ${item.directory} wrote [${wheels.join(', ')}], not one abi3 wheel of ${item.name} for ${platform}`);
  copyFileSync(path.join(built, wheel), path.join(build.output, wheel));
  return wheel;
}

/** The napi CLI of the repository, which its package.json declares and install-packages installs. */
export const napiCommand = (root: string): string => path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'napi.cmd' : 'napi');

/**
 * The problems of the package.json of an npm-native package for its platforms: the napi configuration that the napi CLI reads. The
 * source names no platform package; the release writes them into the manifest that it packs (K1200).
 */
export function npmNativeProblems(manifest: NpmManifest, item: NativePackage, file: string): string[] {
  const problems: string[] = [];
  const platforms = (item.platforms ?? []).filter(isPlatform);
  if (!manifest.napi?.binaryName) problems.push(`${file} names no napi.binaryName, the name of the addon that the napi CLI writes`);
  const triples = platforms.map(platform => PLATFORMS[platform].triple);
  const targets = manifest.napi?.targets ?? [];
  if (targets.length !== triples.length || !triples.every(triple => targets.includes(triple))) problems.push(`${file}: napi.targets [${(manifest.napi?.targets ?? []).join(', ')}] are not the triples of its platforms [${triples.join(', ')}]`);
  return problems;
}

/**
 * The package.json that the root package of the npm-native package `item` carries, from the text of its source manifest `file`: the
 * source with each platform package at the version of the release in its optionalDependencies, beside the optional dependencies of
 * the source (K1200). The source names none, since npm ci refuses a dependency that the lock of the workspace lacks.
 */
export function packedNativeManifest(text: string, item: NativePackage, version: string, file: string): string {
  const manifest = parseJson<NpmManifest>(text, 'npm-manifest.schema.json', file);
  const platforms = (item.platforms ?? []).filter(isPlatform);
  const optionalDependencies = { ...manifest.optionalDependencies, ...Object.fromEntries(platforms.map(platform => [`${item.name}-${platform}`, version])) };
  return `${JSON.stringify({ ...manifest, optionalDependencies }, null, 2)}\n`;
}

/** Builds the platform package of an npm-native package with the napi CLI and packs it with npm; returns its name. */
function npmPlatform(build: NativeBuild, item: NativePackage, platform: Platform, version: string): string {
  const napi = napiCommand(build.root);
  if (!existsSync(napi)) throw new Stop(`${path.relative(build.root, napi)} is missing; the repository declares @napi-rs/cli in devDependencies of its package.json and make install-packages installs it`);
  const packageJson = path.join(build.source, item.directory, 'package.json');
  const manifest = path.join(build.source, item.directory, 'Cargo.toml');
  const addons = path.join(build.work, 'napi', item.directory, 'addons');
  // The napi CLI refuses an npm folder outside the package of its package.json, so the folders of the platform packages lie in the
  // package of the copy, in a folder of kit that no repository tracks (K1198).
  const npm = path.join(build.source, item.directory, '.kit-napi', 'npm');
  mkdirSync(addons, { recursive: true });
  const place = { cwd: build.source, env: { ...build.env, CARGO_TARGET_DIR: build.target } };
  build.log(`[release] napi build --platform --release ${item.directory} for ${PLATFORMS[platform].triple}`);
  run(napi, ['build', '--platform', '--release', '--no-js', '--manifest-path', manifest, '--package-json-path', packageJson, '--target-dir', build.target, '--output-dir', addons, '--target', PLATFORMS[platform].triple, '--', '--locked'], place);
  // napi artifacts requires the addon of every configured target, and the set builds its own alone, so the two commands read a
  // configuration of the run with the target of the set, which overrides napi.targets of package.json (K1199).
  const config = path.join(build.work, 'napi', item.directory, 'napi.json');
  writeFileSync(config, `${JSON.stringify({ targets: [PLATFORMS[platform].triple] })}\n`);
  run(napi, ['create-npm-dirs', '--package-json-path', packageJson, '--config-path', config, '--npm-dir', npm], place);
  run(napi, ['artifacts', '--package-json-path', packageJson, '--config-path', config, '--output-dir', addons, '--npm-dir', npm], place);
  const folder = path.join(npm, platform);
  const written = parseJson<NpmManifest>(readFileSync(path.join(folder, 'package.json'), 'utf8'), 'npm-manifest.schema.json', `the package.json that napi wrote for ${platform}`);
  const problems = [
    ...(written.name === `${item.name}-${platform}` ? [] : [`its name is ${written.name ?? 'none'}, expected ${item.name}-${platform}`]),
    ...(written.version === version ? [] : [`its version is ${written.version ?? 'none'}, the tag is ${version}`]),
    ...(written.main !== undefined && existsSync(path.join(folder, written.main)) ? [] : [`its main ${written.main ?? 'none'} is not the addon that napi artifacts copied`]),
  ];
  if (problems.length) throw new Stop(`the platform package of ${item.name} for ${platform}: ${problems.join('; ')}`);
  return npmPack(build, folder, npmPackName(`${item.name}-${platform}`, version), `the platform package of ${item.name}`);
}

/**
 * Packs the npm package of `folder` into the output with the npm of the checkout and no script of the package, and returns `name`,
 * which npm pack must write as its one file (K980).
 */
function npmPack(build: NativeBuild, folder: string, name: string, what: string): string {
  const before = new Set(readdirSync(build.output));
  run(toolCommand(build.root, 'npm'), ['pack', '--ignore-scripts', '--pack-destination', build.output], { cwd: folder, env: build.env });
  const created = readdirSync(build.output).filter(file => !before.has(file));
  if (created.length !== 1 || created[0] !== name) throw new Stop(`npm pack of ${what} wrote [${created.join(', ')}], not ${name}`);
  return name;
}

/** Builds the root package of an npm-native package from the copy of the tagged tree and packs it with npm; returns its name. */
export function npmNativeRoot(build: NativeBuild, item: NativePackage, version: string): string {
  const folder = path.join(build.source, item.directory);
  const file = `${item.directory}/package.json`;
  const text = readFileSync(path.join(folder, 'package.json'), 'utf8');
  const problems = npmNativeProblems(parseJson<NpmManifest>(text, 'npm-manifest.schema.json', file), item, file);
  if (problems.length) throw new Stop(problems.join('; '));
  // The copy is the staged manifest of the release: it names the platform packages at the version of the release (K1200).
  writeFileSync(path.join(folder, 'package.json'), packedNativeManifest(text, item, version, file));
  // The make entries built what the package carries, so no script of the package runs in the copy, which holds no node_modules.
  return npmPack(build, folder, npmPackName(item.name, version), item.directory);
}

/** Builds the asset `expected` of the native package `item` in the platform set `set`; returns its file name in the output. */
export function buildPlatformAsset(build: NativeBuild, item: NativePackage, expected: ExpectedAsset, set: AssetSet, version: string, extension: string | undefined): string {
  const { platform, php } = set;
  if (platform === undefined) throw new Error(`buildPlatformAsset needs a platform set, which platformAssets gives only for one`);
  if (item.kind === 'wheel-abi3') return abi3Wheel(build, item, expected, platform);
  if (item.kind === 'php-ext') {
    if (php === undefined || extension === undefined) throw new Error('a php-ext asset needs the PHP minor of its set and its extension name, which platformAssets reads');
    return phpExtension(build, item, extension, { platform, php }, version);
  }
  if (item.kind === 'npm-native') return npmPlatform(build, item, platform, version);
  return goStatic(build, item, expected.label);
}

/** Whether the set `set` builds on this machine: a platform set needs its own platform, since no tool cross-compiles here. */
export function requireHost(set: AssetSet): void {
  if (set.platform === undefined) return;
  const host = hostPlatform();
  if (host !== set.platform) throw new Stop(`${setName(set)} builds on ${set.platform} only, and this machine is ${host ?? `${process.platform}-${process.arch}, no platform of the release`}; run it on a runner of ${set.platform}`);
}
