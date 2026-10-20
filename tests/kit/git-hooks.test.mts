// Tests of the Git hooks (scripts/kit/git-hooks.mts): `install` sets core.hooksPath, writes the pre-push hook and makes the
// listed hooks executable, a second run changes nothing, and `check` fails with the cause and the fix for each hook that is
// not installed.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { HOOKS_PATH, PRE_COMMIT, PRE_PUSH, PRE_PUSH_CONTENT, hooksIssue, installHooks } from '../../scripts/kit/git-hooks.mts';
import { checkout, git, run } from './gates-checkout.mts';
import { tool } from './kit-tools.mts';

const hooks = (work: string) => run(work, process.execPath, [tool(import.meta.resolve('../../scripts/kit/git-hooks.mts')), 'install']);
const check = (work: string) => run(work, process.execPath, [tool(import.meta.resolve('../../scripts/kit/git-hooks.mts')), 'check']);

test('install sets core.hooksPath and writes the executable pre-push hook; check passes', (t) => {
  const { work } = checkout(t);
  assert.equal(check(work).status, 1);
  const installed = hooks(work);
  assert.equal(installed.status, 0, installed.stderr);
  assert.match(installed.stdout, /\[git-hooks\] core\.hooksPath set to \.githooks \(was not set\)\n\[git-hooks\] \.githooks\/pre-commit written\n\[git-hooks\] \.githooks\/pre-push written\n\[git-hooks\] \.githooks\/commit-msg written\n\[git-hooks\] the hooks pre-push are installed: core\.hooksPath is \.githooks/);
  assert.equal(git(work, 'config', 'core.hooksPath'), HOOKS_PATH);
  assert.equal(readFileSync(path.join(work, PRE_PUSH), 'utf8'), PRE_PUSH_CONTENT);
  assert.equal(statSync(path.join(work, PRE_PUSH)).mode & 0o777, 0o755);
  assert.equal(check(work).status, 0);
});

test('a second install changes nothing: no file is rewritten and no setting is touched', (t) => {
  const { work } = checkout(t);
  assert.equal(hooks(work).status, 0);
  const before = statSync(path.join(work, PRE_PUSH));
  const second = hooks(work);
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /^\[git-hooks\] nothing to change\n\[git-hooks\] the hooks pre-push are installed/);
  const after = statSync(path.join(work, PRE_PUSH));
  assert.equal(after.mtimeMs, before.mtimeMs);
  assert.equal(after.ino, before.ino);
  assert.deepEqual(installHooks(work), []);
});

test('check fails while core.hooksPath is not .githooks, naming the value and make hooks', (t) => {
  const { work } = checkout(t);
  hooks(work);
  git(work, 'config', 'core.hooksPath', 'elsewhere');
  const failed = check(work);
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /core\.hooksPath is "elsewhere", not \.githooks, so Git does not run the hooks; run make hooks/);
  git(work, 'config', '--unset', 'core.hooksPath');
  assert.match(check(work).stderr, /core\.hooksPath is not set, not \.githooks/);
});

test('check fails while the pre-push hook is missing, not executable or changed; install repairs them', (t) => {
  const { work } = checkout(t);
  hooks(work);
  const file = path.join(work, PRE_PUSH);
  rmSync(file);
  assert.match(check(work).stderr, /\.githooks\/pre-push does not exist; restore it from Git and run make hooks/);

  assert.equal(hooks(work).status, 0);
  chmodSync(file, 0o644);
  assert.match(check(work).stderr, /\.githooks\/pre-push is not executable, so Git does not run it; run make hooks/);
  assert.equal(hooks(work).status, 0);
  assert.equal(statSync(file).mode & 0o777, 0o755);

  writeFileSync(file, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  assert.match(check(work).stderr, /\.githooks\/pre-push differs from the hook of scripts\/kit\/git-hooks\.mts; run make hooks and commit the file/);
  assert.match(hooks(work).stdout, /\.githooks\/pre-push written/);
  assert.equal(check(work).status, 0);
});

test('the listed hooks of the repository are checked and made executable, and a missing one fails the check', (t) => {
  const config = { schema: 1, hooks: ['pre-push', 'post-merge'], idPattern: 'T[0-9]+(?:[.-][0-9]+)*' };
  const { work } = checkout(t, { config });
  const failed = hooks(work);
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /\.githooks\/post-merge does not exist; restore it from Git and run make hooks/);
  const hook = path.join(work, '.githooks/post-merge');
  writeFileSync(hook, '#!/bin/sh\nexit 0\n', { mode: 0o644 });
  assert.match(check(work).stderr, /\.githooks\/post-merge is not executable/);
  const installed = hooks(work);
  assert.equal(installed.status, 0, installed.stderr);
  assert.match(installed.stdout, /\.githooks\/post-merge made executable/);
  assert.equal(statSync(hook).mode & 0o100, 0o100);
  assert.equal(readFileSync(hook, 'utf8'), '#!/bin/sh\nexit 0\n', 'install does not rewrite a hook of the repository');
  assert.equal(existsSync(path.join(work, '.githooks/pre-push')), true);
  assert.equal(hooksIssue(work), null);
});

