// Tests of scripts/kit/bypass-check.mts (K308): a test, script or Makefile that impersonates CI, assumes a gate up to date or
// skips a Git hook is a finding; the workflows, the comments and the tools of kit itself are not.
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { bypassFindings } from '../../scripts/kit/bypass-check.mts';
import { KIT_MAKEFILE, tool } from './kit-tools.mts';
import { tree } from './tree.mts';

const GATES = ['kit-check', 'layout-check', 'docs-check'];

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
  assert.deepEqual(bypassFindings('Makefile', 'check:\n\tmake -o layout-check check-more\n\tmake --old-file=docs-check x\n\tmake --assume-old kit-check x\n\tmake -o generated build\n', GATES), [
    'Makefile:2: make -o layout-check treats the gate layout-check as up to date and never runs it',
    'Makefile:3: make --old-file=docs-check treats the gate docs-check as up to date and never runs it',
    'Makefile:4: make --assume-old kit-check treats the gate kit-check as up to date and never runs it',
  ]);
});

test('--no-verify is a finding in a test, a script, a Makefile and a Git hook (K308)', () => {
  assert.deepEqual(bypassFindings('.githooks/pre-push', 'git commit --no-verify -m x\n', GATES), ['.githooks/pre-push:1: --no-verify skips a Git hook']);
  assert.deepEqual(bypassFindings('docs/guide.md', 'git commit --no-verify\n', GATES), [], 'a document is no test, script or Makefile');
});

test('the tools and tests of kit itself are left out (K308)', () => {
  assert.deepEqual(bypassFindings('tests/kit/ci-only.test.mts', "const env = { GITHUB_ACTIONS: 'true' };\n", GATES), []);
});

// K357-1: a consumer includes the kit.mk of the installed kit, so the gates are those of the kit-gates of its Makefile.
test('bypass-check reads the gates of the kit.mk that the Makefile of a consumer includes, and fails without kit-gates (K357-1)', (t) => {
  const run = (files: Record<string, string>) => {
    const root = tree(t, files);
    assert.equal(spawnSync('git', ['add', '-A'], { cwd: root }).status, 0);
    return spawnSync(process.execPath, [tool(import.meta.resolve('../../scripts/kit/bypass-check.mts'))], { cwd: root, encoding: 'utf8' });
  };
  const planted = run({ 'Makefile': KIT_MAKEFILE, 'scripts/gate.sh': 'make -o lint-go check\n' });
  assert.equal(planted.status, 1, planted.stdout + planted.stderr);
  assert.match(planted.stderr, /scripts\/gate\.sh:1: make -o lint-go treats the gate lint-go as up to date/);
  const none = run({ 'Makefile': 'all:\n\ttrue\n', 'scripts/gate.sh': 'make -o lint-go check\n' });
  assert.notEqual(none.status, 0);
  assert.match(none.stderr, /declares no kit-gates/);
});
