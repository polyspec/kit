#!/usr/bin/env node
// The test runner. A test target runs its test tool through this script, which prints each test as it starts, keeps running,
// passes, fails or is skipped, with the elapsed time, and gives every test its own timeout.
//
//   node scripts/kit/run-tests.mts <tool> [--timeout <seconds>] [--cwd <directory>] [--php-extension <file>]... [--venv <directory>]
//       [--results <file> [--inputs <path>]...] [--] [<arguments>]
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
// Tools: node (node --test), vitest, go (go test), cargo (cargo test), phpunit and python (python3 -m unittest). node and
// vitest stop a test at its timeout themselves; for go, cargo, phpunit and python this runner stops the tool when a test
// outlives it. No tool has a time
// limit on a package, a file or a whole run.
//
// Every tool runs in its own process group (spawn's `detached`), so a stop reaches the processes that the tool started, such
// as the interpreter that the mise shim runs (K141). The runner stops the group with SIGTERM and, when the tool has not
// closed after a grace period, with SIGKILL: at a test's timeout, and when the runner itself receives SIGINT, SIGTERM or
// SIGHUP, after which it ends on that signal. Only a SIGKILL of the runner itself, which no process can handle, leaves the
// group running. A run in which no test passed, failed or ran out of time fails, so a selection
// that matches nothing never passes; a file of node tests that registers no test fails.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { pathToFileURL } from 'node:url';
import { createProgress } from './test-progress.mts';
import { composerVendor } from './composer-vendor.mts';
import { cargoEvents, goEvents, phpunitEvents, pythonEvents, toProgress } from './test-output.mts';
import { signalGroup } from './process-group.mts';
import { venvProblem } from './python-venv.mts';
import { toolCommand as miseCommand } from './mise-tools.mts';
import { writeJson } from './bootstrap/files.mts';
import { isMain, repositoryRoot, siblingTool, TEST_ROOT } from './paths.mts';
import { inputsDigest } from './tracked-files.mts';
import { readJsonFile } from './schema-validate.mts';
import { present } from './present.mts';

const TOOLS: readonly string[] = ['node', 'vitest', 'go', 'cargo', 'phpunit', 'python'];
const USAGE = `Usage: node scripts/kit/run-tests.mts <${TOOLS.join('|')}> [--timeout <seconds>] [--php-extension <file>]... [--venv <directory>] [--cwd <directory>] [--results <file> [--inputs <path>]...] [--] [<arguments>]`;
const DEFAULT_TIMEOUT_SECONDS = 30;
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
  venv?: string;
  results?: string;
};

/** The options that the command of a tool reads. */
export type ToolOptions = Pick<RunOptions, 'tool' | 'timeoutSeconds' | 'cwd' | 'args' | 'venv'> & Partial<Pick<RunOptions, 'phpExtensions'>>;

// How a tool ended: it could not start, or it closed with a status or a signal.
type Ended = { error: Error } | { error?: undefined; status: number | null; signal: NodeJS.Signals | null };

// The counts that a progress reporter writes to KIT_TEST_RESULT.
type Counts = { ran: number; skipped: number; [key: string]: unknown };

// The fix for a tool that cannot start.
const INSTALL: Record<string, (options: { cwd: string; root: string }) => string> = {
  node: () => 'install the Node.js release of .node-version',
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
  let index = 0;
  for (; index < rest.length; index += 2) {
    const [flag, value] = [rest[index], rest[index + 1]];
    if (flag === '--timeout') {
      if (!/^[1-9]\d*$/.test(value ?? '')) throw new Error(USAGE);
      options.timeoutSeconds = Number(value);
    } else if (flag === '--php-extension') {
      if (!value || tool !== 'phpunit') throw new Error(USAGE);
      options.phpExtensions.push(path.resolve(root, value));
    } else if (flag === '--venv') {
      if (!value || tool !== 'python') throw new Error(USAGE);
      options.venv = path.resolve(root, value);
    } else if (flag === '--cwd') {
      if (!value) throw new Error(USAGE);
      options.cwd = path.resolve(root, value);
    } else if (flag === '--results') {
      if (!value) throw new Error(USAGE);
      options.results = path.resolve(root, value);
    } else if (flag === '--inputs') {
      if (!value) throw new Error(USAGE);
      options.inputs.push(value);
    } else break;
  }
  if (options.inputs.length && !options.results) throw new Error(`--inputs needs --results\n${USAGE}`);
  if (options.results && !options.inputs.length) options.inputs.push(path.relative(root, options.cwd) || '.');
  options.args = rest.slice(rest[index] === '--' ? index + 1 : index);
  return options;
}

