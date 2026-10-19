// Tests of K248: every rule of PRINCIPLES.md and AGENTS.md names the check that enforces it, and that check runs at a point
// that cannot be skipped: a step of a CI workflow, a Git hook of .githooks or the Claude Code hook of .claude/settings.json.
import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { checkRules } from '../../scripts/kit/check-rules.mts';
import { tree } from './tree.mts';

const MAKEFILE = `CHECK_TARGETS := unit-test docs-check
ci-run: lint
\t$(MAKE) $(CHECK_TARGETS)
lint:
\t@echo lint
unit-test:
\tnode scripts/kit/run-tests.mts node -- tests/unit
docs-check:
\t@echo docs
push-gate-hook:
\t@echo gate
orphan:
\t@echo nobody runs it
`;
const CI = `name: ci
on: push
jobs:
  test:
    runs-on: ubuntu-24.04
    steps:
      - name: checks
        if: \${{ !cancelled() }}
        run: make ci-run
      - name: report
        run: |
          echo "\${{ github.sha }}"
          make docs-check
`;
const PRE_PUSH = '#!/bin/sh\nexec make --no-print-directory push-gate-hook\n';
const SETTINGS = JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'node scripts/kit/claude-hook.mts' }] }] } });

function repository(t: TestContext, agents: string, korean = agents.replaceAll('Rules', '규칙')) {
  return tree(t, {
    Makefile: MAKEFILE,
    '.github/workflows/ci.yml': CI,
    '.githooks/pre-push': PRE_PUSH,
    '.claude/settings.json': SETTINGS,
    'tests/unit/a.test.mts': '',
    'tests/other/b.test.mts': '',
    'AGENTS.md': agents,
    'AGENTS.ko.md': korean,
  });
}

const rules = (...items: string[]) => `# Rules\n\n${items.join('\n')}\n`;

test('a rule enforced by a target that CI runs, a prerequisite, a target of a recipe, a hook target or a test file passes', (t) => {
  const root = repository(t, rules(
    '- Lint passes.\n  Enforced by: `make lint`',
    '- Units pass.\n  Enforced by: `make unit-test`, `tests/unit/a.test.mts`',
    '- Documents hold.\n  Enforced by: `make docs-check`',
    '- A push holds no item in progress.\n  Enforced by: `make push-gate-hook`',
    '- A suite runs only in CI.\n  Enforced by: `.claude/settings.json`',
    '- Questions are needed.\n  Enforced by: none, no tool can judge whether a question is needed.',
  ));
  const result = checkRules(root, ['AGENTS.md']);
  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.unenforced.map(rule => rule.line), [13]);
});

test('a rule without the field, with an unknown or unreached target, an unreached test file or none without a reason fails', (t) => {
  const root = repository(t, rules(
    '- No field.',
    '- Unknown.\n  Enforced by: `make absent`',
    '- Unreached.\n  Enforced by: `make orphan`',
    '- A test that no reached recipe runs.\n  Enforced by: `tests/other/b.test.mts`',
    '- A missing file.\n  Enforced by: `tests/unit/missing.test.mts`',
    '- No reason.\n  Enforced by: none',
  ));
  const { findings } = checkRules(root, ['AGENTS.md']);
  assert.deepEqual(findings, [
    'AGENTS.md:3: the rule names no check; end it with `Enforced by: <check>` or `Enforced by: none, <reason>`',
    'AGENTS.md:4: make absent is no target of the Makefile',
    'AGENTS.md:6: make orphan runs at no point that cannot be skipped: no CI workflow, Git hook or Claude Code hook reaches it',
    'AGENTS.md:8: tests/other/b.test.mts runs at no point that cannot be skipped: no recipe of a reached target names it',
    'AGENTS.md:10: tests/unit/missing.test.mts does not exist',
    'AGENTS.md:12: `Enforced by: none` needs the reason that no tool can enforce the rule: `Enforced by: none, <reason>`',
  ]);
});

test('the Korean twin names the same checks for each rule', (t) => {
  const root = repository(t, rules('- Lint passes.\n  Enforced by: `make lint`'), rules('- Lint은 통과한다.\n  Enforced by: `make docs-check`'));
  const { findings } = checkRules(root, ['AGENTS.md']);
  assert.deepEqual(findings, ['AGENTS.ko.md:3: the rule names `make docs-check`, and AGENTS.md:3 names `make lint`; a twin names the same checks']);
});

test('a document without rules fails, so a check that reads nothing never passes', (t) => {
  const root = repository(t, '# Rules\n\nNo list.\n');
  assert.deepEqual(checkRules(root, ['AGENTS.md']).findings, ['AGENTS.md: the document holds no rule; a rule is an item of a top-level list']);
});

test('a rule that a planned item will enforce names its open item; a closed or unknown item fails (K248)', (t) => {
  const checklist = '# Plan\n\n| ID | Task | State |\n|---|---|---|\n| K1 | Build the check | [ ] |\n| K2 | Built | [o] |\n';
  const root = tree(t, {
    Makefile: MAKEFILE,
    '.github/workflows/ci.yml': CI,
    'config/checklist.json': JSON.stringify({ schema: 1, hooks: ['pre-push'], idPattern: 'K[0-9]+' }),
    'docs/plans/x/checklist.md': checklist,
    'AGENTS.md': rules('- Open.\n  Enforced by: planned K1', '- Closed.\n  Enforced by: planned K2', '- Unknown.\n  Enforced by: planned K9', '- Both.\n  Enforced by: `make lint`, planned K1'),
  });
  const { findings, planned } = checkRules(root, ['AGENTS.md']);
  assert.deepEqual(findings, [
    'AGENTS.md:5: planned K2 is done; name the check that K2 built',
    'AGENTS.md:7: planned K9 names no item of a checklist of docs/plans',
  ]);
  assert.deepEqual(planned.map(rule => `${rule.line} ${rule.item}`), ['3 K1', '9 K1']);
});
