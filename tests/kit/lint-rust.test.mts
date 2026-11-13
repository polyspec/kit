// Tests of the Rust lint: cargo clippy runs in the folder of each Cargo workspace of the checkout, a member
// package has no run of its own, the kit fixture is not read, and every run happens after an earlier one failed. cargo is a
// stub on PATH.
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { lint, lintSteps } from '../../scripts/kit/lint-rust.mts';
import { siblingTool } from '../../scripts/kit/paths.mts';
import { initRepository } from './sandbox-repository.mts';

const FILES: Record<string, string> = {
  'Cargo.toml': '[workspace]\nmembers = ["packages/rust"]\n',
  'packages/rust/Cargo.toml': '[package]\nname = "demo"\n',
  // A comment after the table header is TOML; the reader of the manifest reads the table.
  'benchmarks/rust/Cargo.toml': '[package]\nname = "bench"\n\n[workspace] # the benchmarks\n',
  'tests/kit/fixture/packages/fixture-rust/Cargo.toml': '[package]\nname = "fixture"\n\n[workspace]\n',
  // The checkout declares its fixture, as kit does, so the checks leave it out (K1114).
  'config/release.json': '{ "fixtures": ["tests/kit/fixture/**"] }\n',
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

const CLIPPY = ['clippy', '--workspace', '--all-targets'];
// K802: clippy runs through the cargo link with the checkouts of the link declaration (K448-5), so in a linked checkout a
// polyspec git dependency compiles against the sibling checkout, not against its tag.
const LINKED = [siblingTool(new URL('../../scripts/kit/lint-rust.mts', import.meta.url).href, 'link'), 'cargo', '.', ...CLIPPY];

test('cargo clippy runs in each workspace folder through the cargo link with the siblings, and not for a member or the kit fixture (K802)', (t) => {
  assert.deepEqual(lintSteps(checkout(t)), [
    { label: 'cargo clippy .', command: process.execPath, args: LINKED, cwd: '.' },
    { label: 'cargo clippy benchmarks/rust', command: process.execPath, args: LINKED, cwd: 'benchmarks/rust' },
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

// K1050: the lints and their levels are the [lints] of Cargo.toml and the clippy.toml of the repository; the lint sets none.
test('clippy takes the arguments of the caller, such as --locked, after its own (K1097)', (t) => {
  for (const step of lintSteps(checkout(t), ['--locked'])) assert.deepEqual(step.args.slice(-4), [...CLIPPY, '--locked']);
});

test('clippy runs with no lint level and no configuration of kit (K1050)', (t) => {
  for (const step of lintSteps(checkout(t))) assert.equal(step.env, undefined);
});

// K1195: an argument after --workspace-args <folder> reaches only the step of the workspace in that folder, after the
// arguments of every step, so an --exclude of a package of one workspace never reaches another.
test('K1195: --workspace-args gives the arguments that follow it only to the step of the workspace in its folder', (t) => {
  const steps = lintSteps(checkout(t), ['--locked', '--workspace-args', '.', '--exclude', 'demo', '--workspace-args', 'benchmarks/rust', '--features', 'x']);
  assert.deepEqual(steps.map(step => [step.label, step.args.slice(LINKED.length)]), [
    ['cargo clippy .', ['--locked', '--exclude', 'demo']],
    ['cargo clippy benchmarks/rust', ['--locked', '--features', 'x']],
  ]);
});

test('K1195: --workspace-args of a folder without a workspace, or without a folder, is refused with the workspaces of the checkout', (t) => {
  const root = checkout(t);
  for (const args of [['--workspace-args', 'packages/rust', '--exclude', 'demo'], ['--locked', '--workspace-args']]) {
    assert.throws(() => lintSteps(root, args), (error: unknown) => error instanceof Error && error.message.includes('--workspace-args') && error.message.includes('., benchmarks/rust'), JSON.stringify(args));
  }
});
