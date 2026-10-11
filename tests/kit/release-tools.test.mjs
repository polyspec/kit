// The tools of a release (scripts/kit/release-tools.mjs): the install-tools names that config/release.json needs for its
// packages, consumers, Go modules and proof, derived from the configuration and never listed by hand.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { toolsFor } from '../../scripts/kit/release-tools.mjs';

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixture/config/release.json');

test('release-tools derives the install-tools names of the fixture configuration from its packages, consumers and Go modules', () => {
  const config = JSON.parse(readFileSync(FIXTURE, 'utf8'));
  assert.ok(config.proof?.gitTag, 'the fixture proves a git-tag manifest, so the proof needs cargo');
  assert.deepEqual(toolsFor(config), {
    install: ['npm', 'composer', 'python', 'pythonBackend', 'go'],
    system: ['cargo'],
  });
});

test('release-tools installs only the tools that a configuration without Go modules or git-tag proofs needs', () => {
  const config = {
    packages: [{ kind: 'composer', directory: 'packages/php', name: 'vendor/php' }],
    manifests: { 'packages/php/composer.json': 'archive' },
    goModules: {},
    consumers: { composer: { directory: 'tests/composer', smoke: { 'vendor/php': ['php', '-v'] } } },
  };
  assert.deepEqual(toolsFor(config), { install: ['composer'], system: [] });
});

test('release-tools installs the Python and its build backend for a wheel package, and npm for an npm package', () => {
  const config = {
    packages: [
      { kind: 'npm', directory: 'packages/js', name: 'js' },
      { kind: 'wheel', directory: 'packages/py', name: 'py' },
    ],
    goModules: {},
  };
  assert.deepEqual(toolsFor(config), { install: ['npm', 'python', 'pythonBackend'], system: [] });
});
