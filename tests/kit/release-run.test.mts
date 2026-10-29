import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { main, validateCandidateRun, type CandidateRun } from '../../scripts/kit/release-run.mts';
import { git, releaseSandbox } from './release-sandbox.mts';
import { initRepository } from './sandbox-repository.mts';

const candidate = (overrides: Partial<CandidateRun> = {}): CandidateRun => ({ id: 91, path: '.github/workflows/ci.yml@refs/heads/main', head_sha: 'a'.repeat(40), event: 'push', status: 'completed', conclusion: 'success', head_branch: 'main', ...overrides });

function publishBox(t: Parameters<typeof releaseSandbox>[0], run: CandidateRun) {
  const box = releaseSandbox(t);
  const remote = path.join(box.root, '.stubs/remote.git');
  initRepository(remote, '--bare');
  git(box.root, 'remote', 'add', 'origin', remote);
  git(box.root, 'push', 'origin', 'main');
  git(box.root, 'update-ref', 'refs/remotes/origin/main', box.commit);
  const bin = path.join(box.root, '.stubs/bin');
  writeFileSync(path.join(bin, 'gh'), '#!/usr/bin/env node\nconsole.log(process.env.RELEASE_RUN_RESPONSE ?? "{}");\n');
  chmodSync(path.join(bin, 'gh'), 0o755);
  return { box, remote, env: { ...box.env, GITHUB_REPOSITORY: 'polyspec/kit-fixture', RELEASE_RUN_RESPONSE: JSON.stringify(run) } };
}

const publishCandidate = (root: string, env: NodeJS.ProcessEnv, sha: string) => {
  const errors: string[] = [];
  const result = main(['publish', '0.0.1', sha, '91'], { root, env, print: () => {}, error: text => errors.push(text) });
  return { result, errors };
};

test('candidate CI accepts only its exact successful main CI run (K749)', () => {
  assert.doesNotThrow(() => validateCandidateRun(candidate(), 'a'.repeat(40), 91));
  assert.doesNotThrow(() => validateCandidateRun(candidate({ event: 'workflow_dispatch' }), 'a'.repeat(40), 91));
});

test('candidate CI rejects a failed, cancelled, missing or mismatched run before tag publication (K749)', () => {
  assert.throws(() => validateCandidateRun(candidate({ conclusion: 'failure' }), 'a'.repeat(40), 91), /conclusion failure/);
  assert.throws(() => validateCandidateRun(candidate({ conclusion: 'cancelled' }), 'a'.repeat(40), 91), /conclusion cancelled/);
  assert.throws(() => validateCandidateRun(candidate({ head_sha: 'b'.repeat(40) }), 'a'.repeat(40), 91), /head SHA/);
  assert.throws(() => validateCandidateRun(candidate({ id: 92 }), 'a'.repeat(40), 91), /run id/);
  assert.throws(() => validateCandidateRun(candidate({ path: '.github/workflows/other.yml@refs/heads/main' }), 'a'.repeat(40), 91), /workflow/);
});

test('publish tags the exact commit only after its successful CI run on origin/main (K749)', (t) => {
  const runInfo = candidate({ head_sha: '0'.repeat(40) });
  const { box, remote, env } = publishBox(t, runInfo);
  const result = publishCandidate(box.root, { ...env, GITHUB_REPOSITORY: undefined, RELEASE_RUN_RESPONSE: JSON.stringify({ ...runInfo, head_sha: box.commit }) }, box.commit);
  assert.equal(result.result, 0, result.errors.join('\n'));
  assert.equal(git(box.root, 'cat-file', '-t', 'refs/tags/v0.0.1'), 'tag');
  assert.equal(git(box.root, 'rev-parse', 'refs/tags/v0.0.1^{commit}'), box.commit);
  const remoteTag = execFileSync('git', ['--git-dir', remote, 'rev-parse', 'refs/tags/v0.0.1^{commit}'], { encoding: 'utf8' }).trim();
  assert.equal(remoteTag, box.commit);
});

test('publish rejects a repository identity that conflicts with release configuration (K749)', (t) => {
  const runInfo = candidate({ head_sha: '0'.repeat(40) });
  const { box, env } = publishBox(t, runInfo);
  const result = publishCandidate(box.root, { ...env, GITHUB_REPOSITORY: 'polyspec/another-repository', RELEASE_RUN_RESPONSE: JSON.stringify({ ...runInfo, head_sha: box.commit }) }, box.commit);
  assert.equal(result.result, 1);
  assert.match(result.errors.join('\n'), /does not match config\/release\.json repository/);
  assert.equal(git(box.root, 'tag', '--list', 'v0.0.1'), '');
});

test('publish refuses failed or mismatched CI before creating or pushing a tag (K749)', (t) => {
  const failed = candidate({ head_sha: '0'.repeat(40), conclusion: 'failure' });
  const failure = publishBox(t, failed);
  const failedResult = publishCandidate(failure.box.root, { ...failure.env, RELEASE_RUN_RESPONSE: JSON.stringify({ ...failed, head_sha: failure.box.commit }) }, failure.box.commit);
  assert.equal(failedResult.result, 1);
  assert.match(failedResult.errors.join('\n'), /not completed successfully/);
  assert.equal(git(failure.box.root, 'tag', '--list', 'v0.0.1'), '');

  const mismatch = candidate({ head_sha: 'b'.repeat(40) });
  const other = publishBox(t, mismatch);
  const mismatchResult = publishCandidate(other.box.root, other.env, other.box.commit);
  assert.equal(mismatchResult.result, 1);
  assert.match(mismatchResult.errors.join('\n'), /does not match candidate/);
  assert.equal(git(other.box.root, 'tag', '--list', 'v0.0.1'), '');
  assert.equal(spawnSync('git', ['--git-dir', other.remote, 'show-ref', '--verify', '--quiet', 'refs/tags/v0.0.1']).status, 1);
});
