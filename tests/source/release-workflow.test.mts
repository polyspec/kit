// The release workflow of kit (workflows/release.yml), the example that a repository copies to its
// .github/workflows/release.yml (K1052). The order is fixed: the job tag tags the commit and lists the asset sets, a job of the
// job assets builds each set (K1189), and the job publish creates the release as a draft with the assets of every set and then
// makes it public. The steps after release-tools run on the tools it installed, and on the
// PHP of .php-version, which a repository that needs PHP declares (K193). The package ships no tests/source, so
// only the kit runs this case.
import assert from 'node:assert/strict';
import { assertWorkflowPackageBootstrap, bootstrapActionCommands, BOOTSTRAP_USES } from '../kit/workflow-package-bootstrap.mts';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const lines = readFileSync(path.join(ROOT, 'workflows/release.yml'), 'utf8').split('\n');

/**
 * The `run:` commands of the steps in the order the workflow runs them, each with its line number; a step that runs the bootstrap
 * action of kit (K992) stands for the make commands of the action, at its own line.
 */
const runs = lines.flatMap((line, index) => {
  if (BOOTSTRAP_USES.test(line)) return bootstrapActionCommands().map(command => ({ command, line: index + 1 }));
  const command = /^\s+run: (.+)$/.exec(line)?.[1];
  return command === undefined ? [] : [{ command, line: index + 1 }];
});
const step = (command: string, pattern: RegExp) => {
  const found = runs.find(run => pattern.test(run.command));
  assert.ok(found, `the workflow runs ${command}`);
  return found;
};

test('K671-3: release consumers bootstrap the installed package with exact npm before Make, while kit skips it', { timeout: 5000 }, (t) => {
  assertWorkflowPackageBootstrap(lines.join('\n'), t);
});

// K1189: the assets of a platform build on a runner of that platform, so each asset set is a job of its own, and the release is
// created once, by the job that gathers them.
test('the release workflow has the jobs tag, assets and publish, in that order of their needs (K1189)', () => {
  const jobs = lines.slice(lines.findIndex(line => line.startsWith('jobs:')) + 1);
  assert.deepEqual(jobs.filter(line => /^  [a-z-]+:$/.test(line)).map(line => line.trim()), ['tag:', 'assets:', 'publish:']);
  const text = lines.join('\n');
  assert.match(text, /^ {2}assets:\n {4}needs: tag\n {4}if: \$\{\{ needs\.tag\.outputs\.tag != '' \}\}\n/m, 'the sets build only for a tag');
  assert.match(text, /^ {2}publish:\n {4}needs: \[tag, assets\]\n/m, 'publish waits for every set');
  assert.match(text, /^ {6}matrix: \$\{\{ fromJson\(needs\.tag\.outputs\.sets\) \}\}$/m);
});

