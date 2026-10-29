// Validates the test identities published in package.json against the provider's actual node:test declarations.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '../..');
type ProviderTest = { id: string; path: string; name: string };
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function providerTests(): ProviderTest[] {
  const manifest: unknown = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.ok(isRecord(manifest) && isRecord(manifest.kit));
  const tests: unknown = manifest.kit.providerTests;
  assert.ok(Array.isArray(tests) && tests.length > 0, 'package.json kit.providerTests must name the provider tests that consumers can bind');
  const ids = new Set<string>();
  return tests.map((entry: unknown, index: number) => {
    assert.ok(isRecord(entry), `provider test ${index} must be an object`);
    const candidate = entry;
    assert.ok(typeof candidate.id === 'string' && /^[a-z][a-z0-9-]*$/.test(candidate.id), `provider test ${index} needs a stable id`);
    assert.ok(!ids.has(candidate.id), `duplicate provider test id ${candidate.id}`);
    ids.add(candidate.id);
    assert.ok(typeof candidate.path === 'string' && candidate.path.startsWith('tests/') && candidate.path.split('/').every(part => part !== '.' && part !== '..'), `provider test ${candidate.id} needs a repository-relative test path`);
    assert.ok(typeof candidate.name === 'string' && candidate.name.trim() !== '', `provider test ${candidate.id} needs an exact node:test title`);
    return { id: candidate.id, path: candidate.path, name: candidate.name };
  });
}

test('the provider test catalog names real, uniquely identified node:test cases', () => {
  for (const declared of providerTests()) {
    const file = path.join(root, declared.path);
    assert.ok(existsSync(file), `${declared.id} names no provider test file: ${declared.path}`);
    const relative = path.relative(realpathSync(root), realpathSync(file));
    assert.ok(relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative), `${declared.id} resolves outside the provider checkout`);
    const escaped = declared.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', '--test-name-pattern', `^${escaped}$`, declared.path], {
      cwd: root,
      encoding: 'utf8',
      timeout: 30_000,
      env,
    });
    assert.equal(result.error, undefined, `${declared.id}: ${result.error?.message ?? ''}`);
    assert.equal(result.status, 0, `${declared.id} did not pass its provider test:\n${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /^# tests 1$/m, `${declared.id} did not select exactly one declared test:\n${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /^# pass 1$/m, `${declared.id} did not execute and pass:\n${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /^# fail 0$/m, `${declared.id} reported a failing test:\n${result.stdout}\n${result.stderr}`);
  }
});
