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

test('the CI workflow runs duplication-check after npm ci installed jscpd (K126)', () => {
  const check = runs.indexOf('make duplication-check');
  assert.ok(check > runs.indexOf('var/tools/bin/npm ci'), 'a step runs make duplication-check after npm ci');
});

test('the CI workflow gives kit-test go, python3 and cargo of the pins, not of the runner image (K78)', () => {
  const tools = runs.indexOf('make install-tools');
  const onPath = runs.indexOf('echo "$PWD/var/tools/bin" >> "$GITHUB_PATH"');
  const rust = runs.indexOf('rustup toolchain install');
  const kitTest = runs.indexOf('make kit-test');
  assert.ok(tools >= 0 && onPath > tools, 'install-tools installs the Go of the pin and the Python of pythonBuild into var/tools, which then comes first on PATH');
  assert.ok(rust > 0 && rust < kitTest, 'rustup installs the channel of rust-toolchain.toml before kit-test runs cargo');
  assert.ok(onPath < kitTest);
});

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
  assert.ok(runs.indexOf('make install-tools TOOLS=npm') >= 0 && install > runs.indexOf('make install-tools TOOLS=npm'), 'npm ci runs after install-tools installed the npm of packageManager');
  assert.ok(typecheck > install, 'make typecheck runs after npm ci installed TypeScript');
});

test('the CI workflow bootstraps in the order of a repository: the npm of packageManager, npm ci, then the other tools (K71-2)', () => {
  assert.deepEqual(runs.slice(0, 3), ['make install-tools TOOLS=npm', 'var/tools/bin/npm ci', 'make install-tools'], 'the first steps');
});

test('the CI workflow installs the PHP of .php-version before install-tools, which runs PHPUnit on it (K78)', () => {
  // The Composer projects of kit (config/phpunit, config/php-lint) require the PHP of the pin; the runner's own PHP is
  // older, so the workflow installs the declared release first (CI run 38438896766 failed on PHP 8.3.6).
  assert.equal(readFileSync(path.join(ROOT, '.php-version'), 'utf8').trim(), '8.5');
  const setup = text.indexOf('php-version-file: .php-version');
  const tools = text.indexOf('run: make install-tools\n');
  assert.ok(setup >= 0, 'the workflow sets up PHP from .php-version');
  assert.ok(tools > setup, 'install-tools runs after the PHP of .php-version is installed');
});
