// The parsers of the output of the test tools: go test -json, cargo test (libtest), python unittest (verbose) and PHPUnit
// (TeamCity messages). run-tests reads a run's output with them into its progress lines. Each
// parser reports to a sink with the methods `start(test, options)`, `pass(test, ms)`, `fail(test, ms, text)`, `skip(test)`,
// `todo(test)`, `line(text)` and `raw(text)`, where `test` is `{ id, name }`: `id` is the name that the progress shows and
// `name` is the name that the tool reports for the test. `todo` is a test that the tool expects to fail (a unittest expected
// failure): it is no pass. `toProgress` turns a progress reporter into such a sink.
import type { Progress } from './test-progress.mts';
import { ConfigError, parseJson } from './schema-validate.mts';
import { present } from './present.mts';

/** A test as a parser reports it: `id` is the name that the progress shows, `name` the name that the tool reports. */
export type TestRef = { id: string; name: string };

/** The receiver of the events of a parser. */
export type Sink = {
  start(test: TestRef, options?: { group?: boolean }): unknown;
  pass(test: TestRef, ms?: number): unknown;
  fail(test: TestRef, ms?: number, text?: string): unknown;
  skip(test: TestRef): unknown;
  todo(test: TestRef): unknown;
  line(text: string): unknown;
  raw(text: string): unknown;
};

/** A reader of the output of a tool: called with each portion of the output, and `end` when the output has ended. */
export type Reader<T> = ((data: T) => unknown) & { end(): void };

/** The sink call of the outcome of a test. */
type Outcome = 'pass' | 'fail' | 'skip' | 'todo';

/** An event of go test -json as test2json documents it; an absent field is undefined. */
type GoEvent = { Action?: string; Package?: string; Test?: string; Output?: string; Elapsed?: number; ImportPath?: string };

/**
 * Read go test -json events into the sink: each test with its id (the package and the test path, as the progress shows
 * it) and its name (the test name that go reports). The output of a test is passed to the sink only when it fails. The
 * compiler output of a package that does not build arrives as `build-output` events and its end as a `build-fail` event:
 * both reach the sink as lines and the error lines are added to `build`. A package with no test cases is a neutral group; named
 * skipped tests remain skips. go test -json emits no pass event for a benchmark (K760): a benchmark passes at its result line,
 * which reaches the sink as a line, when the next benchmark that is not its child starts, or when its package ends. An output
 * event holds a portion of the output, not a line: testing writes the name of a benchmark result line and its results in two
 * writes, and test2json sends a name that it reads without the line end as its own event, so a reader that wakes between the
 * two writes splits the line (K919). The output of a benchmark that ends without a result line reaches the sink as lines.
 * Neither these lines nor the text of a failure hold the lines of its runs or the line of its bare name, which go prints for
 * a benchmark with sub-benchmarks. A test that did not finish when its package ended, as after a panic or os.Exit, or when the
 * output ended, as after a stop at its timeout, fails with its output (K1136); `end` ends the output.
 */
