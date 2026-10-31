// Tests of scripts/kit/toolchain-exceptions.mts: kit reads one declared exception, the Rust nightly that parity needs for
// rustdoc JSON. A repository's exception to any other toolchain is refused, and kit judges no version of a toolchain but
// that nightly (S4, K953).
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
  'packages/generator-svelte/package.json': json({ devDependencies: { typescript: '6.0.3' } }),
  'packages/generator-svelte/package-lock.json': json({ packages: { '': { devDependencies: { typescript: '6.0.3' } }, 'node_modules/typescript': { version: '6.0.3' } } }),
  'packages/other/package.json': json({ devDependencies: { typescript: '6.0.3' } }),
});

test('a typescript exception is refused, since kit reads only the Rust nightly exception (K953)', (t) => {
  const { exceptions, findings } = readExceptions(repository(t, [SVELTE]));
  assert.deepEqual(exceptions, []);
  assert.deepEqual(findings, [
    'config/toolchain.json exceptions[0] tool is "typescript", which kit does not declare; the one exception kit reads is a rust nightly (nightly-<yyyy-mm-dd>)',
  ]);
});

test('a typescript package of another release with no exception is neither required nor judged (K953)', (t) => {
  const root = repository(t, [NIGHTLY]);
  const { exceptions, findings } = readExceptions(root);
  assert.deepEqual(exceptions, [{ ...NIGHTLY }]);
  assert.deepEqual(findings, []);
});

test('an exception without scope, reason or retry, of another tool, a channel that is no nightly or a missing scope fails', (t) => {
  const { scope, ...noScope } = NIGHTLY;
  assert.equal(scope, '.');
  const root = repository(t, [noScope, { ...NIGHTLY, reason: ' ', retry: undefined }, { ...NIGHTLY, tool: 'java' }, { ...NIGHTLY, channel: '2026-10-01' }, { ...NIGHTLY, channel: 'nightly' }, { ...NIGHTLY, scope: 'packages/gone' }, { ...NIGHTLY, scope: '../outside' }, { ...NIGHTLY, extra: 1 }, 'rust']);
  const { exceptions, findings } = readExceptions(root);
  assert.deepEqual(exceptions, []);
  assert.deepEqual(findings, [
    'config/toolchain.json exceptions[0] has no scope; an exception declares tool, channel, scope, reason, retry',
    'config/toolchain.json exceptions[1] has no reason; an exception declares tool, channel, scope, reason, retry',
    'config/toolchain.json exceptions[1] has no retry; an exception declares tool, channel, scope, reason, retry',
    'config/toolchain.json exceptions[2] tool is "java", which kit does not declare; the one exception kit reads is a rust nightly (nightly-<yyyy-mm-dd>)',
    'config/toolchain.json exceptions[3] channel is "2026-10-01", which is no rust nightly; write nightly-<yyyy-mm-dd>',
    'config/toolchain.json exceptions[4] channel is "nightly", which is no rust nightly; write nightly-<yyyy-mm-dd>',
    'config/toolchain.json exceptions[5] scope is "packages/gone", which is no directory of the checkout; write "." or a path such as packages/<name>',
    'config/toolchain.json exceptions[6] scope is "../outside", which is no directory of the checkout; write "." or a path such as packages/<name>',
    'config/toolchain.json exceptions[7] has extra, which is no field; the fields are tool, channel, scope, reason, retry',
    'config/toolchain.json exceptions[8] is "rust", not an object of tool, channel, scope, reason, retry',
  ]);
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
