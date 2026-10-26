#!/usr/bin/env node
// The test runner. A test target runs its test tool through this script, which prints each test as it starts, keeps running,
// passes, fails or is skipped, with the elapsed time, and gives every test its own timeout.
//
//   node scripts/kit/run-tests.mts <tool> [--timeout <seconds>] [--cwd <directory>] [--php-extension <file>]... [--venv <directory>]
//       [--module <name>] [--results <file> [--inputs <path>]...] [--] [<arguments>]
//
// The arguments after the options of the runner go to the tool. --results writes the record of the run, passed or not, to
// <file> (relative to the checkout root): the counts, each test with its status and elapsed time, the tool, the elapsed time
// of the run and `inputs`, the `inputsDigest` of the --inputs paths (the --cwd directory when none is given), so that a
// check can tell a record of the current files from a stale one.
//
// --venv runs the python tool with the interpreter of a virtual environment, so a package's tests import its own installed
// dependencies. The environment must come from the Python of the checkout: its pyvenv.cfg names a directory of var/tools/mise
// as its home (install-tools installs that Python with mise). Any other environment is refused before the tool starts. Its
// symbolic links are accepted as the tool that made it left them: `make python-venv DIR=<directory>` (python-venv.mts) makes such
// an environment with `uv venv`.
//
// Tools: node (node --test), vitest, go (go test), cargo (cargo test), phpunit and python (python3 -m unittest, through
// runners/python.py, which gives each test its own timeout, K371). node and
// vitest stop a test at its timeout themselves; for go, cargo, phpunit and python this runner stops the tool when a test
// outlives it. Every interval without a test event is bounded by the same timeout (K371-1): before the first test, between
// tests and after the last one, the gap watch of test-gap.mts stops the tool and names the last event. No tool has a time
// limit on a whole run, a package or a file.
//
// Every tool runs in its own process group (spawn's `detached`), so a stop reaches the processes that the tool started, such
// as the interpreter that the mise shim runs (K141). The runner stops the group with SIGTERM and, when the tool has not
// closed after a grace period, with SIGKILL: at a test's timeout, and when the runner itself receives SIGINT, SIGTERM or
// SIGHUP, after which it ends on that signal. Only a SIGKILL of the runner itself, which no process can handle, leaves the
// group running. A run that selects no test file, name or id runs only in CI (test-selection.mts, ci-only.mts). A run in which no test passed, failed or ran out of time fails, so a selection
// that matches nothing never passes; a file of node tests that registers no test fails.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import readline from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createProgress } from './test-progress.mts';
import { createGap, parseTestEvent, PROCESS_UP, START_UP_MS, TEST_EVENTS, TEST_EVENTS_FD } from './test-gap.mts';
import { compactSeconds } from './time.mts';
import { composerVendor, packageVendorFile } from './composer-vendor.mts';
import { cargoEvents, goEvents, phpunitEvents, pythonEvents, toProgress, type Sink, type TestRef } from './test-output.mts';
// stopGroup is the group stop of process-group.mts, which run-command shares (K430).
import { signalGroup, stopGroup } from './process-group.mts';
import { venvProblem } from './python-venv.mts';
import { toolCommand as miseCommand, toolsEnvironment } from './mise-tools.mts';
import { toolsPath } from './bootstrap/tool-wrappers.mts';
import { writeJson } from './bootstrap/files.mts';
import { isMain, repositoryRoot, siblingTool, TEST_ROOT } from './paths.mts';
import { inputsDigest } from './tracked-files.mts';
import { readJsonFile } from './schema-validate.mts';
import { present } from './present.mts';
import { libraryTestRun, type LibraryRun } from './php-library-autoload.mts';
import { ciRefusal } from './ci-only.mts';
import { isFile, runnerWords, selects } from './test-selection.mts';

