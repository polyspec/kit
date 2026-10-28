// Test progress: one line when a test starts, a line while it keeps running, and one line when it passes, fails, is skipped
// or runs out of time, each stamped with the elapsed time of the run. Every test runner prints through this module, so all
// suites read the same way.
import { writeFileSync } from 'node:fs';
import { compactSeconds } from './time.mts';
import { present } from './present.mts';
import { isPHPUnitCaseId, type TestEvent } from './test-gap.mts';

/** The outcome of a test of a run; a test that ran out of time is `timeout`. */
export type CaseStatus = 'pass' | 'fail' | 'skip' | 'timeout';

/** A test of a run with its outcome and elapsed time. */
export type TestCase = { id: string; status: CaseStatus; elapsedMs: number };

/** The progress reporter of a run. */
export type Progress = ReturnType<typeof createProgress>;

/**
 * @param {object} options
 * @param {(text: string) => void} options.write receives complete lines
 * @param {number} [options.heartbeatMs] interval of the still-running lines
 * @param {number} [options.timeoutMs] a test running longer is reported to `onTimeout`
 * @param {(id: string) => void} [options.onTimeout] stops the test that ran out of time
 * @param {string} [options.command] the command that a timeout stops, named on the timeout line
 * @param {() => number} [options.now]
 * @param {string} [options.resultFile] receives the counts of the run as JSON when it ends
 * @param {(event: TestEvent) => unknown} [options.onEvent] receives the start and the end of each test, not of a group (K371-1)
 */
