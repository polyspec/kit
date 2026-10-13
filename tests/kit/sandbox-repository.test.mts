// The Git repositories of the test sandboxes (tests/kit/sandbox-repository.mts). A git command in a sandbox starts no
// background process that outlives it, so the removal of the sandbox meets no entry that such a process creates. The git
// commands are traced through GIT_TRACE2_EVENT, which records each child process that a git command starts.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { removeSandbox } from './sandbox-cleanup.mts';
import { initRepository } from './sandbox-repository.mts';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** A temporary directory, removed with `t.after`. */
function sandbox(t: TestContext, prefix: string) {
  const directory = mkdtempSync(path.join(tmpdir(), prefix));
  t.after(() => removeSandbox(directory));
  return directory;
}

/** Runs git in `cwd` with the trace of every git process appended to `trace`; fails on a nonzero status. */
function git(cwd: string, trace: string, ...args: string[]) {
  const env = { ...process.env, GIT_TRACE2_EVENT: trace };
  const result = spawnSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.com', ...args], { cwd, env, encoding: 'utf8' });
  assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
}

/** The argument lists of the child processes that the traced git commands started. */
function children(trace: string): string[] {
  return readFileSync(trace, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line))
    .filter(event => event.event === 'child_start').map(event => event.argv.join(' '));
}

/** The children that run maintenance: `git maintenance run --auto --detach` and `git gc --auto` detach from the command. */
const maintenance = (trace: string) => children(trace).filter(argv => /^git (maintenance|gc)\b/.test(argv));

/** A sandbox repository with files added. */
function filled(t: TestContext, trace: string) {
  const root = sandbox(t, 'kit-sandbox-repository-');
  initRepository(root);
  for (let index = 0; index < 3; index += 1) writeFileSync(path.join(root, `file-${index}.txt`), `${index}\n`);
  git(root, trace, 'add', '-A');
  return root;
}

test('a commit in a sandbox repository starts no git maintenance that outlives it', (t) => {
  const trace = path.join(sandbox(t, 'kit-sandbox-trace-'), 'trace.json');
  const root = filled(t, trace);
  git(root, trace, 'commit', '--quiet', '-m', 'files');
  assert.deepEqual(maintenance(trace), []);
});

test('a push into a bare sandbox repository starts no git maintenance there', (t) => {
  const trace = path.join(sandbox(t, 'kit-sandbox-trace-'), 'trace.json');
  const root = filled(t, trace);
  const remote = path.join(sandbox(t, 'kit-sandbox-remote-'), 'remote.git');
  initRepository(remote, '--bare');
  git(root, trace, 'commit', '--quiet', '-m', 'files');
  git(root, trace, 'push', '--quiet', remote, 'HEAD:refs/heads/main');
  assert.ok(children(trace).some(argv => argv.includes('receive-pack')), 'the push is traced through the receiving side');
  assert.deepEqual(maintenance(trace), []);
});

/** The test files of `directory` that the scan reads, and those of them that run git init themselves. */
function callersOf(directory: string) {
  const scanned = readdirSync(directory).sort().filter(name => name.endsWith('.mts') && name !== 'sandbox-repository.mts' && name !== 'sandbox-repository.test.mts');
  const callers = scanned.filter(name => /['"]init['"]/.test(readFileSync(path.join(directory, name), 'utf8')));
  return { scanned, callers };
}

test('every Git repository of the kit tests is created through initRepository', () => {
  const { scanned, callers } = callersOf(HERE);
  // An empty selection would pass without reading anything, as it did after the tools were renamed (K110).
  assert.ok(scanned.length > 0, 'the scan read no test file of tests/kit');
  assert.deepEqual(callers, [], 'these files run git init themselves');
});

test('the scan names a test file that runs git init itself', (t) => {
  const directory = sandbox(t, 'kit-sandbox-scan-');
  writeFileSync(path.join(directory, 'fake.test.mts'), "import { spawnSync } from 'node:child_process';\nspawnSync('git', ['init', 'x']);\n");
  writeFileSync(path.join(directory, 'other.test.mts'), "import { initRepository } from './sandbox-repository.mts';\ninitRepository('x');\n");
  assert.deepEqual(callersOf(directory), { scanned: ['fake.test.mts', 'other.test.mts'], callers: ['fake.test.mts'] });
});
