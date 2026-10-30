// Tests of the CI pipeline that kit vendors to every repository (workflows/ci-pipeline.yml, K270, K910): the repository's ci.yml
// calls it, it partitions every gate named by PRINCIPLES.md with the targets that config/ci.json declares for each job, and a
// final job fails when a job of the pipeline failed or was cancelled.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { assertWorkflowPackageBootstrap } from './workflow-package-bootstrap.mts';
import { fileURLToPath } from 'node:url';
import { isJsonObject, readJsonObject } from '../../scripts/kit/bootstrap/files.mts';
import { RETIRED_COPIES } from '../../scripts/kit/kit-check.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (file: string) => readFileSync(path.join(ROOT, file), 'utf8');
const PIPELINE = 'workflows/ci-pipeline.yml';
const REQUIRED_NEEDS = ['shared', 'parity', 'parity-api', 'parity-bindings', 'runtime'];

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
  assert.match(workflow, /run: make ci-targets TARGETS="kit-gates-static /);
  assert.match(workflow, /run: make ci-targets TARGETS="kit-gates-parity /);
  assert.match(workflow, /run: make ci-targets TARGETS="kit-gates-runtime-\$\{\{ matrix\.runtime \}\} /);
  assert.match(workflow, /run: make kit-ci-plan/, 'the tracked setup planner selects runtime jobs and pinned tools');
  assert.match(workflow, /runner: \$\{\{ steps\.plan\.outputs\.runner \}\}/, 'gate runner selection comes from the validated CI plan');
  for (const name of ['shared', 'required']) assert.ok(workflowJob(workflow, name).includes('    runs-on: ubuntu-24.04'), `${name} runs on the supported default runner`);
  for (const name of ['parity', 'parity-api', 'parity-bindings', 'runtime']) {
    assert.match(workflowJob(workflow, name).join('\n'), /runs-on: \$\{\{ needs\.shared\.outputs\.runner \}\}/, `${name} uses the selected supported runner`);
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
  assert.match(workflow, /include: \$\{\{ fromJSON\(needs\.shared\.outputs\.runtimes\) \}\}/);
  assert.match(setup, /declared\.symbolExtractors/);
  assert.match(setup, /`deps-\$\{/, 'the default setup of a runtime is the deps target of the repository (K859)');
  const enforced = read('PRINCIPLES.md').split('\n').filter(line => line.trim().startsWith('Enforced by:')).join('\n');
  const named = new Set([...enforced.matchAll(/`make ([a-z0-9-]+)`/g)].map(match => match[1]));
  assert.ok(named.size > 10, 'the rules of PRINCIPLES.md name their checks');
  // A check that only a release runs is in release.yml, which no merge gate runs; every other named check is a kit-gates target (K941-1).
  const released = new Set([...read('.github/workflows/release.yml').matchAll(/run: make ([a-z0-9-]+)/g)].map(match => match[1] ?? ''));
  for (const target of named) assert.ok(gates.has(target ?? '') || released.has(target ?? ''), `kit-gates or release.yml runs make ${target}`);
});

test('kit ships the CI pipeline with its npm package and copies it in place of the gates workflow (K270, K614, K910)', () => {
  const manifest = readJsonObject(ROOT, 'package.json');
  assert.ok(Array.isArray(manifest.files) && manifest.files.includes(PIPELINE), 'the published package ships the CI pipeline');
  assert.ok(!(Array.isArray(manifest.files) && manifest.files.includes('workflows/gates.yml')), 'the package ships no gates workflow');
  const copies = isJsonObject(manifest.kit) && isJsonObject(manifest.kit.copies) ? manifest.kit.copies : {};
  assert.equal(copies['.github/workflows/ci-pipeline.yml'], PIPELINE);
  assert.equal(copies['.github/workflows/gates.yml'], undefined);
  assert.ok((RETIRED_COPIES as readonly string[]).includes('.github/workflows/gates.yml'), 'kit-sync removes the gates workflow of an earlier kit');
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
  assert.match(workflow, /node-version-file: mise\.toml/);
  assert.match(workflow, /run: make install-tools TOOLS=npm/);
  assert.match(workflow, /run: make install-packages/);
  assert.doesNotMatch(workflow, /^\s+run: make install$/m, 'the pipeline does not run the full install target');
});

test('the parity partition runs the full parity check, which runs only in CI, so every implementation runs its bindings in the gates (S6, K272)', () => {
  const kitMk = read('scripts/kit/kit.mk');
  assert.match(kitMk, /^kit-gates-parity: parity-check /m);
  assert.match(kitMk, /^ifneq \(\$\(filter parity-check kit-gates kit-gates-parity,\$\(MAKECMDGOALS\)\),\)$/m, 'the CI guard of parity-check covers both aggregate and parity gates');
  assert.deepEqual(workflowNeeds(workflowJob(read(PIPELINE), 'required'), 'required').sort(), [...REQUIRED_NEEDS].sort());
});

test('K734: the pipeline selects exactly one parity path and its final job needs every phase job', () => {
  const workflow = read(PIPELINE);
  const full = workflowJob(workflow, 'parity');
  const api = workflowJob(workflow, 'parity-api');
  const bindings = workflowJob(workflow, 'parity-bindings');
  const required = workflowJob(workflow, 'required');
  assert.ok(full.includes("    if: ${{ needs.shared.outputs.parity_mode == 'full' }}"));
  assert.ok(api.includes("    if: ${{ needs.shared.outputs.parity_mode == 'phases' }}"));
  assert.ok(bindings.includes("    if: ${{ needs.shared.outputs.parity_mode == 'phases' }}"));
  assert.ok(bindings.includes('        include: ${{ fromJSON(needs.shared.outputs.parity_matrix) }}'));
  assert.ok(bindings.some(line => line.includes('run: make ci-targets TARGETS="parity-bindings-${{ matrix.implementation }}-check"')));
  assert.ok(api.some(line => line.includes('run: make ci-targets TARGETS="parity-api-check ')));
  assert.deepEqual(workflowNeeds(required, 'required').sort(), [...REQUIRED_NEEDS].sort());
});

// K910: the final job judges the results of its needs with no checkout or install: a failed or cancelled job fails it, and a
// skipped job (a parity path that the mode excludes, no runtime, or a red shared job, which is a failure itself) does not.
test('K910: required runs always on the default runner and fails on a failed or cancelled job of the pipeline', () => {
  const required = workflowJob(read(PIPELINE), 'required');
  assert.ok(required.includes('    if: ${{ always() }}'));
  assert.doesNotMatch(required.join('\n'), /actions\/checkout|make /, 'required installs nothing');
  const env = required.findIndex(line => line.includes('RESULTS: ${{ join(needs.*.result, \' \') }}'));
  assert.notEqual(env, -1, 'required reads the result of every need');
  const run = required.slice(required.findIndex(line => line === '        run: |') + 1).map(line => line.replace(/^ {10}/, '')).join('\n');
  const judge = (results: string) => spawnSync('bash', ['-eu', '-c', run], { env: { ...process.env, RESULTS: results }, encoding: 'utf8' }).status;
  assert.equal(judge('success success skipped skipped success'), 0);
  assert.equal(judge('success skipped skipped skipped skipped'), 0);
  assert.equal(judge('failure skipped skipped skipped skipped'), 1);
  assert.equal(judge('success success skipped skipped cancelled'), 1);
});

// K910: every job after shared needs it, so a red shared job holds one runner, and each job passes the targets that
// config/ci.json declares for its group to make ci-targets after kit's gate.
test('K910: the parity and runtime jobs need shared and run the declared targets of their group', () => {
  const workflow = read(PIPELINE);
  for (const name of ['parity', 'parity-api', 'parity-bindings', 'runtime']) assert.ok(workflowJob(workflow, name).includes('    needs: shared'), `${name} needs shared`);
  assert.match(workflowJob(workflow, 'shared').join('\n'), /TARGETS="kit-gates-static \$\{\{ join\(fromJSON\(steps\.plan\.outputs\.shared_targets\), ' '\) \}\}"/);
  assert.match(workflowJob(workflow, 'parity').join('\n'), /TARGETS="kit-gates-parity \$\{\{ join\(fromJSON\(needs\.shared\.outputs\.parity_targets\), ' '\) \}\}"/);
  assert.match(workflowJob(workflow, 'parity-api').join('\n'), /TARGETS="parity-api-check \$\{\{ join\(fromJSON\(needs\.shared\.outputs\.parity_targets\), ' '\) \}\}"/);
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

test('K896: the shared job installs the declared PHP symbol extractor before its gates, which divergence-check needs', () => {
  const shared = workflowJob(read(PIPELINE), 'shared').join('\n');
  const install = shared.indexOf("if: ${{ contains(steps.plan.outputs.extractors, 'php') }}\n        run: make kit-install-symbols EXTRACTORS=php");
  assert.notEqual(install, -1, 'the shared job installs the PHP symbol extractor when the plan names it');
  assert.ok(install > shared.indexOf('make install-tools TOOLS="${{ join(fromJSON(steps.plan.outputs.common_tools)'), 'after the common tools installed PHP and Composer');
  assert.ok(install < shared.indexOf('kit-gates-static'), 'before the shared gates');
});

// K853: a harness piece that kit keeps serves a rule, so a rule of AGENTS.md or PRINCIPLES.md names it; a piece that no rule names
// is kit code that no rule needs.
test('each kept harness piece is named by a rule of AGENTS.md or PRINCIPLES.md (K853)', () => {
  // A rule is an item from its `- ` line to its Enforced by entry and the indented lines that continue it.
  const rules = ['AGENTS.md', 'PRINCIPLES.md'].flatMap(file => read(file).match(/^- [\s\S]*?\n {2}Enforced by:[^\n]*(?:\n {2}[^\n]*)*/gm) ?? []);
  const pieces = ['owner-validate', 'install-link', 'catch-check', 'release-run', 'tool-wrappers', 'worktree-setup', 'uv-install'];
  assert.deepEqual(pieces.filter(piece => !rules.some(rule => rule.includes(piece))), []);
});
