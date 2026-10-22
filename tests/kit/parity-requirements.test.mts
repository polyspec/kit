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
type Input = { id: string; kind?: 'suite' | 'feature' | 'api'; file?: string; requirements: string[]; bindings?: { implementation: string; test: string }[] };
const TESTS = { 'go/a_test.go': '// AB-1 AB-2 AB-3', 'ts/a.test.ts': "test('keeps the order (AB-1, AB-2, AB-3)')" };
const bound = (unit: Input) => ({ ...unit, kind: unit.kind ?? 'feature', bindings: unit.bindings ?? [{ implementation: 'go', test: 'go/a_test.go' }, { implementation: 'ts', test: 'ts/a.test.ts' }] });
const run = (units: Input[], files: Record<string, string> = SPEC) => {
  const all = { ...TESTS, ...files };
  return requirementFindings({ requirements: { pattern: 'AB-[0-9]+' }, units: units.map(bound) }, Object.keys(all), read(all), new Map()).map(f => `${f.rule} ${f.unit ?? '-'}${f.implementation ? ` ${f.implementation}` : ''}: ${f.message}`);
};

test('every requirement that the spec defines is cited by a unit: no finding', () => {
  assert.deepEqual(run([{ id: 'codec', requirements: ['AB-1', 'AB-3'] }, { id: 'decode', requirements: ['AB-2'] }]), []);
});

test('a requirement defined as a numbered list item is a requirement like a bulleted one (K299)', () => {
  const numbered = { ...SPEC, 'docs/spec/steps.md': '## Steps\n\n1. **AB-4** First step.\n2) **AB-5** Second step.\n10. **AB-6** Tenth step.\n+ **AB-7** A plus bullet.\n' };
  assert.deepEqual(run([{ id: 'codec', requirements: ['AB-1', 'AB-2', 'AB-3'] }], numbered), [
    'R13 -: docs/spec/steps.md defines AB-4, which no unit of config/parity.json cites; add the unit that tests it in every implementation of its profile',
    'R13 -: docs/spec/steps.md defines AB-5, which no unit of config/parity.json cites; add the unit that tests it in every implementation of its profile',
    'R13 -: docs/spec/steps.md defines AB-6, which no unit of config/parity.json cites; add the unit that tests it in every implementation of its profile',
    'R13 -: docs/spec/steps.md defines AB-7, which no unit of config/parity.json cites; add the unit that tests it in every implementation of its profile',
  ]);
});

test('a requirement that no unit cites is untraced (R13), and the Korean twin and other folders define none', () => {
  assert.deepEqual(run([{ id: 'codec', requirements: ['AB-1', 'AB-3'] }]), [
    'R13 -: docs/spec/api.md defines AB-2, which no unit of config/parity.json cites; add the unit that tests it in every implementation of its profile',
  ]);
});

test('a unit that cites a requirement the spec does not define fails (R14)', () => {
  assert.deepEqual(run([{ id: 'codec', requirements: ['AB-1', 'AB-2', 'AB-3', 'AB-8'] }]), [
    'R14 codec: cites AB-8, which no file of docs/spec defines as a requirement (a list item **AB-8** or a heading AB-8)',
  ]);
});

