// Tests of the generated-file check (scripts/kit/generated-files.mts) and of the pre-commit hook that `git-hooks install` writes
// and that runs it: a staged path under a generated segment (node_modules, vendor, .venv, venv, __pycache__, target, dist or
// *.egg-info) is refused with its path named, unless config/generated.json declares it an exception. A segment that only
// contains a generated name is not generated. Each case works in a temporary checkout with the hooks installed.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { git, prepared, run } from './gates-checkout.mts';
import { tool } from './kit-tools.mts';

const GENERATED_CONFIG = JSON.stringify({ schema: 1, paths: [], exceptions: ['tests/*/fixtures/**'] });
const check = (work: string) => run(work, process.execPath, [tool(import.meta.resolve('../../scripts/kit/generated-files.mts')), 'staged']);
const stage = (work: string, file: string, text: string | Buffer = 'x\n') => {
  mkdirSync(path.dirname(path.join(work, file)), { recursive: true });
  writeFileSync(path.join(work, file), text);
  git(work, 'add', file);
};
const commit = (work: string) => run(work, 'git', ['-c', 'user.name=test', '-c', 'user.email=test@example.com', 'commit', '--quiet', '-m', 'chore(deps): Add a file']);

test('a commit that stages node_modules/x is refused, names the path, and creates no commit', (t) => {
  const { work } = prepared(t, { files: { 'config/generated.json': GENERATED_CONFIG } });
  const head = git(work, 'rev-parse', 'HEAD');
  stage(work, 'node_modules/x/index.js');
  const refused = commit(work);
  assert.notEqual(refused.status, 0, 'the commit of a generated path must not succeed');
  assert.match(refused.stderr, /node_modules\/x\/index\.js is a generated file/);
  assert.equal(git(work, 'rev-parse', 'HEAD'), head);
});

test('a staged path that config/generated.json declares an exception is accepted', (t) => {
  const { work } = prepared(t, { files: { 'config/generated.json': GENERATED_CONFIG } });
  stage(work, 'tests/app/fixtures/node_modules/x/index.js');
  const accepted = check(work);
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.match(accepted.stdout, /no generated file is staged/);
});

test('every generated segment is refused, and a name that only contains one is accepted', (t) => {
  const { work } = prepared(t, { files: { 'config/generated.json': GENERATED_CONFIG } });
  const generated = ['.venv/lib/x.py', 'venv/bin/x', 'pkg/__pycache__/m.cpython.pyc', 'target/debug/app', 'dist/index.js', 'vendor/acme/x.php', 'pkg.egg-info/PKG-INFO', 'node_modules/x/index.js'];
  const accepted = ['docs/node_modules-notes.md', 'src/dist.ts', 'src/targets/a.ts', 'venvs.md'];
  for (const file of [...generated, ...accepted]) stage(work, file);
  const refused = check(work);
  assert.equal(refused.status, 1);
  for (const file of generated) assert.match(refused.stderr, new RegExp(`${file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} is a generated file`), file);
  for (const file of accepted) assert.doesNotMatch(refused.stderr, new RegExp(file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), file);
});

test('a path that config/generated.json declares generated is refused, and an exception of the config still allows it', (t) => {
  const config = JSON.stringify({ schema: 1, paths: ['build/**', '**/*.vsix', '.vitepress/cache/**'], exceptions: ['build/keep/**'] });
  const { work } = prepared(t, { files: { 'config/generated.json': config } });
  const generated = ['build/tools/x', 'ext/a.vsix', '.vitepress/cache/x.json'];
  for (const file of [...generated, 'build/keep/y.txt']) stage(work, file);
  const refused = check(work);
  assert.equal(refused.status, 1, refused.stderr);
  for (const file of generated) assert.ok(refused.stderr.includes(`${file} is a generated file`), refused.stderr);
  assert.ok(!refused.stderr.includes('build/keep/y.txt'), 'the exception of the config is accepted');
});

test('the pre-commit hook that git-hooks install writes calls the make target staged-generated-hook and names no tool path', (t) => {
  const { work } = prepared(t, { files: { 'config/generated.json': GENERATED_CONFIG } });
  const hook = readFileSync(path.join(work, '.githooks/pre-commit'), 'utf8');
  assert.doesNotMatch(hook, /scripts\/kit|node_modules|\.mts|\.mjs/);
  assert.match(hook, /^exec make --no-print-directory staged-generated-hook$/m);
});

test('a staged executable is refused whatever its path, and one that config/generated.json declares passes (K416)', (t) => {
  const machO = Buffer.concat([Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0x0c, 0x00, 0x00, 0x01]), Buffer.alloc(56)]);
  const elf = Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]), Buffer.alloc(56)]);
  const binary = 'packages/go/cmd/tool/tool';
  const machOCheckout = prepared(t, { files: { 'config/generated.json': GENERATED_CONFIG } });
  stage(machOCheckout.work, binary, machO);
  const refusedMachO = check(machOCheckout.work);
  assert.equal(refusedMachO.status, 1, refusedMachO.stderr);
  assert.match(refusedMachO.stderr, /packages\/go\/cmd\/tool\/tool is an executable object \(Mach-O 64-bit\)/);
  const elfCheckout = prepared(t, { files: { 'config/generated.json': GENERATED_CONFIG } });
  stage(elfCheckout.work, binary, elf);
  const refusedElf = check(elfCheckout.work);
  assert.equal(refusedElf.status, 1, refusedElf.stderr);
  assert.match(refusedElf.stderr, /packages\/go\/cmd\/tool\/tool is an executable object \(ELF\)/);
  const textCheckout = prepared(t, { files: { 'config/generated.json': GENERATED_CONFIG } });
  stage(textCheckout.work, 'packages/go/cmd/text/tool', 'package main\n');
  const accepted = check(textCheckout.work);
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.match(accepted.stdout, /no generated file is staged/);
  const declared = JSON.stringify({ schema: 1, paths: [], exceptions: ['tests/*/fixtures/**', binary] });
  const declaredCheckout = prepared(t, { files: { 'config/generated.json': declared } });
  stage(declaredCheckout.work, binary, machO);
  const exempt = check(declaredCheckout.work);
  assert.equal(exempt.status, 0, exempt.stderr);
  assert.match(exempt.stdout, /no generated file is staged/);
});
