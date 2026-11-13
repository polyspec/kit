// Tests of the per-platform assets of a release (K1189): the configuration of the native kinds, the asset sets and their matrix,
// the set without a platform with the root package of an npm-native package and the php-ext entry of packages.json, the set of
// the platform of this machine, the set of a PHP minor, and publish, which gathers the assets of every set. Each case works in a
// committed copy of the fixture (release-sandbox.mts) with the stubs of cargo, php and the napi CLI (native-stubs.mts), which
// write files of the form the real tools write; no library is compiled and no case reaches GitHub or a registry.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { Stop } from '../../scripts/kit/process.mts';
import * as release from '../../scripts/kit/release.mts';
import { assetSets, hostPlatform, isPlatform, namedSet, pieName, platformAssets, PLATFORM_NAMES, type AssetSet, type Platform } from '../../scripts/kit/release-native.mts';
import { readJson, releaseSandbox, writeJson } from './release-sandbox.mts';
import { writeNativeStubs } from './native-stubs.mts';
import { KIT_MAKE } from './kit-tools.mts';
import { parse as parseYaml } from 'yaml';
import { parseStub, readStubLines, TEXTS } from './stub-json.mts';
import type { JSONSchemaType } from 'ajv/dist/2020.js';

const REPOSITORY = 'example/kit-fixture';
const STRING = { type: 'string' } as const;
const NULLABLE = { type: 'string', nullable: true } as const;
/** A call of a native stub: the tool, its arguments, its directory and the variables of the build that it saw. */
type NativeCall = { tool: string; args: string[]; cwd: string; env: { CARGO_TARGET_DIR?: string | null; PHP?: string | null; PHP_CONFIG?: string | null; MATURIN_PEP517_ARGS?: string | null } };
const NATIVE_CALL: JSONSchemaType<NativeCall> = {
  type: 'object',
  required: ['tool', 'args', 'cwd', 'env'],
  properties: { tool: STRING, args: TEXTS, cwd: STRING, env: { type: 'object', required: [], properties: { CARGO_TARGET_DIR: NULLABLE, PHP: NULLABLE, PHP_CONFIG: NULLABLE, MATURIN_PEP517_ARGS: NULLABLE } } },
};
/** packages.json in the fields of the php-ext entry that the cases read. */
type Repository = { packages: Record<string, Record<string, { version: string; dist: { type: string; url: string } }>> };
const REPOSITORY_JSON: JSONSchemaType<Repository> = {
  type: 'object',
  required: ['packages'],
  properties: { packages: { type: 'object', required: [], additionalProperties: { type: 'object', required: [], additionalProperties: { type: 'object', required: ['version', 'dist'], properties: { version: STRING, dist: { type: 'object', required: ['type', 'url'], properties: { type: STRING, url: STRING } } } } } } },
};
/** The fields of workflows/release.yml that the case of the workflow reads. */
type Step = { if?: string; uses?: string; run?: string; with?: { path?: string; 'merge-multiple'?: boolean } };
type Job = { 'runs-on': string; env?: Record<string, string>; outputs?: Record<string, string>; strategy?: { matrix: string }; steps: Step[] };
const TEXT_MAP = { type: 'object', nullable: true, required: [], additionalProperties: STRING } as const;
const JOB: JSONSchemaType<Job> = {
  type: 'object',
  required: ['runs-on', 'steps'],
  properties: {
    'runs-on': STRING,
    env: TEXT_MAP,
    outputs: TEXT_MAP,
    strategy: { type: 'object', nullable: true, required: ['matrix'], properties: { matrix: STRING } },
    steps: { type: 'array', items: { type: 'object', required: [], properties: { if: { ...STRING, nullable: true }, uses: { ...STRING, nullable: true }, run: { ...STRING, nullable: true }, with: { type: 'object', nullable: true, required: [], properties: { path: { ...STRING, nullable: true }, 'merge-multiple': { type: 'boolean', nullable: true } } } } } },
  },
};
const WORKFLOW: JSONSchemaType<{ jobs: Record<string, Job> }> = { type: 'object', required: ['jobs'], properties: { jobs: { type: 'object', required: [], additionalProperties: JOB } } };
const NAMED: JSONSchemaType<{ name: string }> = { type: 'object', required: ['name'], properties: { name: STRING } };
/** A package.json of the root package of an npm-native package, in the fields that the case of K1200 compares. */
type Packed = { name: string; version: string; main: string; napi: { binaryName: string; targets: string[] }; optionalDependencies: Record<string, string> };
const PACKED: JSONSchemaType<Packed> = {
  type: 'object',
  required: ['name', 'version', 'main', 'napi', 'optionalDependencies'],
  additionalProperties: false,
  properties: { name: STRING, version: STRING, main: STRING, napi: { type: 'object', required: ['binaryName', 'targets'], additionalProperties: false, properties: { binaryName: STRING, targets: TEXTS } }, optionalDependencies: { type: 'object', required: [], additionalProperties: STRING } },
};
const VERSION = '0.0.1';
// The platforms of the release, typed.
const ALL: Platform[] = PLATFORM_NAMES.filter(isPlatform);
const TRIPLES: Record<Platform, string> = { 'linux-x64-gnu': 'x86_64-unknown-linux-gnu', 'linux-arm64-gnu': 'aarch64-unknown-linux-gnu', 'darwin-arm64': 'aarch64-apple-darwin' };
// The platform tags that maturin writes on each platform, as STUB_WHEEL_TAGS gives them to the uv stub.
const WHEEL_TAGS: Record<Platform, string> = { 'linux-x64-gnu': 'cp39-abi3-manylinux_2_17_x86_64.manylinux2014_x86_64', 'linux-arm64-gnu': 'cp39-abi3-manylinux_2_17_aarch64.manylinux2014_aarch64', 'darwin-arm64': 'cp39-abi3-macosx_11_0_arm64' };

