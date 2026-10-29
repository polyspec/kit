// Native locked installation must remain readable during local source linking: the link is one plain directory symlink (K761).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { setup, teardown } from '../../scripts/kit/test-hooks.mts';
import { linkFolders } from '../../scripts/kit/link-folders.mts';
import { isJsonObject, readJsonObject } from '../../scripts/kit/bootstrap/files.mts';
import { NPM } from './checkout.mts';

describe('locked npm install with a plain source link (K671-6, K761)', () => {
  let root: string;
  let app: string;
  let source: string;
  let before: string[];
  let failure: unknown;
  const snapshot = () => ['package.json', 'package-lock.json'].map(file => readFileSync(path.join(app, file), 'utf8'));
  const run = (args: string[], cwd: string) => {
    const result = spawnSync(NPM, args, { cwd, encoding: 'utf8', env: { ...process.env, npm_config_offline: 'true', npm_config_cache: path.join(root, 'cache') } });
    assert.equal(result.status, 0, `${args.join(' ')}: ${result.stdout}${result.stderr}`);
    return result.stdout;
  };
  setup('a local tarball lock with a registry range and a selected source', () => {
    root = mkdtempSync(path.join(tmpdir(), 'kit-npm-locked-link-'));
    app = path.join(root, 'app');
    source = path.join(root, 'source');
    const locked = path.join(root, 'locked');
    for (const folder of [app, source, locked]) mkdirSync(folder);
    writeFileSync(path.join(locked, 'package.json'), JSON.stringify({ name: 'locked-proof', version: '1.0.0', main: 'index.cjs' }));
    writeFileSync(path.join(locked, 'index.cjs'), 'module.exports = 17;\n');
    run(['pack', '--ignore-scripts', '--pack-destination', root], locked);
    writeFileSync(path.join(source, 'package.json'), JSON.stringify({ name: 'source-proof', version: '0.0.2', main: 'index.cjs' }));
    writeFileSync(path.join(source, 'index.cjs'), 'module.exports = 2;\n');
    writeFileSync(path.join(app, 'package.json'), JSON.stringify({ name: 'app', private: true, dependencies: { 'locked-proof': `file:${root}/locked-proof-1.0.0.tgz` } }));
    run(['install', '--ignore-scripts', '--no-audit', '--no-fund'], app);
    // Keep the native tarball resolution/integrity but declare its compatible registry range, as a locked consumer may.
    const manifest = readJsonObject(app, 'package.json');
    assert.ok(isJsonObject(manifest.dependencies));
    manifest.dependencies['locked-proof'] = '^1.0.0';
    writeFileSync(path.join(app, 'package.json'), JSON.stringify(manifest));
    const lock = readJsonObject(app, 'package-lock.json');
    assert.ok(isJsonObject(lock.packages));
    const entry = lock.packages[''];
    assert.ok(isJsonObject(entry) && isJsonObject(entry.dependencies));
    entry.dependencies['locked-proof'] = '^1.0.0';
    writeFileSync(path.join(app, 'package-lock.json'), JSON.stringify(lock));
    run(['ci', '--ignore-scripts', '--no-audit', '--no-fund'], app);
    before = snapshot();
    try {
      for (const text of linkFolders([{ ecosystem: 'npm', name: 'source-proof', folder: path.join(app, 'node_modules/source-proof'), target: source }])) process.stdout.write(`[locked-link] ${text}\n`);
    } catch (error) { failure = error; }
  });
  teardown('the locked npm fixture', () => { if (root) rmSync(root, { recursive: true, force: true }); });
  test('links source without resolving an unrelated locked range again', () => {
    assert.equal(failure, undefined, String(failure));
    assert.deepEqual(snapshot(), before);
    const value = spawnSync(process.execPath, ['-p', "require('locked-proof') + require('source-proof')"], { cwd: app, encoding: 'utf8' });
    assert.equal(value.status, 0, value.stderr);
    assert.equal(value.stdout.trim(), '19');
  });

});
