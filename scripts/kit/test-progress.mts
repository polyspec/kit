// Test progress: one line when a test starts, a line while it keeps running, and one line when it passes, fails or is skipped,
// each stamped with the elapsed time of the run. Every test runner prints through this module, so all suites read the same
// way. It sets no time limit: a test runs until its tool ends it (K1175).
import { writeFileSync } from 'node:fs';
import { compactSeconds } from './time.mts';
import { present } from './present.mts';

/** The outcome of a test of a run. */
export type CaseStatus = 'pass' | 'fail' | 'skip';

/** A test of a run with its outcome and elapsed time. */
export type TestCase = { id: string; status: CaseStatus; elapsedMs: number };

/** The progress reporter of a run. */
export type Progress = ReturnType<typeof createProgress>;

/**
 * @param {object} options
 * @param {(text: string) => void} options.write receives complete lines
 * @param {number} [options.heartbeatMs] interval of the still-running lines
 * @param {() => number} [options.now]
 * @param {string} [options.resultFile] receives the counts of the run as JSON when it ends
 */
export function createProgress({ write, heartbeatMs = 5000, now = () => Date.now(), resultFile = process.env.KIT_TEST_RESULT }: {
  write: (text: string) => unknown;
  heartbeatMs?: number | undefined;
  now?: (() => number) | undefined;
  resultFile?: string | undefined;
}) {
  const started = now();
  // The start of each running test.
  const running = new Map<string, number>();
  const counts = { passed: 0, failed: 0, skipped: 0 };
  // Each test with its outcome and elapsed time, in the order they ended.
  const cases: TestCase[] = [];
  const groupCounts = { passed: 0, failed: 0 };
  // The tests that the tool counted for the run and that did not start (K1214): they are no pass, no failure and no skip.
  let notRun = 0;
  // The ids of the tests and groups that skipped, which the run names: a skip is not a verification (K460).
  const skipped: string[] = [];
  const line = (text: string): unknown => write(`[${compactSeconds(now() - started).padStart(8)}] ${text}\n`);
  const timer = setInterval(() => {
    for (const [id, began] of running) line(`… ${id} still running (${compactSeconds(now() - began)})`);
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
  const finish = (id: string, durationMs: number | undefined, status: CaseStatus): number => {
    const began = running.get(id);
    running.delete(id);
    const elapsedMs = durationMs ?? (began === undefined ? 0 : now() - began);
    cases.push({ id, status, elapsedMs });
    return elapsedMs;
  };
  return {
    line,
    start(id: string, { group = false }: { group?: boolean | undefined } = {}): void {
      if (group) groups.set(id, now());
      else running.set(id, now());
      line(`▶ ${id}`);
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
     * Adds `count` tests that the tool counted for the run and that did not start, as the tests of a class whose hook before
     * its first test failed (K1214). They belong to no other count, the summary names them, and they fail the run.
     */
    notRun(count: number): void {
      notRun += count;
    },
    /**
     * End the run and return `{ passed, failed, skipped, ran, ok, cases }`, with `notRun` when a test did not run; `cases` holds
     * `{ id, status, elapsedMs }` of each test, `status` being `pass`, `fail` or `skip`. Tests still running are failures. A failed
     * group, a test that did not run, a nonzero `exitCode` of the tool, or a run in which no test passed or failed fails the run even
     * when no test failed: a run that only skipped checked nothing. The summary is `N passed, N failed, N skipped`, followed by
     * `, N not run` only when a test did not run, so the sum of the counts is the number of tests that the tool counted (K1214). The summary of a nonzero `exitCode` states that status and no guess at its cause, which the lines of
     * the tool above it show (K1172); it also names the `build` errors, which test2json reports for a package that did not
     * build. The counts go to `resultFile` so that the runner can require that a test ran.
     */
    close(label: string, { exitCode = 0, build = [] }: { exitCode?: number | null | undefined; build?: readonly string[] | undefined } = {}) {
      clearInterval(timer);
      for (const id of running.keys()) this.fail(id, undefined, 'the test did not finish');
      const ran = counts.passed + counts.failed;
      const none = ran === 0;
      // A skipped test fails the run as a failed one does, so the run that only skipped checks nothing and fails (K460).
      const failed = counts.failed + groupCounts.failed + skipped.length + notRun + (exitCode === 0 ? 0 : 1) + (none ? 1 : 0);
      // A group can fail while every test in it passed, for example on a failed hook of a file.
      const groupsFailed = groupCounts.failed === 1 ? ', 1 group failed' : `, ${groupCounts.failed} groups failed`;
      const summary = `${counts.passed} passed, ${counts.failed} failed, ${counts.skipped} skipped${notRun ? `, ${notRun} not run` : ''}${groupCounts.failed ? groupsFailed : ''}${none ? ', no test ran' : ''}`;
      // The exit status is a fact; the lines of the tool, printed above, show its cause (K1172).
      const exit = exitCode === 0 ? '' : `, the tool exited with ${exitCode}`;
      const named = skipped.length ? `; skipped cases: ${skipped.join('; ')}` : '';
      const built = build.length ? `; build errors: ${build.slice(0, 10).join('; ')}${build.length > 10 ? `; and ${build.length - 10} more` : ''}` : '';
      line(`${failed ? '✖' : '✔'} ${label}: ${summary}${named}${exit}${built} (${compactSeconds(now() - started)})`);
      const result = { ...counts, ...(notRun ? { notRun } : {}), ran, ok: failed === 0, cases };
      if (resultFile) writeFileSync(resultFile, JSON.stringify(result));
      return result;
    },
    counts,
  };
}
