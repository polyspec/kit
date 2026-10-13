// The runners of the language-parity check: the native command that runs the test of a binding, and the outcome of each
// native test that its output reports. Each runner runs the test tool of its language and reads the tool's output with the
// shared parsers of test-output.mts, or node:test through its reporter API, so a binding needs no line that the test prints
// for the check. A suite binding runs the cases of its symbol; a feature binding runs its whole test file, and its id is the
// native test name as the parser reports it:
//   go      `go test -json` in the module of the test, with the binding symbol as the test function; a case is a direct
//           subtest `<symbol>/<case>`; a feature runs the package of the test without -run
//   cargo   `cargo test` in the crate of the test, with the libtest filter `<symbol>::`; a case is a test `<symbol>::<case>`;
//           a feature runs the target of the test without a filter
//   node    `node --test --test-reporter=<parity-node-reporter.mts> <test>`, whose lines name each test with its enclosing
//           suites, joined by ' › '; a case is a top-level test, and a feature id is the joined name
//   vitest  `node node_modules/vitest/vitest.mjs run <args> --reporter=json --outputFile.json=var/parity/vitest.json <test>`
//           from the checkout root, read from the JSON report that vitest writes; a test is named by the titles of its
//           suites and its own joined by ' › ', a case is a top-level test, and a feature id is the joined name
//   php     `php <args> vendor/bin/phpunit --teamcity --configuration <package>/phpunit.xml <test>` from the checkout root, with
//           the phpunit.xml of the Composer package of the test (phpunit.xml.dist when only that exists), or
//           `--no-configuration` when it has none; a case is a test method `test_<case>`, and a feature id is the method
//   python  `python3 <args> -m unittest -v <test>`; a case is a test method `test_<case>`, and a feature id is the method
import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { goEvents, cargoEvents, phpunitEvents, pythonEvents, type Sink, type TestRef } from './test-output.mts';
import { toolCommand } from './mise-tools.mts';
import { siblingTool } from './paths.mts';
import type { Environment, ParityBinding, ParityImplementation, ParityUnit, Runner } from './parity-declaration.mts';

// The node:test reporter of the node runner.
const NODE_REPORTER = siblingTool(import.meta.url, 'parity-node-reporter');

/** The kind of the unit of a run: a suite runs the cases of its binding, a feature the whole test file of its binding. */
export type RunKind = Exclude<ParityUnit['kind'], 'api'>;

/** The output of a finished run. */
export interface RunOutput {
  stdout: string;
  stderr: string;
}

/** The outcome of a case as the output reports it. */
export type Outcome = 'pass' | 'fail' | 'skip';

/** How a binding runs and how its output is read; see RUNNERS. */
export interface BindingRun {
  error?: never;
  args: (test: string[]) => string[];
  cwd: string;
  caseOf: (name: string) => string | undefined;
  read: (output: RunOutput, sink: Sink) => void;
  detail: (output: RunOutput) => string[];
}

/** A binding that cannot run, with the sentence that says why; a sentence is never empty. */
export interface RunError {
  error: `${string} ${string}`;
}

/** A runner of RUNNERS. */
interface RunnerOf {
  program: (root: string) => string;
  env?: Record<string, string>;
  run: (root: string, binding: Pick<ParityBinding, 'test' | 'symbol'>, kind: RunKind) => BindingRun | RunError;
}

/** The run of a binding that runOf gives: the command, its arguments and its environment. */
export type BindingCommand = Omit<BindingRun, 'args' | 'error'> & { error?: never; args: string[]; command: string; env: Environment };

/** The directory of the nearest `marker` file above `file` (repository-relative), or undefined when the repository has none. */
function nearest(root: string, file: string, marker: string): string | undefined {
  for (let directory = path.posix.dirname(file); ; directory = path.posix.dirname(directory)) {
    if (existsSync(path.join(root, directory, marker))) return directory;
    if (directory === '.') return undefined;
  }
}

/** A sink that keeps nothing, for the parsers that are read only for what they collect. */
const SILENT: Sink = { start() {}, pass() {}, fail() {}, skip() {}, todo() {}, line() {}, raw() {} };

/** Calls `handler` with each line of `text`. */
const eachLine = (text: string, handler: (line: string) => void): void => text.split('\n').forEach(handler);

/** The last three lines of standard error, which explain a run that failed. */
const stderrTail = ({ stderr }: RunOutput): string[] => stderr.trim().split('\n').slice(-3).filter(Boolean);

