// Tests of the CI pipeline that kit ships as an example (workflows/ci-pipeline.yml, K270, K910, K1052): the ci.yml of a
// repository that copies it calls it, it partitions every gate named by PRINCIPLES.md with the targets that config/ci.json declares for each job, and a
// final job fails when a job of the pipeline failed or was cancelled.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { assertWorkflowPackageBootstrap, BOOTSTRAP_ACTION, BOOTSTRAP_USES } from './workflow-package-bootstrap.mts';
import { fileURLToPath } from 'node:url';
import { readJsonObject } from '../../scripts/kit/bootstrap/files.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (file: string) => readFileSync(path.join(ROOT, file), 'utf8');
const PIPELINE = 'workflows/ci-pipeline.yml';
const REQUIRED_NEEDS = ['plan', 'shared', 'runtime'];

function workflowJob(source: string, name: string): string[] {
  const lines = source.split('\n');
  const start = lines.findIndex(line => line === `  ${name}:`);
  assert.notEqual(start, -1, `workflow defines job ${name}`);
  const end = lines.findIndex((line, index) => index > start && /^  [A-Za-z0-9_-]+:$/.test(line));
  return lines.slice(start, end === -1 ? undefined : end);
}

function workflowNeeds(block: readonly string[], name: string): string[] {
  const line = block.find(entry => entry.startsWith('    needs:'));
  assert.ok(line, `${name} declares its job dependencies`);
  const match = /^    needs: \[([^\]]*)\]$/.exec(line);
  assert.ok(match, `${name} uses an explicit complete needs list`);
  return (match[1] ?? '').split(',').map(value => value.trim()).filter(Boolean);
}

