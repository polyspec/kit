// The make target release-tools-path of scripts/kit/kit.mk, which the vendored release workflow runs right after
// release-tools: it appends var/tools/bin and the shims of mise of the checkout to GITHUB_PATH, and the environment of mise
// (miseEnvironment) to GITHUB_ENV, the files the runner reads between steps, so the following steps run on the installed
// tools (K127). The order of the workflow itself is a case of tests/source, because kit does
// not vendor workflows/. No test uses the network.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { miseEnvironment } from '../../scripts/kit/bootstrap/install-mise.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('make release-tools-path appends var/tools/bin and the shims to GITHUB_PATH and the environment of mise to GITHUB_ENV', (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'release-path-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'github_path');
  const envFile = path.join(dir, 'github_env');
  writeFileSync(file, '');
  writeFileSync(envFile, '');
  const run = spawnSync('make', ['--no-print-directory', '-f', 'scripts/kit/kit.mk', 'KIT=scripts/kit', 'KIT_EXT=mts', 'release-tools-path'], { cwd: ROOT, env: { ...process.env, GITHUB_PATH: file, GITHUB_ENV: envFile }, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  // The runner puts each line of GITHUB_PATH before the ones read before it, so var/tools/bin comes first.
  assert.equal(readFileSync(file, 'utf8'), `${ROOT}/var/tools/mise/shims\n${ROOT}/var/tools/bin\n`);
  assert.equal(readFileSync(envFile, 'utf8'), Object.entries(miseEnvironment(ROOT)).map(([name, value]) => `${name}=${value}\n`).join(''));
});

test('make release-tools-path refuses without GITHUB_PATH and names where it runs', () => {
  const env = { ...process.env };
  delete env.GITHUB_PATH;
  const run = spawnSync('make', ['--no-print-directory', '-f', 'scripts/kit/kit.mk', 'KIT=scripts/kit', 'KIT_EXT=mts', 'release-tools-path'], { cwd: ROOT, env, encoding: 'utf8' });
  assert.notEqual(run.status, 0);
  assert.match(run.stdout + run.stderr, /release-tools-path: GITHUB_PATH is not set; run it in the release workflow between steps/);
});
