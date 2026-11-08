#!/usr/bin/env node
// Lints the Rust of the checkout (`make lint-rust`): `cargo clippy --workspace --all-targets` and the arguments of its command
// line, such as --locked, as the caller writes them (K1097), in the folder of each
// Cargo workspace, a Cargo.toml with a [workspace] table. The lints and their levels are the repository's own, in the
// [lints] of its Cargo.toml and its clippy.toml, which cargo and clippy read (K1050). cargo runs the
// toolchain that rust-toolchain.toml of the checkout pins; lint-steps.mts runs the steps. clippy runs through the cargo link with the
// checkouts of the link declaration (K448-5, K802): in a linked checkout a polyspec git dependency compiles against the
// sibling checkout, which the generated code of a consumer follows, not against its tag.
//
//   node scripts/kit/lint-rust.mts [<clippy arguments>]
import path from 'node:path';
import { lintMain, runLint } from './lint-steps.mts';
import type { LintStep } from './lint-steps.mts';
import { checkedFiles } from './tracked-files.mts';
import { isTable } from './toml.mts';
import { readTomlFile } from './toolchain-files.mts';
import { siblingTool } from './paths.mts';

/**
 * The steps of the lint of `root`: one clippy run for each workspace of the checkout, with the arguments `args` of the caller.
 */
export function lintSteps(root: string, args: readonly string[] = []): LintStep[] {
  return checkedFiles(root)
    .filter(file => path.posix.basename(file) === 'Cargo.toml' && isTable(readTomlFile(root, file).workspace))
    .map(file => path.posix.dirname(file))
    .map(folder => ({ label: `cargo clippy ${folder}`, command: process.execPath, args: [siblingTool(import.meta.url, 'link'), 'cargo', '.', 'clippy', '--workspace', '--all-targets', ...args], cwd: folder }));
}

/** Runs the steps of `root` and returns the labels of those that failed; the output of each step goes through `print`. */
export function lint(root: string, print: (text: string) => unknown = text => process.stdout.write(text)): string[] {
  return runLint('lint-rust', lintSteps(root), root, print);
}

lintMain(import.meta.url, 'lint-rust', lintSteps);