// The native packages that the cases add to the fixture: one of each kind, each built for every platform of the release.
const NATIVE_PACKAGES: release.ReleasePackage[] = [
  { kind: 'wheel-abi3', directory: 'packages/fixture-native-py', name: 'kit-fixture-native', product: 'kit-fixture-native', runtime: 'python', platforms: [...PLATFORM_NAMES] },
  { kind: 'php-ext', directory: 'packages/fixture-native-php', name: 'polyspec/kit-fixture-ext', product: 'kit-fixture-ext', runtime: 'php-ext', platforms: [...PLATFORM_NAMES], php: ['8.4', '8.5'] },
  { kind: 'npm-native', directory: 'packages/fixture-native-js', name: '@polyspec/kit-fixture-native', product: 'kit-fixture-native', runtime: 'ts', platforms: [...PLATFORM_NAMES] },
  { kind: 'go-static', directory: 'packages/fixture-native-go', name: 'fixture-native-go', product: 'kit-fixture-native', runtime: 'go', platforms: [...PLATFORM_NAMES] },
];

const cargo = (name: string, type: string) => `[package]\nname = "${name}"\nversion = "${VERSION}"\nedition = "2024"\npublish = false\n\n[lib]\ncrate-type = ["${type}"]\n`;
// The source manifest names no platform package: the release writes them into the manifest that it packs (K1200), since npm ci
// refuses a dependency that the lock of the workspace lacks.
const nativeManifest = () => ({
  name: '@polyspec/kit-fixture-native',
  version: VERSION,
  main: 'index.js',
  napi: { binaryName: 'kit-fixture-native', targets: ALL.map(platform => TRIPLES[platform]) },
  optionalDependencies: { 'kit-fixture-optional': '1.0.0' },
});

/** The fixture with the native packages, their manifests and the native stubs; `change` edits the files before the commit. */
function nativeSandbox(t: TestContext, change: (root: string) => void = () => {}) {
  const box = releaseSandbox(t, {
    mutate: (root) => {
      const write = (file: string, text: string) => {
        mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
        writeFileSync(path.join(root, file), text);
      };
      write('packages/fixture-native-py/pyproject.toml', `[project]\nname = "kit-fixture-native"\nversion = "${VERSION}"\n\n[build-system]\nrequires = ["maturin>=1.9,<2"]\nbuild-backend = "maturin"\n`);
      write('packages/fixture-native-py/Cargo.toml', cargo('fixture-native-py', 'cdylib'));
      write('packages/fixture-native-php/composer.json', '');
      writeJson(root, 'packages/fixture-native-php/composer.json', { name: 'polyspec/kit-fixture-ext', type: 'php-ext', 'php-ext': { 'extension-name': 'kit_fixture', 'download-url-method': ['pre-packaged-binary'] } });
      write('packages/fixture-native-php/Cargo.toml', cargo('fixture-native-php', 'cdylib'));
      write('packages/fixture-native-js/package.json', '');
      writeJson(root, 'packages/fixture-native-js/package.json', nativeManifest());
      write('packages/fixture-native-js/index.js', 'module.exports = {};\n');
      write('packages/fixture-native-js/Cargo.toml', cargo('fixture-native-js', 'cdylib'));
      write('packages/fixture-native-go/Cargo.toml', cargo('fixture-native-go', 'staticlib'));
      const config = readJson<release.ReleaseConfig>(root, 'config/release.json');
      const manifests = Object.fromEntries(NATIVE_PACKAGES.map(item => [path.posix.join(item.directory, { 'wheel-abi3': 'pyproject.toml', 'php-ext': 'composer.json', 'npm-native': 'package.json', 'go-static': 'Cargo.toml' }[item.kind as string] ?? ''), 'archive']));
      writeJson(root, 'config/release.json', { ...config, packages: [...config.packages, ...NATIVE_PACKAGES], manifests: { ...config.manifests, ...manifests } });
      change(root);
    },
  });
  writeNativeStubs(box.root);
  const nativeLog = path.join(box.root, '.stubs/native.log');
  writeFileSync(nativeLog, '');
  Object.assign(box.env, { STUB_NATIVE_LOG: nativeLog, STUB_PHP_MINOR: '8.4' });
  const calls = () => readStubLines(nativeLog, NATIVE_CALL);
  return { ...box, calls };
}

type NativeBox = ReturnType<typeof nativeSandbox>;
const context = (box: NativeBox, set: AssetSet, { assets, env = {} }: { assets?: string; env?: NodeJS.ProcessEnv } = {}) => release.context(box.root, { env: { ...box.env, GITHUB_REPOSITORY: REPOSITORY, ...env }, set, ...(assets === undefined ? {} : { assets }) });
const stop = (fn: () => unknown, pattern: RegExp) => assert.throws(fn, error => error instanceof Stop && pattern.test(error.message), String(pattern));
const entries = (zip: string) => spawnSync('unzip', ['-Z1', zip], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean);

/** The platform of this machine; the platform sets build on it alone. */
function host(): Platform {
  const platform = hostPlatform();
  assert.ok(platform !== undefined, `${process.platform}-${process.arch} is no platform of the release, so no platform set builds here`);
  return platform;
}

