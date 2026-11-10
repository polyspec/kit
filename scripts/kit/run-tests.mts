#!/usr/bin/env node
// The test runner. A test target runs its test tool through this script, which prints each test as it starts, keeps running,
// passes, fails or is skipped, with the elapsed time.
//
//   node scripts/kit/run-tests.mts <tool> [--cwd <directory>] [--php-extension <file>]... [--venv <directory>]
//       [--module <name>] [--results <file> [--inputs <path>]...] [--] [<arguments>]
//
// The arguments after the options of the runner go to the tool. --results writes the record of the run, passed or not, to
// <file> (relative to the checkout root): the counts, each test with its status and elapsed time, the tool, the elapsed time
// of the run and `inputs`, the `inputsDigest` of the --inputs paths (the --cwd directory when none is given), so that a
// check can tell a record of the current files from a stale one.
//
// --venv runs the python tool with the interpreter of a virtual environment, so a package's tests import its own installed
// dependencies. The runner starts <directory>/bin/python as given and judges no environment (K1053). Its
// symbolic links are used as the tool that made it left them: `make python-venv DIR=<directory>` (python-venv.mts) makes such
// an environment with `uv venv`.
//
// Tools: node (node --test), vitest, playwright (Playwright Test), go (go test), cargo (cargo test), phpunit and python
// (python3 -m unittest). kit sets no time limit (K1175): a run ends when its tool exits, and the exit status of the tool and the
// counts decide it. Each tool keeps its own limits, which the caller passes after --, such as --test-timeout of node --test or
// -timeout of go test.
//
// Every tool runs in its own process group (spawn's `detached`), so a stop reaches the processes that the tool started, such
// as the interpreter that the mise shim runs (K141). When the runner receives SIGINT, SIGTERM or SIGHUP, or its parent ends, it
// stops the group with SIGTERM and, when the tool has not closed after a grace period, with SIGKILL, and then ends on that
// signal. Only a SIGKILL of the runner itself, which no process can handle, leaves the group running. A run that selects no
// test file, name or id runs the whole runtime (K1053). A run in which no test passed or failed fails, so a selection that
// matches nothing never passes; a file of node tests that registers no test fails.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { pathToFileURL } from 'node:url';
import { createProgress } from './test-progress.mts';
import { compactSeconds } from './time.mts';
import { composerVendor, packageVendorFile } from './composer-vendor.mts';
import { cargoEvents, goEvents, phpunitEvents, pythonEvents, toProgress } from './test-output.mts';
// stopGroup is the group stop of process-group.mts, which run-command shares (K430).
import { signalGroup, stopGroup, watchRoot, type SpawnedRoot } from './process-group.mts';
import { toolCommand as miseCommand } from './mise-tools.mts';
import { writeJson } from './bootstrap/files.mts';
import { isMain, repositoryRoot, siblingTool, TEST_ROOT } from './paths.mts';
import { inputsDigest } from './tracked-files.mts';
import { readJsonFile } from './schema-validate.mts';
import { present } from './present.mts';

// The options of run-tests.mts, each followed by its value.
const RUNNER_OPTIONS = ['--php-extension', '--venv', '--module', '--cwd', '--results', '--inputs'];

/**
 * The options of run-tests.mts in `words`, the words after its tool, each with its value, and the arguments that it passes to the
 * tool: the words after the options, without a -- that ends them.
 */
function runnerWords(words: readonly string[]): { options: [string, string | undefined][]; args: string[] } {
  const options: [string, string | undefined][] = [];
  let index = 0;
  for (let flag = words[0]; flag !== undefined && RUNNER_OPTIONS.includes(flag); flag = words[index]) {
    options.push([flag, words[index + 1]]);
    index += 2;
  }
  return { options, args: words.slice(words[index] === '--' ? index + 1 : index) };
}

const TOOLS: readonly string[] = ['node', 'vitest', 'playwright', 'go', 'cargo', 'phpunit', 'python'];
const USAGE = `Usage: node scripts/kit/run-tests.mts <${TOOLS.join('|')}> [--php-extension <file>]... [--venv <directory>] [--module <name>] [--cwd <directory>] [--results <file> [--inputs <path>]...] [--] [<arguments>]`;

/** The options of a run: the tool, the directory, the arguments of the tool and the record. */
export type RunOptions = {
  tool: string;
  cwd: string;
  args: string[];
  inputs: string[];
  phpExtensions: string[];
  venv?: string;
  module?: string;
  results?: string;
};

