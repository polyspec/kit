// Tests of K248: every rule of PRINCIPLES.md and AGENTS.md names the check that enforces it, and that check runs at a point
// that cannot be skipped: a step of a CI workflow, a Git hook of .githooks or the Claude Code hook of .claude/settings.json.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
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

test('a section opens with at most one paragraph, and a rule in prose after it fails (K243-1)', (t) => {
  const item = '- A rule.\n  Enforced by: `make docs-check`';
  const document = `# Rules\n\nThe title paragraph.\n\n## Release\n\nThe introduction.\n\n${item}\n\nA rule in prose.\n\n## Other\n\nOne paragraph.\n\nA second paragraph.\n`;
  const prose = checkRules(repository(t, document), ['AGENTS.md']).findings.filter(line => line.includes('paragraph'));
  assert.deepEqual(prose.map(line => line.split(':').slice(0, 2).join(':')), ['AGENTS.md:12', 'AGENTS.md:18']);
});

// K300: an AGENTS rule is Own, or Refines a PRINCIPLES rule by its id and names a term of the repository that PRINCIPLES.md does
// not contain (a tracked path, a make target or a configuration file), so a restatement of any length is a finding.
function principled(t: TestContext, agents: string[], principles = ['- P1 Components are modular, each concern clearly separated.\n  Enforced by: `make lint`', '- S1 No rebuilds.\n  Enforced by: `make docs-check`']) {
  return tree(t, {
    Makefile: MAKEFILE,
    '.github/workflows/ci.yml': CI,
    'PRINCIPLES.md': rules(...principles),
    'AGENTS.md': rules(...agents),
    'config/own.json': '{}\n',
  });
}
const both = ['PRINCIPLES.md', 'AGENTS.md'];

test('an AGENTS rule that is Own, or that Refines a rule by id with a term of the repository, passes (K300)', (t) => {
  const root = principled(t, [
    '- Own: Documents are checked on every change.\n  Enforced by: `make docs-check`',
    '- Refines P1: The modules of `config/own.json` stay apart.\n  Enforced by: `make lint`',
    '- Refines S1: Run `make unit-test` before a tool is added.\n  Enforced by: `make docs-check`',
  ]);
  assert.deepEqual(checkRules(root, both).findings, []);
});

test('an AGENTS rule that names neither Own nor a rule it refines, a rule that does not exist, or no term of the repository fails (K300)', (t) => {
  const root = principled(t, [
    '- Build modular components.\n  Enforced by: `make lint`',
    '- Refines P9: The `config/own.json` is a rule.\n  Enforced by: `make lint`',
    '- Refines P1: Build modular components, each concern separated.\n  Enforced by: `make lint`',
    '- Refines P1: Keep the `make lint` target of the principle.\n  Enforced by: `make lint`',
  ]);
  assert.deepEqual(checkRules(root, both).findings, [
    'AGENTS.md:3: the rule begins with neither `Own:` nor `Refines <id>:`; a rule of this repository is Own, or refines a rule of PRINCIPLES.md by its id',
    'AGENTS.md:5: Refines P9 names no rule of PRINCIPLES.md',
    'AGENTS.md:7: Refines P1 names no term of this repository that PRINCIPLES.md lacks (an existing path, a make target or a configuration file in backticks); a rule without one restates the principle',
    'AGENTS.md:9: Refines P1 names no term of this repository that PRINCIPLES.md lacks (an existing path, a make target or a configuration file in backticks); a rule without one restates the principle',
  ]);
});

test('a rule of PRINCIPLES.md without an id fails when AGENTS.md is read with it (K300)', (t) => {
  const root = principled(t, ['- Own: A rule.\n  Enforced by: `make docs-check`'], ['- Components are modular.\n  Enforced by: `make lint`']);
  assert.deepEqual(checkRules(root, both).findings, ['PRINCIPLES.md:3: the rule has no id; a rule of PRINCIPLES.md begins with P<n> or S<n>']);
});

