// Tests of scripts/kit/toolchain-exceptions.mts: kit reads the exceptions of the tool its caller names, the channel and the scope
// of each; the entries of other tools, the fields kit does not read and the form of a channel are the repository's own (K1072).
import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { readExceptions } from '../../scripts/kit/toolchain-exceptions.mts';
import { schemaFile, validate } from '../../scripts/kit/schema-validate.mts';
import { tree } from './tree.mts';

const SCHEMA = schemaFile('toolchain.schema.json');

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

test('the schema of config/toolchain.json accepts only a Rust nightly exception and requires every field of it', () => {
  assert.deepEqual(validate({ schema: 1, exceptions: [NIGHTLY] }, SCHEMA), []);
  const { retry, ...noRetry } = NIGHTLY;
  assert.equal(retry, 'rustdoc JSON is stable (rust-lang/rust#76578)');
  assert.deepEqual(validate({ schema: 1, exceptions: [noRetry, { ...SVELTE, reason: '' }] }, SCHEMA), [
    `/exceptions/0 must have required property 'retry' {"missingProperty":"retry"}`,
    '/exceptions/1/tool must be equal to constant {"allowedValue":"rust"}, value "typescript"',
    '/exceptions/1/channel must match pattern "^nightly-\\d{4}-\\d{2}-\\d{2}$" {"pattern":"^nightly-\\\\d{4}-\\\\d{2}-\\\\d{2}$"}, value "6.0.3"',
    '/exceptions/1/reason must NOT have fewer than 1 characters {"limit":1}, value ""',
  ]);
});
