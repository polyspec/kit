// Tests of scripts/kit/bypass-check.mts (K308): a test, script or Makefile that impersonates CI, assumes a gate up to date or
// skips a Git hook is a finding; the workflows, the comments and the tools of kit itself are not.
import assert from 'node:assert/strict';
import test from 'node:test';
import { bypassFindings, gatesOf } from '../../scripts/kit/bypass-check.mts';

const GATES = ['kit-check', 'toolchain-check', 'docs-check'];

test('setting GITHUB_ACTIONS or CI outside a workflow is a finding, in a shell line, an object and an assignment (K308)', () => {
  assert.deepEqual(bypassFindings('tests/ci.test.mts', "const env = { ...process.env, GITHUB_ACTIONS: 'true' };\nprocess.env.CI = '1';\n", GATES), [
    'tests/ci.test.mts:1: sets the CI identity outside a workflow; a local run never impersonates CI',
    'tests/ci.test.mts:2: sets the CI identity outside a workflow; a local run never impersonates CI',
  ]);
  assert.deepEqual(bypassFindings('scripts/run.sh', 'GITHUB_ACTIONS=true make check\n', GATES), ['scripts/run.sh:1: sets the CI identity outside a workflow; a local run never impersonates CI']);
  assert.deepEqual(bypassFindings('.github/workflows/ci.yml', 'env:\n  CI: true\n', GATES), [], 'a workflow is where CI is named');
  assert.deepEqual(bypassFindings('tests/ci.test.mts', "// GITHUB_ACTIONS=true is what a workflow sets\nconst ci = process.env.CI === 'true';\n", GATES), [], 'a comment and a comparison set nothing');
});

test('make -o, --old-file and --assume-old naming a gate of kit-gates is a finding, and a target that is no gate is not (K308)', () => {
  assert.deepEqual(bypassFindings('Makefile', 'check:\n\tmake -o toolchain-check check-more\n\tmake --old-file=docs-check x\n\tmake --assume-old kit-check x\n\tmake -o generated build\n', GATES), [
    'Makefile:2: make -o toolchain-check treats the gate toolchain-check as up to date and never runs it',
    'Makefile:3: make --old-file=docs-check treats the gate docs-check as up to date and never runs it',
    'Makefile:4: make --assume-old kit-check treats the gate kit-check as up to date and never runs it',
  ]);
});

test('--no-verify is a finding in a test, a script, a Makefile and a Git hook (K308)', () => {
  assert.deepEqual(bypassFindings('.githooks/pre-push', 'git commit --no-verify -m x\n', GATES), ['.githooks/pre-push:1: --no-verify skips a Git hook']);
  assert.deepEqual(bypassFindings('docs/guide.md', 'git commit --no-verify\n', GATES), [], 'a document is no test, script or Makefile');
});

test('the tools and tests of kit itself are left out, and the gates are read from kit-gates (K308)', () => {
  assert.deepEqual(bypassFindings('tests/kit/ci-only.test.mts', "const env = { GITHUB_ACTIONS: 'true' };\n", GATES), []);
  assert.deepEqual(gatesOf('.PHONY: kit-gates\nkit-gates: kit-check docs-check lint-ts ## Run every gate\n'), ['kit-check', 'docs-check', 'lint-ts']);
});
