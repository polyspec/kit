#!/usr/bin/env node
// The push gate. A push happens only when no item of a checklist (docs/plans/<plan>/checklist.md, checklist.mts) is in the
// active state `[~]`: work in progress does not reach the remote. Items in the other states (waiting, done, bypassed,
// impossible) do not block a push.
//
//   node scripts/kit/push-gate.mts hook          the pre-push hook .githooks/pre-push: reads the lines
//                                                `<local ref> <local sha> <remote ref> <remote sha>` of Git on standard
//                                                input and refuses the push while a checklist of a pushed commit or of the
//                                                working tree has an item in the active state, or cannot be read, and refuses it while a commit that the push sends has a
//                                                finding of its message or identity (check-commits.mts, COMMIT_RULES); the item, row and
//                                                twin rules of each commit are the commit and land gates' (K510)
//   node scripts/kit/push-gate.mts commit <rev>  the check of a pushed commit, for a push from a checkout without the
//                                                hook: fails for the same reasons and when the commit does not track a
//                                                hook of config/checklist.json with mode 100755; prints each line also as
//                                                a GitHub annotation and appends it to $GITHUB_STEP_SUMMARY when it is set
//
// The refusal names each item with its file and ID and the place where it was found: the pushed ref and commit or the
// working tree. A checklist whose translation lists other IDs or states than the document is unreadable for the gate.
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { BLOCKING, inspectTrackers, loadConfig, PLANS, trackersOf, workingPlanFiles } from './checklist.mts';
import { HOOKS_PATH } from './git-hooks.mts';
import { isMain, repositoryRoot } from './paths.mts';
import { git, gitResult } from './git.mts';
import { COMMIT_RULES, logMessages, messageLines } from './check-commits.mts';
import { present } from './present.mts';
import { retainedBranch, retainedBranches } from './retained-branches.mts';

const USAGE = 'Usage: node scripts/kit/push-gate.mts hook | commit <rev>';
const NO_OBJECT = /^0+$/;
const SHORT = 12;

const RULE = 'A push happens only when no item of a checklist is in its active state; work in progress does not reach the remote.';
const COMMIT_FIX = 'Amend each listed commit that the remote does not hold yet, then push again; this gate does not rewrite a pushed commit.';
// The configuration of config/checklist.json, as its loader reads it, and the commit rules of kit.
type ChecklistConfig = ReturnType<typeof loadConfig>;
type CommitRules = typeof COMMIT_RULES;

/** A place whose checklists the gate reads: its name, the paths of its plan files and the reader of its files. */
export interface Source {
  where: string;
  files: string[];
  read: (file: string) => string;
}

const FIX = 'Finish each listed item in a commit with its documentation and tests, or move it to a state that does not block, such as bypassed with its cause and retry condition; then push again.';

/**
 * Inspects the checklists of `sources`, each `{ where, files, read }` where `read(file)` returns the text of a file or throws why it
 * cannot. Returns the lines of the refusal, or an empty array when no item is in an active state.
 */
export function inspect(config: ChecklistConfig, sources: Source[]): string[] {
  const active: string[] = [];
  const unreadable: string[] = [];
  for (const { where, files, read } of sources) {
    const trackers = trackersOf(config, files);
    // A tree without a checklist holds no item to read, which the gate never takes for one without an active item.
    if (trackers.length === 0) unreadable.push(`  ${where}: it holds no checklist; a plan is docs/plans/<plan>/ with plan.md, checklist.md and their Korean twins`);
    const found = inspectTrackers(trackers, read);
    for (const item of found.active) active.push(`  ${where}: ${item.file} ${item.id} ${item.title}`);
    for (const problem of found.problems) unreadable.push(`  ${where}: ${problem}`);
  }
  const lines: string[] = [];
  if (unreadable.length > 0) lines.push('push refused: the push gate cannot read the checklists (docs/plans/<plan>/checklist.md)', ...unreadable, 'The gate refuses a push whose checklists it cannot read; fix the cause and push again.');
  if (active.length > 0) lines.push(`push refused: ${active.length} item${active.length === 1 ? ' is' : 's are'} in the active state (${BLOCKING})`, ...active, RULE, FIX);
  return lines;
}

// The reader of the files of a commit, which names the commit and the file that it lacks.
const committed = (root: string, sha: string) => (file: string): string => {
  const shown = gitResult(root, 'show', `${sha}:${file}`);
  if (shown.error) throw shown.error;
  if (shown.status !== 0) throw new Error(`the commit has no ${file}: ${shown.stderr.trim()}`);
  return shown.stdout;
};

// The paths of the plan files of a commit.
const committedFiles = (root: string, sha: string) => git(root, 'ls-tree', '-r', '--name-only', sha, '--', PLANS).split('\n').filter(Boolean);

