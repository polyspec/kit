// The release workflow template that a repository copies (templates/release.yml): after the release is published, the
// workflow proves the published release with make release-proof in the same job, so a failed proof fails the run. kit
// does not vendor templates/, so only the kit runs this case.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const lines = readFileSync(path.join(ROOT, 'templates/release.yml'), 'utf8').split('\n');

/** The `run:` commands of the steps, in the order the workflow runs them, each with its line number. */
const runs = lines.flatMap((line, index) => {
  const match = /^\s+run: (.+)$/.exec(line);
  return match ? [{ command: match[1], line: index + 1 }] : [];
});

test('the release workflow template has one job, so every release step runs in the job that publishes the release', () => {
  assert.equal(lines.filter(line => /^jobs:/.test(line)).length, 1);
  const jobs = lines.slice(lines.findIndex(line => /^jobs:/.test(line)) + 1);
  assert.equal(jobs.filter(line => /^  [a-z-]+:$/.test(line)).length, 1, 'the template names one job');
});

test('the release workflow template runs make release-proof with the tag after make release-publish in the same job', () => {
  const publish = runs.find(({ command }) => command === 'make release-publish');
  assert.ok(publish, 'the template runs make release-publish');
  const proof = runs.find(({ command }) => /^make release-proof\b/.test(command));
  assert.ok(proof, 'the template runs make release-proof after the publish step; no step runs it');
  assert.ok(proof.line > publish.line, `make release-proof (line ${proof.line}) runs after make release-publish (line ${publish.line})`);
  assert.equal(proof.command, 'make release-proof TAG="$TAG"', 'the proof takes the tag of the release from the environment');
  assert.ok(!lines.slice(proof.line - 3, proof.line).some(line => /continue-on-error/.test(line)), 'a failed proof is not continued past');
});
