#!/usr/bin/env node
// Lints the Rust of the checkout (`make lint-rust`): `cargo clippy --workspace --all-targets --locked -- -D warnings` in the
// folder of each Cargo workspace, a Cargo.toml with a [workspace] table, so every warning of rustc and clippy fails. The
// lints of a workspace deny unsafe code and an allow attribute without its reason, and every package takes them
// (config/cargo.schema.json, which make layout-check runs), so a package outside a workspace fails there. cargo runs the
// toolchain that rust-toolchain.toml of the checkout pins. Every step runs, also after a failure of an earlier one, and each
// prints one line.
//
//   node scripts/kit/lint-rust.mts
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { isMain, ROOT } from './paths.mts';
import { execute } from './process.mts';
import { checkedFiles } from './tracked-files.mts';

/** A step of the lint: the command, its arguments and the folder it runs in, relative to the root. */
export type LintStep = { label: string; command: string; args: string[]; cwd: string };

/** The steps of the lint of `root`: one clippy run for each workspace of the checkout. */
export function lintSteps(root: string): LintStep[] {
  return checkedFiles(root)
    .filter(file => path.posix.basename(file) === 'Cargo.toml' && /^\[workspace\]\s*$/m.test(readFileSync(path.join(root, file), 'utf8')))
    .map(file => path.posix.dirname(file))
    .map(folder => ({ label: `cargo clippy ${folder}`, command: 'cargo', args: ['clippy', '--workspace', '--all-targets', '--locked', '--', '-D', 'warnings'], cwd: folder }));
}

/** Runs the steps of `root` and returns the labels of those that failed; the output of each step goes through `print`. */
export function lint(root: string, print: (text: string) => unknown = text => process.stdout.write(text)): string[] {
  const failed: string[] = [];
  for (const step of lintSteps(root)) {
    const result = execute(step.command, step.args, { cwd: path.join(root, step.cwd) });
    print(`${result.stdout}${result.stderr}`);
    if (result.error || result.status !== 0) {
      failed.push(step.label);
      console.log(`[lint-rust] ${step.label}: failed with ${result.error?.message ?? `exit status ${result.status}`}`);
    } else {
      console.log(`[lint-rust] ${step.label}: passed`);
    }
  }
  return failed;
}

if (isMain(import.meta.url)) {
  try {
    const failed = lint(ROOT);
    if (failed.length) {
      console.error(`[lint-rust] ${failed.length} steps failed: ${failed.join('; ')}`);
      process.exitCode = 1;
    }
  } catch (error) {
    // lint and the modules it calls throw only an Error.
    console.error(`[lint-rust] ${(error as Error).message}`);
    process.exitCode = 1;
  }
}
