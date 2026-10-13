// Tests of the globs of repository paths (owner rules, document and parity configurations): picomatch with `dot: true`, so
// a path under a dot directory such as .github or docs/.vitepress matches like any other path.
import assert from 'node:assert/strict';
import test from 'node:test';
import { globExpression, matchesAny } from '../../scripts/kit/glob.mts';

test('a glob matches the paths under a dot directory', () => {
  for (const [glob, file] of ([
    ['.github/**', '.github/workflows/ci.yml'],
    ['**/*.yml', '.github/workflows/ci.yml'],
    ['docs/**', 'docs/.vitepress/config.ts'],
    ['docs/**/*.ts', 'docs/.vitepress/theme/index.ts'],
    ['**', '.gitignore'],
  ] as const)) assert.ok(matchesAny([glob], file), `${glob} matches ${file}`);
});

test('* stays in one path segment, ** crosses segments and {a,b} is either alternative', () => {
  assert.ok(matchesAny(['docs/*.md'], 'docs/a.md'));
  assert.ok(!matchesAny(['docs/*.md'], 'docs/x/a.md'));
  assert.ok(matchesAny(['docs/**/*.md'], 'docs/a.md'));
  assert.ok(matchesAny(['docs/**/*.md'], 'docs/x/y/a.md'));
  assert.ok(matchesAny(['{scripts,tests}/kit/**'], 'tests/kit/a.mts'));
  assert.ok(!matchesAny(['{scripts,tests}/kit/**'], 'docs/kit/a.md'));
  assert.ok(globExpression('a/*.md').test('a/b.md'));
});

test('a glob with nested braces matches as its expansion (K116)', () => {
  for (const file of ['a/b', 'a/c/d', 'a/c/e']) assert.ok(matchesAny(['a/{b,c/{d,e}}'], file), file);
  assert.ok(!matchesAny(['a/{b,c/{d,e}}'], 'a/c/f'));
});
