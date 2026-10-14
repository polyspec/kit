// The parsers of the output of the test tools: go test -json, cargo test (libtest), python unittest (verbose) and PHPUnit
// (TeamCity messages); node:test reports through the reporters of kit (node-reporter.mts, parity-node-reporter.mts).
// run-tests reads a run's output with them into its progress lines, and the language-parity check (parity-runners.mts)
// reads a binding's output with the same functions into the outcome of each native test. Each
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

/** The sink call of the outcome of a test. */
type Outcome = 'pass' | 'fail' | 'skip' | 'todo';

/** An event of go test -json as test2json documents it; an absent field is undefined. */
type GoEvent = { Action?: string; Package?: string; Test?: string; Output?: string; Elapsed?: number; ImportPath?: string };

/**
 * Read go test -json events into the sink: each test with its id (the package and the test path, as the progress shows
 * it) and its name (the test name that go reports). The output of a test is passed to the sink only when it fails. The
 * compiler output of a package that does not build arrives as `build-output` events and its end as a `build-fail` event:
 * both reach the sink as lines and the error lines are added to `build`. A package that started no test case is reported
 * as skipped.
 */
export function goEvents(sink: Sink, build: string[] = []): (line: string) => unknown {
  const output = new Map<string | undefined, string>();
  // The test cases that each package started; a package that started none passed nothing.
  const started = new Map<string | undefined, number>();
  return line => {
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
    switch (event.Action) {
      case 'start': started.set(event.Package, 0); return sink.start(test, { group: true });
      case 'run':
        if (group) return undefined;
        started.set(event.Package, (started.get(event.Package) ?? 0) + 1);
        return sink.start(test);
      case 'output': {
        // test2json writes Output on every output event.
        if (group) { if (!/^(?:ok|PASS|FAIL|\?)\s/.test(present(event.Output, 'event.Output'))) sink.raw(present(event.Output, 'event.Output')); return; }
        output.set(id, (output.get(id) ?? '') + event.Output);
        return;
      }
      case 'pass':
        output.delete(id);
        if (group && !started.get(event.Package)) {
          sink.skip(test);
          return sink.line(`○ ${id}: ran no test case`);
        }
        // test2json writes Elapsed on every pass event.
        return sink.pass(test, present(event.Elapsed, 'event.Elapsed') * 1000);
      case 'skip': output.delete(id); return sink.skip(test);
      case 'fail': {
        const text = (output.get(id) ?? '').split('\n').filter(entry => !/^\s*(?:=== RUN|--- FAIL|=== (?:PAUSE|CONT))/.test(entry)).join('\n');
        output.delete(id);
        return sink.fail(test, (event.Elapsed ?? 0) * 1000, text);
      }
      default: return undefined;
    }
  };
}

/**
 * Read the output of a serial runner in which a test prints `<name> ... ` when it starts and its outcome on the same line
 * when it ends. `result` matches a finished line with the name and the outcome, `pending` the name of the test that started
 * at the end of an unfinished line, `outcome` names the sink call of an outcome (`pass`, `fail` or `skip`), `idOf` turns a
 * name into a test (`{ id, name }`) and `other` receives every other line. The runner is serial, so an outcome belongs to the
 * test that started last.
 */
