// Native Playwright Test reporter for the shared per-case progress and run result.
import path from 'node:path';
import type { FullConfig, FullResult, Reporter, Suite, TestCase, TestError, TestResult } from '@playwright/test/reporter';
import { createProgress, type Progress } from './test-progress.mts';
import { writeTestEvent } from './test-gap.mts';
import { testRoot } from './paths.mts';

interface ActiveCase {
  started: number;
  elapsedMs: number;
}

const errorText = (result: TestResult): string => (result.errors.length ? result.errors : result.error ? [result.error] : [])
  .map((error: TestError) => error.stack ?? error.message ?? 'Playwright test failed')
  .join('\n');

export default class PlaywrightProgressReporter implements Reporter {
  declare progress: Progress;
  declare active: Map<string, ActiveCase>;
  declare root: string;

  onBegin(_config: FullConfig, _suite: Suite): void {
    this.root = testRoot();
    this.active = new Map();
    this.progress = createProgress({ write: text => process.stdout.write(text), onEvent: writeTestEvent });
    writeTestEvent({ kind: 'up', id: 'Playwright Test' });
  }

  id(test: TestCase): string {
    const file = path.relative(this.root, test.location.file);
    const project = test.parent.project()?.name ?? '';
    const titles = test.titlePath()
      .filter(title => title !== '' && title !== project && path.resolve(this.root, title) !== path.resolve(this.root, file))
      .join(' › ') || test.id;
    const repeat = test.repeatEachIndex === 0 ? '' : ` (repeat ${test.repeatEachIndex + 1})`;
    return `${file} › ${project || 'default'} › ${titles}${repeat}`;
  }

  onTestBegin(test: TestCase, _result: TestResult): void {
    const id = this.id(test);
    if (this.active.has(id)) return;
    this.active.set(id, { started: Date.now(), elapsedMs: 0 });
    this.progress.start(id);
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const id = this.id(test);
    let active = this.active.get(id);
    // Playwright reports cases skipped during discovery without onTestBegin.
    if (!active) {
      active = { started: Date.now(), elapsedMs: 0 };
      this.active.set(id, active);
      this.progress.start(id);
    }
    active.elapsedMs += result.duration;
    // Keep a test open across retries so a flaky test contributes one final passing case, as Playwright does.
    if (result.retry < test.retries) return;
    this.active.delete(id);
    const outcome = test.outcome();
    const elapsed = active.elapsedMs || Date.now() - active.started;
    const details = errorText(result);
    if (result.status === 'skipped' || outcome === 'skipped') this.progress.skip(id);
    else if (result.status === 'timedOut') this.progress.timedOut(id, elapsed, details);
    else if (outcome === 'expected' || outcome === 'flaky') this.progress.pass(id, elapsed);
    else this.progress.fail(id, elapsed, details);
  }

  onError(error: TestError): void {
    this.progress.line(`✖ Playwright error: ${error.stack ?? error.message ?? 'unknown error'}`);
  }

  onEnd(result: FullResult): void {
    for (const id of this.active.keys()) this.progress.fail(id, undefined, 'the test did not finish');
    this.active.clear();
    const closed = this.progress.close('playwright', { exitCode: result.status === 'passed' ? 0 : 1 });
    if (!closed.ok) process.exitCode = 1;
  }

  printsToStdio(): boolean {
    return true;
  }
}
