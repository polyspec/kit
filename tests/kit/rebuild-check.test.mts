// Tests of scripts/kit/rebuild-check.mts: every tool that config/rebuild.json selects has a class, and each class carries
// what S1 and S8 ask of it. Each rule has a passing and a failing case.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { rebuildFindings } from '../../scripts/kit/rebuild-check.mts';
import type { RebuildDeclaration } from '../../scripts/kit/rebuild-check.mts';
import { tree } from './tree.mts';
import { tool } from './kit-tools.mts';

const RECORD = '<!-- doc-id: rebuild-lock -->\n# Rebuild record: lock\n\n## Covers\n\n- `scripts/kit/lock.mts`\n';
const FILES = {
  'scripts/kit/lint.mts': '',
  'scripts/kit/lock.mts': '',
  'scripts/kit/glob.mts': '',
  'scripts/kit/release.mts': '',
  'docs/rebuild/lock.md': RECORD,
};
const DECLARATION: RebuildDeclaration = {
  schema: 1,
  paths: ['scripts/kit/*.mts'],
  tools: {
    'scripts/kit/lint.mts': { kind: 'ecosystem', tool: 'ruff' },
    'scripts/kit/lock.mts': { kind: 'record', record: 'docs/rebuild/lock.md' },
    'scripts/kit/glob.mts': { kind: 'replaced', reason: 'picomatch replaces it (K73)' },
    'scripts/kit/release.mts': { kind: 'policy', reason: 'the polyspec release contract' },
  },
};
const tracked = Object.keys(FILES);

test('a declaration that classifies every selected tool, each with what its class needs, has no finding', (t) => {
  assert.deepEqual(rebuildFindings(tree(t, FILES), DECLARATION, tracked), []);
});

test('a selected tool without a class is a finding that names it', (t) => {
  const { 'scripts/kit/release.mts': _, ...tools } = DECLARATION.tools;
  assert.deepEqual(rebuildFindings(tree(t, FILES), { ...DECLARATION, tools }, tracked), [
    'scripts/kit/release.mts: the tool has no class in config/rebuild.json; declare it ecosystem, replaced, record or policy',
  ]);
});

test('a class of a path that is not tracked is a finding', (t) => {
  const tools = { ...DECLARATION.tools, 'scripts/kit/gone.mts': { kind: 'policy', reason: 'r' } } as const;
  assert.deepEqual(rebuildFindings(tree(t, FILES), { ...DECLARATION, tools }, tracked), [
    'config/rebuild.json: scripts/kit/gone.mts is not a tracked file',
  ]);
});

test('each class needs its field: the tool of ecosystem, the reason of replaced and policy, the record of record', (t) => {
  const tools = {
    'scripts/kit/lint.mts': { kind: 'ecosystem' },
    'scripts/kit/lock.mts': { kind: 'record' },
    'scripts/kit/glob.mts': { kind: 'replaced', reason: ' ' },
    'scripts/kit/release.mts': { kind: 'policy' },
  } as RebuildDeclaration['tools'];
  assert.deepEqual(rebuildFindings(tree(t, FILES), { ...DECLARATION, tools }, tracked), [
    'config/rebuild.json: scripts/kit/glob.mts is replaced and needs its reason',
    'config/rebuild.json: scripts/kit/lint.mts is ecosystem and needs the tool it uses',
    'config/rebuild.json: scripts/kit/lock.mts is record and needs its record',
    'config/rebuild.json: scripts/kit/release.mts is policy and needs its reason',
  ]);
});

test('a class that is none of the four is a finding', (t) => {
  const tools = { ...DECLARATION.tools, 'scripts/kit/lint.mts': { kind: 'own' } };
  assert.deepEqual(rebuildFindings(tree(t, FILES), { ...DECLARATION, tools }, tracked), [
    'config/rebuild.json: scripts/kit/lint.mts has the class "own"; the classes are ecosystem, replaced, record and policy',
  ]);
});

test('a record must exist and name the tool it covers', (t) => {
  const missing = { ...DECLARATION.tools, 'scripts/kit/lock.mts': { kind: 'record', record: 'docs/rebuild/none.md' } } as const;
  assert.deepEqual(rebuildFindings(tree(t, FILES), { ...DECLARATION, tools: missing }, tracked), [
    'config/rebuild.json: the record docs/rebuild/none.md of scripts/kit/lock.mts does not exist',
  ]);
  const silent = tree(t, { ...FILES, 'docs/rebuild/lock.md': '<!-- doc-id: rebuild-lock -->\n# Rebuild record: lock\n' });
  assert.deepEqual(rebuildFindings(silent, DECLARATION, tracked), [
    'docs/rebuild/lock.md: the record does not name scripts/kit/lock.mts, which config/rebuild.json says it covers',
  ]);
});

test('the command checks config/rebuild.json of the checkout it runs in and fails with each finding', (t) => {
  const root = tree(t, { ...FILES, 'config/rebuild.json': JSON.stringify({ ...DECLARATION, tools: { 'scripts/kit/lint.mts': { kind: 'ecosystem', tool: 'ruff' } } }) });
  // The tool of this checkout runs in the sandbox, as kit-tools.mts runs the tools of kit.
  const run = (cwd: string) => spawnSync(process.execPath, [tool('rebuild-check')], { cwd, encoding: 'utf8' });
  spawnSync('git', ['add', '-A'], { cwd: root });
  const failed = run(root);
  assert.equal(failed.status, 1, failed.stdout + failed.stderr);
  assert.match(failed.stderr, /scripts\/kit\/lock\.mts: the tool has no class in config\/rebuild\.json/);
});
