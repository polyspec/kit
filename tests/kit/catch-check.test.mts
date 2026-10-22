// The catch check (K537): a catch clause or a .catch callback, and in Rust an Err(..) arm or an `if let Err(..)` branch, that
// holds no statement is a finding; one that holds a statement is not.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { emptyCatches } from '../../scripts/kit/catch-check.mts';
import { CATCH_CHECK_MANIFEST } from '../../scripts/kit/lint-rust.mts';
import { kitPackageRoot } from '../../scripts/kit/kit-files.mts';

test('a TypeScript catch or .catch callback without a statement is a finding (K537)', () => {
  const text = [
    'try { f(); } catch {',
    '  // ignored',
    '}',
    'try { f(); } catch (error) { if (!(error instanceof RangeError)) throw error; }',
    'p.catch(() => {',
    '  // ignored',
    '});',
    'p.catch((error: unknown) => { throw error; });',
    'const x: number = 1;',
  ].join('\n');
  assert.deepEqual(emptyCatches('a.ts', text), [1, 5]);
});

test('a Rust Err arm or if let Err branch without a statement is a finding (K537)', (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'kit-catch-rust-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'lib.rs');
  writeFileSync(file, [
    'fn f() {',
    '    match g() {',
    '        Ok(()) => {}',
    '        Err(_) => {',
    '            // ignored',
    '        }',
    '    }',
    '    if let Err(_error) = g() {}',
    '    if let Err(error) = g() { panic!("{error}"); }',
    '}',
  ].join('\n'));
  const manifest = path.join(kitPackageRoot(), CATCH_CHECK_MANIFEST);
  const env = { ...process.env, CARGO_TARGET_DIR: path.join(directory, 'target') };
  // The tool is built first: its compile is no part of the check (the timeout of a test bounds the time before its first output).
  const build = spawnSync('cargo', ['build', '--quiet', '--offline', '--locked', '--manifest-path', manifest], { encoding: 'utf8', env });
  assert.equal(build.status, 0, build.stderr);
  const run = spawnSync('cargo', ['run', '--quiet', '--offline', '--locked', '--manifest-path', manifest, '--', file], { encoding: 'utf8', env });
  assert.equal(run.status, 1, run.stderr);
  // Each finding is `<file>:<line>: <message>`.
  assert.deepEqual(run.stderr.trim().split('\n').map(line => line.slice(file.length + 1).split(':')[0]), ['4', '8']);
});
