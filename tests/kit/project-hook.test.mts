// K498, K960: hook writes the Bash PreToolUse hook of the kit that runs it into the untracked .claude/settings.local.json at the top
// of the work tree of a checkout, which Claude Code reads for a session started anywhere in it, and keeps the other keys of that
// file. K512: hook writes nothing into .git; whether Git ignores the file is the repository's own business (K966).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import nodeTest, { type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { writeProjectHook } from '../../scripts/kit/link.mts';
import { readJsonObject } from '../../scripts/kit/bootstrap/files.mts';
import { initRepository } from './sandbox-repository.mts';

const KIT = fileURLToPath(new URL('../../', import.meta.url));
// The entry names the node of this kit and its claude-hook, as hook writes it.
const command = `'${path.join(KIT, 'var/tools/bin/node')}' '${path.join(KIT, 'scripts/kit/claude-hook.mts')}'`;
const entry = { matcher: 'Bash', hooks: [{ type: 'command', command }] };
const FILE = '.claude/settings.local.json';

/** A git checkout in a temporary folder, removed when the test ends. */
function consumer(t: TestContext): string {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-project-hook-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const directory = path.join(root, 'cons');
  initRepository(directory);
  return directory;
}

const test = (name: string, body: (t: TestContext) => void): void => { void nodeTest(`K498: ${name}`, { timeout: 60_000 }, body); };

test('writeProjectHook writes the Bash PreToolUse hook of the running kit into the settings.local.json of the checkout', (t) => {
  const project = consumer(t);
  assert.equal(writeProjectHook(project), path.join(project, FILE));
  assert.deepEqual(readJsonObject(project, FILE), { hooks: { PreToolUse: [entry] } });
});

test('writeProjectHook writes at the top of the work tree for a directory below it, where Claude Code reads the file (K960)', (t) => {
  const project = consumer(t);
  mkdirSync(path.join(project, 'packages/a'), { recursive: true });
  assert.equal(writeProjectHook(path.join(project, 'packages/a')), path.join(project, FILE));
  assert.equal(existsSync(path.join(project, 'packages/a/.claude')), false);
});

test('writeProjectHook keeps the other keys and replaces an earlier kit entry, and a second run writes the same bytes', (t) => {
  const project = consumer(t);
  const file = path.join(project, FILE);
  const other = { matcher: 'Edit', hooks: [{ type: 'command', command: 'echo edit' }] };
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ model: 'sonnet', hooks: { PreToolUse: [other, { matcher: 'Bash', hooks: [{ type: 'command', command: "'/old/var/tools/bin/node' '/old/scripts/kit/claude-hook.mts'" }] }] } }));
  writeProjectHook(project);
  assert.deepEqual(readJsonObject(project, FILE), { model: 'sonnet', hooks: { PreToolUse: [other, entry] } });
  const first = readFileSync(file, 'utf8');
  writeProjectHook(project);
  assert.equal(readFileSync(file, 'utf8'), first);
});

// K512: the common Git directory of a worktree is the main checkout's, outside a sandboxed worktree, so hook never writes it.
test('writeProjectHook writes nothing into the Git directory of the checkout (K512)', (t) => {
  const project = consumer(t);
  const exclude = path.join(project, '.git/info/exclude');
  const before = existsSync(exclude) ? readFileSync(exclude, 'utf8') : undefined;
  writeProjectHook(project);
  assert.equal(existsSync(exclude) ? readFileSync(exclude, 'utf8') : undefined, before);
});

// K966: what a repository ignores is its own business, so hook writes the file whether or not Git ignores it.
test('writeProjectHook writes the settings file of a checkout whose Git does not ignore it (K966)', (t) => {
  const project = consumer(t);
  spawnSync('git', ['-C', project, 'config', 'core.excludesFile', '/dev/null']);
  assert.equal(writeProjectHook(project), path.join(project, FILE));
  assert.deepEqual(readJsonObject(project, FILE), { hooks: { PreToolUse: [entry] } });
});

test('link.mts hook --project writes the hook of the checkout and no workspace settings (K960)', (t) => {
  const project = consumer(t);
  const result = spawnSync(process.execPath, [path.join(KIT, 'scripts/kit/link.mts'), 'hook', '--project', project], { encoding: 'utf8' });
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  assert.deepEqual(readJsonObject(project, FILE), { hooks: { PreToolUse: [entry] } });
  assert.equal(existsSync(path.join(path.dirname(project), '.claude')), false);
});

test('writeProjectHook writes into the directory itself when it is no Git checkout (K960)', (t) => {
  const directory = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-project-hook-plain-')));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  assert.equal(writeProjectHook(directory), path.join(directory, FILE));
  assert.deepEqual(readJsonObject(directory, FILE), { hooks: { PreToolUse: [entry] } });
});

test('link.mts hook without --project writes the checkout and no settings of a workspace folder that holds no running kit (K440, K960)', (t) => {
  const project = consumer(t);
  const result = spawnSync(process.execPath, [path.join(KIT, 'scripts/kit/link.mts'), 'hook'], { cwd: project, encoding: 'utf8' });
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  assert.deepEqual(readJsonObject(project, FILE), { hooks: { PreToolUse: [entry] } });
  assert.equal(existsSync(path.join(path.dirname(project), '.claude')), false);
});
