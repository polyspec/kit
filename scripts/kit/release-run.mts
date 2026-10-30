#!/usr/bin/env node
import { isMain, repositoryRoot } from './paths.mts';
import { candidateAssets, context, createTags, MAIN, type CommandOptions, type Context } from './release.mts';
import { repositoryParts } from './github-release.mts';
import { execute, run, Stop } from './process.mts';

export type CandidateRun = { id: number; path: string; head_sha: string; event: string; status: string; conclusion: string | null; head_branch: string };

const VERSION = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;

/** Require the CI workflow run `id` that passed on main: its head_sha is the commit that the release tags (K911). */
export function validateCandidateRun(runInfo: CandidateRun, id: number): void {
  if (runInfo.id !== id) throw new Stop(`CI run id ${runInfo.id} does not match requested run ${id}`);
  if (!/^[0-9a-f]{40}$/.test(runInfo.head_sha)) throw new Stop(`CI run ${id} names the head SHA ${JSON.stringify(runInfo.head_sha)}, not a full Git commit SHA`);
  if (runInfo.path.replace(/@.*$/, '') !== '.github/workflows/ci.yml') throw new Stop(`CI run ${id} used workflow ${runInfo.path}, not .github/workflows/ci.yml`);
  if (runInfo.head_branch !== 'main' || !['push', 'workflow_dispatch'].includes(runInfo.event)) throw new Stop(`CI run ${id} is ${runInfo.event} on ${runInfo.head_branch}, not a supported CI run on main`);
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
 * The release tags of VERSION at the commit of the successful CI run `runId` (`make release-tag RUN VERSION`, K911): the run
 * is a completed successful push or workflow_dispatch run of .github/workflows/ci.yml on main, its commit is on origin/main,
 * and createTags puts vX.Y.Z and the tag of every Go module there. Returns what it did per tag.
 */
export function tagRun(ctx: Context, version: string, runId: number): string[] {
  if (!VERSION.test(version)) throw new Stop(`version ${JSON.stringify(version)} is not X.Y.Z`);
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
  return createTags(ctx, version, commit);
}

const USAGE = 'usage: node scripts/kit/release-run.mts prepare VERSION | tag VERSION CI_RUN_ID';

export function main(argv: string[], { root = repositoryRoot(), env = process.env, print = console.log, error = console.error }: CommandOptions = {}): number {
  const [mode, version, runValue, ...rest] = argv;
  if (mode === 'prepare' && version && !runValue && rest.length === 0) {
    try {
      const ctx = context(root, { env, log: print });
      const result = prepare(ctx, version);
      print(`[release-run] v${version}: prepared candidate ${result.sha} and ${result.assets.length} assets; push this exact commit to trigger the sole CI`);
      return 0;
    } catch (failure) {
      error(`[release-run] ${mode} ${version} failed: ${failure instanceof Error ? failure.message : String(failure)}`);
      return 1;
    }
  }
  if (mode === 'tag' && version && runValue && rest.length === 0) {
    try {
      for (const line of tagRun(context(root, { env }), version, Number(runValue))) print(`[release-run] ${line}`);
      return 0;
    } catch (failure) {
      error(`[release-run] ${mode} ${version} failed: ${failure instanceof Error ? failure.message : String(failure)}`);
      return 1;
    }
  }
  error(USAGE);
  return 2;
}

if (isMain(import.meta.url)) process.exitCode = main(process.argv.slice(2), { root: repositoryRoot() });
