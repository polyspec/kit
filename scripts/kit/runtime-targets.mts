#!/usr/bin/env node
// The unit test and build runs of the roots that the caller selects (K244, K1106): kit sets no runtime, no package layout, no test
// folder and no build command. The caller names the runner and the roots:
//
//   runtime-targets test --runner <runner> --roots <folder>... [--php-extension <library>] [--venv <folder>]
//                        [-- <runner argument>...]
//                        the tests of each root with its runner through run-tests.mts, with the name filter CASES=<pattern> and the
//                        runner arguments of the caller, such as -count=1 for go: go test ./... (one go test over the ./<root>/...
//                        patterns of several roots), cargo test, node --test, which finds the test files of the root itself, vitest,
//                        phpunit (with the built library of a PHP extension loaded, in each root that holds a test), python unittest
//                        (with the interpreter of the environment <root>/<folder> that --venv names, or the python of PATH)
//   runtime-targets build [--runner <runner>] --roots <folder>... -- <command> [<argument>...]
//                        the build command of the caller in each root, as the caller writes it
//   runtime-targets infrastructure <path>... [-- <runner argument>...]
//                        node --test in each path, which finds its test files itself
//   runtime-targets case-sensitive-smoke <file>...
//                        the smoke of the standard Node runner with the files that the caller names
//
// A call without a selection is a usage error (exit 2), and a selection that runs nothing fails: it has tested nothing. That holds
// for a root too: each run records the counts of its tests (run-tests --results), and a run that reports no test that ran fails
// with "found nothing to run", so a node or vitest root without a test file never passes (K1074, K1106).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { isJsonObject } from './bootstrap/files.mts';
import { isTestFile } from './check-commits.mts';
import { isMain, repositoryRoot, siblingTool } from './paths.mts';
import { trackedFiles } from './tracked-files.mts';
import { listedTests } from './run-tests.mts';
import { withCaseSensitiveDirectory } from './case-sensitive-directory.mts';

/** A run of run-tests.mts: the folder, relative to the root, the tool, the options of run-tests and the arguments of the tool. */
export type Run = { cwd: string; tool: string; options?: string[]; args: string[] };

/** The runners of the test calls. */
export const RUNNERS = ['go', 'cargo', 'node', 'vitest', 'php', 'python'] as const;

/**
 * The tests that a run selects, as PHPUnit lists them with --list-tests (K390-1); the main of this file passes the real listing, and
 * a test passes a fixed one.
 */
export type Listed = (run: Run) => string[];

/** The run of PHPUnit of the PHP package `cwd`, with its own Composer project, against the built extension, with the arguments `args`. */
function phpExtensionRun(cwd: string, extension: string, args: string[]): Run {
  return { cwd, tool: 'phpunit', options: ['--php-extension', extension], args };
}

// The listing of a run is needed only when CASES names a test; a caller that passes none gets this error.
const unlisted: Listed = () => {
  throw new Error('CASES selects the tests of a PHP library by PHPUnit, which needs the listing of the run');
};

/** The folders `places` of the caller, each normalized without a trailing slash, once each and sorted (K1122). */
const folderSet = (places: readonly string[]): string[] => [...new Set(places.map(place => path.posix.normalize(place).replace(/(.)\/+$/, '$1')))].sort();

/**
 * The runs of the tests of the roots `roots` with the runner `runner` among the tracked `files` (K1106), with the name filter `cases`
 * and the runner arguments `extra` of the caller; kit adds no flag of its own. With `extension`, the built library of a PHP extension,
 * phpunit runs each root that holds a test with it loaded, in its own Composer project (K790), and a root where `cases` selects no test
 * is not run: its line goes to `notes` (K390). With `venv`, python runs with the environment at that folder of each root.
 */
export function testRuns(files: readonly string[], runner: string, roots: readonly string[], cases: string | undefined, extension?: string, venv?: string, listed: Listed = unlisted, notes: string[] = [], extra: readonly string[] = []): Run[] {
  const filter = (flag: string) => [...(cases === undefined ? [] : [flag, cases]), ...extra];
  const folders = folderSet(roots);
  switch (runner) {
    case 'go':
      // One root runs in its own module. Several roots run in one go test from the root with their ./<root>/... patterns, go's own
      // multi-package form, as one process (K1106).
      if (folders.length <= 1) return folders.map(cwd => ({ cwd, tool: 'go', args: [...filter('-run'), './...'] }));
      return [{ cwd: '.', tool: 'go', args: [...filter('-run'), ...folders.map(folder => `./${folder}/...`)] }];
    case 'cargo':
      // cargo test takes one --manifest-path, and several -p only inside one workspace, so each root runs on its own.
      return folders.map(cwd => ({ cwd, tool: 'cargo', args: [...(cases === undefined ? [] : [cases]), ...extra] }));
    case 'vitest':
      return folders.map(cwd => ({ cwd, tool: 'vitest', args: filter('-t') }));
    case 'node':
      // node --test finds the test files of the root by its own patterns.
      return folders.map(cwd => ({ cwd, tool: 'node', args: filter('--test-name-pattern') }));
    case 'python':
      // The environment of the package is the caller's (K324): --venv names its folder in each root, or the python of PATH runs.
      return folders.map(cwd => ({ cwd, tool: 'python', ...(venv === undefined ? {} : { options: ['--venv', path.posix.join(cwd, venv)] }), args: filter('-k') }));
    case 'php': {
      if (extension === undefined) return folders.map(cwd => ({ cwd, tool: 'phpunit', args: filter('--filter') }));
      // CASES is one filter for every root, so a root where PHPUnit lists no test for it is not run (K390): a filter that selects
      // no test anywhere is a typo, and fails.
      const runs = folders.filter(place => files.some(file => file.startsWith(`${place}/`) && isTestFile(file))).map(cwd => phpExtensionRun(cwd, extension, filter('--filter')));
      const selected = cases === undefined ? runs : runs.filter(run => listed(run).length > 0);
      if (cases !== undefined && runs.length > 0 && selected.length === 0) throw new Error(`CASES=${cases} selects no test of ${runs.map(run => run.cwd).join(', ')}; fix the name of the test`);
      for (const run of runs.filter(run => !selected.includes(run))) notes.push(`${run.cwd}: no case selected by CASES`);
      return selected;
    }
  }
  throw new Error(`the runner ${runner} is none of ${RUNNERS.join(', ')}`);
}

