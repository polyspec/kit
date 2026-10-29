// Tests of the release proof (scripts/kit/release-proof.mts): each step of the proof has a case that passes and a case that
// fails with the expected and the actual value. The sandbox stubs gh, npm, Composer, Python, cargo and go on PATH
// (release-consumer-sandbox.mts); git runs for real against the sandbox, which stands in for the remote of the repository URL.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import * as release from '../../scripts/kit/release.mts';
import { Stop } from '../../scripts/kit/process.mts';
import * as proof from '../../scripts/kit/release-proof.mts';
import { git, readJson, writeJson } from './release-sandbox.mts';
import type { ComposerManifest } from '../../scripts/kit/manifests.mts';
import { consumerSandbox } from './release-consumer-sandbox.mts';
import { GENERATOR_WHEEL, SIBLING_WHEEL, generatorRequires, siblingLine, siblingMutate } from './sibling-sandbox.mts';
import { KIT_MAKE } from './kit-tools.mts';
import { known } from './known.mts';
type Box = ReturnType<typeof consumerSandbox>;
/** A command that a stub of the sandbox recorded. */
type Call = { args: string[] };
const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const stop = (fn: () => unknown, pattern: RegExp) => assert.throws(fn, error => error instanceof Stop && pattern.test(error.message), String(pattern));
const REMOTE = 'example.com/polyspec/kit-fixture';
const URL = `https://${REMOTE}`;

/** A sandbox whose consumer projects are locked, as the commit of a release holds them. */
function locked(t: TestContext, options?: { mutate?: (root: string) => void }) {
  const box = consumerSandbox(t, options);
  box.lock();
  return box;
}
const installs = (box: Box) => box.calls('npm').filter((call: Call) => call.args[0] === 'ci');
const prove = (box: Box, tag: string = box.released) => {
  const steps: string[] = [];
  proof.prove(box.ctx(), tag, text => steps.push(text));
  return steps;
};

test('the proof reads the draft by the id that publish recorded, also while the list of releases does not show it yet (K79)', (t) => {
  const box = locked(t);
  box.stub({ release: { ...box.state().release, listed: false } });
  assert.equal(prove(box)[0], 'the draft release v0.0.1 lists exactly its 4 archives');
  rmSync(path.join(box.root, 'var/release/v0.0.1.json'));
  stop(() => prove(box), /var\/release\/v0\.0\.1\.json is missing; make release-publish writes it/);
});

test('a released tag is proven in four steps and each step runs the commands of the configuration', (t) => {
  const box = locked(t);
  assert.deepEqual(prove(box), [
    'the draft release v0.0.1 lists exactly its 4 archives',
    'downloaded [fixture-app-npm-0.0.1.tgz, fixture-lib-npm-0.0.1.tgz, kit_fixture-0.0.1-py3-none-any.whl, polyspec-kit-fixture-php-0.0.1.zip] from the release v0.0.1',
    'kit_fixture-0.0.1-py3-none-any.whl: the sha256 of the downloaded file is the one the release lists',
    'npm ci of 2 packages from tests/release-consumer/npm',
    "npm fixture-lib 0.0.1: node -e require('fixture-lib/package.json')",
    "npm fixture-app 0.0.1: node -e require('fixture-app/package.json')",
    'composer install of 1 packages from tests/release-consumer/composer',
    "composer polyspec/kit-fixture 0.0.1: node -e require('./vendor/composer/installed.json')",
    'wheel dependencies uv pip install -r pylock.wheel.toml',
    'wheel pip install of 1 packages',
    'wheel pip check passed',
    'wheel kit-fixture 0.0.1: python -c import kit_fixture',
    'installed and checked 4 packages from the release assets',
    'packages/fixture-rust/Cargo.toml: cargo resolved kit-fixture-rust from v0.0.1 and cargo check passed',
    'the Go module example.com/kit-fixture-go resolves at packages/fixture-go/v0.0.1',
  ]);
  const [read, ...downloads] = box.calls('gh');
  assert.ok(read && downloads[0]);
  assert.deepEqual(read.args, ['api', '--hostname', 'example.com', 'repos/polyspec/kit-fixture/releases/7', '--jq', '{id, tag_name, draft, assets: [.assets[] | {id, name, url: .browser_download_url, digest}]}'], 'the draft is read by the id that publish recorded');
  assert.deepEqual(downloads.map((call: Call) => call.args.at(-1)), ['repos/polyspec/kit-fixture/releases/assets/1', 'repos/polyspec/kit-fixture/releases/assets/2', 'repos/polyspec/kit-fixture/releases/assets/3', 'repos/polyspec/kit-fixture/releases/assets/4']);
  assert.deepEqual(downloads[0].args.slice(0, 5), ['api', '--hostname', 'example.com', '-H', 'Accept: application/octet-stream']);
  const [venvCall] = box.calls('checkout-uv').filter((call: Call) => call.args[0] === 'venv');
  assert.ok(venvCall);
  assert.deepEqual(venvCall.args.slice(0, 4), ['venv', '--quiet', '--python', path.join(box.root, 'var/tools/mise/shims/python3')]);
  const venv = venvCall.args[4];
  assert.ok(venv !== undefined);
  assert.ok(box.calls('checkout-uv').some((call: Call) => call.args.join(' ') === `pip install --python ${path.join(venv, 'bin', 'python')} -r ${path.join(box.root, 'packages/fixture-python/pylock.wheel.toml')}`), 'uv installs the lock of the wheel natively first');
  const [install] = box.calls('checkout-python3').filter((call: Call) => call.args.includes('--require-hashes'));
  assert.ok(install);
  assert.ok(install.args.includes('--no-index'), 'the wheel itself is installed from its file, with no index');
  assert.ok(box.calls('checkout-python3').some((call: Call) => call.args.at(-1) === 'check'), 'pip check runs in the venv');
  const python = box.calls('python').at(-1);
  assert.ok(python);
  assert.deepEqual(python.args, ['-c', 'import kit_fixture']);
  assert.equal(python.env.VIRTUAL_ENV, venv, 'the smoke command runs in the virtual environment');
  assert.equal(box.calls('python3').length, 0, 'no python3 of PATH runs');
  const [cargo] = box.calls('cargo');
  assert.ok(cargo && typeof cargo.manifest === 'string');
  assert.deepEqual(cargo.args, ['check']);
  assert.match(cargo.manifest, new RegExp(`\\[dependencies\\]\\nkit-fixture-rust = \\{ git = "${URL}", tag = "v0\\.0\\.1" \\}\\n$`));
  assert.ok(path.relative(box.root, cargo.cwd).startsWith('..'), 'the temporary crate is outside the repository');
  const [go] = box.calls('go');
  assert.ok(go);
  assert.deepEqual(go.args, ['list', '-m', 'example.com/kit-fixture-go@v0.0.1']);
  assert.deepEqual([go.env.GOFLAGS, go.env.GOPROXY], ['-mod=mod', 'direct']);
});