test('K1189: a native package names its platforms of the release, a php-ext package its PHP minors, and a package of the other kinds neither', (t) => {
  const cases: [string, (item: release.ReleasePackage) => release.ReleasePackage, RegExp][] = [
    ['packages/fixture-native-go', ({ platforms: _platforms, ...item }) => item, /the go-static package fixture-native-go needs platforms/],
    ['packages/fixture-native-php', ({ php: _php, ...item }) => item, /the php-ext package polyspec\/kit-fixture-ext needs php, the PHP minors X\.Y/],
    ['packages/fixture-native-js', item => ({ ...item, php: ['8.4'] }), /php belongs to a php-ext package, not to the npm-native package @polyspec\/kit-fixture-native/],
    ['packages/fixture-native-py', item => ({ ...item, platforms: ['darwin-arm64', 'darwin-arm64'] }), /kit-fixture-native lists a platform twice/],
    ['packages/fixture-lib', item => ({ ...item, platforms: ['darwin-arm64'] }), /the npm package fixture-lib is built once; platforms and php belong to wheel-abi3, php-ext, npm-native, go-static/],
  ];
  for (const [directory, edit, pattern] of cases) {
    const box = nativeSandbox(t, (root) => {
      const config = readJson<release.ReleaseConfig>(root, 'config/release.json');
      writeJson(root, 'config/release.json', { ...config, packages: config.packages.map(item => (item.directory === directory ? edit(item) : item)) });
    });
    stop(() => release.loadConfig(box.root), pattern);
  }
  const box = nativeSandbox(t, (root) => {
    const config = readJson<release.ReleaseConfig>(root, 'config/release.json');
    writeJson(root, 'config/release.json', { ...config, packages: config.packages.map(item => (item.kind === 'go-static' ? { ...item, platforms: ['windows-x64'] } : item)) });
  });
  stop(() => release.loadConfig(box.root), /platforms/);
});

test('K1189: the sets are the set without a platform, the set of each platform and the set of each platform and PHP minor, and sets prints them as the matrix of the workflow', (t) => {
  const box = nativeSandbox(t);
  const config = release.loadConfig(box.root);
  // Each set names the runner of its platform, which builds it; the set without a platform builds on the x64 runner (K1211).
  const RUNNERS: Record<string, string> = { 'linux-x64-gnu': 'ubuntu-24.04', 'linux-arm64-gnu': 'ubuntu-24.04-arm', 'darwin-arm64': 'macos-15' };
  const expected = [{ platform: '', php: '', runner: 'ubuntu-24.04' }, ...PLATFORM_NAMES.flatMap(platform => [{ platform, php: '', runner: RUNNERS[platform] }, { platform, php: '8.4', runner: RUNNERS[platform] }, { platform, php: '8.5', runner: RUNNERS[platform] }])];
  assert.deepEqual(release.matrix(config), { include: expected });
  const output = path.join(box.root, '.stubs/github-output');
  const printed: string[] = [];
  assert.equal(release.main(['sets'], { root: box.root, env: { ...box.env, GITHUB_OUTPUT: output }, print: line => printed.push(line), error: line => printed.push(line) }), 0, printed.join('\n'));
  assert.deepEqual(printed, [JSON.stringify({ include: expected })]);
  assert.equal(readFileSync(output, 'utf8'), `sets=${JSON.stringify({ include: expected })}\nversion=${VERSION}\n`, 'the version is that of the change log (K1211)');
  // A configuration without a native package has the set without a platform alone.
  assert.deepEqual(assetSets(config.packages.filter(item => !NATIVE_PACKAGES.some(native => native.directory === item.directory))), [{}]);
  // RELEASE_PLATFORM and RELEASE_PHP name a set; a PHP minor without a platform, and a platform that is not one, are refused.
  assert.deepEqual(namedSet('darwin-arm64', '8.4'), { platform: 'darwin-arm64', php: '8.4' });
  assert.deepEqual(namedSet('', ''), {});
  stop(() => namedSet(undefined, '8.4'), /RELEASE_PHP 8\.4 names a PHP minor without a platform/);
  stop(() => namedSet('windows-x64', undefined), /RELEASE_PLATFORM windows-x64 is not a platform of the release; the platforms are linux-x64-gnu, linux-arm64-gnu, darwin-arm64/);
});

