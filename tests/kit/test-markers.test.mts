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

test('a marker in a TSX test fails, and the JSX around it is read (K268)', () => {
  const text = "import { test } from 'vitest';\ntest.skip('renders', () => { render(<Form a={1} />); });\n";
  assert.deepEqual(markerFindings('src/Form.test.tsx', text), ['src/Form.test.tsx:2: test.skip skips or narrows a test']);
});

test('testing.Short, pytest.importorskip, @requires, #[Requires...] and the skip of a node:test context fail (K315)', () => {
  assert.deepEqual(markerFindings('a_test.go', 'func TestA(t *testing.T) {\n\tif testing.Short() {\n\t\tcases = 2000\n\t}\n}\n'), ['a_test.go:2: testing.Short() skips or narrows a test']);
  assert.deepEqual(markerFindings('tests/test_a.py', 'numpy = pytest.importorskip("numpy")\n'), ['tests/test_a.py:1: pytest.importorskip skips or narrows a test']);
  assert.deepEqual(markerFindings('tests/ATest.php', "<?php\n/** @requires extension redis */\n#[RequiresPhp('>=8.5')]\npublic function testA(): void {}\n"), [
    'tests/ATest.php:2: @requires skips or narrows a test',
    'tests/ATest.php:3: #[RequiresPhp( skips or narrows a test',
  ]);
  assert.deepEqual(markerFindings('tests/a.test.mts', "import test from 'node:test';\ntest('a', (t) => { t.skip('sudo is not allowed'); });\ntest('b', (t) => { t.todo(); });\n"), [
    'tests/a.test.mts:2: t.skip skips or narrows a test',
    'tests/a.test.mts:3: t.todo skips or narrows a test',
  ]);
});

test('a skip marker is no finding only in a fixture of the fixture convention (K344)', () => {
  const skip = 'func TestFixtureSkip(t *testing.T) {\n\tt.Skip("the runner reports this skip")\n}\n';
  assert.deepEqual(markerFindings('packages/go/testcase/testcase_fixture_test.go', skip), [], 'a fixture of the convention is no finding');
  assert.deepEqual(markerFindings('packages/go/testcase/testcase_test.go', skip), ['packages/go/testcase/testcase_test.go:2: t.Skip skips or narrows a test']);
  assert.deepEqual(markerFindings('tests/fixtures/skip.test.mts', "import test from 'node:test';\ntest.skip('the runner reports this skip', () => {});\n"), [], 'a fixture folder of the convention is no finding');
});

test('a Python skip marker inside a string literal is no finding, and one in code is (K345)', () => {
  const sample = ['SAMPLE = "@unittest.skip(\'x\')"', 'def test_doc():', '    """Mark it with pytest.mark.skip."""', '    pass', ''].join('\n');
  assert.deepEqual(markerFindings('tests/test_orm.py', sample), [], 'a marker in a string literal or a docstring is no finding');
  assert.deepEqual(markerFindings('tests/test_orm.py', '@unittest.skip("x")\ndef test_a(): pass\n'), ['tests/test_orm.py:1: unittest.skip skips or narrows a test']);
});
