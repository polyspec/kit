#!/usr/bin/env node
// Downloads the modules of every tracked go.mod with `go mod download all`, the online step of make go-downloads-fetch, so that
// lock-check-go judges each go.mod offline (K1005); it fails with each go.mod and the first error line of go. Whether a module is
// present is the state of go, which kit does not check.
//
//   node scripts/kit/fetch-go-downloads.mts
import path from 'node:path';
import { isMain, repositoryRoot } from './paths.mts';
import { execute } from './process.mts';
import { checkedFiles } from './tracked-files.mts';

/** Runs `go mod download all` in the folder of every tracked go.mod of `root` and returns { modules, failures }. */
export function goDownloads({ root = repositoryRoot(), go = 'go', env = process.env, print = () => {} }: { root?: string; go?: string; env?: NodeJS.ProcessEnv; print?: (text: string) => void } = {}): { modules: string[]; failures: string[] } {
  const modules = checkedFiles(root).filter(file => path.posix.basename(file) === 'go.mod');
  const failures = modules.flatMap((module) => {
    const result = execute(go, ['mod', 'download', 'all'], { cwd: path.join(root, path.posix.dirname(module)), env });
    if (!result.error && result.status === 0) {
      print(`${module}: downloaded`);
      return [];
    }
    return [`${module}: ${result.error?.message ?? result.stderr.split('\n').find(line => line.trim() !== '') ?? `exit status ${result.status}`}`];
  });
  return { modules, failures };
}

if (isMain(import.meta.url)) {
  if (process.argv.length > 2) {
    console.error('Usage: node scripts/kit/fetch-go-downloads.mts');
    process.exit(2);
  }
  const { modules, failures } = goDownloads({ go: process.env.GO ?? 'go', print: text => console.log(`[go-downloads] ${text}`) });
  if (failures.length) {
    console.error(`[go-downloads] the modules of ${failures.length} of ${modules.length} go.mod files are not downloaded:\n${failures.join('\n')}\nfix the error of go`);
    process.exitCode = 1;
  }
}