const TOOLS: readonly string[] = ['node', 'vitest', 'go', 'cargo', 'phpunit', 'python'];
const USAGE = `Usage: node scripts/kit/run-tests.mts <${TOOLS.join('|')}> [--timeout <seconds>] [--php-extension <file>]... [--venv <directory>] [--module <name>] [--cwd <directory>] [--results <file> [--inputs <path>]...] [--] [<arguments>]`;
const DEFAULT_TIMEOUT_SECONDS = 30;
// The runner of the python tests (K371): unittest with the timeout of each test and the elapsed time of each, standard library only.
const PYTHON_RUNNER = fileURLToPath(new URL('./runners/python.py', import.meta.url));
// The python tests start the runner through runpy: a -c start keeps the current directory first on sys.path, as -m does (K371).
export const PYTHON_START = "import runpy, sys; runpy.run_path(sys.argv[1], run_name='__main__')";
// A line in which a tool reports an error: `error: ...` and `error[E0425]: ...` of cargo and rustc, `fatal error: ...`,
// `panic: ...` of Go and `PHP Fatal error: ...`.
const ERROR_LINE = /^(?:error(?:\[\w+\])?:|fatal error:|panic:|PHP Fatal error:)/i;

/** The options of a run: the tool, the timeout of each test, the directory, the arguments of the tool and the record. */
export type RunOptions = {
  tool: string;
  timeoutSeconds: number;
  cwd: string;
  args: string[];
  inputs: string[];
  phpExtensions: string[];
  withoutLibrary?: string;
  venv?: string;
  module?: string;
  results?: string;
};

/** The options that the command of a tool reads. */
export type ToolOptions = Pick<RunOptions, 'tool' | 'timeoutSeconds' | 'cwd' | 'args' | 'venv' | 'module'> & Partial<Pick<RunOptions, 'phpExtensions'>> & { library?: Pick<LibraryRun, 'phpunit' | 'prepend'> };

// How a tool ended: it could not start, or it closed with a status or a signal.
type Ended = { error: Error } | { error?: undefined; status: number | null; signal: NodeJS.Signals | null };

// The counts that a progress reporter writes to KIT_TEST_RESULT.
type Counts = { ran: number; skipped: number; [key: string]: unknown };

// The fix for a tool that cannot start.
const INSTALL: Record<string, (options: { cwd: string; root: string }) => string> = {
  node: () => 'run make install-tools TOOLS=npm, which installs the Node.js of mise.toml',
  vitest: () => 'run make install',
  go: () => 'declare go in mise.toml and run make install-tools, which installs it into var/tools/mise',
  cargo: () => 'install rustup and run make install, which installs the toolchain of rust-toolchain.toml',
  phpunit: ({ cwd, root }) => `run composer install in ${path.relative(root, cwd) || '.'}`,
  python: () => 'declare python in mise.toml and run make install-tools, which installs it into var/tools/mise',
};

export function parseArguments(argv: string[], root = repositoryRoot()) {
  const [tool, ...rest] = argv;
  if (tool === undefined || !TOOLS.includes(tool)) throw new Error(USAGE);
  const options: RunOptions = { tool, timeoutSeconds: DEFAULT_TIMEOUT_SECONDS, cwd: root, args: [], inputs: [], phpExtensions: [] };
  const { options: pairs, args } = runnerWords(rest);
  for (const [flag, value] of pairs) {
    if (flag === '--timeout') {
      if (!/^[1-9]\d*$/.test(value ?? '')) throw new Error(USAGE);
      options.timeoutSeconds = Number(value);
    } else if (flag === '--php-extension') {
      if (!value || tool !== 'phpunit') throw new Error(USAGE);
      options.phpExtensions.push(path.resolve(root, value));
    } else if (flag === '--without-library') {
      if (!value || tool !== 'phpunit') throw new Error(USAGE);
      options.withoutLibrary = value;
    } else if (flag === '--venv') {
      if (!value || tool !== 'python') throw new Error(USAGE);
      options.venv = path.resolve(root, value);
    } else if (flag === '--module') {
      if (!value || tool !== 'python') throw new Error(USAGE);
      options.module = value;
    } else if (flag === '--cwd') {
      if (!value) throw new Error(USAGE);
      options.cwd = path.resolve(root, value);
    } else if (flag === '--results') {
      if (!value) throw new Error(USAGE);
      options.results = path.resolve(root, value);
    } else if (flag === '--inputs') {
      if (!value) throw new Error(USAGE);
      options.inputs.push(value);
    }
  }
  if (options.inputs.length && !options.results) throw new Error(`--inputs needs --results\n${USAGE}`);
  if (options.results && !options.inputs.length) options.inputs.push(path.relative(root, options.cwd) || '.');
  options.args = args;
  return options;
}

