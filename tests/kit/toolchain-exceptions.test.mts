// Tests of scripts/kit/toolchain-exceptions.mts: an exception to a pin of kit is declared with its tool, channel, scope,
// reason and retry condition; it allows its channel under its scope only, and one that nothing uses is stale.
import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { Pinning, readExceptions } from '../../scripts/kit/toolchain-exceptions.mts';
import { typescriptFindings } from '../../scripts/kit/toolchain-floors.mts';
import { PINS } from '../../scripts/kit/toolchain-pins.mts';
import { schemaFile, validate } from '../../scripts/kit/schema-validate.mts';
import { tree } from './tree.mts';

const SCHEMA = schemaFile('toolchain.schema.json');

const json = (value: unknown) => JSON.stringify(value);
const SVELTE = { tool: 'typescript', channel: '6.0.3', scope: 'packages/generator-svelte', reason: 'svelte-check and @sveltejs/package need the TypeScript 6 API', retry: 'the Svelte tools admit TypeScript 7' };
const NIGHTLY = { tool: 'rust', channel: 'nightly-2026-10-01', scope: '.', reason: 'parity extracts the Rust symbols with rustdoc JSON', retry: 'rustdoc JSON is stable (rust-lang/rust#76578)' };
const svelte = (t: TestContext, exceptions: unknown[]) => tree(t, {
  'config/toolchain.json': json({ schema: 1, exceptions }),
  'package.json': json({ devDependencies: { typescript: '7.0.2' } }),
  'packages/generator-svelte/package.json': json({ devDependencies: { typescript: '6.0.3' } }),
  'packages/generator-svelte/package-lock.json': json({ packages: { '': { devDependencies: { typescript: '6.0.3' } }, 'node_modules/typescript': { version: '6.0.3' } } }),
  'packages/other/package.json': json({ devDependencies: { typescript: '6.0.3' } }),
});

test('without an exception, TypeScript 6 of generator-svelte is a deviation from the pin', (t) => {
  const root = svelte(t, []);
  const { exceptions, findings } = readExceptions(root);
  assert.deepEqual(findings, []);
  assert.deepEqual(typescriptFindings(root, new Pinning(PINS, exceptions)), [
    'packages/generator-svelte/package-lock.json: packages["node_modules/typescript"].version is "6.0.3"; kit pins typescript 7.0.2, so it must be "7.0.2"',
    'packages/generator-svelte/package.json: devDependencies.typescript is "6.0.3"; kit pins typescript 7.0.2, so it must be "7.0.2"',
    'packages/other/package.json: devDependencies.typescript is "6.0.3"; kit pins typescript 7.0.2, so it must be "7.0.2"',
  ]);
});

test('a declared exception allows its channel under its scope only, and a used exception is not stale', (t) => {
  const root = svelte(t, [SVELTE, NIGHTLY]);
  const { exceptions, findings } = readExceptions(root);
  assert.deepEqual(findings, []);
  const pinning = new Pinning(PINS, exceptions);
  assert.deepEqual(typescriptFindings(root, pinning), [
    'packages/other/package.json: devDependencies.typescript is "6.0.3"; kit pins typescript 7.0.2, so it must be "7.0.2"',
  ]);
  assert.deepEqual(pinning.stale(), [], 'the Rust nightly is read by parity, so it is never stale');
});

test('an exception that nothing uses is stale and names its retry condition', (t) => {
  const root = svelte(t, [{ ...SVELTE, scope: 'packages/other', channel: '6.0.2' }]);
  const pinning = new Pinning(PINS, readExceptions(root).exceptions);
  typescriptFindings(root, pinning);
  assert.deepEqual(pinning.stale(), [
    'config/toolchain.json exceptions[0]: nothing under packages/other uses typescript 6.0.2, so the exception is stale; remove it (its retry condition: the Svelte tools admit TypeScript 7)',
  ]);
});

test('an exception without scope, reason or retry, of an unpinned tool, a wrong channel or a missing scope fails', (t) => {
  const { scope, ...noScope } = SVELTE;
  assert.equal(scope, 'packages/generator-svelte');
  const root = svelte(t, [noScope, { ...SVELTE, reason: ' ', retry: undefined }, { ...SVELTE, tool: 'java' }, { ...SVELTE, channel: '6' }, { ...NIGHTLY, channel: 'nightly' }, { ...SVELTE, scope: 'packages/gone' }, { ...SVELTE, scope: '../outside' }, { ...SVELTE, extra: 1 }, 'svelte']);
  const { exceptions, findings } = readExceptions(root);
  assert.deepEqual(exceptions, []);
  assert.deepEqual(findings, [
    'config/toolchain.json exceptions[0] has no scope; an exception declares tool, channel, scope, reason, retry',
    'config/toolchain.json exceptions[1] has no reason; an exception declares tool, channel, scope, reason, retry',
    'config/toolchain.json exceptions[1] has no retry; an exception declares tool, channel, scope, reason, retry',
    'config/toolchain.json exceptions[2] tool is "java", which kit does not pin; the tools are node, python, php, go, rust, typescript',
    'config/toolchain.json exceptions[3] channel is "6", which is no typescript release at the precision of the pin',
    'config/toolchain.json exceptions[4] channel is "nightly", which is no rust release at the precision of the pin and no nightly-<yyyy-mm-dd>',
    'config/toolchain.json exceptions[5] scope is "packages/gone", which is no directory of the checkout; write "." or a path such as packages/<name>',
    'config/toolchain.json exceptions[6] scope is "../outside", which is no directory of the checkout; write "." or a path such as packages/<name>',
    'config/toolchain.json exceptions[7] has extra, which is no field; the fields are tool, channel, scope, reason, retry',
    'config/toolchain.json exceptions[8] is "svelte", not an object of tool, channel, scope, reason, retry',
  ]);
});

test('the schema of config/toolchain.json requires every field of an exception and names an unknown one', () => {
  assert.deepEqual(validate({ schema: 1, exceptions: [SVELTE, NIGHTLY] }, SCHEMA), []);
  const { retry, ...noRetry } = SVELTE;
  assert.equal(retry, 'the Svelte tools admit TypeScript 7');
  assert.deepEqual(validate({ schema: 1, exceptions: [noRetry, { ...NIGHTLY, tool: 'java', reason: '' }] }, SCHEMA), [
    `/exceptions/0 must have required property 'retry' {"missingProperty":"retry"}`,
    '/exceptions/1/tool must be equal to one of the allowed values {"allowedValues":["node","python","php","go","rust","typescript"]}, value "java"',
    '/exceptions/1/reason must NOT have fewer than 1 characters {"limit":1}, value ""',
  ]);
});
