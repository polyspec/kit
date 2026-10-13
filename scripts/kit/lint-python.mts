#!/usr/bin/env node
// Lints the Python of the checkout with the ruff and the vulture of var/tools (`make lint-python`):
//   - `ruff check` and `ruff format --check` on the root with --config ruff.toml, the configuration that kit copies, so every
//     Python file is checked with the rules of kit; config/layout.kit.yml forbids a nested ruff configuration. The var
//     directory holds the installed tools and is excluded.
//   - vulture on each Python package, a folder with a pyproject.toml: on its Python files of the checkout, from the package
//     folder, so vulture reads the [tool.vulture] exclusions of the package's pyproject.toml, and with the confidence of kit,
//     which a package cannot change. A package keeps code that only its consumers use by an entry of its vulture_whitelist.py,
//     with the reason; vulture reads the whitelist as one of the package's files.
// The rules are therefore the ones of the checkout, so one checkout gives one result on every machine. A missing
// declaration, tool or ruff.toml is a failure with its fix, never a skip. Every step runs, also after a failure of an earlier
// one, and each prints one line.
//
//   node scripts/kit/lint-python.mts
import { existsSync } from 'node:fs';
import path from 'node:path';
import { isMain, ROOT } from './paths.mts';
import { execute } from './process.mts';
import { toolchainConfig } from './bootstrap/toolchain-declared.mts';
import { checkedFiles } from './tracked-files.mts';

/** The confidence of vulture's findings that the lint reports: vulture's default, which reports unused functions and classes. */
export const VULTURE_CONFIDENCE = '60';

/** A step of the lint: the command, its arguments and the folder it runs in, relative to the root. */
export type LintStep = { label: string; command: string; args: string[]; cwd: string };

/** The steps of the lint of `root`; throws when the checkout declares no ruff or vulture, has none installed, or has no ruff.toml. */
export function lintSteps(root: string): LintStep[] {
  const config = toolchainConfig(root);
  const tools: Record<string, string> = {};
  for (const tool of ['ruff', 'vulture']) {
    if (!config[tool]) throw new Error(`config/toolchain.json declares no ${tool}; declare ${tool} with its version and the sha256 of its wheels`);
    const command = path.join(root, 'var/tools/bin', tool);
    if (!existsSync(command)) throw new Error(`${path.relative(root, command)} is missing; run make install-tools`);
    tools[tool] = command;
  }
  if (!existsSync(path.join(root, 'ruff.toml'))) throw new Error('ruff.toml is missing; it is the ruff configuration that kit copies into every repository (make kit-sync)');
  const files = checkedFiles(root);
  const packages = files.filter(file => path.posix.basename(file) === 'pyproject.toml').map(file => path.posix.dirname(file));
  // Each file belongs to the package of the deepest folder that holds it.
  const owner = (file: string) => packages.filter(folder => folder === '.' || file.startsWith(`${folder}/`)).sort((a, b) => b.length - a.length)[0];
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
  const failed: string[] = [];
  const steps = lintSteps(root);
  for (const step of steps) {
    const result = execute(step.command, step.args, { cwd: path.join(root, step.cwd) });
    print(`${result.stdout}${result.stderr}`);
    if (result.error || result.status !== 0) {
      failed.push(step.label);
      console.log(`[lint-python] ${step.label}: failed with ${result.error?.message ?? `exit status ${result.status}`}`);
    } else {
      console.log(`[lint-python] ${step.label}: passed`);
    }
  }
  return failed;
}

if (isMain(import.meta.url)) {
  try {
    const steps = lintSteps(ROOT).length;
    const failed = lint(ROOT);
    if (failed.length) {
      console.error(`[lint-python] ${failed.length} of ${steps} steps failed: ${failed.join('; ')}`);
      process.exitCode = 1;
    }
  } catch (error) {
    // lint and the modules it calls throw only an Error.
    console.error(`[lint-python] ${(error as Error).message}`);
    process.exitCode = 1;
  }
}
