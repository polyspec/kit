// Tests of the Claude Code hook beyond the suite (K248): it refuses a command that skips the Git hooks or polls with no known
// end, and an edit of a file that kit vendors into a consumer repository.
import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { refusal, toolRefusal } from '../../scripts/kit/claude-hook.mts';
import { tree } from './tree.mts';

const anyFile = () => true;

test('the hook refuses a command that skips the Git hooks or changes the hooks path', () => {
  for (const command of [
    'git commit --no-verify -m x',
    'git commit -n -m x',
    'git commit -anm x',
    'git push --no-verify origin main',
    'git -c core.hooksPath=/dev/null commit -m x',
    'git config core.hooksPath other',
    'git config --unset core.hooksPath',
  ]) assert.match(refusal(command, anyFile) ?? '', /Git hook/, `refused: ${command}`);
  for (const command of ['git commit -m "x -n y"', 'git config core.hooksPath .githooks', 'git push origin main', 'git log -n 3']) {
    assert.equal(refusal(command, anyFile), null, `allowed: ${command}`);
  }
});

test('the hook refuses a loop that polls with a sleep, and allows a loop without one', () => {
  for (const command of ['while true; do gh run list; sleep 30; done', 'until test -f done.txt; do sleep 5; done']) {
    assert.match(refusal(command, anyFile) ?? '', /which has no known end/, `refused: ${command}`);
  }
  assert.equal(refusal('for f in a b; do echo $f; done', anyFile), null);
  assert.match(refusal('sleep 1', anyFile) ?? '', /sleep 1 waits/, 'a sleep is refused too (K386)');
});

test('the hook refuses a command that waits: a sleep, and a loop that sleeps or polls (K386)', () => {
  const waits = /which has no known end: run one foreground command bounded by its own work and its timeout, or a run in the background that notifies at its end/;
  for (const command of [
    'sleep 280; echo waited',
    'make build && sleep 5',
    'env X=1 sleep 3',
    'for i in $(seq 1 150); do pgrep -f "make install-tools" >/dev/null || break; sleep 3; done',
  ]) assert.match(refusal(command, anyFile) ?? '', waits, `refused: ${command}`);
  for (const command of ['for f in a b; do echo $f; done', 'grep sleep notes.txt', 'echo done']) {
    assert.equal(refusal(command, anyFile), null, `allowed: ${command}`);
  }
});

// K386-1: a for loop over a list ends with its list, so a test in it polls nothing; a while or until loop can wait on a state.
test('a test or ls in a for loop over a list is allowed, and in a while or until loop it polls (K386-1)', () => {
  for (const command of [
    'for file in vendor-php/autoload.php vendor-php/bin/phpunit; do test -f $file || { echo missing; exit 1; }; done',
    'for i in 1 2 3; do test -f done.txt && break; done',
    'for f in *.ts; do ls $f; done',
  ]) assert.equal(refusal(command, anyFile), null, `allowed: ${command}`);
  for (const command of ['while ! test -f done.txt; do :; done', 'until pgrep -f server; do echo wait; done', 'while true; do ls out; done', 'for f in a b; do sleep 1; done']) {
    assert.match(refusal(command, anyFile) ?? '', /which has no known end/, `refused: ${command}`);
  }
});

test('an edit of a file that kit vendors is refused in a consumer and allowed in kit itself', (t) => {
  const kitPackage = { name: '@polyspec/kit', version: '0.0.1', kit: { copies: { 'PRINCIPLES.md': 'PRINCIPLES.md', '.claude/settings.json': 'claude/settings.json' } } };
  const consumer = tree(t, {
    'package.json': JSON.stringify({ name: 'consumer', devDependencies: { '@polyspec/kit': '0.0.1' } }),
    'node_modules/@polyspec/kit/package.json': JSON.stringify(kitPackage),
    'PRINCIPLES.md': '# Principles\n',
    'src/a.ts': '',
  });
  const edit = (file: string, tool = 'Edit') => toolRefusal({ tool_name: tool, tool_input: { file_path: path.join(consumer, file) } }, consumer);
  assert.match(edit('PRINCIPLES.md') ?? '', /vendors .*PRINCIPLES\.md.*make kit-sync/);
  assert.match(edit('.claude/settings.json', 'Write') ?? '', /vendors/);
  assert.equal(edit('src/a.ts'), null);
  const kit = tree(t, { 'package.json': JSON.stringify(kitPackage), 'PRINCIPLES.md': '# Principles\n' });
  assert.equal(toolRefusal({ tool_name: 'Edit', tool_input: { file_path: path.join(kit, 'PRINCIPLES.md') } }, kit), null, 'kit is the source of the copies');
});