test('a target is expanded for each set of variables it is called with, so every call of one recipe is reached (K312)', (t) => {
  const root = tree(t, {
    Makefile: 'ci-targets:\n\t@echo $(TARGETS)\nfirst:\n\t@echo first\nsecond:\n\t@echo second\n',
    '.github/workflows/ci.yml': 'name: ci\non: push\njobs:\n  a:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: make ci-targets TARGETS="first"\n      - run: make ci-targets TARGETS="second"\n',
    'AGENTS.md': rules('- Own: First.\n  Enforced by: `make first`', '- Own: Second.\n  Enforced by: `make second`'),
    'AGENTS.ko.md': rules('- Own: First.\n  Enforced by: `make first`', '- Own: Second.\n  Enforced by: `make second`'),
  });
  assert.deepEqual(checkRules(root, ['AGENTS.md']).findings, []);
});

// K359: the working guidelines of the owner are rules of PRINCIPLES.md, each with its Enforced by line in the same rule, and the
// Korean twin holds the same rule ids. Each phrase is a short part of the rule it belongs to.
const GUIDELINE_RULES: Array<[id: string, phrase: string]> = [
  ['P10', 'only by the fast-forward'],
  ['P22', 'Haiku 5.5'],
  ['P24', 'starts from its registered row'],
  ['P36', 'is registered as a row and worked now'],
  ['P37', 'reported only after its check has run'],
  ['P38', 'by one actor per checkout'],
  ['P20', 'order of the conductor'],
  ['S10', 'userland framework'],
];

/** The ids of the rules of a document, in order: each item that begins with P<n> or S<n>. */
const ruleIds = (text: string) => [...text.matchAll(/^- ([PS]\d+) /gm)].map(match => match[1]);

/** The text of each rule of a document by its id: the item line and its indented lines, up to the next item or blank line. */
function ruleTexts(text: string): Map<string, string> {
  const rules = new Map<string, string>();
  let current = '';
  for (const line of text.split('\n')) {
    const start = /^- ([PS]\d+) /.exec(line);
    if (start) {
      current = start[1] ?? '';
      rules.set(current, line);
    } else if (current !== '' && /^  \S/.test(line)) {
      rules.set(current, `${rules.get(current)}\n${line}`);
    } else {
      current = '';
    }
  }
  return rules;
}

test('the working guidelines are stated in PRINCIPLES.md, each in its own rule with its Enforced by, and the Korean twin holds the same rule ids (K359)', () => {
  const principles = readFileSync(new URL('../../PRINCIPLES.md', import.meta.url), 'utf8');
  const korean = readFileSync(new URL('../../PRINCIPLES.ko.md', import.meta.url), 'utf8');
  const rules = ruleTexts(principles);
  for (const [id, phrase] of GUIDELINE_RULES) {
    const rule = rules.get(id) ?? '';
    assert.ok(rule.includes(phrase), `${id} states "${phrase}"`);
    assert.match(rule, /^  Enforced by: /m, `${id} has its Enforced by line`);
  }
  assert.deepEqual(ruleIds(korean), ruleIds(principles));
});

// K359-1: a rule names the check that a done item built, not the item: P24 names the commit-row rule of commits-check (K424) and
// S10 the check of dependency-policy-check (K425), so the principles of kit pass the check of the rules.
test('the principles of kit name the checks that their done items built, and pass the check of the rules (K359-1)', () => {
  const rules = ruleTexts(readFileSync(new URL('../../PRINCIPLES.md', import.meta.url), 'utf8'));
  assert.match(rules.get('P24') ?? '', /^  Enforced by: .*`make commits-check`/m);
  assert.match(rules.get('S10') ?? '', /^  Enforced by: .*`make dependency-policy-check`/m);
  assert.deepEqual(checkRules(fileURLToPath(new URL('../..', import.meta.url)), ['PRINCIPLES.md']).findings, []);
});

// K359-2: the consumers take PRINCIPLES.md as a copy of kit, so its rules name only the checks that every repository has: a make
// target or a hook, never a path under tests/ or scripts/ of kit.
test('no rule of PRINCIPLES.md is enforced by a path that only kit has (K359-2)', () => {
  const lines = readFileSync(new URL('../../PRINCIPLES.md', import.meta.url), 'utf8').split('\n').filter(line => line.startsWith('  Enforced by: '));
  assert.deepEqual(lines.filter(line => /`(?:tests|scripts)\//.test(line)), []);
});