test('K1189: each asset of a platform set has the name its tool gives and the label <vendor>-<product>-<runtime>-<version>[-php<X.Y>]-<platform>', (t) => {
  const box = nativeSandbox(t);
  const config = release.loadConfig(box.root);
  const index = (kind: string) => config.packages.findIndex(item => item.kind === kind);
  const extensions = { [index('php-ext')]: 'kit_fixture' };
  const assets = (set: AssetSet) => platformAssets(config.packages, config.repositoryUrl, VERSION, set, extensions);
  // A name that the tool chooses is matched by its pattern: the wheel by the platform tags of its platform alone.
  const name = (set: AssetSet, file: string) => assets(set).find(item => (item.name === undefined ? item.pattern?.test(file) : item.name === file))?.label;
  assert.deepEqual(assets({ platform: 'linux-x64-gnu' }).map(item => item.label), ['polyspec-kit-fixture-native-python-0.0.1-linux-x64-gnu', 'polyspec-kit-fixture-native-ts-0.0.1-linux-x64-gnu', 'polyspec-kit-fixture-native-go-0.0.1-linux-x64-gnu']);
  assert.equal(name({ platform: 'linux-x64-gnu' }, `kit_fixture_native-0.0.1-${WHEEL_TAGS['linux-x64-gnu']}.whl`), 'polyspec-kit-fixture-native-python-0.0.1-linux-x64-gnu');
  assert.equal(name({ platform: 'linux-x64-gnu' }, `kit_fixture_native-0.0.1-${WHEEL_TAGS['linux-arm64-gnu']}.whl`), undefined, 'a wheel of another platform');
  assert.equal(name({ platform: 'linux-x64-gnu' }, 'kit_fixture_native-0.0.1-cp39-abi3-manylinux_2_17_x86_64.macosx_11_0_arm64.whl'), undefined, 'a wheel with a tag of another platform');
  assert.equal(name({ platform: 'linux-x64-gnu' }, 'kit_fixture_native-0.0.1-cp312-cp312-manylinux_2_17_x86_64.whl'), undefined, 'a wheel that is not abi3');
  assert.equal(name({ platform: 'linux-x64-gnu' }, 'polyspec-kit-fixture-native-linux-x64-gnu-0.0.1.tgz'), 'polyspec-kit-fixture-native-ts-0.0.1-linux-x64-gnu');
  assert.equal(name({ platform: 'linux-x64-gnu' }, 'polyspec-kit-fixture-native-go-0.0.1-linux-x64-gnu.zip'), 'polyspec-kit-fixture-native-go-0.0.1-linux-x64-gnu');
  assert.deepEqual(assets({ platform: 'darwin-arm64', php: '8.5' }).map(item => item.label), ['polyspec-kit-fixture-ext-php-ext-0.0.1-php8.5-darwin-arm64']);
  for (const file of ['php_kit_fixture-v0.0.1_php8.5-arm64-darwin-bsdlibc-nts.zip', 'php_kit_fixture-v0.0.1_php8.5-arm64-darwin-bsdlibc-debug-zts.zip']) assert.equal(name({ platform: 'darwin-arm64', php: '8.5' }, file), 'polyspec-kit-fixture-ext-php-ext-0.0.1-php8.5-darwin-arm64', file);
  assert.equal(name({ platform: 'darwin-arm64', php: '8.5' }, 'php_kit_fixture-v0.0.1_php8.4-arm64-darwin-bsdlibc-nts.zip'), undefined, 'a binary of another PHP minor');
  assert.equal(pieName('kit_fixture', VERSION, '8.4', 'linux-arm64-gnu'), 'php_kit_fixture-v0.0.1_php8.4-arm64-linux-glibc');
  assert.equal(pieName('kit_fixture', VERSION, '8.4', 'linux-x64-gnu'), 'php_kit_fixture-v0.0.1_php8.4-x86_64-linux-glibc');
});

test('K1189: the set without a platform packs the root package of an npm-native package and lists a php-ext package in packages.json at the tag', (t) => {
  const box = nativeSandbox(t);
  const tag = box.tag(`v${VERSION}`);
  const names = release.assets(context(box, {}), tag);
  assert.deepEqual(names, ['fixture-lib-0.0.1.tgz', 'fixture-app-0.0.1.tgz', 'polyspec-kit-fixture-php-0.0.1.zip', 'kit_fixture-0.0.1-py3-none-any.whl', 'polyspec-kit-fixture-native-0.0.1.tgz', 'packages.json']);
  // The root package is packed from a copy of the tagged tree with no script of the package, never from the checkout.
  const root = box.npmCalls().find(call => call.cwd.endsWith('packages/fixture-native-js'));
  assert.ok(root !== undefined, JSON.stringify(box.npmCalls()));
  assert.ok(!root.cwd.startsWith(box.root), root.cwd);
  assert.ok(root.args.includes('--ignore-scripts'), root.args.join(' '));
  assert.deepEqual(box.calls(), [], 'the set without a platform compiles nothing');
  const repository = parseStub(readFileSync(path.join(box.root, 'var/release/assets/packages.json'), 'utf8'), REPOSITORY_JSON, 'packages.json');
  assert.deepEqual(Object.keys(repository.packages['polyspec/kit-fixture-ext'] ?? {}), ['v0.0.1']);
  assert.deepEqual(repository.packages['polyspec/kit-fixture-ext']?.['v0.0.1']?.dist, { type: 'zip', url: 'https://api.github.com/repos/polyspec/kit-fixture/zipball/v0.0.1' });
  assert.equal(repository.packages['polyspec/kit-fixture-ext']?.['v0.0.1']?.version, 'v0.0.1');
});

test('K1189: the root package of an npm-native package names the triples of its platforms in napi.targets', (t) => {
  const targets = nativeSandbox(t, root => writeJson(root, 'packages/fixture-native-js/package.json', { ...nativeManifest(), napi: { binaryName: 'kit-fixture-native', targets: ['aarch64-apple-darwin'] } }));
  stop(() => release.assets(context(targets, {}), targets.tag(`v${VERSION}`)), /napi\.targets \[aarch64-apple-darwin\] are not the triples of its platforms \[x86_64-unknown-linux-gnu, aarch64-unknown-linux-gnu, aarch64-apple-darwin\]/);
});

// K1196: every set checks the manifest of every native package before it builds anything, whichever set builds that package.
const { napi: _napi, ...withoutNapi } = nativeManifest();

test('K1196: a platform set refuses an npm-native package without its napi configuration with the message of kit, before any tool builds', (t) => {
  const platform = host();
  const box = nativeSandbox(t, root => writeJson(root, 'packages/fixture-native-js/package.json', withoutNapi));
  stop(() => release.assets(context(box, { platform }, { env: { STUB_WHEEL_TAGS: WHEEL_TAGS[platform] } }), box.tag(`v${VERSION}`)), /packages\/fixture-native-js\/package\.json names no napi\.binaryName/);
  assert.deepEqual(box.calls(), [], 'neither cargo nor the napi CLI ran');
  assert.deepEqual(box.pipCalls().filter(call => call.args[0] === 'build'), [], 'uv built no wheel');
});