test('the proof stops when the release lists other archives than the configuration declares', (t) => {
  const box = locked(t);
  box.stub({ release: { tag: 'v0.0.1', draft: true, names: box.names.slice(1).concat('extra.txt'), source: path.join(box.root, release.ASSETS) } });
  stop(() => prove(box), /the release v0\.0\.1 lists \[extra\.txt, fixture-app-npm-0\.0\.1\.tgz, kit_fixture-0\.0\.1-py3-none-any\.whl, polyspec-kit-fixture-php-0\.0\.1\.zip\], expected \[fixture-app-npm-0\.0\.1\.tgz, fixture-lib-npm-0\.0\.1\.tgz, kit_fixture-0\.0\.1-py3-none-any\.whl, polyspec-kit-fixture-php-0\.0\.1\.zip\]; missing \[fixture-lib-npm-0\.0\.1\.tgz\]; unexpected \[extra\.txt\]/);
  assert.equal(installs(box).length, 0, 'no install runs after a failed step');
  box.stub({ release: { tag: 'v0.0.1', draft: true, names: [], source: path.join(box.root, release.ASSETS) } });
  stop(() => prove(box), /the release v0\.0\.1 lists \[\], expected \[fixture-app-npm-0\.0\.1\.tgz/);
});

test('the proof fails when gh cannot read the release of the repository', (t) => {
  const box = locked(t);
  box.stub({ modes: { gh: 'fail' } });
  stop(() => prove(box), /gh api --hostname example\.com repos\/polyspec\/kit-fixture\/releases\/7 --jq .* exited with 1: gh stub: api failed/);
});

test('the proof fails when the downloaded archives do not install', (t) => {
  const box = locked(t);
  box.stub({ modes: { npm: 'fail' } });
  stop(() => prove(box), /npm ci .* exited with 1: npm stub: ci failed/);
  box.stub({ modes: { npm: '', composer: 'wrong-version' } });
  stop(() => prove(box), /composer installed polyspec\/kit-fixture 9\.9\.9, expected 0\.0\.1/);
});

test('the proof fails when the consumer projects of the checkout name other archives', (t) => {
  const box = locked(t);
  const lock = readJson<ComposerManifest>(box.root, 'tests/release-consumer/composer/composer.json');
  writeJson(box.root, 'tests/release-consumer/composer/composer.json', { ...lock, require: { 'polyspec/kit-fixture': '0.0.0' } });
  stop(() => prove(box), /require\.polyspec\/kit-fixture is "0\.0\.0", expected "0\.0\.1"/);
});

test('the proof fails when a smoke command of an archive fails', (t) => {
  const box = locked(t);
  const config = readJson<release.ReleaseConfig>(box.root, 'config/release.json');
  assert.ok(config.consumers?.npm);
  config.consumers.npm.smoke['fixture-lib'] = ['node', '-e', 'process.exit(3)'];
  writeJson(box.root, 'config/release.json', config);
  stop(() => prove(box), /node -e process\.exit\(3\) exited with 3/);
});

test('the proof fails when pip cannot install the tag, when the venv cannot be made and when the smoke command fails', (t) => {
  const box = locked(t);
  box.stub({ modes: { 'checkout-python3': 'pip-fail' } });
  stop(() => prove(box), /python3 -m pip --python \S+ install .*--require-hashes --no-deps .*-r .* exited with 1: pip stub: no matching distribution/);
  box.stub({ modes: { 'checkout-python3': '', python: 'smoke-fail' } });
  stop(() => prove(box), /python -c import kit_fixture exited with 1: python stub: ModuleNotFoundError/);
  box.stub({ modes: { 'checkout-uv': 'venv-fail', python: '' } });
  stop(() => prove(box), /uv venv --quiet --python .* ended with exit status 1/);
});

test('the proof fails when cargo cannot resolve the tag', (t) => {
  const box = locked(t);
  box.stub({ modes: { cargo: 'fail' } });
  stop(() => prove(box), /cargo check exited with 101: cargo stub: failed to find tag/);
});

test('the proof fails without a proof entry for a git-tag manifest', (t) => {
  const box = locked(t);
  const { proof: _, ...config } = readJson<release.ReleaseConfig>(box.root, 'config/release.json');
  writeJson(box.root, 'config/release.json', config);
  assert.equal(release.loadConfig(box.root).proof, undefined, 'the section is optional for the other release steps');
  stop(() => prove(box), /config\/release\.json proof\.gitTag lacks packages\/fixture-rust\/Cargo\.toml, which manifests releases by "git-tag"/);
});

test('the proof fails when the tag of a Go module is not on the remote', (t) => {
  const box = locked(t);
  git(box.root, 'tag', '-d', 'packages/fixture-go/v0.0.1');
  stop(() => prove(box), /the tag packages\/fixture-go\/v0\.0\.1 of the Go module example\.com\/kit-fixture-go is not on https:\/\/example\.com\/polyspec\/kit-fixture, git ls-remote lists \[\]/);
  assert.equal(box.calls('go').length, 0);
});

test('the proof fails when the Go tool does not resolve the module or resolves another version', (t) => {
  const box = locked(t);
  box.stub({ modes: { go: 'fail' } });
  stop(() => prove(box), /go list -m example\.com\/kit-fixture-go@v0\.0\.1 exited with 1: go stub: example\.com\/kit-fixture-go@v0\.0\.1: reading failed/);
  box.stub({ modes: { go: 'other' } });
  stop(() => prove(box), /go list -m example\.com\/kit-fixture-go@v0\.0\.1 printed "example\.com\/kit-fixture-go v9\.9\.9", expected "example\.com\/kit-fixture-go v0\.0\.1"/);
});

test('a Go module at the repository root is resolved at the tag of the release', (t) => {
  const box = locked(t);
  const config = readJson<release.ReleaseConfig>(box.root, 'config/release.json');
  writeJson(box.root, 'config/release.json', { ...config, goModules: { '.': 'example.com/kit-fixture-root' } });
  const steps = prove(box);
  assert.equal(steps.at(-1), 'the Go module example.com/kit-fixture-root resolves at v0.0.1');
});

test('the tag of a Go module is proven by the module alone and its release lists no archive', (t) => {
  const box = locked(t);
  box.stub({ release: { tag: 'packages/fixture-go/v0.0.1', draft: false, names: [], source: path.join(box.root, release.ASSETS) } });
  mkdirSync(path.join(box.root, 'var/release/packages/fixture-go'), { recursive: true });
  writeFileSync(path.join(box.root, 'var/release/packages/fixture-go/v0.0.1.json'), JSON.stringify({ id: 7 }));
  const steps = prove(box, 'packages/fixture-go/v0.0.1');
  assert.deepEqual(steps, [
    'the public release packages/fixture-go/v0.0.1 lists no archive',
    'packages/fixture-go/v0.0.1 is a Go module tag: the release holds no archive and no git-tag manifest',
    'the Go module example.com/kit-fixture-go resolves at packages/fixture-go/v0.0.1',
  ]);
  assert.deepEqual([installs(box).length, box.calls('python3').length, box.calls('cargo').length], [0, 0, 0]);
});

test('the proof removes its temporary directory and changes nothing in the checkout', (t) => {
  const box = locked(t);
  const before = git(box.root, 'status', '--porcelain', '--ignored');
  prove(box);
  assert.equal(git(box.root, 'status', '--porcelain', '--ignored'), before);
  const venv = box.calls('checkout-uv').find((call: Call) => call.args[0] === 'venv')?.args[4];
  assert.ok(venv !== undefined);
  const folder = path.dirname(path.dirname(venv));
  assert.match(path.basename(folder), /^kit-release-consumer-/);
  assert.equal(existsSync(folder), false);
});

test('the command line prints one line for each step and the exit status', (t) => {
  const box = locked(t);
  const lines: string[] = [];
  const errors: string[] = [];
  const run = (argv: string[]) => proof.main(argv, { root: box.root, env: box.env, print: line => lines.push(line), error: line => errors.push(line) });
  assert.equal(run(['v0.0.1']), 0);
  assert.ok(lines.every(line => line.startsWith('✔ ')), lines.join('\n'));
  assert.equal(lines.length, 16);
  assert.equal(lines.at(-1), '✔ v0.0.1 is proven from outside the repository');
  box.stub({ modes: { go: 'fail' } });
  assert.equal(run(['v0.0.1']), 1);
  // Each failed run wrote an error line; without one, assert.match fails on undefined as before.
  // The go that runs is the shim of the checkout (K393-1), so the message names its path before the command.
  assert.match(known(errors.at(-1), 'errors.at(-1)'), /^\[release-proof\] v0\.0\.1 failed: .*go list -m example\.com\/kit-fixture-go@v0\.0\.1 exited with 1/);
  assert.equal(run(['v0.0']), 1);
  // The refused tag wrote an error line, as above.
  assert.match(known(errors.at(-1), 'errors.at(-1)'), /v0\.0 failed: v0\.0: a release tag is vX\.Y\.Z/);
  for (const argv of [[], ['v0.0.1', 'x']]) assert.equal(run(argv), 2);
  assert.equal(errors.at(-1), 'usage: node scripts/kit/release-proof.mts TAG');
});

test('make release-proof takes the tag of the environment', (t) => {
  const box = locked(t);
  const make = (...args: string[]) => spawnSync('make', [...KIT_MAKE, ...args], { cwd: box.root, env: box.env, encoding: 'utf8' });
  const without = make('release-proof');
  assert.equal(without.status, 2);
  assert.match(without.stdout + without.stderr, /release-proof: TAG is required, for example make release-proof TAG=v0\.0\.1/);
  const result = make('release-proof', 'TAG=v0.0.1');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /✔ v0\.0\.1 is proven from outside the repository/);
});

