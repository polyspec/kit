// The real Rust lint: lint-rust.mts runs cargo clippy with -D warnings on each workspace of a repository whose
// rust-toolchain.toml pins Rust 1.99.0, the pin of S4 (rustup toolchain install 1.99.0 --component clippy). The workspace holds
// the lints that config/cargo.schema.json requires. A crate that follows them passes; each violation planted into a copy fails
// with the lint that names it, including the transmute_copy of the plan's verification. Nothing is stubbed.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { lint } from '../../scripts/kit/lint-rust.mts';

const LIB = 'packages/rust/src/lib.rs';

// A workspace with the lints of kit and one member that takes them.
const GOOD: Record<string, string> = {
  '.gitignore': 'target/\n',
  'rust-toolchain.toml': '[toolchain]\nchannel = "1.99.0"\ncomponents = ["clippy"]\n',
  'Cargo.toml': '[workspace]\nmembers = ["packages/rust"]\nresolver = "3"\n\n[workspace.lints.rust]\nunsafe_code = "deny"\n\n[workspace.lints.clippy]\nallow_attributes_without_reason = "deny"\n',
  'packages/rust/Cargo.toml': '[package]\nname = "demo"\nversion = "0.0.1"\nedition = "2024"\n\n[lints]\nworkspace = true\n',
  [LIB]: '/// Doubles a value.\npub fn double(value: u32) -> u32 {\n    value * 2\n}\n',
};

const TRANSMUTE = '\n/// Reads the bits of a value as a signed value.\npub fn bits(value: u32) -> i32 {\n    unsafe { std::mem::transmute_copy(&value) }\n}\n';

// One violation for each lint: the files it adds or replaces, and the text that clippy prints for it.
const VIOLATIONS: { name: string; files: Record<string, string>; finding: RegExp }[] = [
  // The false green of the verification: transmute_copy reads any bits as any type, as transmute does.
  { name: 'transmute_copy in an unsafe block', files: { [LIB]: `${GOOD[LIB]}${TRANSMUTE}` }, finding: /error: usage of an `unsafe` block/ },
  { name: 'unsafe code allowed for the crate without a reason', files: { [LIB]: `#![allow(unsafe_code)]\n${GOOD[LIB]}${TRANSMUTE}` }, finding: /error: `allow` attribute without specifying a reason/ },
  { name: 'a clippy warning', files: { [LIB]: `${GOOD[LIB]}\n/// Compares a value with itself.\npub fn same(value: u32) -> bool {\n    value == value\n}\n` }, finding: /error: equal expressions as operands to `==`/ },
];

/** Writes `files` below `root`. */
function write(root: string, files: Record<string, string>) {
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  }
}

/** A repository in a temporary folder: GOOD with `files` over it and the lock of its workspace. */
function repository(t: TestContext, files: Record<string, string> = {}): string {
  const root = mkdtempSync(path.join(tmpdir(), 'kit-lint-rust-real-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  write(root, { ...GOOD, ...files });
  const lock = spawnSync('cargo', ['generate-lockfile', '--offline'], { cwd: root, encoding: 'utf8' });
  assert.equal(lock.status, 0, lock.stderr);
  const init = spawnSync('git', ['init', '--quiet'], { cwd: root, encoding: 'utf8' });
  assert.equal(init.status, 0, init.stderr);
  return root;
}

/** The labels of the failed steps of the lint of `root` and everything the steps printed. */
function lintOf(root: string): { failed: string[]; output: string } {
  let output = '';
  const failed = lint(root, text => { output += text; });
  return { failed, output };
}

test('the Rust lint passes on a workspace with the lints of kit, and on an FFI site that allows unsafe code with its reason', (t) => {
  const clippy = spawnSync('cargo', ['+1.99.0', 'clippy', '--version'], { encoding: 'utf8' });
  assert.equal(clippy.status, 0, `cargo clippy of Rust 1.99.0 is missing; rustup toolchain install 1.99.0 --component clippy installs it\n${clippy.stderr}`);
  for (const files of [{}, { [LIB]: `${GOOD[LIB]}\n/// Reads the bits of a value as a signed value.\n#[allow(unsafe_code, reason = "the FFI site of the plan, which passes the bits to C")]\npub fn bits(value: u32) -> i32 {\n    unsafe { std::mem::transmute_copy(&value) }\n}\n` }]) {
    const { failed, output } = lintOf(repository(t, files));
    assert.deepEqual(failed, [], output);
    assert.match(output, /Finished/);
  }
});

test('the Rust lint fails on each planted violation with the lint that names it', (t) => {
  for (const { name, files, finding } of VIOLATIONS) {
    const { failed, output } = lintOf(repository(t, files));
    assert.deepEqual(failed, ['cargo clippy .'], `${name}: the violation passed:\n${output}`);
    assert.match(output, finding, `${name} is not named:\n${output}`);
  }
});
