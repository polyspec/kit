// Tests of the TypeScript lint: oxlint type-aware with the root .oxlintrc.json and knip run from the root, API Extractor in
// each package with an api-extractor.json, but not for the base configuration of kit; every step runs after an earlier one
// failed, and a missing tool or configuration fails with the fix. The tools are stubs.
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { lint, lintSteps } from '../../scripts/kit/lint-ts.mts';
import { initRepository } from './sandbox-repository.mts';

const FILES: Record<string, string> = {
  '.oxlintrc.json': '{}\n',
  'knip.json': '{}\n',
  'config/api-extractor.kit.json': '{}\n',
  'packages/ts/api-extractor.json': '{}\n',
  'packages/ts/src/index.ts': '',
};

function checkout(t: TestContext, { installed = ['oxlint', 'knip', 'api-extractor'], failing = '', omit = '' }: { installed?: string[]; failing?: string; omit?: string } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'kit-lint-ts-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [file, text] of Object.entries(FILES)) {
    if (file === omit) continue;
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  }
  writeFileSync(path.join(root, '.gitignore'), 'node_modules/\n*.log\n');
  const log = path.join(root, 'calls.log');
  mkdirSync(path.join(root, 'node_modules/.bin'), { recursive: true });
  for (const tool of installed) {
    writeFileSync(path.join(root, 'node_modules/.bin', tool), `#!/bin/sh\necho "${tool} $* [$(basename "$PWD")]" >> "${log}"\n${tool === failing ? 'exit 1' : ''}\n`);
    chmodSync(path.join(root, 'node_modules/.bin', tool), 0o755);
  }
  initRepository(root);
  return { root, calls: () => readFileSync(log, 'utf8').split('\n').filter(Boolean).map(line => line.replace(/ \[kit-lint-ts-[^\]]*\]$/, ' [root]')) };
}

const ALL = ['oxlint --type-aware --deny-warnings --format unix -c .oxlintrc.json [root]', 'knip --no-progress [root]', 'api-extractor run [ts]'];

test('oxlint and knip run from the root, and API Extractor in each package but not for the base configuration', (t) => {
  const { root, calls } = checkout(t);
  assert.deepEqual(lint(root, () => {}), []);
  assert.deepEqual(calls(), ALL);
});

test('every step runs after an earlier one failed, and each failure is named', (t) => {
  const { root, calls } = checkout(t, { failing: 'oxlint' });
  assert.deepEqual(lint(root, () => {}), ['oxlint']);
  assert.deepEqual(calls(), ALL);
  assert.deepEqual(lint(checkout(t, { failing: 'api-extractor' }).root, () => {}), ['api-extractor packages/ts']);
});

test('a missing tool or configuration fails with its fix', (t) => {
  assert.throws(() => lintSteps(checkout(t, { installed: ['oxlint', 'knip'] }).root), /node_modules\/\.bin\/api-extractor is missing; run npm ci/);
  assert.throws(() => lintSteps(checkout(t, { omit: '.oxlintrc.json' }).root), /\.oxlintrc\.json is missing; it is the oxlint configuration that kit copies into every repository \(make kit-sync\)/);
  assert.throws(() => lintSteps(checkout(t, { omit: 'knip.json' }).root), /knip\.json is missing; it is the knip configuration that kit copies into every repository \(make kit-sync\)/);
});

test('knip reads knip.json with the entries of config/knip-entries.json after its own, from var/lint-ts/knip.json (K145)', (t) => {
  const { root, calls } = checkout(t);
  writeFileSync(path.join(root, 'knip.json'), JSON.stringify({ node: { entry: ['scripts/**/*.mts'] }, ignoreBinaries: ['make'] }));
  mkdirSync(path.join(root, 'config'), { recursive: true });
  writeFileSync(path.join(root, 'config/knip-entries.json'), JSON.stringify({ schema: 1, entries: { 'packages/js/test/probe.mjs': 'make test-js runs it' } }));
  assert.deepEqual(lint(root, () => {}), []);
  assert.equal(calls()[1], 'knip --no-progress --config var/lint-ts/knip.json [root]');
  assert.deepEqual(JSON.parse(readFileSync(path.join(root, 'var/lint-ts/knip.json'), 'utf8')), { node: { entry: ['scripts/**/*.mts', 'packages/js/test/probe.mjs'] }, ignoreBinaries: ['make'] });
  writeFileSync(path.join(root, 'config/knip-entries.json'), JSON.stringify({ schema: 1, entries: { '../outside.mjs': 'leaves the repository' } }));
  assert.throws(() => lintSteps(root), /config\/knip-entries\.json: \/entries/);
});

test('knip ignores the binaries of config/knip-entries.json after those of knip.json, and entries are optional (K152)', (t) => {
  const { root, calls } = checkout(t);
  writeFileSync(path.join(root, 'knip.json'), JSON.stringify({ node: { entry: ['scripts/**/*.mts'] }, ignoreBinaries: ['make'] }));
  mkdirSync(path.join(root, 'config'), { recursive: true });
  writeFileSync(path.join(root, 'config/knip-entries.json'), JSON.stringify({ schema: 1, binaries: { container: 'the virtiofs tests run Apple container' } }));
  assert.deepEqual(lint(root, () => {}), []);
  assert.equal(calls()[1], 'knip --no-progress --config var/lint-ts/knip.json [root]');
  assert.deepEqual(JSON.parse(readFileSync(path.join(root, 'var/lint-ts/knip.json'), 'utf8')), { node: { entry: ['scripts/**/*.mts'] }, ignoreBinaries: ['make', 'container'] });
  writeFileSync(path.join(root, 'config/knip-entries.json'), JSON.stringify({ schema: 1, binaries: { 'bin/tool': 'a path, not a binary' } }));
  assert.throws(() => lintSteps(root), /config\/knip-entries\.json: \/binaries/);
  writeFileSync(path.join(root, 'config/knip-entries.json'), JSON.stringify({ schema: 1 }));
  assert.throws(() => lintSteps(root), /config\/knip-entries\.json/);
});
