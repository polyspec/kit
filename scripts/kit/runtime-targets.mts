#!/usr/bin/env node
// The targets of a repository by runtime (K244, K246):
//
//   make test-<runtime> CASES=<pattern>   the unit tests of each package of the runtime (packages/<runtime> or
//                                         packages/<component>/<runtime>), where its runner finds them, run through
//                                         run-tests.mts in the folder of the package with the name filter of the runner
//   make test-integration                 the folder of each runtime under tests/integration/ of the root
//   make test-conformance                 the folder of each runtime under tests/conformance/ of the root
//   make build-<runtime>                  the build of the ecosystem in each package of the runtime: go build, cargo build,
//                                         tsc with the tsconfig.build.json of the package, uv build; a PHP library has none
//   make build, make test, make lint      the target of each runtime that packages/ holds
//
// The PHP extension of packages/php-ext has targets of its own (php-extension.mts, S10): its unit tests run on PHPUnit with
// the extension that build-php-ext published loaded.
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
import { extensionNames, repositoryOf } from './php-extension.mts';
import { trackedFiles } from './tracked-files.mts';
import { listedTests } from './run-tests.mts';

/** A run of run-tests.mts: the folder, relative to the root, the tool, the options of run-tests and the arguments of the tool. */
export type Run = { cwd: string; tool: string; options?: string[]; args: string[] };

// The runtimes of a package and the suites of the root.
export const RUNTIMES = ['go', 'js', 'php', 'php-ext', 'python', 'rust', 'ts'] as const;
export const SUITES = ['integration', 'conformance'] as const;
const SCRIPT = /\.[cm]?[jt]sx?$/;
// The test files of the node and vitest runners (the conventions of parity-declaration.mts): a file named *.test.* or *.spec.*. A helper or
// a probe in tests/ is no test, and node would run it as one (K325).
const NODE_TEST = /\.(?:test|spec)\.[cm]?[jt]sx?$/;

/** The relative paths of the tracked test scripts of `folder` among `files`. */
const scriptTests = (files: readonly string[], folder: string) => files.filter(file => file.startsWith(`${folder}/`) && SCRIPT.test(file) && NODE_TEST.test(file)).map(file => path.posix.relative(folder, file));

/**
 * The folders whose PHPUnit files test the PHP extension `folder` (S10 ruling 8): every PHP library of the repository,
 * packages/php or packages/<component>/php, and the extension itself when it holds tests of its own; the extension alone when
 * no library holds a test.
 */
