// Tests of the gates workflow that kit vendors to every repository (workflows/gates.yml, K270): it runs make -k kit-gates with
// the commit range of the run, and kit-gates reaches every make target that a rule of PRINCIPLES.md names as its check.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (file: string) => readFileSync(path.join(ROOT, file), 'utf8');

test('the gates workflow runs make -k kit-gates, which names every make target that a rule of PRINCIPLES.md is enforced by (K270)', () => {
  assert.match(read('workflows/gates.yml'), /^\s+run: make -k kit-gates RANGE="\$range"$/m);
  const rule = /^kit-gates:([^#\n]*)/m.exec(read('scripts/kit/kit.mk'));
  assert.ok(rule, 'kit.mk defines kit-gates');
  const gates = new Set((rule[1] ?? '').trim().split(/\s+/));
  const enforced = read('PRINCIPLES.md').split('\n').filter(line => line.trim().startsWith('Enforced by:')).join('\n');
  const named = new Set([...enforced.matchAll(/`make ([a-z0-9-]+)`/g)].map(match => match[1]));
  assert.ok(named.size > 10, 'the rules of PRINCIPLES.md name their checks');
  for (const target of named) assert.ok(gates.has(target ?? ''), `kit-gates runs make ${target}`);
});

test('kit vendors the gates workflow to .github/workflows/gates.yml of every repository (K270)', () => {
  assert.match(read('package.json'), /"\.github\/workflows\/gates\.yml": "workflows\/gates\.yml"/);
});

test('kit-gates runs the full parity check, which runs only in CI, so every implementation runs its bindings in the gates (S6, K272)', () => {
  const kitMk = read('scripts/kit/kit.mk');
  assert.match(kitMk, /^kit-gates:[^#\n]* parity-check /m);
  assert.match(kitMk, /^ifneq \(\$\(filter parity-check kit-gates,\$\(MAKECMDGOALS\)\),\)$/m, 'the CI guard of parity-check covers kit-gates');
});
