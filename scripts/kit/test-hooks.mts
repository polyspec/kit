// The setup and the teardown of a test file or a test: a browser launch, a server start, a stylesheet compile, a browser
// close, a server stop, a directory removal. They are long operations, not test cases: each has no hook timeout and ends
// when its operation settles (the browser launched, the server announced readiness, the close resolved, the process
// exited), and its result or error decides it. Each prints its start, a line while it is still running and its end with the
// elapsed time.
// Structured operation events suspend runner gap/exit watches for the operation and restore them in finally.
import { after, before } from 'node:test';
import { inspect } from 'node:util';
import { setImmediate as turnTheLoop } from 'node:timers/promises';
import { compactSeconds } from './time.mts';
import { reportTestOperation } from './test-gap.mts';

/** Where a hook is registered and how it reports. */
export type HookOptions = {
  context?: { before: typeof before; after: typeof after } | undefined;
  write?: ((text: string) => unknown) | undefined;
  heartbeatMs?: number | undefined;
};

function hook(register: 'before' | 'after', kind: string, name: string, operation: () => unknown, { context, write = text => process.stdout.write(text), heartbeatMs = 5000 }: HookOptions = {}): void {
  const add = context ? context[register].bind(context) : { before, after }[register];
  add(async () => {
    const started = performance.now();
    const elapsed = () => compactSeconds(performance.now() - started);
    const id = `${kind} ${name}`;
    reportTestOperation({ kind: 'operation-start', id });
    write(`[${kind}] ${name}: started\n`);
    const running = setInterval(() => write(`[${kind}] ${name}: still running (${elapsed()})\n`), heartbeatMs);
    try {
      // Flush the structured event before an operation that may block the test-file event loop.
      await turnTheLoop();
      await operation();
      write(`[${kind}] ${name}: finished in ${elapsed()}\n`);
    } catch (error) {
      // Any value can be thrown; one without a text message is printed as util.inspect shows it (a text as it is).
      const message = typeof error === 'object' && error !== null && 'message' in error ? error.message : undefined;
      write(`[${kind}] ${name}: failed after ${elapsed()}: ${typeof message === 'string' ? message : typeof error === 'string' ? error : inspect(error)}\n`);
      throw error;
    } finally {
      clearInterval(running);
      reportTestOperation({ kind: 'operation-end', id });
    }
  }, { timeout: Infinity });
}

/**
 * Register one setup as a `before` hook without a time limit.
 * @param {string} name what the setup starts, such as `browser launch`
 * @param {() => unknown} operation
 * @param {object} [options]
 * @param {{ before: Function }} [options.context] the test or suite context whose `before` hook runs the setup; without it,
 *   the setup runs before the tests of the file or of the enclosing suite
 * @param {(text: string) => void} [options.write]
 * @param {number} [options.heartbeatMs] interval of the still-running lines
 */
export function setup(name: string, operation: () => unknown, options?: HookOptions): void {
  hook('before', 'setup', name, operation, options);
}

/**
 * Register one teardown as an `after` hook without a time limit.
 * @param {string} name what the teardown stops, such as `browser close`
 * @param {() => unknown} operation
 * @param {object} [options]
 * @param {{ after: Function }} [options.context] the test whose `after` hook runs the teardown; without it, the teardown runs
 *   after the tests of the file or of the enclosing suite
 * @param {(text: string) => void} [options.write]
 * @param {number} [options.heartbeatMs] interval of the still-running lines
 */
export function teardown(name: string, operation: () => unknown, options?: HookOptions): void {
  hook('after', 'teardown', name, operation, options);
}
