// The release workflow source of kit (workflows/release.yml), which kit-sync vendors to every consumer as
// .github/workflows/release.yml. The order is fixed: the tools of the repository are installed first; the release is created
// as a draft; the draft is proved; the release is made public only after the proof passed. kit does not vendor workflows/,
// so only the kit runs this case.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const lines = readFileSync(path.join(ROOT, 'workflows/release.yml'), 'utf8').split('\n');

/** The `run:` commands of the steps in the order the workflow runs them, each with its line number. */
const runs = lines.flatMap((line, index) => {
  const match = /^\s+run: (.+)$/.exec(line);
  return match ? [{ command: match[1], line: index + 1 }] : [];
});
const step = (command, pattern) => {
  const found = runs.find(run => pattern.test(run.command));
  assert.ok(found, `the workflow runs ${command}`);
  return found;
};

test('the release workflow has one job, so every step runs in the job that creates the release', () => {
  const jobs = lines.slice(lines.findIndex(line => /^jobs:/.test(line)) + 1);
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
  assert.equal(runs.at(-1).command, undraft.command, 'release-undraft is the last step');
});

test('no step of the release workflow continues past a failure', () => {
  assert.ok(!lines.some(line => /continue-on-error/.test(line)), 'a failed step fails the run');
});
