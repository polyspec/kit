// Tests of the order that the merge drivers of the changelogs give the Unreleased entries (K354-1): the entries that only the
// side being applied adds come first, in the style of the list of main, tight or loose.
import assert from 'node:assert/strict';
import test from 'node:test';
import { orderUnreleased } from '../../scripts/kit/twin-merge.mts';

const changelog = (entries: string, rest = '## 0.0.1\n\n- first\n') => `# Changelog\n\n## Unreleased\n\n${entries}\n${rest}`;

test('the entries that only the applied side adds come before those of main, in a tight list (K354-1)', () => {
  // The union of a rebase puts the lines of main (ours) before those of the commit that the rebase applies (theirs).
  const ours = changelog('- c (T3).\n- a (T1).\n');
  const theirs = changelog('- b (T2).\n  more of b.\n- a (T1).\n');
  const merged = changelog('- c (T3).\n- b (T2).\n  more of b.\n- a (T1).\n');
  assert.equal(orderUnreleased(merged, ours, theirs), changelog('- b (T2).\n  more of b.\n- c (T3).\n- a (T1).\n'));
});

test('a loose list stays loose: each entry is a paragraph of its own (K354-1)', () => {
  // T26.7-2-6-2: the union left the line of the branch right under a line of main, with no blank line between them.
  const ours = changelog('- c (T3).\n\n- a (T1).\n');
  const theirs = changelog('- b (T2).\n\n- a (T1).\n');
  const merged = changelog('- c (T3).\n- b (T2).\n\n- a (T1).\n');
  assert.equal(orderUnreleased(merged, ours, theirs), changelog('- b (T2).\n\n- c (T3).\n\n- a (T1).\n'));
});

test('the entries keep their sub-heading, and a changelog without Unreleased or without a new entry is unchanged (K354-1)', () => {
  const ours = changelog('### C1\n\n- c (C1-2).\n- a (C1-1).\n\n### C2\n\n- d (C2-1).\n');
  const theirs = changelog('### C1\n\n- b (C1-3).\n- a (C1-1).\n\n### C2\n\n- d (C2-1).\n');
  const merged = changelog('### C1\n\n- c (C1-2).\n- b (C1-3).\n- a (C1-1).\n\n### C2\n\n- d (C2-1).\n');
  assert.equal(orderUnreleased(merged, ours, theirs), changelog('### C1\n\n- b (C1-3).\n- c (C1-2).\n- a (C1-1).\n\n### C2\n\n- d (C2-1).\n'));
  assert.equal(orderUnreleased(ours, ours, ours), ours);
  const released = '# Changelog\n\n## 0.0.1\n\n- first\n';
  assert.equal(orderUnreleased(released, released, released), released);
});