function splitCargo(args: string[]) {
  const index = args.indexOf('--');
  return index === -1 ? { cargo: args, harness: [] } : { cargo: args.slice(0, index), harness: args.slice(index + 1) };
}

/** The command of a tool with its progress and timeout arguments. */
export function toolCommand({ tool, timeoutSeconds, cwd, args, phpExtensions = [], venv }: ToolOptions, root = repositoryRoot()) {
  const milliseconds = String(timeoutSeconds * 1000);
  switch (tool) {
    case 'node':
      return {
        command: process.execPath,
        // The preload fails a file whose process is still alive the test timeout after its last test, naming what holds it.
        args: ['--test', `--import=${pathToFileURL(siblingTool(import.meta.url, 'test-exit-deadline')).href}?ms=${milliseconds}`, `--test-timeout=${milliseconds}`, `--test-reporter=${siblingTool(import.meta.url, 'node-reporter')}`, '--test-reporter-destination=stdout', ...args],
      };
    case 'vitest':
      // The runner starts the entry of the vitest package with its own node, so vitest runs on the declared Node.js and not on
      // the node that the shebang of node_modules/.bin/vitest finds on PATH.
      return { command: process.execPath, args: [path.join(root, 'node_modules/vitest/vitest.mjs'), 'run', `--testTimeout=${milliseconds}`, `--hookTimeout=${milliseconds}`, `--reporter=${siblingTool(import.meta.url, 'vitest-reporter')}`, ...args] };
    case 'go':
      // go test has no limit per test; this runner applies it. -timeout=0 removes the limit of go test on a whole test
      // binary, a package.
      return { command: 'go', args: ['test', '-json', '-count=1', '-timeout=0', ...args] };
    case 'cargo':
      // One test at a time, so each test prints its start before its result.
      return { command: 'cargo', args: ['test', ...splitCargo(args).cargo, '--', '--test-threads=1', ...splitCargo(args).harness] };
    case 'phpunit': {
      // PHPUnit of the vendor directory of `cwd`; COMPOSER_VENDOR_DIR, the vendor directory setting of Composer, names another.
      const phpunit = path.join(composerVendor(cwd), 'bin/phpunit');
      // Each --php-extension loads a PHP extension, such as a build of the repository, into the PHP of PHPUnit with its own
      // -d extension=, in the given order, so an extension loads after one that it depends on.
      if (phpExtensions.length) return { command: 'php', args: [...phpExtensions.flatMap(extension => ['-d', `extension=${extension}`]), phpunit, '--teamcity', ...args] };
      return { command: phpunit, args: ['--teamcity', ...args] };
    }
    case 'python':
      // -v prints each test with its outcome on standard error; unittest runs one test at a time. -v goes last: before a
      // `discover` argument unittest would read `discover` as a test name.
      return { command: venv ? path.join(venv, 'bin', 'python') : miseCommand(root, 'python3'), args: ['-m', 'unittest', ...args, '-v'] };
  }
  throw new Error(USAGE);
}

