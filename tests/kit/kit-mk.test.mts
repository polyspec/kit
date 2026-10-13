// scripts/kit/kit.mk runs every tool as `node $(KIT)/<tool>.$(KIT_EXT)`: kit's Makefile sets the sources (scripts/kit, mts),
// a repository's kit-bootstrap.mk sets the built package (node_modules/@polyspec/kit/dist, mjs). kit.mk stops while either
// is unset, and kit-test is kit's own target, since a repository holds no tests/kit.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
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
