// Git in a checkout: `git` returns the output and fails with a Stop when git does not end with status 0; `gitResult` returns
// the outcome for a command whose status is an answer, such as `git rev-parse --verify --quiet`.
import { execute, run } from './process.mts';
import type { Outcome } from './process.mts';

/** The standard output of `git <args>` in `root`; Stop with the exit status and the standard error otherwise. */
export const git = (root: string, ...args: string[]): string => run('git', args, { cwd: root });

/** The outcome `{ status, stdout, stderr, error }` of `git <args>` in `root`. */
export const gitResult = (root: string, ...args: string[]): Outcome => execute('git', args, { cwd: root });

// The text of `file` at the revision `rev` (`:` alone is the index, a commit its tree, K351); empty when the revision has no such file. Whether it
// has the file is read from git ls-tree (ls-files for the index); any failure of git show then throws.
export const fileAt = (root: string, rev: string, file: string) => {
  const listed = rev === '' ? git(root, 'ls-files', '--cached', '--', file) : git(root, 'ls-tree', '--name-only', rev, '--', file);
  if (listed.trim() === '') return '';
  const shown = gitResult(root, 'show', `${rev}:${file}`);
  if (shown.error || shown.status !== 0) throw new Error(`git show ${rev}:${file} failed: ${shown.error?.message ?? shown.stderr.trim()}`);
  return shown.stdout;
};
