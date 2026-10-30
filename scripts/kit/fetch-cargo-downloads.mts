#!/usr/bin/env node
// Downloads the crates of every tracked Cargo.lock and of the lock of kit's catch-check with `cargo fetch --locked`, the
// online step of make cargo-downloads-fetch, and fails with each lock and the first error line of cargo. Whether a crate is
// present is the state of cargo, which kit does not check (K864).
//
//   node scripts/kit/fetch-cargo-downloads.mts
import path from 'node:path';
import { CATCH_CHECK_MANIFEST } from './lint-rust.mts';
import { kitPackageRoot } from './kit-files.mts';
import { isMain, repositoryRoot } from './paths.mts';
import { execute } from './process.mts';
import { checkedFiles } from './tracked-files.mts';

/** Runs `cargo fetch --locked` for every Cargo lock of `root` and returns { locks, failures }: one failure line per lock with the first error line of cargo. */
export function cargoDownloads({ root = repositoryRoot(), providerRoot = kitPackageRoot(), cargo = 'cargo', env = process.env, print = () => {} }: { root?: string; providerRoot?: string; cargo?: string; env?: NodeJS.ProcessEnv; print?: (text: string) => void } = {}) {
  const failures: string[] = [];
  const locks = checkedFiles(root).filter(file => path.posix.basename(file) === 'Cargo.lock');
  const providerLock = path.resolve(providerRoot, path.dirname(CATCH_CHECK_MANIFEST), 'Cargo.lock');
  if (!locks.some(lock => path.resolve(root, lock) === providerLock)) locks.push(providerLock);
  for (const lock of locks) {
    const result = execute(cargo, ['fetch', '--locked', '--manifest-path', path.join(path.dirname(lock), 'Cargo.toml')], { cwd: root, env });
    if (result.error || result.status !== 0) {
      failures.push(`${lock}: ${result.error?.message ?? result.stderr.split('\n').find(line => line.startsWith('error')) ?? `exit status ${result.status}`}`);
    } else {
      print(`${lock}: fetched`);
    }
  }
  return { locks, failures };
}

if (isMain(import.meta.url)) {
  if (process.argv.length > 2) {
    console.error('Usage: node scripts/kit/fetch-cargo-downloads.mts');
    process.exit(2);
  }
  const { locks, failures } = cargoDownloads({ cargo: process.env.CARGO ?? 'cargo', print: text => console.log(`[cargo-downloads] ${text}`) });
  if (failures.length) {
    console.error(`[cargo-downloads] the crates of ${failures.length} of ${locks.length} Cargo.lock files are not fetched:\n${failures.join('\n')}\nfix the error of cargo`);
    process.exitCode = 1;
  }
}