const working = (root: string) => (file: string): string => {
  if (!existsSync(path.join(root, file))) throw new Error(`${file} does not exist in the working tree`);
  return readFileSync(path.join(root, file), 'utf8');
};

/**
 * The message and identity finding lines of the commits that a push of `localSha` to a ref at `remoteSha` sends (K510). A new ref (zero
 * remote sha) sends the commits that no remote ref holds; an update sends the commits after the remote sha. The checklists of the pushed
 * tip are read once by inspect; the item, row and twin rules of each commit are the commit and land gates', which ran on it.
 */
function pushedFindings(root: string, localSha: string, remoteSha: string, rules: CommitRules): string[] {
  if (NO_OBJECT.test(remoteSha)) return messageLines(root, logMessages(root, [localSha, '--not', '--remotes'], `${localSha} without the remote refs`), rules);
  return messageLines(root, logMessages(root, [`${remoteSha}..${localSha}`], `${remoteSha}..${localSha}`), rules);
}

/** The refusal lines of the commit findings of a push, empty when there is none. */
function commitRefusal(findings: string[]): string[] {
  if (findings.length === 0) return [];
  return [`push refused: ${findings.length} commit finding${findings.length === 1 ? '' : 's'} (the commit rules of kit)`, ...findings.map(finding => `  ${finding}`), COMMIT_FIX];
}

