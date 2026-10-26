// Tests of K240, K654 and K658: suites run in CI or an explicit clean-tree final verification. ci-only.mts decides whether a suite may run,
// test-selection.mts whether a test run selects its tests, and claude-hook.mts refuses the Bash commands of an agent
// that run a suite, a whole runtime without a selection, or set the variable that marks a CI run.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { ciRefusal } from '../../scripts/kit/ci-only.mts';
import { selects } from '../../scripts/kit/test-selection.mts';
import { refusal } from '../../scripts/kit/claude-hook.mts';
import { ciTargets } from '../../scripts/kit/ci-targets.mts';
import { tree, put } from './tree.mts';
import { KIT } from './kit-tools.mts';
import { readFixture } from './json-fixture.mts';

test('a suite command refuses outside a GitHub Actions run and names the unit test command', () => {
  const message = ciRefusal('make ci-targets', {});
  assert.ok(message, 'expected a refusal without GITHUB_ACTIONS');
  assert.match(message, /make ci-targets runs only in CI/);
  assert.match(message, /run-tests\.mts <tool> -- <test file>/);
  assert.equal(ciRefusal('make ci-targets', { GITHUB_ACTIONS: 'true' }), null);
  assert.ok(ciRefusal('make ci-targets', { GITHUB_ACTIONS: 'false' }), 'only the value true marks a CI run');
});

test('ci-targets runs no target outside CI', async (t) => {
  const root = tree(t, { Makefile: 'good:\n\t@echo ran-good\n' });
  const printed: string[] = [];
  const outputs: string[] = [];
  const status = await ciTargets({ root, directory: 'var/report/ci', targets: ['good'], environment: { node: 'v-test' }, env: { PATH: process.env.PATH }, print: line => printed.push(line), output: text => outputs.push(text) });
  assert.equal(status, 1);
  assert.equal(outputs.join(''), '', 'no target ran');
  assert.match(printed.join('\n'), /runs only in CI/);
});

test('a test run selects its tests by a file, a name filter or a test id, per runner', () => {
  const cases: Array<[string, string[], boolean]> = [
    ['node', ['tests/kit'], false],
    ['node', [], false],
    ['node', ['tests/kit/ci-only.test.mts'], true],
    ['node', ['--test-name-pattern', 'refuses', 'tests/kit'], true],
    ['vitest', ['run'], false],
    ['vitest', ['run', 'tests/a.test.ts'], true],
    ['vitest', ['run', '-t', 'parses'], true],
    ['go', ['./...'], false],
    ['go', ['-run', '^TestParse$', './...'], true],
    ['cargo', [], false],
    ['cargo', ['--', '--nocapture'], false],
    ['cargo', ['parse_header'], true],
    ['cargo', ['--test', 'statement_fault'], true],
    ['phpunit', [], false],
    ['phpunit', ['--filter', 'test_parse'], true],
    ['phpunit', ['tests/ParseTest.php'], true],
    ['python', ['discover', '-s', 'tests'], false],
    ['python', [], false],
    ['python', ['tests.test_parse'], true],
    ['python', ['-k', 'parse', 'discover'], true],
  ];
  for (const [tool, args, expected] of cases) {
    assert.equal(selects(tool, args, (file) => !file.endsWith('tests/kit') && !file.endsWith('tests')), expected, `${tool} ${args.join(' ')}`);
  }
});

test('the Claude Code hook refuses a suite target, a whole runtime and a CI marker, and allows a selected test', () => {
  const refused = [
    'make check',
    'make -s check',
    'cd packages && make rerun-failed',
    'make ci-targets TARGETS="kit-test"',
    'make owner-check',
    'make parity-check',
    'go test ./...',
    'cd packages/go && go test ./engine/...',
    'cargo test',
    'cargo test --workspace',
    'vendor/bin/phpunit',
    'php vendor/bin/phpunit -c phpunit.xml',
    'node --test tests/kit',
    'npx vitest run',
    'python3 -m unittest discover -s tests',
    'GITHUB_ACTIONS=true make ci-targets TARGETS=x',
    'export GITHUB_ACTIONS=true',
    'env GITHUB_ACTIONS=true node scripts/kit/ci-targets.mts var/r kit-test',
  ];
  for (const command of refused) assert.ok(refusal(command, (file) => !/(^|\/)tests(\/kit)?$/.test(file)), `refused: ${command}`);
  const allowed = [
    'make owner-validate',
    'make parity-check UNITS="kit-parity"',
    'make docs-check',
    'node --test tests/kit/ci-only.test.mts',
    'node scripts/kit/run-tests.mts node -- tests/kit/ci-only.test.mts',
    'go test -run ^TestParse$ ./engine/...',
    'cargo test parse_header',
    'vendor/bin/phpunit --filter test_parse',
    'python3 -m unittest tests.test_parse',
    'git status',
    'echo "make check"',
  ];
  for (const command of allowed) assert.equal(refusal(command, (file) => !/(^|\/)tests(\/kit)?$/.test(file)), null, `allowed: ${command}`);
});