test('a Bash input runs the command check, and another tool passes', () => {
  assert.match(toolRefusal({ tool_name: 'Bash', tool_input: { command: 'make check' } }, '/') ?? '', /CI/);
  assert.equal(toolRefusal({ tool_name: 'Read', tool_input: { file_path: '/x' } }, '/'), null);
});

// A make database with the suite of a repository's own Makefile and a unit target, as makeDatabase reads it.
const MAKE = {
  targets: new Map([
    ['kit-test', { prerequisites: ['build'], recipe: '@mkdir -p var\n$(NODE) scripts/kit/run-tests.mts node -- tests/kit' }],
    ['build', { prerequisites: [], recipe: 'tsc -p tsconfig.build.json' }],
    ['unit', { prerequisites: [], recipe: '$(NODE) scripts/kit/run-tests.mts node -- tests/kit/plan.test.mts' }],
    ['all', { prerequisites: [], recipe: '$(MAKE) kit-test' }],
  ]),
  variables: new Map([['NODE', '/repo/var/tools/bin/node']]),
};
const named = (file: string) => /\.[a-z]+$/.test(file);

test('a make target whose recipes or prerequisites run a suite is refused, as the suite would be (K249-3)', () => {
  assert.match(refusal('make kit-test', named, () => MAKE) ?? '', /^make kit-test runs .*run-tests\.mts node -- tests\/kit runs a whole runtime without a selection/);
  assert.match(refusal('make all', named, () => MAKE) ?? '', /^make all runs make kit-test runs /);
  assert.equal(refusal('make unit', named, () => MAKE), null);
  assert.equal(refusal('make build', named, () => MAKE), null);
});

test('run-tests runs its runner over the arguments after --, so it needs their selection (K249-3)', () => {
  assert.match(refusal('node scripts/kit/run-tests.mts node -- tests/kit', named) ?? '', /runs a whole runtime without a selection/);
  assert.equal(refusal('node scripts/kit/run-tests.mts node -- tests/kit/plan.test.mts', named), null);
  assert.match(refusal('node scripts/kit/run-tests.mts go -- ./...', named) ?? '', /add -run <pattern>/);
  assert.equal(refusal('node scripts/kit/run-tests.mts go -- -run TestParse ./...', named), null);
});

// K353-2: the hook reads the options of run-tests.mts as the runner does, so a command that the runner runs is allowed.
test('the hook resolves a file of run-tests from its --cwd and takes the arguments after its options, as the runner does (K353-2)', () => {
  const files = new Set(['tests/XTest.php', 'tests/x.test.mts']);
  const at = (file: string) => files.has(file);
  assert.equal(refusal('node scripts/kit/run-tests.mts phpunit --cwd packages/php -- ../../tests/XTest.php', at), null, 'the runner runs ../../tests/XTest.php from packages/php');
  assert.match(refusal('node scripts/kit/run-tests.mts phpunit --cwd packages/php -- tests/XTest.php', at) ?? '', /without a selection/, 'packages/php/tests/XTest.php is no file');
  assert.equal(refusal('node scripts/kit/run-tests.mts node --timeout 30 tests/x.test.mts', at), null, 'the runner takes the arguments after its options without --');
  assert.match(refusal('node scripts/kit/run-tests.mts node --timeout 30', at) ?? '', /without a selection/);
});

test('a test target of a runtime needs CASES, and the suites run only in CI (K244)', () => {
  assert.match(refusal('make test-go') ?? '', /make test-go without CASES runs only in CI/);
  assert.equal(refusal('make test-go CASES=TestParse'), null);
  assert.match(refusal('make test-php-ext') ?? '', /make test-php-ext without CASES runs only in CI/);
  assert.match(refusal('make test-integration') ?? '', /make test-integration runs only in CI/);
  assert.match(refusal('make test-conformance CASES=x') ?? '', /make test-conformance runs only in CI/);
});

test('make test runs the unit tests of every runtime, so it runs only in CI (K246)', () => {
  assert.match(refusal('make test') ?? '', /make test runs only in CI/);
  assert.match(refusal('make test CASES=x') ?? '', /make test runs only in CI/);
});

// K528: the script of a shell's -c is one word of the command, so the hook reads it as a command of its own with all its rules.
test('the hook reads the script of sh, bash, zsh and dash -c, so a loop that sleeps there is refused (K528)', () => {
  for (const command of [
    'bash -c "until grep -q x f; do sleep 5; done"',
    "sh -c 'while ! test -f out; do sleep 15; done'",
    'zsh -lc "until [ -s out ]; do sleep 2; done"',
    'cd /x && dash -ec "sleep 30"',
  ]) assert.match(refusal(command) ?? '', /no known end/, command);
  assert.equal(refusal('bash -c "grep -q x f && echo found"'), null, 'a script that does not wait is allowed');
});