test('K1196: a set names the problems of a php-ext and of an npm-native manifest together, also when it builds neither package', (t) => {
  const box = nativeSandbox(t, (root) => {
    writeJson(root, 'packages/fixture-native-js/package.json', withoutNapi);
    writeJson(root, 'packages/fixture-native-php/composer.json', { name: 'polyspec/kit-fixture-ext', type: 'php-ext', 'php-ext': { 'extension-name': 'kit_fixture' } });
  });
  const tag = box.tag(`v${VERSION}`);
  for (const set of [{}, { platform: host() }]) {
    stop(() => release.assets(context(box, set, { env: { STUB_WHEEL_TAGS: WHEEL_TAGS[host()] } }), tag), /(?=[\s\S]*packages\/fixture-native-php\/composer\.json lists no pre-packaged-binary in php-ext\.download-url-method)(?=[\s\S]*packages\/fixture-native-js\/package\.json names no napi\.binaryName)/);
  }
  assert.deepEqual(box.calls(), [], 'no tool built');
});

// K1200: the source manifest of an npm-native package names no platform package, and the packed root package names each one at the
// version of the release beside the optional dependencies of the source.
test('K1200: the set without a platform writes the platform packages into the optionalDependencies of the packed root package alone', (t) => {
  const box = nativeSandbox(t);
  const tag = box.tag(`v${VERSION}`);
  release.assets(context(box, {}), tag);
  const read = (text: string) => parseStub(text, PACKED, 'a package.json of the root package');
  const packed = read(spawnSync('tar', ['-xzOf', path.join(box.root, 'var/release/assets/polyspec-kit-fixture-native-0.0.1.tgz'), 'package/package.json'], { encoding: 'utf8' }).stdout);
  assert.deepEqual(packed.optionalDependencies, { 'kit-fixture-optional': '1.0.0', ...Object.fromEntries(PLATFORM_NAMES.map(platform => [`@polyspec/kit-fixture-native-${platform}`, VERSION])) });
  const source = read(readFileSync(path.join(box.root, 'packages/fixture-native-js/package.json'), 'utf8'));
  assert.deepEqual({ ...packed, optionalDependencies: source.optionalDependencies }, source, 'the other fields are those of the source');
});

test('K1189: the set of the platform of this machine builds the abi3 wheel, the npm platform package and the Go static library with cargo in a copy of the tagged tree', (t) => {
  const platform = host();
  const box = nativeSandbox(t);
  const tag = box.tag(`v${VERSION}`);
  const names = release.assets(context(box, { platform }, { env: { STUB_WHEEL_TAGS: WHEEL_TAGS[platform] } }), tag);
  assert.deepEqual(names, [`kit_fixture_native-0.0.1-${WHEEL_TAGS[platform]}.whl`, `polyspec-kit-fixture-native-${platform}-0.0.1.tgz`, `polyspec-kit-fixture-native-go-0.0.1-${platform}.zip`]);
  const folder = path.join(box.root, 'var/release/assets');
  assert.deepEqual(readdirSync(folder).sort(), [...names].sort(), 'the set holds its own assets alone');
  const calls = box.calls();
  // Every native build reads the copy of the tagged tree and writes into the target folder of the run, both outside the checkout.
  for (const call of calls) {
    assert.ok(!call.cwd.startsWith(box.root), `${call.tool} ran in the checkout`);
    // llvm-strip builds nothing: it changes the copy of the library in the work folder of the run (K1208).
    if (call.tool === 'llvm-strip') continue;
    const target = call.env.CARGO_TARGET_DIR;
    assert.ok(typeof target === 'string' && !target.startsWith(box.root), `${call.tool} wrote into ${call.env.CARGO_TARGET_DIR ?? 'no target folder'}`);
  }
  assert.deepEqual(calls.filter(call => call.tool === 'cargo').map(call => call.args), [['build', '--release', '--locked', '-p', 'fixture-native-go', '--message-format=json-render-diagnostics']]);
  const napi = calls.filter(call => call.tool === 'napi');
  assert.deepEqual(napi.map(call => call.args[0]), ['build', 'create-npm-dirs', 'artifacts']);
  assert.deepEqual(napi[0]?.args.slice(-4), ['--target', TRIPLES[platform], '--', '--locked']);
  // uv build runs the maturin of build-system.requires, which resolves from Cargo.lock alone.
  const uv = box.pipCalls().find(call => call.args[0] === 'build');
  assert.ok(uv !== undefined && uv.args.at(-1)?.endsWith('packages/fixture-native-py') && !uv.args.at(-1)?.startsWith(box.root), JSON.stringify(uv));
  assert.deepEqual(entries(path.join(folder, `polyspec-kit-fixture-native-go-0.0.1-${platform}.zip`)), ['libfixture_native_go.a']);
  const packed = spawnSync('tar', ['-xzOf', path.join(folder, `polyspec-kit-fixture-native-${platform}-0.0.1.tgz`), 'package/package.json'], { encoding: 'utf8' }).stdout;
  assert.equal(parseStub(packed, NAMED, 'the packed package.json').name, `@polyspec/kit-fixture-native-${platform}`);
  // A wheel of another platform is not an asset of this set.
  const other = ALL.find(name => name !== platform) ?? platform;
  stop(() => release.assets(context(box, { platform }, { env: { STUB_WHEEL_TAGS: WHEEL_TAGS[other] } }), tag), new RegExp(`not one abi3 wheel of kit-fixture-native for ${platform}`));
  // A platform package whose version napi did not take from the tag is refused.
  stop(() => release.assets(context(box, { platform }, { env: { STUB_WHEEL_TAGS: WHEEL_TAGS[platform], STUB_NAPI_VERSION: '0.0.0' } }), tag), /its version is 0\.0\.0, the tag is 0\.0\.1/);
});