/** The part of a test name after `prefix`, or undefined when the name lies outside the binding. */
const after = (prefix: string, name: string): string | undefined => (name.startsWith(prefix) ? name.slice(prefix.length) : undefined);

/** The name of a unittest or PHPUnit test method: `test_<case>` names the case `<case>`; another name is the case itself. */
const methodCase = (name: string): string => (name.startsWith('test_') ? name.slice(5) : name);

// The JSON report of a vitest run, in the checkout; the report of vitest 5 as its run reads it, and the sink call of each status
// (a todo test is expected to fail, so it is no pass).
const VITEST_REPORT = 'var/parity/vitest.json';
type VitestReport = { testResults: { assertionResults: { ancestorTitles: string[]; title: string; status: keyof typeof VITEST_OUTCOMES }[] }[] };
const VITEST_OUTCOMES = { passed: 'pass', failed: 'fail', skipped: 'skip', pending: 'skip', todo: 'todo' } as const;

/** The native name itself, the id of a feature test. */
const itself = (name: string): string => name;

// Each runner: the program that it starts unless the implementation declares `command`, the environment that it sets over the
// check's environment, and `run`, which gives the arguments and the working directory of a binding and how its output is read.
// `caseOf` names the case of a native test name, or undefined when the test is no case of the binding; `read` feeds the output
// to a sink (test-output.mts); `detail` lists the lines that explain a failed run.
const RUNNERS: Record<Runner, RunnerOf> = {
  go: {
    program: () => 'go',
    run(root, binding, kind) {
      const module = nearest(root, binding.test, 'go.mod');
      if (module === undefined) return { error: `no go.mod lies above ${binding.test}` };
      const directory = path.posix.relative(module, path.posix.dirname(binding.test));
      return {
        args: test => ['test', ...test, '-json', '-count=1', ...(kind === 'suite' ? ['-run', `^${binding.symbol}$`] : []), `./${directory}`],
        cwd: module,
        // A subtest nested below a case keeps its `/`, so R3 names it as a case that the suite does not declare.
        caseOf: kind === 'suite' ? name => after(`${binding.symbol}/`, name) : itself,
        read: ({ stdout }, sink) => eachLine(stdout, goEvents(sink)),
        // The compiler output of a package that does not build, then the standard error.
        detail: ({ stdout, stderr }) => {
          const build: string[] = [];
          eachLine(stdout, goEvents(SILENT, build));
          return [...build, ...stderr.split('\n').map(line => line.trim()).filter(Boolean)];
        },
      };
    },
  },
  cargo: {
    program: () => 'cargo',
    run(root, binding, kind) {
      const crate = nearest(root, binding.test, 'Cargo.toml');
      if (crate === undefined) return { error: `no Cargo.toml lies above ${binding.test}` };
      const relative = path.posix.relative(crate, binding.test);
      const target = /^tests\/[^/]+\.rs$/.test(relative) ? ['--test', path.posix.basename(relative, '.rs')] : ['--lib'];
      return {
        args: test => ['test', ...test, '--manifest-path', path.posix.join(crate, 'Cargo.toml'), ...target, '--', '--test-threads=1', ...(kind === 'suite' ? [`${binding.symbol}::`] : [])],
        cwd: '.',
        caseOf: kind === 'suite' ? name => after(`${binding.symbol}::`, name) : itself,
        read: ({ stdout }, sink) => cargoEvents(sink).stdout(`${stdout}\n`),
        detail: stderrTail,
      };
    },
  },
  node: {
    program: () => process.execPath,
    run: (root, binding, kind) => ({
      args: test => [...test, '--test', `--test-reporter=${NODE_REPORTER}`, binding.test],
      cwd: '.',
      // A case of a suite is a top-level test; a test nested in it is none.
      caseOf: kind === 'suite' ? name => (name.includes(' › ') ? undefined : name) : itself,
      read: ({ stdout }, sink) => eachLine(stdout, (line) => {
        if (!line) return;
        const { name, outcome } = JSON.parse(line) as { name: string; outcome: 'pass' | 'fail' | 'skip' };
        sink[outcome]({ id: name, name });
      }),
      detail: stderrTail,
    }),
  },
  vitest: {
    program: () => process.execPath,
    run(root, binding, kind) {
      const vitest = 'node_modules/vitest/vitest.mjs';
      if (!existsSync(path.join(root, vitest))) return { error: `${vitest} does not exist; run npm ci` };
      // vitest 5 writes its JSON report to a file; each run writes it anew, and the run reads and removes it. A report that an
      // interrupted check left is removed first, so a run that writes none reads none.
      const report = path.join(root, VITEST_REPORT);
      rmSync(report, { force: true });
      return {
        args: test => [path.join(root, vitest), 'run', ...test, '--reporter=json', `--outputFile.json=${report}`, binding.test],
        cwd: '.',
        caseOf: kind === 'suite' ? name => (name.includes(' › ') ? undefined : name) : itself,
        read: (output, sink) => {
          if (!existsSync(report)) return;
          const { testResults } = JSON.parse(readFileSync(report, 'utf8')) as VitestReport;
          rmSync(report);
          for (const result of testResults.flatMap(file => file.assertionResults)) {
            const name = [...result.ancestorTitles, result.title].join(' › ');
            sink[VITEST_OUTCOMES[result.status]]({ id: name, name });
          }
        },
        detail: stderrTail,
      };
    },
  },
  php: {
    program: () => 'php',
    run(root, binding, kind) {
      const composer = nearest(root, binding.test, 'composer.json');
      if (composer === undefined) return { error: `no composer.json lies above ${binding.test}` };
      const phpunit = path.posix.join(composer, 'vendor/bin/phpunit');
      if (!existsSync(path.join(root, phpunit))) return { error: `${phpunit} does not exist; run composer install in ${composer}` };
      // The configuration of the package: PHPUnit reads none from the checkout root, so the run names it.
      const configuration = ['phpunit.xml', 'phpunit.xml.dist'].map(file => path.posix.join(composer, file)).find(file => existsSync(path.join(root, file)));
      const flags = configuration === undefined ? ['--no-configuration'] : ['--configuration', configuration];
      return { args: test => [...test, phpunit, '--teamcity', ...flags, binding.test], cwd: '.', caseOf: kind === 'suite' ? methodCase : itself, read: ({ stdout }, sink) => eachLine(stdout, phpunitEvents(sink)), detail: stderrTail };
    },
  },
  python: {
    program: root => toolCommand(root, 'python3'),
    // unittest writes its results to standard error; the colors are off, so the lines are plain.
    env: { NO_COLOR: '1', PYTHON_COLORS: '0' },
    run: (root, binding, kind) => ({ args: test => [...test, '-m', 'unittest', '-v', binding.test], cwd: '.', caseOf: kind === 'suite' ? methodCase : itself, read: ({ stderr }, sink) => pythonEvents(sink)(`${stderr}\n`), detail: stderrTail }),
  },
};