function startResultLines(sink: Sink, { result, pending, outcome, idOf, other }: {
  result: RegExp;
  pending: RegExp;
  outcome: (word: string) => Outcome;
  idOf: (name: string) => TestRef;
  other: (text: string) => unknown;
}): (data: string) => void {
  let current: TestRef | undefined;
  let buffer = '';
  const start = (name: string): void => {
    if (current !== undefined) return;
    current = idOf(name);
    sink.start(current);
  };
  const line = (text: string): unknown => {
    const match = result.exec(text);
    if (!match) return other(text);
    // Both groups of `result` always take part in a match.
    start(present(match[1], 'match[1]'));
    // As above; start has set current.
    sink[outcome(present(match[2], 'match[2]'))](present(current, 'current'));
    current = undefined;
    return undefined;
  };
  return (data) => {
    buffer += data;
    let end: number;
    while ((end = buffer.indexOf('\n')) !== -1) {
      line(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
    }
    const started = pending.exec(buffer);
    if (started) start(present(started[1], 'started[1]')); // The group of `pending` always takes part in a match.
  };
}

/**
 * Read serial libtest output into the sink. A test prints `test <name> ... ` when it starts and its result (`ok`,
 * `FAILED` or `ignored`) when it ends; a should_panic test prints `test <name> - should panic ... `. The text format puts any
 * run of whitespace before `...`: libtest-mimic, the harness of data-driven tests (harness = false), pads each name to the
 * longest one. cargo names each test binary on standard error before running it.
 */
export function cargoEvents(sink: Sink): { stdout: (data: string) => void; stderr(text: string): void } {
  let binary = 'cargo';
  const stdout = startResultLines(sink, {
    result: /^test (\S+)(?: - should panic)?\s+\.\.\. (ok|FAILED|ignored)\b/,
    pending: /^test (\S+)(?: - should panic)?\s+\.\.\. $/,
    // `result` matches only these three words.
    outcome: word => present(({ ok: 'pass', FAILED: 'fail', ignored: 'skip' } as Record<string, Outcome>)[word], '({ ok: \'pass\', FAILED: \'fail\', ignored: \'skip\' } as Record<string, Outcome>)[word]'),
    idOf: name => ({ id: `${binary} › ${name}`, name }),
    other: (text) => {
      if (text.trim() && !/^(?:running \d+ tests?$|test result:|failures:$|successes:$)/.test(text.trim())) sink.line(`  ${text}`);
    },
  });
  return {
    stdout,
    stderr(text: string) {
      const running = /^\s*(?:Running|Doc-tests)\s+(?:unittests\s+)?(\S+)/.exec(text);
      if (running) binary = present(running[1], 'running[1]'); // The group always takes part in a match.
      if (text.trim()) sink.line(text.trim());
    },
  };
}

/**
 * Read the verbose output of Python unittest, which it writes to standard error, into the sink. A test prints
 * `<method> (<module>.<class>.<method>) ... ` when it starts and its outcome when it ends: `ok` passes, `expected failure` is a
 * todo, `skipped '<reason>'` is skipped, and `FAIL`, `ERROR` and `unexpected success` fail. A test with a docstring prints its
 * description on a line of its own and the first docstring line before ` ... `; the test keeps the id of the description.
 * The failure reports at the end of the run are printed as they are.
 */
export function pythonEvents(sink: Sink): (data: string) => void {
  const DESCRIPTION = /^\w+ \([\w.]+\)$/;
  // The description line of a test with a docstring, which names the test whose outcome follows.
  let described: string | undefined;
  return startResultLines(sink, {
    result: /^(.+?) \.\.\. (ok|FAIL|ERROR|skipped\b.*|expected failure|unexpected success)$/,
    pending: /^(.+?) \.\.\. $/,
    // The words of the object are two of those that `result` matches; any other word is looked up as undefined.
    outcome: word => ({ ok: 'pass', 'expected failure': 'todo' } as Record<string, Outcome>)[word] ?? (word.startsWith('skipped') ? 'skip' : 'fail'),
    idOf: (name) => {
      const id = described ?? name;
      described = undefined;
      return { id, name: present(id.split(' ')[0], 'id.split(\' \')[0]') }; // split returns at least one part.
    },
    other: (text) => {
      if (DESCRIPTION.test(text)) { described = text; return; }
      described = undefined;
      if (text.trim()) sink.line(`  ${text}`);
    },
  });
}

// The object holds two of the characters that the pattern matches; any other is looked up as undefined.
const unescapeTeamcity = (value: string): string => value.replace(/\|(['|\][nr])/g, (match, character: string) => ({ n: '\n', r: '\r' } as Record<string, string>)[character] ?? character);

/**
 * Read PHPUnit TeamCity messages into the sink. Other lines, such as the summary with the warnings that fail the run
 * under failOnWarning, are printed as they are.
 */
export function phpunitEvents(sink: Sink): (line: string) => unknown {
  const failures = new Map<string | undefined, string>();
  // A test is named by its class and method; testFinished repeats only the method name.
  const ids = new Map<string | undefined, string | undefined>();
  // Suites without a location (the configuration and the test suites) are printed as groups. A class or a data provider
  // method has a location on its start only, so its finish is matched by this set.
  const groups = new Set<string | undefined>();
  // A skipped or incomplete test gets testIgnored and then testFinished: its finish is no pass.
  const ignored = new Set<string | undefined>();
  const qualified = (attributes: Record<string, string>): string | undefined => {
    const hint = /::\\?([^:]+)::(.+)$/.exec(attributes.locationHint ?? '');
    // Both groups always take part in a match, and split returns at least one part.
    return hint ? `${present(hint[1], 'hint[1]').split('\\').pop()}::${hint[2]}` : attributes.name;
  };
  return line => {
    const message = /^##teamcity\[(\w+)((?: \w+='(?:[^'|]|\|.)*')*)\]$/.exec(line.trim());
    if (!message) return line.trim() ? sink.line(line) : undefined;
    // The groups of both patterns always take part in a match.
    const attributes = Object.fromEntries([...present(message[2], 'message[2]').matchAll(/ (\w+)='((?:[^'|]|\|.)*)'/g)].map(([, key, value]) => [present(key, 'key'), unescapeTeamcity(present(value, 'value'))]));
    if (message[1] === 'testStarted') ids.set(attributes.name, qualified(attributes));
    const id = ids.get(attributes.name) ?? attributes.name;
    // PHPUnit names each test and suite; a message without a name, such as testCount, reaches only the default case.
    const test = (): TestRef => ({ id: present(id, 'the id of a PHPUnit test'), name: present(attributes.name, 'the name of a PHPUnit test') });
    switch (message[1]) {
      case 'testSuiteStarted': {
        if (attributes.locationHint) return undefined;
        groups.add(id);
        return sink.start(test(), { group: true });
      }
      case 'testSuiteFinished': return groups.delete(id) ? sink.pass(test()) : undefined;
      case 'testStarted': return sink.start(test());
      // PHPUnit reports a test that ran out of its time limit and also made no assertion twice.
      case 'testFailed': failures.set(id, [failures.get(id), attributes.message ?? '', attributes.details ?? ''].filter(Boolean).join('\n')); return undefined;
      case 'testIgnored': ignored.add(id); return sink.skip(test());
      case 'testFinished': {
        const duration = Number(attributes.duration);
        if (ignored.delete(id)) return undefined;
        // has() above makes the failure text exist.
        if (failures.has(id)) { const text = present(failures.get(id), 'failures.get(id)'); failures.delete(id); return sink.fail(test(), duration, text); }
        return sink.pass(test(), duration);
      }
      default: return undefined;
    }
  };
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
