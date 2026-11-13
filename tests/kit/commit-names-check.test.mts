// The check of commit names (K1210): which words of a text it reports as the name of a Git commit, and that its command reads
// the tracked Markdown files alone, leaves out the paths of --except, and fails when it read no file.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { initRepository } from './sandbox-repository.mts';
import { commitNames, main } from '../../scripts/kit/commit-names-check.mts';

/** The names that commitNames reports in `text`. */
const names = (text: string): string[] => commitNames(text).map(found => found.name);

test('K1210: a word of 7 to 40 hexadecimal digits with a digit and a letter is a commit name', () => {
  assert.deepEqual(names('the lock pins the package at 9de9d03, the commit'), ['9de9d03']);
  assert.deepEqual(names('(96da077, 5d17159)'), ['96da077', '5d17159']);
  assert.deepEqual(names('the commit 3b4bc6bfc45bd1069734d290958a30c6bf2a9f66 of the package'), ['3b4bc6bfc45bd1069734d290958a30c6bf2a9f66']);
  assert.deepEqual(names('ends a sentence 6f852f4. And `a03ba03`'), ['6f852f4', 'a03ba03']);
  assert.deepEqual(names('abc123 has 6 digits'), []);
});

test('K1210: a name is reported with its line and its column, both from 1', () => {
  assert.deepEqual(commitNames('first line\nthe tree 49a4e97 and 0a1b2c3d\n'), [
    { line: 2, column: 10, name: '49a4e97' },
    { line: 2, column: 22, name: '0a1b2c3d' },
  ]);
});

test('K1210: a name is found when `:`, `=`, `@`, `#`, `/`, `_` or `-` touches it', () => {
  assert.deepEqual(names('git show abc1234:path'), ['abc1234']);
  assert.deepEqual(names('uses repo@abc1234def'), ['abc1234def']);
  assert.deepEqual(names('commit=0a1b2c3d'), ['0a1b2c3d']);
  assert.deepEqual(names('0a1b2c3/file and tree/0a1b2c4'), ['0a1b2c3', '0a1b2c4']);
  assert.deepEqual(names('https://example.com/o/r/commit/49a4e97#diff'), ['49a4e97']);
  assert.deepEqual(names('page#abc1234 and abc1235#L3'), ['abc1234', 'abc1235']);
  assert.deepEqual(names('abc1234-dirty and x-abc1235 and abc1236_x and tag_abc1237'), ['abc1234', 'abc1235', 'abc1236', 'abc1237']);
  assert.deepEqual(names('the range abc1234..def5678 and abc1235...def5679'), ['abc1234', 'def5678', 'abc1235', 'def5679']);
});

test('K1210: a longer word that holds hexadecimal digits is no commit name', () => {
  assert.deepEqual(names('<!-- source-sha256: 887b911ac79315ba0e512d00c23cfef5198b51ea0f775df7260fb1c97cc850da -->'), []);
  assert.deepEqual(names(`sha512 ${'0a1b2c3d'.repeat(16)}`), []);
  assert.deepEqual(names(`41 digits ${'a1'.repeat(20)}b`), []);
  assert.deepEqual(names('the id 123e4567-e89b-12d3-a456-426614174000'), []);
  assert.deepEqual(names('0a1b2c3d_4e5f6a7b and 2026-11-13-0a1b2c3d'), []);
  assert.deepEqual(names('0x1a2b3c4d and abc1234x and Kabc1234 and ABC1234abc1234'), []);
  assert.deepEqual(names('abc1234.md and v1.0a1b2c3d and file.abc1234'), []);
  assert.deepEqual(names('`a:2:{i:0;i:1;i:1;R:2;}` and S-457-1 and v0.0.13 and K1053'), []);
});

test('K1210: a name of digits only or of letters only is reported when a marker stands directly before it', () => {
  assert.deepEqual(names('fixed in commit 1234567'), ['1234567']);
  assert.deepEqual(names('Commit: `7654321` and sha=20261113'), ['7654321', '20261113']);
  assert.deepEqual(names('rev 0000001 and revision: 9999999'), ['0000001', '9999999']);
  assert.deepEqual(names('the action owner/action@1234567 and tool@`7654321`'), ['1234567', '7654321']);
  assert.deepEqual(names('https://example.com/o/r/commit/1234567'), ['1234567']);
  assert.deepEqual(names('the commits 1234567, 2345678'), ['1234567']);
  assert.deepEqual(names('commit deadbeef and @defaced'), ['deadbeef', 'defaced']);
});

