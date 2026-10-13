// The vendored release workflow (workflows/release.yml) and the make target it calls between steps. A release step runs
// with the tools that release-tools installed into var/tools/bin, never with older ones of the runner, so the workflow puts
// that directory on GITHUB_PATH, the file the runner reads between steps; and the Composer proof runs on the PHP that
// .php-version declares. No test uses the network.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// The test is vendored, so it runs in kit and in every consumer. kit.json maps the workflow from its source in kit
// (`workflows/release.yml`) to its copy in a consumer (`.github/workflows/release.yml`); in a checkout exactly one of the two
// exists, and the test reads that one. A checkout holding neither or both is a failure, never a choice.
const KIT = JSON.parse(readFileSync(path.join(ROOT, 'kit.json'), 'utf8'));
const [WORKFLOW_PATH] = (() => {
  const [copy, source] = Object.entries(KIT.vendoredFiles ?? {}).find(([, from]) => from === 'workflows/release.yml') ?? [];
  assert.ok(source, 'kit.json vendors workflows/release.yml');
  const present = [source, copy].filter(file => existsSync(path.join(ROOT, file)));
  assert.equal(present.length, 1, `exactly one of ${source} and ${copy} exists in the checkout, found ${present.length}`);
  return present;
})();
const WORKFLOW = readFileSync(path.join(ROOT, WORKFLOW_PATH), 'utf8');
// The steps of the release job, each as its text from its `- ` line to the next; the last line of a step has no line end.
const steps = WORKFLOW.split(/\n(?=      - )/).slice(1);
const index = pattern => steps.findIndex(step => pattern.test(step));

test('the release workflow puts the installed tools on PATH right after release-tools', () => {
  const tools = index(/run: make release-tools(\n|$)/);
  const pathStep = index(/run: make release-tools-path(\n|$)/);
  assert.notEqual(tools, -1, 'a release-tools step');
  assert.equal(pathStep, tools + 1, 'release-tools-path follows release-tools');
});

test('the release workflow sets up the PHP of .php-version without a coverage driver, before release-tools', () => {
  const php = index(/uses: shivammathur\/setup-php@[0-9a-f]{40}\n/);
  assert.notEqual(php, -1, 'a setup-php step pinned to a commit');
  assert.match(steps[php], /if: \$\{\{ hashFiles\('\.php-version'\) != '' \}\}/);
  assert.match(steps[php], /php-version-file: \.php-version/);
  assert.match(steps[php], /coverage: none/);
  assert.ok(php < index(/run: make release-tools(\n|$)/), 'PHP is set up before release-tools');
});

test('make release-tools-path appends var/tools/bin of the checkout to GITHUB_PATH', (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'release-path-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'github_path');
  writeFileSync(file, '');
  const run = spawnSync('make', ['--no-print-directory', '-f', 'scripts/kit/kit.mk', 'release-tools-path'], { cwd: ROOT, env: { ...process.env, GITHUB_PATH: file }, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(readFileSync(file, 'utf8'), `${ROOT}/var/tools/bin\n`);
});

test('make release-tools-path refuses without GITHUB_PATH and names where it runs', () => {
  const env = { ...process.env };
  delete env.GITHUB_PATH;
  const run = spawnSync('make', ['--no-print-directory', '-f', 'scripts/kit/kit.mk', 'release-tools-path'], { cwd: ROOT, env, encoding: 'utf8' });
  assert.notEqual(run.status, 0);
  assert.match(run.stdout + run.stderr, /release-tools-path: GITHUB_PATH is not set; run it in the release workflow between steps/);
});
