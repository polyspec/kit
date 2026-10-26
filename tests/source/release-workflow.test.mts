// The release workflow source of kit (workflows/release.yml), which kit-sync vendors to every consumer as
// .github/workflows/release.yml. The order is fixed: the tools of the repository are installed first; the release is created
// as a draft; the draft is proved; the release is made public only after the proof passed. The steps after release-tools
// run on the tools it installed, and the Composer proof runs on the PHP of .php-version, which make kit-check requires of a
// repository that needs PHP (K193). kit does not vendor workflows/, so
// only the kit runs this case.
import assert from 'node:assert/strict';
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

test('the release workflow has one job, so every step runs in the job that creates the release', () => {
  const jobs = lines.slice(lines.findIndex(line => line.startsWith('jobs:')) + 1);
  assert.equal(jobs.filter(line => /^  [a-z-]+:$/.test(line)).length, 1, 'the workflow names one job');
});

test('the release workflow installs the tools of the repository before it verifies anything', () => {
  const tools = step('make release-tools', /^make release-tools$/);
  assert.ok(tools.line < step('make release-verify', /^make release-verify$/).line, 'release-tools runs before release-verify');
});

test('the release workflow creates the release as a draft, proves it, and makes it public only after the proof', () => {
  const publish = step('make release-publish', /^make release-publish$/);
  const proof = step('make release-proof', /^make release-proof TAG="\$TAG"$/);
  const undraft = step('make release-undraft', /^make release-undraft TAG="\$TAG"$/);
  assert.ok(publish.line < proof.line, `release-proof (line ${proof.line}) runs after release-publish (line ${publish.line})`);
  assert.ok(proof.line < undraft.line, `release-undraft (line ${undraft.line}) runs after release-proof (line ${proof.line})`);
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
  // make kit-check fails a repository that needs PHP without .php-version, so no release runs the PHP of the runner (K193).
  const install = step('make install-tools TOOLS=npm', /^make install-tools TOOLS=npm$/);
  assert.ok(step('the Composer archive preflight', /^command -v zip /).line < install.line, 'archive capability is checked before installation');
  assert.deepEqual(runs.filter(run => run.command.startsWith('make ')).slice(0, 6).map(run => run.command), ['make install-tools TOOLS=npm', 'make install-packages', 'make kit-check', 'make release-tag', 'make release-prepare', 'make release-tools']);
  // A dispatch with a tag creates the tag at origin/main; a tag push already has it (K269).
  assert.equal(lines[step('make release-tag', /^make release-tag$/).line - 2]?.trim(), "if: ${{ github.event_name == 'workflow_dispatch' }}");
});

test('kit releases itself with the workflow it vendors: .github/workflows/release.yml is workflows/release.yml', () => {
  // config/release.json declares the package @polyspec/kit and its asset; a tag push runs this workflow, which needs kit's own
  // make targets install-tools and install-packages in the bootstrap order (K79).
  assert.equal(readFileSync(path.join(ROOT, '.github/workflows/release.yml'), 'utf8'), readFileSync(path.join(ROOT, 'workflows/release.yml'), 'utf8'));
  assert.match(readFileSync(path.join(ROOT, 'Makefile'), 'utf8'), /^install-packages:/m);
});
