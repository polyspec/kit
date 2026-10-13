// The CI workflow of kit (.github/workflows/ci.yml), which only kit runs. Every gate of a kit commit runs there: the
// documents and the commit messages besides the tests. Without them a commit that fails documents-check passed CI (b415ad8,
// K82).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const text = readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8');
// The group always takes part in a match of the pattern.
const runs = [...text.matchAll(/^\s+run: (.+)$/gm)].map(match => match[1]!);

test('the CI workflow runs documents-check', () => {
  assert.ok(runs.includes('make documents-check'), 'a step runs make documents-check');
});

test('the CI workflow runs commits-check over the commits it was triggered by, on the full commit graph', () => {
  assert.ok(runs.some(run => /^make commits-check RANGE="\$range"$/.test(run)), 'a step runs make commits-check RANGE="$range"');
  assert.match(text, /fetch-depth: 0/, 'the checkout carries the full commit graph, so the range resolves');
});

test('the CI workflow installs the packages with the pinned npm and then checks the types (K71-1)', () => {
  const install = runs.indexOf('var/tools/bin/npm ci');
  const typecheck = runs.indexOf('make typecheck');
  assert.ok(runs.indexOf('make install-tools') >= 0 && install > runs.indexOf('make install-tools'), 'npm ci runs after install-tools installed the npm of packageManager');
  assert.ok(typecheck > install, 'make typecheck runs after npm ci installed TypeScript');
});