/** A command of a build: its folder relative to the root, the command and its arguments. */
export type Build = { cwd: string; command: string; args: string[] };

/** The build command `command` with `args` of the caller in each of the `roots` (K1106). */
export function buildRuns(roots: readonly string[], command: string, args: readonly string[]): Build[] {
  return folderSet(roots).map(cwd => ({ cwd, command, args: [...args] }));
}

/** node --test in each of the `paths` that the caller names (K1106), which finds the test files there, with the runner arguments `extra`. */
export function infrastructureRuns(paths: readonly string[], extra: readonly string[] = []): Run[] {
  return folderSet(paths).map(cwd => ({ cwd, tool: 'node', args: [...extra] }));
}

/** The smoke of the resource context and the standard Node runner with the files that the caller names (K1074). */
export function caseSensitiveSmokeRuns(fixtures: readonly string[]): Run[] {
  if (fixtures.length === 0) throw new Error('case-sensitive-smoke needs the smoke files as arguments');
  return [{ cwd: '.', tool: 'node', args: [...fixtures] }];
}

/**
 * The finding of a run of `cwd` whose recorded counts `record` (the --results file of run-tests, or undefined when it wrote none)
 * show no test that ran (K1074, K1106), or undefined when a test ran.
 */
export function nothingRan(cwd: string, record: unknown): string | undefined {
  const ran = isJsonObject(record) && typeof record.ran === 'number' ? record.ran : undefined;
  if (ran !== undefined && ran > 0) return undefined;
  return `${cwd}: found nothing to run (${ran === undefined ? 'the run reported no test count' : '0 tests ran'})`;
}

const USAGE = 'usage: runtime-targets.mts test --runner <runner> --roots <folder>... [--php-extension <library>] [--venv <folder>] [-- <runner argument>...], build [--runner <runner>] --roots <folder>... -- <command> [<argument>...], infrastructure <path>... [-- <runner argument>...], or case-sensitive-smoke <file>...';

/**
 * The selection of a test or build call (K1106): its runner, its roots, the library of an extension, the environment
 * folder of python and what follows --: the command of a build, or the runner arguments of a test.
 */
export type Selection = { runner?: string; roots?: string[]; extension?: string; venv?: string; command: string[] };

/** The selection that the arguments `args` name; undefined for a call that names no --roots, or anything else. */
export function selectionOf(args: readonly string[]): Selection | undefined {
  const separator = args.indexOf('--');
  const options = separator === -1 ? args : args.slice(0, separator);
  const selection: Selection = { command: separator === -1 ? [] : args.slice(separator + 1) };
  for (let index = 0; index < options.length; index += 1) {
    const option = options[index];
    const value = options[index + 1];
    if (option === '--roots') {
      const roots: string[] = [];
      while (index + 1 < options.length && !(options[index + 1] ?? '').startsWith('--')) roots.push(options[++index] ?? '');
      if (roots.length === 0 || selection.roots !== undefined) return undefined;
      selection.roots = roots;
    } else if ((option === '--runner' || option === '--php-extension' || option === '--venv') && value !== undefined && !value.startsWith('--')) {
      const key = option === '--runner' ? 'runner' : option === '--php-extension' ? 'extension' : 'venv';
      if (selection[key] !== undefined) return undefined;
      selection[key] = value;
      index += 1;
    } else {
      return undefined;
    }
  }
  if (selection.roots === undefined) return undefined;
  if (selection.runner !== undefined && !(RUNNERS as readonly string[]).includes(selection.runner)) return undefined;
  return selection;
}