export function goEvents(sink: Sink, build: string[] = []): Reader<string> {
  const output = new Map<string | undefined, string>();
  // The output of each test after its last line end, which a later output event of the test continues.
  const partial = new Map<string | undefined, string>();
  // The output of a test: its lines and its unfinished line, which it no longer keeps.
  const take = (id: string | undefined): string => {
    const text = (output.get(id) ?? '') + (partial.get(id) ?? '');
    output.delete(id);
    partial.delete(id);
    return text;
  };
  // The output of a benchmark that ended without a result line, except the lines of its runs and of its bare name.
  const unmatched = (benchmark: TestRef): string[] => take(benchmark.id).split('\n')
    .filter(entry => entry.trim() && entry.trim() !== benchmark.name && !/^\s*=== (?:RUN|PAUSE|CONT)/.test(entry)).map(entry => entry.trimEnd());
  // The test cases that each package started; a package that started none passed nothing.
  const started = new Map<string | undefined, number>();
  // The benchmarks of each package that started and have not ended, oldest first; benchmarks run one at a time.
  const benchmarks = new Map<string | undefined, TestRef[]>();
  const endBenchmarks = (pkg: string | undefined, keep: (open: TestRef) => boolean, outcome: 'pass' | 'fail', reason = 'its package failed before the benchmark printed its result') => {
    const open = benchmarks.get(pkg) ?? [];
    for (const benchmark of open.filter(entry => !keep(entry)).reverse()) {
      const text = unmatched(benchmark);
      if (outcome === 'pass') {
        for (const entry of text) sink.line(entry);
        sink.pass(benchmark);
      } else sink.fail(benchmark, 0, [reason, ...text].join('\n'));
      close(pkg, benchmark.id);
    }
    benchmarks.set(pkg, open.filter(keep));
  };
  const forget = (pkg: string | undefined, name: string) => benchmarks.set(pkg, (benchmarks.get(pkg) ?? []).filter(entry => entry.name !== name));
  // The tests of each package that started and have not ended, in the order they started (K1136).
  const open = new Map<string | undefined, Map<string, TestRef>>();
  const close = (pkg: string | undefined, id: string) => open.get(pkg)?.delete(id);
  // The lines of a failure: the output of the test without the lines that go prints around each run.
  const failureText = (id: string | undefined): string[] => take(id).split('\n').filter(entry => entry.trim() && !/^\s*(?:=== RUN|--- FAIL|=== (?:PAUSE|CONT))/.test(entry));
  // Fails each test of `pkg` that did not finish, the latest first, with its output (K1136).
  const unfinished = (pkg: string | undefined, reason: string) => {
    for (const test of [...(open.get(pkg)?.values() ?? [])].reverse()) sink.fail(test, 0, [reason, ...failureText(test.id)].join('\n'));
    open.delete(pkg);
  };
  // The benchmarks that passed at their result line; a later pass or skip of one, should go emit it, is not counted twice, and a
  // later fail, as of a failed b.Cleanup, fails it (K1137).
  const resulted = new Set<string>();
  const read = (line: string): unknown => {
    // GoEvent is the format of test2json, the writer of go test -json; a line that is no event is output of its own.
    let event: GoEvent;
    try {
      event = parseJson<GoEvent>(line, 'go-test-event.schema.json', 'go test -json');
    } catch (error) {
      if (!(error instanceof ConfigError)) throw error;
      return sink.line(line);
    }
    if (event.Action === 'build-output') {
      for (const text of String(event.Output ?? '').split('\n').filter(Boolean)) {
        sink.line(text);
        if (!text.startsWith('#')) build.push(text.trim());
      }
      return undefined;
    }
    if (event.Action === 'build-fail') return sink.line(`✖ build of ${event.ImportPath} failed`);
    const id = event.Test ? `${event.Package} › ${event.Test.replaceAll('/', ' › ')}` : event.Package;
    // A go test event names its package; test2json writes Package on every event of a test or a package.
    const test: TestRef = { id: present(id, 'the package of a go test event'), name: present(event.Test ?? event.Package, 'the package of a go test event') };
    const group = !event.Test;
    if (resulted.has(test.id) && ['pass', 'skip'].includes(event.Action ?? '')) return undefined;
    if (resulted.has(test.id) && event.Action === 'fail') {
      resulted.delete(test.id);
      return sink.fail(test, (event.Elapsed ?? 0) * 1000, ['the benchmark failed after its result line', ...failureText(id)].join('\n'));
    }
    switch (event.Action) {
      case 'start': started.set(event.Package, 0); benchmarks.set(event.Package, []); return sink.start(test, { group: true });
      case 'run':
        if (group) return undefined;
        started.set(event.Package, (started.get(event.Package) ?? 0) + 1);
        if (!open.has(event.Package)) open.set(event.Package, new Map());
        open.get(event.Package)?.set(test.id, test);
        if (test.name.startsWith('Benchmark')) {
          endBenchmarks(event.Package, open => test.name.startsWith(`${open.name}/`), 'pass');
          benchmarks.get(event.Package)?.push(test);
        }
        return sink.start(test);
      case 'output': {
        // test2json writes Output on every output event.
        if (group) { if (!/^(?:ok|PASS|FAIL|\?)\s/.test(present(event.Output, 'event.Output'))) sink.raw(present(event.Output, 'event.Output')); return; }
        const text = (partial.get(id) ?? '') + present(event.Output, 'event.Output');
        partial.delete(id);
        if (!text.endsWith('\n')) { partial.set(id, text); return; }
        // The result line of a benchmark: its name, with -GOMAXPROCS when that is not 1, the iterations and the ns/op.
        if (test.name.startsWith('Benchmark') && new RegExp(`^${RegExp.escape(test.name)}(?:-\\d+)?\\s+\\d+\\s.*\\bns/op\\b`).test(text)) {
          sink.line(text.trimEnd());
          forget(event.Package, test.name);
          close(event.Package, test.id);
          take(id);
          resulted.add(test.id);
          return sink.pass(test);
        }
        output.set(id, (output.get(id) ?? '') + text);
        return;
      }
      case 'pass':
        if (group) {
          endBenchmarks(event.Package, () => false, 'pass');
          unfinished(event.Package, 'the test did not finish before its package ended');
        } else { forget(event.Package, test.name); close(event.Package, test.id); }
        if (test.name.startsWith('Benchmark')) for (const entry of unmatched(test)) sink.line(entry);
        else take(id);
        if (group && !started.get(event.Package)) {
          if (started.has(event.Package)) {
            sink.pass(test);
            return sink.line(`○ ${id}: package ran no test case`);
          }
          return sink.skip(test);
        }
        // test2json writes Elapsed on every pass event.
        return sink.pass(test, present(event.Elapsed, 'event.Elapsed') * 1000);
      case 'skip': {
        if (group) unfinished(event.Package, 'the test did not finish before its package ended');
        else { forget(event.Package, test.name); close(event.Package, test.id); }
        take(id);
        if (group && started.has(event.Package) && !started.get(event.Package)) {
          sink.pass(test);
          return sink.line(`○ ${id}: package has no test files`);
        }
        return sink.skip(test);
      }
      case 'fail': {
        if (group) {
          endBenchmarks(event.Package, () => false, 'fail');
          unfinished(event.Package, 'the test did not finish before its package failed');
        } else { forget(event.Package, test.name); close(event.Package, test.id); }
        return sink.fail(test, (event.Elapsed ?? 0) * 1000, failureText(id).join('\n'));
      }
      default: return undefined;
    }
  };
  return Object.assign(read, {
    // The output ended, as after a stop at a timeout: each test that did not finish fails with its output (K1136).
    end(): void {
      for (const pkg of new Set([...benchmarks.keys(), ...open.keys()])) {
        endBenchmarks(pkg, () => false, 'fail', 'the output of go test ended before the benchmark printed its result');
        unfinished(pkg, 'the test did not finish before the output of go test ended');
      }
    },
  });
}

