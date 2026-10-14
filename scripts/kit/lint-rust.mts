#!/usr/bin/env node
// Lints the Rust of the checkout (`make lint-rust`): `cargo clippy --workspace --all-targets --locked -- -D warnings` in the
// folder of each Cargo workspace, a Cargo.toml with a [workspace] table, so every warning of rustc and clippy fails. The
// lints of a workspace deny unsafe code and an allow attribute without its reason, and every package takes them
// (config/cargo.schema.json, which make layout-check runs), so a package outside a workspace fails there. cargo runs the
// toolchain that rust-toolchain.toml of the checkout pins; lint-steps.mts runs the steps.
//
//   node scripts/kit/lint-rust.mts
import path from 'node:path';
import { lintMain, runLint } from './lint-steps.mts';
import type { LintStep } from './lint-steps.mts';
import { checkedFiles } from './tracked-files.mts';
import { isTable } from './toml.mts';
import { readTomlFile } from './toolchain-files.mts';

/** The steps of the lint of `root`: one clippy run for each workspace of the checkout. */
export function lintSteps(root: string): LintStep[] {
  return checkedFiles(root)
    .filter(file => path.posix.basename(file) === 'Cargo.toml' && isTable(readTomlFile(root, file).workspace))
    .map(file => path.posix.dirname(file))
    .map(folder => ({ label: `cargo clippy ${folder}`, command: 'cargo', args: ['clippy', '--workspace', '--all-targets', '--locked', '--', '-D', 'warnings'], cwd: folder }));
}

/** Runs the steps of `root` and returns the labels of those that failed; the output of each step goes through `print`. */
export function lint(root: string, print: (text: string) => unknown = text => process.stdout.write(text)): string[] {
  return runLint('lint-rust', lintSteps(root), root, print);
}

lintMain(import.meta.url, 'lint-rust', lintSteps);
