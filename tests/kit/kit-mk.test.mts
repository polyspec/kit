// scripts/kit/kit.mk runs every tool as `node $(KIT)/<tool>.$(KIT_EXT)`: kit's Makefile sets the sources (scripts/kit, mts),
// a repository's kit-bootstrap.mk sets the built package (node_modules/@polyspec/kit/dist, mjs). kit.mk stops while either
// is unset, and kit-test is kit's own target, since a repository holds no tests/kit.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { miseEnvironment } from '../../scripts/kit/bootstrap/install-mise.mts';
import { put, tree } from './tree.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const KIT_MK = path.join(ROOT, 'scripts/kit/kit.mk');
const recipes = readFileSync(KIT_MK, 'utf8').split('\n').filter(line => line.startsWith('\t'));

test('every recipe of kit.mk runs its tool through KIT and KIT_EXT, and none names scripts/kit', () => {
  const tools = recipes.filter(line => /\bnode /.test(line));
  assert.ok(tools.length > 0, 'kit.mk has no recipe that runs node');
  assert.deepEqual(recipes.filter(line => line.includes('scripts/kit')), [], 'these recipes name scripts/kit');
  assert.deepEqual(tools.filter(line => !/\bnode \$\(KIT\)\/(?:bootstrap\/)?[a-z-]+\.\$\(KIT_EXT\)/.test(line)), [], 'these recipes run node without $(KIT)/<tool>.$(KIT_EXT) or $(KIT)/bootstrap/<tool>.$(KIT_EXT)');
});

test('kit.mk runs the tools of the directory and extension that KIT and KIT_EXT name', () => {
  const dry = spawnSync('make', ['-n', '--no-print-directory', '-f', KIT_MK, 'documents-check', 'KIT=node_modules/@polyspec/kit/dist', 'KIT_EXT=mjs'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(dry.status, 0, dry.stderr);
  assert.equal(dry.stdout.trim(), 'node node_modules/@polyspec/kit/dist/check-documents.mjs');
});

test('kit.mk stops while KIT or KIT_EXT is unset', () => {
  for (const args of [[], ['KIT=scripts/kit'], ['KIT_EXT=mts']]) {
    const dry = spawnSync('make', ['-n', '--no-print-directory', '-f', KIT_MK, 'documents-check', ...args], { cwd: ROOT, encoding: 'utf8' });
    assert.equal(dry.status, 2, `${args.join(' ')}: ${dry.stdout}`);
    assert.match(dry.stderr, /kit\.mk needs KIT and KIT_EXT; include it through kit-bootstrap\.mk, or set both as the Makefile of kit does/, args.join(' '));
  }
});

test('every recipe runs with the environment of mise of the checkout, and with var/tools/bin and the shims first on PATH (K127)', (t) => {
  // make names the directory by its real path.
  const root = realpathSync(tree(t, { 'Makefile': `KIT := scripts/kit\nKIT_EXT := mts\ninclude ${KIT_MK}\nshow:\n\t@env\n` }));
  const shown = spawnSync('make', ['--no-print-directory', 'show'], { cwd: root, encoding: 'utf8', env: { ...process.env, PATH: '/usr/bin:/bin' } });
  assert.equal(shown.status, 0, shown.stderr);
  const env = Object.fromEntries(shown.stdout.trim().split('\n').map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
  for (const [name, value] of Object.entries(miseEnvironment(root))) assert.equal(env[name], value, name);
  assert.equal(env.PATH, [path.join(root, 'var/tools/bin'), path.join(root, 'var/tools/mise/shims'), '/usr/bin', '/bin'].join(path.delimiter));
});

test('kit-test is a target of the Makefile of kit, not of kit.mk', () => {
  assert.equal(recipes.some(line => line.includes('tests/kit')), false, 'kit.mk runs tests/kit');
  const dry = spawnSync('make', ['-n', '--no-print-directory', 'kit-test'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(dry.status, 0, dry.stderr);
  assert.ok(dry.stdout.split('\n').includes('node scripts/kit/run-tests.mts node -- tests/kit'), dry.stdout);
});

/** A kit checkout in a sandbox with the Makefile and tools of kit and `tests` as its tests/kit; a Git repository with everything committed. */
function kitCheckout(t: TestContext, tests: Record<string, string>) {
  const root = tree(t, {});
  cpSync(path.join(ROOT, 'Makefile'), path.join(root, 'Makefile'));
  cpSync(path.join(ROOT, 'scripts/kit'), path.join(root, 'scripts/kit'), { recursive: true });
  writeFileSync(path.join(root, '.gitignore'), 'var/\n');
  put(root, tests);
  spawnSync('git', ['add', '-A'], { cwd: root });
  spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--quiet', '-m', 'kit'], { cwd: root });
  return root;
}

test('kit-test fails when its run changes the checkout, and names the path', (t) => {
  const writes = "import test from 'node:test';\nimport { writeFileSync } from 'node:fs';\ntest('writes', () => { writeFileSync('stray.txt', 'x'); });\n";
  const root = kitCheckout(t, { 'tests/kit/writes.test.mts': writes });
  const run = spawnSync('make', ['--no-print-directory', 'kit-test'], { cwd: root, encoding: 'utf8' });
  assert.notEqual(run.status, 0, run.stdout);
  assert.match(run.stderr, /> \?\? stray\.txt/);
  assert.match(run.stderr, /kit-test: the run changed the checkout/);
});

test('kit-test passes when its run leaves the checkout as it was', (t) => {
  const root = kitCheckout(t, { 'tests/kit/clean.test.mts': "import test from 'node:test';\ntest('clean', () => {});\n" });
  const run = spawnSync('make', ['--no-print-directory', 'kit-test'], { cwd: root, encoding: 'utf8' });
  assert.equal(run.status, 0, `${run.stdout}${run.stderr}`);
});

// The vendored release workflow runs make release-prepare before release-tools (K132): kit.mk declares it as a double-colon
// target with no recipe, and a repository adds its own preparation, such as the checkout of a sibling release, with a
// release-prepare:: rule of its Makefile.
test('release-prepare does nothing by default and runs the preparation that a repository declares (K132)', (t) => {
  const root = tree(t, {});
  const bare = spawnSync('make', ['--no-print-directory', '-f', KIT_MK, 'release-prepare', 'KIT=scripts/kit', 'KIT_EXT=mts'], { cwd: root, encoding: 'utf8' });
  assert.equal(bare.status, 0, bare.stderr);
  assert.equal(bare.stdout, '');
  put(root, { Makefile: `include ${KIT_MK}\nrelease-prepare::\n\t@echo prepared $(TAG)\n` });
  const declared = spawnSync('make', ['--no-print-directory', 'release-prepare', 'KIT=scripts/kit', 'KIT_EXT=mts', 'TAG=v0.0.1'], { cwd: root, encoding: 'utf8' });
  assert.equal(declared.status, 0, declared.stderr);
  assert.equal(declared.stdout, 'prepared v0.0.1\n');
});
