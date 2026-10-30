// Tests of the release by the id of a successful CI run (scripts/kit/release-run.mts, K749, K911): release-tag reads the run,
// accepts only a completed successful push or dispatch run of ci.yml on main whose commit is on origin/main, and tags that commit.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { main, validateCandidateRun, type CandidateRun } from '../../scripts/kit/release-run.mts';
import { git, releaseSandbox } from './release-sandbox.mts';
import { initRepository } from './sandbox-repository.mts';

const candidate = (overrides: Partial<CandidateRun> = {}): CandidateRun => ({ id: 91, path: '.github/workflows/ci.yml@refs/heads/main', head_sha: 'a'.repeat(40), event: 'push', status: 'completed', conclusion: 'success', head_branch: 'main', ...overrides });

function runBox(t: Parameters<typeof releaseSandbox>[0], run: (commit: string) => CandidateRun) {
  const box = releaseSandbox(t);
  const remote = path.join(box.root, '.stubs/remote.git');
  initRepository(remote, '--bare');
  git(box.root, 'remote', 'add', 'origin', remote);
  git(box.root, 'push', '--quiet', 'origin', 'main');
  const bin = path.join(box.root, '.stubs/bin');
  writeFileSync(path.join(bin, 'gh'), '#!/usr/bin/env node\nconsole.log(process.env.RELEASE_RUN_RESPONSE ?? "{}");\n');
  chmodSync(path.join(bin, 'gh'), 0o755);
  return { box, remote, env: { ...box.env, GITHUB_REPOSITORY: 'polyspec/kit-fixture', RELEASE_RUN_RESPONSE: JSON.stringify(run(box.commit)) } };
}

const tagRun = (root: string, env: NodeJS.ProcessEnv, args = ['tag', '0.0.1', '91']) => {
  const errors: string[] = [];
  const lines: string[] = [];
  const result = main(args, { root, env, print: text => lines.push(text), error: text => errors.push(text) });
  return { result, lines, errors };
};

test('the release accepts only its successful CI run of ci.yml on main (K749, K911)', () => {
  assert.doesNotThrow(() => validateCandidateRun(candidate(), 91));
  assert.doesNotThrow(() => validateCandidateRun(candidate({ event: 'workflow_dispatch' }), 91));
  assert.throws(() => validateCandidateRun(candidate({ conclusion: 'failure' }), 91), /conclusion failure/);
  assert.throws(() => validateCandidateRun(candidate({ conclusion: 'cancelled' }), 91), /conclusion cancelled/);
  assert.throws(() => validateCandidateRun(candidate({ status: 'in_progress', conclusion: null }), 91), /in_progress with conclusion missing/);
  assert.throws(() => validateCandidateRun(candidate({ id: 92 }), 91), /run id/);
  assert.throws(() => validateCandidateRun(candidate({ path: '.github/workflows/other.yml@refs/heads/main' }), 91), /workflow/);
  assert.throws(() => validateCandidateRun(candidate({ head_branch: 'feature', event: 'pull_request' }), 91), /not a supported CI run on main/);
  assert.throws(() => validateCandidateRun(candidate({ head_sha: 'main' }), 91), /not a full Git commit SHA/);
});

test('release-tag tags the commit of the successful run and of each Go module, and pushes the tags (K911)', (t) => {
  const { box, remote, env } = runBox(t, commit => candidate({ head_sha: commit }));
  const run = tagRun(box.root, env);
  assert.equal(run.result, 0, run.errors.join('\n'));
  assert.deepEqual(run.lines, [`[release-run] created the tag v0.0.1 at ${box.commit} and pushed it`, `[release-run] created the tag packages/fixture-go/v0.0.1 at ${box.commit} and pushed it`]);
  for (const tag of ['v0.0.1', 'packages/fixture-go/v0.0.1']) assert.equal(execFileSync('git', ['--git-dir', remote, 'rev-parse', `refs/tags/${tag}^{commit}`], { encoding: 'utf8' }).trim(), box.commit);
});

test('release-tag tags an earlier commit of main whose run passed, after main moved on (K911)', (t) => {
  const { box, env } = runBox(t, commit => candidate({ head_sha: commit }));
  git(box.root, 'commit', '--quiet', '--allow-empty', '-m', 'later');
  git(box.root, 'push', '--quiet', 'origin', 'main');
  const run = tagRun(box.root, env);
  assert.equal(run.result, 0, run.errors.join('\n'));
  assert.equal(git(box.root, 'rev-parse', 'refs/tags/v0.0.1^{commit}'), box.commit);
});

test('release-tag refuses a failed run, a commit off main, another repository and a malformed version before any tag (K749, K911)', (t) => {
  const failed = runBox(t, commit => candidate({ head_sha: commit, conclusion: 'failure' }));
  const refused = tagRun(failed.box.root, failed.env);
  assert.equal(refused.result, 1);
  assert.match(refused.errors.join('\n'), /not completed successfully/);
  assert.equal(git(failed.box.root, 'tag', '--list'), '');
  assert.equal(spawnSync('git', ['--git-dir', failed.remote, 'show-ref', '--tags', '--quiet']).status, 1, 'the remote has no tag');

  const off = runBox(t, () => candidate());
  git(off.box.root, 'checkout', '--quiet', '-b', 'side');
  git(off.box.root, 'commit', '--quiet', '--allow-empty', '-m', 'side');
  const side = git(off.box.root, 'rev-parse', 'HEAD');
  const offMain = tagRun(off.box.root, { ...off.env, RELEASE_RUN_RESPONSE: JSON.stringify(candidate({ head_sha: side })) });
  assert.equal(offMain.result, 1);
  assert.match(offMain.errors.join('\n'), /the commit [0-9a-f]{40} of CI run 91 is not on origin\/main/);
  assert.equal(git(off.box.root, 'tag', '--list'), '');

  const other = tagRun(off.box.root, { ...off.env, GITHUB_REPOSITORY: 'polyspec/another-repository' });
  assert.equal(other.result, 1);
  assert.match(other.errors.join('\n'), /does not match config\/release\.json repository/);
  const version = tagRun(off.box.root, off.env, ['tag', 'v0.0.1', '91']);
  assert.equal(version.result, 1);
  assert.match(version.errors.join('\n'), /version "v0\.0\.1" is not X\.Y\.Z/);
  assert.equal(tagRun(off.box.root, off.env, ['publish', '0.0.1', 'a'.repeat(40), '91']).result, 2, 'make release is gone; only prepare and tag remain');
});
