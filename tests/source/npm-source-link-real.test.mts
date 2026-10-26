// Native npm replaces a locked release with a selected source only in its consumer; repeated linking converges.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { npmLink, npmSourceFolders } from '../../scripts/kit/npm-install.mts';
import { setup, teardown } from '../../scripts/kit/test-hooks.mts';
import { initRepository } from '../kit/sandbox-repository.mts';
import { NPM } from './checkout.mts';

describe('native npm release-to-source linking (K664-5)', () => {
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
  setup('installing the local release and linking its newer source twice with npm', () => {
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
    const link = () => npmLink(consumer, folders, NPM, { ...process.env, npm_config_offline: 'true' }, text => process.stdout.write(`[npm-source] ${text}\n`));
    link();
    first = state();
    link();
    second = state();
  });
  teardown('the npm source-link fixture', () => { if (directory) rmSync(directory, { recursive: true, force: true }); });
  test('a repeated link converges on source 0.0.2 and exposes edits without relinking while main retains release 0.0.1', () => {
    assert.deepEqual(first, second, 'repeating npmLink retains the same observable installation state');
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


describe('native npm undeployed source selection (K664-5)', () => {
  let directory: string;
  let project: string;
  let source: string;
  let manifest: string;
  setup('linking a declared unpublished provider into an empty install with native npm', () => {
    directory = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-npm-unreleased-')));
    project = path.join(directory, 'app');
    source = path.join(directory, 'provider');
    mkdirSync(project);
    mkdirSync(source);
    manifest = JSON.stringify({ name: 'app', private: true, dependencies: { 'unreleased-proof': '0.0.1' } });
    writeFileSync(path.join(project, 'package.json'), manifest);
    writeFileSync(path.join(source, 'package.json'), JSON.stringify({ name: 'unreleased-proof', version: '0.0.2', main: 'index.cjs' }));
    writeFileSync(path.join(source, 'index.cjs'), 'module.exports = 2;\n');
    const folders = npmSourceFolders(project, [{ ecosystem: 'npm', name: 'unreleased-proof', folder: source, repository: source, checkout: source }]);
    assert.equal(folders.length, 1);
    assert.equal(existsSync(path.join(project, 'node_modules')), false);
    npmLink(project, folders, NPM, { ...process.env, npm_config_offline: 'true' }, text => process.stdout.write(`[npm-unreleased] ${text}\n`));
  });
  teardown('the unpublished npm source fixture', () => { if (directory) rmSync(directory, { recursive: true, force: true }); });
  test('a declared unreleased npm source installs natively without a published release or an existing installed folder', () => {
    const result = spawnSync(process.execPath, ['-p', "JSON.stringify([require('unreleased-proof'), require('unreleased-proof/package.json').version])"], { cwd: project, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), '[2,"0.0.2"]');
    assert.equal(realpathSync(path.join(project, 'node_modules/unreleased-proof')), source);
    assert.equal(readFileSync(path.join(project, 'package.json'), 'utf8'), manifest);
    assert.equal(existsSync(path.join(project, 'package-lock.json')), false, 'npm link creates no synthetic release lock');
  });
});

describe('native npm transitive local source linking (K672)', () => {
  let directory: string;
  let root: string;
  let consumer: string;
  let language: string;
  let orm: string;
  let orderedJson: string;
  let declarations: string[];
  let actual: unknown;
  setup('linking a source package and its transitive source dependencies in a workspace with a release override', () => {
    directory = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-npm-transitive-')));
    root = path.join(directory, 'workspace');
    consumer = path.join(root, 'packages/dbspec-codemirror');
    language = path.join(root, 'packages/dbspec-language');
    orm = path.join(root, 'packages/orm');
    orderedJson = path.join(directory, 'ordered-json/packages/js');
    for (const folder of [consumer, language, orm, orderedJson]) mkdirSync(folder, { recursive: true });
    const remote = 'https://example.invalid/polyspec-ordered-json-npm-0.0.9.tgz';
    const manifest = (name: string, dependencies: Record<string, string> = {}) => ({ name, version: '0.0.18', main: 'index.cjs', dependencies });
    writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'orm-workspace', private: true, workspaces: ['packages/*'],
      dependencies: { '@polyspec/ordered-json': remote }, overrides: { '@polyspec/ordered-json': remote } }));
    writeFileSync(path.join(consumer, 'package.json'), JSON.stringify(manifest('@polyspec/dbspec-codemirror', { '@polyspec/dbspec-language': '0.0.18' })));
    writeFileSync(path.join(language, 'package.json'), JSON.stringify(manifest('@polyspec/dbspec-language', { '@polyspec/orm': '0.0.18' })));
    writeFileSync(path.join(language, 'index.cjs'), "module.exports = require('@polyspec/orm');\n");
    writeFileSync(path.join(orm, 'package.json'), JSON.stringify(manifest('@polyspec/orm', { '@polyspec/ordered-json': '0.0.9' })));
    writeFileSync(path.join(orm, 'index.cjs'), "module.exports = require('@polyspec/ordered-json');\n");
    writeFileSync(path.join(orderedJson, 'package.json'), JSON.stringify(manifest('@polyspec/ordered-json')));
    writeFileSync(path.join(orderedJson, 'index.cjs'), "module.exports = 'local-ordered-json';\n");
    const links: [string, string][] = [['@polyspec/dbspec-language', language], ['@polyspec/orm', orm], ['@polyspec/ordered-json', orderedJson]];
    for (const [name, folder] of links) {
      const installed = path.join(root, 'node_modules', name);
      mkdirSync(path.dirname(installed), { recursive: true });
      symlinkSync(path.relative(path.dirname(installed), folder), installed, 'dir');
    }
    const providers = [
      { ecosystem: 'npm' as const, name: '@polyspec/dbspec-language', folder: language, repository: root, checkout: root },
      { ecosystem: 'npm' as const, name: '@polyspec/orm', folder: orm, repository: root, checkout: root },
      { ecosystem: 'npm' as const, name: '@polyspec/ordered-json', folder: orderedJson, repository: directory, checkout: directory },
    ];
    declarations = ['package.json', 'package-lock.json'].filter(file => existsSync(path.join(consumer, file))).map(file => readFileSync(path.join(consumer, file), 'utf8'));
    const folders = npmSourceFolders(consumer, providers);
    npmLink(consumer, folders, NPM, { ...process.env, npm_config_offline: 'true', npm_config_cache: path.join(directory, 'cache') }, text => process.stdout.write(`[npm-transitive] ${text}\n`));
    const result = spawnSync(process.execPath, ['-p', "require('@polyspec/dbspec-language')"], { cwd: consumer, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    actual = result.stdout.trim();
  });
  teardown('the transitive npm source fixture', () => { if (directory) rmSync(directory, { recursive: true, force: true }); });
  test('native npm links every local package in the source dependency graph without resolving its release URL (K672)', () => {
    assert.equal(actual, 'local-ordered-json');
    assert.deepEqual(['package.json', 'package-lock.json'].filter(file => existsSync(path.join(consumer, file))).map(file => readFileSync(path.join(consumer, file), 'utf8')), declarations);
    const linkedTargets: [string, string][] = [['@polyspec/dbspec-language', language], ['@polyspec/orm', orm], ['@polyspec/ordered-json', orderedJson]];
    for (const [name, target] of linkedTargets)
      assert.equal(realpathSync(path.join(consumer, 'node_modules', name)), target);
  });
});
