// Tests of the tag of a release (scripts/kit/release.mts `createTag`, K269): the release workflow, dispatched with a tag, creates the
// annotated tag at origin/main and pushes it; a second run with the tag at that commit passes, and a tag at another commit is
// never moved.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Stop } from '../../scripts/kit/process.mts';
import * as release from '../../scripts/kit/release.mts';
import { git, releaseSandbox } from './release-sandbox.mts';

test('release-tag creates the annotated tag at origin/main and pushes it, passes again, and never moves a tag (K269)', (t) => {
  const box = releaseSandbox(t);
  const remote = mkdtempSync(path.join(tmpdir(), 'kit-release-tag-'));
  t.after(() => rmSync(remote, { recursive: true, force: true }));
  git(remote, 'init', '--quiet', '--bare');
  git(box.root, 'remote', 'add', 'origin', remote);
  const ctx = release.context(box.root, { env: box.env });
  const main = git(box.root, 'rev-parse', 'origin/main');
  assert.equal(release.createTag(ctx, 'v0.0.1'), `created the tag v0.0.1 at ${main} and pushed it`);
  assert.equal(git(box.root, 'cat-file', '-t', 'refs/tags/v0.0.1'), 'tag');
  assert.match(git(remote, 'show-ref', '--tags'), /refs\/tags\/v0\.0\.1/);
  assert.equal(release.createTag(ctx, 'v0.0.1'), `the tag v0.0.1 is at ${main} already`);
  git(box.root, 'commit', '--quiet', '--allow-empty', '-m', 'next');
  git(box.root, 'update-ref', 'refs/remotes/origin/main', git(box.root, 'rev-parse', 'HEAD'));
  assert.throws(() => release.createTag(ctx, 'v0.0.1'), error => error instanceof Stop && /the tag v0\.0\.1 is at .* not at origin\/main .*; a published tag is never moved/.test(error.message));
});
