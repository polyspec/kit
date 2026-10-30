// Native bootstrap paths and wrappers are selected explicitly for Windows; this unit keeps the platform mapping and batch
// command shape reviewable without downloading toolchains or invoking a shell.
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { miseArchiveUrl, miseBinary, misePlatform, nodeBinary } from '../../scripts/kit/bootstrap/install-mise.mts';
import { windowsWrapperText } from '../../scripts/kit/bootstrap/tool-wrappers.mts';
import { changedFiles, snapshotFiles } from '../../scripts/kit/bootstrap/verify-idempotent.mts';

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
    args: ['C:\\work\\var\\tools\\npm\\node_modules\\npm\\bin\\npm-cli.js'],
  });
  assert.match(npm, /"C:\\work\\var\\tools\\mise\\installs\\node\\26\.12\.0\\node\.exe" "C:\\work\\var\\tools\\npm\\node_modules\\npm\\bin\\npm-cli\.js" %\*/);
  assert.doesNotMatch(npm, /^call /m);
});

// K912: the smoke is the job bootstrap of kit's ci.yml, which the final job kit needs, so the run of a push covers every OS.
test('the platform smoke installs pinned packages before SDK tools and requires every OS result', () => {
  const ci = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');
  assert.equal(existsSync(new URL('../../.github/workflows/platform-bootstrap.yml', import.meta.url)), false, 'no second push workflow');
  const workflow = ci.slice(ci.indexOf('\n  bootstrap:\n'), ci.indexOf('\n  kit:\n'));
  for (const runner of ['ubuntu-24.04', 'macos-15', 'windows-2025']) assert.ok(workflow.includes(`runner: ${runner}`), `${runner} is in the matrix`);
  assert.match(workflow, /install pinned mise, Node\.js and npm[\s\S]*?install pinned Kit dependencies/);
  assert.match(workflow, /verify bootstrap is idempotent[\s\S]*?run: node scripts\/kit\/bootstrap\/verify-idempotent\.mts/);
  assert.doesNotMatch(workflow, /grep -q ['"]installing |match ['"]installing /);
  assert.match(workflow, /var\/tools\/bin\/node var\/tools\/npm\/node_modules\/npm\/bin\/npm-cli\.js ci --ignore-scripts --allow-remote=root/);
  assert.match(workflow, /\.\\var\\tools\\bin\\node\.cmd \.\\var\\tools\\npm\\node_modules\\npm\\bin\\npm-cli\.js ci --ignore-scripts --allow-remote=root/);
  assert.match(workflow, /install pinned Kit dependencies[\s\S]*?install pinned Go and Rust toolchains/);
  assert.match(workflow, /verify Git Bash Make uses pinned Node\.js on Windows[\s\S]*?shell: bash[\s\S]*?run: make --no-print-directory kit-check/);
  // K820: on Windows a mise shim run through Git Bash make reaches mise.exe by the PATH of kit.mk.
  assert.match(workflow, /run a mise shim through Git Bash Make on Windows[\s\S]*?shell: bash[\s\S]*?\$\(KIT_TOOLS\)\/mise\/shims\/go version/);
  // K830: the process tests start real processes; a hang fails the step by its limit.
  assert.match(workflow, /verify the Windows \.cmd process path\n\s+timeout-minutes: 10\n/);
  assert.match(ci, /\n {2}kit:\n[\s\S]*?needs: \[[^\]]*\bbootstrap\b[^\]]*\][\s\S]*?RESULTS: \$\{\{ toJSON\(needs\) \}\}/, 'the final job kit requires the result of every OS');
});
