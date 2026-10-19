// Tests of the requirement trace of the parity check (S6, K273): every requirement that docs/spec defines is cited by a unit
// of config/parity.json, so the bindings of every implementation of its profile test it, and a unit cites only requirements
// that the spec defines.
import assert from 'node:assert/strict';
import test from 'node:test';
import { requirementFindings } from '../../scripts/kit/parity-requirements.mts';

const SPEC = {
  'docs/spec/api.md': '# API\n\n- **AB-1** Encode keeps the order.\n- **AB-2** Decode rejects a duplicate key.\n\n## AB-3 Errors\n\nAB-1 is cited here, not defined.\n',
  'docs/spec/api.ko.md': '- **AB-9** the twin defines nothing\n',
  'docs/operations/x.md': '- **AB-8** outside the spec\n',
};
const read = (files: Record<string, string>) => (file: string) => files[file] ?? '';
type Unit = { id: string; kind?: 'suite' | 'feature' | 'api'; file?: string; requirements: string[]; bindings?: { implementation: string; test: string }[] };
const TESTS = { 'go/a_test.go': '// AB-1 AB-2 AB-3', 'ts/a.test.ts': "test('keeps the order (AB-1, AB-2, AB-3)')" };
const bound = (unit: Unit): Unit => ({ kind: 'feature', bindings: [{ implementation: 'go', test: 'go/a_test.go' }, { implementation: 'ts', test: 'ts/a.test.ts' }], ...unit });
const run = (units: Unit[], files: Record<string, string> = SPEC) => {
  const all = { ...TESTS, ...files };
  return requirementFindings({ requirements: { pattern: 'AB-[0-9]+' }, units: units.map(bound) }, Object.keys(all), read(all)).map(f => `${f.rule} ${f.unit ?? '-'}${f.implementation ? ` ${f.implementation}` : ''}: ${f.message}`);
};

test('every requirement that the spec defines is cited by a unit: no finding', () => {
  assert.deepEqual(run([{ id: 'codec', requirements: ['AB-1', 'AB-3'] }, { id: 'decode', requirements: ['AB-2'] }]), []);
});

test('a requirement that no unit cites is untraced (R13), and the Korean twin and other folders define none', () => {
  assert.deepEqual(run([{ id: 'codec', requirements: ['AB-1', 'AB-3'] }]), [
    'R13 -: docs/spec/api.md defines AB-2, which no unit of config/parity.json cites; add the unit that tests it in every implementation of its profile',
  ]);
});

test('a unit that cites a requirement the spec does not define fails (R14)', () => {
  assert.deepEqual(run([{ id: 'codec', requirements: ['AB-1', 'AB-2', 'AB-3', 'AB-8'] }]), [
    'R14 codec: cites AB-8, which no file of docs/spec defines as a requirement (a bullet **AB-8** or a heading AB-8)',
  ]);
});

test('a requirement defined twice, and a pattern that the spec never matches, fail the declaration', () => {
  const twice = { ...SPEC, 'docs/spec/more.md': '- **AB-2** again\n' };
  assert.deepEqual(run([{ id: 'codec', requirements: ['AB-1', 'AB-2', 'AB-3'] }], twice), [
    'declaration -: AB-2 is defined in docs/spec/api.md and docs/spec/more.md; a requirement has one definition',
  ]);
  assert.deepEqual(run([], { 'docs/spec/api.md': '# nothing\n' }), [
    'declaration -: requirements.pattern AB-[0-9]+ matches no requirement of docs/spec; the spec defines each requirement as a bullet **<id>** or a heading <id>',
  ]);
});

test('a requirement that a test unit cites appears in the test of every binding, or in the vector file of a suite (R15)', () => {
  const files = { ...SPEC, 'ts/b.test.ts': "test('keeps the order (AB-1)')", 'tests/v.json': '{"AB-2": []}' };
  assert.deepEqual(run([
    { id: 'codec', requirements: ['AB-1', 'AB-3'], bindings: [{ implementation: 'go', test: 'go/a_test.go' }, { implementation: 'ts', test: 'ts/b.test.ts' }] },
    { id: 'vectors', kind: 'suite', file: 'tests/v.json', requirements: ['AB-2'], bindings: [{ implementation: 'ts', test: 'ts/b.test.ts' }] },
  ], files), [
    'R15 codec ts: cites AB-3, which its test ts/b.test.ts does not name; a test names the requirement it tests',
  ]);
});

test('only a unit with tests traces a requirement: one that only an api unit cites is untraced (R13)', () => {
  assert.deepEqual(run([{ id: 'codec', requirements: ['AB-1', 'AB-3'] }, { id: 'surface', kind: 'api', requirements: ['AB-2'], bindings: [] }]), [
    'R13 -: docs/spec/api.md defines AB-2, which no unit of config/parity.json cites; add the unit that tests it in every implementation of its profile',
  ]);
});
