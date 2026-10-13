// Tests of the Rust lint: cargo clippy runs with -D warnings in the folder of each Cargo workspace of the checkout, a member
// package has no run of its own, the kit fixture is not read, and every run happens after an earlier one failed. cargo is a
// stub on PATH.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { lint, lintSteps } from '../../scripts/kit/lint-rust.mts';

const FILES: Record<string, string> = {
  'Cargo.toml': '[workspace]\nmembers = ["packages/rust"]\n',
  'packages/rust/Cargo.toml': '[package]\nname = "demo"\n',
  'benchmarks/rust/Cargo.toml': '[package]\nname = "bench"\n\n[workspace]\n',
  'tests/kit/fixture/packages/fixture-rust/Cargo.toml': '[package]\nname = "fixture"\n\n[workspace]\n',
};

function checkout(t: TestContext): string {
  const root = mkdtempSync(path.join(tmpdir(), 'kit-lint-rust-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [file, text] of Object.entries(FILES)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  }
  const init = spawnSync('git', ['init', '--quiet'], { cwd: root, encoding: 'utf8' });
  assert.equal(init.status, 0, init.stderr);
  return root;
}

const CLIPPY = ['clippy', '--workspace', '--all-targets', '--locked', '--', '-D', 'warnings'];

test('cargo clippy runs with -D warnings in each workspace folder, and not for a member or the kit fixture', (t) => {
  assert.deepEqual(lintSteps(checkout(t)), [
    { label: 'cargo clippy .', command: 'cargo', args: CLIPPY, cwd: '.' },
    { label: 'cargo clippy benchmarks/rust', command: 'cargo', args: CLIPPY, cwd: 'benchmarks/rust' },
  ]);
});

test('every workspace runs after an earlier one failed, and each failure is named', (t) => {
  const root = checkout(t);
  const bin = mkdtempSync(path.join(tmpdir(), 'kit-lint-rust-bin-'));
  t.after(() => rmSync(bin, { recursive: true, force: true }));
  const log = path.join(bin, 'calls.log');
  writeFileSync(path.join(bin, 'cargo'), `#!/bin/sh\necho "cargo $* [$(basename "$PWD")]" >> "${log}"\ntest "$(basename "$PWD")" = rust || exit 101\n`);
  chmodSync(path.join(bin, 'cargo'), 0o755);
  const saved = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${saved}`;
  t.after(() => { process.env.PATH = saved; });
  assert.deepEqual(lint(root, () => {}), ['cargo clippy .']);
  assert.equal(readFileSync(log, 'utf8').split('\n').filter(Boolean).length, 2);
});
