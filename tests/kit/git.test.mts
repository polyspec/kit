// Tests of scripts/kit/git.mts. K510: fileAt reads a file of a revision named by a full commit sha once in a process, since that revision
// never moves; a ref name such as HEAD can move, so it is read again each time.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileAt } from '../../scripts/kit/git.mts';

test('fileAt keeps the text of a commit sha and reads a moving ref again (K510)', (t) => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-git-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args: string[]) => {
    const result = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git('init', '--quiet', '--initial-branch=main');
  writeFileSync(path.join(root, 'a.txt'), 'one\n');
  git('add', '-A');
  git('commit', '--quiet', '--no-verify', '-m', 'one');
  const first = git('rev-parse', 'HEAD');
  assert.equal(fileAt(root, first, 'a.txt'), 'one\n');
  assert.equal(fileAt(root, 'HEAD', 'a.txt'), 'one\n');
  writeFileSync(path.join(root, 'a.txt'), 'two\n');
  git('commit', '--quiet', '--no-verify', '-am', 'two');
  assert.equal(fileAt(root, 'HEAD', 'a.txt'), 'two\n', 'HEAD moved, so it is read again');
  assert.equal(fileAt(root, first, 'a.txt'), 'one\n', 'the commit sha keeps its text');
  assert.equal(fileAt(root, first, 'missing.txt'), '', 'a file that the commit lacks is empty');
  assert.equal(fileAt(root, `${git('rev-parse', 'HEAD')}^`, 'a.txt'), 'one\n', 'the parent of a sha is read by its tree');
});
