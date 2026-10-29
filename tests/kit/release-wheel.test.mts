// Tests of the Python wheel package kind: the PEP 427 name, the build from the tagged commit with uv build, the refusal of a
// Requires-Dist that is not a plain name==version, and the version in pyproject.toml. The uv and the Python of the sandbox are the stubs of wheel-stubs.mts; no test reaches an index.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import * as release from '../../scripts/kit/release.mts';
import * as wheel from '../../scripts/kit/release-wheel.mts';
import { Stop } from '../../scripts/kit/process.mts';
import { releaseSandbox } from './release-sandbox.mts';
import { GENERATOR_WHEEL, SIBLING_WHEEL, addSibling, generatorRequires, siblingLine } from './sibling-sandbox.mts';

type Box = ReturnType<typeof releaseSandbox>;

const stop = (fn: () => unknown, pattern: RegExp) => assert.throws(fn, error => error instanceof Stop && pattern.test(error.message), String(pattern));
const WHEEL = 'kit_fixture-0.0.1-py3-none-any.whl';
const PYPROJECT = 'packages/fixture-python/pyproject.toml';
const context = (box: Box) => release.context(box.root, { env: box.env });
const editPyproject = (root: string, change: (text: string) => string) => writeFileSync(path.join(root, PYPROJECT), change(readFileSync(path.join(root, PYPROJECT), 'utf8')));

test('a wheel is named by PEP 427 and the archive names of the configuration hold it', (t) => {
  const box = releaseSandbox(t);
  assert.equal(wheel.wheelName('kit-fixture', '0.0.1'), WHEEL);
  assert.ok(release.assetNames(release.loadConfig(box.root), '0.0.1').includes(WHEEL));
});

test('assets builds the wheel of the tagged commit with uv build, which installs the build-system.requires of its pyproject', (t) => {
  const box = releaseSandbox(t);
  const tag = box.release('0.0.1');
  const names = release.assets(context(box), tag);
  assert.ok(names.includes(WHEEL));
  const file = path.join(box.root, release.ASSETS, WHEEL);
  assert.ok(existsSync(file), 'the wheel is in var/release/assets');
  const metadata = spawnSync('unzip', ['-p', file, '*.dist-info/METADATA'], { encoding: 'utf8' }).stdout;
  assert.match(metadata, /^Name: kit-fixture$/m);
  assert.match(metadata, /^Version: 0\.0\.1$/m);
  const builds = box.pipCalls().filter(call => call.args[0] === 'build');
  const [build] = builds;
  assert.ok(build && builds.length === 1, 'uv build ran once');
  assert.deepEqual(build.args.slice(0, -2), ['build', '--wheel', '--python', path.join(box.root, 'var/tools/mise/shims/python3'), '--out-dir'], 'the native build frontend, with the Python of the checkout');
  // uv build writes a .gitignore into its output folder, so it builds outside the checkout and only the wheel reaches the assets (K813).
  assert.ok(!build.args.at(-2)?.startsWith(box.root), 'the wheel is built into a folder outside the checkout');
  assert.ok(!readdirSync(path.join(box.root, release.ASSETS)).includes('.gitignore'), 'the assets hold no .gitignore of uv build');
  assert.ok(!build.args.at(-1)?.startsWith(box.root), 'the wheel is built from a copy of the tagged commit, not the working tree');
});

test('assets refuses a wheel whose project name differs from the configuration, by the archive that it builds', (t) => {
  const box = releaseSandbox(t, { mutate: (root: string) => editPyproject(root, text => text.replace('name = "kit-fixture"', 'name = "other-name"')) });
  const tag = box.release('0.0.1');
  stop(() => release.assets(context(box), tag), /holds \[.*other_name-0\.0\.1-py3-none-any\.whl.*\], not the archives \[.*kit_fixture-0\.0\.1-py3-none-any\.whl/);
});

test('assets accepts a sibling of the same release named by its asset URL without a hash, and names both wheels', (t) => {
  const box = releaseSandbox(t, { mutate: addSibling });
  const tag = box.release('0.0.1');
  box.wheelRequires(generatorRequires(siblingLine()));
  assert.deepEqual(release.assets(context(box), tag).sort(), ['fixture-app-npm-0.0.1.tgz', 'fixture-lib-npm-0.0.1.tgz', GENERATOR_WHEEL, SIBLING_WHEEL, 'polyspec-kit-fixture-php-0.0.1.zip', 'packages.json'].sort());
});

// cargo reads the version of a Cargo manifest: a member that inherits version.workspace has the version of its workspace.
