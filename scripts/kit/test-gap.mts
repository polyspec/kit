// The gap watch of run-tests (K371-1): the interval without a test event is bounded by the per-test timeout, as a running test is.
// A test event is the start or the end of a test (not a group, such as a file or a package). The watch is armed at the start of
// the run and after each test ends, and a test start disarms it, since a running test has its own timeout. When it expires, it
// reports the last event, and the runner stops the tool's process group as at a test timeout.
//
// The start of a tool's process is no test time (K549): an interpreter that loads on a loaded machine takes longer than a test's
// timeout, so a gap that counted it measured the machine. Until a process of the tool reports that it is up (`up`), the watch
// has the start-up bound instead of the timeout; a tool that starts a process for each file or package reports `launch` when
// the next one starts, which returns the watch to the start-up bound until that process is up.
//
// A reporter that runs inside the tool (node --test, vitest) writes its test events as JSON lines to the file descriptor named by
// KIT_TEST_EVENTS, which run-tests opens as a pipe, so the watch sees the events of every tool.
// Declared setup/teardown operations suspend the watch until their matching operation-end events. The ordinary gap
// deadline resumes afterwards; a missing test outside an operation still fails as before.
import { writeSync } from 'node:fs';
import { channel } from 'node:diagnostics_channel';

/**
 * A test event: a test started (`start`) or ended (`end`), a process of the tool reported that it is up (`up`), or the tool starts
 * the process of the next file or package (`launch`), or a declared long operation starts/ends, by its id. PHPUnit can also report
 * the resolved configured timeout for a test before its TeamCity start event.
 */
export type TestEvent =
  | { kind: 'start' | 'end' | 'up' | 'launch' | 'operation-start' | 'operation-end'; id: string }
  | { kind: 'timeout'; id: string; timeoutMs: number };

/** A declared setup or teardown operation; its duration is not test-case time. */
export type OperationEvent = { kind: 'operation-start' | 'operation-end'; id: string };

/** The kinds of TestEvent. */
const KINDS: readonly TestEvent['kind'][] = ['start', 'end', 'up', 'launch', 'operation-start', 'operation-end', 'timeout'];
const isKind = (kind: unknown): kind is TestEvent['kind'] => KINDS.some(known => known === kind);

/** The bounded `Class::method` identity that the PHPUnit extension reports for one test case. */
export function isPHPUnitCaseId(id: string): boolean {
  const separator = id.indexOf('::');
  if (separator < 1 || separator > 256 || id.length - separator - 2 < 1 || id.length - separator - 2 > 512) return false;
  for (let index = 0; index < id.length; index++) {
    const code = id.charCodeAt(index);
    if (code < 32 || code === 127) return false;
  }
  return !id.slice(0, separator).includes(':');
}

/** The bound of the start of a tool's process, before it reports that it is up (K549). */
export const START_UP_MS = 120_000;

/**
 * The line that a test process writes first, before it loads a test, to report that it is up (K549): the preload of a node:test
 * file writes it to its standard output, which the reporter reads as test:stdout, and runners/python.py to its standard error.
 */
export const PROCESS_UP = 'kit-test-process-up';

/** A structured control line carried through node:test stdout to its reporter. */
export const OPERATION_EVENT = 'kit-test-operation ';
const operations = channel('kit:test-operation');

/** Observes operations in the test-file process, where the exit watchdog is preloaded. */
export function onTestOperation(listener: (event: OperationEvent) => void): void {
  operations.subscribe((message: unknown) => {
    if (typeof message !== 'object' || message === null || !('kind' in message) || !('id' in message)
      || (message.kind !== 'operation-start' && message.kind !== 'operation-end') || typeof message.id !== 'string') {
      throw new Error('not a declared test operation');
    }
    listener({ kind: message.kind, id: message.id });
  });
}

/** Reports a declared operation to the local watchdog and the parent reporter without parsing human log text. */
export function reportTestOperation(event: OperationEvent): void {
  operations.publish(event);
  if (process.env.NODE_TEST_CONTEXT && process.env[TEST_EVENTS]) writeSync(1, `${OPERATION_EVENT}${JSON.stringify(event)}\n`);
}

