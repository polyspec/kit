#!/usr/bin/env node
// The test targets of a repository (K244):
//
//   make test-<runtime> CASES=<pattern>   the unit tests of each package of the runtime (packages/<runtime> or
//                                         packages/<component>/<runtime>), where its runner finds them, run through
//                                         run-tests.mts in the folder of the package with the name filter of the runner
//   make test-integration                 the folder of each runtime under tests/integration/ of the root
//   make test-conformance                 the folder of each runtime under tests/conformance/ of the root
//
// A unit test stays where the runner of its ecosystem finds it (S1): beside the code in Go, in src or tests of a crate, in the
// tests of a package elsewhere. The integration and conformance suites cross packages, so they live at the root, where a run
// in a package never reaches them. A run without CASES runs every unit test of the runtime, which run-tests allows only in CI
// (test-selection.mts); a suite runs only in CI (ci-only.mts).
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { isJsonObject } from './bootstrap/files.mts';
import { isTestFile } from './check-commits.mts';
import { ciRefusal } from './ci-only.mts';
import { implementationFolders } from './parity-declaration.mts';
import { isMain, repositoryRoot, siblingTool } from './paths.mts';
import { trackedFiles } from './tracked-files.mts';

/** A run of run-tests.mts: the folder, relative to the root, the tool and its arguments. */
export type Run = { cwd: string; tool: string; args: string[] };

// The runtimes of a package and the suites of the root.
export const RUNTIMES = ['go', 'js', 'php', 'python', 'rust', 'ts'] as const;
export const SUITES = ['integration', 'conformance'] as const;
const SCRIPT = /\.[cm]?[jt]sx?$/;

/** The relative paths of the tracked test scripts of `folder` among `files`. */
const scriptTests = (files: readonly string[], folder: string) => files.filter(file => file.startsWith(`${folder}/`) && SCRIPT.test(file) && isTestFile(file)).map(file => path.posix.relative(folder, file));

/** The run of the runner of `runtime` in `folder` with the name filter `cases`; `vitest` says whether the folder uses vitest. */
function runsOf(files: readonly string[], runtime: string, folder: string, cases: string | undefined, vitest: (folder: string) => boolean): Run[] {
  const filter = (flag: string) => (cases === undefined ? [] : [flag, cases]);
  switch (runtime) {
    case 'ts':
    case 'js':
      return [vitest(folder) ? { cwd: folder, tool: 'vitest', args: filter('-t') } : { cwd: folder, tool: 'node', args: [...filter('--test-name-pattern'), ...scriptTests(files, folder)] }];
    case 'go':
      return files.filter(file => file.startsWith(`${folder}/`) && path.posix.basename(file) === 'go.mod').map(file => ({ cwd: path.posix.dirname(file), tool: 'go', args: [...filter('-run'), './...'] }));
    case 'rust':
      return [{ cwd: folder, tool: 'cargo', args: cases === undefined ? [] : [cases] }];
    case 'php':
      return [{ cwd: folder, tool: 'phpunit', args: filter('--filter') }];
    case 'python':
      return [{ cwd: folder, tool: 'python', args: filter('-k') }];
  }
  throw new Error(`the runtime ${runtime} is none of ${RUNTIMES.join(', ')}`);
}

/** The runs of the unit tests of the packages of `runtime` among the tracked `files`; throws when no package has it. */
export function runtimeRuns(files: readonly string[], runtime: string, cases: string | undefined, vitest: (folder: string) => boolean): Run[] {
  const folders = implementationFolders(files).filter(folder => path.posix.basename(folder) === runtime);
  if (folders.length === 0) throw new Error(`no package of the runtime ${runtime}: packages/${runtime} or packages/<component>/${runtime}`);
  return folders.flatMap(folder => runsOf(files, runtime, folder, cases, vitest));
}

/** The runs of the suite `suite`: the folder of each runtime under tests/<suite>/ of the root. */
export function suiteRuns(files: readonly string[], suite: string, vitest: (folder: string) => boolean): Run[] {
  const runtimes = RUNTIMES.filter(runtime => files.some(file => file.startsWith(`tests/${suite}/${runtime}/`)));
  return runtimes.flatMap(runtime => runsOf(files, runtime, `tests/${suite}/${runtime}`, undefined, vitest));
}

/** Whether the package.json of `folder` under `root`, or that of the root, declares vitest. */
function usesVitest(root: string, folder: string): boolean {
  return [folder, '.'].some(place => {
    const file = path.join(root, place, 'package.json');
    if (!existsSync(file)) return false;
    const manifest: unknown = JSON.parse(readFileSync(file, 'utf8'));
    return isJsonObject(manifest) && ['dependencies', 'devDependencies'].some(field => isJsonObject(manifest[field]) && 'vitest' in manifest[field]);
  });
}

if (isMain(import.meta.url)) {
  const root = repositoryRoot();
  const [target = ''] = process.argv.slice(2);
  const files = trackedFiles(root);
  const vitest = (folder: string) => usesVitest(root, folder);
  const suite = (SUITES as readonly string[]).includes(target);
  const refused = suite ? ciRefusal(`make test-${target}`) : null;
  if (refused) {
    console.error(`[test-runtime] ${refused}`);
    process.exit(1);
  }
  let runs: Run[];
  try {
    runs = suite ? suiteRuns(files, target, vitest) : runtimeRuns(files, target, process.env.CASES || undefined, vitest);
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    console.error(`[test-runtime] ${error.message}`);
    process.exit(1);
  }
  if (runs.length === 0) {
    console.error(`[test-runtime] tests/${target}/ holds no folder of a runtime`);
    process.exit(1);
  }
  let failed = 0;
  for (const run of runs) {
    const result = spawnSync(process.execPath, [siblingTool(import.meta.url, 'run-tests'), run.tool, '--cwd', run.cwd, '--', ...run.args], { cwd: root, stdio: 'inherit' });
    if (result.status !== 0) failed += 1;
  }
  process.exit(failed ? 1 : 0);
}