function splitCargo(args: string[]) {
  const index = args.indexOf('--');
  return index === -1 ? { cargo: args, harness: [] } : { cargo: args.slice(0, index), harness: args.slice(index + 1) };
}

/**
 * The file of the checkout that a command starts. It must exist: a missing one fails before the run starts, and the command is
 * never looked up on PATH.
 */
function checkoutFile(file: string): string {
  if (!existsSync(file)) throw new Error(`${file} does not exist; run make install`);
  return file;
}

/** The command of a tool with its progress and timeout arguments. */
// K452-1: each --php-extension is loaded by the PHP of the run before PHPUnit starts. One that does not load (a build for another
// PHP or PHP API) returns a problem that names its .so path, what PHP reports, and the running PHP, so a run never tests the
// library silently on the wrong PHP.
export function probeExtensions(extensions: string[], php: string): string | undefined {
  for (const extension of extensions) {
    const probe = spawnSync(php, ['-n', '-d', `extension=${extension}`, '-r', 'exit(0);'], { encoding: 'utf8' });
    const reported = `${probe.stdout}${probe.stderr}`.trim();
    if (probe.status === 0 && !/Unable to load|compiled with module API|undefined symbol/.test(reported)) continue;
    const running = spawnSync(php, ['-n', '-r', 'echo PHP_VERSION, " ", PHP_API;'], { encoding: 'utf8' }).stdout.trim();
    return `the PHP extension ${extension} does not load in the running PHP ${running}; PHP reports: ${reported}`;
  }
  return undefined;
}

export function toolCommand({ tool, timeoutSeconds, cwd, args, phpExtensions = [], venv, module, library }: ToolOptions, root = repositoryRoot()): { command: string; args: string[]; build?: string[] } {
  const milliseconds = String(timeoutSeconds * 1000);
  switch (tool) {
    case 'node':
      return {
        command: process.execPath,
        // The preload fails a file whose process is still alive the test timeout after its last test, naming what holds it.
        // One file runs at a time, so the reporter attributes each case to the file whose group event opened it (K218).
        args: ['--test', `--import=${pathToFileURL(siblingTool(import.meta.url, 'test-exit-deadline')).href}?ms=${milliseconds}`, `--test-timeout=${milliseconds}`, '--test-concurrency=1', `--test-reporter=${siblingTool(import.meta.url, 'node-reporter')}`, '--test-reporter-destination=stdout', ...args],
      };
    case 'vitest':
      // The runner starts the entry of the vitest package with its own node, so vitest runs on the declared Node.js and not on
      // the node that the shebang of node_modules/.bin/vitest finds on PATH.
      return { command: process.execPath, args: [path.join(root, 'node_modules/vitest/vitest.mjs'), 'run', `--testTimeout=${milliseconds}`, `--hookTimeout=${milliseconds}`, `--reporter=${siblingTool(import.meta.url, 'vitest-reporter')}`, ...args] };
    case 'go':
      // go test has no limit per test; this runner applies it. -timeout=0 removes the limit of go test on a whole test
      // binary, a package.
      // go is the one of mise.toml, run by the shim of the checkout, never the go of PATH.
      // The build runs the test binaries with `true`, which ends at once, so it compiles each binary and runs no test (K549-1).
      return { command: checkoutFile(miseCommand(root, 'go')), args: ['test', '-json', '-count=1', '-timeout=0', ...args], build: ['test', '-exec=true', ...args] };
    case 'cargo':
      // One test at a time, so each test prints its start before its result. cargo is not pinned by kit: rustup finds it on PATH
      // (rust-toolchain.toml), so it is the one command that is not resolved by the checkout.
      return { command: 'cargo', args: ['test', ...splitCargo(args).cargo, '--', '--test-threads=1', ...splitCargo(args).harness], build: ['test', '--no-run', ...splitCargo(args).cargo] };
    case 'phpunit': {
      // PHPUnit of the vendor directory that Composer gives the package of `cwd`: its own, or that of the nearest Composer
      // project above it, such as the root of a monorepo (composer-vendor.mts, K186); with none, the path of its own, whose
      // start fails with the install fix.
      const found = packageVendorFile(root, path.relative(root, cwd) || '.', 'bin/phpunit');
      const phpunit = found === undefined ? path.join(composerVendor(cwd), 'bin/phpunit') : path.join(root, found);
      // Each --php-extension loads a PHP extension, such as a build of the repository, into the PHP of PHPUnit with its own
      // -d extension=, in the given order, so an extension loads after one that it depends on.
      // An extension run of the tests of the library (K329) starts the PHPUnit script itself, never the proxy of Composer, which names the
      // autoloader of the library; the file prepended to it names the autoloader without the sources of the library.
      // The PHP of both runs is the wrapper of var/tools/bin that install-tools writes for the checkout, never the php of PATH (K393).
      if (library) return { command: checkoutFile(toolsPath(root, 'bin', 'php')), args: [...phpExtensions.flatMap(extension => ['-d', `extension=${extension}`]), '-d', `auto_prepend_file=${library.prepend}`, library.phpunit, '--teamcity', ...args] };
      // K452: an extension run gives PHPUnit the configuration of the package, so the bootstrap that it names loads as in the library run.
      const configuration = ['phpunit.xml', 'phpunit.xml.dist'].map(file => path.join(cwd, file)).find(file => existsSync(file));
      const configured = configuration === undefined ? [] : ['--configuration', configuration];
      if (phpExtensions.length) return { command: checkoutFile(toolsPath(root, 'bin', 'php')), args: [...phpExtensions.flatMap(extension => ['-d', `extension=${extension}`]), phpunit, '--teamcity', ...configured, ...args] };
      return { command: phpunit, args: ['--teamcity', ...args] };
    }
    case 'python':
      // -v prints each test with its outcome on standard error; unittest runs one test at a time. -v goes last: before a
      // `discover` argument unittest would read `discover` as a test name. The runner gives each test its own timeout (K371);
      // a --module harness keeps `-m <module>`, whose tests run with the timeout of the runner of this script.
      const interpreter = venv ? path.join(venv, 'bin', 'python') : checkoutFile(miseCommand(root, 'python3'));
      if (module !== undefined) return { command: interpreter, args: ['-m', module, ...args, '-v'] };
      return { command: interpreter, args: ['-c', PYTHON_START, PYTHON_RUNNER, '--timeout', String(timeoutSeconds), ...args, '-v'] };
  }
  throw new Error(USAGE);
}