// K911, K924: the release takes the id of a successful CI run and nothing else; the kit of main tags the commit of the run with
// the version of its change log and hands TAG to the next steps, and the release builds the tagged commit with its own packages.
// Nothing reads check runs, and no tag push starts a release.
test('K911, K924: a dispatch with a CI run alone starts the release, which tags the commit of the run before it builds it', () => {
  const text = lines.join('\n');
  assert.match(text, /^ {2}workflow_dispatch:\n {4}inputs:\n {6}run:\n/m);
  assert.doesNotMatch(text, /inputs\.version|^ {6}version:$/m, 'the version is the section of the change log, not an input');
  assert.doesNotMatch(text, /^ {2}push:|tags: \[|inputs\.tag|release-verify|release-go-tags/m);
  assert.match(text, /^permissions:\n {2}contents: write\n {2}actions: read\n/m);
  // release-tag writes TAG and VERSION to GITHUB_ENV for the steps of its job, and tag to the outputs of its step for the jobs
  // that follow, which take TAG from it alone (K1189).
  assert.deepEqual([...text.matchAll(/^ {6}TAG: (.+)$/gm)].map(match => match[1]), ['${{ needs.tag.outputs.tag }}', '${{ needs.tag.outputs.tag }}']);
  assert.doesNotMatch(text, /^ {6}VERSION:/m);
  const tag = step('make release-tag', /^make release-tag /);
  const checkout = step('git checkout of the tag', /^git checkout --quiet "\$TAG"$/);
  assert.ok(tag.line < checkout.line && checkout.line < step('make release-prepare', /^make release-prepare$/).line, 'release-tag, then the checkout of the tag, then the release of that commit');
});

test('the release workflow creates the release as a draft and makes it public last', () => {
  const publish = step('make release-publish', /^make release-publish$/);
  const undraft = step('make release-undraft', /^make release-undraft TAG="\$TAG"$/);
  assert.ok(publish.line < undraft.line, `release-undraft (line ${undraft.line}) runs after release-publish (line ${publish.line})`);
  const last = runs.at(-1);
  assert.ok(last, 'the workflow runs no step');
  assert.equal(last.command, undraft.command, 'release-undraft is the last step');
});

test('no step of the release workflow continues past a failure', () => {
  assert.ok(!lines.some(line => /continue-on-error/.test(line)), 'a failed step fails the run');
});

test('the release workflow puts the installed tools on PATH right after release-tools', () => {
  const tools = runs.findIndex(run => /^make release-tools$/.test(run.command));
  assert.notEqual(tools, -1, 'the workflow runs make release-tools');
  assert.equal(runs[tools + 1]?.command, 'make release-tools-path', 'release-tools-path is the next run after release-tools');
});

test('the release workflow sets up the PHP of .php-version without a coverage driver, before release-tools', () => {
  // The step of a set without a PHP minor; a set of a PHP minor sets up that minor (K1189).
  const uses = lines.findIndex((line, index) => /^\s+- uses: shivammathur\/setup-php@[0-9a-f]{40}$/.test(line) && /hashFiles/.test(lines[index + 1] ?? ''));
  assert.notEqual(uses, -1, 'a setup-php step pinned to a commit');
  const minor = lines.findIndex(line => /^\s+- uses: shivammathur\/setup-php@[0-9a-f]{40}$/.test(line));
  assert.deepEqual(lines.slice(minor + 1, minor + 5).map(line => line.trim()), ["if: ${{ matrix.php != '' }}", 'with:', 'php-version: ${{ matrix.php }}', 'coverage: none']);
  const end = lines.findIndex((line, index) => index > uses && /^\s+- /.test(line));
  const body = lines.slice(uses, end).join('\n');
  assert.match(body, /if: \$\{\{ matrix\.php == '' && hashFiles\('\.php-version'\) != '' \}\}/);
  assert.match(body, /php-version-file: \.php-version/);
  assert.match(body, /coverage: none/);
  assert.ok(uses + 1 < step('make release-tools', /^make release-tools$/).line, 'PHP is set up before release-tools');
});

test('the release workflow bootstraps the package, checks the configuration, then prepares the release of the repository, before release-tools (K71-2, K132, K193)', () => {
  // The release runs no gate of its own: release-tag refuses a commit whose CI run did not pass (K193, K755).
  // The job that builds the assets checks its archive tool before it installs anything (K1189).
  const zip = step('the archive preflight', /^command -v zip /);
  assert.equal(runs.find(run => run.line > zip.line && run.command.startsWith('make '))?.command, 'make install-tools TOOLS=npm', 'archive capability is checked before installation');
  // The kit of main tags (K269, K911); the packages of the tagged commit are installed again before its release.
  // The job tag lists the sets of the tagged commit with its own kit, and each job of a set bootstraps that commit again (K1189).
  assert.deepEqual(runs.filter(run => run.command.startsWith('make ')).slice(0, 10).map(run => run.command), ['make install-tools TOOLS=npm', 'make install-packages', "make release-tag ${{ github.event_name == 'workflow_run' && 'AUTO=1' || '' }}", 'make install-tools TOOLS=npm', 'make install-packages', 'make release-sets', 'make install-tools TOOLS=npm', 'make install-packages', 'make release-prepare', 'make release-tools']);
});

test('kit releases itself with the workflow it vendors: .github/workflows/release.yml is workflows/release.yml', () => {
  // config/release.json declares the package @polyspec/kit and its asset; a dispatch runs this workflow, which needs kit's own
  // make targets install-tools and install-packages in the bootstrap order (K79).
  assert.equal(readFileSync(path.join(ROOT, '.github/workflows/release.yml'), 'utf8'), readFileSync(path.join(ROOT, 'workflows/release.yml'), 'utf8'));
  // The bootstrap action that the release workflow runs is the one kit vendors (K992).
  assert.equal(readFileSync(path.join(ROOT, '.github/actions/kit-bootstrap/action.yml'), 'utf8'), readFileSync(path.join(ROOT, 'actions/kit-bootstrap/action.yml'), 'utf8'));
  assert.match(readFileSync(path.join(ROOT, 'Makefile'), 'utf8'), /^install-packages:/m);
});

// K987: a green push run of the CI workflow ci on main starts the release by itself. The workflow checks out the head_sha of that run,
// never a later main, release-tag decides with AUTO whether that commit is the version commit, the steps after it run only for the
// TAG it hands on, and a concurrency group of the repository runs one release at a time without cancelling one.
test('K987: a green push or dispatch run of ci starts the release of its head_sha, which release-tag decides, one at a time', () => {
  const text = lines.join('\n');
  assert.match(text, /^on:\n {2}workflow_run:\n {4}workflows: \[ci\]\n {4}types: \[completed\]\n {4}branches: \[main\]\n/m);
  assert.doesNotMatch(text, /^concurrency:/m, 'a run whose job is skipped joins no group');
  assert.match(text, /^ {4}concurrency:\n {6}group: release-\$\{\{ github\.repository \}\}\n {6}cancel-in-progress: false\n/m);
  assert.match(text, /^ {4}if: \$\{\{ github\.event_name == 'workflow_dispatch' \|\| \(github\.event\.workflow_run\.conclusion == 'success' && \(github\.event\.workflow_run\.event == 'push' \|\| github\.event\.workflow_run\.event == 'workflow_dispatch'\)\) \}\}$/m);
  assert.match(text, /^ {6}RUN: \$\{\{ inputs\.run \|\| github\.event\.workflow_run\.id \}\}$/m);
  assert.match(text, /fetch-depth: 0\n {10}ref: \$\{\{ github\.event\.workflow_run\.head_sha \}\}\n/, 'the checkout is the head_sha of the run');
  const tag = step('make release-tag', /^make release-tag \$\{\{ github\.event_name == 'workflow_run' && 'AUTO=1' \|\| '' \}\}$/);
  // The steps of the job tag after release-tag run only for the tag it hands on.
  const end = lines.findIndex(line => line === '  assets:');
  const after = lines.slice(tag.line, end).filter(line => /^ {6}- (?:name|uses):/.test(line));
  assert.ok(after.length > 0);
  lines.slice(tag.line, end).forEach((line, index) => {
    if (/^ {6}- (?:name|uses):/.test(line)) assert.ok(lines.slice(tag.line + index + 1, tag.line + index + 3).includes("        if: ${{ steps.tag.outputs.tag != '' }}"), `${line.trim()} runs only for a tag`);
  });
});