/** The options that the command of a tool reads. */
export type ToolOptions = Pick<RunOptions, 'tool' | 'cwd' | 'args' | 'venv' | 'module'> & Partial<Pick<RunOptions, 'phpExtensions'>>;

// How a tool ended: it could not start, or it closed with a status or a signal.
type Ended = { error: Error } | { error?: undefined; status: number | null; signal: NodeJS.Signals | null };

// The counts that a progress reporter writes to KIT_TEST_RESULT.
type Counts = { ran: number; skipped: number; [key: string]: unknown };

// The fix for a tool that cannot start.
const INSTALL: Record<string, (options: { cwd: string; root: string }) => string> = {
  node: () => 'run make install-tools TOOLS=npm, which installs the Node.js of mise.toml',
  vitest: () => 'run make install',
  playwright: () => 'run make install, which installs the project-local Playwright package',
  go: () => 'declare go in mise.toml and run make install-tools, which installs it into var/tools/mise',
  cargo: () => 'install rustup and run make install, which installs the toolchain of rust-toolchain.toml',
  phpunit: ({ cwd, root }) => `run composer install in ${path.relative(root, cwd) || '.'}`,
  python: () => 'declare python in mise.toml and run make install-tools, which installs it into var/tools/mise',
};

export function parseArguments(argv: string[], root = repositoryRoot()) {
  const [tool, ...rest] = argv;
  if (tool === undefined || !TOOLS.includes(tool)) throw new Error(USAGE);
  const options: RunOptions = { tool, cwd: root, args: [], inputs: [], phpExtensions: [] };
  const { options: pairs, args } = runnerWords(rest);
  for (const [flag, value] of pairs) {
    if (flag === '--php-extension') {
      if (!value || tool !== 'phpunit') throw new Error(USAGE);
      options.phpExtensions.push(path.resolve(root, value));
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

/** The arguments of cargo itself: those before a -- that starts the arguments of the test harness. */
function cargoArguments(args: string[]) {
  const index = args.indexOf('--');
  return index === -1 ? args : args.slice(0, index);
}


/** The Playwright CLI installed in this checkout or its test project; never resolve one from the machine. */
function playwrightCli(root: string, cwd: string): string | undefined {
  const relative = path.relative(root, cwd);
  const inside = relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
  const directories = [cwd];
  if (inside) {
    let directory = cwd;
    while (directory !== root) {
      directory = path.dirname(directory);
      directories.push(directory);
    }
  }
  for (const directory of directories) {
    for (const packagePath of ['node_modules/@playwright/test/cli.js', 'node_modules/playwright/cli.js']) {
      const cli = path.join(directory, packagePath);
      if (existsSync(cli)) return cli;
    }
  }
  return undefined;
}

/** The command of a tool with its progress arguments. */
// K452-1: each --php-extension is loaded by the PHP of the run before PHPUnit starts. One that does not load (a build for another
// PHP or PHP API) returns a problem that names its .so path, what PHP reports, and the running PHP, so a run never tests the
// library silently on the wrong PHP.
export function probeExtensions(extensions: string[], php: string): string | undefined {
  for (const extension of extensions) {
    const probe = spawnSync(php, ['-n', '-d', `extension=${extension}`, '-r', 'exit(0);'], { encoding: 'utf8' });
    if (probe.error) return `the PHP extension ${extension} cannot be probed: ${php} could not start: ${probe.error.message}`;
    const reported = `${probe.stdout}${probe.stderr}`.trim();
    if (probe.status === 0 && !/Unable to load|compiled with module API|undefined symbol/.test(reported)) continue;
    // The run that names the PHP reports its own failure, so the problem never names an empty PHP (K1148).
    const version = spawnSync(php, ['-n', '-r', 'echo PHP_VERSION, " ", PHP_API;'], { encoding: 'utf8' });
    const running = version.error ? `(${php} could not start: ${version.error.message})`
      : version.status === 0 ? version.stdout.trim() : `(its version run ${version.signal ? `ended by signal ${version.signal}` : `exited with exit status ${version.status}`}: ${`${version.stdout}${version.stderr}`.trim()})`;
    return `the PHP extension ${extension} does not load in the running PHP ${running}; PHP reports: ${reported}`;
  }
  return undefined;
}

export function toolCommand({ tool, cwd, args, phpExtensions = [], venv, module }: ToolOptions, root = repositoryRoot()): { command: string; args: string[]; build?: string[] } {
  // Concurrency, caching and time limits of a tool are the caller's arguments after --, such as --test-concurrency=1,
  // --test-timeout=60000, -count=1 -timeout=0 or -- --test-threads=1 (K1094, K1175).
  switch (tool) {
    case 'node':
      return {
        command: process.execPath,
        // The reporter attributes each case to the file whose group event opened it, so a run of several files that need that
        // passes --test-concurrency=1 (K218).
        args: ['--test', `--test-reporter=${pathToFileURL(siblingTool(import.meta.url, 'node-reporter')).href}`, '--test-reporter-destination=stdout', ...args],
      };
    case 'vitest':
      // The runner starts the entry of the vitest package with its own node, so vitest runs on the declared Node.js and not on
      // the node that the shebang of node_modules/.bin/vitest finds on PATH.
      return { command: process.execPath, args: [path.join(root, 'node_modules/vitest/vitest.mjs'), 'run', `--reporter=${siblingTool(import.meta.url, 'vitest-reporter')}`, ...args] };
    case 'playwright': {
      const cli = playwrightCli(root, cwd);
      if (cli === undefined) throw new Error(`the project-local Playwright CLI does not exist; ${present(INSTALL.playwright, 'INSTALL.playwright')({ cwd, root })}`);
      return { command: process.execPath, args: [cli, 'test', ...args, `--reporter=${siblingTool(import.meta.url, 'playwright-reporter')}`] };
    }
    case 'go':
      // go test keeps its own -timeout, which limits a test binary to 10 minutes unless the caller passes another.
      // go is the one of mise.toml, run by the shim of the checkout, else the go of PATH (K947).
      // The build runs the test binaries with `true`, which ends at once, so it compiles each binary and runs no test (K549-1).
      return { command: miseCommand(root, 'go'), args: ['test', '-json', ...args], build: ['test', '-exec=true', ...args] };
    case 'cargo':
      // cargo is not pinned by kit: rustup finds it on PATH (rust-toolchain.toml), so it is the one command that is not resolved
      // by the checkout. A caller that wants each test's start before its result passes -- --test-threads=1.
      return { command: 'cargo', args: ['test', ...args], build: ['test', '--no-run', ...cargoArguments(args)] };
    case 'phpunit': {
      // PHPUnit of the vendor directory that Composer gives the package of `cwd`: its own, or that of the nearest Composer
      // project above it, such as the root of a monorepo (composer-vendor.mts, K186); with none, the path of its own, whose
      // start fails with the install fix.
      const vendor = phpunitVendor(root, cwd);
      const phpunit = path.join(vendor ?? composerVendor(cwd), 'bin/phpunit');
      // Each --php-extension loads a PHP extension, such as a build of the repository, into the PHP of PHPUnit from the ini file
      // of phpExtensionScan, in the given order, so an extension loads after one that it depends on (K165, K900).
      // The PHP of both runs is the wrapper of var/tools/bin that install-tools writes for the checkout, else the php of PATH (K393, K947).
      // K452: an extension run gives PHPUnit the configuration of the package, so the bootstrap that it names loads as in the library run.
      const configuration = ['phpunit.xml', 'phpunit.xml.dist'].map(file => path.join(cwd, file)).find(file => existsSync(file));
      const configured = configuration === undefined ? [] : ['--configuration', configuration];
      // The extensions load from the ini file of phpExtensionScan, which a separate-process child reads too (K900).
      if (phpExtensions.length) return { command: miseCommand(root, 'php'), args: [phpunit, '--teamcity', ...configured, ...args] };
      return { command: phpunit, args: ['--teamcity', ...args] };
    }
    case 'python':
      // -v prints each test with its outcome on standard error; unittest runs one test at a time. -v goes last: before a
      // `discover` argument unittest would read `discover` as a test name. A --module harness runs `-m <module>` instead.
      const interpreter = venv ? path.join(venv, 'bin', 'python') : miseCommand(root, 'python3');
      return { command: interpreter, args: ['-m', module ?? 'unittest', ...args, '-v'] };
  }
  throw new Error(USAGE);
}

/**
 * The Composer vendor directory whose PHPUnit a run in `cwd` starts: that of the package of `cwd`, or of the nearest Composer
 * project above it, such as the root of a monorepo, that holds bin/phpunit (K186); undefined when none does.
 */
function phpunitVendor(root: string, cwd: string): string | undefined {
  const found = packageVendorFile(root, path.relative(root, cwd) || '.', 'bin/phpunit');
  return found === undefined ? undefined : path.resolve(root, found, '../..');
}

/**
 * The PHP_INI_SCAN_DIR that loads the PHP `extensions` of a run, in their order (K900): an ini file in `directory` with an
 * extension= line for each, after the scan directories of `env`, or PHP's own (a leading ':'). PHPUnit gives a child of
 * #[RunTestsInSeparateProcesses] its own ini overrides only, without extension, while a child inherits the environment.
 */
export function phpExtensionScan(extensions: readonly string[], directory: string, env: NodeJS.ProcessEnv): { PHP_INI_SCAN_DIR?: string } {
  if (extensions.length === 0) return {};
  writeFileSync(path.join(directory, 'kit-php-extensions.ini'), extensions.map(extension => `extension=${extension}\n`).join(''));
  // An empty PHP_INI_SCAN_DIR scans nothing, and an unset one PHP's own directory, which a leading ':' keeps.
  return { PHP_INI_SCAN_DIR: env.PHP_INI_SCAN_DIR === '' ? directory : `${env.PHP_INI_SCAN_DIR ?? ''}:${directory}` };
}

/**
 * The tests that the run of `argv` (the arguments of run-tests) selects, as PHPUnit lists them: the command of the run with
 * --list-tests added, so the library and the extension are the run's own (K390-1). PHPUnit prints each test as ` - Class::method`.
 */
export function listedTests(argv: string[], root = repositoryRoot(), callerEnv: NodeJS.ProcessEnv = process.env): string[] {
  const options = parseArguments(argv, root);
  const { command, args } = toolCommand({ ...options, args: [...options.args, '--list-tests'] }, root);
  // The tool of the checkout starts with the mise of the checkout, as a run in make does (K411).
  const env = { ...callerEnv };
  const scan = mkdtempSync(path.join(tmpdir(), 'kit-php-scan-'));
  let result;
  try {
    Object.assign(env, phpExtensionScan(options.phpExtensions, scan, env));
    result = spawnSync(command, args, { cwd: options.cwd, env, encoding: 'utf8' });
  } finally {
    rmSync(scan, { recursive: true, force: true });
  }
  if (result.error) throw result.error;
  // PHPUnit writes an error of its configuration to standard output, so the failure names both streams and a signal (K1149).
  if (result.status !== 0) throw new Error(`phpunit --list-tests in ${path.relative(root, options.cwd) || '.'} ended ${result.signal ? `on signal ${result.signal}` : `with ${result.status}`}: ${[result.stdout.trim(), result.stderr.trim()].filter(Boolean).join('\n')}`);
  return result.stdout.split('\n').flatMap(line => /^\s*-\s+(\S.*)$/.exec(line)?.[1] ?? []);
}

/** Runs the tool of `argv`; resolves the exit status of the run (0 passed, 1 failed). */
/**
 * Sends SIGTERM to the process group of a test tool (its pgid is the pid of the detached child). EPERM while a member is in
 * exit and ESRCH after the group ended are not errors (process-group.mts).
 */
export function terminateGroup(pgid: number, kill?: Parameters<typeof signalGroup>[2], spawned?: SpawnedRoot) {
  return signalGroup(pgid, 'SIGTERM', kill, spawned);
}

/** How long a stopped tool has to close after SIGTERM before its group receives SIGKILL. */
const STOP_GRACE_MS = 5000;

/** The signals that interrupt the runner; it stops the tool's group, then ends on the signal. */
const INTERRUPTS: readonly NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP'];

/** How often the runner checks that its parent is still the process that started it. */
const PARENT_POLL_MS = 200;

export async function run(argv: string[], { root = repositoryRoot(), write = (text: string): unknown => process.stdout.write(text), graceMs = STOP_GRACE_MS, callerEnv = process.env }: { root?: string; write?: (text: string) => unknown; graceMs?: number; callerEnv?: NodeJS.ProcessEnv } = {}): Promise<number> {
  const options = parseArguments(argv, root);
  const began = Date.now();
  const { command, args, build } = toolCommand(options, root);
  const label = `${options.tool} ${path.relative(root, options.cwd) || '.'}${options.args.length ? ` ${options.args.join(' ')}` : ''}`;
  write(`▶ ${label}\n`);
  const unbuilt = options.phpExtensions.find(extension => !existsSync(extension));
  if (unbuilt) {
    write(`✖ ${label}: the PHP extension ${path.relative(root, unbuilt)} is not built; build it before the run\n`);
    return 1;
  }
  const unloaded = options.phpExtensions.length ? probeExtensions(options.phpExtensions, miseCommand(root, 'php')) : undefined;
  if (unloaded) {
    write(`✖ ${label}: ${unloaded}\n`);
    return 1;
  }
  const reads = ['go', 'cargo', 'phpunit', 'python'].includes(options.tool);
  const cargo = options.tool === 'cargo';
  const python = options.tool === 'python';
  // The progress reporters write their counts to this file; the runner requires that a test ran.
  const results = mkdtempSync(path.join(tmpdir(), 'kit-test-result-'));
  const resultFile = path.join(results, 'result.json');
  // The run passes the environment of its caller as it is (K1094): a runner started from inside node --test is started without
  // NODE_TEST_CONTEXT by that caller, and a caller whose environment sets FORCE_COLOR passes PYTHON_COLORS=0 for the python
  // tool, whose parser reads plain lines.
  // The reporters run in the --cwd directory, so they take the repository root from TEST_ROOT.
  const env: NodeJS.ProcessEnv = { ...callerEnv, KIT_TEST_RESULT: resultFile, [TEST_ROOT]: root };
  // The ini file of the extensions lives in the folder of the results, which the run removes at its end (K900).
  Object.assign(env, phpExtensionScan(options.phpExtensions, results, env));
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
    // Go and Cargo compile before the tests run, and the exit status of the build decides it. Parent loss and an interruption
    // stop its process group, and its output is forwarded while it runs.
    if (build !== undefined) {
      const text = `${command} ${build.join(' ')}`;
      const buildBegan = Date.now();
      write(`[build] ${text}: started\n`);
      const buildSince = Date.now();
      const builder = spawn(command, build, { cwd: options.cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
      const buildRoot = watchRoot(builder, buildSince);
      present(builder.stdout, 'builder.stdout').setEncoding('utf8').on('data', (text: string) => write(text)); // The stream is piped.
      present(builder.stderr, 'builder.stderr').setEncoding('utf8').on('data', (text: string) => write(text)); // The stream is piped.
      const built = new Promise<Ended>((resolve) => {
        builder.once('error', error => resolve({ error }));
        builder.once('close', (status, signal) => resolve({ status, signal }));
      });
      let buildStopping: Promise<void> | undefined;
      // A build that could not start has no pid and no group to stop.
      stopRunning = () => { if (builder.pid !== undefined) buildStopping ??= stopGroup(builder.pid, built, graceMs, undefined, buildRoot); };
      // The leader may exit before descendants close its inherited output pipes.
      builder.once('exit', stopRunning);
      const ended = await built;
      await buildStopping;
      const buildEnd = finished(ended, 'the build of the tests');
      const outcome = typeof buildEnd === 'string' ? buildEnd : buildEnd.signal ? `ended on ${buildEnd.signal}` : `ended with exit code ${buildEnd.status}`;
      write(`[build] ${text}: ${outcome} (${compactSeconds(Date.now() - buildBegan)})\n`);
      if (typeof buildEnd === 'string') {
        write(`✖ ${label}: ${buildEnd}\n`);
        return 1;
      }
      if (buildEnd.status !== 0) {
        write(`✖ ${label}: the build of the tests \`${text}\` ended ${buildEnd.signal ? `on ${buildEnd.signal}` : `with exit code ${buildEnd.status}`}\n`);
        return 1;
      }
    }
    const since = Date.now();
    const child = spawn(command, args, { cwd: options.cwd, env, stdio: ['ignore', reads ? 'pipe' : 'inherit', cargo || python ? 'pipe' : 'inherit'], detached: true });
    const spawnedChild = watchRoot(child, since);
    // A tool that cannot start, such as a command missing on PATH, fails with its command and the install fix.
    const closed = new Promise<Ended>((resolve) => {
      child.once('error', error => resolve({ error }));
      child.once('close', (status, signal) => resolve({ status, signal }));
    });
    let stopping: Promise<void> | undefined;
    // A tool that could not start has no pid and no group to stop.
    const stop = () => { if (child.pid !== undefined) stopping ??= stopGroup(child.pid, closed, graceMs, undefined, spawnedChild); };
    stopRunning = stop;
    // Drain output after stopping descendants of a leader that has already exited.
    child.once('exit', stop);
    const progress = reads ? createProgress({ write, resultFile }) : undefined;
    const sink = progress && toProgress(progress);
    // The branches below are the tools that this runner reads, which have a progress and so a sink.
    // The compiler errors of a Go package that does not build, which the summary names.
    const buildErrors: string[] = [];
    // The readers of the output, which are told that it ended before the progress closes, so that a test that did not finish
    // fails with the output that its reader collected (K1141).
    const readers: { end(): void }[] = [];
    // The tools that this runner reads have the standard output piped, and cargo and python the standard error too.
    if (cargo) {
      const events = cargoEvents(present(sink, 'sink')); // A tool that this runner reads has a sink.
      readers.push(events);
      present(child.stdout, 'child.stdout').setEncoding('utf8').on('data', (data: string) => events.stdout(data)); // The stream is piped for this tool.
      readline.createInterface({ input: present(child.stderr, 'child.stderr') }).on('line', line => events.stderr(line)); // The stream is piped for this tool.
    } else if (python) {
      // unittest writes its progress to standard error; the standard output of the tests is printed as it is.
      const events = pythonEvents(present(sink, 'sink')); // A tool that this runner reads has a sink.
      readers.push(events);
      present(child.stderr, 'child.stderr').setEncoding('utf8').on('data', (data: string) => events(data)); // The stream is piped for this tool.
      // python is a tool that this runner reads, so it has a progress.
      readline.createInterface({ input: present(child.stdout, 'child.stdout') }).on('line', text => present(progress, 'progress').line(`  ${text}`));
    } else if (reads) {
      const toolSink = present(sink, 'sink'); // A tool that this runner reads has a sink.
      const phpunit = options.tool === 'go' ? undefined : phpunitEvents(toolSink);
      const go = phpunit === undefined ? goEvents(toolSink, buildErrors) : undefined;
      readers.push(present(phpunit ?? go, 'the reader of the tool'));
      readline.createInterface({ input: present(child.stdout, 'child.stdout') }).on('line', go ?? present(phpunit, 'phpunit')); // The stream is piped for this tool.
    }
    const ended = await closed;
    await stopping;
    const toolEnd = finished(ended, 'the tool');
    if (typeof toolEnd === 'string') {
      write(`✖ ${label}: ${toolEnd}\n`);
      return 1;
    }
    const { status, signal } = toolEnd;
    const code = status ?? (signal ? 1 : 0);
    let exit;
    if (progress) {
      for (const reader of readers) reader.end();
      exit = progress.close(label, { exitCode: code, build: buildErrors }).ok ? 0 : 1;
    } else {
      // node --test and vitest print their summary from inside the tool; a tool that then ends on a signal or a nonzero
      // code fails the run, and this line names why.
      if (code !== 0) write(`✖ ${label}: the tool ended ${signal ? `on ${signal}` : `with exit code ${status}`}\n`);
      exit = code === 0 ? 0 : 1;
    }
    const counts = existsSync(resultFile) ? readJsonFile<Counts>(resultFile, 'test-result.schema.json') : null;
    if (counts !== null && options.results) {
      const inputs = { paths: options.inputs, digest: inputsDigest(root, options.inputs) };
      writeJson(options.results, { tool: options.tool, inputs, elapsedMs: Date.now() - began, ...counts });
      write(`▶ ${label}: recorded ${path.relative(root, options.results)}\n`);
    }
    if (counts === null) {
      write(`✖ ${label}: the progress reporter wrote no counts, so the run cannot show that a test ran; the tool must run with the reporter of scripts/kit\n`);
      return 1;
    }
    if (counts.ran === 0) {
      write(`✖ ${label}: no test ran: expected at least 1 test that passes or fails, actual 0 (${counts.skipped} skipped)\n`);
      return 1;
    }
    return exit;
  } finally {
    clearInterval(parentWatch);
    if (onInterrupt) for (const signal of INTERRUPTS) process.off(signal, onInterrupt);
    rmSync(results, { recursive: true, force: true });
    // With its handler removed, the signal ends the runner as it would have without one, unless the host handles it.
    if (interrupted) process.kill(process.pid, interrupted);
  }
}

if (isMain(import.meta.url)) {
  // run rejects with an Error, the usage or a failure of the files.
  run(process.argv.slice(2)).then(status => { process.exitCode = status; }, (error: Error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
