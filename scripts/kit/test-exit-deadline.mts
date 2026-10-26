// Preloaded by scripts/kit/run-tests.mts into the process of every node:test file, with the deadline in milliseconds as the
// `ms` parameter of its URL. A file whose tests have all ended but whose process stays alive holds a handle that a test left
// open: a timer, a server, a child process. After the deadline the process names the handles that keep it alive and exits 1,
// so the leak fails its file by name instead of hanging the run. node --test needs no --test-force-exit then, which ended a
// file's process at its last known test and dropped a test registered after a top-level await (K72).
// A file whose own code never settles (K437) never ends its tests, so the deadline after the last test never starts. A watch
// therefore runs from the process start and after each test: it exits 1 at the deadline, naming the running test or saying that
// no test was reached. A running test has node's own timeout at the same deadline; the watch allows a margin over it.
// Declared setup/teardown operations pause this watch and restore its pending deadline when they finish. They do not
// change the timeout of any actual test or the leak deadline after all declared operations end.
import { writeSync } from 'node:fs';
import { after, afterEach, beforeEach } from 'node:test';
import { stopDescendants } from './process-group.mts';
import { onTestOperation, PROCESS_UP } from './test-gap.mts';

// The internal handle of a standard stream; Node.js does not declare it.
type WithHandle = { _handle?: { setBlocking?: (blocking: boolean) => void } };

// The margin that the watch of a running test allows over the test's own timeout.
// The events of a test leave the process through a stream that is written only when the event loop turns. A test that blocks
// the loop, such as one that runs tools with spawnSync, ends without a turn before the next one starts, so the events of a file of
// such tests reached run-tests only when the file ended, and its gap watch (K371-1) stopped a file that was still passing. A
// timer before and after each test turns the loop once, and the events of the test leave when it ends (K546). The timer is the
// setTimeout of the process start: a test that mocks the timers (t.mock.timers) replaces the global one, whose timer would then
// never fire and would hang the hook of that test (K547).
const realSetTimeout = globalThis.setTimeout;
const turnTheLoop = (): Promise<void> => new Promise(resolve => realSetTimeout(resolve, 0));
const RUNNING_TEST_MARGIN_MS = 1000;

const file = process.argv[1];
// Only the process of a test file: node --test marks it with NODE_TEST_CONTEXT.
if (file && process.env.NODE_TEST_CONTEXT) {
  const deadline = Number(new URL(import.meta.url).searchParams.get('ms'));
  if (!(deadline > 0)) throw new Error(`${import.meta.url}: the ms parameter must be a positive number of milliseconds`);
  // process.exit drops the writes that an asynchronous stdout pipe has not taken yet; the results of the tests reach the
  // parent through that pipe, so it is made blocking before the exit below can happen.
  // The declared stream types lack the internal handle; WithHandle describes it.
  (process.stdout as typeof process.stdout & WithHandle)._handle?.setBlocking?.(true);
  // As above.
  (process.stderr as typeof process.stderr & WithHandle)._handle?.setBlocking?.(true);
  // The process is up before the file loads (K549): node --test passes the line to the reporter as test:stdout at once, also
  // when the file then blocks its event loop, and the reporter reports the file up to run-tests.
  writeSync(1, `${PROCESS_UP}\n`);
  // The exit at a deadline stops the children that the tests started first (K454): a process that ends here would leave them
  // running, reparented to launchd, after the run has ended.
  const failAndExit = (message: string) => {
    writeSync(2, `${file}: ${message}\n`);
    void stopDescendants(process.pid).finally(() => process.exit(1));
  };
  let watch: NodeJS.Timeout | undefined;
  let operations = 0;
  let pending: { ms: number; message: string | (() => string) } | undefined;
  const arm = (ms: number, message: string | (() => string)) => {
    clearTimeout(watch);
    pending = { ms, message };
    if (operations > 0) return;
    watch = setTimeout(() => failAndExit(typeof message === 'string' ? message : message()), ms);
    watch.unref();
  };
  onTestOperation(({ kind }) => {
    if (kind === 'operation-start') {
      operations++;
      clearTimeout(watch);
    } else {
      operations = Math.max(0, operations - 1);
      if (operations === 0 && pending) arm(pending.ms, pending.message);
    }
  });
  arm(deadline, `no test started or ended within ${deadline} ms of the process start; the file's own code did not settle`);
  beforeEach(async (context) => {
    arm(deadline + RUNNING_TEST_MARGIN_MS, `the test "${context.name}" did not settle within ${deadline} ms; the process ends`);
    await turnTheLoop();
  });
  afterEach(async () => {
    arm(deadline, `no test started or ended within ${deadline} ms of the last test; the file's own code did not settle`);
    await turnTheLoop();
  });
  after(() => {
    arm(deadline, () => `the process did not exit ${deadline} ms after its last test; it holds ${process.getActiveResourcesInfo().join(', ')}`);
  });
}
