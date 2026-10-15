// isMain (scripts/kit/paths.mts) tells whether a tool is the command that Node.js started. The command may name the tool
// through a symbolic link of its directory (macOS temporary directories are such links), and then it is the same file.
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isMain, repositoryRoot, siblingTool } from '../../scripts/kit/paths.mts';
import { english, korean, tree } from './tree.mts';
import { KIT, tool } from './kit-tools.mts';
import { known } from './known.mts';

const ROOT = path.resolve(import.meta.dirname, '../..');

/** The repository root that the tools of this checkout resolve in `cwd`. */
function printedRoot(cwd: string): string {
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', `const { repositoryRoot } = await import(${JSON.stringify(tool(import.meta.resolve('../../scripts/kit/paths.mts')))}); process.stdout.write(repositoryRoot());`], { cwd, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  return run.stdout;
}

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
    process.argv[1] = known(argv, 'argv');
  }
  assert.equal(fileURLToPath(module), path.join(ROOT, 'scripts/kit/paths.mts'));
  assert.equal(repositoryRoot(), ROOT, 'node --test runs in the root of this checkout');
});

test('the repository root is the top level of the Git work tree: a tool of this checkout run in another repository reads the files of that repository', (t) => {
  // The tools of a package run from node_modules/@polyspec/kit/dist, so the location of a module names no repository: the
  // tools of this checkout run with the sandbox as the working directory (kit-tools.mts).
  const en = english('guide', 'Some text.\n');
  const repository = tree(t, { 'config/documents.json': JSON.stringify({ schema: 1, include: ['**/*.md'] }), 'guide.md': en, 'guide.ko.md': korean(en) });
  assert.equal(realpathSync(printedRoot(repository)), realpathSync(repository));
  const checked = spawnSync(process.execPath, [tool(import.meta.resolve('../../scripts/kit/check-documents.mts'))], { cwd: repository, encoding: 'utf8' });
  assert.equal(checked.status, 0, `${checked.stdout}${checked.stderr}`);
  assert.match(checked.stdout, /1 document pairs/);
});

test('a tool started below the root, as npm -w starts it in a package directory, resolves the repository root (K144)', (t) => {
  const en = english('guide', 'Some text.\n');
  const repository = tree(t, { 'config/documents.json': JSON.stringify({ schema: 1, include: ['**/*.md'] }), 'guide.md': en, 'guide.ko.md': korean(en), 'packages/app/package.json': '{}\n' });
  const below = path.join(repository, 'packages/app');
  assert.equal(realpathSync(printedRoot(below)), realpathSync(repository));
  const checked = spawnSync(process.execPath, [tool(import.meta.resolve('../../scripts/kit/check-documents.mts'))], { cwd: below, encoding: 'utf8' });
  assert.equal(checked.status, 0, `${checked.stdout}${checked.stderr}`);
  assert.match(checked.stdout, /1 document pairs/);
});

test('outside a Git work tree the root is refused with its cause, and importing a tool alone reads no root', (t) => {
  const outside = mkdtempSync(path.join(tmpdir(), 'paths-outside-'));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  // GIT_CEILING_DIRECTORIES keeps git from finding a work tree above the temporary directory.
  const env = { ...process.env, GIT_CEILING_DIRECTORIES: path.dirname(realpathSync(outside)) };
  const imported = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(tool(import.meta.resolve('../../scripts/kit/tracked-files.mts')))});`], { cwd: outside, encoding: 'utf8', env });
  assert.equal(imported.status, 0, imported.stderr);
  const asked = spawnSync(process.execPath, ['--input-type=module', '-e', `const { repositoryRoot } = await import(${JSON.stringify(tool(import.meta.resolve('../../scripts/kit/paths.mts')))}); repositoryRoot();`], { cwd: outside, encoding: 'utf8', env });
  assert.notEqual(asked.status, 0);
  assert.match(asked.stderr, /is not inside a Git work tree; a tool of kit runs in a checkout of a repository/);
});

// A tool that starts another tool names it through siblingTool: the directory and the extension of the calling module, so
// the sources of scripts/kit start sources (.mts) and the modules of the package's dist start modules of dist (.mjs).
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
