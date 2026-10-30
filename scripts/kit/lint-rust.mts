#!/usr/bin/env node
// Lints the Rust of the checkout (`make lint-rust`): `cargo clippy --workspace --all-targets --locked -- -D warnings` in the
// folder of each Cargo workspace, a Cargo.toml with a [workspace] table, so every warning of rustc and clippy fails. The
// lints of a workspace deny unsafe code and an allow attribute without its reason, and every package takes them
// (config/cargo.schema.json, which make layout-check runs), so a package outside a workspace fails there. cargo runs the
// toolchain that rust-toolchain.toml of the checkout pins; lint-steps.mts runs the steps. clippy runs through the cargo link with the
// sibling checkouts, as make cargo-fetch does (K448-5, K802): in a linked checkout a polyspec git dependency compiles against the
// sibling checkout, which the generated code of a consumer follows, not against its tag.
//
//   node scripts/kit/lint-rust.mts
import path from 'node:path';
import { lintMain, runLint } from './lint-steps.mts';
import type { LintStep } from './lint-steps.mts';
import { checkedFiles } from './tracked-files.mts';
import { isTable } from './toml.mts';
import { readTomlFile } from './toolchain-files.mts';
import { kitPackageRoot } from './kit-files.mts';
import { siblingTool } from './paths.mts';

/**
 * The lints that deny a hidden error (P8, K334), after -D warnings: a must_use value that is dropped, a `let _` of a must_use or
 * untyped value, a map_err that ignores its error, and an allow attribute without its reason. The clippy.toml of the kit package (K514, through CLIPPY_CONF_DIR)
 * disallows Result::ok and the unwrap_or family.
 */
export const P8_LINTS = ['-D', 'unused_must_use', '-D', 'clippy::let_underscore_must_use', '-D', 'clippy::let_underscore_untyped', '-D', 'clippy::map_err_ignore', '-D', 'clippy::allow_attributes_without_reason'];

/** The manifest of the Rust half of the catch check (K537), a crate of the kit package that syn builds offline. */
export const CATCH_CHECK_MANIFEST = 'scripts/kit/catch-check-rust/Cargo.toml';

/**
 * The steps of the lint of `root`: one clippy run for each workspace of the checkout, and the catch check of its Rust files
 * (K537), which refuses an Err(..) arm or `if let Err(..)` branch without a statement, a pattern that clippy does not lint.
 */
export function lintSteps(root: string): LintStep[] {
  const files = checkedFiles(root);
  const rust = files.filter(file => file.endsWith('.rs'));
  const catchCheck: LintStep[] = rust.length === 0 ? [] : [{
    label: 'catch-check rust',
    command: 'cargo',
    args: ['run', '--quiet', '--offline', '--locked', '--manifest-path', path.join(kitPackageRoot(), CATCH_CHECK_MANIFEST), '--', ...rust],
    cwd: '.',
    env: { CARGO_TARGET_DIR: path.join(root, 'var/kit/catch-check-rust') },
  }];
  return [...files
    .filter(file => path.posix.basename(file) === 'Cargo.toml' && isTable(readTomlFile(root, file).workspace))
    .map(file => path.posix.dirname(file))
    .map(folder => ({ label: `cargo clippy ${folder}`, command: process.execPath, args: [siblingTool(import.meta.url, 'link'), 'cargo', '.', 'clippy', '--workspace', '--all-targets', '--locked', '--', '-D', 'warnings', ...P8_LINTS], cwd: folder, env: { CLIPPY_CONF_DIR: kitPackageRoot() } })), ...catchCheck];
}

/** Runs the steps of `root` and returns the labels of those that failed; the output of each step goes through `print`. */
export function lint(root: string, print: (text: string) => unknown = text => process.stdout.write(text)): string[] {
  return runLint('lint-rust', lintSteps(root), root, print);
}

lintMain(import.meta.url, 'lint-rust', lintSteps);
