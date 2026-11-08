// Tests of the release by the id of a successful CI run (scripts/kit/release-run.mts, K749, K911, K924): release-tag reads the run,
// accepts only a completed successful push or dispatch run of a workflow of the repository whose commit is on origin/main, and tags that commit
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

const candidate = (overrides: Partial<CandidateRun> = {}): CandidateRun => ({ id: 91, workflow_id: 7, path: '.github/workflows/ci.yml@refs/heads/main', head_sha: 'a'.repeat(40), event: 'push', status: 'completed', conclusion: 'success', head_branch: 'main', ...overrides });

// The change log of a version-bump commit: ## Unreleased is empty above the section of the release.
const RELEASED = '# Changelog\n\n## Unreleased\n\n## 0.0.1\n\n- The first entry of 0.0.1.\n';

// The changelog rule of the fixture: release-tag refuses a commit whose ## Unreleased holds an entry (K1084).
const UNRELEASED_EMPTY = { changelogs: ['CHANGELOG.md'], changelogRules: ['unreleased-empty-at-release'] };

function runBox(t: Parameters<typeof releaseSandbox>[0], run: (commit: string) => CandidateRun, { changelog = RELEASED, documents = UNRELEASED_EMPTY as object | null } = {}) {
  const box = releaseSandbox(t, { changelog, mutate: root => { if (documents !== null) writeJson(root, 'config/documents.json', documents); } });
  const remote = path.join(box.root, '.stubs/remote.git');
  initRepository(remote, '--bare');
  git(box.root, 'remote', 'add', 'origin', remote);
  git(box.root, 'push', '--quiet', 'origin', 'main');
  const bin = path.join(box.root, '.stubs/bin');
  // The runs of a commit (K987) answer RELEASE_RUNS_RESPONSE, the statuses that --jq selects; one run answers RELEASE_RUN_RESPONSE.
  // The release of a tag answers RELEASE_TAG_RESPONSE, its draft field, and fails as gh does for no release when it is unset.
  writeFileSync(path.join(bin, 'gh'), '#!/usr/bin/env node\nconst tag = process.argv.some(arg => arg.includes("/releases/tags/"));\nif (tag && process.env.RELEASE_TAG_RESPONSE === undefined) process.exit(1);\nconsole.log(tag ? process.env.RELEASE_TAG_RESPONSE : process.argv.some(arg => arg.includes("/runs?")) ? (process.env.RELEASE_RUNS_RESPONSE ?? "[]") : (process.env.RELEASE_RUN_RESPONSE ?? "{}"));\n');
  chmodSync(path.join(bin, 'gh'), 0o755);
  return { box, remote, env: { ...box.env, GITHUB_REPOSITORY: 'polyspec/kit-fixture', RELEASE_RUN_RESPONSE: JSON.stringify(run(box.commit)) } };
}

const tagRun = (root: string, env: NodeJS.ProcessEnv, args = ['tag', '91']) => {
  const errors: string[] = [];
  const lines: string[] = [];
  const result = main(args, { root, env, print: text => lines.push(text), error: text => errors.push(text) });
  return { result, lines, errors };
};

test('the release accepts only a successful CI run of the commit (K749, K911)', () => {
  assert.doesNotThrow(() => validateCandidateRun(candidate(), 91));
  assert.doesNotThrow(() => validateCandidateRun(candidate({ event: 'workflow_dispatch' }), 91));
  assert.throws(() => validateCandidateRun(candidate({ conclusion: 'failure' }), 91), /conclusion failure/);
  assert.throws(() => validateCandidateRun(candidate({ conclusion: 'cancelled' }), 91), /conclusion cancelled/);
  assert.throws(() => validateCandidateRun(candidate({ status: 'in_progress', conclusion: null }), 91), /in_progress with conclusion missing/);
  assert.throws(() => validateCandidateRun(candidate({ id: 92 }), 91), /run id/);
  assert.throws(() => validateCandidateRun(candidate({ head_branch: 'feature', event: 'pull_request' }), 91), /not a supported CI run/);
  assert.throws(() => validateCandidateRun(candidate({ head_sha: 'main' }), 91), /not a full Git commit SHA/);
});

