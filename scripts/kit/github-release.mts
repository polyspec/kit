// The GitHub Release of a repository through the gh CLI, shared by the release tools and the release proof: the release
// of a tag with its drafts, a release by its id, the draft that publish creates with its archives, and the download of one
// asset by its id. A draft is listed only for a user with push access, and the release workflow runs with that access. The
// list catches up with a new draft only after a while, and the tag does not address a draft, so the release tools address
// their own draft by the id that its creation returns.
import { closeSync, openSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { run, Stop } from './process.mts';
import type { RunPlace } from './process.mts';

/** An asset of a release as the --jq filter of releaseOf lists it; `digest` is null where GitHub has none. */
export type ReleaseAsset = { id: number; name: string; url: string; digest: string | null };

/** A release as the --jq filter of releaseOf lists it. */
export type GitHubRelease = { id: number; tag_name: string; draft: boolean; assets: ReleaseAsset[] };

/** `{ hostname, repo }` of a repository URL: the host of `gh api --hostname` and the OWNER/REPO of `repos/`. */
export function repositoryParts(url: string): { hostname: string; repo: string } {
  const { host, pathname } = new URL(url);
  const repo = pathname.replace(/^\/+|\/+$/g, '').replace(/\.git$/, '');
  if (!repo) throw new Stop(`${url} names no OWNER/REPO`);
  return { hostname: host, repo };
}

// The fields of a release that the tools read, as a --jq filter of one release object.
const RELEASE_FIELDS = '{id, tag_name, draft, assets: [.assets[] | {id, name, url: .browser_download_url, digest}]}';

/** The release `id` of the repository, a draft included, as releaseOf gives a release. */
export function releaseById(options: RunPlace, url: string, id: number): GitHubRelease {
  const { hostname, repo } = repositoryParts(url);
  return JSON.parse(run('gh', ['api', '--hostname', hostname, `repos/${repo}/releases/${id}`, '--jq', RELEASE_FIELDS], options));
}

/**
 * Creates the draft release of `tag` in the repository with the body of `notesFile` and uploads `files` to it; returns its
 * id. The tag must be on the remote, as gh release create --verify-tag requires, since GitHub would otherwise create it from
 * the default branch. Each file is uploaded to the upload URL of the new release, which names the release by its id.
 */
export function createDraft(options: RunPlace, url: string, tag: string, notesFile: string, files: string[]): number {
  const { hostname, repo } = repositoryParts(url);
  try {
    run('gh', ['api', '--hostname', hostname, `repos/${repo}/git/ref/tags/${tag}`, '--jq', '.ref'], options);
  } catch (error) {
    if (!(error instanceof Stop)) throw error;
    throw new Stop(`the tag ${tag} is not on ${url}; push it before the release is published: ${error.message}`);
  }
  const created: { id: number; upload_url: string } = JSON.parse(run('gh', ['api', '--hostname', hostname, '--method', 'POST', `repos/${repo}/releases`, '-f', `tag_name=${tag}`, '-f', `name=${tag}`, '-F', `body=@${notesFile}`, '-F', 'draft=true', '--jq', '{id, upload_url}'], options));
  // The upload URL is an RFC 6570 URI pattern whose query names the asset: https://uploads.github.com/repos/O/R/releases/<id>/assets{?name,label}.
  const upload = created.upload_url.replace(/\{[^}]*\}$/, '');
  for (const file of files) {
    run('gh', ['api', '--method', 'POST', `${upload}?name=${encodeURIComponent(path.basename(file))}`, '-H', 'Content-Type: application/octet-stream', '--input', file, '--jq', '.id'], options);
  }
  return created.id;
}

/** Deletes the release `id` of the repository. */
export function deleteRelease(options: RunPlace, url: string, id: number): void {
  const { hostname, repo } = repositoryParts(url);
  run('gh', ['api', '--hostname', hostname, '--method', 'DELETE', `repos/${repo}/releases/${id}`], options);
}

/** Makes the draft release `id` of the repository public. */
export function makePublic(options: RunPlace, url: string, id: number): void {
  const { hostname, repo } = repositoryParts(url);
  run('gh', ['api', '--hostname', hostname, '--method', 'PATCH', `repos/${repo}/releases/${id}`, '-F', 'draft=false', '--jq', '.id'], options);
}

/** The release of `tag` in the repository, drafts included, as `{ id, tag_name, draft, assets: [{ id, name, url, digest }] }`, or null. `url` is the download URL of an asset and `digest` its `sha256:<hex>`, as GitHub lists them. */
export function releaseOf(options: RunPlace, url: string, tag: string): GitHubRelease | null {
  const { hostname, repo } = repositoryParts(url);
  const listed = run('gh', ['api', '--hostname', hostname, '--paginate', `repos/${repo}/releases`, '--jq', `.[] | ${RELEASE_FIELDS} | @json`], options);
  // Each line is an object that the --jq filter above builds with these keys.
  const releases: GitHubRelease[] = listed.split('\n').filter(line => line.trim() !== '').map(line => JSON.parse(line));
  return releases.find(release => release.tag_name === tag) ?? null;
}

/** Writes the binary of asset `id` of the repository to `file`, read through the API with the octet-stream media type. */
export function downloadAsset(options: RunPlace, url: string, id: number, file: string): void {
  const { hostname, repo } = repositoryParts(url);
  const args = ['api', '--hostname', hostname, '-H', 'Accept: application/octet-stream', `repos/${repo}/releases/assets/${id}`];
  const fd = openSync(file, 'w');
  try {
    const result = spawnSync('gh', args, { cwd: options.cwd, env: options.env, stdio: ['ignore', fd, 'pipe'], encoding: 'utf8' });
    if (result.error) throw new Stop(`gh ${args.join(' ')} could not start: ${result.error.message}`);
    if (result.status !== 0) throw new Stop(`gh ${args.join(' ')} exited with ${result.status}: ${result.stderr.trim()}`);
  } finally {
    closeSync(fd);
  }
}