test('K1210: a number or a word without a marker is no commit name', () => {
  assert.deepEqual(names('released on 20261113'), []);
  assert.deepEqual(names('the archive holds 1048576 bytes'), []);
  assert.deepEqual(names('the CI run 19234567890 passed'), []);
  assert.deepEqual(names('https://example.com/o/r/actions/runs/19234567890'), []);
  assert.deepEqual(names('the version 1.2345678 and the build 2026.1113001'), []);
  assert.deepEqual(names('1234567 tests and 0000000 failures'), []);
  assert.deepEqual(names('call 0212345678'), []);
  assert.deepEqual(names('the feedback of a decade was defaced and acceded'), []);
  assert.deepEqual(names('sha256 1234567 and the committee 1234567'), []);
});

// The rules accept these misses: each line names a commit, and the check does not report it.
test('K1210: the accepted misses are not reported', () => {
  // A name of digits only without a marker; the word `at` is no marker, because it precedes sizes and dates as well.
  assert.deepEqual(names('the lock pins the package at 1234567'), []);
  assert.deepEqual(names('the tree `7654321` holds the fix'), []);
  // A marker that does not stand directly before the name.
  assert.deepEqual(names('the commit (1234567) and the commit named 7654321'), []);
  // A name of letters only without a marker.
  assert.deepEqual(names('the tree deadbeef holds the fix'), []);
  // A name in uppercase digits.
  assert.deepEqual(names('the commit 9DE9D03'), []);
  // A name that `-` or `_` joins to a word of hexadecimal digits only.
  assert.deepEqual(names('abc1234-dead and 12-abc1234'), []);
});

/** A sandbox repository with the files `files` (path to content); the test removes it at its end. */
function sandbox(t: TestContext, files: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), 'kit-commit-names-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  initRepository(root);
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), content);
  }
  return root;
}

/** Runs main on `root` with `argv` and returns its exit code and its output lines. */
function run(root: string, argv: string[]): { code: number; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  const code = main(argv, { root, print: text => out.push(text), error: text => err.push(text) });
  return { code, out, err };
}

test('K1210: the command reports each name of the Markdown files with its file, line and column, and exits 1', (t) => {
  const root = sandbox(t, {
    'docs/a.md': 'first line\nthe package 49a4e97 is pinned\n',
    'b.md': 'no name here\n<!-- source-sha256: 887b911ac79315ba0e512d00c23cfef5198b51ea0f775df7260fb1c97cc850da -->\n',
    'c.md': 'uses tool@1234567\n',
    'data.json': '"49a4e97"\n',
    '.gitignore': 'var/\n',
    'var/ignored.md': 'the package 49a4e97\n',
  });
  assert.deepEqual(run(root, []), {
    code: 1,
    out: ['[commit-names-check] reading 3 tracked Markdown files'],
    err: [
      'c.md:1:11: names the Git commit 1234567; a tracked file names no Git commit',
      'docs/a.md:2:13: names the Git commit 49a4e97; a tracked file names no Git commit',
      '[commit-names-check] 2 commit names in 3 tracked Markdown files',
    ],
  });
});

test('K1210: the command leaves out the paths of --except and exits 0 with the number of files read', (t) => {
  const root = sandbox(t, {
    'docs/a.md': 'the package 49a4e97 is pinned\n',
    'history/old.md': 'the tree 0a1b2c3d\n',
    'b.md': 'no name here\n',
  });
  assert.deepEqual(run(root, ['--except', 'docs/**', '--except', 'history/*.md']), {
    code: 0,
    out: [
      '[commit-names-check] reading 1 tracked Markdown files, except docs/** history/*.md',
      '[commit-names-check] 1 tracked Markdown files name no Git commit',
    ],
    err: [],
  });
});

test('K1210: a run that reads no Markdown file fails', (t) => {
  const root = sandbox(t, { 'docs/a.md': 'no name here\n', 'data.json': '{}\n' });
  const all = run(root, ['--except', '**/*.md']);
  assert.equal(all.code, 1);
  assert.match(all.err.join('\n'), /no tracked Markdown file was read/);
});

test('K1210: an unknown argument or an --except without a glob is a usage error', (t) => {
  const root = sandbox(t, { 'a.md': 'no name here\n' });
  for (const argv of [['--allow', 'a.md'], ['--except'], ['--except', ''], ['a.md']]) {
    assert.deepEqual(run(root, argv), { code: 2, out: [], err: ['usage: node scripts/kit/commit-names-check.mts [--except <glob>]...'] });
  }
});
