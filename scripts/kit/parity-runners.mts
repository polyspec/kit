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
//   vitest  `node node_modules/vitest/vitest.mjs run <args> --dir <root> --reporter=json --outputFile.json=var/parity/vitest.json
//           <test>` from the checkout root, with --dir the root of the implementation that holds the test, read from the JSON
//           report that vitest writes; a test is named by the titles of its
//           suites and its own joined by ' › ', a case is a top-level test, and a feature id is the joined name
//   php     `php <args> <vendor>/bin/phpunit --teamcity --configuration <package>/phpunit.xml <test>` from the checkout root, with
//           the PHPUnit of the vendor directory that Composer gives the package of the test (composer-vendor.mts), and
//           the phpunit.xml of the Composer package of the test (phpunit.xml.dist when only that exists), or
//           `--no-configuration` when it has none; a suite binding with the symbol `<class>::<method>` (the fully qualified
//           class) runs that method alone through `--filter`, and a case is a data set `<method> with data set "<case>"` of
//           its data provider; without a symbol, a case is a test method `test_<case>` of the file; a feature id is the test method, `<Class>::<method>` or the bare method (K229)
//   python  `python3 <args> -m unittest -v <test>`; a case is a test method `test_<case>`, and a feature id is the test method
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { goEvents, cargoEvents, nodeEvents, phpunitEvents, pythonEvents, type Sink, type TestRef } from './test-output.mts';
import { toolCommand } from './mise-tools.mts';
import { siblingTool } from './paths.mts';
import type { Environment, ParityBinding, ParityImplementation, ParityUnit, Runner } from './parity-declaration.mts';
import { readJsonFile } from './schema-validate.mts';
import { present } from './present.mts';
import { composerVendor, packageVendorFile } from './composer-vendor.mts';

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
  caseOf: (test: TestRef) => string | undefined;
  /**
   * Whether outcomes that name one case are one case, which fails when any of them fails (K229): `true` for every repeated name (the
   * data sets of a method, the items of a python method), `'items'` for only the reports of a database item (K231).
   */
  merge?: boolean | 'items';
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
  run: (root: string, binding: RunTarget, kind: RunKind, roots: readonly string[]) => BindingRun | RunError;
}

/** What a run covers: the test file, the symbol of a suite binding, and the ids of the feature bindings that the file holds. */
export type RunTarget = Pick<ParityBinding, 'test' | 'symbol' | 'command' | 'runner'> & { ids?: string[] };

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

/**
 * The sink of go test -json for a failure that names a test: a package event (a build failure, a package that fails with no
 * test) has no Test, so its name is the package and no test name, and it is no failure of a test (K213).
 */
const testFailures = (sink: Sink): Sink => ({ ...sink, fail: (test, ms, text) => (test.id === test.name ? undefined : sink.fail(test, ms, text)) });

/** Calls `handler` with each line of `text`. */
const eachLine = (text: string, handler: (line: string) => void): void => text.split('\n').forEach(handler);

/** The last three lines of standard error, which explain a run that failed. */
const stderrTail = ({ stderr }: RunOutput): string[] => stderr.trim().split('\n').slice(-3).filter(Boolean);

/** The part of a test name after `prefix`, or undefined when the name lies outside the binding. */
const after = (prefix: string, name: string): string | undefined => (name.startsWith(prefix) ? name.slice(prefix.length) : undefined);

/** The name of a unittest or PHPUnit test method: `test_<case>` names the case `<case>`; another name is the case itself. */
const methodCase = (name: string): string => (name.startsWith('test_') ? name.slice(5) : name);

/** The case of a feature test that the runner names by its native name (go, cargo, node, vitest and python): the name itself. */
const itself = (test: TestRef): string => test.name;

/**
 * The case of a PHPUnit feature test: the id that the binding declares. PHPUnit names a test by its class and method
 * (`<Class>::<method>`, the id that the TeamCity location gives), and a binding declares that form or the bare method name; a
 * data set of the method is named by the method, so the id of a method with data sets is its case (K229).
 */
const featureCase = (ids: readonly string[] = []) => (test: TestRef): string => {
  // The data set of a method is the method's case: `<method> with data set "<set>"` names the method `<method>`.
  const method = (name: string) => name.replace(/ with data set [\s\S]*$/, '');
  const candidates = [test.id, method(test.id), test.name, method(test.name)];
  return candidates.find(candidate => ids.includes(candidate)) ?? test.id;
};

