// isMain (scripts/kit/paths.mts) tells whether a tool is the command that Node.js started. The command may name the tool
// through a symbolic link of its directory (macOS temporary directories are such links), and then it is the same file.
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isMain, ROOT, siblingTool } from '../../scripts/kit/paths.mts';
import { english, korean, tree } from './tree.mts';

test('isMain is true when the command names the tool through a link of its directory', (t) => {
  const link = mkdtempSync(path.join(tmpdir(), 'paths-link-'));
  t.after(() => rmSync(link, { recursive: true, force: true }));
  const alias = path.join(link, 'checkout');
  symlinkSync(ROOT, alias);
  const module = new URL('../../scripts/kit/paths.mts', import.meta.url).href;
  const argv = process.argv[1];
  try {
    process.argv[1] = path.join(alias, 'scripts/kit/paths.mts');
    assert.equal(isMain(module), true, 'the same file, named through a link, is the command');
    process.argv[1] = path.join(ROOT, 'scripts/kit/kit-check.mts');
    assert.equal(isMain(module), false, 'another file is not the command');
  } finally {
    // node --test runs this file, so the command names it.
    process.argv[1] = argv!;
  }
  assert.equal(fileURLToPath(module), path.join(ROOT, 'scripts/kit/paths.mts'));
});

test('ROOT is the working directory: a tool run from a copy outside the repository reads the files of the repository it runs in', (t) => {
  // The tools of a package run from node_modules/@polyspec/kit/dist, so the location of a module names no repository.
  const outside = mkdtempSync(path.join(tmpdir(), 'paths-outside-'));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  cpSync(path.join(ROOT, 'scripts/kit'), path.join(outside, 'tools'), { recursive: true });
  const en = english('guide', 'Some text.\n');
  const repository = tree(t, { 'config/documents.json': JSON.stringify({ schema: 1, include: ['**/*.md'] }), 'guide.md': en, 'guide.ko.md': korean(en) });
  const root = spawnSync(process.execPath, ['--input-type=module', '-e', `const { ROOT } = await import(${JSON.stringify(path.join(outside, 'tools/paths.mts'))}); process.stdout.write(ROOT);`], { cwd: repository, encoding: 'utf8' });
  assert.equal(root.status, 0, root.stderr);
  assert.equal(realpathSync(root.stdout), realpathSync(repository));
  const checked = spawnSync(process.execPath, [path.join(outside, 'tools/check-documents.mts')], { cwd: repository, encoding: 'utf8' });
  assert.equal(checked.status, 0, `${checked.stdout}${checked.stderr}`);
  assert.match(checked.stdout, /1 document pairs/);
});

// A tool that starts another tool names it through siblingTool: the directory and the extension of the calling module, so
// the sources of scripts/kit start sources (.mts) and the modules of the package's dist start modules of dist (.mjs).
const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../scripts/kit');

test('siblingTool names the tool beside the calling module with its extension', () => {
  assert.equal(siblingTool(pathToFileURL('/r/node_modules/@polyspec/kit/dist/release-tools.mjs').href, 'check-toolchain'), '/r/node_modules/@polyspec/kit/dist/check-toolchain.mjs');
  assert.equal(siblingTool(pathToFileURL('/r/scripts/kit/release-tools.mts').href, 'install-tools'), '/r/scripts/kit/install-tools.mts');
});

test('no tool of scripts/kit runs another tool by the path scripts/kit/<tool>.mts', () => {
  const modules = readdirSync(KIT).filter(name => name.endsWith('.mts'));
  assert.ok(modules.length > 0, 'the scan read no module of scripts/kit');
  const found = modules.flatMap(name => readFileSync(path.join(KIT, name), 'utf8').split('\n').map((line, index) => ({ name, index, line })))
    // A usage or comment line names the source path as text; the scan reads the code that builds a path.
    .filter(({ line }) => /['"`](?:[^'"`]*\/)?scripts\/kit\/[a-z-]+\.mts['"`]/.test(line) && !/^\s*(?:\/\/|\*)|usage|Usage|USAGE/.test(line))
    .map(({ name, index }) => `${name}:${index + 1}`);
  assert.deepEqual(found, [], 'these lines run a tool by its source path');
});

test('run-tests loads its reporters and its preload beside itself', () => {
  const text = readFileSync(path.join(KIT, 'run-tests.mts'), 'utf8');
  assert.equal(/['"`](?:test-exit-deadline|node-reporter|vitest-reporter)\.mts['"`]/.test(text), false, 'run-tests names a reporter or the preload with the extension .mts');
});
