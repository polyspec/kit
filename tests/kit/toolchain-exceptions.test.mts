// Tests of scripts/kit/toolchain-exceptions.mts: kit reads the exceptions of the tool its caller names, the channel and the scope
// of each; the entries of other tools, the fields kit does not read and the form of a channel are the repository's own (K1072).
import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { readExceptions } from '../../scripts/kit/toolchain-exceptions.mts';
import { tree } from './tree.mts';

const json = (value: unknown) => JSON.stringify(value);
const SVELTE = { tool: 'typescript', channel: '6.0.3', scope: 'packages/generator-svelte', reason: 'svelte-check and @sveltejs/package need the TypeScript 6 API', retry: 'the Svelte tools admit TypeScript 7' };
const NIGHTLY = { tool: 'rust', channel: 'nightly-2026-10-01', scope: '.', reason: 'parity extracts the Rust symbols with rustdoc JSON', retry: 'rustdoc JSON is stable (rust-lang/rust#76578)' };
const repository = (t: TestContext, exceptions: unknown[]) => tree(t, {
  'config/toolchain.json': json({ schema: 1, exceptions }),
  'package.json': json({ devDependencies: { typescript: '7.0.2' } }),
});

test('K1072: the entries of another tool are not read, and refuse nothing', (t) => {
  assert.deepEqual(readExceptions(repository(t, [SVELTE, NIGHTLY]), 'rust'), { exceptions: [{ tool: 'rust', channel: 'nightly-2026-10-01', scope: '.' }], findings: [] });
  assert.deepEqual(readExceptions(repository(t, [SVELTE]), 'rust'), { exceptions: [], findings: [] });
});

test('K1072: an entry of the tool is read by its channel and scope; a missing scope is the whole checkout, and only a missing channel is a finding', (t) => {
  const root = repository(t, [{ tool: 'rust', channel: 'nightly' }, { tool: 'rust', channel: '1.99.0', scope: 'packages/gone', extra: 1 }, { tool: 'rust' }, 'rust']);
  assert.deepEqual(readExceptions(root, 'rust'), {
    exceptions: [{ tool: 'rust', channel: 'nightly', scope: '.' }, { tool: 'rust', channel: '1.99.0', scope: 'packages/gone' }],
    findings: ['config/toolchain.json exceptions[2] of rust names no channel; declare the channel that rust installs'],
  });
});