export function createProgress({ write, heartbeatMs = 5000, timeoutMs, onTimeout, command, now = () => Date.now(), resultFile = process.env.KIT_TEST_RESULT, onEvent }: {
  write: (text: string) => unknown;
  heartbeatMs?: number | undefined;
  timeoutMs?: number | undefined;
  onTimeout?: ((id: string) => unknown) | undefined;
  command?: string | undefined;
  now?: (() => number) | undefined;
  resultFile?: string | undefined;
  onEvent?: ((event: TestEvent) => unknown) | undefined;
}) {
  const started = now();
  const running = new Map<string, { started: number; expired: boolean; timeoutMs?: number }>();
  const pendingTimeouts = new Map<string, number>();
  const completed = new Set<string>();
  const counts = { passed: 0, failed: 0, skipped: 0, timedOut: 0 };
  // Each test with its outcome and elapsed time, in the order they ended; a test that ran out of time is `timeout`.
  const cases: TestCase[] = [];
  const groupCounts = { passed: 0, failed: 0 };
  // The ids of the tests and groups that skipped, which the run names: a skip is not a verification (K460).
  const skipped: string[] = [];
  const line = (text: string): unknown => write(`[${compactSeconds(now() - started).padStart(8)}] ${text}\n`);
  const timer = setInterval(() => {
    for (const [id, test] of running) {
      const elapsed = now() - test.started;
      if (test.timeoutMs !== undefined && elapsed > test.timeoutMs && !test.expired) {
        test.expired = true;
        counts.timedOut++;
        line(`⏱ ${id} ran ${compactSeconds(elapsed)} and exceeded its ${compactSeconds(test.timeoutMs)} timeout${command ? `; stopping \`${command}\`` : ''}`);
        onTimeout?.(id);
      } else if (!test.expired) {
        line(`… ${id} still running (${compactSeconds(elapsed)}${test.timeoutMs === undefined ? '' : ` of ${compactSeconds(test.timeoutMs)}`})`);
      }
    }
  }, heartbeatMs);
  timer.unref?.();
  // A group (a test file or a package) prints its lines but is not counted as a test.
  const groups = new Map<string, number>();
  const groupTime = (id: string, durationMs: number | undefined): string => {
    // Each caller checked groups.has(id).
    const time = durationMs || now() - present(groups.get(id), 'groups.get(id)');
    groups.delete(id);
    return compactSeconds(time);
  };
  const finish = (id: string, durationMs: number | undefined, status: 'pass' | 'fail' | 'skip'): number => {
    const test = running.get(id);
    running.delete(id);
    completed.add(id);
    while (completed.size > 256) {
      const oldest = completed.values().next().value;
      if (oldest === undefined) break;
      completed.delete(oldest);
    }
    pendingTimeouts.delete(id);
    const elapsedMs = durationMs ?? (test ? now() - test.started : 0);
    cases.push({ id, status: status === 'fail' && test?.expired ? 'timeout' : status, elapsedMs });
    onEvent?.({ kind: 'end', id });
    return elapsedMs;
  };
  return {
    line,
    start(id: string, { group = false }: { group?: boolean | undefined } = {}): void {
      if (group) groups.set(id, now());
      else {
        const ownTimeout = pendingTimeouts.get(id);
        pendingTimeouts.delete(id);
        const effectiveTimeout = ownTimeout ?? timeoutMs;
        running.set(id, { started: now(), expired: false, ...(effectiveTimeout === undefined ? {} : { timeoutMs: effectiveTimeout }) });
        onEvent?.({ kind: 'start', id });
      }
      const ownTimeout = group ? undefined : running.get(id)?.timeoutMs;
      line(`▶ ${id}${ownTimeout === undefined || ownTimeout === timeoutMs ? '' : ` (timeout ${compactSeconds(ownTimeout)})`}`);
    },
    /** Replaces a running PHPUnit case's watchdog with its resolved native per-test limit. */
    timeout(id: string, ownTimeoutMs: number): void {
      if (!isPHPUnitCaseId(id)) throw new Error(`invalid test timeout identity: ${id}`);
      if (!Number.isSafeInteger(ownTimeoutMs) || ownTimeoutMs < 1) throw new Error(`invalid test timeout for ${id}: ${ownTimeoutMs}`);
      if (completed.has(id)) return;
      const test = running.get(id);
      if (test) {
        test.timeoutMs = ownTimeoutMs;
        line(`⌛ ${id} uses PHPUnit's configured ${compactSeconds(ownTimeoutMs)} timeout`);
      } else {
        pendingTimeouts.set(id, ownTimeoutMs);
        if (pendingTimeouts.size > 256) throw new Error('too many PHPUnit test timeout events arrived before test starts');
      }
    },
    /** Counts a run that ran out of time outside its tests, such as before the first test (K371-1), and prints why. */
    expire(text: string): void {
      counts.timedOut++;
      line(`⏱ ${text}`);
    },
    pass(id: string, durationMs?: number): unknown {
      if (groups.has(id)) { groupCounts.passed++; return line(`✔ ${id} (${groupTime(id, durationMs)})`); }
      counts.passed++;
      line(`✔ ${id} (${compactSeconds(finish(id, durationMs, 'pass'))})`);
    },
    fail(id: string, durationMs?: number, message?: string): void {
      if (groups.has(id)) { groupCounts.failed++; line(`✖ ${id} (${groupTime(id, durationMs)})`); }
      else {
        counts.failed++;
        line(`✖ ${id} (${compactSeconds(finish(id, durationMs, 'fail'))})`);
      }
      for (const detail of String(message ?? '').split('\n').filter(Boolean)) write(`           ${detail}\n`);
    },
    skip(id: string): unknown {
      skipped.push(id);
      if (groups.has(id)) { groups.delete(id); return line(`○ ${id} skipped`); }
      counts.skipped++;
      finish(id, undefined, 'skip');
      line(`○ ${id} skipped`);
    },
    /**
     * End the run and return `{ passed, failed, skipped, timedOut, ran, ok, cases }`; `cases` holds `{ id, status, elapsedMs }`
     * of each test, `status` being `pass`, `fail`, `timeout` or `skip`. Tests still running are failures. A failed
     * group, a nonzero `exitCode` of the tool, or a run in which no test passed, failed or ran out of time fails the run
     * even when no test failed: a run that only skipped checked nothing. When no test failed, the summary of a nonzero
     * `exitCode` names the last `errors`, the error lines of the tool, so that it says why the tool exited; it also names
     * the `build` errors, the compiler errors of a package that did not build. The counts go to `resultFile` so that the
     * runner can require that a test ran.
     */
    close(label: string, { exitCode = 0, errors = [], build = [] }: { exitCode?: number | null | undefined; errors?: readonly string[] | undefined; build?: readonly string[] | undefined } = {}) {
      clearInterval(timer);
      for (const id of running.keys()) this.fail(id, undefined, 'the test did not finish');
      const ran = counts.passed + counts.failed + counts.timedOut;
      const none = ran === 0;
      // A skipped test fails the run as a failed one does, so the run that only skipped checks nothing and fails (K460).
      const failed = counts.failed + counts.timedOut + groupCounts.failed + skipped.length + (exitCode === 0 ? 0 : 1) + (none ? 1 : 0);
      // A group can fail while every test in it passed, for example on a failed hook of a file.
      const groupsFailed = groupCounts.failed === 1 ? ', 1 group failed' : `, ${groupCounts.failed} groups failed`;
      const summary = `${counts.passed} passed, ${counts.failed} failed, ${counts.timedOut} timed out, ${counts.skipped} skipped${groupCounts.failed ? groupsFailed : ''}${none ? ', no test ran' : ''}`;
      const unexplained = counts.failed + counts.timedOut + groupCounts.failed + skipped.length === 0;
      const why = !unexplained ? '' : errors.length ? `: ${errors.slice(-3).join('; ')}` : ' and printed no error line';
      const exit = exitCode === 0 ? '' : `, the tool exited with ${exitCode}${why}`;
      const named = skipped.length ? `; skipped cases: ${skipped.join('; ')}` : '';
      const built = build.length ? `; build errors: ${build.slice(0, 10).join('; ')}${build.length > 10 ? `; and ${build.length - 10} more` : ''}` : '';
      line(`${failed ? '✖' : '✔'} ${label}: ${summary}${named}${exit}${built} (${compactSeconds(now() - started)})`);
      const result = { ...counts, ran, ok: failed === 0, cases };
      if (resultFile) writeFileSync(resultFile, JSON.stringify(result));
      return result;
    },
    counts,
  };
}