/**
 * The tests that the run of `argv` (the arguments of run-tests) selects, as PHPUnit lists them: the command of the run with
 * --list-tests added, so the library and the extension are the run's own (K390-1). PHPUnit prints each test as ` - Class::method`.
 */
export function listedTests(argv: string[], root = repositoryRoot(), callerEnv: NodeJS.ProcessEnv = process.env): string[] {
  const options = parseArguments(argv, root);
  const library = options.withoutLibrary === undefined ? undefined : libraryTestRun(root, options.withoutLibrary, callerEnv);
  try {
    const { command, args } = toolCommand({ ...options, args: [...options.args, '--list-tests'], ...(library === undefined ? {} : { library }) }, root);
    // The tool of the checkout starts with the mise of the checkout, as a run in make does (K411).
    const result = spawnSync(command, args, { cwd: options.cwd, env: { ...toolsEnvironment(root, callerEnv), ...library?.env }, encoding: 'utf8' });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`phpunit --list-tests in ${path.relative(root, options.cwd) || '.'} ended with ${result.status}: ${result.stderr.trim()}`);
    return result.stdout.split('\n').flatMap(line => /^\s*-\s+(\S.*)$/.exec(line)?.[1] ?? []);
  } finally {
    library?.cleanup();
  }
}

/** Runs the tool of `argv`; resolves the exit status of the run (0 passed, 1 failed). */
/**
 * Sends SIGTERM to the process group of a timed-out test (its pgid is the pid of the detached child). EPERM while a member is in
 * exit and ESRCH after the group ended are not errors (process-group.mts).
 */
export function terminateGroup(pgid: number, kill?: Parameters<typeof signalGroup>[2]) {
  return signalGroup(pgid, 'SIGTERM', kill);
}

