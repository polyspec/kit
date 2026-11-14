#!/usr/bin/env node
// The node_modules of a worktree (K1226): a directory of links, so the worktree installs nothing and runs its own source. Each top-level
// entry of the node_modules of its main checkout links to that entry; a scope directory is a real directory with one link per package
// in it; and each package that the workspace manifests of the worktree declare links into the worktree, so the worktree resolves its own
// packages from its own source. The main checkout is the common Git directory's work tree (K858), and the worktree is the working directory.
//
//   node scripts/kit/worktree-links.mts
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, statSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { isMain } from './paths.mts';

/** The main checkout of the worktree `worktree`: the work tree of its common Git directory. */
function mainCheckout(worktree: string): string {
  const result = spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: worktree, encoding: 'utf8' });
  if (result.error) throw new Error(`git rev-parse could not start in ${worktree}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${worktree} is not inside a Git work tree: ${result.stderr.trim()}`);
  return path.dirname(result.stdout.trim());
}

/** The packages that the workspace manifests of `worktree` declare: each workspace pattern names one folder or `dir/*`, one level deep. */
function ownPackages(worktree: string): Map<string, string> {
  const manifest: unknown = JSON.parse(readFileSync(path.join(worktree, 'package.json'), 'utf8'));
  const workspaces: unknown = typeof manifest === 'object' && manifest !== null && 'workspaces' in manifest ? manifest.workspaces : undefined;
  const patterns: unknown[] = Array.isArray(workspaces) ? workspaces : [];
  const folders: string[] = [];
  for (const pattern of patterns) {
    if (typeof pattern !== 'string') throw new Error(`workspace ${JSON.stringify(pattern)} of ${worktree}/package.json is not a string`);
    if (pattern.endsWith('/*')) {
      const parent = path.join(worktree, pattern.slice(0, -2));
      if (!existsSync(parent)) continue;
      for (const child of readdirSync(parent).sort()) {
        if (existsSync(path.join(parent, child, 'package.json'))) folders.push(path.join(parent, child));
      }
    } else if (pattern.includes('*')) {
      throw new Error(`workspace pattern ${JSON.stringify(pattern)} is not supported: name a folder or a folder followed by /*`);
    } else {
      folders.push(path.join(worktree, pattern));
    }
  }
  const packages = new Map<string, string>();
  for (const folder of folders) {
    const named: unknown = JSON.parse(readFileSync(path.join(folder, 'package.json'), 'utf8'));
    const name: unknown = typeof named === 'object' && named !== null && 'name' in named ? named.name : undefined;
    if (typeof name !== 'string' || name === '') throw new Error(`${folder}/package.json names no package`);
    packages.set(name, folder);
  }
  return packages;
}

/** True when `entry` is a real directory (not a link). */
const isRealDirectory = (entry: string): boolean => lstatSync(entry).isDirectory();

/** Refuses a worktree node_modules that holds an installed package: its entries must be links, or scope directories of links. */
function refuseInstalled(nodeModules: string): void {
  for (const entry of readdirSync(nodeModules)) {
    const full = path.join(nodeModules, entry);
    if (lstatSync(full).isSymbolicLink()) continue;
    if (entry.startsWith('@') && isRealDirectory(full)) {
      for (const child of readdirSync(full)) {
        if (!lstatSync(path.join(full, child)).isSymbolicLink()) {
          throw new Error(`${path.join(full, child)} holds an installed package, not a link; remove node_modules of the worktree and run again`);
        }
      }
      continue;
    }
    throw new Error(`${full} holds an installed package, not a link; remove node_modules of the worktree and run again`);
  }
}

/**
 * Makes the node_modules of `worktree` as its main checkout's links and its own workspace packages (K1226). Returns the folder of node_modules.
 * Throws before it writes when the main checkout holds no node_modules or the worktree node_modules holds an installed package.
 */
export function linkNodeModules(worktree: string): string {
  const main = mainCheckout(worktree);
  const source = path.join(main, 'node_modules');
  if (!existsSync(source) || !statSync(source).isDirectory()) {
    throw new Error(`${source} is missing: the main checkout holds no node_modules to link; install it in ${main} first`);
  }
  const target = path.join(worktree, 'node_modules');
  if (existsSync(target)) {
    if (!isRealDirectory(target)) throw new Error(`${target} is not a directory`);
    refuseInstalled(target);
    rmSync(target, { recursive: true });
  }
  const own = ownPackages(worktree);
  mkdirSync(target);
  const ownPaths = new Set([...own.keys()].map(name => path.join(target, name)));
  for (const entry of readdirSync(source).sort()) {
    const from = path.join(source, entry);
    if (entry.startsWith('@') && isRealDirectory(from)) {
      mkdirSync(path.join(target, entry));
      for (const child of readdirSync(from).sort()) {
        const link = path.join(target, entry, child);
        if (!ownPaths.has(link)) symlinkSync(path.join(from, child), link);
      }
    } else if (!ownPaths.has(path.join(target, entry))) {
      symlinkSync(from, path.join(target, entry));
    }
  }
  for (const [name, folder] of [...own.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const link = path.join(target, name);
    mkdirSync(path.dirname(link), { recursive: true });
    rmSync(link, { force: true });
    symlinkSync(folder, link);
  }
  return target;
}

if (isMain(import.meta.url)) {
  try {
    console.log(`[worktree-links] ready: ${linkNodeModules(process.cwd())}`);
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    console.error(`[worktree-links] ${error.message}`);
    process.exit(1);
  }
}
