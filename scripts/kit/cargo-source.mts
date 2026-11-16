// Cargo owns resolution. These helpers select the graph options for workspace metadata and inspect its selected sources.
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { isJsonObject } from './bootstrap/files.mts';

/** The graph options shared by native Cargo commands and metadata; execution options remain with the original command. */
export function cargoMetadataArguments(args: readonly string[]): string[] {
  const result: string[] = [];
  const valued = new Set(['--features', '-F', '--manifest-path', '--config', '-Z', '--target']);
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === undefined || argument === '--') break;
    if (argument.startsWith('+') && index === 0) continue;
    if (argument === '--offline' || argument === '--frozen' || argument === '--all-features' || argument === '--no-default-features') result.push(argument);
    else if (valued.has(argument)) {
      const value = args[++index];
      if (value === undefined) throw new Error(`Cargo option ${argument} has no value`);
      result.push(argument === '--target' ? '--filter-platform' : argument, value);
    } else {
      const match = /^(--features|--manifest-path|--config|--target)=(.*)$/.exec(argument);
      if (match) result.push(`${match[1] === '--target' ? '--filter-platform' : match[1]}=${match[2]}`);
      else if (/^(-F|-Z).+/.test(argument)) result.push(argument);
    }
  }
  return result;
}

/** The version of the [package] of the Cargo.toml in `folder`, or undefined when it states none of its own (a workspace version). */
function packageVersion(folder: string): string | undefined {
  const section = /^\[package\]\s*$([\s\S]*?)(?=^\[|(?![\s\S]))/m.exec(readFileSync(path.join(folder, 'Cargo.toml'), 'utf8'))?.[1] ?? '';
  return /^version\s*=\s*"([^"]+)"/m.exec(section)?.[1];
}

/** Reject a selected sibling release instead of the requested development source; IDs are opaque Cargo identifiers. */
export function verifyCargoSources(text: string, expected: ReadonlyMap<string, string>): void {
  const metadata: unknown = JSON.parse(text);
  if (!isJsonObject(metadata) || !Array.isArray(metadata.packages) || !isJsonObject(metadata.resolve) || !Array.isArray(metadata.resolve.nodes)) throw new Error('cargo metadata did not return a resolved workspace graph');
  const selected = new Set(metadata.resolve.nodes.map(node => {
    if (!isJsonObject(node) || typeof node.id !== 'string') throw new Error('cargo metadata has a resolved node without an id');
    return node.id;
  }));
  for (const item of metadata.packages) {
    if (!isJsonObject(item) || typeof item.id !== 'string' || typeof item.name !== 'string' || typeof item.manifest_path !== 'string') throw new Error('cargo metadata has a package without its id, name or manifest_path');
    const folder = expected.get(item.name);
    if (!folder || !selected.has(item.id)) continue;
    if (realpathSync(item.manifest_path) === realpathSync(path.join(folder, 'Cargo.toml'))) continue;
    // K1269: the lock copy is already updated for the patch, so the requirement of the consumer admits no version of the checkout.
    const provided = packageVersion(folder);
    const version = typeof item.version === 'string' ? ` ${item.version}` : '';
    throw new Error(`Cargo selected ${item.name}${version} at ${item.manifest_path}, instead of development source ${folder}; the requirement or git tag of ${item.name} in the consumer Cargo.toml admits no version${provided === undefined ? '' : ` ${provided}`} of the checkout, so Cargo cannot use it; a requirement by git and tag admits every version, and an exact version requirement is widened in the consumer`);
  }
}