// K1198: the napi CLI refuses an npm folder outside the package of its package.json, so the platform folders lie in the package of
// the copy of the tagged tree.
test('K1198: a platform set writes the folders of the npm platform packages into the package of the copy of the tagged tree', (t) => {
  const platform = host();
  const box = nativeSandbox(t);
  release.assets(context(box, { platform }, { env: { STUB_WHEEL_TAGS: WHEEL_TAGS[platform] } }), box.tag(`v${VERSION}`));
  for (const call of box.calls().filter(item => item.tool === 'napi' && item.args[0] !== 'build')) {
    const option = (name: string) => call.args[call.args.indexOf(name) + 1] ?? '';
    assert.equal(path.relative(path.dirname(option('--package-json-path')), option('--npm-dir')), path.join('.kit-napi', 'npm'), call.args.join(' '));
  }
});

// K1199: napi artifacts requires the addon of every configured target, and a platform set builds its own alone, so create-npm-dirs
// and artifacts read a configuration of the run that names the target of the set.
test('K1199: a platform set gives napi create-npm-dirs and napi artifacts a configuration with the target of its platform alone', (t) => {
  const platform = host();
  const box = nativeSandbox(t);
  release.assets(context(box, { platform }, { env: { STUB_WHEEL_TAGS: WHEEL_TAGS[platform] } }), box.tag(`v${VERSION}`));
  const calls = box.calls().filter(item => item.tool === 'napi' && item.args[0] !== 'build');
  assert.deepEqual(calls.map(call => call.args[0]), ['create-npm-dirs', 'artifacts']);
  for (const call of calls) assert.ok(call.args.includes('--config-path'), call.args.join(' '));
});

test('K1189: the set of a PHP minor builds the PIE binary of the php-ext package for the PHP of the checkout, which loads it, and refuses another minor', (t) => {
  const platform = host();
  const box = nativeSandbox(t);
  const tag = box.tag(`v${VERSION}`);
  const names = release.assets(context(box, { platform, php: '8.4' }), tag);
  const zip = `${pieName('kit_fixture', VERSION, '8.4', platform)}-nts.zip`;
  assert.deepEqual(names, [zip]);
  assert.deepEqual(entries(path.join(box.root, 'var/release/assets', zip)), ['kit_fixture.so']);
  const calls = box.calls();
  const build = calls.find(call => call.tool === 'cargo');
  assert.deepEqual(build?.args, ['build', '--release', '--locked', '-p', 'fixture-native-php', '--message-format=json-render-diagnostics']);
  assert.ok(build?.env.PHP?.endsWith('var/tools/bin/php') && build.env.PHP_CONFIG?.endsWith('var/tools/bin/php-config'), JSON.stringify(build?.env));
  assert.ok(calls.some(call => call.tool === 'php' && call.args.includes('-d') && call.args.some(arg => arg.startsWith('extension=') && arg.endsWith('kit_fixture.so'))), 'the binary is loaded before it is packed');
  stop(() => release.assets(context(box, { platform, php: '8.5' }), tag), /the php of the checkout is PHP 8\.4, and the set of .* and PHP 8\.5 builds for PHP 8\.5; set up PHP 8\.5 before the run/);
});

// K1203: PHP loads a binary whose module names another extension without a message, so the set names what the binary registered.
test('K1203: a php-ext set names the extension that the binary registered when PHP does not load it under its extension name', (t) => {
  const platform = host();
  const box = nativeSandbox(t);
  const tag = box.tag(`v${VERSION}`);
  stop(() => release.assets(context(box, { platform, php: '8.4' }, { env: { STUB_PHP_EXTENSION: 'fixture-native-php' } }), tag), /^.*PHP 8\.4 loads the binary that cargo built from packages\/fixture-native-php as the extension fixture-native-php, not as kit_fixture, the php-ext\.extension-name of its composer\.json/);
  assert.equal(existsSync(path.join(box.root, 'var/release/assets')), false, 'no binary is packed');
});

// K1208: the strip setting of a Cargo profile does not change a static library, so the set strips the debug sections itself.
test('K1208: a platform set strips the debug sections of the Go static library with llvm-strip of the toolchain before it packs it', (t) => {
  const platform = host();
  const box = nativeSandbox(t);
  release.assets(context(box, { platform }, { env: { STUB_WHEEL_TAGS: WHEEL_TAGS[platform] } }), box.tag(`v${VERSION}`));
  const strips = box.calls().filter(call => call.tool === 'llvm-strip');
  assert.equal(strips.length, 1, 'one library, the one of the go-static package');
  assert.deepEqual(strips[0]?.args.slice(0, 1), ['--strip-debug']);
  assert.match(strips[0]?.args[1] ?? '', /go-static\/packages\/fixture-native-go\/lib[\w-]+\.a$/, 'the copy that the zip holds, not the file of the target folder');
  // Without the component the set names it and packs no library.
  const bare = nativeSandbox(t);
  rmSync(path.join(bare.root, '.stubs/sysroot'), { recursive: true });
  stop(() => release.assets(context(bare, { platform }, { env: { STUB_WHEEL_TAGS: WHEEL_TAGS[platform] } }), bare.tag(`v${VERSION}`)), /llvm-strip is missing; name the component llvm-tools in rust-toolchain\.toml and run make install-tools/);
});

