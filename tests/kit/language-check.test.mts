// Tests of scripts/kit/language-check.mts: the comments, identifiers, log and error messages and test names of the code are
// English (K252); a string that is data, such as a Korean phrase that a tool writes into a Korean document, is not read.
import assert from 'node:assert/strict';
import test from 'node:test';
import { languageFindings } from '../../scripts/kit/language-check.mts';

test('Hangul fails in a comment, an identifier, an error or log message and a test name of TypeScript (K252)', () => {
  const text = [
    '// 주석',
    'const 값 = 1;',
    "throw new Error('실패');",
    "console.log(`기록 ${cause}`);",
    "test('이름', () => {});",
    "const cause = '원인';",
  ].join('\n');
  assert.deepEqual(languageFindings('src/a.ts', text), [
    'src/a.ts:1: Hangul in a comment',
    'src/a.ts:2: Hangul in an identifier',
    'src/a.ts:3: Hangul in an error or log message',
    'src/a.ts:4: Hangul in an error or log message',
    'src/a.ts:5: Hangul in a test name',
  ]);
});

test('Hangul fails in a comment or outside a string of Go, Python, PHP and Rust, and a string is data (K252)', () => {
  assert.deepEqual(languageFindings('a.go', 'package a\n\n// 주석\nconst cause = "원인"\n'), ['a.go:3: Hangul in a comment']);
  assert.deepEqual(languageFindings('a.py', '# 주석\n값 = "원인"\n'), ['a.py:1: Hangul in a comment', 'a.py:2: Hangul in an identifier']);
  assert.deepEqual(languageFindings('a.php', "<?php\n/* 주석 */\n$cause = '원인';\n"), ['a.php:2: Hangul in a comment']);
  assert.deepEqual(languageFindings('a.rs', '/// 주석\nconst CAUSE: &str = "원인";\n'), ['a.rs:1: Hangul in a comment']);
  assert.deepEqual(languageFindings('docs/a.md', '# 제목\n'), [], 'a document is no code');
});