test('check and install fail naming config/generated.json while the pre-commit hook is installed and the repository lacks it (K362)', (t) => {
  const { work } = checkout(t);
  const config = path.join(work, 'config/generated.json');
  const valid = readFileSync(config, 'utf8');
  rmSync(config);
  assert.throws(() => installHooks(work), /config\/generated\.json/);
  assert.notEqual(run(work, 'git', ['config', 'core.hooksPath']).status, 0, 'a refused install writes nothing, so core.hooksPath stays unset');
  assert.equal(existsSync(path.join(work, PRE_COMMIT)), false, 'a refused install writes no hook');

  writeFileSync(config, valid);
  assert.equal(hooks(work).status, 0);
  rmSync(config);
  assert.match(hooksIssue(work) ?? '', /config\/generated\.json/);
  assert.match(check(work).stderr, /config\/generated\.json/);
  assert.equal(check(work).status, 1);

  writeFileSync(config, '{"schema":1,"paths":[],"exceptions":[]}\n');
  assert.equal(hooks(work).status, 0);
  assert.equal(hooksIssue(work), null);
  assert.equal(check(work).status, 0);
});

test('git-hooks takes only install or check', (t) => {
  const { work } = checkout(t);
  const refused = run(work, process.execPath, [tool(import.meta.resolve('../../scripts/kit/git-hooks.mts')), 'remove']);
  assert.equal(refused.status, 2);
  assert.match(refused.stderr, /Usage: node scripts\/kit\/git-hooks\.mts install \| check/);
});

// A make target is the interface of kit that stays across its versions, and the path of a tool does not: the pre-push hook
// calls the target push-gate-hook, which kit.mk runs from the tools of KIT.
test('the pre-push hook calls the make target push-gate-hook and names no tool path', () => {
  assert.doesNotMatch(PRE_PUSH_CONTENT, /scripts\/kit|node_modules|\.mts|\.mjs/);
  assert.match(PRE_PUSH_CONTENT, /^exec make --no-print-directory push-gate-hook$/m);
  const dry = spawnSync('make', ['-n', '--no-print-directory', '-f', path.join(import.meta.dirname, '../../scripts/kit/kit.mk'), 'push-gate-hook', 'KIT=node_modules/@polyspec/kit/dist', 'KIT_EXT=mjs'], { encoding: 'utf8' });
  assert.equal(dry.status, 0, dry.stderr);
  // kit.mk starts the tool with the node of the checkout by its absolute path (K171); make names the directory by its real path.
  assert.equal(dry.stdout.trim(), `${path.join(realpathSync(process.cwd()), 'var/tools/bin/node')} node_modules/@polyspec/kit/dist/push-gate.mjs hook`);
});

// K380: kit owns the commit-msg hook, which runs the message checks of make commit on every commit, an amend included.
test('make hooks writes the commit-msg hook of kit, which refuses the footer of an AI tool at commit time (K380)', (t) => {
  const { work } = checkout(t);
  assert.equal(hooks(work).status, 0);
  const hook = path.join(work, '.githooks/commit-msg');
  assert.equal(statSync(hook).mode & 0o100, 0o100, 'the commit-msg hook is executable');
  const text = readFileSync(hook, 'utf8');
  assert.doesNotMatch(text, /scripts\/kit|node_modules|\.mts|\.mjs/);
  assert.match(text, /^cd "\$\(git rev-parse --show-toplevel\)" \|\| exit 1$/m);
  assert.match(text, /^exec make --no-print-directory commit-msg-hook MESSAGE="\$1"$/m);
  assert.equal(check(work).status, 0);

  rmSync(hook);
  assert.match(hooksIssue(work) ?? '', /\.githooks\/commit-msg does not exist; restore it from Git and run make hooks/);
  assert.match(check(work).stderr, /\.githooks\/commit-msg does not exist/);
  assert.equal(hooks(work).status, 0);

  // End to end: a commit with a valid message is made, and an amend that adds the footer of an AI tool is refused.
  writeFileSync(path.join(work, 'a.txt'), 'a\n');
  git(work, 'add', 'a.txt');
  const identity = ['-c', 'user.name=test', '-c', 'user.email=test@example.com'];
  const valid = 'feat(hooks): Refuse the footer of an AI tool (#T1-1)\n\nThe body names the change.\n';
  const first = run(work, 'git', [...identity, 'commit', '--quiet', '-m', valid]);
  assert.equal(first.status, 0, first.stderr);
  const head = git(work, 'rev-parse', 'HEAD');
  const footer = `${valid}\nCo-Authored-By: Claude Opus <noreply@anthropic.com>\n`;
  const amended = run(work, 'git', [...identity, 'commit', '--amend', '--quiet', '-m', footer]);
  assert.equal(amended.status, 1, 'the commit-msg hook refuses the amend');
  assert.match(amended.stderr, /commit-ai-footer/);
  assert.equal(git(work, 'rev-parse', 'HEAD'), head, 'the refused amend changes no commit');
});
