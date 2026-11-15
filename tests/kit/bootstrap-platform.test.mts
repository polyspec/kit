// Native bootstrap paths and wrappers are selected explicitly for Windows; this unit keeps the platform mapping and batch
// command shape reviewable without downloading toolchains or invoking a shell.
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { miseArchiveUrl, miseBinary, misePlatform, nodeBinary } from '../../scripts/kit/bootstrap/install-mise.mts';
import { windowsWrapperText } from '../../scripts/kit/bootstrap/tool-wrappers.mts';
import { changedFiles, snapshotFiles } from '../../scripts/kit/bootstrap/verify-idempotent.mts';
import { isJsonObject } from '../../scripts/kit/bootstrap/files.mts';
import { makeDatabase } from '../../scripts/kit/owner-check.mts';
import { known } from './known.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('bootstrap snapshots accept unchanged installed files and reject a changed installation', (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'kit-bootstrap-state-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const binary = path.join(root, 'node');
  writeFileSync(binary, 'native binary');
  const before = snapshotFiles({ 'node binary': binary });
  assert.deepEqual(changedFiles(before, snapshotFiles({ 'node binary': binary })), []);
  writeFileSync(binary, 'replaced native binary');
  assert.deepEqual(changedFiles(before, snapshotFiles({ 'node binary': binary })), ['node binary']);
});

test('mise uses the release platform keys and Windows archive names', () => {
  assert.equal(misePlatform('win32', 'x64'), 'windows-x64');
  assert.equal(misePlatform('win32', 'arm64'), 'windows-arm64');
  assert.equal(misePlatform('darwin', 'arm64'), 'darwin-arm64');
  assert.equal(misePlatform('linux', 'x64'), 'linux-x64');
  assert.equal(miseArchiveUrl('2026.10.10', 'windows-x64', 'zip'), 'https://github.com/jdx/mise/releases/download/v2026.10.10/mise-v2026.10.10-windows-x64.zip');
  assert.equal(miseBinary('C:\\cache', 'win32'), 'C:\\cache\\mise\\bin\\mise.exe');
  assert.equal(nodeBinary('C:\\node', 'win32'), 'C:\\node\\node.exe');
});

test('Windows wrappers invoke native executables and pass through command arguments', () => {
  const wrapper = windowsWrapperText('mise of checkout', 'C:\\tools\\mise.exe', {
    environment: { MISE_DATA_DIR: 'C:\\work\\var\\tools\\mise' },
    pathPrefix: ['C:\\work\\var\\tools\\mise\\bin'],
  });
  assert.equal(wrapper, '@echo off\r\nsetlocal\r\nrem mise of checkout\r\nset "MISE_DATA_DIR=C:\\work\\var\\tools\\mise"\r\nset "PATH=C:\\work\\var\\tools\\mise\\bin;%PATH%"\r\n"C:\\tools\\mise.exe" %*\r\nexit /b %ERRORLEVEL%\r\n');
  const npm = windowsWrapperText('npm of checkout', 'C:\\work\\var\\tools\\mise\\installs\\node\\26.12.0\\node.exe', {
    args: ['C:\\work\\var\\tools\\mise\\installs\\npm-npm\\12.2.0\\node_modules\\npm\\bin\\npm-cli.js'],
  });
  assert.match(npm, /"C:\\work\\var\\tools\\mise\\installs\\node\\26\.12\.0\\node\.exe" "C:\\work\\var\\tools\\mise\\installs\\npm-npm\\12\.2\.0\\node_modules\\npm\\bin\\npm-cli\.js" %\*/);
  assert.doesNotMatch(npm, /^call /m);
});

// K912: the smoke is the job bootstrap of kit's ci.yml, which the final job kit needs, so the run of a push covers every OS. Since
// K1250 the job runs one recipe, make ci-bootstrap, so its order lives in the Makefile and its platforms in the matrix.
test('the platform smoke installs pinned packages before SDK tools and requires every OS result', () => {
  const ci = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');
  assert.equal(existsSync(new URL('../../.github/workflows/platform-bootstrap.yml', import.meta.url)), false, 'no second push workflow');
  const workflow: unknown = parse(ci);
  assert.ok(isJsonObject(workflow) && isJsonObject(workflow.jobs), 'ci.yml declares jobs');
  const job = workflow.jobs.bootstrap;
  assert.ok(isJsonObject(job) && isJsonObject(job.strategy) && isJsonObject(job.strategy.matrix), 'the job bootstrap has a matrix');
  assert.deepEqual(job.strategy.matrix.runner, ['ubuntu-24.04', 'macos-15', 'windows-2025'], 'the matrix runs Linux, macOS and Windows');
  assert.ok(Array.isArray(job.steps));
  const runs = job.steps.filter((step: unknown) => isJsonObject(step) && step.run !== undefined);
  assert.deepEqual(runs, [{ run: 'make ci-bootstrap' }], 'the job runs one recipe');
  const recipe = known(makeDatabase(ROOT).targets.get('ci-bootstrap'), 'ci-bootstrap').recipe;
  const order = [/--no-print-directory bootstrap$/m, /scripts\/kit\/bootstrap\/verify-idempotent\.mts$/m, /install-tools TOOLS="go rust"$/m, /-k \$\(CI_BOOTSTRAP_CHECKS_\$\(CI_BOOTSTRAP_PLATFORM\)\)$/m]
    .map(pattern => known(pattern.exec(recipe), `ci-bootstrap runs ${String(pattern)}`).index);
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'the bootstrap, its idempotence, the pinned Go and Rust, then the checks');
  assert.match(ci, /\n {2}kit:\n[\s\S]*?needs: \[[^\]]*\bbootstrap\b[^\]]*\][\s\S]*?RESULTS='\$\{\{ toJSON\(needs\) \}\}'/, 'the final job kit requires the result of every OS');
});
