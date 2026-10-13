// The manifest floors of a checkout, each compared with the pin of kit at the pin's precision (S4). The manifests are the
// files of checkedFiles, so the vendored fixture of kit and the installed directories are not read:
//   package.json   engines.node is ">=<node pin>"
//   composer.json  require.php is ">=<php pin>"; beside a composer.lock, config.platform.php is "<php pin>"
// Each other floor, and a missing one, is a finding that names the file, the key, the pin and the expected value.
import path from 'node:path';
import { readJson } from './bootstrap/files.mts';
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