/**
 * The bound of the build that go and cargo run before their tests (K549-1): compiling is no test time and on a loaded machine
 * takes minutes, so it has its own bound, and the gap watch of the run starts when the tests are built.
 */
export const BUILD_MS = 1_200_000;

/** How long a stopped tool has to close after SIGTERM before its group receives SIGKILL. */
const STOP_GRACE_MS = 5000;

/** The signals that interrupt the runner; it stops the tool's group, then ends on the signal. */
const INTERRUPTS: readonly NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP'];

/** How often the runner checks that its parent is still the process that started it. */
const PARENT_POLL_MS = 200;

export async function run(argv: string[], { root = repositoryRoot(), write = (text: string): unknown => process.stdout.write(text), graceMs = STOP_GRACE_MS, callerEnv = process.env, startUpMs = START_UP_MS, buildMs = BUILD_MS }: { root?: string; write?: (text: string) => unknown; graceMs?: number; callerEnv?: NodeJS.ProcessEnv; startUpMs?: number; buildMs?: number } = {}): Promise<number> {
  const options = parseArguments(argv, root);
  const began = Date.now();
  // The tests of the PHP library run against the extension with none of the library's sources (K329).
  const library = options.withoutLibrary === undefined ? undefined : libraryTestRun(root, options.withoutLibrary, callerEnv);
  const { command, args, build } = toolCommand({ ...options, ...(library === undefined ? {} : { library }) }, root);
  const label = `${options.tool} ${path.relative(root, options.cwd) || '.'}${options.args.length ? ` ${options.args.join(' ')}` : ''}`;
  write(`▶ ${label} (each test ${options.timeoutSeconds}s)\n`);
  // A run that selects no test runs a whole runtime, which is a suite and runs only in CI (ci-only.mts).
  const unselected = !selects(options.tool, options.args, file => isFile(path.resolve(options.cwd, file))) && ciRefusal(`a ${options.tool} run without a selection`, callerEnv, root);
  if (unselected) {
    library?.cleanup();
    write(`✖ ${label}: ${unselected}\n`);
    return 1;
  }
  const unbuilt = options.phpExtensions.find(extension => !existsSync(extension));
  if (unbuilt) {
    library?.cleanup();
    write(`✖ ${label}: the PHP extension ${path.relative(root, unbuilt)} is not built; build it before the run\n`);
    return 1;
  }
  const unloaded = options.phpExtensions.length ? probeExtensions(options.phpExtensions, checkoutFile(toolsPath(root, 'bin', 'php'))) : undefined;
  if (unloaded) {
    library?.cleanup();
    write(`✖ ${label}: ${unloaded}\n`);
    return 1;
  }
  const venvRefusal = options.venv && venvProblem(options.venv, root);
  if (venvRefusal) {
    library?.cleanup();
    write(`✖ ${label}: ${venvRefusal}\n`);
    return 1;
  }
  const reads = ['go', 'cargo', 'phpunit', 'python'].includes(options.tool);
  const cargo = options.tool === 'cargo';
  const python = options.tool === 'python';
  // node and vitest report their tests from inside the tool, through the pipe of TEST_EVENTS_FD (K371-1).
  const reporter = !reads;
  // The progress reporters write their counts to this file; the runner requires that a test ran.
  const results = mkdtempSync(path.join(tmpdir(), 'kit-test-result-'));
  const resultFile = path.join(results, 'result.json');
  // A runner started from inside node --test must not join that run as its child.
  // unittest colors its verbose lines when FORCE_COLOR is set (Python 3.14); its parser reads plain lines, so the run turns
  // color off.
  // The reporters run in the --cwd directory, so they take the repository root from TEST_ROOT.
  // The runner and its tool start with the mise of the checkout, so a run outside make, in a shell without its MISE_* variables,
  // trusts the mise.toml of the checkout and finds its tools; the variables that the run sets itself come after (K411).
  const env: NodeJS.ProcessEnv = { ...toolsEnvironment(root, process.env), ...library?.env, KIT_TEST_RESULT: resultFile, [TEST_ROOT]: root, ...(python ? { PYTHONUNBUFFERED: '1', NO_COLOR: '1', PYTHON_COLORS: '0' } : {}), ...(reporter ? { [TEST_EVENTS]: String(TEST_EVENTS_FD) } : {}) };
  delete env.NODE_TEST_CONTEXT;
  // The signal that interrupted the run, which the runner ends on once the tool's group is stopped.
  let interrupted: NodeJS.Signals | undefined;
  // How a process of the run, the build of the tests or the tool (`what`), ended: its status and signal, or why it did not run
  // to its end, as it was interrupted or could not start.
  const finished = (ended: Ended, what: string): Exclude<Ended, { error: Error }> | string => {
    if (interrupted) return `interrupted by ${interrupted}; stopped the process group of ${what}`;
    // parseArguments accepts only the tools of TOOLS, and INSTALL has each.
    if (ended.error) return `cannot start ${command}: ${ended.error.message}; ${present(INSTALL[options.tool], 'INSTALL[options.tool]')({ cwd: options.cwd, root })}`;
    return ended;
  };
  let onInterrupt: ((signal: NodeJS.Signals) => void) | undefined;
  // The check that the parent is still there (K437): a parent that was killed cannot stop the group, so the runner does, as
  // for a hangup.
  let parentWatch: NodeJS.Timeout | undefined;
  try {
    // The stop of the process group that runs now: the build of the tests, then the tool. Before either starts there is none.
    let stopRunning = (): void => {};
    onInterrupt = (signal) => { interrupted ??= signal; stopRunning(); };
    for (const signal of INTERRUPTS) process.on(signal, onInterrupt);
    const parent = process.ppid;
    parentWatch = setInterval(() => {
      if (process.ppid === parent) return;
      clearInterval(parentWatch);
      onInterrupt?.('SIGHUP');
    }, PARENT_POLL_MS);
    // go and cargo build the tests of the run first, under the build bound, so the gap watch of the run measures no compiling
    // (K549-1). A build that fails, outlives its bound or cannot start fails the run with its output.
    if (build !== undefined) {
      const builder = spawn(command, build, { cwd: options.cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
      const output: string[] = [];
      present(builder.stdout, 'builder.stdout').setEncoding('utf8').on('data', (text: string) => output.push(text)); // The stream is piped.
      present(builder.stderr, 'builder.stderr').setEncoding('utf8').on('data', (text: string) => output.push(text)); // The stream is piped.
      const built = new Promise<Ended>((resolve) => {
        builder.once('error', error => resolve({ error }));
        builder.once('close', (status, signal) => resolve({ status, signal }));
      });
      let buildStopping: Promise<void> | undefined;
      // A build that could not start has no pid and no group to stop.
      stopRunning = () => { if (builder.pid !== undefined) buildStopping ??= stopGroup(builder.pid, built, graceMs); };
      let buildExpired = false;
      const buildWatch = setTimeout(() => { buildExpired = true; stopRunning(); }, buildMs);
      const ended = await built;
      clearTimeout(buildWatch);
      await buildStopping;
      const text = `${command} ${build.join(' ')}`;
      const buildEnd = finished(ended, 'the build of the tests');
      if (typeof buildEnd === 'string') {
        write(`✖ ${label}: ${buildEnd}\n`);
        return 1;
      }
      if (buildExpired) {
        write(output.join(''));
        write(`⏱ ${label}: the build of the tests did not end within ${buildMs / 1000} s; stopped \`${text}\`\n`);
        return 1;
      }
      if (buildEnd.status !== 0) {
        write(output.join(''));
        write(`✖ ${label}: the build of the tests \`${text}\` ended ${buildEnd.signal ? `on ${buildEnd.signal}` : `with exit code ${buildEnd.status}`}\n`);
        return 1;
      }
    }
    const child = spawn(command, args, { cwd: options.cwd, env, stdio: ['ignore', reads ? 'pipe' : 'inherit', cargo || python ? 'pipe' : 'inherit', reporter ? 'pipe' : 'ignore'], detached: true });
    // A tool that cannot start, such as a command missing on PATH, fails with its command and the install fix.
    const closed = new Promise<Ended>((resolve) => {
      child.once('error', error => resolve({ error }));
      child.once('close', (status, signal) => resolve({ status, signal }));
    });
    let stopping: Promise<void> | undefined;
    // A tool that could not start has no pid and no group to stop.
    const stop = () => { if (child.pid !== undefined) stopping ??= stopGroup(child.pid, closed, graceMs); };
    stopRunning = stop;
    // The gap watch (K371-1): an interval without a test event outlives the timeout, so the tool is stopped and the run fails.
    let gapExpired = false;
    const gap = createGap({
      timeoutMs: options.timeoutSeconds * 1000,
      startUpMs,
      onExpire: (problem) => {
        gapExpired = true;
        const text = `${problem}; the run elapsed ${compactSeconds(Date.now() - began)}; stopping \`${command} ${args.slice(0, 2).join(' ')}\``;
        if (progress) progress.expire(text);
        else write(`⏱ ${label}: ${text}\n`);
        stop();
      },
    });
    let timedOut = false;
    const progress = reads ? createProgress({
      write,
      timeoutMs: options.timeoutSeconds * 1000,
      command: `${command} ${args.slice(0, 2).join(' ')}`,
      // A test runs out of time only after the tool started, so the child has its pid.
      onTimeout: () => { timedOut = true; stop(); },
      resultFile,
      onEvent: event => gap.event(event),
    }) : undefined;
    const sink = progress && toProgress(progress);
    // The branches below are the tools that this runner reads, which have a progress and so a sink.
    // The error lines of the tool, which the summary names when the tool exits without a failing test.
    const errors: string[] = [];
    // The compiler errors of a Go package that does not build, which the summary names.
    const buildErrors: string[] = [];
    const noting = (handle: (text: string) => void) => (text: string) => {
      if (ERROR_LINE.test(text.trim())) errors.push(text.trim());
      handle(text);
    };
    // The tools that this runner reads have the standard output piped, and cargo and python the standard error too.
    // The process-up report of each tool (K549): node and vitest report it through their reporter; runners/python.py writes
    // PROCESS_UP first, and a --module harness and PHPUnit report it with their first output. go reports the start of each
    // package and cargo the start of each test binary, whose tests the build has compiled (K549-1); the end of a package and
    // the next binary of cargo return the watch to the start-up bound.
    const up = (id: string) => gap.event({ kind: 'up', id });
    let reported = false;
    const upOnce = () => { if (!reported) { reported = true; up(label); } };
    const launch = (id: string) => gap.event({ kind: 'launch', id });
    if (cargo) {
      const events = cargoEvents(present(sink, 'sink')); // A tool that this runner reads has a sink.
      present(child.stdout, 'child.stdout').setEncoding('utf8').on('data', (data: string) => { // The stream is piped for this tool.
        // libtest writes `running <n> tests` when the binary starts.
        if (/^running \d+ tests?$/m.test(data)) up(label);
        events.stdout(data);
      });
      readline.createInterface({ input: present(child.stderr, 'child.stderr') }).on('line', noting((line) => { // The stream is piped for this tool.
        // cargo names each test binary before it starts it.
        const binary = /^\s*(?:Running|Doc-tests)\s+(?:unittests\s+)?(\S+)/.exec(line);
        if (binary) launch(present(binary[1], 'binary[1]')); // The group always takes part in a match.
        events.stderr(line);
      }));
    } else if (python) {
      // unittest writes its progress to standard error; the standard output of the tests is printed as it is.
      const events = pythonEvents(present(sink, 'sink')); // A tool that this runner reads has a sink.
      present(child.stderr, 'child.stderr').setEncoding('utf8').on('data', (written: string) => { // The stream is piped for this tool.
        let data = written;
        if (options.module !== undefined) upOnce();
        else if (data.includes(`${PROCESS_UP}\n`)) {
          data = data.replace(`${PROCESS_UP}\n`, '');
          upOnce();
        }
        for (const text of data.split('\n')) if (ERROR_LINE.test(text.trim())) errors.push(text.trim());
        events(data);
      });
      // python is a tool that this runner reads, so it has a progress.
      readline.createInterface({ input: present(child.stdout, 'child.stdout') }).on('line', (text) => {
        if (options.module !== undefined) upOnce();
        present(progress, 'progress').line(`  ${text}`);
      });
    } else if (reads) {
      const toolSink = present(sink, 'sink'); // A tool that this runner reads has a sink.
      // A go package is a group, whose id is its name: its start is the start of its test binary, and its end returns the watch
      // to the start-up bound for the next one.
      const ended = (test: TestRef) => { if (test.id === test.name) launch(`the package after ${test.id}`); };
      const goSink: Sink = {
        ...toolSink,
        start: (test, startOptions) => { if (startOptions?.group) up(test.id); return toolSink.start(test, startOptions); },
        pass: (test, ms) => { const result = toolSink.pass(test, ms); ended(test); return result; },
        fail: (test, ms, text) => { const result = toolSink.fail(test, ms, text); ended(test); return result; },
        skip: (test) => { const result = toolSink.skip(test); ended(test); return result; },
      };
      const phpunit = options.tool === 'go' ? undefined : phpunitEvents(toolSink);
      readline.createInterface({ input: present(child.stdout, 'child.stdout') }).on('line', noting(phpunit === undefined ? goEvents(goSink, buildErrors) : (line) => {
        upOnce();
        return phpunit(line);
      })); // A tool that this runner reads has a sink. // The stream is piped for this tool.
    }
    if (reporter) {
      // The pipe of the test events is the stream that spawn opened for TEST_EVENTS_FD: a readable one, checked here.
      const events = present(child.stdio[TEST_EVENTS_FD], 'child.stdio[TEST_EVENTS_FD]');
      if (!(events instanceof Readable)) throw new Error(`the test events of ${label} are not a readable pipe`);
      readline.createInterface({ input: events }).on('line', text => gap.event(parseTestEvent(text)));
    }
    const ended = await closed;
    await stopping;
    gap.close();
    const toolEnd = finished(ended, 'the tool');
    if (typeof toolEnd === 'string') {
      write(`✖ ${label}: ${toolEnd}\n`);
      return 1;
    }
    const { status, signal } = toolEnd;
    const code = status ?? (signal ? 1 : 0);
    let exit;
    if (progress) {
      const counts = progress.close(label, { exitCode: timedOut || gapExpired ? 0 : code, errors, build: buildErrors });
      exit = counts.ok && !timedOut ? 0 : 1;
    } else {
      // node --test and vitest print their summary from inside the tool; a tool that then ends on a signal or a nonzero
      // code fails the run, and this line names why. A run that the gap watch stopped has its own line.
      if (code !== 0 && !gapExpired) write(`✖ ${label}: the tool ended ${signal ? `on ${signal}` : `with exit code ${status}`}\n`);
      exit = code === 0 && !gapExpired ? 0 : 1;
    }
    const counts = existsSync(resultFile) ? readJsonFile<Counts>(resultFile, 'test-result.schema.json') : null;
    if (counts !== null && options.results) {
      const inputs = { paths: options.inputs, digest: inputsDigest(root, options.inputs) };
      writeJson(options.results, { tool: options.tool, inputs, elapsedMs: Date.now() - began, ...counts });
      write(`▶ ${label}: recorded ${path.relative(root, options.results)}\n`);
    }
    // A run that the gap watch stopped fails with its line; a reporter that the stop ended before its summary wrote no counts.
    if (gapExpired) return 1;
    if (counts === null) {
      write(`✖ ${label}: the progress reporter wrote no counts, so the run cannot show that a test ran; the tool must run with the reporter of scripts/kit\n`);
      return 1;
    }
    if (counts.ran === 0) {
      write(`✖ ${label}: no test ran: expected at least 1 test that passes, fails or runs out of time, actual 0 (${counts.skipped} skipped)\n`);
      return 1;
    }
    return exit;
  } finally {
    clearInterval(parentWatch);
    if (onInterrupt) for (const signal of INTERRUPTS) process.off(signal, onInterrupt);
    rmSync(results, { recursive: true, force: true });
    library?.cleanup();
    // With its handler removed, the signal ends the runner as it would have without one, unless the host handles it.
    if (interrupted) process.kill(process.pid, interrupted);
  }
}

if (isMain(import.meta.url)) {
  // run rejects with an Error, the usage or a failure of the files.
  run(process.argv.slice(2)).then(status => { process.exitCode = status; }, (error: Error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
