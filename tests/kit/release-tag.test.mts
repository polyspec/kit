// Tests of the tags of a release (scripts/kit/release.mts `createTags`, K269, K911): the release workflow creates the annotated
// tag vX.Y.Z and the tag <directory>/vX.Y.Z of every Go module at the commit of a successful CI run and pushes them; a second run
// with the tags at that commit passes, and a tag at another commit is never moved.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Stop } from '../../scripts/kit/process.mts';
import * as release from '../../scripts/kit/release.mts';
import { git, releaseSandbox } from './release-sandbox.mts';
import { initRepository } from './sandbox-repository.mts';

function remoteBox(t: Parameters<typeof releaseSandbox>[0], options: Parameters<typeof releaseSandbox>[1] = {}) {
  const box = releaseSandbox(t, options);
  const remote = mkdtempSync(path.join(tmpdir(), 'kit-release-tag-'));
  t.after(() => rmSync(remote, { recursive: true, force: true }));
  initRepository(remote, '--bare');
  git(box.root, 'remote', 'add', 'origin', remote);
  return { box, remote };
}

test('release-tag creates the annotated tags of the version and of each Go module at the commit, pushes them, passes again, and never moves a tag (K269, K911)', (t) => {
  const { box, remote } = remoteBox(t);
  const ctx = release.context(box.root, { env: box.env });
  const commit = box.commit;
  assert.deepEqual(release.createTags(ctx, '0.0.1', commit), [
    `created the tag v0.0.1 at ${commit} and pushed it`,
    `created the tag packages/fixture-go/v0.0.1 at ${commit} and pushed it`,
  ]);
  for (const tag of ['v0.0.1', 'packages/fixture-go/v0.0.1']) {
    assert.equal(git(box.root, 'cat-file', '-t', `refs/tags/${tag}`), 'tag', `${tag} is annotated`);
    assert.equal(git(remote, 'rev-parse', `refs/tags/${tag}^{commit}`), commit, `${tag} is pushed at the commit`);
  }
  assert.deepEqual(release.createTags(ctx, '0.0.1', commit), [`the tag v0.0.1 is at ${commit} already`, `the tag packages/fixture-go/v0.0.1 is at ${commit} already`]);
  git(box.root, 'commit', '--quiet', '--allow-empty', '-m', 'next');
  const next = git(box.root, 'rev-parse', 'HEAD');
  assert.throws(() => release.createTags(ctx, '0.0.1', next), error => error instanceof Stop && /the tag v0\.0\.1 is at [0-9a-f]{40}, not at [0-9a-f]{40}; a published tag is never moved/.test(error.message));
  git(box.root, 'tag', '-d', 'v0.0.1');
  assert.throws(() => release.createTags(ctx, '0.0.1', next), /the tag packages\/fixture-go\/v0\.0\.1 is at/, 'a module tag elsewhere stops before any tag is created');
  assert.equal(git(box.root, 'tag', '--list', 'v0.0.1'), '');
});

test('release-tag refuses a lightweight tag at the commit, since a release tag is annotated (K911)', (t) => {
  const { box } = remoteBox(t);
  const ctx = release.context(box.root, { env: box.env });
  git(box.root, 'tag', 'v0.0.1', box.commit);
  assert.throws(() => release.createTags(ctx, '0.0.1', box.commit), error => error instanceof Stop && /the tag v0\.0\.1 is a lightweight tag \(commit\); a release tag is annotated/.test(error.message));
  assert.equal(git(box.root, 'tag', '--list', 'packages/fixture-go/v0.0.1'), '', 'no tag is created');
});

// K825: the state of a checklist row is a record; the CI run of the commit proves a release, so a [v] row blocks no tag.
test('release-tag creates the tags while a checklist row is in [v] (K825)', (t) => {
  const { box } = remoteBox(t, { mutate(root) {
    for (const file of ['docs/plans/work/checklist.md', 'docs/plans/work/checklist.ko.md']) {
      writeFileSync(path.join(root, file), readFileSync(path.join(root, file), 'utf8').replace('| [o] |', '| [v] |'));
    }
  } });
  assert.match(readFileSync(path.join(box.root, 'docs/plans/work/checklist.md'), 'utf8'), /\| \[v\] \|/);
  assert.equal(release.createTags(release.context(box.root, { env: box.env }), '0.0.1', box.commit)[0], `created the tag v0.0.1 at ${box.commit} and pushed it`);
});
