// Git in a checkout: `git` returns the output and fails with a Stop when git does not end with status 0; `gitResult` returns
// the outcome for a command whose status is an answer, such as `git rev-parse --verify --quiet`.
import { execute, run } from './process.mts';
import type { Outcome } from './process.mts';

/** The standard output of `git <args>` in `root`; Stop with the exit status and the standard error otherwise. */
export const git = (root: string, ...args: string[]): string => run('git', args, { cwd: root });

/** The outcome `{ status, stdout, stderr, error }` of `git <args>` in `root`. */
export const gitResult = (root: string, ...args: string[]): Outcome => execute('git', args, { cwd: root });

// K510: a revision named by a full commit sha, or its parent, never moves, so its files are read once in a process: the push gate reads
// the trees of every pushed commit and of its parent, which is the commit before it. A ref name, such as HEAD or main, can move, and the
// index changes, so neither is kept.
const IMMUTABLE = /^[0-9a-f]{40}\^?$/;
const treeFiles = new Map<string, Set<string>>();
const fileTexts = new Map<string, string>();

/** The files of the immutable revision `rev` of `root`, listed once (git ls-tree -r). */
function filesOf(root: string, rev: string): Set<string> {
  const key = `${root}\0${rev}`;
  let files = treeFiles.get(key);
  if (files === undefined) {
    files = new Set(git(root, 'ls-tree', '-r', '--name-only', rev).split('\n').filter(name => name !== ''));
    treeFiles.set(key, files);
  }
  return files;
}

// The text of `file` at the revision `rev` (`:` alone is the index, a commit its tree, K351); empty when the revision has no such file. Whether it
// has the file is read from git ls-tree (ls-files for the index); any failure of git show then throws.
export const fileAt = (root: string, rev: string, file: string) => {
  const immutable = IMMUTABLE.test(rev);
  const key = `${root}\0${rev}\0${file}`;
  const known = immutable ? fileTexts.get(key) : undefined;
  if (known !== undefined) return known;
  const listed = immutable ? filesOf(root, rev).has(file) : (rev === '' ? git(root, 'ls-files', '--cached', '--', file) : git(root, 'ls-tree', '--name-only', rev, '--', file)).trim() !== '';
  if (!listed) return '';
  const shown = gitResult(root, 'show', `${rev}:${file}`);
  if (shown.error || shown.status !== 0) throw new Error(`git show ${rev}:${file} failed: ${shown.error?.message ?? shown.stderr.trim()}`);
  if (immutable) fileTexts.set(key, shown.stdout);
  return shown.stdout;
};