/**
 * The outcomes that the output of a run reports for the binding: `[name, outcome]` pairs, one for each case event in the order
 * of the output. A case that the binding does not name is left out here, and R3 judges the names that remain.
 */
export function outcomesOf(run: Pick<BindingRun, 'caseOf' | 'read'>, output: RunOutput): [string, Outcome][] {
  const outcomes: [string, Outcome][] = [];
  const record = (outcome: Outcome) => (test: TestRef) => {
    const name = run.caseOf(test.name);
    if (name !== undefined) outcomes.push([name, outcome]);
  };
  // A todo is a test that the tool expects to fail, so it is no pass: the case fails.
  const sink = { ...SILENT, pass: record('pass'), fail: record('fail'), skip: record('skip'), todo: record('fail') };
  run.read(output, sink);
  return outcomes;
}

/**
 * The run of the binding `binding` of a unit of `kind` in `implementation`: `{ command, args, cwd, env, caseOf, read,
 * detail }` with `cwd` relative to `root`, `env` the variables of the implementation over `base`, and `detail(output)` the
 * lines that explain a failed run; or `{ error }`. A `command` with a / is a path relative to `root`.
 */
export function runOf(implementation: Partial<ParityImplementation> & Pick<ParityImplementation, 'runner'>, root: string, binding: Pick<ParityBinding, 'test' | 'symbol'>, kind: RunKind, base: Environment): BindingCommand | RunError {
  const runner = RUNNERS[implementation.runner];
  const run = runner.run(root, binding, kind);
  if (run.error) return run;
  const declared = implementation.command;
  const command = declared === undefined ? runner.program(root) : declared.includes('/') ? path.resolve(root, declared) : declared;
  // A run started from inside node --test must not join that run as its child, and its node:test output reaches the reporter only outside it.
  const { NODE_TEST_CONTEXT: _joined, ...inherited } = base;
  const env = { ...inherited, ...runner.env, ...Object.fromEntries((implementation.env ?? []).map(entry => [entry.name, entry.value])) };
  return { ...run, args: run.args(implementation.args ?? []), command, env };
}
