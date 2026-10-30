// Tests of the Rust lint: cargo clippy runs with -D warnings in the folder of each Cargo workspace of the checkout, a member
// package has no run of its own, the kit fixture is not read, and every run happens after an earlier one failed. cargo is a
// stub on PATH.
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { lint, lintSteps, P8_LINTS } from '../../scripts/kit/lint-rust.mts';
import { kitPackageRoot } from '../../scripts/kit/kit-files.mts';
import { siblingTool } from '../../scripts/kit/paths.mts';
import { initRepository } from './sandbox-repository.mts';

const FILES: Record<string, string> = {
  'Cargo.toml': '[workspace]\nmembers = ["packages/rust"]\n',
  'packages/rust/Cargo.toml': '[package]\nname = "demo"\n',
  // A comment after the table header is TOML; the reader of the manifest reads the table.
  'benchmarks/rust/Cargo.toml': '[package]\nname = "bench"\n\n[workspace] # the benchmarks\n',
  'tests/kit/fixture/packages/fixture-rust/Cargo.toml': '[package]\nname = "fixture"\n\n[workspace]\n',
};

function checkout(t: TestContext): string {
  const root = mkdtempSync(path.join(tmpdir(), 'kit-lint-rust-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [file, text] of Object.entries(FILES)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  }
  initRepository(root);
  return root;
}

const CLIPPY = ['clippy', '--workspace', '--all-targets', '--locked', '--', '-D', 'warnings', ...P8_LINTS];
// K802: clippy runs through the cargo link with the sibling checkouts, as cargo-fetch does (K448-5), so in a linked checkout a
// polyspec git dependency compiles against the sibling checkout, not against its tag.
const LINKED = [siblingTool(new URL('../../scripts/kit/lint-rust.mts', import.meta.url).href, 'link'), 'cargo', '.', ...CLIPPY];

test('cargo clippy runs with -D warnings in each workspace folder through the cargo link with the siblings, and not for a member or the kit fixture (K802)', (t) => {
  assert.deepEqual(lintSteps(checkout(t)), [
    { label: 'cargo clippy .', command: process.execPath, args: LINKED, cwd: '.', env: { CLIPPY_CONF_DIR: kitPackageRoot() } },
    { label: 'cargo clippy benchmarks/rust', command: process.execPath, args: LINKED, cwd: 'benchmarks/rust', env: { CLIPPY_CONF_DIR: kitPackageRoot() } },
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

// K514: clippy reads the clippy.toml of the kit package that runs, through CLIPPY_CONF_DIR, never a copy of the repository.
test('clippy reads the clippy.toml of the kit package (K514)', (t) => {
  for (const step of lintSteps(checkout(t))) assert.deepEqual(step.env, { CLIPPY_CONF_DIR: kitPackageRoot() });
  assert.ok(readFileSync(path.join(kitPackageRoot(), 'clippy.toml'), 'utf8').includes('disallowed-methods'));
});