test('K1189: a platform set builds on its own platform alone, and a set that no package builds is refused', (t) => {
  const platform = host();
  const box = nativeSandbox(t);
  const tag = box.tag(`v${VERSION}`);
  const other = ALL.find(name => name !== platform) ?? platform;
  stop(() => release.assets(context(box, { platform: other }), tag), new RegExp(`the set of ${other} builds on ${other} only, and this machine is ${platform}; run it on a runner of ${other}`));
  assert.deepEqual(box.calls(), [], 'nothing is built for another platform');
  const lone = nativeSandbox(t, (root) => {
    const config = readJson<release.ReleaseConfig>(root, 'config/release.json');
    writeJson(root, 'config/release.json', { ...config, packages: config.packages.map(item => (item.kind === 'php-ext' ? item : item.platforms ? { ...item, platforms: [other] } : item)) });
    // The npm-native manifest names the one platform of its package, as every set checks it (K1196).
    writeJson(root, 'packages/fixture-native-js/package.json', { ...nativeManifest(), napi: { binaryName: 'kit-fixture-native', targets: [TRIPLES[other]] } });
  });
  stop(() => release.assets(context(lone, { platform }), lone.tag(`v${VERSION}`)), new RegExp(`no package of config/release\\.json builds the set of ${platform}; the sets are`));
});

test('K1189: publish uploads the assets of every set with their labels and refuses a missing asset and a file that is no asset', (t) => {
  const platform = host();
  const box = nativeSandbox(t);
  const tag = box.tag(`v${VERSION}`);
  const gathered = mkdtempSync(path.join(tmpdir(), 'kit-release-gathered-'));
  t.after(() => rmSync(gathered, { recursive: true, force: true }));
  // Each set builds into a folder of its own, as each job of the matrix does, and the workflow gathers them into one.
  const sets: AssetSet[] = [{}, { platform }, { platform, php: '8.4' }];
  for (const [position, set] of sets.entries()) {
    const folder = path.join(box.root, `var/release/set-${position}`);
    for (const name of release.assets(context(box, set, { assets: folder, env: set.platform === undefined ? {} : { STUB_WHEEL_TAGS: WHEEL_TAGS[platform] } }), tag)) copyFileSync(path.join(folder, name), path.join(gathered, name));
  }
  // The assets of the other platforms and of PHP 8.5, whose runners build them, are files of the names their tools give.
  const others = ALL.filter(name => name !== platform);
  const foreign = [
    ...others.flatMap(name => [`kit_fixture_native-0.0.1-${WHEEL_TAGS[name]}.whl`, `polyspec-kit-fixture-native-${name}-0.0.1.tgz`, `polyspec-kit-fixture-native-go-0.0.1-${name}.zip`, `${pieName('kit_fixture', VERSION, '8.4', name)}-nts.zip`]),
    ...ALL.map(name => `${pieName('kit_fixture', VERSION, '8.5', name)}-nts.zip`),
  ];
  for (const name of foreign) writeFileSync(path.join(gathered, name), name);
  box.ghState();
  box.releases([]);
  const names = release.publish(context(box, {}, { assets: gathered }), tag);
  assert.equal(names.length, readdirSync(gathered).length, 'every file of the folder is published');
  const uploads = box.state().uploads ?? [];
  const label = (name: string) => uploads.find(upload => upload.name === name)?.label;
  assert.equal(label(`kit_fixture_native-0.0.1-${WHEEL_TAGS[platform]}.whl`), `polyspec-kit-fixture-native-python-0.0.1-${platform}`);
  assert.equal(label(`${pieName('kit_fixture', VERSION, '8.5', 'linux-x64-gnu')}-nts.zip`), 'polyspec-kit-fixture-ext-php-ext-0.0.1-php8.5-linux-x64-gnu');
  assert.equal(label('polyspec-kit-fixture-native-0.0.1.tgz'), 'polyspec-kit-fixture-native-ts-0.0.1');
  assert.equal(label('packages.json'), null, 'packages.json is a file of the release, not a package');
  const missing = `polyspec-kit-fixture-native-go-0.0.1-${others[0] ?? ''}.zip`;
  rmSync(path.join(gathered, missing));
  stop(() => release.publish(context(box, {}, { assets: gathered }), tag), new RegExp(`no file is the asset ${missing.replace(/\./g, '\\.')} \\(polyspec-kit-fixture-native-go-0\\.0\\.1-${others[0] ?? ''}\\)`));
  writeFileSync(path.join(gathered, missing), missing);
  writeFileSync(path.join(gathered, 'stray.txt'), 'stray');
  stop(() => release.publish(context(box, {}, { assets: gathered }), tag), /\[stray\.txt\] is no asset of the release/);
});

test('K1189: make release-sets prints the matrix, and make release-assets builds the set that RELEASE_PLATFORM and RELEASE_PHP name', (t) => {
  const platform = host();
  const box = nativeSandbox(t);
  box.release(VERSION);
  const make = (...args: string[]) => spawnSync('make', [...KIT_MAKE, ...args], { cwd: box.root, env: { ...box.env, GITHUB_REPOSITORY: REPOSITORY, STUB_WHEEL_TAGS: WHEEL_TAGS[platform] }, encoding: 'utf8' });
  let result = make('release-sets');
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.ok(result.stdout.includes(JSON.stringify(release.matrix(release.loadConfig(box.root)))), result.stdout);
  result = make('release-assets', `TAG=v${VERSION}`, `RELEASE_PLATFORM=${platform}`, 'RELEASE_PHP=8.4');
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, new RegExp(`built the set of ${platform} and PHP 8\\.4: php_kit_fixture-v0\\.0\\.1_php8\\.4-[a-z0-9_-]+-nts\\.zip in var/release/assets`));
  result = make('release-assets', `TAG=v${VERSION}`, 'RELEASE_PHP=8.4');
  assert.notEqual(result.status, 0);
  assert.match(result.stdout + result.stderr, /RELEASE_PHP 8\.4 names a PHP minor without a platform; name the platform in RELEASE_PLATFORM/);
});