/** Runs the tool of `argv`; resolves the exit status of the run (0 passed, 1 failed). */
/**
 * Sends SIGTERM to the process group of a timed-out test (its pgid is the pid of the detached child). EPERM while a member is in
 * exit and ESRCH after the group ended are not errors (process-group.mts).
 */
export function terminateGroup(pgid: number, kill?: Parameters<typeof signalGroup>[2]) {
  return signalGroup(pgid, 'SIGTERM', kill);
}

/** How long a stopped tool has to close after SIGTERM before its group receives SIGKILL. */
const STOP_GRACE_MS = 5000;

/** The signals that interrupt the runner; it stops the tool's group, then ends on the signal. */
const INTERRUPTS: readonly NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP'];

/**
 * Stops the process group `pgid`: SIGTERM, then SIGKILL once the tool has closed (`closed`) or the grace period has passed,
 * whichever comes first, so that no member that survived SIGTERM or outlived the tool remains. ESRCH and EPERM are not errors
 * (process-group.mts).
 */
export async function stopGroup(pgid: number, closed: Promise<unknown>, graceMs: number, kill?: Parameters<typeof signalGroup>[2]) {
  if (terminateGroup(pgid, kill) === 'ended') return;
  let timer: NodeJS.Timeout | undefined;
  await Promise.race([closed, new Promise((resolve) => { timer = setTimeout(resolve, graceMs); })]);
  clearTimeout(timer);
  signalGroup(pgid, 'SIGKILL', kill);
}

