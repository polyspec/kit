// Preloaded by scripts/kit/run-tests.mts into the process of every node:test file, with the deadline in milliseconds as the
// `ms` parameter of its URL. A file whose tests have all ended but whose process stays alive holds a handle that a test left
// open: a timer, a server, a child process. After the deadline the process names the handles that keep it alive and exits 1,
// so the leak fails its file by name instead of hanging the run. node --test needs no --test-force-exit then, which ended a
// file's process at its last known test and dropped a test registered after a top-level await (K72).
// A file whose own code never settles (K437) never ends its tests, so the deadline after the last test never starts. A watch
// therefore runs from the process start and after each test: it exits 1 at the deadline, naming the running test or saying that
// no test was reached. A running test has node's own timeout at the same deadline; the watch allows a margin over it.
import { writeSync } from 'node:fs';
import { after, afterEach, beforeEach } from 'node:test';

// The internal handle of a standard stream; Node.js does not declare it.
type WithHandle = { _handle?: { setBlocking?: (blocking: boolean) => void } };

// The margin that the watch of a running test allows over the test's own timeout.
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
  let watch: NodeJS.Timeout | undefined;
  const arm = (ms: number, message: string) => {
    clearTimeout(watch);
    watch = setTimeout(() => {
      writeSync(2, `${file}: ${message}\n`);
      process.exit(1);
    }, ms);
    watch.unref();
  };
  arm(deadline, `no test started or ended within ${deadline} ms of the process start; the file's own code did not settle`);
  beforeEach((context) => {
    arm(deadline + RUNNING_TEST_MARGIN_MS, `the test "${context.name}" did not settle within ${deadline} ms; the process ends`);
  });
  afterEach(() => {
    arm(deadline, `no test started or ended within ${deadline} ms of the last test; the file's own code did not settle`);
  });
  after(() => {
    clearTimeout(watch);
    setTimeout(() => {
      writeSync(2, `${file}: the process did not exit ${deadline} ms after its last test; it holds ${process.getActiveResourcesInfo().join(', ')}\n`);
      process.exit(1);
    }, deadline).unref();
  });
}
