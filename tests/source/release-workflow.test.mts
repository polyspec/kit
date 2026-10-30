// The release workflow source of kit (workflows/release.yml), which kit-sync vendors to every consumer as
// .github/workflows/release.yml. The order is fixed: the tools of the repository are installed first; the release is created
// as a draft with its archives and then made public. The steps after release-tools run on the tools it installed, and on the
// PHP of .php-version, which make kit-check requires of a repository that needs PHP (K193). kit does not vendor workflows/, so
// only the kit runs this case.
import assert from 'node:assert/strict';
import { assertWorkflowPackageBootstrap } from '../kit/workflow-package-bootstrap.mts';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const lines = readFileSync(path.join(ROOT, 'workflows/release.yml'), 'utf8').split('\n');

/** The `run:` commands of the steps in the order the workflow runs them, each with its line number. */
const runs = lines.flatMap((line, index) => {
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

test('the release workflow has one job, so every step runs in the job that creates the release', () => {
  const jobs = lines.slice(lines.findIndex(line => line.startsWith('jobs:')) + 1);
  assert.equal(jobs.filter(line => /^  [a-z-]+:$/.test(line)).length, 1, 'the workflow names one job');
});

// K911: the release takes the id of a successful CI run and a version; the kit of main tags the commit of the run, and the release
// builds the tagged commit with its own packages. Nothing reads check runs, and no tag push starts a release.
test('K911: a dispatch with a CI run and a version starts the release, which tags the commit of the run before it builds it', () => {
  const text = lines.join('\n');
  assert.match(text, /^on:\n {2}workflow_dispatch:\n {4}inputs:\n {6}run:\n[\s\S]*?\n {6}version:\n/m);
  assert.doesNotMatch(text, /^ {2}push:|tags: \[|inputs\.tag|release-verify|release-go-tags/m);
  assert.match(text, /^permissions:\n {2}contents: write\n {2}actions: read\n/m);
  assert.match(text, /^ {6}TAG: v\$\{\{ inputs\.version \}\}$/m);
  const tag = step('make release-tag', /^make release-tag$/);
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
  const uses = lines.findIndex(line => /^\s+- uses: shivammathur\/setup-php@[0-9a-f]{40}$/.test(line));
  assert.notEqual(uses, -1, 'a setup-php step pinned to a commit');
  const end = lines.findIndex((line, index) => index > uses && /^\s+- /.test(line));
  const body = lines.slice(uses, end).join('\n');
  assert.match(body, /if: \$\{\{ hashFiles\('\.php-version'\) != '' \}\}/);
  assert.match(body, /php-version-file: \.php-version/);
  assert.match(body, /coverage: none/);
  assert.ok(uses + 1 < step('make release-tools', /^make release-tools$/).line, 'PHP is set up before release-tools');
});

test('the release workflow bootstraps the package, checks the configuration, then prepares the release of the repository, before release-tools (K71-2, K132, K193)', () => {
  // The release runs no kit-check of its own: release-tag refuses a commit whose CI run, kit-check included, did not pass (K193, K755).
  const install = step('make install-tools TOOLS=npm', /^make install-tools TOOLS=npm$/);
  assert.ok(step('the Composer archive preflight', /^command -v zip /).line < install.line, 'archive capability is checked before installation');
  // The kit of main tags (K269, K911); the packages of the tagged commit are installed again before its release.
  assert.deepEqual(runs.filter(run => run.command.startsWith('make ')).slice(0, 7).map(run => run.command), ['make install-tools TOOLS=npm', 'make install-packages', 'make release-tag', 'make install-tools TOOLS=npm', 'make install-packages', 'make release-prepare', 'make release-tools']);
});

test('kit releases itself with the workflow it vendors: .github/workflows/release.yml is workflows/release.yml', () => {
  // config/release.json declares the package @polyspec/kit and its asset; a dispatch runs this workflow, which needs kit's own
  // make targets install-tools and install-packages in the bootstrap order (K79).
  assert.equal(readFileSync(path.join(ROOT, '.github/workflows/release.yml'), 'utf8'), readFileSync(path.join(ROOT, 'workflows/release.yml'), 'utf8'));
  assert.match(readFileSync(path.join(ROOT, 'Makefile'), 'utf8'), /^install-packages:/m);
});