/** The environment variable that names the file descriptor a reporter writes its test events to. */
export const TEST_EVENTS = 'KIT_TEST_EVENTS';

/** The file descriptor of a reporter's test events: the pipe that run-tests opens as the fourth stdio stream. */
export const TEST_EVENTS_FD = 3;

/** The first event of a run: the gap before the first test starts. */
const RUN_START = 'the start of the run';

/**
 * The gap watch of a run. `event` receives the test events in order; `onExpire` receives, once, what expired: that no test
 * started within `timeoutMs` after the last event (`the start of the run`, `the start of <id>` or `the end of <id>`), or, before
 * the process reported that it is up, that it did not within `startUpMs`.
 */
export function createGap({ timeoutMs, startUpMs = START_UP_MS, onExpire }: { timeoutMs: number; startUpMs?: number; onExpire: (problem: string) => void }) {
  // The number of tests that are running; the watch is armed only when none is.
  let running = 0;
  let operations = 0;
  let last = RUN_START;
  // Whether a process of the tool is starting and has not reported that it is up.
  let starting = true;
  let timer: NodeJS.Timeout | undefined;
  // Once the watch expires or closes, its events are ignored: the tool is being stopped.
  let done = false;
  const disarm = () => { clearTimeout(timer); timer = undefined; };
  const arm = () => {
    disarm();
    const ms = starting ? startUpMs : timeoutMs;
    const problem = starting ? `the process of the tool did not report that it is up within ${ms / 1000} s after ${last}` : `no test started within ${ms / 1000} s after ${last}`;
    timer = setTimeout(() => {
      timer = undefined;
      done = true;
      onExpire(problem);
    }, ms);
  };
  arm();
  return {
    event(event: TestEvent): void {
      if (done) return;
      if (event.kind === 'timeout') return;
      const { kind, id } = event;
      if (kind === 'operation-start') {
        operations++;
        disarm();
        return;
      } else if (kind === 'operation-end') {
        operations = Math.max(0, operations - 1);
      } else if (kind === 'launch') {
        starting = true;
        last = `the start of ${id}`;
      } else if (kind === 'up') starting = false;
      else if (kind === 'start') {
        // A process that runs a test is up.
        starting = false;
        running++;
        disarm();
        return;
      } else {
        running = Math.max(0, running - 1);
        last = `the end of ${id}`;
      }
      if (running === 0 && operations === 0) arm();
    },
    close(): void {
      done = true;
      disarm();
    },
  };
}

/** Parses a test event of a reporter's JSON line; a line of another shape is a defect of the reporter and fails the run. */
export function parseTestEvent(line: string): TestEvent {
  const event: unknown = JSON.parse(line);
  if (typeof event !== 'object' || event === null) throw new Error(`not a test event: ${line}`);
  const { kind, id, timeoutMs } = event as { kind?: unknown; id?: unknown; timeoutMs?: unknown };
  if (!isKind(kind) || typeof id !== 'string') throw new Error(`not a test event: ${line}`);
  if (kind === 'timeout') {
    if (!isPHPUnitCaseId(id)
      || typeof timeoutMs !== 'number' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new Error(`not a test event: ${line}`);
    return { kind, id, timeoutMs };
  }
  return { kind, id };
}

/** Writes a test event to the file descriptor of the reporter's test events; the reporter runs only under run-tests. */
export function writeTestEvent(event: TestEvent): void {
  writeSync(testEventsFd(), `${JSON.stringify(event)}\n`);
}

/** The file descriptor that run-tests gave the reporter; a reporter run without it fails. */
export function testEventsFd(): number {
  const value = process.env[TEST_EVENTS];
  if (value === undefined || !/^\d+$/.test(value)) throw new Error(`${TEST_EVENTS} must name the file descriptor of the test events; run the reporter through run-tests`);
  return Number(value);
}
