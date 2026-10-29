// A consumer installs the locked release, then its folder becomes one plain link to the selected source (K761); repeated linking converges.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { linkFolders } from '../../scripts/kit/link-folders.mts';
import { setup, teardown } from '../../scripts/kit/test-hooks.mts';
import { initRepository } from '../kit/sandbox-repository.mts';
import { NPM } from './checkout.mts';

describe('release-to-source plain linking (K664-5, K761)', () => {
  let directory: string;
  let main: string;
  let consumer: string;
  let provider: string;
  let declarations: string[];
  let sourceManifest: string;
  let first: ReturnType<typeof state>;
  let second: ReturnType<typeof state>;
  const snapshot = (cwd: string) => ['package.json', 'package-lock.json'].map(file => readFileSync(path.join(cwd, file), 'utf8'));
  const run = (command: string, args: string[], cwd: string) => {
    process.stdout.write(`[npm-source] ${path.basename(cwd)}: ${command} ${args.join(' ')}: started\n`);
    const result = spawnSync(command, args, { cwd, encoding: 'utf8', env: { ...process.env, npm_config_offline: 'true', npm_config_cache: path.join(directory, 'cache') } });
    assert.equal(result.status, 0, `${command} ${args.join(' ')}: ${result.stdout}${result.stderr}`);
    process.stdout.write(`[npm-source] ${path.basename(cwd)}: finished\n`);
    return result.stdout.trim();
  };
  const value = (cwd: string) => run(process.execPath, ['-p', "require('transition-proof')"], cwd);
  const version = (cwd: string) => run(process.execPath, ['-p', "require('transition-proof/package.json').version"], cwd);
  function state() {
    return {
      target: realpathSync(path.join(consumer, 'node_modules/transition-proof')),
      value: value(consumer), version: version(consumer), declarations: snapshot(consumer),
      mainValue: value(main), mainVersion: version(main), mainDeclarations: snapshot(main),
      mainStatus: run('git', ['status', '--porcelain'], main),
      sourceManifest: readFileSync(path.join(provider, 'package.json'), 'utf8'),
    };
  }
  setup('installing the local release and linking its newer source twice', () => {
    directory = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-npm-source-')));
    main = path.join(directory, 'main');
    consumer = path.join(directory, 'consumer');
    provider = path.join(directory, 'provider');
    const release = path.join(directory, 'release');
    for (const cwd of [main, provider, release]) mkdirSync(cwd);
    writeFileSync(path.join(release, 'package.json'), JSON.stringify({ name: 'transition-proof', version: '0.0.1', main: 'index.cjs' }));
    writeFileSync(path.join(release, 'index.cjs'), 'module.exports = 1;\n');
    run(NPM, ['pack', '--ignore-scripts', '--pack-destination', directory], release);
    sourceManifest = JSON.stringify({ name: 'transition-proof', version: '0.0.2', main: 'index.cjs' });
    writeFileSync(path.join(provider, 'package.json'), sourceManifest);
    writeFileSync(path.join(provider, 'index.cjs'), 'module.exports = 2;\n');
    writeFileSync(path.join(main, 'package.json'), JSON.stringify({ name: 'consumer-proof', private: true, dependencies: { 'transition-proof': `file:${directory}/transition-proof-0.0.1.tgz` } }));
    writeFileSync(path.join(main, '.gitignore'), 'node_modules/\nvar/\n');
    run(NPM, ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund'], main);
    assert.equal(value(main), '1');
    assert.equal(version(main), '0.0.1');
    declarations = snapshot(main);
    initRepository(main);
    run('git', ['add', '.'], main);
    run('git', ['commit', '-qm', 'release fixture'], main);
    run('git', ['worktree', 'add', '-qb', 'consumer', consumer], main);
    run(NPM, ['ci', '--offline', '--ignore-scripts', '--no-audit', '--no-fund'], consumer);
    assert.equal(value(consumer), '1');
    assert.equal(version(consumer), '0.0.1');
    const folders = [{ ecosystem: 'npm' as const, name: 'transition-proof', folder: path.join(consumer, 'node_modules/transition-proof'), target: provider }];
    const link = () => { for (const text of linkFolders(folders)) process.stdout.write(`[npm-source] ${text}\n`); };
    link();
    first = state();
    link();
    second = state();
  });
  teardown('the npm source-link fixture', () => { if (directory) rmSync(directory, { recursive: true, force: true }); });
  test('a repeated link converges on source 0.0.2 and exposes edits without relinking while main retains release 0.0.1', () => {
    assert.deepEqual(first, second, 'repeating the link retains the same observable installation state');
    assert.equal(second.target, provider);
    assert.equal(second.value, '2');
    assert.equal(second.version, '0.0.2');
    assert.equal(second.mainValue, '1');
    assert.equal(second.mainVersion, '0.0.1');
    assert.equal(second.mainStatus, '');
    assert.equal(second.sourceManifest, sourceManifest);
    assert.deepEqual(second.declarations, declarations);
    assert.deepEqual(second.mainDeclarations, declarations);
    writeFileSync(path.join(provider, 'index.cjs'), 'module.exports = 3;\n');
    assert.equal(value(consumer), '3');
    assert.equal(value(main), '1');
    assert.equal(version(consumer), '0.0.2');
    assert.deepEqual(snapshot(consumer), declarations);
    assert.deepEqual(snapshot(main), declarations);
    assert.equal(readFileSync(path.join(provider, 'package.json'), 'utf8'), sourceManifest);
    assert.equal(run('git', ['status', '--porcelain'], main), '');
  });
});