test('the CI pipeline partitions every kit-gates target across shared and runtime jobs (K270, K910)', () => {
  const rule = /^kit-gates:([^#\n]*)/m.exec(read('scripts/kit/kit.mk'));
  assert.ok(rule, 'kit.mk defines kit-gates');
  const gates = new Set((rule[1] ?? '').trim().split(/\s+/));
  const mk = read('scripts/kit/kit.mk');
  const partitions = ['static', 'runtime-ts', 'runtime-php', 'runtime-python', 'runtime-go', 'runtime-rust', 'runtime-php-ext']
    .flatMap(name => {
      const line = new RegExp(`^kit-gates-${name}:([^#\\n]*)`, 'm').exec(mk);
      assert.ok(line, `kit.mk defines kit-gates-${name}`);
      return (line[1] ?? '').trim().split(/\s+/);
    });
  assert.deepEqual([...partitions].sort(), [...gates].sort(), 'every original gate occurs once in the workflow partitions');
  const workflow = read(PIPELINE);
  const setup = read('scripts/kit/ci-setup.mts');
  // K1250: each job runs one recipe, which runs the gate of its group through ci-targets.
  assert.match(setup, /\['kit-gates-static', \.\.\.result\.sharedTargets\]/);
  assert.match(setup, /\[`kit-gates-runtime-\$\{scope\}`, \.\.\.job\.targets\]/);
  assert.match(setup, /'-k', 'ci-targets', `TARGETS=\$\{targets\.join\(' '\)\}`/);
  assert.match(workflow, /run: make ci-plan/, 'the tracked setup planner selects runtime jobs');
  assert.match(workflow, /runner: \$\{\{ steps\.plan\.outputs\.runner \}\}/, 'gate runner selection comes from the validated CI plan');
  for (const name of ['plan', 'shared', 'required']) assert.ok(workflowJob(workflow, name).includes('    runs-on: ubuntu-24.04'), `${name} runs on the supported default runner`);
  for (const name of ['runtime']) {
    assert.match(workflowJob(workflow, name).join('\n'), /runs-on: \$\{\{ needs\.plan\.outputs\.runner \}\}/, `${name} uses the selected supported runner`);
  }
  assert.match(workflow, /run: make ci-shared$/m);
  assert.match(workflow, /run: make ci-runtime RUNTIME=\$\{\{ matrix\.runtime \}\}$/m);
  assert.match(setup, /`TOOLS=\$\{tools\.join\(' '\)\}`/, 'runtime tool selectors are joined into the form install-tools accepts');
  assert.match(setup, /declaredMiseTools\(root\)/, 'tool selection uses the same declaration reader as install-tools');
  assert.match(setup, /declaredToolchain\(root\)/);
  assert.match(setup, /\.\.\.config\.runtimes, /, 'the runtimes of the plan are those that config/ci.json declares (K1114)');
  assert.match(workflow, /include: \$\{\{ fromJSON\(needs\.plan\.outputs\.runtimes\) \}\}/);
  assert.match(setup, /declared\.symbolExtractors/);
  assert.match(setup, /`deps-\$\{/, 'the default setup of a runtime is the deps target of the repository (K859)');
  const enforced = read('PRINCIPLES.md').split('\n').filter(line => line.trim().startsWith('Enforced by:')).join('\n');
  const named = new Set([...enforced.matchAll(/`make ([a-z0-9-]+)`/g)].map(match => match[1]));
  assert.ok(named.size > 10, 'the rules of PRINCIPLES.md name their checks');
  // A check that only a release runs is in release.yml, which no merge gate runs; every other named check is a kit-gates target (K941-1).
  // The bootstrap action runs make bootstrap, whose recipe in docs/examples/bootstrap.mk runs the install targets (K1250).
  const released = new Set([
    ...[...`${read('.github/workflows/release.yml')}${read(BOOTSTRAP_ACTION)}`.matchAll(/run: make ([a-z0-9-]+)/g)].map(match => match[1] ?? ''),
    ...[...read('docs/examples/bootstrap.mk').matchAll(/^\t\$\(MAKE\) --no-print-directory ([a-z0-9-]+)/gm)].map(match => match[1] ?? ''),
  ]);
  for (const target of named) assert.ok(gates.has(target ?? '') || released.has(target ?? ''), `kit-gates or release.yml runs make ${target}`);
});

test('kit ships the CI pipeline with its npm package as an example and no gates workflow (K270, K614, K910, K1052)', () => {
  const manifest = readJsonObject(ROOT, 'package.json');
  assert.ok(Array.isArray(manifest.files) && manifest.files.includes(PIPELINE), 'the published package ships the CI pipeline');
  assert.ok(!(Array.isArray(manifest.files) && manifest.files.includes('workflows/gates.yml')), 'the package ships no gates workflow');
  const workflow = read(PIPELINE);
  assert.match(workflow, /^name: ci-pipeline$/m);
  assert.match(workflow, /^on:\n {2}workflow_call:\n\n/m, 'the repository ci.yml calls it; it has no trigger of its own');
});

test('K671-3: the CI pipeline bootstraps the installed package with exact npm before Make, while kit skips it', { timeout: 5000 }, (t) => {
  assertWorkflowPackageBootstrap(read(PIPELINE), t);
});

// K824: CI is release mode: the package managers install the declared versions, and nothing is linked, so no job runs link,
// link-check or a package-link toolchain.
test('K824: no gates job links packages or checks links; CI installs with the package managers only', () => {
  const workflow = read(PIPELINE);
  assert.doesNotMatch(workflow, /make link|link-check|link_tools|package-link/);
  assert.doesNotMatch(read('.github/workflows/ci.yml'), /link-check/);
  assert.doesNotMatch(read('scripts/kit/kit.mk').split('\n').filter(line => line.startsWith('kit-gates:')).join('\n'), /link-check/);
});

// K731-1, K1250: the context of a job and its cleanup are steps of its recipe (tests/kit/ci-setup.test.mts runs them); the
// pipeline holds no context step.
test('K731-1: context preparation and cleanup belong to the recipe of the job, not to steps of the pipeline', () => {
  const workflow = read(PIPELINE);
  assert.doesNotMatch(workflow, /context|continue-on-error/);
  const mk = read('scripts/kit/kit.mk');
  assert.match(mk, /^ci-shared:.*\n\t\$\(NODE\) \$\(KIT\)\/ci-setup\.\$\(KIT_EXT\) --job shared$/m);
  assert.match(mk, /^ci-runtime:.*\n\t\$\(NODE\) \$\(KIT\)\/ci-setup\.\$\(KIT_EXT\) --job runtime \$\(RUNTIME\)$/m);
});

test('K671-3: gates use the standard root checkout and retain the native installation sequence', () => {
  const workflow = read(PIPELINE);
  assert.doesNotMatch(workflow, /working-directory:|path: \$\{\{ github\.event\.repository\.name/);
  // K992: every job bootstraps with the action of kit, which holds the native installation sequence.
  for (const name of REQUIRED_NEEDS)
    assert.equal(workflowJob(workflow, name).join('\n').match(new RegExp(BOOTSTRAP_USES.source, 'gm'))?.length, 1, `${name} runs the bootstrap action exactly once`);
  const action = read(BOOTSTRAP_ACTION);
  assert.match(action, /node-version-file: mise\.toml/);
  assert.deepEqual([...action.matchAll(/^\s+run: (.+)$/gm)].map(match => match[1]), ['make bootstrap'], 'the action provisions Node.js and runs the one make call of a local bootstrap');
  assert.doesNotMatch(workflow, /^\s+run: make install$/m, 'the pipeline does not run the full install target');
});

test('the final job needs every job of the pipeline (K910)', () => {
  assert.deepEqual(workflowNeeds(workflowJob(read(PIPELINE), 'required'), 'required').sort(), [...REQUIRED_NEEDS].sort());
});

// K910, K950, K1250: the final job runs make ci-required with the JSON of needs; tests/kit/ci-setup.test.mts judges results with it.
test('K910: required runs always on the default runner and passes the results of its needs to make ci-required', () => {
  const required = workflowJob(read(PIPELINE), 'required');
  assert.ok(required.includes('    if: ${{ always() }}'));
  assert.ok(required.includes("      - run: make ci-required RESULTS='${{ toJSON(needs) }}'"));
  assert.match(read('scripts/kit/kit.mk'), /^ci-required:.*\n\t\$\(NODE\) \$\(KIT\)\/ci-setup\.\$\(KIT_EXT\) --required$/m);
});

// K1029: independent checks consume plan data, not shared check results. Each still runs its declared targets.
test('K1029: independent jobs need only plan and upload their reports', () => {
  const workflow = read(PIPELINE);
  for (const name of ['shared', 'runtime']) assert.deepEqual(workflowNeeds(workflowJob(workflow, name), name), ['plan'], `${name} needs only the plan`);
  for (const name of ['shared', 'runtime']) assert.ok(workflowJob(workflow, name).some(line => line.includes('uses: actions/upload-artifact@')), `${name} uploads its report`);
  assert.doesNotMatch(workflow, /name: report-/, 'the reports of the pipeline carry the prefix kit-, apart from those of repository jobs');
});

// K515: a tracked lock records the release of each polyspec package (K448, K507), so kit has no check that a tracked file names
// none and no config/polyspec.json; gates install the committed package locks.
test('K515: kit runs no polyspec lock check and reads no config/polyspec.json', () => {
  const kitMk = read('scripts/kit/kit.mk');
  assert.doesNotMatch(kitMk, /polyspec-lock-check/);
  assert.doesNotMatch(read('PRINCIPLES.md'), /config\/polyspec\.json/);
  assert.doesNotMatch(read(PIPELINE), /config\/polyspec\.json/);
});

// K815: K805 deleted commits-check, the one reader of RANGE, so the shared job computes no commit range and passes none.
test('K815: the shared job computes no commit range and passes no RANGE', () => {
  const shared = workflowJob(read(PIPELINE), 'shared').join('\n');
  assert.doesNotMatch(shared, /commit range|RANGE=|\$range/);
  assert.doesNotMatch(read('scripts/kit/kit.mk'), /\$\(RANGE\)|\$\$RANGE/);
});

// K853: a harness piece that kit keeps serves a rule, so a rule of AGENTS.md or PRINCIPLES.md names it; a piece that no rule names
// is kit code that no rule needs.
test('each kept harness piece is named by a rule of AGENTS.md or PRINCIPLES.md (K853)', () => {
  // A rule is an item from its `- ` line to its Enforced by entry and the indented lines that continue it.
  const rules = ['AGENTS.md', 'PRINCIPLES.md'].flatMap(file => read(file).match(/^- [\s\S]*?\n {2}Enforced by:[^\n]*(?:\n {2}[^\n]*)*/gm) ?? []);
  const pieces = ['owner-validate', 'install-link', 'catch-check', 'release-run', 'tool-wrappers', 'worktree-setup', 'uv-install'];
  assert.deepEqual(pieces.filter(piece => !rules.some(rule => rule.includes(piece))), []);
});


test('K1029: planning publishes only the fan-out and runs no checks, setup or contexts', () => {
  const plan = workflowJob(read(PIPELINE), 'plan').join('\n');
  assert.match(plan, /run: make ci-plan/);
  assert.doesNotMatch(plan, /ci-targets|ci-shared|ci-runtime|install-tools|kit-install-symbols/);
  const outputs = [...plan.matchAll(/^ {6}([a-z_]+): \$\{\{ steps\.plan\.outputs\.([a-z_]+) \}\}$/gm)].map(match => [match[1], match[2]]);
  assert.deepEqual(outputs, [['runtimes', 'runtimes'], ['runner', 'runner'], ['has_runtimes', 'has_runtimes'], ['shared_php', 'shared_php']], 'K1250: the jobs read their tools and targets from config/ci.json');
  assert.doesNotMatch(read(PIPELINE), /needs\.shared\.outputs|needs\.plan\.outputs\.(?:common_tools|shared_targets)|matrix\.(?:installTools|targets)/);
});
