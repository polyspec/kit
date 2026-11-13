#!/usr/bin/env node
// Lints the Rust of the checkout (`make lint-rust`): `cargo clippy --workspace --all-targets` and the arguments of its command
// line, such as --locked, as the caller writes them (K1097), in the folder of each
// Cargo workspace, a Cargo.toml with a [workspace] table. The lints and their levels are the repository's own, in the
// [lints] of its Cargo.toml and its clippy.toml, which cargo and clippy read (K1050). cargo runs the
// toolchain that rust-toolchain.toml of the checkout pins; lint-steps.mts runs the steps. clippy runs through the cargo link with the
// checkouts of the link declaration (K448-5, K802): in a linked checkout a polyspec git dependency compiles against the
// sibling checkout, which the generated code of a consumer follows, not against its tag. The arguments before the first
// --workspace-args go to every step; --workspace-args <folder> gives the arguments that follow it, up to the next
// --workspace-args, only to the step of the workspace in that repository-relative folder (`.` for the root), so an --exclude of
// a package reaches only the workspace that holds it (K1195).
//
//   node scripts/kit/lint-rust.mts [<clippy arguments>] [--workspace-args <folder> <clippy arguments>]...
import path from 'node:path';
import { lintMain, runLint } from './lint-steps.mts';
import type { LintStep } from './lint-steps.mts';
import { checkedFiles } from './tracked-files.mts';
import { isTable } from './toml.mts';
import { readTomlFile } from './toolchain-files.mts';
import { siblingTool } from './paths.mts';

const WORKSPACE_ARGS = '--workspace-args';

const refusal = (named: string, folders: readonly string[]) => `${WORKSPACE_ARGS} names ${named}; it takes the repository-relative folder of a workspace: ${folders.join(', ')}`;

/**
 * The arguments of each workspace folder of `folders`: the arguments of `args` before the first --workspace-args, followed by
 * those that --workspace-args gives to that folder. A folder that is not one of `folders` and a --workspace-args without a
 * folder throw.
 */
function workspaceArgs(folders: readonly string[], args: readonly string[]): Map<string, string[]> {
  const first = args.indexOf(WORKSPACE_ARGS);
  const common = first === -1 ? [...args] : args.slice(0, first);
  const byFolder = new Map(folders.map(folder => [folder, [...common]]));
  const rest = first === -1 ? [] : args.slice(first);
  let current: string[] | undefined;
  let folderNext = false;
  for (const arg of rest) {
    if (folderNext) {
      current = byFolder.get(arg);
      if (current === undefined) throw new Error(refusal(`${JSON.stringify(arg)}, which holds no Cargo workspace of the checkout`, folders));
      folderNext = false;
    } else if (arg === WORKSPACE_ARGS) folderNext = true;
    else current?.push(arg);
  }
  if (folderNext) throw new Error(refusal('no folder', folders));
  return byFolder;
}

/**
 * The steps of the lint of `root`: one clippy run for each workspace of the checkout, with the arguments of the caller that
 * `args` gives to every workspace and to that workspace (K1195).
 */
export function lintSteps(root: string, args: readonly string[] = []): LintStep[] {
  const folders = checkedFiles(root)
    .filter(file => path.posix.basename(file) === 'Cargo.toml' && isTable(readTomlFile(root, file).workspace))
    .map(file => path.posix.dirname(file));
  return [...workspaceArgs(folders, args)].map(([folder, folderArgs]) => ({ label: `cargo clippy ${folder}`, command: process.execPath, args: [siblingTool(import.meta.url, 'link'), 'cargo', '.', 'clippy', '--workspace', '--all-targets', ...folderArgs], cwd: folder }));
}

/** Runs the steps of `root` and returns the labels of those that failed; the output of each step goes through `print`. */
export function lint(root: string, print: (text: string) => unknown = text => process.stdout.write(text)): string[] {
  return runLint('lint-rust', lintSteps(root), root, print);
}

lintMain(import.meta.url, 'lint-rust', lintSteps);
