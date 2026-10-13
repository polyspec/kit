// Tests of scripts/kit/install-vscode.mts: the VS Code of an extension's integration test is the minimum of its
// engines.vscode; an install publishes the downloaded copy by a rename, leaves no directory of its download, does nothing
// for a present copy and keeps the copy of a concurrent install; the offline read fails without a complete copy. The
// download of @vscode/test-electron is replaced by a function that writes its layout, so no test reaches the network.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { installVSCode, installedExecutable, vscodeCopy } from '../../scripts/kit/install-vscode.mts';
import type { Download } from '../../scripts/kit/install-vscode.mts';

const directory = (t: TestContext) => {
  const created = mkdtempSync(path.join(tmpdir(), 'kit-install-vscode-'));
  t.after(() => rmSync(created, { recursive: true, force: true }));
  return created;
};

/** An extension package whose engines.vscode is `range`, and an empty tools directory. */
const setup = (t: TestContext, range = '^1.138.0') => {
  const base = directory(t);
  const extension = path.join(base, 'extension');
  mkdirSync(extension);
  writeFileSync(path.join(extension, 'package.json'), JSON.stringify({ name: 'extension', engines: { vscode: range } }));
  const tools = path.join(base, 'tools');
  mkdirSync(tools);
  return { extension, tools };
};

// A download in the layout of @vscode/test-electron: the copy and, after its last file, is-complete.
const fakeDownload = (calls: string[]): Download => async ({ version, platform, cachePath }) => {
  calls.push(cachePath);
  const copy = path.join(cachePath, `vscode-${platform}-${version}`);
  mkdirSync(copy, { recursive: true });
  writeFileSync(path.join(copy, 'product.json'), '{}');
  writeFileSync(path.join(copy, 'is-complete'), '');
  return copy;
};

test('the copy is the minimum of engines.vscode for the platform, in the layout of @vscode/test-electron', (t) => {
  const { extension, tools } = setup(t);
  assert.deepEqual(vscodeCopy(extension, tools, 'linux-x64'), { version: '1.138.0', platform: 'linux-x64', directory: path.join(tools, 'vscode-linux-x64-1.138.0') });
});

test('an engines.vscode that is not ^X.Y.Z fails with the value and the rule', (t) => {
  const { extension, tools } = setup(t, '>=1.138.0');
  assert.throws(() => vscodeCopy(extension, tools), /package\.json: engines\.vscode is ">=1\.138\.0"; the install reads the minimum of a range \^X\.Y\.Z$/);
});

test('an install publishes the downloaded copy by a rename and a second install downloads nothing', async (t) => {
  const { extension, tools } = setup(t);
  const calls: string[] = [];
  const installed = await installVSCode(extension, tools, fakeDownload(calls));
  assert.equal(installed, vscodeCopy(extension, tools).directory);
  assert.equal(calls.length, 1);
  assert.equal(calls[0], path.join(tools, `.next-${process.pid}`));
  assert.deepEqual(readdirSync(tools), [path.basename(installed)], 'the install left the directory of its download');
  assert.ok(existsSync(path.join(installed, 'product.json')));
  await installVSCode(extension, tools, fakeDownload(calls));
  assert.equal(calls.length, 1, 'an install of a present copy downloaded again');
});

test('an install keeps the complete copy that a concurrent install published first', async (t) => {
  const { extension, tools } = setup(t);
  const { directory: copy } = vscodeCopy(extension, tools);
  const first: Download = async (options) => {
    // The concurrent install publishes its copy while this one downloads.
    mkdirSync(copy);
    writeFileSync(path.join(copy, 'first'), '');
    writeFileSync(path.join(copy, 'is-complete'), '');
    return fakeDownload([])(options);
  };
  await installVSCode(extension, tools, first);
  assert.ok(existsSync(path.join(copy, 'first')), 'the install replaced the copy of the concurrent install');
  assert.deepEqual(readdirSync(tools), [path.basename(copy)]);
});

test('an incomplete download publishes nothing and names its directory, and the offline read then fails', async (t) => {
  const { extension, tools } = setup(t);
  const incomplete: Download = async ({ version, platform, cachePath }) => {
    const copy = path.join(cachePath, `vscode-${platform}-${version}`);
    mkdirSync(copy, { recursive: true });
    return copy;
  };
  await assert.rejects(installVSCode(extension, tools, incomplete), /left no complete copy in .*\.next-\d+\/vscode-/);
  assert.deepEqual(readdirSync(tools), []);
  assert.throws(() => installedExecutable(extension, tools), /^Error: VS Code 1\.138\.0 is not installed in .*; run make install-vscode$/);
});

test('the offline read of an installed copy returns its executable', async (t) => {
  const { extension, tools } = setup(t);
  const installed = await installVSCode(extension, tools, fakeDownload([]));
  assert.ok(installedExecutable(extension, tools).startsWith(installed), 'the executable is not inside the installed copy');
});