test('the proof installs the wheels of a release together from their files', (t) => {
  const box = locked(t, { mutate: siblingMutate(generatorRequires(siblingLine())) });
  const steps = prove(box);
  assert.ok(steps.includes(`${GENERATOR_WHEEL}: the sha256 of the downloaded file is the one the release lists`), steps.join('\n'));
  // The install of the wheels reads their requirements file (-r); the dry runs that read the metadata of each wheel do not.
  const install = box.calls('checkout-python3').find((call: Call) => call.args.includes('--no-index') && call.args.includes('-r'));
  assert.ok(install && typeof install.requirements === 'string');
  assert.ok(install.args.includes('--no-deps'), 'the wheels install with no dependency resolution, so the sibling is never fetched from its URL');
  const files = install.requirements.split('\n').filter(Boolean).map((line: string) => {
    const [file] = line.split(' ');
    assert.ok(file !== undefined);
    return path.basename(file);
  });
  assert.deepEqual(files, [GENERATOR_WHEEL, SIBLING_WHEEL]);
});

test('the proof refuses a release that does not list the sibling of a wheel: the sibling is a wheel of the release', (t) => {
  const box = locked(t, { mutate: siblingMutate(generatorRequires(siblingLine())) });
  const state = box.state();
  const { published } = state.release;
  assert.ok(published);
  const { [SIBLING_WHEEL]: _sibling, ...rest } = published;
  box.stub({ release: { ...state.release, published: rest } });
  stop(() => prove(box), new RegExp(escaped(`the release v0.0.1 lists ${SIBLING_WHEEL} with the sha256 none, the downloaded file has`)));
});

test('the proof refuses a wheel whose downloaded sha256 differs from the digest that the release lists', (t) => {
  const box = locked(t, { mutate: siblingMutate(generatorRequires(siblingLine())) });
  const state = box.state();
  const listed = `sha256:${'0'.repeat(64)}`;
  const { published } = state.release;
  assert.ok(published);
  box.stub({ release: { ...state.release, published: { ...published, [GENERATOR_WHEEL]: { ...published[GENERATOR_WHEEL], digest: listed } } } });
  stop(() => prove(box), new RegExp(escaped(`the release v0.0.1 lists ${GENERATOR_WHEEL} with the sha256 ${'0'.repeat(64)}, the downloaded file has`)));
});