test('the refusal of the hook names the command that runs instead', () => {
  assert.match(refusal('make check', () => true) ?? '', /CI/);
  assert.match(refusal('go test ./...', () => true) ?? '', /-run/);
});

test('no local command runs the full suite: full-run, make check and rerun-failed are removed', () => {
  assert.equal(existsSync(path.join(KIT, 'full-run.mts')), false, 'scripts/kit/full-run.mts is removed');
  const mk = readFileSync(path.join(KIT, 'kit.mk'), 'utf8');
  assert.doesNotMatch(mk, /full-run/);
  assert.doesNotMatch(mk, /^rerun-failed:/m);
  const makefile = readFileSync(path.join(KIT, '../../Makefile'), 'utf8');
  assert.doesNotMatch(makefile, /^check:/m);
});

test('the vendored Claude Code settings run the consumer Node and native npm hook bin before every Bash command (K686-2)', () => {
  type Settings = { hooks: { PreToolUse: Array<{ matcher: string; hooks: Array<{ type: string; command: string }> }> } };
  const settings = readFixture<Settings>(path.join(KIT, '../..'), 'claude/settings.json');
  const entry = settings.hooks.PreToolUse.find(item => item.matcher === 'Bash');
  assert.ok(entry, 'a PreToolUse entry for Bash');
  assert.deepEqual(entry.hooks, [{
    type: 'command',
    command: '"$CLAUDE_PROJECT_DIR"/var/tools/bin/node "$CLAUDE_PROJECT_DIR"/node_modules/.bin/polyspec-kit-hook',
  }], 'the Bash hook uses the consumer runtime and the command link owned by npm');
});

function finalTree(t: Parameters<typeof tree>[0], state: string) {
  const checklist = `| ID | Task | Deliverables | Verification | State |\n|---|---|---|---|---|\n| K1 | Finish | file | command | ${state} |\n`;
  const root = tree(t, {
    'config/checklist.json': JSON.stringify({ schema: 1, hooks: ['pre-push'], idPattern: 'K[0-9]+' }),
    'docs/plans/final/checklist.md': checklist,
    'docs/plans/final/checklist.ko.md': checklist,
  });
  commitTree(root);
  return root;
}

function commitTree(root: string) {
  for (const args of [['add', '.'], ['commit', '--quiet', '-m', 'test: prepare final-run fixture']]) {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
  }
}

test('K658 explicit local final verification allows waiting items but refuses active work and dirty trees', t => {
  for (const state of ['[o]', '[-] cause: impossible', '[!] cause: external; retry: available']) {
    const root = finalTree(t, state);
    assert.equal(ciRefusal('make ci-targets', { FINAL_RUN: '1' }, root), null, state);
    assert.ok(ciRefusal('make ci-targets', { FINAL_RUN: 'true' }, root), 'only 1 opts in');
  }
  const waiting = finalTree(t, '[ ]');
  assert.equal(ciRefusal('make ci-targets', { FINAL_RUN: '1' }, waiting), null, 'a clean committed pending item may await the final verification');
  for (const state of ['[~]']) {
    const root = finalTree(t, state);
    const result = ciRefusal('make ci-targets', { FINAL_RUN: '1' }, root);
    assert.ok(result);
    assert.match(result, /K1/);
    assert.ok(result.includes(state));
  }
  const dirty = finalTree(t, '[ ]');
  put(dirty, { 'README.md': 'uncommitted change\n' });
  assert.match(ciRefusal('make ci-targets', { FINAL_RUN: '1' }, dirty) ?? '', /clean committed tree/);
  const missing = tree(t);
  assert.match(ciRefusal('make ci-targets', { FINAL_RUN: '1' }, missing) ?? '', /config\/checklist.json/);
  const empty = finalTree(t, '[o]');
  put(empty, { 'docs/plans/final/checklist.md': null, 'docs/plans/final/checklist.ko.md': null });
  assert.match(ciRefusal('make ci-targets', { FINAL_RUN: '1' }, empty) ?? '', /readable matching checklists/);
  const malformed = finalTree(t, '[o]');
  put(malformed, { 'docs/plans/final/checklist.ko.md': null });
  assert.match(ciRefusal('make ci-targets', { FINAL_RUN: '1' }, malformed) ?? '', /checklist.ko.md/);
});

test('K654 the hook permits only the explicit guarded ci-targets final command', () => {
  assert.equal(refusal('make ci-targets FINAL_RUN=1 TARGETS="test"'), null);
  assert.ok(refusal('make ci-targets FINAL_RUN=true TARGETS="test"'));
  assert.ok(refusal('FINAL_RUN=1 node --test tests/kit'));
});

test('K654 ci-targets uses the explicit final checkout and writes its normal report', async t => {
  const root = finalTree(t, '[o]');
  put(root, { Makefile: 'good:\n\t@true\n' });
  commitTree(root);
  const status = await ciTargets({ root, directory: 'var/report/final', targets: ['good'],
    environment: { node: 'v-test' }, env: { PATH: process.env.PATH, FINAL_RUN: '1' },
    print: () => {}, output: () => {} });
  assert.equal(status, 0);
  assert.ok(existsSync(path.join(root, 'var/report/final/record.json')));
});
