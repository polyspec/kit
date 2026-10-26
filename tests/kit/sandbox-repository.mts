// Creates the Git repositories of the test sandboxes. Every test that needs a repository creates it here.
//
// After a commit, a merge or a received push, git starts `git maintenance run --auto --detach`, which leaves the process
// group of the test and can repack into objects/pack after the command has returned. A removal of the sandbox in that time
// fails with ENOTEMPTY on the file that the repack creates. Each repository therefore turns automatic maintenance and
// automatic gc off in its own configuration, which every git command in it reads, the commands of the tools included. A
// received push also starts `git gc --auto` from receive-pack unless receive.autogc is false; git 2.43 starts it even with
// gc.auto 0, so that is turned off too. Each repository also names its own identity, so a commit of a test does not take
// the identity of the machine, which the commit check may refuse (K265).
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** Runs git with `args` and fails with its status and stderr. */
function git(args: string[]) {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} exited ${result.status}: ${result.stderr}`);
}

/** Runs the git commands that create a repository in `directory` and configure it as above. */
function create(directory: string, options: string[]) {
  git(['init', '--quiet', '--initial-branch=main', ...options, directory]);
  git(['-C', directory, 'config', 'maintenance.auto', 'false']);
  git(['-C', directory, 'config', 'gc.auto', '0']);
  git(['-C', directory, 'config', 'receive.autogc', 'false']);
  git(['-C', directory, 'config', 'user.name', 'kit test']);
  git(['-C', directory, 'config', 'user.email', 'test@example.com']);
}

// The .git folder of a configured repository, made once per process (K301): a repository without options is a copy of it, since six
// git processes for each of the hundreds of repositories of a run were most of the time of the parity and link tests.
let template: string | undefined;
function templateGit(): string {
  if (template !== undefined) return template;
  const folder = mkdtempSync(path.join(tmpdir(), 'kit-git-template-'));
  process.once('exit', () => rmSync(folder, { recursive: true, force: true }));
  create(folder, []);
  template = path.join(folder, '.git');
  return template;
}

/** Creates a repository on main without automatic maintenance; explicit options may select another branch or --bare. */
export function initRepository(directory: string, ...options: string[]) {
  if (options.length > 0) {
    create(directory, options);
    return;
  }
  mkdirSync(directory, { recursive: true });
  cpSync(templateGit(), path.join(directory, '.git'), { recursive: true });
}
