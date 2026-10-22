// K498: the link writes the Bash PreToolUse hook of the kit that runs it into the untracked .claude/settings.local.json of
// a consumer checkout, keeps the other keys of that file, ignores the file through the Git exclude of the consumer, and
// link-state-check names the file while it lacks the hook.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import nodeTest, { type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { projectHookFindings, projectHookFile, writeProjectHook } from '../../scripts/kit/link.mts';
import { readJsonObject } from '../../scripts/kit/bootstrap/files.mts';
import { initRepository } from './sandbox-repository.mts';

const KIT = fileURLToPath(new URL('../../', import.meta.url));
const HOOK = path.join(KIT, 'scripts/kit/claude-hook.mts');
// The entry names the node of this kit, as the link writes it (K498-3), and the claude-hook beside the link.
const command = `'${path.join(KIT, 'var/tools/bin/node')}' '${HOOK}'`;
const entry = { matcher: 'Bash', hooks: [{ type: 'command', command }] };

/** A git consumer checkout in a temporary folder, removed when the test ends. */
function consumer(t: TestContext): string {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-project-hook-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const directory = path.join(root, 'cons');
  initRepository(directory);
  return directory;
}

const test = (name: string, body: (t: TestContext) => void): void => { void nodeTest(`K498: ${name}`, { timeout: 60_000 }, body); };

test('writeProjectHook writes the Bash PreToolUse hook of the running kit into the settings.local.json of the consumer', (t) => {
  const project = consumer(t);
  assert.equal(writeProjectHook(project), path.join(project, '.claude/settings.local.json'));
  assert.equal(projectHookFile(project), path.join(project, '.claude/settings.local.json'));
  assert.deepEqual(readJsonObject(project, '.claude/settings.local.json'), { hooks: { PreToolUse: [entry] } });
});

test('writeProjectHook keeps the other keys and replaces an earlier kit entry, and a second run writes the same bytes', (t) => {
  const project = consumer(t);
  const file = path.join(project, '.claude/settings.local.json');
  const other = { matcher: 'Edit', hooks: [{ type: 'command', command: 'echo edit' }] };
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ model: 'sonnet', hooks: { PreToolUse: [other, { matcher: 'Bash', hooks: [{ type: 'command', command: "'/old/node' '/old/kit/scripts/kit/claude-hook.mts'" }] }] } }));
  writeProjectHook(project);
  assert.deepEqual(readJsonObject(project, '.claude/settings.local.json'), { model: 'sonnet', hooks: { PreToolUse: [other, entry] } });
  const first = readFileSync(file, 'utf8');
  writeProjectHook(project);
  assert.equal(readFileSync(file, 'utf8'), first);
});

test('the settings.local.json of the consumer is ignored through the Git exclude of the consumer, and no tracked file changes', (t) => {
  const project = consumer(t);
  writeProjectHook(project);
  assert.equal(spawnSync('git', ['-C', project, 'check-ignore', '-q', '.claude/settings.local.json']).status, 0);
  assert.equal(spawnSync('git', ['-C', project, 'status', '--porcelain']).stdout.toString(), '');
});

test('projectHookFindings names the file while it lacks the hook, and passes after writeProjectHook', (t) => {
  const project = consumer(t);
  const file = path.join(project, '.claude/settings.local.json');
  assert.ok(projectHookFindings(project).some(finding => finding.includes(file) && /make link/.test(finding)));
  writeProjectHook(project);
  assert.deepEqual(projectHookFindings(project), []);
});

// K506: the hook entry is written before the packages are linked, whatever their result, so a checkout without installs gets it.
test('link --project writes the hook entry even when a polyspec package has no provider and the link fails (K506)', (t) => {
  const project = consumer(t);
  writeFileSync(path.join(project, 'package.json'), JSON.stringify({ name: 'consumer', private: true, dependencies: { '@polyspec/x': '0.0.1' } }));
  const result = spawnSync(process.execPath, [path.join(KIT, 'scripts/kit/link.mts'), 'link', '--project', project], { encoding: 'utf8' });
  assert.notEqual(result.status, 0, 'the link fails for the package without a provider');
  assert.deepEqual(readJsonObject(project, '.claude/settings.local.json'), { hooks: { PreToolUse: [entry] } });
});

// K498-3: the entry that the link writes is the one its check reads, whatever node runs each of them.
test('a consumer written by the link passes the check when the check runs under another node binary (K498-3)', (t) => {
  const project = consumer(t);
  writeFileSync(path.join(project, 'package.json'), JSON.stringify({ name: 'consumer', private: true }));
  // The toolchain node of this kit is one node; the writer runs under another, so the two process.execPath values differ.
  const kitNode = path.join(KIT, 'var/tools/bin/node');
  assert.ok(existsSync(kitNode), `the toolchain node ${kitNode} is missing: run make install-tools`);
  const execPathOf = (binary: string) => spawnSync(binary, ['-p', 'process.execPath'], { encoding: 'utf8' }).stdout.trim();
  const candidates = spawnSync('/bin/sh', ['-c', 'which -a node'], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean);
  const writer = [process.execPath, ...candidates].find(binary => execPathOf(binary) !== '' && execPathOf(binary) !== execPathOf(kitNode));
  assert.ok(writer !== undefined, 'a second node binary that differs from the toolchain node is needed');
  const link = path.join(KIT, 'scripts/kit/link.mts');
  // The link writes the entry; it fails for the missing packages after the write, as K506 keeps.
  spawnSync(writer, [link, 'link', '--project', project], { encoding: 'utf8' });
  assert.ok(existsSync(path.join(project, '.claude/settings.local.json')), 'the link wrote the settings file');
  const check = spawnSync(kitNode, [link, 'check', '--project', project], { encoding: 'utf8' });
  const hookFindings = `${check.stdout}${check.stderr}`.split('\n').filter(line => line.includes('claude-hook'));
  assert.deepEqual(hookFindings, [], `the check under the toolchain node reports the written entry as differing: ${hookFindings.join(' | ')}`);
});