test('a requirement defined twice, and a pattern that the spec never matches, fail the declaration', () => {
  const twice = { ...SPEC, 'docs/spec/more.md': '- **AB-2** again\n' };
  assert.deepEqual(run([{ id: 'codec', requirements: ['AB-1', 'AB-2', 'AB-3'] }], twice), [
    'declaration -: AB-2 is defined at docs/spec/api.md:4 and docs/spec/more.md:1; a requirement has one definition',
  ]);
  assert.deepEqual(run([], { 'docs/spec/api.md': '# nothing\n' }), [
    'declaration -: requirements.pattern AB-[0-9]+ matches no requirement of docs/spec; the spec defines each requirement as a list item **<id>** or a heading <id>',
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

const CASE = (ids: unknown) => JSON.stringify({ stage: 'x', requirements: ids });
const DIRECTORY = { ...SPEC, 'ts/b.test.ts': "test('runs the cases')" };
const directoryRun = (units: (Input & { caseFile?: string })[], files: Record<string, string>, cases: Record<string, string[]>) => {
  const all = { ...TESTS, ...files };
  const config = { requirements: { pattern: 'AB-[0-9]+' }, units: units.map(bound) };
  return requirementFindings(config, Object.keys(all), read(all), new Map(Object.entries(cases))).map(f => `${f.rule} ${f.unit ?? '-'}${f.implementation ? ` ${f.implementation}` : ''}: ${f.message}`);
};
const suite = (id: string, requirements: string[], caseFile?: string): Input & { caseFile?: string } => ({ id, kind: 'suite', file: 'tests/cases', requirements, ...(caseFile === undefined ? {} : { caseFile }), bindings: [{ implementation: 'ts', test: 'ts/b.test.ts' }] });

test('a requirement that a directory suite cites is listed in the case.json of its case directories, never found in other files (R15, K277)', () => {
  const files = { ...DIRECTORY, 'tests/cases/text/order/case.json': CASE(['AB-2']), 'tests/cases/text/order/input.tpl': 'AB-3 is no citation of a case file' };
  assert.deepEqual(directoryRun([suite('cases', ['AB-2', 'AB-3']), { id: 'rest', requirements: ['AB-1'] }], files, { cases: ['text/order'] }), [
    'R15 cases ts: cites AB-3, which its test ts/b.test.ts does not name; a test names the requirement it tests',
  ]);
});

test('caseFile restricts the case set of a unit: an id listed only by a case without that file is unnamed (R15, K277)', () => {
  const files = { ...DIRECTORY, 'tests/cases/a/one/case.json': CASE(['AB-1']), 'tests/cases/a/one/out.html': 'x', 'tests/cases/a/two/case.json': CASE(['AB-2', 'AB-3']) };
  assert.deepEqual(directoryRun([suite('html', ['AB-1', 'AB-2'], 'out.html')], files, { html: ['a/one'] }), [
    'R15 html ts: cites AB-2, which its test ts/b.test.ts does not name; a test names the requirement it tests',
    'R13 -: docs/spec/api.md defines AB-3, which no unit of config/parity.json cites; add the unit that tests it in every implementation of its profile',
  ]);
});

test('a case.json that is missing, not JSON or without a requirements array of strings is a declaration finding (K277)', () => {
  const files = { ...DIRECTORY, 'tests/cases/a/none/input.tpl': 'x', 'tests/cases/a/bad/case.json': '{not json', 'tests/cases/a/shape/case.json': CASE('AB-1'), 'tests/cases/a/mixed/case.json': CASE(['AB-1', 4]), 'tests/cases/a/good/case.json': CASE(['AB-1', 'AB-2', 'AB-3']) };
  const found = directoryRun([suite('cases', ['AB-1', 'AB-2', 'AB-3'])], files, { cases: ['a/none', 'a/bad', 'a/shape', 'a/mixed', 'a/good'] });
  assert.deepEqual(found.map(line => line.replace(/ is not JSON:.*/, ' is not JSON')), [
    'declaration -: tests/cases/a/none/case.json is missing; a case of a directory suite lists the requirements it tests in its case.json',
    'declaration -: tests/cases/a/bad/case.json is not JSON',
    'declaration -: tests/cases/a/shape/case.json: requirements is no array of strings',
    'declaration -: tests/cases/a/mixed/case.json: requirements is no array of strings',
  ]);
});

test('an id of a case.json that the spec does not define is one R14 although two units share the directory (K277)', () => {
  const files = { ...DIRECTORY, 'tests/cases/a/one/case.json': CASE(['AB-1', 'AB-9']), 'tests/cases/a/one/out.html': 'x', 'tests/cases/a/one/out.txt': 'x' };
  assert.deepEqual(directoryRun([suite('html', ['AB-1'], 'out.html'), suite('text', ['AB-1'], 'out.txt'), { id: 'rest', requirements: ['AB-2', 'AB-3'] }], files, { html: ['a/one'], text: ['a/one'] }), [
    'R14 -: tests/cases/a/one/case.json lists AB-9, which no file of docs/spec defines as a requirement (a list item **AB-9** or a heading AB-9)',
  ]);
});

test('only a unit with tests traces a requirement: one that only an api unit cites is untraced (R13)', () => {
  assert.deepEqual(run([{ id: 'codec', requirements: ['AB-1', 'AB-3'] }, { id: 'surface', kind: 'api', requirements: ['AB-2'], bindings: [] }]), [
    'R13 -: docs/spec/api.md defines AB-2, which no unit of config/parity.json cites; add the unit that tests it in every implementation of its profile',
  ]);
});

// K520: a requirement defined twice names the file and line of both definitions, also within one file, and the finding lies on
// config/parity.json, so every filter of units, rules and ids keeps it.
test('a requirement defined twice names the file and line of both definitions and lies on config/parity.json (K520)', () => {
  const twice = { ...SPEC, 'docs/spec/more.md': '# More\n\n- **AB-2** again\n- **AB-2** and again\n' };
  const all = { ...TESTS, ...twice };
  const found = requirementFindings({ requirements: { pattern: 'AB-[0-9]+' }, units: [bound({ id: 'codec', requirements: ['AB-1', 'AB-2', 'AB-3'] })] }, Object.keys(all), read(all), new Map());
  assert.deepEqual(found.map(item => [item.message, item.place]), [
    ['AB-2 is defined at docs/spec/api.md:4 and docs/spec/more.md:3; a requirement has one definition', 'config/parity.json'],
    ['AB-2 is defined at docs/spec/api.md:4 and docs/spec/more.md:4; a requirement has one definition', 'config/parity.json'],
  ]);
});