/**
 * The PHPUnit filter of the test method of the symbol `<class>::<method>`: PHPUnit matches it against `<class>::<method>` and
 * `<class>::<method> with data set …`, so it selects the method and each of its data sets, and no method that only starts so.
 */
const methodFilter = (symbol: string): string => `/^${symbol.replaceAll('\\', '\\\\')}(?: with data set |$)/`;

/**
 * The case of a PHPUnit test of the method of `symbol`: the data set `<method> with data set "<case>"` names `<case>`, and an
 * integer key `<method> with data set #<n>` names `#<n>`, which no suite declares; the method without a data set is no case.
 */
function dataSetCase(symbol: string): (test: TestRef) => string | undefined {
  // The declaration requires `<class>::<method>`, so the symbol has a method part.
  const method = present(symbol.split('::')[1], 'symbol.split(\'::\')[1]');
  return (test) => {
    const set = after(`${method} with data set `, test.name);
    return set === undefined ? undefined : /^"(.*)"$/s.exec(set)?.[1] ?? set;
  };
}

// The JSON report of a vitest run, in the checkout; the report of vitest 5 as its run reads it, and the sink call of each status
// (a todo test is expected to fail, so it is no pass).
const VITEST_REPORT = 'var/parity/vitest.json';
type VitestReport = { testResults: { assertionResults: { ancestorTitles: string[]; title: string; status: keyof typeof VITEST_OUTCOMES }[] }[] };
const VITEST_OUTCOMES = { passed: 'pass', failed: 'fail', skipped: 'skip', pending: 'skip', todo: 'todo' } as const;

/** The root among `roots` that holds the test file `test`, or undefined when none does. */
const implementationRoot = (roots: readonly string[], test: string): string | undefined =>
  roots.find(item => test === item || test.startsWith(`${item.replace(/\/$/, '')}/`));

/**
 * The go test flags that select the tests of a run: the symbol of a suite, or the top-level tests of a feature's ids. A subtest id
 * belongs to its top-level test (the part before the first `/`), which go runs with all its subtests; none when a feature has no id.
 */
function goRun(kind: RunKind, binding: RunTarget): string[] {
  if (kind === 'suite') return ['-run', `^${binding.symbol}$`];
  const tops = [...new Set((binding.ids ?? []).map(id => id.replace(/\/.*$/, '')))];
  // Only the syntax characters are escaped: RegExp.escape also escapes a leading letter, which go reads as another name.
  return tops.length === 0 ? [] : ['-run', `^(${tops.map(top => top.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')).join('|')})$`];
}

