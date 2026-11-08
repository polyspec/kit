// Tests of the CI pipeline that kit ships as an example (workflows/ci-pipeline.yml, K270, K910, K1052): the ci.yml of a
// repository that copies it calls it, it partitions every gate named by PRINCIPLES.md with the targets that config/ci.json declares for each job, and a
// final job fails when a job of the pipeline failed or was cancelled.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { assertWorkflowPackageBootstrap, BOOTSTRAP_ACTION, BOOTSTRAP_USES } from './workflow-package-bootstrap.mts';
import { fileURLToPath } from 'node:url';
import { readJsonObject } from '../../scripts/kit/bootstrap/files.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (file: string) => readFileSync(path.join(ROOT, file), 'utf8');
const PIPELINE = 'workflows/ci-pipeline.yml';
const REQUIRED_NEEDS = ['plan', 'shared', 'parity', 'parity-api', 'parity-bindings', 'runtime'];

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

test('the CI pipeline partitions every kit-gates target across shared, parity and runtime jobs (K270, K910)', () => {
  const rule = /^kit-gates:([^#\n]*)/m.exec(read('scripts/kit/kit.mk'));
  assert.ok(rule, 'kit.mk defines kit-gates');
  const gates = new Set((rule[1] ?? '').trim().split(/\s+/));
  const mk = read('scripts/kit/kit.mk');
  const partitions = ['static', 'parity', 'runtime-ts', 'runtime-php', 'runtime-python', 'runtime-go', 'runtime-rust', 'runtime-php-ext']
    .flatMap(name => {
      const line = new RegExp(`^kit-gates-${name}:([^#\\n]*)`, 'm').exec(mk);
      assert.ok(line, `kit.mk defines kit-gates-${name}`);
      return (line[1] ?? '').trim().split(/\s+/);
    });
  assert.deepEqual([...partitions].sort(), [...gates].sort(), 'every original gate occurs once in the workflow partitions');
  const workflow = read(PIPELINE);
  assert.match(workflow, /run: make -k ci-targets TARGETS="kit-gates-static /);
  assert.match(workflow, /run: make -k ci-targets TARGETS="kit-gates-parity /);
  assert.match(workflow, /run: make -k ci-targets TARGETS="kit-gates-runtime-\$\{\{ matrix\.runtime \}\} /);
  assert.match(workflow, /run: make kit-ci-plan/, 'the tracked setup planner selects runtime jobs and pinned tools');
  assert.match(workflow, /runner: \$\{\{ steps\.plan\.outputs\.runner \}\}/, 'gate runner selection comes from the validated CI plan');
  for (const name of ['plan', 'shared', 'required']) assert.ok(workflowJob(workflow, name).includes('    runs-on: ubuntu-24.04'), `${name} runs on the supported default runner`);
  for (const name of ['parity', 'parity-api', 'parity-bindings', 'runtime']) {
    assert.match(workflowJob(workflow, name).join('\n'), /runs-on: \$\{\{ needs\.plan\.outputs\.runner \}\}/, `${name} uses the selected supported runner`);
  }
  assert.match(workflow, /run: make kit-ci-setup GROUP=shared/);
  assert.match(workflow, /run: make kit-ci-setup GROUP=parity/);
  assert.match(workflow, /run: make kit-ci-setup GROUP=runtime RUNTIME=\$\{\{ matrix\.runtime \}\}/);
  assert.match(workflow, /join\(matrix\.installTools, ' '\)/, 'runtime tool selectors are joined into the form install-tools accepts');
  const setup = read('scripts/kit/ci-setup.mts');
  assert.match(setup, /declaredMiseTools\(root\)/, 'tool selection uses the same declaration reader as install-tools');
  assert.match(setup, /declaredToolchain\(root\)/);
  assert.match(setup, /trackedFiles\(root\)/);
  assert.match(setup, /implementationFolders\(files\)/);
  assert.match(workflow, /include: \$\{\{ fromJSON\(needs\.plan\.outputs\.runtimes\) \}\}/);
  assert.match(setup, /declared\.symbolExtractors/);
  assert.match(setup, /`deps-\$\{/, 'the default setup of a runtime is the deps target of the repository (K859)');
  const enforced = read('PRINCIPLES.md').split('\n').filter(line => line.trim().startsWith('Enforced by:')).join('\n');
  const named = new Set([...enforced.matchAll(/`make ([a-z0-9-]+)`/g)].map(match => match[1]));
  assert.ok(named.size > 10, 'the rules of PRINCIPLES.md name their checks');
  // A check that only a release runs is in release.yml, which no merge gate runs; every other named check is a kit-gates target (K941-1).
  const released = new Set([...`${read('.github/workflows/release.yml')}${read(BOOTSTRAP_ACTION)}`.matchAll(/run: make ([a-z0-9-]+)/g)].map(match => match[1] ?? ''));
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
  assert.doesNotMatch(read('scripts/kit/kit.mk').split('\n').filter(line => /^kit-gates(-parity)?:/.test(line)).join('\n'), /link-check/);
});

test('K731-1: context preparation surrounds the unchanged required gate and cleanup always runs after entry', () => {
  const workflow = read(PIPELINE);
  const partitions = [
    ['shared', 'prepare shared CI context', 'shared gates', 'cleanup shared CI context', 'GROUP=shared'],
    ['parity', 'prepare parity CI context', 'parity gate', 'cleanup parity CI context', 'GROUP=parity'],
    ['parity-api', 'prepare parity CI context', 'API phase', 'cleanup parity CI context', 'GROUP=parity'],
    ['parity-bindings', 'prepare parity CI context', 'binding phase', 'cleanup parity CI context', 'GROUP=parity'],
    ['runtime', 'prepare runtime CI context', 'runtime gate', 'cleanup runtime CI context', 'GROUP=runtime RUNTIME=${{ matrix.runtime }}'],
  ] as const;
  for (const [jobName, prepareName, gateName, cleanupName, selection] of partitions) {
    const job = workflowJob(workflow, jobName);
    const prepare = job.findIndex(line => line === `      - name: ${prepareName}` || line === `        name: ${prepareName}`);
    const gate = job.findIndex(line => line === `      - name: ${gateName}`);
    const cleanup = job.findIndex(line => line === `      - name: ${cleanupName}`);
    assert.ok(prepare >= 0 && gate > prepare && cleanup > gate, `${jobName} prepares before its provider gate and cleans after it`);
    assert.ok(job.slice(prepare, prepare + 4).some(line => line.includes(`make kit-ci-context-prepare ${selection}`)), `${jobName} selects its declared context`);
    assert.ok(job.slice(cleanup, cleanup + 4).some(line => line.includes(`make kit-ci-context-cleanup ${selection}`)), `${jobName} selects its cleanup`);
    assert.ok(job.slice(cleanup, cleanup + 4).some(line => line.includes("always() && steps.context_prepare.outcome != 'skipped'")), `${jobName} cleans up after prepare or gate failure only after preparation was entered`);
    assert.doesNotMatch(job.slice(cleanup, cleanup + 4).join('\n'), /continue-on-error/);
  }
  assert.match(read('scripts/kit/kit.mk'), /^kit-ci-context-prepare:.*$/m);
  assert.match(read('scripts/kit/kit.mk'), /^kit-ci-context-cleanup:.*$/m);
});

test('K671-3: gates use the standard root checkout and retain the native installation sequence', () => {
  const workflow = read(PIPELINE);
  assert.doesNotMatch(workflow, /working-directory:|path: \$\{\{ github\.event\.repository\.name/);
  // K992: every job bootstraps with the action of kit, which holds the native installation sequence.
  for (const name of REQUIRED_NEEDS)
    assert.equal(workflowJob(workflow, name).join('\n').match(new RegExp(BOOTSTRAP_USES.source, 'gm'))?.length, 1, `${name} runs the bootstrap action exactly once`);
  const action = read(BOOTSTRAP_ACTION);
  assert.match(action, /node-version-file: mise\.toml/);
  assert.match(action, /run: make install-tools TOOLS=npm/);
  assert.match(action, /run: make install-packages/);
  assert.doesNotMatch(workflow, /^\s+run: make install$/m, 'the pipeline does not run the full install target');
});

test('the parity partition runs the full parity check, so every implementation runs its bindings in the gates (S6, K272)', () => {
  const kitMk = read('scripts/kit/kit.mk');
  assert.match(kitMk, /^kit-gates-parity: parity-check /m);
  assert.doesNotMatch(kitMk, /ci-only/, 'no guard refuses a full parity check outside CI (K1053)');
  assert.deepEqual(workflowNeeds(workflowJob(read(PIPELINE), 'required'), 'required').sort(), [...REQUIRED_NEEDS].sort());
});

test('K734: the pipeline selects exactly one parity path and its final job needs every phase job', () => {
  const workflow = read(PIPELINE);
  const full = workflowJob(workflow, 'parity');
  const api = workflowJob(workflow, 'parity-api');
  const bindings = workflowJob(workflow, 'parity-bindings');
  const required = workflowJob(workflow, 'required');
  assert.ok(full.includes("    if: ${{ needs.plan.outputs.parity_mode == 'full' }}"));
  assert.ok(api.includes("    if: ${{ needs.plan.outputs.parity_mode == 'phases' }}"));
  assert.ok(bindings.includes("    if: ${{ needs.plan.outputs.parity_mode == 'phases' }}"));
  assert.ok(bindings.includes('        include: ${{ fromJSON(needs.plan.outputs.parity_matrix) }}'));
  assert.ok(bindings.some(line => line.includes('run: make -k ci-targets TARGETS="parity-bindings-${{ matrix.implementation }}-check"')));
  assert.ok(api.some(line => line.includes('run: make -k ci-targets TARGETS="parity-api-check ')));
  assert.deepEqual(workflowNeeds(required, 'required').sort(), [...REQUIRED_NEEDS].sort());
});

// K910: the final job judges the results of its needs with no checkout or install: a failed or cancelled job fails it, and a
// skipped job (a parity path that the mode excludes, no runtime, or a red shared job, which is a failure itself) does not.
// The jobs that required judges, in the order of its needs: the result of each job and whether the plan selected it. The run
// of required reads them from its environment, and RESULTS, the join of the results as the earlier judgement read them, is set
// too, so that the judgement of the earlier script runs and fails the cases below.
const JOBS = ['PLAN', 'SHARED', 'PARITY', 'PARITY_API', 'PARITY_BINDINGS', 'RUNTIME'] as const;
function requiredJudgement(required: readonly string[]) {
  const run = required.slice(required.findIndex(line => line === '        run: |') + 1).map(line => line.replace(/^ {10}/, '')).join('\n');
  return (results: Record<(typeof JOBS)[number], string>, selected: Record<(typeof JOBS)[number], boolean>) => {
    const env: NodeJS.ProcessEnv = { ...process.env, RESULTS: JOBS.map(job => results[job]).join(' ') };
    for (const job of JOBS) {
      env[`${job}_RESULT`] = results[job];
      env[`${job}_SELECTED`] = String(selected[job]);
    }
    return spawnSync('bash', ['-eu', '-c', run], { env, encoding: 'utf8' }).status;
  };
}

test('K910: required runs always on the default runner and fails on a failed or cancelled job of the pipeline', () => {
  const required = workflowJob(read(PIPELINE), 'required');
  assert.ok(required.includes('    if: ${{ always() }}'));
  assert.doesNotMatch(required.join('\n'), /actions\/checkout|make /, 'required installs nothing');
  const judge = requiredJudgement(required);
  const full = { PLAN: true, SHARED: true, PARITY: true, PARITY_API: false, PARITY_BINDINGS: false, RUNTIME: true };
  assert.equal(judge({ PLAN: 'success', SHARED: 'success', PARITY: 'success', PARITY_API: 'skipped', PARITY_BINDINGS: 'skipped', RUNTIME: 'success' }, full), 0);
  assert.equal(judge({ PLAN: 'success', SHARED: 'success', PARITY: 'failure', PARITY_API: 'skipped', PARITY_BINDINGS: 'skipped', RUNTIME: 'success' }, full), 1);
  assert.equal(judge({ PLAN: 'success', SHARED: 'success', PARITY: 'success', PARITY_API: 'skipped', PARITY_BINDINGS: 'skipped', RUNTIME: 'cancelled' }, full), 1);
});

// K950: required judges only the jobs that the plan selected (shared, the parity path of parity_mode, runtime when the
// repository has one). A selected job that is skipped fails the pipeline, a job the plan did not select is not a result.
test('K950: required fails when a job the plan selected is skipped, and judges no job the plan did not select', () => {
  const judge = requiredJudgement(workflowJob(read(PIPELINE), 'required'));
  const none = { PLAN: true, SHARED: true, PARITY: false, PARITY_API: false, PARITY_BINDINGS: false, RUNTIME: false };
  const phases = { PLAN: true, SHARED: true, PARITY: false, PARITY_API: true, PARITY_BINDINGS: true, RUNTIME: true };
  const skipped = { PLAN: 'success', SHARED: 'success', PARITY: 'skipped', PARITY_API: 'skipped', PARITY_BINDINGS: 'skipped', RUNTIME: 'skipped' } as const;
  assert.equal(judge(skipped, none), 0, 'no job is selected, so none is a result');
  assert.equal(judge({ ...skipped, PARITY: 'success' }, { ...none, PARITY: true }), 0);
  assert.equal(judge(skipped, { ...none, PARITY: true }), 1, 'a selected parity job that is skipped fails the pipeline');
  assert.equal(judge({ ...skipped, PARITY_API: 'success', PARITY_BINDINGS: 'success', RUNTIME: 'success' }, phases), 0, 'the full parity job is not selected in phases mode');
  assert.equal(judge({ ...skipped, PARITY_API: 'success', PARITY_BINDINGS: 'skipped', RUNTIME: 'success' }, phases), 1, 'a selected binding job that is skipped fails the pipeline');
  assert.equal(judge({ ...skipped, RUNTIME: 'skipped' }, { ...none, RUNTIME: true }), 1, 'a selected runtime job that is skipped fails the pipeline');
  assert.equal(judge({ ...skipped, SHARED: 'failure' }, none), 1, 'a failed shared job fails the pipeline');
});

// K1029: independent checks consume plan data, not shared check results. Each still runs its declared targets.
test('K1029: independent jobs need only plan and run the declared targets of their group', () => {
  const workflow = read(PIPELINE);
  for (const name of ['shared', 'parity', 'parity-api', 'parity-bindings', 'runtime']) assert.deepEqual(workflowNeeds(workflowJob(workflow, name), name), ['plan'], `${name} needs only the plan`);
  assert.match(workflowJob(workflow, 'shared').join('\n'), /TARGETS="kit-gates-static \$\{\{ join\(fromJSON\(needs\.plan\.outputs\.shared_targets\), ' '\) \}\}"/);
  assert.match(workflowJob(workflow, 'parity').join('\n'), /TARGETS="kit-gates-parity \$\{\{ join\(fromJSON\(needs\.plan\.outputs\.parity_targets\), ' '\) \}\}"/);
  assert.match(workflowJob(workflow, 'parity-api').join('\n'), /TARGETS="parity-api-check \$\{\{ join\(fromJSON\(needs\.plan\.outputs\.parity_targets\), ' '\) \}\}"/);
  assert.match(workflowJob(workflow, 'runtime').join('\n'), /TARGETS="kit-gates-runtime-\$\{\{ matrix\.runtime \}\} \$\{\{ join\(matrix\.targets, ' '\) \}\}"/);
  for (const name of ['shared', 'parity', 'parity-api', 'parity-bindings', 'runtime']) assert.ok(workflowJob(workflow, name).some(line => line.includes('uses: actions/upload-artifact@')), `${name} uploads its report`);
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


test('K1026: binding jobs use the explicit matrix tools and setup selector without global installers', () => {
  const block = workflowJob(read(PIPELINE), 'parity-bindings').join('\n');
  assert.match(block, /run: make install-tools TOOLS="\$\{\{ join\(matrix\.installTools, ' '\) \}\}"/);
  assert.match(block, /if: \$\{\{ contains\(matrix\.installTools, 'php'\) \}\}/);
  assert.match(block, /run: make kit-ci-setup GROUP=parity-binding IMPLEMENTATION=\$\{\{ matrix\.implementation \}\}/);
  assert.doesNotMatch(block, /needs\.plan\.outputs\.(parity_tools|extractors)|kit-install-symbols|kit-ci-setup GROUP=parity\n/);
});


test('K1029: planning emits job data without running checks, runtime setup or contexts', () => {
  const plan = workflowJob(read(PIPELINE), 'plan').join('\n');
  assert.match(plan, /run: make kit-ci-plan/);
  assert.doesNotMatch(plan, /ci-targets|kit-ci-setup|kit-ci-context|install-tools|kit-install-symbols/);
  for (const output of ['common_tools', 'shared_targets', 'runtimes', 'runner', 'parity_mode', 'parity_matrix', 'has_runtimes', 'parity_tools', 'parity_targets', 'extractors'])
    assert.ok(plan.includes(`${output}: \${{ steps.plan.outputs.${output} }}`), `plan publishes ${output}`);
  assert.doesNotMatch(read(PIPELINE), /needs\.shared\.outputs/);
});

test('K1029: every selected job including planning fails required on failure, cancellation or skipping', () => {
  const required = workflowJob(read(PIPELINE), 'required');
  const judge = requiredJudgement(required);
  assert.deepEqual(workflowNeeds(required, 'required').sort(), [...REQUIRED_NEEDS].sort());
  const selected = { PLAN: true, SHARED: true, PARITY: false, PARITY_API: true, PARITY_BINDINGS: true, RUNTIME: true };
  const passed = { PLAN: 'success', SHARED: 'success', PARITY: 'skipped', PARITY_API: 'success', PARITY_BINDINGS: 'success', RUNTIME: 'success' };
  assert.equal(judge(passed, selected), 0);
  for (const job of JOBS.filter(job => selected[job]))
    for (const result of ['failure', 'cancelled', 'skipped'])
      assert.equal(judge({ ...passed, [job]: result }, selected), 1, `${job} ${result} must fail required`);
});
