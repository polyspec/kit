// The leaks of the TypeScript symbol extractor (K307-1), with the real API Extractor: a type that a public signature names and the entry
// point does not export is reported by API Extractor as ae-forgotten-export, which is a leak of an internal symbol.
import assert from 'node:assert/strict';
import test from 'node:test';
import { apiModel } from '../../scripts/kit/parity-symbols.mts';
import { tree } from '../kit/tree.mts';

const PACKAGE = JSON.stringify({ name: '@acme/pkg', version: '1.0.0', types: 'index.d.ts' });

test('a public signature that names a type the entry point does not export is a leak, and an exported one is not (K307-1)', { timeout: 120_000 }, (t) => {
  const leaking = apiModel(tree(t, {
    'package.json': PACKAGE,
    'index.d.ts': 'interface Hidden { x: number }\nexport declare function make(): Hidden;\nexport declare function fine(): number;\nexport {};\n',
  }), 'index.d.ts');
  assert.equal(leaking.error, undefined);
  assert.ok(leaking.symbols?.some(id => id.includes('make')), 'the exported function is a public symbol');
  assert.match((leaking.leaks ?? []).join('\n'), /Hidden/);
  const clean = apiModel(tree(t, {
    'package.json': PACKAGE,
    'index.d.ts': 'export interface Shown { x: number }\nexport declare function make(): Shown;\n',
  }), 'index.d.ts');
  assert.deepEqual(clean.leaks, []);
});