export async function run(argv: string[], { root = repositoryRoot(), write = (text: string): unknown => process.stdout.write(text), graceMs = STOP_GRACE_MS }: { root?: string; write?: (text: string) => unknown; graceMs?: number } = {}): Promise<number> {
  const options = parseArguments(argv, root);
  const began = Date.now();
  const { command, args } = toolCommand(options, root);
  const label = `${options.tool} ${path.relative(root, options.cwd) || '.'}${options.args.length ? ` ${options.args.join(' ')}` : ''}`;
  write(`▶ ${label} (each test ${options.timeoutSeconds}s)\n`);
  const unbuilt = options.phpExtensions.find(extension => !existsSync(extension));
  if (unbuilt) {
    write(`✖ ${label}: the PHP extension ${path.relative(root, unbuilt)} is not built; build it before the run\n`);
    return 1;
  }
  const venvRefusal = options.venv && venvProblem(options.venv, root);
  if (venvRefusal) {
    write(`✖ ${label}: ${venvRefusal}\n`);
    return 1;
  }
  const reads = ['go', 'cargo', 'phpunit', 'python'].includes(options.tool);
  const cargo = options.tool === 'cargo';
  const python = options.tool === 'python';
  // The progress reporters write their counts to this file; the runner requires that a test ran.
  const results = mkdtempSync(path.join(tmpdir(), 'kit-test-result-'));
  const resultFile = path.join(results, 'result.json');
  // A runner started from inside node --test must not join that run as its child.
  // unittest colors its verbose lines when FORCE_COLOR is set (Python 3.14); its parser reads plain lines, so the run turns
  // color off.
  // The reporters run in the --cwd directory, so they take the repository root from TEST_ROOT.
  const env: NodeJS.ProcessEnv = { ...process.env, KIT_TEST_RESULT: resultFile, [TEST_ROOT]: root, ...(python ? { PYTHONUNBUFFERED: '1', NO_COLOR: '1', PYTHON_COLORS: '0' } : {}) };
  delete env.NODE_TEST_CONTEXT;
  // The signal that interrupted the run, which the runner ends on once the tool's group is stopped.
  let interrupted: NodeJS.Signals | undefined;
  let onInterrupt: ((signal: NodeJS.Signals) => void) | undefined;
  try {
    const child = spawn(command, args, { cwd: options.cwd, env, stdio: ['ignore', reads ? 'pipe' : 'inherit', cargo || python ? 'pipe' : 'inherit'], detached: true });
    // A tool that cannot start, such as a command missing on PATH, fails with its command and the install fix.
    const closed = new Promise<Ended>((resolve) => {
      child.once('error', error => resolve({ error }));
      child.once('close', (status, signal) => resolve({ status, signal }));
    });
    let stopping: Promise<void> | undefined;
    // A tool that could not start has no pid and no group to stop.
    const stop = () => { if (child.pid !== undefined) stopping ??= stopGroup(child.pid, closed, graceMs); };
    onInterrupt = (signal) => { interrupted ??= signal; stop(); };
    for (const signal of INTERRUPTS) process.on(signal, onInterrupt);
    let timedOut = false;
    const progress = reads ? createProgress({
      write,
      timeoutMs: options.timeoutSeconds * 1000,
      command: `${command} ${args.slice(0, 2).join(' ')}`,
      // A test runs out of time only after the tool started, so the child has its pid.
      onTimeout: () => { timedOut = true; stop(); },
      resultFile,
    }) : undefined;
    const sink = progress && toProgress(progress);
    // The branches below are the tools that this runner reads, which have a progress and so a sink.
    // The error lines of the tool, which the summary names when the tool exits without a failing test.
    const errors: string[] = [];
    // The compiler errors of a Go package that does not build, which the summary names.
    const build: string[] = [];
    const noting = (handle: (text: string) => void) => (text: string) => {
      if (ERROR_LINE.test(text.trim())) errors.push(text.trim());
      handle(text);
    };
    // The tools that this runner reads have the standard output piped, and cargo and python the standard error too.
    if (cargo) {
      const events = cargoEvents(present(sink, 'sink')); // A tool that this runner reads has a sink.
      present(child.stdout, 'child.stdout').setEncoding('utf8').on('data', events.stdout); // The stream is piped for this tool.
      readline.createInterface({ input: present(child.stderr, 'child.stderr') }).on('line', noting(line => events.stderr(line))); // The stream is piped for this tool.
    } else if (python) {
      // unittest writes its progress to standard error; the standard output of the tests is printed as it is.
      const events = pythonEvents(present(sink, 'sink')); // A tool that this runner reads has a sink.
      present(child.stderr, 'child.stderr').setEncoding('utf8').on('data', (data: string) => { // The stream is piped for this tool.
        for (const text of data.split('\n')) if (ERROR_LINE.test(text.trim())) errors.push(text.trim());
        events(data);
      });
      // python is a tool that this runner reads, so it has a progress.
      readline.createInterface({ input: present(child.stdout, 'child.stdout') }).on('line', text => present(progress, 'progress').line(`  ${text}`));
    } else if (reads) {
      readline.createInterface({ input: present(child.stdout, 'child.stdout') }).on('line', noting(options.tool === 'go' ? goEvents(present(sink, 'sink'), build) : phpunitEvents(present(sink, 'sink')))); // A tool that this runner reads has a sink. // The stream is piped for this tool.
    }
    const ended = await closed;
    await stopping;
    if (interrupted) {
      write(`✖ ${label}: interrupted by ${interrupted}; stopped the process group of the tool\n`);
      return 1;
    }
    if (ended.error) {
      // parseArguments accepts only the tools of TOOLS, and INSTALL has each.
      write(`✖ ${label}: cannot start ${command}: ${ended.error.message}; ${present(INSTALL[options.tool], 'INSTALL[options.tool]')({ cwd: options.cwd, root })}\n`);
      return 1;
    }
    const { status, signal } = ended;
    const code = status ?? (signal ? 1 : 0);
    let exit;
    if (progress) {
      const counts = progress.close(label, { exitCode: timedOut ? 0 : code, errors, build });
      exit = counts.ok && !timedOut ? 0 : 1;
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
      write(`✖ ${label}: no test ran: expected at least 1 test that passes, fails or runs out of time, actual 0 (${counts.skipped} skipped)\n`);
      return 1;
    }
    return exit;
  } finally {
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
