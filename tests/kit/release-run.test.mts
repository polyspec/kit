// Tests of the release by the id of a successful CI run (scripts/kit/release-run.mts, K749, K911, K924): release-tag reads the run,
// accepts only a completed successful push or dispatch run of ci.yml on main whose commit is on origin/main, and tags that commit
// with the version of the newest section ## X.Y.Z of the change log of that commit, which the version-bump commit wrote.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { main, validateCandidateRun, type CandidateRun } from '../../scripts/kit/release-run.mts';
import { git, readJson, releaseSandbox, writeJson } from './release-sandbox.mts';
import { initRepository } from './sandbox-repository.mts';

const candidate = (overrides: Partial<CandidateRun> = {}): CandidateRun => ({ id: 91, path: '.github/workflows/ci.yml@refs/heads/main', head_sha: 'a'.repeat(40), event: 'push', status: 'completed', conclusion: 'success', head_branch: 'main', ...overrides });

// The change log of a version-bump commit: ## Unreleased is empty above the section of the release.
const RELEASED = '# Changelog\n\n## Unreleased\n\n## 0.0.1\n\n- The first entry of 0.0.1.\n';

function runBox(t: Parameters<typeof releaseSandbox>[0], run: (commit: string) => CandidateRun, { changelog = RELEASED } = {}) {
  const box = releaseSandbox(t, { changelog });
  const remote = path.join(box.root, '.stubs/remote.git');
  initRepository(remote, '--bare');
  git(box.root, 'remote', 'add', 'origin', remote);
  git(box.root, 'push', '--quiet', 'origin', 'main');
  const bin = path.join(box.root, '.stubs/bin');
  writeFileSync(path.join(bin, 'gh'), '#!/usr/bin/env node\nconsole.log(process.env.RELEASE_RUN_RESPONSE ?? "{}");\n');
  chmodSync(path.join(bin, 'gh'), 0o755);
  return { box, remote, env: { ...box.env, GITHUB_REPOSITORY: 'polyspec/kit-fixture', RELEASE_RUN_RESPONSE: JSON.stringify(run(box.commit)) } };
}

