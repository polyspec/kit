#!/usr/bin/env node
// Lints the Python of the checkout with the ruff and the vulture of mise.toml, through their shims (`make lint-python`):
//   - `ruff check` and `ruff format --check` on the root with --config ruff.toml, the configuration that kit copies, so every
//     Python file is checked with the rules of kit; config/layout.kit.yml forbids a nested ruff configuration. The var
//     directory holds the installed tools and is excluded.
//   - vulture on each Python package, a folder with a pyproject.toml: on its Python files of the checkout, from the package
//     folder, so vulture reads the [tool.vulture] exclusions of the package's pyproject.toml, and with the confidence of kit,
//     which a package cannot change. A package keeps code that only its consumers use by an entry of its vulture_whitelist.py,
//     with the reason; vulture reads the whitelist as one of the package's files.
// The rules are therefore the ones of the checkout, so one checkout gives one result on every machine. A missing tool or
// ruff.toml is a failure with its fix, never a skip; lint-steps.mts runs the steps.
//
//   node scripts/kit/lint-python.mts
import path from 'node:path';
import { foldersOf, lintCommands, lintMain, packageOwner, requireConfigurations, runLint } from './lint-steps.mts';
import type { LintStep } from './lint-steps.mts';
import { SHIMS } from './mise-tools.mts';
import { checkedFiles } from './tracked-files.mts';

/** The confidence of vulture's findings that the lint reports: vulture's default, which reports unused functions and classes. */
export const VULTURE_CONFIDENCE = '60';

/** The steps of the lint of `root`; throws when the checkout has no ruff or vulture of mise.toml installed, or no ruff.toml. */
export function lintSteps(root: string): LintStep[] {
  const tools = lintCommands(root, SHIMS, ['ruff', 'vulture'], 'declare ruff and pypi:vulture in mise.toml and run make install-tools');
  requireConfigurations(root, [['ruff.toml', 'ruff']]);
  const files = checkedFiles(root);
  const packages = foldersOf(root, 'pyproject.toml');
  const owner = packageOwner(packages);
  return [
    { label: 'ruff check .', command: tools.ruff!, args: ['check', '--config', 'ruff.toml', '--extend-exclude', 'var', '.'], cwd: '.' },
    { label: 'ruff format --check .', command: tools.ruff!, args: ['format', '--check', '--config', 'ruff.toml', '--extend-exclude', 'var', '.'], cwd: '.' },
    // A package without a Python file has no code for vulture.
    ...packages.map(folder => ({ folder, sources: files.filter(file => file.endsWith('.py') && owner(file) === folder).map(file => path.posix.relative(folder, file)) }))
      .filter(({ sources }) => sources.length > 0)
      .map(({ folder, sources }) => ({ label: `vulture ${folder}`, command: tools.vulture!, args: ['--min-confidence', VULTURE_CONFIDENCE, ...sources], cwd: folder })),
  ];
}

/** Runs the steps of `root` and returns the labels of those that failed; the output of each step goes through `print`. */
export function lint(root: string, print: (text: string) => unknown = text => process.stdout.write(text)): string[] {
  return runLint('lint-python', lintSteps(root), root, print);
}

lintMain(import.meta.url, 'lint-python', lintSteps);