// The branch that work may go to directly; every other branch is named for its item and deleted once merged into it.
const MAIN = 'main';
const SHORTNAME = '[a-z0-9]+(?:-[a-z0-9]+)*';
const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The worktrees of `root` as `git worktree list --porcelain` lists them: the main worktree first, each with its branch. */
function worktrees(root: string): { path: string; branch?: string }[] {
  return git(root, 'worktree', 'list', '--porcelain').split('\n\n').filter(block => block.trim()).map(block => {
    const fields = new Map(block.split('\n').map(line => [line.slice(0, line.indexOf(' ') === -1 ? line.length : line.indexOf(' ')), line.slice(line.indexOf(' ') + 1)]));
    const branch = fields.get('branch')?.replace(/^refs\/heads\//, '');
    return { path: present(fields.get('worktree'), 'the worktree field of git worktree list'), ...(branch ? { branch } : {}) };
  });
}

/**
 * The refusal lines of the branch rules of PRINCIPLES.md (K253): a pushed branch other than main is named
 * {type}/{shortname}-{checklist id}, a worktree folder {project}-{shortname}-{checklist id}, where the project is the folder
 * of the main worktree, and no local branch that main has merged remains. A branch is merged when main holds its tip and has
 * moved past it, so a branch just created from the tip of main is work that has not started yet; a branch whose worktree has
 * uncommitted changes is work in progress, whatever its tip (K782).
 */
export function branchFindings(root: string, pushed: readonly string[], types: readonly string[], idPattern: string): string[] {
  const found: string[] = [];
  const retained = retainedBranches(root);
  const branchName = new RegExp(`^(?:${types.map(escaped).join('|')})/${SHORTNAME}-(?:${idPattern})$`);
  for (const branch of pushed.filter(name => name !== MAIN && !branchName.test(name))) {
    found.push(`the branch ${branch} is not named {type}/{shortname}-{checklist id}, such as ${types[0] ?? 'feat'}/<shortname>-<id>; push it under such a name`);
  }
  const [primary, ...others] = worktrees(root);
  if (primary) {
    const project = path.basename(primary.path);
    const folderName = new RegExp(`^${escaped(project)}-${SHORTNAME}-(?:${idPattern})$`);
    for (const tree of others.filter(entry => !folderName.test(path.basename(entry.path)))) {
      found.push(`the worktree ${tree.path} is not named {project}-{shortname}-{checklist id}, here ${project}-<shortname>-<id>; move it with git worktree move`);
    }
  }
  const main = gitResult(root, 'rev-parse', '--verify', '--quiet', `refs/heads/${MAIN}`);
  if (main.status === 0) {
    const tip = main.stdout.trim();
    for (const line of git(root, 'for-each-ref', '--format=%(refname:short) %(objectname)', 'refs/heads').split('\n').filter(Boolean)) {
      const [branch = '', sha = ''] = line.split(' ');
      if (branch === MAIN || sha === tip || gitResult(root, 'merge-base', '--is-ancestor', sha, tip).status !== 0) continue;
      if (retainedBranch(retained, branch)) continue;
      const tree = others.find(entry => entry.branch === branch);
      if (tree && git(tree.path, 'status', '--porcelain').trim() !== '') continue;
      found.push(`the branch ${branch} is merged into main; delete it with ${tree ? `git worktree remove ${tree.path} && ` : ''}git branch -d ${branch}`);
    }
  }
  return found.map(line => `push refused: ${line}`);
}

/** The refusal lines of a push: `input` holds the lines that Git passes to the pre-push hook. */
export function hook(root: string, input: string): string[] {
  const config = loadConfig(root);
  const rules = COMMIT_RULES;
  const sources: Source[] = [];
  const findings: string[] = [];
  const branches: string[] = [];
  for (const line of input.split('\n').filter(entry => entry.trim())) {
    const fields = line.trim().split(/\s+/);
    if (fields.length !== 4) throw new Error(`the pre-push input line ${JSON.stringify(line)} is not "<local ref> <local sha> <remote ref> <remote sha>"`);
    // The check above holds four fields.
    const localRef = present(fields[0], 'the local ref of a pre-push input line');
    const localSha = present(fields[1], 'the local sha of a pre-push input line');
    const remoteSha = present(fields[3], 'the remote sha of a pre-push input line');
    // A deleted ref pushes no commit.
    if (NO_OBJECT.test(localSha)) continue;
    const remoteRef = present(fields[2], 'the remote ref of a pre-push input line');
    if (remoteRef.startsWith('refs/heads/')) branches.push(remoteRef.slice('refs/heads/'.length));
    sources.push({ where: `${localRef} ${localSha.slice(0, SHORT)}`, files: committedFiles(root, localSha), read: committed(root, localSha) });
    findings.push(...pushedFindings(root, localSha, remoteSha, rules));
  }
  sources.push({ where: 'working tree', files: workingPlanFiles(root), read: working(root) });
  return [...inspect(config, sources), ...commitRefusal(findings), ...branchFindings(root, branches, rules.types, config.idPattern)];
}

/** The failure lines of the commit `rev`, or an empty array, with the commit that `rev` names. */
export function commit(root: string, rev: string): { sha: string; lines: string[] } {
  const config = loadConfig(root);
  const resolved = gitResult(root, 'rev-parse', '--verify', '--quiet', `${rev}^{commit}`);
  if (resolved.status !== 0) return { sha: rev, lines: [`push refused: ${rev} is not a commit of this repository`] };
  const sha = resolved.stdout.trim();
  const lines = inspect(config, [{ where: `commit ${sha.slice(0, SHORT)}`, files: committedFiles(root, sha), read: committed(root, sha) }]);
  for (const name of config.hooks) {
    const file = `${HOOKS_PATH}/${name}`;
    const entry = git(root, 'ls-tree', sha, '--', file).trim();
    if (!entry) lines.push(`push refused: ${file} is not tracked in commit ${sha.slice(0, SHORT)}, so a checkout of it has no ${name} hook; restore the hook`);
    else if (!entry.startsWith('100755 ')) lines.push(`push refused: ${file} is tracked with mode ${entry.split(' ')[0]}, not 100755, in commit ${sha.slice(0, SHORT)}, so Git does not run it; restore its mode with git update-index --chmod=+x ${file}`);
  }
  return { sha, lines };
}

// A GitHub annotation holds the message on one line; % and the line breaks are escaped as GitHub requires.
const annotation = (line: string) => `::error::${line.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A')}`;

if (isMain(import.meta.url)) {
  const root = repositoryRoot();
  const [mode, ...args] = process.argv.slice(2);
  if (mode === 'hook' && args.length === 0) {
    let lines;
    try {
      lines = hook(root, readFileSync(0, 'utf8'));
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      // A gate that cannot decide does not allow the push.
      lines = [`push refused: the push gate failed: ${error.message}`];
    }
    for (const line of lines) console.error(line);
    process.exitCode = lines.length > 0 ? 1 : 0;
  } else if (mode === 'commit' && args.length === 1) {
    let result;
    try {
      // The condition of this branch holds one argument.
      result = commit(root, present(args[0], 'args[0]'));
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      // The condition of this branch holds one argument.
      result = { sha: present(args[0], 'args[0]'), lines: [`push refused: the push gate failed: ${error.message}`] };
    }
    for (const line of result.lines) {
      console.error(line);
      console.log(annotation(line));
    }
    if (result.lines.length > 0 && process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Push gate\n\n\`\`\`\n${result.lines.join('\n')}\n\`\`\`\n`);
    if (result.lines.length === 0) console.log(`[push-gate] commit ${result.sha.slice(0, SHORT)}: no item is in an active state and every hook of config/checklist.json is tracked with mode 100755`);
    process.exitCode = result.lines.length > 0 ? 1 : 0;
  } else {
    console.error(USAGE);
    process.exitCode = 2;
  }
}