const tagRun = (root: string, env: NodeJS.ProcessEnv, args = ['tag', '91']) => {
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

test('release-tag takes the version from the newest section of the change log at the commit of the run, never from an input, and hands the tag to the next steps (K924)', (t) => {
  const { box, env } = runBox(t, commit => candidate({ head_sha: commit }));
  // A later commit of main names the next version; the release still tags the run's commit with its own section.
  writeFileSync(path.join(box.root, 'CHANGELOG.md'), readFileSync(path.join(box.root, 'CHANGELOG.md'), 'utf8').replace('## 0.0.1', '## 0.0.2\n\n- Later.\n\n## 0.0.1'));
  git(box.root, 'commit', '--quiet', '-am', 'later');
  git(box.root, 'push', '--quiet', 'origin', 'main');
  const folder = mkdtempSync(path.join(tmpdir(), 'kit-release-env-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const githubEnv = path.join(folder, 'env');
  writeFileSync(githubEnv, '');
  const run = tagRun(box.root, { ...env, GITHUB_ENV: githubEnv });
  assert.equal(run.result, 0, run.errors.join('\n'));
  assert.equal(git(box.root, 'rev-parse', 'refs/tags/v0.0.1^{commit}'), box.commit);
  assert.equal(git(box.root, 'tag', '--list', 'v0.0.2'), '');
  assert.equal(readFileSync(githubEnv, 'utf8'), 'TAG=v0.0.1\nVERSION=0.0.1\n');
  assert.equal(tagRun(box.root, env, ['tag', '0.0.9', '91']).result, 2, 'release-tag takes no version');
});

test('release-tag refuses a commit whose change log names no released section, and tags nothing (K924)', (t) => {
  const box = runBox(t, commit => candidate({ head_sha: commit }));
  const { root } = box.box;
  writeFileSync(path.join(root, 'CHANGELOG.md'), '# Changelog\n\n## Unreleased\n\n- A change.\n');
  git(root, 'commit', '--quiet', '-am', 'unreleased only');
  git(root, 'push', '--quiet', 'origin', 'main');
  const head = git(root, 'rev-parse', 'HEAD');
  const refused = tagRun(root, { ...box.env, RELEASE_RUN_RESPONSE: JSON.stringify(candidate({ head_sha: head })) });
  assert.equal(refused.result, 1);
  assert.match(refused.errors.join('\n'), /CHANGELOG\.md at [0-9a-f]{40} has no section ## X\.Y\.Z/);
  assert.equal(git(root, 'tag', '--list'), '');
});

test('release-tag refuses a commit whose change log has entries under ## Unreleased, and tags nothing (K924)', (t) => {
  // The change log holds an entry under ## Unreleased: a change after the version bump that the release would miss.
  const { box, remote, env } = runBox(t, commit => candidate({ head_sha: commit }), { changelog: '# Changelog\n\n## Unreleased\n\n- A change after the release.\n\n## 0.0.1\n\n- The first entry of 0.0.1.\n' });
  const refused = tagRun(box.root, env);
  assert.equal(refused.result, 1);
  assert.match(refused.errors.join('\n'), /CHANGELOG\.md at [0-9a-f]{40} has unreleased entries/);
  assert.equal(git(box.root, 'tag', '--list'), '');
  assert.equal(spawnSync('git', ['--git-dir', remote, 'show-ref', '--tags', '--quiet']).status, 1, 'the remote has no tag');
});

test('release-tag reads config/release.json of the commit of the run, so its change log and Go modules are those of the tagged tree (K924)', (t) => {
  const { box, env } = runBox(t, commit => candidate({ head_sha: commit }));
  // main renames the change log and drops the Go module after the run's commit; the run's commit still names CHANGELOG.md.
  writeJson(box.root, 'config/release.json', { ...readJson<object>(box.root, 'config/release.json'), changelog: 'HISTORY.md', goModules: {} });
  git(box.root, 'mv', 'CHANGELOG.md', 'HISTORY.md');
  git(box.root, 'commit', '--quiet', '-am', 'rename the change log');
  git(box.root, 'push', '--quiet', 'origin', 'main');
  const run = tagRun(box.root, env);
  assert.equal(run.result, 0, run.errors.join('\n'));
  assert.equal(git(box.root, 'rev-parse', 'refs/tags/packages/fixture-go/v0.0.1^{commit}'), box.commit);
});

test('release-tag reads only the change log and the Go modules of config/release.json at the commit of the run, so a field that the kit of main no longer knows does not refuse an earlier commit (K924)', (t) => {
  const { box, env } = runBox(t, commit => candidate({ head_sha: commit }));
  // The run's commit declares a field that a later kit dropped; the steps after release-tag read it with the kit of the tag.
  writeJson(box.root, 'config/release.json', { ...readJson<object>(box.root, 'config/release.json'), checks: ['make check'] });
  git(box.root, 'commit', '--quiet', '-am', 'a field of an earlier kit');
  git(box.root, 'push', '--quiet', 'origin', 'main');
  const head = git(box.root, 'rev-parse', 'HEAD');
  git(box.root, 'revert', '--no-edit', 'HEAD');
  git(box.root, 'push', '--quiet', 'origin', 'main');
  const run = tagRun(box.root, { ...env, RELEASE_RUN_RESPONSE: JSON.stringify(candidate({ head_sha: head })) });
  assert.equal(run.result, 0, run.errors.join('\n'));
  assert.equal(git(box.root, 'rev-parse', 'refs/tags/v0.0.1^{commit}'), head);
});

test('release-tag refuses a failed run, a commit off main and another repository before any tag (K749, K911)', (t) => {
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
  assert.equal(tagRun(off.box.root, off.env, ['publish', '0.0.1', 'a'.repeat(40), '91']).result, 2, 'make release is gone; only prepare and tag remain');
});