export function phpExtensionFolders(files: readonly string[], folder: string): string[] {
  const libraries = [...new Set(files.flatMap(file => /^(packages\/(?:[^/]+\/)?php)\//.exec(file)?.[1] ?? []))].sort();
  const holds = (place: string) => files.some(file => file.startsWith(`${place}/`) && isTestFile(file));
  const places = [...libraries, folder].filter(place => holds(place));
  return places.length ? places : [folder];
}

/**
 * Throws when a test directory of the Python package `folder` is no package: unittest discovers a directory only as a package,
 * so `make test-python` over a tests/ without __init__.py finds no test and ends with "no test ran" (K298).
 */
function pythonPackages(files: readonly string[], folder: string): void {
  const depth = folder.split('/').length;
  const tests = files.filter(file => file.startsWith(`${folder}/tests/`) && /(?:^|\/)test_[^/]*\.py$/.test(file));
  const directories = new Set(tests.flatMap((file) => {
    const parts = path.posix.dirname(file).split('/');
    return parts.slice(depth).map((_, index) => parts.slice(0, depth + index + 1).join('/'));
  }));
  for (const directory of [...directories].sort()) {
    if (!files.includes(`${directory}/__init__.py`)) throw new Error(`${directory}: unittest discovers a directory only as a package; add ${directory}/__init__.py`);
  }
}

/**
 * The tests that a run selects, as PHPUnit lists them with --list-tests (K390-1); the main of this file passes the real listing, and
 * a test passes a fixed one.
 */
export type Listed = (run: Run) => string[];

/** The run of PHPUnit of the PHP library `cwd` against the built extension of the folder `folder`, with the arguments `args` (K329). */
function phpExtensionRun(cwd: string, folder: string, extension: string, args: string[]): Run {
  return { cwd, tool: 'phpunit', options: ['--php-extension', extension, ...(cwd === folder ? [] : ['--without-library', cwd])], args };
}

// The listing of a run is needed only when CASES names a test; a caller that passes none gets this error.
const unlisted: Listed = () => {
  throw new Error('CASES selects the tests of a PHP library by PHPUnit, which needs the listing of the run');
};

/**
 * The run of the runner of `runtime` in `folder` with the name filter `cases`; `vitest` says whether the folder uses vitest,
 * `extension` is the built library of the PHP extension, which its tests load, and `listed` tells the tests that a run selects.
 * A PHP library where `cases` selects no test is not run: its line goes to `notes`.
 */
function runsOf(files: readonly string[], runtime: string, folder: string, cases: string | undefined, vitest: (folder: string) => boolean, extension?: string, venv?: (folder: string) => string | undefined, listed: Listed = unlisted, notes: string[] = []): Run[] {
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
    case 'php-ext':
      if (extension === undefined) throw new Error(`the tests of ${folder} load the built extension, which is not named`);
      // The tests of a library run against the extension with none of the library's sources (K329); the tests of the extension itself
      // load its own sources. CASES is one filter for every library, so a library where PHPUnit lists no test for it is not run (K390):
      // a filter that selects no test anywhere is a typo, and fails.
      const runs = phpExtensionFolders(files, folder).map(cwd => phpExtensionRun(cwd, folder, extension, filter('--filter')));
      const selected = cases === undefined ? runs : runs.filter(run => listed(run).length > 0);
      if (cases !== undefined && selected.length === 0) throw new Error(`CASES=${cases} selects no test of ${runs.map(run => run.cwd).join(', ')}; fix the name of the test`);
      for (const run of runs.filter(run => !selected.includes(run))) notes.push(`${run.cwd}: no case selected by CASES`);
      return selected;
    case 'python':
      pythonPackages(files, folder);
      // The tests run in the environment of the package (K324): the mise python alone holds none of its dependencies.
      const environment = venv?.(folder);
      return [{ cwd: folder, tool: 'python', ...(environment === undefined ? {} : { options: ['--venv', environment] }), args: filter('-k') }];
  }
  throw new Error(`the runtime ${runtime} is none of ${RUNTIMES.join(', ')}`);
}

/**
 * The runs of the unit tests of the packages of `runtime` among the tracked `files`; throws when no package has it.
 * `extension` is the built library of the PHP extension, `listed` tells the tests that a run of PHPUnit selects, and
 * `notes` gets the PHP libraries that CASES selects no test in (K390).
 */
export function runtimeRuns(files: readonly string[], runtime: string, cases: string | undefined, vitest: (folder: string) => boolean, extension?: string, venv?: (folder: string) => string | undefined, listed?: Listed, notes?: string[]): Run[] {
  const folders = implementationFolders(files).filter(folder => path.posix.basename(folder) === runtime);
  if (folders.length === 0) throw new Error(`no package of the runtime ${runtime}: packages/${runtime} or packages/<component>/${runtime}`);
  return folders.flatMap(folder => runsOf(files, runtime, folder, cases, vitest, extension, venv, listed, notes));
}

/** A command of a build: its folder relative to the root, the command and its arguments. */
export type Build = { cwd: string; command: string; args: string[] };

/** The builds of the packages of `runtime` among the tracked `files`; a runtime without a build step has none. */
export function buildRuns(files: readonly string[], runtime: string): Build[] {
  const folders = implementationFolders(files).filter(folder => path.posix.basename(folder) === runtime);
  const has = (folder: string, name: string) => files.includes(`${folder}/${name}`);
  switch (runtime) {
    case 'go':
      return files.filter(file => folders.some(folder => file.startsWith(`${folder}/`)) && path.posix.basename(file) === 'go.mod').map(file => ({ cwd: path.posix.dirname(file), command: 'go', args: ['build', './...'] }));
    case 'rust':
      return folders.filter(folder => has(folder, 'Cargo.toml')).map(folder => ({ cwd: folder, command: 'cargo', args: ['build', '--locked'] }));
    case 'ts':
    case 'js':
      return folders.filter(folder => has(folder, 'tsconfig.build.json')).map(folder => ({ cwd: folder, command: 'tsc', args: ['-p', 'tsconfig.build.json'] }));
    case 'python':
      return folders.filter(folder => has(folder, 'pyproject.toml')).map(folder => ({ cwd: folder, command: 'uv', args: ['build'] }));
    case 'php':
      return [];
    case 'php-ext':
      throw new Error('build-php-ext builds the extension with phpize (php-extension.mts)');
  }
  throw new Error(`the runtime ${runtime} is none of ${RUNTIMES.join(', ')}`);
}

/** The targets `<task>-<runtime>` of each runtime that the packages among `files` hold, in their order. */
export function taskTargets(files: readonly string[], task: string): string[] {
  return [...new Set(implementationFolders(files).map(folder => path.posix.basename(folder)))].sort().map(runtime => `${task}-${runtime}`);
}

/** The runs of the suite `suite`: the folder of each runtime under tests/<suite>/ of the root. */
export function suiteRuns(files: readonly string[], suite: string, vitest: (folder: string) => boolean, venv?: (folder: string) => string | undefined): Run[] {
  const runtimes = RUNTIMES.filter(runtime => files.some(file => file.startsWith(`tests/${suite}/${runtime}/`)));
  return runtimes.flatMap(runtime => runsOf(files, runtime, `tests/${suite}/${runtime}`, undefined, vitest, undefined, venv));
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

/** The library of the PHP extension of `root` that build-php-ext publishes; throws when it is missing. */
function builtExtension(root: string, files: readonly string[]): string {
  const owner = repositoryOf(files, file => (files.includes(file) ? readFileSync(path.join(root, file), 'utf8') : undefined));
  if ('finding' in owner) throw new Error(owner.finding);
  const library = path.join(root, 'var/php-ext', `${extensionNames(owner.repository).extension}.so`);
  if (!existsSync(library)) throw new Error(`${path.relative(root, library)} is missing. Fix: make build-php-ext`);
  return library;
}

/** The virtual environment of the Python package `folder` under `root`: the nearest `.venv` at or above it, up to the root. */
function environmentOf(root: string, folder: string): string | undefined {
  for (let place = folder; ; place = path.posix.dirname(place)) {
    const candidate = path.posix.join(place, '.venv');
    if (existsSync(path.join(root, candidate, 'pyvenv.cfg'))) return candidate;
    if (place === '.' || place === '') return undefined;
  }
}

if (isMain(import.meta.url)) {
  const root = repositoryRoot();
  const [target = '', name = ''] = process.argv.slice(2);
  const files = trackedFiles(root);
  if (target === 'task') {
    const targets = taskTargets(files, name);
    // A repository without a runtime, such as kit, joins the task by its own prerequisites (build: kit-build).
    if (targets.length === 0) {
      console.log(`[runtime-targets] packages/ holds no runtime; make ${name} runs only the prerequisites of the repository`);
      process.exit(0);
    }
    const result = spawnSync('make', ['--no-print-directory', ...targets], { cwd: root, stdio: 'inherit' });
    process.exit(result.status ?? 1);
  }
  if (target === 'build') {
    const builds = buildRuns(files, name);
    if (builds.length === 0) console.log(`[runtime-targets] the packages of ${name} have no build step`);
    for (const build of builds) {
      const command = build.command === 'tsc' ? path.join(root, 'node_modules/.bin/tsc') : build.command;
      console.log(`[runtime-targets] ${build.cwd}: ${build.command} ${build.args.join(' ')}`);
      const result = spawnSync(command, build.args, { cwd: path.join(root, build.cwd), stdio: 'inherit' });
      if (result.error) throw new Error(`${build.command} could not start: ${result.error.message}`);
      if (result.status !== 0) process.exit(1);
    }
    process.exit(0);
  }
  const vitest = (folder: string) => usesVitest(root, folder);
  const venv = (folder: string) => environmentOf(root, folder);
  const suite = (SUITES as readonly string[]).includes(target);
  const refused = suite ? ciRefusal(`make test-${target}`) : null;
  if (refused) {
    console.error(`[runtime-targets] ${refused}`);
    process.exit(1);
  }
  let runs: Run[];
  const notes: string[] = [];
  try {
    const extension = target === 'php-ext' ? builtExtension(root, files) : undefined;
    // The selection of CASES in a PHP library is PHPUnit's own listing of the run.
    const listed: Listed = run => listedTests([run.tool, '--cwd', run.cwd, ...(run.options ?? []), '--', ...run.args], root);
    runs = suite ? suiteRuns(files, target, vitest, venv) : runtimeRuns(files, target, process.env.CASES || undefined, vitest, extension, venv, listed, notes);
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    console.error(`[runtime-targets] ${error.message}`);
    process.exit(1);
  }
  for (const note of notes) console.log(note);
  if (runs.length === 0) {
    console.error(`[runtime-targets] tests/${target}/ holds no folder of a runtime`);
    process.exit(1);
  }
  let failed = 0;
  for (const run of runs) {
    const result = spawnSync(process.execPath, [siblingTool(import.meta.url, 'run-tests'), run.tool, '--cwd', run.cwd, ...(run.options ?? []), '--', ...run.args], { cwd: root, stdio: 'inherit' });
    if (result.status !== 0) failed += 1;
  }
  process.exit(failed ? 1 : 0);
}
