#!/usr/bin/env node
import { isMain, repositoryRoot } from './paths.mts';
import { candidateAssets, context, createTag, versions, type CommandOptions, type Context } from './release.mts';
import { repositoryParts } from './github-release.mts';
import { run, Stop } from './process.mts';

export type CandidateRun = { id: number; path: string; head_sha: string; event: string; status: string; conclusion: string | null; head_branch: string };

const SHA = /^[0-9a-f]{40}$/;
const VERSION = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;

/** Require the exact CI workflow run that passed for the candidate on main. */
export function validateCandidateRun(runInfo: CandidateRun, sha: string, id: number): void {
  if (runInfo.id !== id) throw new Stop(`CI run id ${runInfo.id} does not match requested run ${id}`);
  if (runInfo.head_sha !== sha) throw new Stop(`CI run head SHA ${runInfo.head_sha} does not match candidate ${sha}`);
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

function cleanCandidate(ctx: Context): string {
  const dirty = run('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: ctx.root, env: ctx.env }).trim();
  if (dirty) throw new Stop(`the candidate worktree is dirty: ${dirty.split('\n').join(', ')}; commit or remove those paths before publishing`);
  return run('git', ['rev-parse', '--verify', 'HEAD^{commit}'], { cwd: ctx.root, env: ctx.env }).trim();
}

/** Build the candidate archives of the committed candidate before CI runs. */
export function prepare(ctx: Context, version: string): { sha: string; assets: string[] } {
  if (!VERSION.test(version)) throw new Stop(`version ${JSON.stringify(version)} is not X.Y.Z`);
  versions(ctx, `v${version}`);
  const assets = candidateAssets(ctx, version);
  const sha = run('git', ['rev-parse', '--verify', 'HEAD^{commit}'], { cwd: ctx.root, env: ctx.env }).trim();
  return { sha, assets };
}

/** Validate CI, then push the annotated tag at that same main commit to start the existing release workflow. */
export function publish(ctx: Context, version: string, candidateSha: string, runId: number): string {
  if (!VERSION.test(version)) throw new Stop(`version ${JSON.stringify(version)} is not X.Y.Z`);
  if (!SHA.test(candidateSha)) throw new Stop(`candidate SHA ${JSON.stringify(candidateSha)} is not a full lowercase Git commit SHA`);
  if (!Number.isSafeInteger(runId) || runId < 1) throw new Stop(`CI run id ${runId} is not a positive integer`);
  const tag = `v${version}`;
  versions(ctx, tag);
  const head = cleanCandidate(ctx);
  if (head !== candidateSha) throw new Stop(`HEAD is ${head}, not candidate ${candidateSha}; publish must tag the exact CI candidate`);
  run('git', ['fetch', '--no-tags', 'origin', 'refs/heads/main:refs/remotes/origin/main'], { cwd: ctx.root, env: ctx.env });
  const remote = run('git', ['rev-parse', '--verify', 'origin/main^{commit}'], { cwd: ctx.root, env: ctx.env }).trim();
  if (remote !== candidateSha) throw new Stop(`origin/main is ${remote}, not candidate ${candidateSha}; publish only the exact CI commit`);
  const { repo } = repositoryParts(ctx.config.repositoryUrl);
  const repository = ctx.env.GITHUB_REPOSITORY;
  if (repository && repository.toLowerCase() !== repo.toLowerCase()) throw new Stop(`GITHUB_REPOSITORY ${repository} does not match config/release.json repository ${repo}`);
  const output = run('gh', ['api', `repos/${repo}/actions/runs/${runId}`, '--jq', '{id,path,head_sha,event,status,conclusion,head_branch}'], { cwd: ctx.root, env: ctx.env });
  const runInfo = parseCandidateRun(output);
  validateCandidateRun(runInfo, candidateSha, runId);
  return createTag(ctx, tag);
}

const USAGE = 'usage: node scripts/kit/release-run.mts prepare VERSION | publish VERSION CANDIDATE_SHA CI_RUN_ID';

export function main(argv: string[], { root = repositoryRoot(), env = process.env, print = console.log, error = console.error }: CommandOptions = {}): number {
  const [mode, version, candidateSha, runValue, ...rest] = argv;
  if (mode === 'prepare' && version && !candidateSha && !runValue && rest.length === 0) {
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
  if (mode === 'publish' && version && candidateSha && runValue && rest.length === 0) {
    try {
      const id = Number(runValue);
      const result = publish(context(root, { env }), version, candidateSha, id);
      print(`[release-run] v${version}: ${result}; the existing tag-triggered release workflow verifies, drafts, proves and publishes this commit`);
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
