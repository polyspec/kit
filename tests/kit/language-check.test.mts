// Tests of scripts/kit/language-check.mts: the comments, identifiers, log and error messages and test names of the code are
// English (K252); a string that is data, such as a Korean phrase that a tool writes into a Korean document, is not read.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { languageFindings } from '../../scripts/kit/language-check.mts';
import { tree } from './tree.mts';
import { tool } from './kit-tools.mts';

// The text that kit's own recipe forbids, as language-check --forbid reads it (K1088).
const HANGUL = /\p{Script=Hangul}/u;

test('Hangul fails in a comment, an identifier, an error or log message and a test name of TypeScript (K252)', () => {
  const text = [
    '// 주석',
    'const 값 = 1;',
    "throw new Error('실패');",
    "console.log(`기록 ${cause}`);",
    "test('이름', () => {});",
    "const cause = '원인';",
  ].join('\n');
  assert.deepEqual(languageFindings('src/a.ts', text, HANGUL), [
    'src/a.ts:1: forbidden text in a comment',
    'src/a.ts:2: forbidden text in an identifier',
    'src/a.ts:3: forbidden text in an error or log message',
    'src/a.ts:4: forbidden text in an error or log message',
    'src/a.ts:5: forbidden text in a test name',
  ]);
});

test('Hangul fails in a comment or outside a string of Go, Python, PHP and Rust, and a string is data (K252)', () => {
  assert.deepEqual(languageFindings('a.go', 'package a\n\n// 주석\nconst cause = "원인"\n', HANGUL), ['a.go:3: forbidden text in a comment']);
  assert.deepEqual(languageFindings('a.py', '# 주석\n값 = "원인"\n', HANGUL), ['a.py:1: forbidden text in a comment', 'a.py:2: forbidden text in an identifier']);
  assert.deepEqual(languageFindings('a.php', "<?php\n/* 주석 */\n$cause = '원인';\n", HANGUL), ['a.php:2: forbidden text in a comment']);
  assert.deepEqual(languageFindings('a.rs', '/// 주석\nconst CAUSE: &str = "원인";\n', HANGUL), ['a.rs:1: forbidden text in a comment']);
  assert.deepEqual(languageFindings('docs/a.md', '# 제목\n', HANGUL), [], 'a document is no code');
});

test('TSX and JSX are read: Hangul fails in a comment of JSX and in an identifier, and the text of an element is data (K268)', () => {
  const text = "const 표 = () => <div title=\"제목\">{/* 설명 */}안녕</div>;\nexport { 표 };\n";
  assert.deepEqual(languageFindings('src/a.tsx', text, HANGUL), ['src/a.tsx:1: forbidden text in a comment', 'src/a.tsx:1: forbidden text in an identifier', 'src/a.tsx:2: forbidden text in an identifier']);
  assert.deepEqual(languageFindings('src/b.jsx', 'export const A = () => <p>{"값"}</p>;\n', HANGUL), []);
});

test('a raw string of Go or Rust is data over its lines, and code after it is read (K268-1)', () => {
  assert.deepEqual(languageFindings('a.go', 'var s = `첫 줄\n둘째 줄` // English\nvar 값 = 1\n', HANGUL), ['a.go:3: forbidden text in an identifier']);
  assert.deepEqual(languageFindings('a.rs', 'let s = r#"{"a": "값"}\n"둘"# ;\nlet t = r"한";\n', HANGUL), []);
});

// K1088: the language rule applies as the caller declares it: the CLI reads the text that --forbid declares, and finds none without it.
test('K1088: language-check finds the text that --forbid declares, and refuses a call without a valid declaration (exit 2)', (t) => {
  const root = tree(t, { 'src/a.ts': '// 주석\nexport const a = 1;\n' });
  const check = tool(import.meta.resolve('../../scripts/kit/language-check.mts'));
  const git = (...args: string[]) => spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  git('init', '-q');
  git('add', '-A');
  const run = (...args: string[]) => spawnSync(process.execPath, [check, ...args], { cwd: root, encoding: 'utf8' });
  const bare = run();
  assert.equal(bare.status, 2, 'a call without --forbid is a usage error');
  assert.match(bare.stderr, /no --forbid/);
  const invalid = run('--forbid', '(');
  assert.equal(invalid.status, 2, 'a --forbid that is no regular expression is a usage error');
  assert.match(invalid.stderr, /is no regular expression/);
  const declared = run('--forbid', '\\p{Script=Hangul}');
  assert.equal(declared.status, 1, declared.stderr);
  assert.match(declared.stderr, /src\/a\.ts:1: forbidden text in a comment/);
  assert.equal(run('--forbid', '\\p{Script=Han}').status, 0, 'only the declared text is forbidden');
});
