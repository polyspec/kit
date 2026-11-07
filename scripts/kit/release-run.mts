#!/usr/bin/env node
import { isMain, repositoryRoot } from './paths.mts';
import { appendFileSync } from 'node:fs';
import semver from 'semver';
import { candidateAssets, CONFIG, context, createTags, hasUnreleasedEntries, MAIN, newestReleaseTag, parseTag, releasedVersion, taggedRelease, topVersion, type CommandOptions, type Context } from './release.mts';
import { repositoryParts } from './github-release.mts';
import { execute, run, Stop } from './process.mts';

export type CandidateRun = { id: number; path: string; head_sha: string; event: string; status: string; conclusion: string | null; head_branch: string };

const VERSION = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;

/** Require the successful CI workflow run `id`: its head_sha is the commit that the release tags (K911). */
export function validateCandidateRun(runInfo: CandidateRun, id: number): void {
  if (runInfo.id !== id) throw new Stop(`CI run id ${runInfo.id} does not match requested run ${id}`);
  if (!/^[0-9a-f]{40}$/.test(runInfo.head_sha)) throw new Stop(`CI run ${id} names the head SHA ${JSON.stringify(runInfo.head_sha)}, not a full Git commit SHA`);
  if (runInfo.path.replace(/@.*$/, '') !== '.github/workflows/ci.yml') throw new Stop(`CI run ${id} used workflow ${runInfo.path}, not .github/workflows/ci.yml`);
  if (!['push', 'workflow_dispatch'].includes(runInfo.event)) throw new Stop(`CI run ${id} is ${runInfo.event} on ${runInfo.head_branch}, not a supported CI run`);
  if (runInfo.status !== 'completed' || runInfo.conclusion !== 'success') throw new Stop(`CI run ${id} is ${runInfo.status} with conclusion ${runInfo.conclusion ?? 'missing'}, not completed successfully`);
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function parseCandidateRun(output: string): CandidateRun {
  let value: unknown;
  try {
    value = JSON.parse(output);
  } catch (error) {
    throw new Stop(`GitHub returned invalid CI run JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isRecord(value)) throw new Stop('GitHub returned no CI run object');
  const runInfo = value;
  if (typeof runInfo.id !== 'number' || typeof runInfo.path !== 'string' || typeof runInfo.head_sha !== 'string' || typeof runInfo.event !== 'string' || typeof runInfo.status !== 'string' || !(runInfo.conclusion === null || typeof runInfo.conclusion === 'string') || typeof runInfo.head_branch !== 'string') {
    throw new Stop('GitHub CI run response is missing a required field: id, path, head_sha, event, status, conclusion or head_branch');
  }
  return { id: runInfo.id, path: runInfo.path, head_sha: runInfo.head_sha, event: runInfo.event, status: runInfo.status, conclusion: runInfo.conclusion, head_branch: runInfo.head_branch };
}

/** The tagless candidate assets of VERSION built from the committed HEAD (`release-run prepare VERSION`), and that commit. */
export function prepare(ctx: Context, version: string): { sha: string; assets: string[] } {
  if (!VERSION.test(version)) throw new Stop(`version ${JSON.stringify(version)} is not X.Y.Z`);
  const assets = candidateAssets(ctx, version);
  const sha = run('git', ['rev-parse', '--verify', 'HEAD^{commit}'], { cwd: ctx.root, env: ctx.env }).trim();
  return { sha, assets };
}

/**
 * The release tags at the commit of the successful CI run `runId` (`make release-tag RUN`, K911, K924): the run is a completed
 * successful push or workflow_dispatch run of .github/workflows/ci.yml, its commit is on origin/main, the version is the
 * newest section ## X.Y.Z of the change log of that commit, whose ## Unreleased holds no entry, and createTags puts vX.Y.Z and the
 * tag of every Go module that config/release.json of that commit declares there. Returns the version and what it did per tag.
 *
 * With `auto`, the run started the release by itself, as the workflow_run of a green push run of CI does (K987), so the commit
 * releases when it is the version commit of the top ## X.Y.Z of its change log: a commit whose top version is tagged on its line
 * has nothing to release; a top version that no run of its version commit released, as when that CI failed, still runs or was replaced or
 * the version commit was not the tip of its push, is released at once by a later green commit whose ## Unreleased is empty (K988,
 * K990), and one with unreleased entries waits while the CI of the version commit runs, then fails and names the version commit, since a version that never releases is no state to pass over.
 */
export function tagRun(ctx: Context, runId: number, auto = false): { version: string; lines: string[]; release: boolean } {
  if (!Number.isSafeInteger(runId) || runId < 1) throw new Stop(`CI run id ${runId} is not a positive integer`);
  const { repo } = repositoryParts(ctx.config.repositoryUrl);
  const repository = ctx.env.GITHUB_REPOSITORY;
  if (repository && repository.toLowerCase() !== repo.toLowerCase()) throw new Stop(`GITHUB_REPOSITORY ${repository} does not match config/release.json repository ${repo}`);
  const output = run('gh', ['api', `repos/${repo}/actions/runs/${runId}`, '--jq', '{id,path,head_sha,event,status,conclusion,head_branch}'], { cwd: ctx.root, env: ctx.env });
  const runInfo = parseCandidateRun(output);
  validateCandidateRun(runInfo, runId);
  const commit = runInfo.head_sha;
  run('git', ['fetch', '--no-tags', 'origin', 'refs/heads/main:refs/remotes/origin/main'], { cwd: ctx.root, env: ctx.env });
  const ancestry = execute('git', ['merge-base', '--is-ancestor', commit, MAIN], { cwd: ctx.root, env: ctx.env });
  if (ancestry.status === 1) throw new Stop(`the commit ${commit} of CI run ${runId} is not on ${MAIN}; a release tags a commit of main`);
  if (ancestry.status !== 0) throw new Stop(`git merge-base --is-ancestor ${commit} ${MAIN} exited with ${ancestry.status}: ${(ancestry.stderr ?? '').trim()}`);
  // The change log and the Go modules are those of the tagged tree: main may have changed config/release.json since the run.
  const show = (file: string) => run('git', ['show', `${commit}:${file}`], { cwd: ctx.root, env: ctx.env });
  const tagged = { ...ctx, config: { ...ctx.config, ...taggedRelease(show(CONFIG), `${CONFIG} at ${commit}`) } };
  const { changelog } = tagged.config;
  if (auto) {
    const decided = autoDecision(ctx, commit, changelog, runId, repo);
    if (decided !== undefined) return decided;
  }
  const version = releasedVersion(show(changelog), `${changelog} at ${commit}`);
  // A release is newer than every release tag of the repository (K941); a tag that already exists is left to createTags, which
  // passes it at the same commit and refuses it elsewhere.
  const newest = newestReleaseTag(tagged, false);
  const exists = execute('git', ['rev-parse', '--verify', '--quiet', `refs/tags/v${version}`], { cwd: ctx.root, env: ctx.env }).status === 0;
  if (newest !== undefined && !exists && !semver.gt(version, parseTag(newest))) throw new Stop(`v${version} is not greater than the latest release tag ${newest}; a release is newer than every release tag`);
  return { version, lines: createTags(tagged, version, commit), release: true };
}

/** The commit of the tag `tag`, or undefined when the repository has no such tag. */
function tagCommit(ctx: Context, tag: string): string | undefined {
  const found = execute('git', ['rev-parse', '--verify', '--quiet', `refs/tags/${tag}^{commit}`], { cwd: ctx.root, env: ctx.env });
  return found.status === 0 ? found.stdout.trim() : undefined;
}

/** The change log `file` at `commit`, or undefined when the commit has no such file. */
function changelogAt(ctx: Context, commit: string, file: string): string | undefined {
  const shown = execute('git', ['show', `${commit}:${file}`], { cwd: ctx.root, env: ctx.env });
  return shown.status === 0 ? shown.stdout : undefined;
}

/**
 * The version commit of `version` at or below `commit` on its first-parent line: the newest commit whose change log has `version`
 * at its top while that of its first parent has another top, or no change log.
 */
function versionCommit(ctx: Context, commit: string, file: string, version: string): string {
  const line = run('git', ['rev-list', '--first-parent', commit, '--', file], { cwd: ctx.root, env: ctx.env }).split('\n').filter(Boolean);
  for (const candidate of line) {
    const parent = execute('git', ['rev-parse', '--verify', '--quiet', `${candidate}^1`], { cwd: ctx.root, env: ctx.env });
    const before = parent.status === 0 ? changelogAt(ctx, parent.stdout.trim(), file) : undefined;
    if ((before === undefined ? undefined : topVersion(before)) !== version) return candidate;
  }
  throw new Stop(`no commit of the first-parent history of ${commit} adds ## ${version} to ${file}`);
}

/**
 * The decision of a release that the run started by itself (K987), from the change log `file` at `commit`, with the one parser of
 * the change log: undefined when the commit releases its top version, as a dispatch does; otherwise the result of nothing to
 * release, or a Stop that names the version commit that did not release.
 */
function autoDecision(ctx: Context, commit: string, file: string, runId: number, repo: string): { version: string; lines: string[]; release: boolean } | undefined {
  const text = run('git', ['show', `${commit}:${file}`], { cwd: ctx.root, env: ctx.env });
  const version = topVersion(text);
  if (version === undefined) return { version: '', lines: [`nothing to release: ${file} at ${commit} has no section ## X.Y.Z`], release: false };
  const nothing = (why: string) => ({ version, lines: [`nothing to release: ${why}`], release: false });
  const tagged = tagCommit(ctx, `v${version}`);
  if (tagged === commit) {
    // A second run of the version commit after its release is public has nothing to release; a re-run of a release that failed
    // after its tag, which left no public release, runs the release again.
    const draft = execute('gh', ['api', `repos/${repo}/releases/tags/v${version}`, '--jq', '.draft'], { cwd: ctx.root, env: ctx.env });
    if (draft.status === 0 && draft.stdout.trim() === 'false') return nothing(`v${version} is the tag of ${commit} and its release is public already`);
    return undefined;
  }
  if (tagged !== undefined) {
    // The tag on the line of the commit, before it or after it, released the top version.
    const onLine = (ancestor: string, descendant: string) => execute('git', ['merge-base', '--is-ancestor', ancestor, descendant], { cwd: ctx.root, env: ctx.env }).status === 0;
    if (onLine(tagged, commit) || onLine(commit, tagged)) return nothing(`v${version}, the top version of ${file} at ${commit}, is the tag of ${tagged}`);
    throw new Stop(`v${version}, the top version of ${file} at ${commit}, is the tag of ${tagged}, which is not on the line of ${commit}; give the release a version of its own`);
  }
  // The version commit, or a later green commit whose ## Unreleased is empty, carries the version and nothing else, so it releases
  // it at once, whatever the CI run of the version commit does (K988, K990); a run of the version commit that ends later finds the
  // tag on its line.
  if (!hasUnreleasedEntries(text)) return undefined;
  const origin = versionCommit(ctx, commit, file, version);
  if (origin === commit) throw new Stop(`v${version} is not released: ${file} at ${commit} has entries under ## Unreleased; the version commit moves every entry into the section of the version`);
  // A later commit with unreleased entries would release changes that its version does not name: the CI run of the version
  // commit may still run, as a later push can finish first, and its success then releases it.
  const runs = run('gh', ['api', `repos/${repo}/actions/workflows/ci.yml/runs?head_sha=${origin}&branch=main`, '--jq', '[.workflow_runs[].status]'], { cwd: ctx.root, env: ctx.env });
  const statuses: unknown = JSON.parse(runs);
  if (!Array.isArray(statuses)) throw new Stop(`GitHub returned no list of the CI runs of ${origin}: ${runs.trim()}`);
  if (statuses.some(status => status !== 'completed')) return nothing(`v${version} waits for the CI run of its version commit ${origin}, whose success releases it`);
  throw new Stop(`v${version} is not released: no CI run of its version commit ${origin} released it, and ${file} at ${commit} has entries under ## Unreleased; move them into the section of v${version}, or release v${version} first`);
}

const USAGE = 'usage: node scripts/kit/release-run.mts prepare VERSION | tag CI_RUN_ID [--auto]';

export function main(argv: string[], { root = repositoryRoot(), env = process.env, print = console.log, error = console.error }: CommandOptions = {}): number {
  const [mode, value, extra, ...rest] = argv;
  if (mode === 'prepare' && value && !extra && rest.length === 0) {
    try {
      const ctx = context(root, { env, log: print });
      const result = prepare(ctx, value);
      print(`[release-run] v${value}: prepared candidate ${result.sha} and ${result.assets.length} assets; push this exact commit to trigger the sole CI`);
      return 0;
    } catch (failure) {
      error(`[release-run] ${mode} ${value} failed: ${failure instanceof Error ? failure.message : String(failure)}`);
      return 1;
    }
  }
  // tag takes the CI run id, and --auto when the run started the release by itself (K987); the version is the section of the
  // change log of the run's commit (K924).
  if (mode === 'tag' && value && (extra === undefined || extra === '--auto') && rest.length === 0) {
    try {
      const tagged = tagRun(context(root, { env }), Number(value), extra === '--auto');
      for (const line of tagged.lines) print(`[release-run] ${line}`);
      // The steps after release-tag read the tag from the environment of the job (workflows/release.yml); with nothing to release
      // no TAG is written, and they are skipped.
      if (env.GITHUB_ENV && tagged.release) appendFileSync(env.GITHUB_ENV, `TAG=v${tagged.version}\nVERSION=${tagged.version}\n`);
      return 0;
    } catch (failure) {
      error(`[release-run] ${mode} ${value} failed: ${failure instanceof Error ? failure.message : String(failure)}`);
      return 1;
    }
  }
  error(USAGE);
  return 2;
}

if (isMain(import.meta.url)) process.exitCode = main(process.argv.slice(2), { root: repositoryRoot() });
