#!/usr/bin/env node
// Lints the Python of the checkout with the ruff and the vulture of mise.toml, through their shims (`make lint-python`):
//   - `ruff check .` and `ruff format --check .` on the root, which read the ruff configuration of the repository (ruff.toml or
//     the [tool.ruff] of pyproject.toml) by ruff's own discovery, and its exclusions (K1050).
//   - vulture on each Python package, a folder with a pyproject.toml: on its Python files of the checkout, from the package
//     folder, so vulture reads the [tool.vulture] of the package's pyproject.toml, its confidence included. A package keeps
//     code that only its consumers use by an entry of its vulture_whitelist.py; vulture reads the whitelist as one of the
//     package's files.
// A missing tool is a failure with its fix, never a skip; lint-steps.mts runs the steps.
//
//   node scripts/kit/lint-python.mts
import path from 'node:path';
import { foldersOf, lintCommands, lintMain, packageOwner, runLint } from './lint-steps.mts';
import type { LintStep } from './lint-steps.mts';
import { shimsPath } from './mise-tools.mts';
import { checkedFiles } from './tracked-files.mts';
import { present } from './present.mts';

/** The steps of the lint of `root`; throws when the checkout has no ruff or vulture of mise.toml installed. */
export function lintSteps(root: string): LintStep[] {
  // A repository without Python sources has nothing to lint: no tool and no configuration is needed (K319).
  const files = checkedFiles(root);
  if (!files.some(file => file.endsWith('.py'))) return [];
  const tools = lintCommands(root, shimsPath(root), ['ruff', 'vulture'], 'declare ruff and pypi:vulture in mise.toml and run make install-tools');
  const packages = foldersOf(root, 'pyproject.toml');
  const owner = packageOwner(packages);
  return [
    { label: 'ruff check .', command: present(tools.ruff, 'tools.ruff'), args: ['check', '.'], cwd: '.' },
    { label: 'ruff format --check .', command: present(tools.ruff, 'tools.ruff'), args: ['format', '--check', '.'], cwd: '.' },
    // A package without a Python file has no code for vulture.
    ...packages.map(folder => ({ folder, sources: files.filter(file => file.endsWith('.py') && owner(file) === folder).map(file => path.posix.relative(folder, file)) }))
      .filter(({ sources }) => sources.length > 0)
      .map(({ folder, sources }) => ({ label: `vulture ${folder}`, command: present(tools.vulture, 'tools.vulture'), args: sources, cwd: folder })),
  ];
}

/** Runs the steps of `root` and returns the labels of those that failed; the output of each step goes through `print`. */
export function lint(root: string, print: (text: string) => unknown = text => process.stdout.write(text)): string[] {
  return runLint('lint-python', lintSteps(root), root, print);
}

lintMain(import.meta.url, 'lint-python', lintSteps);
