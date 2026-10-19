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
    assert.match(refusal(command, anyFile) ?? '', /polls/, `refused: ${command}`);
  }
  assert.equal(refusal('for f in a b; do echo $f; done', anyFile), null);
  assert.equal(refusal('sleep 1', anyFile), null, 'a sleep outside a loop has its known end');
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

test('a test target of a runtime needs CASES, and the suites run only in CI (K244)', () => {
  assert.match(refusal('make test-go') ?? '', /make test-go without CASES runs only in CI/);
  assert.equal(refusal('make test-go CASES=TestParse'), null);
  assert.match(refusal('make test-integration') ?? '', /make test-integration runs only in CI/);
  assert.match(refusal('make test-conformance CASES=x') ?? '', /make test-conformance runs only in CI/);
});

test('make test runs the unit tests of every runtime, so it runs only in CI (K246)', () => {
  assert.match(refusal('make test') ?? '', /make test runs only in CI/);
  assert.match(refusal('make test CASES=x') ?? '', /make test runs only in CI/);
});
