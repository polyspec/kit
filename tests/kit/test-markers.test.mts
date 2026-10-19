// Tests of scripts/kit/test-markers.mts: no test is skipped or narrowed by a marker (K255). A TypeScript or JavaScript test
// is read with its parser, so a marker inside a string, such as a fixture of a test, is no marker.
import assert from 'node:assert/strict';
import test from 'node:test';
import { markerFindings } from '../../scripts/kit/test-markers.mts';

test('a skip, only or todo marker of node:test or vitest fails, and one inside a string does not (K255)', () => {
  const text = [
    "import test, { describe, it } from 'node:test';",
    "test.skip('a', () => {});",
    "describe.only('b', () => {});",
    "it('c', { todo: true }, () => {});",
    "test('d', () => { const fixture = \"test.skip('x', () => {})\"; });",
    "test('e', () => {});",
  ].join('\n');
  assert.deepEqual(markerFindings('tests/a.test.ts', text), [
    'tests/a.test.ts:2: test.skip skips or narrows a test',
    'tests/a.test.ts:3: describe.only skips or narrows a test',
    'tests/a.test.ts:4: the option todo skips or narrows a test',
  ]);
});

test('the skip markers of Go, Python, PHP and Rust fail on a line of code, not in a comment (K255)', () => {
  assert.deepEqual(markerFindings('a_test.go', 'func TestA(t *testing.T) {\n\t// t.Skip("later")\n\tt.Skip("later")\n}\n'), ['a_test.go:3: t.Skip skips or narrows a test']);
  assert.deepEqual(markerFindings('tests/test_a.py', '# @unittest.skip\n@unittest.skip("later")\ndef test_a(): pass\n@pytest.mark.xfail\ndef test_b(): pass\n'), ['tests/test_a.py:2: unittest.skip skips or narrows a test', 'tests/test_a.py:4: pytest.mark.xfail skips or narrows a test']);
  assert.deepEqual(markerFindings('tests/ATest.php', "<?php\n$this->markTestSkipped('later');\n"), ['tests/ATest.php:2: markTestSkipped skips or narrows a test']);
  assert.deepEqual(markerFindings('tests/a.rs', '#[test]\n#[ignore]\nfn a() {}\n'), ['tests/a.rs:2: #[ignore] skips or narrows a test']);
  assert.deepEqual(markerFindings('src/a.ts', "test.skip('a', () => {});\n"), [], 'a file that is no test is not read');
});
