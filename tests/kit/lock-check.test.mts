// K1005: lock-check judges each tracked lock with its own package manager, offline, and names a resolved URL that two
// package-lock.json files lock with two integrities, which npm checks only when it fetches the tarball.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { integrityFindings, lockFindings, locksOf } from '../../scripts/kit/lock-check.mts';
import { initRepository } from './sandbox-repository.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const NPM = path.join(ROOT, 'var/tools/bin/npm');

/** A Git repository with `files`, all tracked; removed with `t.after`. */
function checkout(t: TestContext, files: Record<string, string>): string {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-lock-check-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  }
  initRepository(root);
  execFileSync('git', ['add', '-A'], { cwd: root });
  return root;
}

const lock = (packages: Record<string, unknown>) => `${JSON.stringify({ name: 'x', lockfileVersion: 3, requires: true, packages: { '': { name: 'x' }, ...packages } }, null, 2)}\n`;

test('K1005: npm ci --dry-run names a package-lock.json that lags its package.json', (t) => {
  const root = checkout(t, {
    'package.json': `${JSON.stringify({ name: 'x', version: '1.0.0', dependencies: { y: 'file:y' } })}\n`,
    'package-lock.json': lock({}),
    'y/package.json': `${JSON.stringify({ name: 'y', version: '1.0.0' })}\n`,
  });
  const findings = lockFindings(root, 'npm', { ...process.env, NPM });
  assert.equal(findings.length, 1, findings.join('\n'));
  assert.match(findings[0] ?? '', /^package-lock\.json: .*npm ci --dry-run/);
});

test('K1005: one resolved URL locked with two integrities in two package-lock.json files is a finding', (t) => {
  const url = 'https://example.test/x-0.0.19.tgz';
  const root = checkout(t, {
    'package-lock.json': lock({ 'node_modules/x': { version: '0.0.19', resolved: url, integrity: 'sha512-new' } }),
    'tests/package-install/package-lock.json': lock({ 'node_modules/x': { version: '0.0.19', resolved: url, integrity: 'sha512-old' } }),
    'tests/other/package-lock.json': lock({ 'node_modules/x': { version: '0.0.19', resolved: url, integrity: 'sha512-new' } }),
  });
  const locks = locksOf(root, 'npm');
  assert.deepEqual(locks, ['package-lock.json', 'tests/other/package-lock.json', 'tests/package-install/package-lock.json']);
  assert.deepEqual(integrityFindings(root, locks), [`${url} has 2 integrities: sha512-new in package-lock.json, tests/other/package-lock.json; sha512-old in tests/package-install/package-lock.json`]);
});

test('K1005: each other lock runs the check of its package manager in its folder, and a failure names the lock and the cause', (t) => {
  const root = checkout(t, {
    'packages/php/composer.lock': '{}\n',
    'packages/python/uv.lock': '',
    'packages/go/go.mod': 'module x\n',
    'packages/rust/Cargo.lock': '',
    '.mise/locks/pypi-x/1.0/uv.lock': '',
  });
  const bin = path.join(root, 'bin');
  mkdirSync(bin);
  // A package manager that records where it ran with which arguments and judges the lock stale.
  const tool = path.join(bin, 'tool');
  writeFileSync(tool, `#!/bin/sh\necho "$PWD $* [\${GOPROXY:-}]" >> "${path.join(bin, 'calls')}"\necho "- The lock file is not up to date" >&2\nexit 2\n`);
  chmodSync(tool, 0o755);
  const env = { ...process.env, COMPOSER_BIN: tool, UV: tool, GO: tool, CARGO: tool };
  assert.deepEqual(lockFindings(root, 'composer', env), [`packages/php/composer.lock: ${tool} validate --no-check-publish --no-check-all fails: - The lock file is not up to date`]);
  assert.deepEqual(lockFindings(root, 'python', env).map(finding => finding.split(':')[0]), ['packages/python/uv.lock'], 'the uv.lock of a mise tool is mise\'s');
  assert.deepEqual(lockFindings(root, 'go', env).map(finding => finding.split(':')[0]), ['packages/go/go.mod']);
  assert.deepEqual(lockFindings(root, 'rust', env).map(finding => finding.split(':')[0]), ['packages/rust/Cargo.lock']);
  assert.deepEqual(execFileSync('cat', [path.join(bin, 'calls')], { encoding: 'utf8' }).trim().split('\n'), [
    `${path.join(root, 'packages/php')} validate --no-check-publish --no-check-all []`,
    `${path.join(root, 'packages/python')} lock --check --offline []`,
    `${path.join(root, 'packages/go')} mod tidy -e -diff [off]`,
    `${path.join(root, 'packages/rust')} metadata --locked --offline --format-version 1 []`,
  ]);
});

test('K1011: go judges a go.mod despite an import that only go.work or a generated package provides, and a failure names the first line of go', (t) => {
  const root = checkout(t, { 'go.mod': 'module example.invalid/m\n' });
  const bin = path.join(root, 'bin');
  mkdirSync(bin);
  // go mod tidy without -e stops at an import it cannot load offline; with -e it judges the requirements it can load.
  const go = path.join(bin, 'go');
  writeFileSync(go, '#!/bin/sh\ncase " $* " in *" -e "*) exit 0;; esac\necho "go: finding module for package example.invalid/w/ast" >&2\nexit 1\n');
  chmodSync(go, 0o755);
  assert.deepEqual(lockFindings(root, 'go', { ...process.env, GO: go }), [], 'tidy -e reports no finding for an import of the workspace');
  // A go error with no word "error" is the cause, not the exit status.
  writeFileSync(go, '#!/bin/sh\necho "go: go.mod requires go >= 1.99 (running go 1.27; GOTOOLCHAIN=local)" >&2\nexit 1\n');
  assert.deepEqual(lockFindings(root, 'go', { ...process.env, GO: go }), [`go.mod: ${go} mod tidy -e -diff fails: go: go.mod requires go >= 1.99 (running go 1.27; GOTOOLCHAIN=local)`]);
});