// K1059: the workflow of the CI run is the repository's own; the release requires no fixed workflow file.
test('the release takes a successful CI run of any workflow of the repository (K1059)', () => {
  assert.doesNotThrow(() => validateCandidateRun(candidate({ path: '.github/workflows/build.yml@refs/heads/main' }), 91));
  const source = readFileSync(new URL('../../scripts/kit/release-run.mts', import.meta.url), 'utf8');
  // The wait reads the runs of the workflow of the CI run alone: a run of another workflow, such as the release itself, starts no
  // later release, so waiting on it would leave the version unreleased.
  assert.match(source, /actions\/workflows\/\$\{workflowId\}\/runs\?head_sha=\$\{origin\}&branch=main/);
  assert.doesNotMatch(source, /actions\/runs\?head_sha/);
  // The run that GitHub returns carries the id of its workflow, which the wait names.
  assert.match(source, /--jq', '\{id,workflow_id,path,/);
  assert.doesNotMatch(source, /workflows\/ci\.yml/);
});

test('release-tag tags the commit of the successful run and of each Go module, and pushes the tags (K911)', (t) => {
  const { box, remote, env } = runBox(t, commit => candidate({ head_sha: commit }));
  const run = tagRun(box.root, env);
  assert.equal(run.result, 0, run.errors.join('\n'));
  assert.deepEqual(run.lines, [`[release-run] created the tag v0.0.1 at ${box.commit} and pushed it`, `[release-run] created the tag packages/fixture-go/v0.0.1 at ${box.commit} and pushed it`]);
  for (const tag of ['v0.0.1', 'packages/fixture-go/v0.0.1']) assert.equal(execFileSync('git', ['--git-dir', remote, 'rev-parse', `refs/tags/${tag}^{commit}`], { encoding: 'utf8' }).trim(), box.commit);
});

// K941: a release is newer than every release tag, so a version lower than the latest tag is refused before any tag is made.
test('release-tag refuses a version that is not greater than the latest release tag, and tags nothing (K941)', (t) => {
  const { box, remote, env } = runBox(t, commit => candidate({ head_sha: commit }));
  git(box.root, 'tag', 'v0.0.2', box.commit);
  git(box.root, 'push', '--quiet', 'origin', 'v0.0.2');
  const refused = tagRun(box.root, env);
  assert.equal(refused.result, 1);
  assert.match(refused.errors.join('\n'), /v0\.0\.1 is not greater than the latest release tag v0\.0\.2/);
  assert.equal(git(box.root, 'tag', '--list'), 'v0.0.2', 'the refused version is not tagged');
  assert.equal(spawnSync('git', ['--git-dir', remote, 'show-ref', '--verify', '--quiet', 'refs/tags/v0.0.1']).status, 1, 'the remote has no v0.0.1');
});

// K941: the order of the release tags, which the newest release tag of the repository sets; a prerelease tag is no release.
test('release-tag ignores a prerelease tag as the newest one, so the first release of its line is tagged (K941)', (t) => {
  const { box, env } = runBox(t, commit => candidate({ head_sha: commit }));
  git(box.root, 'tag', 'v0.0.3-rc1', box.commit);
  const run = tagRun(box.root, env);
  assert.equal(run.result, 0, run.errors.join('\n'));
  assert.equal(git(box.root, 'rev-parse', 'refs/tags/v0.0.1^{commit}'), box.commit);
});

test('release-tag tags the first release of a repository that has no release tag (K941)', (t) => {
  const { box, env } = runBox(t, commit => candidate({ head_sha: commit }));
  assert.equal(git(box.root, 'tag', '--list'), '', 'the repository has no tag');
  const run = tagRun(box.root, env);
  assert.equal(run.result, 0, run.errors.join('\n'));
});

test('release-tag passes a version whose tag already exists at the commit of the run, and tags only the Go module that lacks one (K941)', (t) => {
  const { box, env } = runBox(t, commit => candidate({ head_sha: commit }));
  git(box.root, 'tag', '-a', 'v0.0.1', '-m', 'v0.0.1', box.commit);
  const run = tagRun(box.root, env);
  assert.equal(run.result, 0, run.errors.join('\n'));
  assert.deepEqual(run.lines, [`[release-run] the tag v0.0.1 is at ${box.commit} already`, `[release-run] created the tag packages/fixture-go/v0.0.1 at ${box.commit} and pushed it`]);
});

test('release-tag orders the versions numerically, so v0.0.10 is greater than v0.0.9 (K941)', (t) => {
  const { box, env } = runBox(t, commit => candidate({ head_sha: commit }), { changelog: '# Changelog\n\n## Unreleased\n\n## 0.0.10\n\n- The first entry of 0.0.10.\n' });
  git(box.root, 'tag', 'v0.0.9', box.commit);
  const run = tagRun(box.root, env);
  assert.equal(run.result, 0, run.errors.join('\n'));
  assert.equal(git(box.root, 'rev-parse', 'refs/tags/v0.0.10^{commit}'), box.commit);
});

test('release-tag tags the successful branch CI commit after main moved on (K911)', (t) => {
  const { box, env } = runBox(t, commit => candidate({ head_sha: commit, head_branch: 'integration', event: 'workflow_dispatch', path: '.github/workflows/ci.yml@refs/heads/integration' }));
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

test('K1084: release-tag tags a commit whose ## Unreleased holds an entry where config/documents.json names no unreleased-empty-at-release', (t) => {
  const changelog = '# Changelog\n\n## Unreleased\n\n- A change after the release.\n\n## 0.0.1\n\n- The first entry of 0.0.1.\n';
  // No config/documents.json, and one that names no changelog rule.
  for (const documents of [null, { changelogs: ['CHANGELOG.md'] }]) {
    const { box, remote, env } = runBox(t, commit => candidate({ head_sha: commit }), { changelog, documents });
    const run = tagRun(box.root, env);
    assert.equal(run.result, 0, run.errors.join('\n'));
    assert.equal(execFileSync('git', ['--git-dir', remote, 'rev-parse', 'refs/tags/v0.0.1^{commit}'], { encoding: 'utf8' }).trim(), box.commit);
  }
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

test('release-tag refuses a failed run and a commit off main before any tag (K749, K911)', (t) => {
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

  assert.equal(tagRun(off.box.root, off.env, ['publish', '0.0.1', 'a'.repeat(40), '91']).result, 2, 'make release is gone; only prepare and tag remain');
});

test('K1102: release-tag judges the commit against the main ref that RELEASE_MAIN names, refuses with status 2 a call that names none, and takes a run whatever GITHUB_REPOSITORY holds', (t) => {
  const { box, remote, env } = runBox(t, () => candidate());
  git(box.root, 'checkout', '--quiet', '-b', 'trunk');
  git(box.root, 'commit', '--quiet', '--allow-empty', '-m', 'trunk');
  git(box.root, 'push', '--quiet', 'origin', 'trunk');
  const trunk = git(box.root, 'rev-parse', 'HEAD');
  const runEnv = { ...env, GITHUB_REPOSITORY: 'polyspec/another-repository', RELEASE_RUN_RESPONSE: JSON.stringify(candidate({ head_sha: trunk })) };
  const offMain = tagRun(box.root, runEnv);
  assert.equal(offMain.result, 1);
  assert.match(offMain.errors.join('\n'), /of CI run 91 is not on origin\/main/);
  // A call that names no main ref, unset or empty, is a usage error; kit fixes none.
  const { RELEASE_MAIN: _named, ...noMain } = runEnv;
  for (const unnamed of [noMain, { ...noMain, RELEASE_MAIN: '' }]) {
    const refused = tagRun(box.root, unnamed);
    assert.equal(refused.result, 2);
    assert.match(refused.errors.join('\n'), /tag needs the main ref; name it in RELEASE_MAIN/);
  }
  const { RELEASE_ASSETS: _assets, ...noAssets } = runEnv;
  assert.equal(tagRun(box.root, noAssets, ['prepare', '0.0.1']).result, 2, 'prepare needs the asset folder');
  const named = tagRun(box.root, { ...runEnv, RELEASE_MAIN: 'origin/trunk' });
  assert.equal(named.result, 0, named.errors.join('\n'));
  assert.equal(execFileSync('git', ['--git-dir', remote, 'rev-parse', 'refs/tags/v0.0.1^{commit}'], { encoding: 'utf8' }).trim(), trunk);
  const bare = tagRun(box.root, { ...runEnv, RELEASE_MAIN: 'trunk' });
  assert.equal(bare.result, 1);
  assert.match(bare.errors.join('\n'), /the main ref trunk is no remote-tracking ref <remote>\/<branch>/);
});

// K987: a green push run of CI starts the release by itself (release-tag --auto); only the version commit of the top ## X.Y.Z
// releases, a commit whose top version is tagged at another commit has nothing to release and ends green, and a top version that no
// run released, as when the run of its version commit was replaced or the version commit was not the tip of its push, fails and
// names the version commit.
test('release-tag --auto releases the version commit and hands the tag on, runs a release again that left no public release, and passes a second run after a public one (K987)', (t) => {
  const { box, env } = runBox(t, commit => candidate({ head_sha: commit }));
  const folder = mkdtempSync(path.join(tmpdir(), 'kit-release-env-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const githubEnv = path.join(folder, 'env');
  writeFileSync(githubEnv, '');
  const run = tagRun(box.root, { ...env, GITHUB_ENV: githubEnv }, ['tag', '91', '--auto']);
  assert.equal(run.result, 0, run.errors.join('\n'));
  assert.equal(git(box.root, 'rev-parse', 'refs/tags/v0.0.1^{commit}'), box.commit);
  assert.equal(readFileSync(githubEnv, 'utf8'), 'TAG=v0.0.1\nVERSION=0.0.1\n');
  // A re-run of a release that failed after its tag, with no release or a draft, runs the release again.
  for (const response of [undefined, 'true']) {
    writeFileSync(githubEnv, '');
    const rerun = tagRun(box.root, { ...env, GITHUB_ENV: githubEnv, ...(response === undefined ? {} : { RELEASE_TAG_RESPONSE: response }) }, ['tag', '91', '--auto']);
    assert.equal(rerun.result, 0, rerun.errors.join('\n'));
    assert.equal(readFileSync(githubEnv, 'utf8'), 'TAG=v0.0.1\nVERSION=0.0.1\n', `a release that is ${response === undefined ? 'missing' : 'a draft'} runs again`);
  }
  // A second green run after the release is public releases nothing: its publish would fail.
  writeFileSync(githubEnv, '');
  const again = tagRun(box.root, { ...env, GITHUB_ENV: githubEnv, RELEASE_TAG_RESPONSE: 'false' }, ['tag', '91', '--auto']);
  assert.equal(again.result, 0, again.errors.join('\n'));
  assert.match(again.lines.join('\n'), /nothing to release: v0\.0\.1 is the tag of [0-9a-f]{40} and its release is public already/);
  assert.equal(readFileSync(githubEnv, 'utf8'), '');
});

test('release-tag --auto ends green with nothing to release for a commit whose top version is tagged at another commit (K987)', (t) => {
  const { box, env } = runBox(t, commit => candidate({ head_sha: commit }));
  assert.equal(tagRun(box.root, env, ['tag', '91', '--auto']).result, 0);
  writeFileSync(path.join(box.root, 'CHANGELOG.md'), readFileSync(path.join(box.root, 'CHANGELOG.md'), 'utf8').replace('## Unreleased\n', '## Unreleased\n\n- A change after the release.\n'));
  git(box.root, 'commit', '--quiet', '-am', 'an ordinary change');
  git(box.root, 'push', '--quiet', 'origin', 'main');
  const head = git(box.root, 'rev-parse', 'HEAD');
  const folder = mkdtempSync(path.join(tmpdir(), 'kit-release-env-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const githubEnv = path.join(folder, 'env');
  writeFileSync(githubEnv, '');
  const run = tagRun(box.root, { ...env, GITHUB_ENV: githubEnv, RELEASE_RUN_RESPONSE: JSON.stringify(candidate({ head_sha: head })) }, ['tag', '91', '--auto']);
  assert.equal(run.result, 0, run.errors.join('\n'));
  assert.match(run.lines.join('\n'), new RegExp(`nothing to release: v0\\.0\\.1, the top version of CHANGELOG\\.md at ${head}, is the tag of ${box.commit}`));
  assert.equal(readFileSync(githubEnv, 'utf8'), '', 'no tag is handed to the next steps');
});

// K988, K990: a top version that no run of its version commit released is released by a later green commit whose ## Unreleased is
// empty, at once, even while the CI of the version commit still runs; a later commit with unreleased entries waits for that CI
// while it runs, and fails naming the version commit once it ended without a release.
test('release-tag --auto releases an unreleased version at once at a later green commit with an empty ## Unreleased, and waits or fails for one with entries (K988, K990)', (t) => {
  for (const later of ['a fix after a version commit whose CI still runs', 'an ordinary change after an unreleased version']) {
    const { box, env } = runBox(t, commit => candidate({ head_sha: commit }));
    if (later.startsWith('a fix')) git(box.root, 'commit', '--quiet', '--allow-empty', '-m', later);
    else {
      writeFileSync(path.join(box.root, 'CHANGELOG.md'), readFileSync(path.join(box.root, 'CHANGELOG.md'), 'utf8').replace('## Unreleased\n', '## Unreleased\n\n- A change.\n'));
      git(box.root, 'commit', '--quiet', '-am', later);
    }
    git(box.root, 'push', '--quiet', 'origin', 'main');
    const head = git(box.root, 'rev-parse', 'HEAD');
    const headEnv = { ...env, RELEASE_RUN_RESPONSE: JSON.stringify(candidate({ head_sha: head })) };
    const running = tagRun(box.root, { ...headEnv, RELEASE_RUNS_RESPONSE: '["in_progress"]' }, ['tag', '91', '--auto']);
    assert.equal(running.result, 0, running.errors.join('\n'));
    if (later.startsWith('a fix')) {
      assert.equal(git(box.root, 'rev-parse', 'refs/tags/v0.0.1^{commit}'), head, 'the later green commit carries the version at once');
      continue;
    }
    assert.match(running.lines.join('\n'), new RegExp(`nothing to release: v0\\.0\\.1 waits for the CI run of its version commit ${box.commit}`), later);
    const ended = tagRun(box.root, { ...headEnv, RELEASE_RUNS_RESPONSE: '["completed"]' }, ['tag', '91', '--auto']);
    assert.equal(ended.result, 1, later);
    assert.match(ended.errors.join('\n'), new RegExp(`v0\\.0\\.1 is not released: no CI run of its version commit ${box.commit} released it, and CHANGELOG\\.md at ${head} has entries under ## Unreleased`), later);
    assert.equal(git(box.root, 'tag', '--list'), '', later);
  }
});

test('release-tag --auto fails for a version commit with unreleased entries or a version tagged off its line, and passes a change log without a version (K987)', (t) => {
  const entries = runBox(t, commit => candidate({ head_sha: commit }), { changelog: '# Changelog\n\n## Unreleased\n\n- A change.\n\n## 0.0.1\n\n- The first entry of 0.0.1.\n' });
  const refused = tagRun(entries.box.root, entries.env, ['tag', '91', '--auto']);
  assert.equal(refused.result, 1);
  assert.match(refused.errors.join('\n'), /v0\.0\.1 is not released: CHANGELOG\.md at [0-9a-f]{40} has entries under ## Unreleased/);
  const unversioned = runBox(t, commit => candidate({ head_sha: commit }), { changelog: '# Changelog\n\n## Unreleased\n\n- A change.\n' });
  const none = tagRun(unversioned.box.root, unversioned.env, ['tag', '91', '--auto']);
  assert.equal(none.result, 0, none.errors.join('\n'));
  assert.match(none.lines.join('\n'), /nothing to release: CHANGELOG\.md at [0-9a-f]{40} has no section ## X\.Y\.Z/);
  const off = runBox(t, commit => candidate({ head_sha: commit }));
  git(off.box.root, 'checkout', '--quiet', '--orphan', 'side');
  git(off.box.root, 'commit', '--quiet', '--allow-empty', '-m', 'side');
  git(off.box.root, 'tag', 'v0.0.1');
  git(off.box.root, 'checkout', '--quiet', 'main');
  const elsewhere = tagRun(off.box.root, off.env, ['tag', '91', '--auto']);
  assert.equal(elsewhere.result, 1);
  // A tag on a later commit of the line, as a dispatch of a later green run gives, released the version.
  const later = runBox(t, commit => candidate({ head_sha: commit }));
  git(later.box.root, 'commit', '--quiet', '--allow-empty', '-m', 'later');
  git(later.box.root, 'tag', 'v0.0.1');
  const descendant = tagRun(later.box.root, later.env, ['tag', '91', '--auto']);
  assert.equal(descendant.result, 0, descendant.errors.join('\n'));
  assert.match(descendant.lines.join('\n'), /nothing to release: v0\.0\.1, the top version of CHANGELOG\.md at [0-9a-f]{40}, is the tag of/);
  assert.match(elsewhere.errors.join('\n'), /v0\.0\.1, the top version of CHANGELOG\.md at [0-9a-f]{40}, is the tag of [0-9a-f]{40}, which is not on the line of/);
});