if (isMain(import.meta.url)) {
  const root = repositoryRoot();
  const [mode = '', ...args] = process.argv.slice(2);
  const usage = (): never => {
    console.error(`[runtime-targets] ${USAGE}`);
    process.exit(2);
  };
  if (mode === 'build') {
    const selection = selectionOf(args);
    if (selection === undefined || selection.command.length === 0 || selection.extension !== undefined || selection.venv !== undefined) usage();
    let builds: Build[];
    try {
      const [command = '', ...commandArgs] = selection?.command ?? [];
      builds = buildRuns(selection?.roots ?? [], command, commandArgs);
    } catch (error) {
      console.error(`[runtime-targets] ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
    if (builds.length === 0) {
      console.error('[runtime-targets] the build found no root to build');
      process.exit(1);
    }
    for (const build of builds) {
      // The command runs as the caller writes it, from the root of the build: a path such as var/tools/bin/go, or a name on PATH.
      const command = build.command.includes('/') ? path.resolve(root, build.command) : build.command;
      console.log(`[runtime-targets] ${build.cwd}: ${build.command} ${build.args.join(' ')}`);
      const result = spawnSync(command, build.args, { cwd: path.join(root, build.cwd), stdio: 'inherit' });
      if (result.error) throw new Error(`${build.command} could not start: ${result.error.message}`);
      if (result.status !== 0) {
        // The failed build is named with how it ended, a signal included (K1164).
        console.error(`[runtime-targets] ${build.cwd}: ${build.command} ${build.args.join(' ')} ${result.signal ? `ended by signal ${result.signal}` : `exited with ${result.status}`}`);
        process.exit(1);
      }
    }
    process.exit(0);
  }
  const caseSensitiveEnv = process.env.CASE_SENSITIVE_ENV || undefined;
  let runs: Run[] = [];
  const notes: string[] = [];
  const selection = mode === 'test' ? selectionOf(args) : undefined;
  if (mode === 'test' && (selection === undefined || selection.runner === undefined)) usage();
  // The paths of infrastructure, and its runner arguments after --.
  const separator = args.indexOf('--');
  const paths = mode === 'infrastructure' && separator !== -1 ? args.slice(0, separator) : args;
  if ((mode === 'infrastructure' || mode === 'case-sensitive-smoke') && paths.length === 0) usage();
  if (mode !== 'test' && mode !== 'infrastructure' && mode !== 'case-sensitive-smoke') usage();
  try {
    if (caseSensitiveEnv !== undefined && selection?.runner !== 'go' && mode !== 'infrastructure' && mode !== 'case-sensitive-smoke') throw new Error('CASE_SENSITIVE_ENV is supported only by the go runner, infrastructure and case-sensitive-smoke');
    // The selection of CASES in a PHP library is PHPUnit's own listing of the run.
    const listed: Listed = run => listedTests([run.tool, '--cwd', run.cwd, ...(run.options ?? []), '--', ...run.args], root);
    const files = trackedFiles(root);
    if (mode === 'infrastructure') runs = infrastructureRuns(paths, separator === -1 ? [] : args.slice(separator + 1));
    else if (mode === 'case-sensitive-smoke') runs = caseSensitiveSmokeRuns(args);
    else if (selection !== undefined) {
      const extension = selection.extension === undefined ? undefined : path.resolve(root, selection.extension);
      runs = testRuns(files, selection.runner ?? '', selection.roots ?? [], process.env.CASES || undefined, extension, selection.venv, listed, notes, selection.command);
    }
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    console.error(`[runtime-targets] ${error.message}`);
    process.exit(1);
  }
  for (const note of notes) console.log(note);
  if (runs.length === 0) {
    // A test call that runs nothing has tested nothing, so it does not pass (K1074, K1106: a result check, without a layout rule).
    console.error(`[runtime-targets] ${mode} found nothing to run`);
    process.exit(1);
  }
  const execute = () => {
    let failed = 0;
    for (const run of runs) {
      // The counts of the run go to a temporary file, which is read and removed here.
      const record = mkdtempSync(path.join(tmpdir(), 'kit-runtime-targets-'));
      try {
        const file = path.join(record, 'result.json');
        const result = spawnSync(process.execPath, [siblingTool(import.meta.url, 'run-tests'), run.tool, '--cwd', run.cwd, ...(run.options ?? []), '--results', file, '--', ...run.args], { cwd: root, stdio: 'inherit' });
        const finding = nothingRan(run.cwd, existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as unknown : undefined);
        if (finding !== undefined) console.error(`[runtime-targets] ${finding}`);
        if (result.error) console.error(`[runtime-targets] ${run.cwd}: run-tests ${run.tool} could not start: ${result.error.message}`);
        else if (result.signal) console.error(`[runtime-targets] ${run.cwd}: run-tests ${run.tool} ended by signal ${result.signal}`);
        if (result.status !== 0 || finding !== undefined) failed += 1;
      } finally {
        rmSync(record, { recursive: true, force: true });
      }
    }
    return failed ? 1 : 0;
  };
  if (caseSensitiveEnv !== undefined) {
    try {
      process.exit(withCaseSensitiveDirectory(caseSensitiveEnv, execute));
    } catch (error) {
      console.error(`[runtime-targets] ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  }
  process.exit(execute());
}