/**
 * Read the output of a serial runner in which a test prints `<name> ... ` when it starts and its outcome on the same line
 * when it ends. `result` matches a finished line with the name and the outcome, `pending` the name of the test that started
 * at the end of an unfinished line, `outcome` names the sink call of an outcome (`pass`, `fail` or `skip`), `idOf` turns a
 * name into a test (`{ id, name }`) and `other` receives every other line. The runner is serial, so an outcome belongs to the
 * test that started last.
 */
function startResultLines(sink: Sink, { result, pending, outcome, idOf, other, interleaved }: {
  result: RegExp;
  pending: RegExp;
  outcome: (word: string) => Outcome;
  idOf: (name: string) => TestRef;
  other: (text: string) => unknown;
  // The start of a test whose output is printed before its result, and the line of the result alone: `start` matches the
  // line of the test's name (its first group is the name), `end` the result word, the first group of the line.
  interleaved?: { start: RegExp; end: RegExp };
}): Reader<string> {
  let current: TestRef | undefined;
  let buffer = '';
  // The lines that the running test printed, which a test that does not finish fails with (K1139).
  let since: string[] = [];
  const start = (name: string): void => {
    if (current !== undefined) return;
    current = idOf(name);
    since = [];
    sink.start(current);
  };
  const line = (text: string): unknown => {
    const match = result.exec(text);
    if (!match) {
      const began = interleaved?.start.exec(text);
      if (began) return start(present(began[1], 'began[1]'));
      const ended = interleaved?.end.exec(text);
      if (ended && current !== undefined) {
        sink[outcome(present(ended[1], 'ended[1]'))](current);
        current = undefined;
        return undefined;
      }
      if (current !== undefined && text.trim()) since.push(text.trimEnd());
      return other(text);
    }
    // Both groups of `result` always take part in a match.
    start(present(match[1], 'match[1]'));
    // As above; start has set current.
    sink[outcome(present(match[2], 'match[2]'))](present(current, 'current'));
    current = undefined;
    return undefined;
  };
  const read = (data: string): void => {
    buffer += data;
    let end: number;
    while ((end = buffer.indexOf('\n')) !== -1) {
      line(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
    }
    const started = pending.exec(buffer);
    if (started) start(present(started[1], 'started[1]')); // The group of `pending` always takes part in a match.
  };
  return Object.assign(read, {
    // The output ended: its rest without a line end is read as a line, and a test that did not finish fails with its lines (K1139).
    end(): void {
      const rest = buffer;
      buffer = '';
      if (rest !== '' && !(current !== undefined && pending.test(rest))) line(rest);
      if (current !== undefined) sink.fail(current, 0, ['the test did not finish before the output ended', ...since].join('\n'));
      current = undefined;
    },
  });
}

/**
 * Read serial libtest output into the sink. A test prints `test <name> ... ` when it starts and its result (`ok`,
 * `FAILED` or `ignored`) when it ends; a should_panic test prints `test <name> - should panic ... `. The text format puts any
 * run of whitespace before `...`: libtest-mimic, the harness of data-driven tests (harness = false), pads each name to the
 * longest one. cargo names each test binary on standard error before running it.
 */
export function cargoEvents(sink: Sink): { stdout: (data: string) => void; stderr(text: string): void; end(): void } {
  let binary = 'cargo';
  const lines = startResultLines(sink, {
    result: /^test (\S+)(?: - should panic)?\s+\.\.\. (ok|FAILED|ignored)\b/,
    pending: /^test (\S+)(?: - should panic)?\s+\.\.\. $/,
    // `result` matches only these three words.
    outcome: word => present(({ ok: 'pass', FAILED: 'fail', ignored: 'skip' } as Record<string, Outcome>)[word], '({ ok: \'pass\', FAILED: \'fail\', ignored: \'skip\' } as Record<string, Outcome>)[word]'),
    idOf: name => ({ id: `${binary} › ${name}`, name }),
    // libtest-mimic and the test's own output (the case database's step lines) come between a name and its result: the name
    // starts the test and its result is the word alone on its line (K229).
    interleaved: { start: /^test (\S+)(?: - should panic)?\s+\.\.\. (?!(?:ok|FAILED|ignored)$)/, end: /^(ok|FAILED|ignored)$/ },
    other: (text) => {
      if (text.trim() && !/^(?:running \d+ tests?$|test result:|failures:$|successes:$)/.test(text.trim())) sink.line(`  ${text}`);
    },
  });
  return {
    // A timed libtest-mimic harness writes the timing `cpu=… wall=…` after the name and the outcome on the next line;
    // joined here, the outcome is read as on the line of the name (K215).
    stdout: data => lines(data.replace(/^(test \S+(?: - should panic)?\s+\.\.\. )cpu=\S+ wall=\S+\n(?=(?:ok|FAILED|ignored)\b)/gm, '$1')),
    stderr(text: string) {
      const running = /^\s*(?:Running|Doc-tests)\s+(?:unittests\s+)?(\S+)/.exec(text);
      if (running) binary = present(running[1], 'running[1]'); // The group always takes part in a match.
      if (text.trim()) sink.line(text.trim());
    },
    end: () => lines.end(),
  };
}

/** An event of runners/python.py: the start or the outcome of a test, its id as unittest prints it, and the text of a failure or a skip. */
type PythonEvent = { event: 'start' | 'pass' | 'fail' | 'skip' | 'todo'; id: string; text?: string };

/**
 * Read the events of runners/python.py into the sink, one JSON line each (K1194): the start of a test and its outcome, `pass`,
 * `fail` with the text of the failure, `skip` with its reason and `todo` for an expected failure, each with the id that unittest
 * prints for the test, `<method> (<module>.<class>.<method>)`; the name of the test is its method. The events come on a
 * descriptor of their own, so what a test writes to standard error never changes a count. A test that started and has no outcome
 * when the events end, as after a crash of the interpreter, fails (K1141).
 */
export function pythonEvents(sink: Sink): Reader<string> {
  let current: TestRef | undefined;
  const test = (id: string): TestRef => ({ id, name: present(id.split(' ')[0], 'id.split(\' \')[0]') }); // split returns at least one part.
  return Object.assign((line: string) => {
    if (!line.trim()) return;
    const event = parseJson<PythonEvent>(line, 'python-test-event.schema.json', 'an event of runners/python.py');
    const ref = test(event.id);
    if (event.event === 'start') {
      current = ref;
      sink.start(ref);
      return;
    }
    // An outcome without a start, such as the error of a setUpClass, starts its test first.
    if (current?.id !== ref.id) sink.start(ref);
    current = undefined;
    if (event.event === 'fail') sink.fail(ref, undefined, event.text);
    else if (event.event === 'skip') sink.skip(ref);
    else if (event.event === 'todo') sink.todo(ref);
    else sink.pass(ref);
  }, {
    end(): void {
      if (current !== undefined) sink.fail(current, undefined, 'the test started and the run ended before its outcome');
      current = undefined;
    },
  });
}

// The object holds two of the characters that the pattern matches; any other is looked up as undefined.
const unescapeTeamcity = (value: string): string => value.replace(/\|(['|\][nr])/g, (match, character: string) => ({ n: '\n', r: '\r' } as Record<string, string>)[character] ?? character);

/**
 * Read PHPUnit TeamCity messages into the sink. Other lines, such as the summary with the warnings that fail the run
 * under failOnWarning, are printed as they are, and so is the output of testStdOut and testStdErr and a message that this
 * reader does not read (K1138). A test that failed and did not finish, as after a fatal error, fails with its failure at `end`.
 */
export function phpunitEvents(sink: Sink): Reader<string> {
  const failures = new Map<string | undefined, string>();
  // The test of each failure, which `end` fails when its finish never came (K1138).
  const failed = new Map<string | undefined, TestRef>();
  // A start names its fully qualified class and method; finish repeats only the method name within its flow.
  const ids = new Map<string | undefined, string | undefined>();
  // Suites without a location (the configuration and the test suites) are printed as groups. A class or a data provider
  // method has a location on its start only, so its finish is matched by this set.
  const groups = new Set<string | undefined>();
  // A skipped or incomplete test gets testIgnored and then testFinished: its finish is no pass.
  const ignored = new Set<string | undefined>();
  const qualified = (attributes: Record<string, string>): string | undefined => {
    const hint = /::\\?([^:]+)::(.+)$/.exec(attributes.locationHint ?? '');
    // Both capture groups take part in a matching native location.
    return hint ? `${hint[1]}::${hint[2]}` : attributes.name;
  };
  const read = (line: string): unknown => {
    const message = /^##teamcity\[(\w+)((?: \w+='(?:[^'|]|\|.)*')*)\]$/.exec(line.trim());
    if (!message) return line.trim() ? sink.line(line) : undefined;
    // The groups of both patterns always take part in a match.
    const attributes = Object.fromEntries([...present(message[2], 'message[2]').matchAll(/ (\w+)='((?:[^'|]|\|.)*)'/g)].map(([, key, value]) => [present(key, 'key'), unescapeTeamcity(present(value, 'value'))]));
    const address = JSON.stringify([attributes.flowId ?? '', attributes.name]);
    if (message[1] === 'testStarted') ids.set(address, qualified(attributes));
    const id = ids.get(address) ?? attributes.name;
    const event = JSON.stringify([attributes.flowId ?? '', id]);
    // PHPUnit names each test and suite; a message without a name, such as testCount, reaches only the default case.
    const test = (): TestRef => ({ id: present(id, 'the id of a PHPUnit test'), name: present(attributes.name, 'the name of a PHPUnit test') });
    switch (message[1]) {
      case 'testSuiteStarted': {
        if (attributes.locationHint) return undefined;
        groups.add(event);
        return sink.start(test(), { group: true });
      }
      case 'testSuiteFinished': return groups.delete(event) ? sink.pass(test()) : undefined;
      case 'testStarted': return sink.start(test());
      // PHPUnit reports a test that ran out of its time limit and also made no assertion twice.
      case 'testFailed':
        failures.set(event, [failures.get(event), attributes.message ?? '', attributes.details ?? ''].filter(Boolean).join('\n'));
        failed.set(event, test());
        return undefined;
      case 'testIgnored': ignored.add(event); return sink.skip(test());
      case 'testFinished': {
        const duration = Number(attributes.duration);
        if (ignored.delete(event)) return undefined;
        // has() above makes the failure text exist.
        if (failures.has(event)) { const text = present(failures.get(event), 'failures.get(event)'); failures.delete(event); failed.delete(event); return sink.fail(test(), duration, text); }
        return sink.pass(test(), duration);
      }
      // The output that a test wrote, which PHPUnit reports in a message of its own.
      case 'testStdOut':
      case 'testStdErr':
        for (const text of String(attributes.out ?? '').split('\n').filter(entry => entry.trim())) sink.line(`  ${text}`);
        return undefined;
      // The number of tests that a suite holds, which the progress counts as they run.
      case 'testCount': return undefined;
      default: return sink.line(line);
    }
  };
  return Object.assign(read, {
    // The output ended: each test that failed and did not finish, as after a PHP fatal error, fails with its failure (K1138).
    end(): void {
      for (const [event, text] of failures) sink.fail(present(failed.get(event), 'the test of a failure'), 0, ['the test did not finish', text].join('\n'));
      failures.clear();
      failed.clear();
    },
  });
}

/**
 * The progress reporter of run-tests as a sink: the test id is the name the progress shows. A todo shows as a pass, as the
 * progress has always shown an expected failure. `raw` writes the text as it is (standard output), as go test prints a
 * package line that no event describes.
 */
export function toProgress(progress: Progress, write: (text: string) => unknown = text => process.stdout.write(text)): Sink {
  return {
    start: (test, options) => progress.start(test.id, options),
    pass: (test, ms) => progress.pass(test.id, ms),
    fail: (test, ms, text) => progress.fail(test.id, ms, text),
    skip: test => progress.skip(test.id),
    todo: test => progress.pass(test.id),
    line: text => progress.line(text),
    raw: text => write(text),
  };
}
