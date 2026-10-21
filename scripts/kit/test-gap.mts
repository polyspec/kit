// The gap watch of run-tests (K371-1): the interval without a test event is bounded by the per-test timeout, as a running test is.
// A test event is the start or the end of a test (not a group, such as a file or a package). The watch is armed at the start of
// the run and after each test ends, and a test start disarms it, since a running test has its own timeout. When it expires, it
// reports the last event, and the runner stops the tool's process group as at a test timeout.
//
// A reporter that runs inside the tool (node --test, vitest) writes its test events as JSON lines to the file descriptor named by
// KIT_TEST_EVENTS, which run-tests opens as a pipe, so the watch sees the events of every tool.
import { writeSync } from 'node:fs';

/** A test event: a test started (`start`) or ended (`end`), by its id. */
export type TestEvent = { kind: 'start' | 'end'; id: string };

/** The environment variable that names the file descriptor a reporter writes its test events to. */
export const TEST_EVENTS = 'KIT_TEST_EVENTS';

/** The file descriptor of a reporter's test events: the pipe that run-tests opens as the fourth stdio stream. */
export const TEST_EVENTS_FD = 3;

/** The first event of a run: the gap before the first test starts. */
const RUN_START = 'the start of the run';

/**
 * The gap watch of a run. `event` receives the test events in order; `onExpire` receives the last event (`the start of the run`
 * or `the end of <id>`) when the interval without a test start outlives `timeoutMs`, once.
 */
export function createGap({ timeoutMs, onExpire }: { timeoutMs: number; onExpire: (lastEvent: string) => void }) {
  // The number of tests that are running; the watch is armed only when none is.
  let running = 0;
  let last = RUN_START;
  let timer: NodeJS.Timeout | undefined;
  // Once the watch expires or closes, its events are ignored: the tool is being stopped.
  let done = false;
  const disarm = () => { clearTimeout(timer); timer = undefined; };
  const arm = () => {
    disarm();
    timer = setTimeout(() => {
      timer = undefined;
      done = true;
      onExpire(last);
    }, timeoutMs);
  };
  arm();
  return {
    event({ kind, id }: TestEvent): void {
      if (done) return;
      if (kind === 'start') {
        running++;
        disarm();
        return;
      }
      running = Math.max(0, running - 1);
      last = `the end of ${id}`;
      if (running === 0) arm();
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
  const { kind, id } = event as { kind?: unknown; id?: unknown };
  if ((kind !== 'start' && kind !== 'end') || typeof id !== 'string') throw new Error(`not a test event: ${line}`);
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
