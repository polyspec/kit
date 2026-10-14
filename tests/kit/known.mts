// A value of a fixture or of a result that the test knows to be there although its type admits undefined or null: an entry of
// a list or a map at a known key, or a group of a regular expression. node:assert narrows it, so a value that is not there
// fails the test with what it expected instead of being asserted away with `!` (K156).
import assert from 'node:assert/strict';

/** `value`, which the test knows to be there; fails the test with `what` when it is undefined or null. */
export function known<T>(value: T | undefined | null, what: string): T {
  assert.ok(value !== undefined && value !== null, `${what} is missing`);
  return value;
}
