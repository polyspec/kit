// Helpers of the tests of the gates: a Git checkout in a temporary directory, in which the tools of kit run
// (kit-tools.mts), with the configuration and the checklist of the fixture, and a bare repository as its remote `origin`.
import { spawnSync } from 'node:child_process';
import type { SpawnSyncOptionsWithStringEncoding } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { initRepository } from './sandbox-repository.mts';
import { KIT_MAKEFILE, tool } from './kit-tools.mts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(HERE, 'fixture');

export const CHECKLIST = 'docs/plans/work/checklist.md';
export const TRANSLATION = 'docs/plans/work/checklist.ko.md';

export function run(cwd: string, command: string, args: string[], options: Omit<SpawnSyncOptionsWithStringEncoding, 'encoding'> = {}) {
  return spawnSync(command, args, { cwd, encoding: 'utf8', ...options });
}

export function git(cwd: string, ...args: string[]) {
  const result = run(cwd, 'git', args);
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed in ${cwd}: ${result.stderr}`);
  return result.stdout.trim();
}

/** Commits the index as it is and returns the commit. */
export function commitIndex(cwd: string, message: string) {
  git(cwd, '-c', 'user.name=test', '-c', 'user.email=test@example.com', 'commit', '--quiet', '-m', message);
  return git(cwd, 'rev-parse', 'HEAD');
}

/** Commits every change of the working tree and returns the commit. */
export function commitAll(cwd: string, message: string) {
  git(cwd, 'add', '--all');
  return commitIndex(cwd, message);
}

/** The checklist of the fixture with the first task in the state `state`, in English and in Korean. */
function checklists(state: string) {
  const read = (name: string) => readFileSync(path.join(FIXTURE, name), 'utf8');
  const set = (text: string) => text.replace(/(\| T1-1 \|[^\n]*)\| \[ \] \|/, `$1| ${state} |`);
  return { english: set(read(CHECKLIST)), korean: set(read(TRANSLATION)) };
}

/** The options of checkout: the state of the first task, the checklist configuration and the extra files. */
type CheckoutOptions = { state?: string; config?: unknown; files?: Record<string, string> };

/**
 * A checkout `work` with a Makefile that includes kit.mk, config/checklist.json (or `config`), the checklists in the state `state` (the second
 * task of the fixture) and the files of `files`, written over them, and the remote `origin` in `remote`; nothing is committed.
 * Removed with `t.after`.
 */
export function checkout(t: Pick<TestContext, 'after'>, { state = '[ ]', config = null, files = {} }: CheckoutOptions = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), 'kit-gates-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const work = path.join(directory, 'work');
  const remote = path.join(directory, 'remote.git');
  mkdirSync(work);
  // The pre-push hook calls make push-gate-hook, so the checkout includes kit.mk of this checkout with its sources, as kit does.
  writeFileSync(path.join(work, 'Makefile'), KIT_MAKEFILE);
  mkdirSync(path.join(work, 'config'));
  cpSync(path.join(FIXTURE, 'config/checklist.json'), path.join(work, 'config/checklist.json'));
  cpSync(path.join(FIXTURE, 'config/generated.json'), path.join(work, 'config/generated.json'));
  if (config) writeFileSync(path.join(work, 'config/checklist.json'), JSON.stringify(config));
  mkdirSync(path.join(work, 'docs/plans/work'), { recursive: true });
  const { english, korean } = checklists(state);
  writeFileSync(path.join(work, CHECKLIST), english);
  writeFileSync(path.join(work, TRANSLATION), korean);
  writeFileSync(path.join(work, '.gitignore'), '/var/\n');
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(work, name)), { recursive: true });
    writeFileSync(path.join(work, name), text);
  }
  initRepository(remote, '--bare');
  initRepository(work, '--initial-branch=main');
  git(work, 'remote', 'add', 'origin', remote);
  return { work, remote };
}

/** A checkout with the hooks installed through `git-hooks install` and everything committed. */
export function prepared(t: Pick<TestContext, 'after'>, options?: CheckoutOptions) {
  const made = checkout(t, options);
  const installed = run(made.work, process.execPath, [tool(import.meta.resolve('../../scripts/kit/git-hooks.mts')), 'install']);
  if (installed.status !== 0) throw new Error(`git-hooks install failed: ${installed.stderr}`);
  commitAll(made.work, 'docs(checklist): Add the checklist (#T1)');
  return made;
}