// The example release workflow (workflows/release.yml) builds each set of release-sets in a job of a matrix on a runner of its
// platform, and the job publish gathers the artifacts of every set before release-publish (K1189).
// K1211: a repository proves the assets of every platform before a release, in a workflow that its CI calls.
test('K1211: the example candidate workflow lists the sets and builds the candidate assets of each set on the runner of its platform', () => {
  const text = readFileSync(path.join(import.meta.dirname, '../../workflows/release-candidate.yml'), 'utf8');
  assert.match(text, /^on:\n {2}workflow_call:$/m, 'the CI of the repository calls it');
  const workflow = parseStub(JSON.stringify(parseYaml(text)), WORKFLOW, 'workflows/release-candidate.yml');
  assert.deepEqual(Object.keys(workflow.jobs), ['sets', 'candidate']);
  const { sets, candidate } = workflow.jobs as Record<'sets' | 'candidate', Job>;
  const runs = (job: Job) => job.steps.flatMap(step => (step.run === undefined ? [] : [step.run]));
  assert.deepEqual(runs(sets), ['make release-sets']);
  assert.deepEqual(sets.outputs, { sets: '${{ steps.sets.outputs.sets }}', version: '${{ steps.sets.outputs.version }}' });
  assert.equal(candidate.strategy?.matrix, '${{ fromJson(needs.sets.outputs.sets) }}');
  assert.equal(candidate['runs-on'], '${{ matrix.runner }}');
  assert.deepEqual({ platform: candidate.env?.RELEASE_PLATFORM, php: candidate.env?.RELEASE_PHP, version: candidate.env?.VERSION }, { platform: '${{ matrix.platform }}', php: '${{ matrix.php }}', version: '${{ needs.sets.outputs.version }}' });
  assert.deepEqual(runs(candidate).filter(line => line.startsWith('make ')), ['make release-prepare', 'make release-tools', 'make release-tools-path', 'make release-candidate-assets']);
  assert.match(text, /^ {6}fail-fast: false$/m, 'every set is built to its end');
  for (const step of Object.values(workflow.jobs).flatMap(job => job.steps)) if (step.uses && !step.uses.startsWith('./')) assert.match(step.uses, /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/, step.uses);
  // The recipe gives the set to the tool.
  const recipe = readFileSync(path.join(import.meta.dirname, '../../scripts/kit/kit.mk'), 'utf8');
  assert.match(recipe, /RELEASE_PLATFORM="\$\(RELEASE_PLATFORM\)" RELEASE_PHP="\$\(RELEASE_PHP\)" RELEASE_ASSETS="\$\(RELEASE_ASSETS\)" \$\(ONLINE\) \$\(NODE\) \$\(KIT\)\/release\.\$\(KIT_EXT\) candidate-assets/);
});

test('K1189: the example release workflow tags, builds each asset set on a runner of its platform and publishes the assets of every set', () => {
  const text = readFileSync(path.join(import.meta.dirname, '../../workflows/release.yml'), 'utf8');
  const workflow = parseStub(JSON.stringify(parseYaml(text)), WORKFLOW, 'workflows/release.yml');
  assert.deepEqual(Object.keys(workflow.jobs), ['tag', 'assets', 'publish']);
  const { tag, assets, publish } = workflow.jobs as Record<'tag' | 'assets' | 'publish', Job>;
  const runs = (job: Job) => job.steps.flatMap(step => (step.run === undefined ? [] : [step.run]));
  assert.deepEqual(runs(tag).filter(line => line.startsWith('make ')).map(line => line.split(' ')[1]), ['release-tag', 'release-sets']);
  assert.deepEqual(tag.outputs, { tag: '${{ steps.tag.outputs.tag }}', sets: '${{ steps.sets.outputs.sets }}' });
  assert.equal(assets.strategy?.matrix, '${{ fromJson(needs.tag.outputs.sets) }}');
  // linux-x64-gnu and the set without a platform build on ubuntu-24.04, the default of the expression.
  assert.equal(assets['runs-on'], '${{ matrix.runner }}', 'the runner of the set, which release sets names (K1211)');
  assert.deepEqual(PLATFORM_NAMES, ['linux-x64-gnu', 'linux-arm64-gnu', 'darwin-arm64'], 'each platform of the release has its runner in the expression');
  assert.deepEqual({ platform: assets.env?.RELEASE_PLATFORM, php: assets.env?.RELEASE_PHP }, { platform: '${{ matrix.platform }}', php: '${{ matrix.php }}' });
  assert.deepEqual(runs(assets).filter(line => line.startsWith('make ')), ['make release-prepare', 'make release-tools', 'make release-tools-path', 'make release-assets']);
  assert.ok(assets.steps.some(step => step.uses?.startsWith('actions/upload-artifact@') && step.with?.path === 'var/release/assets/'), 'each set uploads its assets');
  assert.match(text, /^ {2}publish:\n {4}needs: \[tag, assets\]$/m, 'publish waits for the jobs of every set');
  assert.ok(publish.steps.some(step => step.uses?.startsWith('actions/download-artifact@') && step.with?.path === 'var/release/assets' && step.with['merge-multiple'] === true), 'publish gathers every set into one folder');
  // The job publish makes no commit and no tag of a Go module (K1220).
  assert.deepEqual(runs(publish), ['make release-publish', 'make release-undraft TAG="$TAG"']);
  // Every action of another repository is pinned by its commit.
  for (const step of Object.values(workflow.jobs).flatMap(job => job.steps)) if (step.uses && !step.uses.startsWith('./')) assert.match(step.uses, /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/, step.uses);
});
