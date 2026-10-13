// node:test reporter printing through the shared progress lines. node --test enforces the timeout of each test
// (--test-timeout); this reporter shows every test starting, still running and ending. A file that reports no test case
// fails, and so does a run in which no test ran.
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { Transform, type TransformCallback } from 'node:stream';
import type { EventData } from 'node:test';
import type { TestEvent } from 'node:test/reporters';
import { createProgress, type Progress } from './test-progress.mts';
import { testRoot } from './paths.mts';

// The repository root of the run, which run-tests passes; the working directory of this process is the --cwd directory.
const ROOT = testRoot();

/** The error of a failed test; node sets failureType, which @types/node does not declare. */
type TestFailure = EventData.Error & { failureType?: string };

/** What locates a test in the events of node:test. */
type TestPlace = Pick<EventData.TestComplete, 'file' | 'nesting' | 'name' | 'line' | 'column'>;

// The failure of a test: what failed (for example `failed running after hook`), then its cause.
const failureText = (error: TestFailure | undefined): string => {
  // A test may throw any value; the stack and message of a value that has none read as undefined.
  const cause = (error?.cause ?? error) as { stack?: string; message?: string } | null | undefined;
  const text = cause?.stack ?? cause?.message ?? String(cause);
  return error?.cause && error.message && !text.includes(error.message) ? `${error.message}\n${text}` : text;
};

export default class ProgressReporter extends Transform {
  // The constructor sets each of these; declare keeps the class without fields of its own.
  declare progress: Progress;
  declare names: Map<string, string[]>;
  declare completedFailures: Map<string, number>;
  declare failedFiles: Set<string>;
  declare cases: Map<string, number>;

  constructor() {
    super({ writableObjectMode: true });
    this.progress = createProgress({ write: (text: string) => this.push(text) });
    this.names = new Map();
    // Failed completions not yet matched by their failure report, by test key.
    this.completedFailures = new Map();
    // Files whose run reported a failure that no test completion holds, by real path.
    this.failedFiles = new Set();
    // The number of test cases each file reported, by real path; a file that reports none fails.
    this.cases = new Map();
  }

  key(data: TestPlace): string {
    return [data.file, data.nesting, data.name, data.line, data.column].join('\0');
  }

  // A test's position: its file, then the names of its enclosing tests. node names a file group relative to its working
  // directory (--cwd of run-tests), so the group is matched after resolving that name against the same directory.
  id(data: TestPlace): { id: string; group: boolean } {
    const file = data.file ? path.relative(ROOT, data.file) : '';
    if (data.nesting === 0 && data.file && path.resolve(process.cwd(), data.name) === data.file) return { id: file, group: true };
    const trail = this.names.get(file) ?? [];
    trail.length = data.nesting;
    trail[data.nesting] = data.name;
    this.names.set(file, trail);
    return { id: [file, ...trail].filter(Boolean).join(' › '), group: false };
  }

  // node:test reports a start when a test leaves the queue and its result, in execution order, when it completes.
  override _transform(event: TestEvent, encoding: BufferEncoding, callback: TransformCallback): void {
    const { type, data } = event;
    if (type === 'test:dequeue') {
      const { id, group } = this.id(data);
      this.progress.start(id, { group });
    } else if (type === 'test:complete') {
      const { id, group } = this.id(data);
      const { duration_ms: duration, error, passed } = data.details;
      const file = data.file && realpathSync(data.file);
      if (!group && file) this.cases.set(file, (this.cases.get(file) ?? 0) + 1);
      // A group is a file, so file is set wherever group holds below.
      if (data.skip || data.todo) this.progress.skip(id);
      else if (passed && group && this.failedFiles.has(file!)) {  // group implies file.
        this.failedFiles.delete(file!);  // group implies file.
        this.progress.fail(id, duration, 'a failure outside its tests failed the file');
      } else if (passed && group && !this.cases.get(file!)) {  // group implies file.
        this.progress.fail(id, duration, 'the file ran no test case');
        // node --test counts no failure for it; this reporter runs in that process and fails it.
        process.exitCode = 1;
      } else if (passed) this.progress.pass(id, duration);
      else {
        const key = this.key(data);
        this.completedFailures.set(key, (this.completedFailures.get(key) ?? 0) + 1);
        this.progress.fail(id, duration, failureText(error));
      }
    } else if (type === 'test:fail') {
      // node --test reports every failure after its completion, except a failure of the run of a file, such as a timed-out
      // hook of the file, which has no completion; the file then completes as passed.
      const key = this.key(data);
      const completed = this.completedFailures.get(key) ?? 0;
      if (completed > 1) this.completedFailures.set(key, completed - 1);
      else if (completed === 1) this.completedFailures.delete(key);
      else {
        const { error, duration_ms: duration } = data.details;
        const file = data.file ? path.relative(ROOT, data.file) : '';
        if (data.file) this.failedFiles.add(realpathSync(data.file));
        this.progress.fail(`${file} › ${(error as TestFailure)?.failureType === 'hookFailed' ? 'hook' : data.name}`, duration, failureText(error));
      }
    } else if (type === 'test:stderr' || type === 'test:stdout') this.push(data.message);
    callback();
  }

  override _flush(callback: TransformCallback): void {
    // A failure that node --test does not count, such as a run of zero tests, fails the process too.
    if (!this.progress.close('node --test').ok) process.exitCode = 1;
    callback();
  }
}
