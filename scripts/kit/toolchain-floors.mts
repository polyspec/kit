// The manifest floors of a checkout, each compared with the pin of kit at the pin's precision (S4). The manifests are the
// files of checkedFiles, so the vendored fixture of kit and the installed directories are not read:
//   package.json   engines.node is ">=<node pin>"
//   composer.json  require.php is ">=<php pin>"; beside a composer.lock, config.platform.php is "<php pin>"
//   pyproject.toml project.requires-python is ">=<python pin>", when it has a project table (read by toolchain-files.mts)
//   go.mod         go is "<go pin>" and no toolchain line, which the go command drops when it equals the go line
// Each other floor, and a missing one, is a finding that names the file, the key, the pin and the expected value.
import path from 'node:path';
import { readJson } from './bootstrap/files.mts';
import { readGoMod, readToml } from './toolchain-files.mts';
import type { Pins, Tool } from './toolchain-pins.mts';
import { checkedFiles } from './tracked-files.mts';

const named = (root: string, name: string): string[] => checkedFiles(root).filter(file => path.posix.basename(file) === name);

// The finding of the floor `key` of `file`, which holds `actual` where kit pins `tool` and expects `expected`; none when equal.
function floor(file: string, key: string, actual: unknown, tool: Tool, pins: Pins, expected: string): string[] {
  if (actual === expected) return [];
  return [`${file}: ${key} is ${actual === undefined ? 'missing' : JSON.stringify(actual)}; kit pins ${tool} ${pins[tool]}, so it must be "${expected}"`];
}

/** One line for each package.json whose engines.node is not `>=` the Node.js pin. */
export const enginesFindings = (root: string, pins: Pins): string[] => named(root, 'package.json')
  .flatMap(file => floor(file, 'engines.node', readJson(root, file).engines?.node, 'node', pins, `>=${pins.node}`));

/**
 * One line for each composer.json whose require.php is not `>=` the PHP pin, and for each one beside a composer.lock
 * whose config.platform.php is not the pin: Composer resolves the lock of a root package for that platform.
 */
export function composerFindings(root: string, pins: Pins): string[] {
  const locks = new Set(named(root, 'composer.lock'));
  return named(root, 'composer.json').flatMap((file) => {
    const manifest = readJson(root, file);
    const locked = locks.has(path.posix.join(path.posix.dirname(file), 'composer.lock'));
    return [
      ...floor(file, 'require.php', manifest.require?.php, 'php', pins, `>=${pins.php}`),
      ...(locked ? floor(file, 'config.platform.php', manifest.config?.platform?.php, 'php', pins, pins.php) : []),
    ];
  });
}

/** One line for each pyproject.toml with a project table whose requires-python is not `>=` the Python pin; `env` runs the reader. */
export const pyprojectFindings = (root: string, pins: Pins, env: NodeJS.ProcessEnv): string[] => named(root, 'pyproject.toml').flatMap((file) => {
  // tomllib returns a table for a TOML document; project, when present, is a table too.
  const project = (readToml(root, file, env) as { project?: Record<string, unknown> }).project;
  return project ? floor(file, 'project.requires-python', project['requires-python'], 'python', pins, `>=${pins.python}`) : [];
});

/** One line for each go.mod whose go line is not the Go pin, and for each with a toolchain line; `env` runs the go command. */
export const goModFindings = (root: string, pins: Pins, env: NodeJS.ProcessEnv): string[] => named(root, 'go.mod').flatMap((file) => {
  const mod = readGoMod(root, file, env);
  return [
    ...floor(file, 'go', mod.Go, 'go', pins, pins.go),
    ...(mod.Toolchain ? [`${file}: toolchain is ${JSON.stringify(mod.Toolchain)}; kit pins go ${pins.go} in the go line, so remove the toolchain line`] : []),
  ];
});
