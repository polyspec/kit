// The node:test reporter of the language-parity check (parity-runners.mts, the node runner): one JSON line
// `{"name":…,"outcome":…}` on its destination for each test that ends, read by parity-runners.mts. The name of a test is the
// names of its enclosing suites and its own, joined by ' › ', as node:test nests them; the test of the file itself is none.
// The outcome is pass, fail or skip, and a todo test is fail: a test that its author expects to fail is no pass.
import path from 'node:path';
import type { TestEvent } from 'node:test/reporters';

/** The place of a test in the events of node:test. */
type TestPlace = { file?: string | undefined; nesting: number; name: string };

/** The reporter: the events of the run in, one JSON line for each test that ends out. */
export default async function* parityReporter(source: AsyncIterable<TestEvent>): AsyncGenerator<string> {
  // The names of the tests that enclose the next event of each file, by nesting.
  const trails = new Map<string, string[]>();
  // node names the test of a file by its path relative to the working directory.
  const isFile = (data: TestPlace) => data.nesting === 0 && data.file !== undefined && path.resolve(data.name) === data.file;
  const nameOf = (data: TestPlace): string => {
    const trail = trails.get(data.file ?? '') ?? [];
    trail.length = data.nesting;
    trail[data.nesting] = data.name;
    trails.set(data.file ?? '', trail);
    return trail.join(' › ');
  };
  for await (const event of source) {
    if (event.type === 'test:start') {
      if (!isFile(event.data)) nameOf(event.data);
    } else if (event.type === 'test:pass' || event.type === 'test:fail') {
      if (isFile(event.data)) continue;
      const { skip, todo } = event.data;
      const outcome = todo ? 'fail' : skip ? 'skip' : event.type === 'test:pass' ? 'pass' : 'fail';
      yield `${JSON.stringify({ name: nameOf(event.data), outcome })}\n`;
    }
  }
}