// Each runner: the program that it starts unless the implementation declares `command`, the environment that it sets over the
// check's environment, and `run`, which gives the arguments and the working directory of a binding and how its output is read.
// `caseOf` names the case of a native test, or undefined when the test is no case of the binding; `read` feeds the output
// to a sink (test-output.mts); `detail` lists the lines that explain a failed run.
const RUNNERS: Record<Runner, RunnerOf> = {
  go: {
    program: () => 'go',
    run(root, binding, kind) {
      const module = nearest(root, binding.test, 'go.mod');
      if (module === undefined) return { error: `no go.mod lies above ${binding.test}` };
      const directory = path.posix.relative(module, path.posix.dirname(binding.test));
      return {
        // A feature run names the top-level tests of its ids in one alternation; go test -run matches each level by regexp, so a name is escaped.
        args: test => ['test', ...test, '-json', '-count=1', ...goRun(kind, binding), `./${directory}`],
        cwd: module,
        // A subtest nested below a case keeps its `/`, so R3 names it as a case that the suite does not declare.
        caseOf: kind === 'suite' ? test => after(`${binding.symbol}/`, test.name) : itself,
        read: ({ stdout }, sink) => eachLine(stdout, goEvents(testFailures(sink))),
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
      // Cargo builds tests/<name>.rs, and tests/<name>/main.rs with the other files of tests/<name>/ as its modules, as the
      // test target <name> (K148); any other file is a module of the library.
      const name = /^tests\/([^/]+)\.rs$/.exec(relative)?.[1] ?? /^tests\/([^/]+)\/main\.rs$/.exec(relative)?.[1];
      const target = name === undefined ? ['--lib'] : ['--test', name];
      return {
        args: test => ['test', ...test, '--manifest-path', path.posix.join(crate, 'Cargo.toml'), ...target, '--', '--test-threads=1', ...(kind === 'suite' ? [`${binding.symbol}::`] : [])],
        cwd: '.',
        caseOf: kind === 'suite' ? test => after(`${binding.symbol}::`, test.name) : itself,
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
      // A case of a suite is a top-level test; a test nested in it is none. A coverage file reports a case once per database item (K231).
      caseOf: kind === 'suite' ? test => (test.name.includes(' › ') ? undefined : withoutItem(test.name)) : test => withoutItem(test.name),
      merge: 'items',
      // The reporter's output is ours and always parses: a line that is no case is an error that names the line (K217).
      read: ({ stdout }, sink) => eachLine(stdout, nodeEvents({ ...sink, line: text => { throw new Error(`the parity node reporter wrote a line that is no case: ${text}`); } })),
      detail: stderrTail,
    }),
  },
  vitest: {
    program: () => process.execPath,
    run(root, binding, kind, roots) {
      const vitest = 'node_modules/vitest/vitest.mjs';
      if (!existsSync(path.join(root, vitest))) return { error: `${vitest} does not exist; run npm ci` };
      const discovery = implementationRoot(roots, binding.test);
      if (discovery === undefined) return { error: `${binding.test} lies under none of the declared roots (${roots.join(', ') || 'none declared'})` };
      // vitest 5 writes its JSON report to a file; each run writes it anew, and the run reads and removes it. A report that an
      // interrupted check left is removed first, so a run that writes none reads none.
      const report = path.join(root, VITEST_REPORT);
      rmSync(report, { force: true });
      return {
        // vitest discovers the files that match the filter below --dir, following symbolic links; from the checkout root it
        // also walked var/, where a trust record of mise links to the home folder, and ran an old copy of the test there
        // too (K202). --dir bounds discovery to the root of the implementation that holds the test.
        args: test => [path.join(root, vitest), 'run', ...test, '--dir', discovery, '--reporter=json', `--outputFile.json=${report}`, binding.test],
        cwd: '.',
        caseOf: kind === 'suite' ? test => (test.name.includes(' › ') ? undefined : test.name) : itself,
        read: (output, sink) => {
          if (!existsSync(report)) return;
          const { testResults } = readJsonFile<VitestReport>(report, 'vitest-report.schema.json');
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
      // PHPUnit of the vendor directory that Composer gives the package: its own, or that of the Composer root of a monorepo
      // that requires it through a path repository (K178).
      const phpunit = packageVendorFile(root, composer, 'bin/phpunit');
      if (phpunit === undefined) return { error: `${path.relative(root, path.join(composerVendor(path.join(root, composer)), 'bin/phpunit'))} does not exist; run composer install in ${composer}, or in the project that requires it` };
      // The configuration of the package: PHPUnit reads none from the checkout root, so the run names it.
      const configuration = ['phpunit.xml', 'phpunit.xml.dist'].map(file => path.posix.join(composer, file)).find(file => existsSync(path.join(root, file)));
      const flags = configuration === undefined ? ['--no-configuration'] : ['--configuration', configuration];
      const method = kind === 'suite' ? binding.symbol : undefined;
      return {
        args: test => [...test, phpunit, '--teamcity', ...flags, ...(method === undefined ? [] : ['--filter', methodFilter(method)]), binding.test],
        cwd: '.',
        caseOf: kind === 'feature' ? featureCase(binding.ids) : method === undefined ? test => methodCase(test.name) : dataSetCase(method),
        merge: kind === 'feature',
        read: ({ stdout }, sink) => eachLine(stdout, phpunitEvents(sink)),
        detail: stderrTail,
      };
    },
  },
  python: {
    program: root => toolCommand(root, 'python3'),
    // unittest writes its results to standard error; the colors are off, so the lines are plain.
    env: { NO_COLOR: '1', PYTHON_COLORS: '0' },
    run: (root, binding, kind) => ({ args: test => [...test, '-m', 'unittest', '-v', binding.test], cwd: '.', caseOf: kind === 'suite' ? test => methodCase(test.name) : itself, merge: kind === 'feature', read: ({ stderr }, sink) => pythonEvents(sink)(`${stderr}\n`), detail: stderrTail }),
  },
};

const rank: Record<Outcome, number> = { pass: 0, skip: 1, fail: 2 };

/** The name of a node:test case without the database item that a coverage file adds: `<case> [<database>]` names `<case>` (K231). */
const withoutItem = (name: string): string => name.replace(/ \[[^\][\s]+\]$/, '');

/**
 * The outcomes that the output of a run reports for the binding: `[name, outcome]` pairs, one for each case event in the order
 * of the output. A case that the binding does not name is left out here, and R3 judges the names that remain.
 */
export function outcomesOf(run: Pick<BindingRun, 'caseOf' | 'read' | 'merge'>, output: RunOutput): [string, Outcome][] {
  // `item` is whether the report names a case through a database item, which the case name lacks.
  const outcomes: [string, Outcome, boolean][] = [];
  const record = (outcome: Outcome) => (test: TestRef) => {
    const name = run.caseOf(test);
    if (name !== undefined) outcomes.push([name, outcome, name !== test.name]);
  };
  // A todo is a test that the tool expects to fail, so it is no pass: the case fails.
  const sink = { ...SILENT, pass: record('pass'), fail: record('fail'), skip: record('skip'), todo: record('fail') };
  run.read(output, sink);
  // The reports of one case fold into the first of them, with the worst outcome: a fail, then a skip, is the case's outcome
  // whatever passed before it. Other repeated names stay repeated, so R3 reports them.
  const result: [string, Outcome][] = [];
  const folded = new Map<string, number>();
  for (const [name, outcome, item] of outcomes) {
    const fold = run.merge === true || (run.merge === 'items' && item);
    const at = fold ? folded.get(name) : undefined;
    if (at !== undefined) {
      if (rank[outcome] > rank[present(result[at], 'result[at]')[1]]) present(result[at], 'result[at]')[1] = outcome;
      continue;
    }
    if (fold) folded.set(name, result.length);
    result.push([name, outcome]);
  }
  return result;
}

/**
 * The run of the binding `binding` of a unit of `kind` in `implementation`: `{ command, args, cwd, env, caseOf, read,
 * detail }` with `cwd` relative to `root`, `env` the variables of the implementation over `base`, and `detail(output)` the
 * lines that explain a failed run; or `{ error }`. A `command` with a / is a path relative to `root`. A binding `command` replaces
 * the program and the arguments of the runner, and runs in the directory of the implementation that holds the test; the runner
 * still reads its output (K216). A binding with a runner of its own runs with the default program, arguments and output parser
 * of that runner, not those of the implementation, which keeps its roots and environment (K422).
 */
export function runOf(implementation: Partial<ParityImplementation> & Pick<ParityImplementation, 'runner'>, root: string, binding: RunTarget, kind: RunKind, base: Environment): BindingCommand | RunError {
  const own = binding.runner !== undefined;
  const runner = RUNNERS[binding.runner ?? implementation.runner];
  const run = runner.run(root, binding, kind, implementation.roots ?? []);
  if (run.error) return run;
  // A run started from inside node --test must not join that run as its child, and its node:test output reaches the reporter only outside it.
  const { NODE_TEST_CONTEXT: _joined, ...inherited } = base;
  const env = { ...inherited, ...runner.env, ...Object.fromEntries((implementation.env ?? []).map(entry => [entry.name, entry.value])) };
  if (binding.command !== undefined) {
    // The schema requires a command of at least one word.
    const [first, ...words] = present(binding.command, 'binding.command');
    const program = present(first, 'binding.command[0]');
    const directory = implementationRoot(implementation.roots ?? [], binding.test);
    if (directory === undefined) return { error: `${binding.test} lies under none of the declared roots (${(implementation.roots ?? []).join(', ') || 'none declared'})` };
    return { ...run, cwd: directory, args: words, command: program.includes('/') ? path.resolve(root, program) : program, env };
  }
  // The program and the arguments of the implementation apply to its own runner only. A tool that the checkout lacks is the error
  // of the run, an R3 finding that names it and its install, not an error that ends the check (K393-2).
  const declared = own ? undefined : implementation.command;
  let command: string;
  try {
    command = declared === undefined ? runner.program(root) : declared.includes('/') ? path.resolve(root, declared) : declared;
  } catch (error) {
    return { error: `the runner cannot start: ${error instanceof Error ? error.message : String(error)}` };
  }
  return { ...run, args: run.args(own ? [] : implementation.args ?? []), command, env };
}
