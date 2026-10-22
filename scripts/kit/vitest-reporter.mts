// Vitest reporter printing through the shared progress lines. Vitest stops a test at its own timeout (--testTimeout); this
// reporter shows every test starting, still running and ending.
import path from 'node:path';
import { createProgress, type Progress } from './test-progress.mts';
import { writeTestEvent } from './test-gap.mts';
import { testRoot } from './paths.mts';
import { present } from './present.mts';

// The repository root of the run, which run-tests passes; the working directory of this process is the --cwd directory.
const ROOT = testRoot();

// Vitest is no dependency of kit, so these describe the members of its reporter API that this reporter reads.
interface ReportedError {
  message: string;
  stack?: string;
}

/** A test module, suite or case: a module has moduleId, a suite and a case have module and fullName. */
interface ReportedEntity {
  moduleId?: string;
  module?: { moduleId: string };
  fullName?: string;
}

interface ReportedModule extends ReportedEntity {
  errors: () => readonly ReportedError[];
  diagnostic: () => { duration: number };
  state: () => string;
}

interface ReportedSuite extends ReportedEntity {
  errors: () => readonly ReportedError[];
  state: () => string;
}

interface ReportedCase extends ReportedEntity {
  result: () => { state: string; errors?: readonly ReportedError[] };
  diagnostic: () => { duration: number } | undefined;
}

// An error with its message: the stack of a timed-out hook does not hold the message.
const errorText = (errors: readonly ReportedError[]): string => errors.map(error => {
  const text = error.stack ?? error.message;
  return error.message && !text.includes(error.message) ? `${error.message}\n${text}` : text;
}).join('\n');

export default class ProgressReporter {
  // onInit sets these before Vitest reports anything; declare keeps the class without fields of its own.
  declare progress: Progress;
  declare suites: Set<string>;

  onInit(): void {
    // The test events go to run-tests, which runs the gap watch of each test (K371-1).
    this.progress = createProgress({ write: (text: string) => process.stdout.write(text), onEvent: writeTestEvent });
    this.suites = new Set();
  }

  id(entity: ReportedEntity): string {
    // A module has moduleId, and a suite and a case have module.
    const file = path.relative(ROOT, entity.module?.moduleId ?? present(entity.moduleId, 'entity.moduleId'));
    return entity.fullName ? `${file} › ${entity.fullName.replaceAll(' > ', ' › ')}` : file;
  }

  // A worker reports a module queued when it takes the module, before it loads the file: the worker is up (K549). The worker of
  // the next module starts after a module ends, so the start-up bound holds until a worker takes it. With modules in parallel,
  // a gap after a test while another module's worker starts has the start-up bound.
  onTestModuleQueued(testModule: ReportedModule): void {
    writeTestEvent({ kind: 'up', id: this.id(testModule) });
  }

  onTestModuleStart(testModule: ReportedModule): void {
    this.progress.start(this.id(testModule), { group: true });
  }

  onTestModuleEnd(testModule: ReportedModule): void {
    const id = this.id(testModule);
    const errors = testModule.errors();
    const duration = testModule.diagnostic().duration;
    if (errors.length || testModule.state() === 'failed') this.progress.fail(id, duration, errorText(errors));
    else this.progress.pass(id, duration);
    writeTestEvent({ kind: 'launch', id: `the module after ${id}` });
  }

  // A suite is a group, so the failure of its own hooks is printed with its elapsed time.
  onTestSuiteReady(testSuite: ReportedSuite): void {
    this.suites.add(this.id(testSuite));
    this.progress.start(this.id(testSuite), { group: true });
  }

  onTestSuiteResult(testSuite: ReportedSuite): void {
    const id = this.id(testSuite);
    // Vitest reports a skipped suite without its start.
    if (!this.suites.delete(id)) this.progress.start(id, { group: true });
    const errors = testSuite.errors();
    if (errors.length || testSuite.state() === 'failed') this.progress.fail(id, undefined, errorText(errors));
    else if (testSuite.state() === 'skipped') this.progress.skip(id);
    else this.progress.pass(id);
  }

  onTestCaseReady(testCase: ReportedCase): void {
    this.progress.start(this.id(testCase));
  }

  onTestCaseResult(testCase: ReportedCase): void {
    const id = this.id(testCase);
    const result = testCase.result();
    const duration = testCase.diagnostic()?.duration;
    if (result.state === 'passed') this.progress.pass(id, duration);
    else if (result.state === 'skipped') this.progress.skip(id);
    else this.progress.fail(id, duration, errorText(result.errors ?? []));
  }

  onTestRunEnd(testModules: readonly ReportedModule[], unhandledErrors: readonly ReportedError[]): void {
    for (const error of unhandledErrors) this.progress.line(`✖ unhandled error: ${error.stack ?? error.message}`);
    // A failure that vitest does not count, such as a run of zero tests, fails the process too.
    if (!this.progress.close('vitest').ok) process.exitCode = 1;
  }
}
