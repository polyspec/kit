// Native Go workspace state belongs to its worktree, while sibling modules remain live source inputs.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { link } from '../../scripts/kit/link.mts';
import { setupWorktree } from '../../scripts/kit/worktree-setup.mts';
import { toolsEnvironment } from '../../scripts/kit/mise-tools.mts';
import { repositoryRoot } from '../../scripts/kit/paths.mts';
import { initRepository } from '../kit/sandbox-repository.mts';
import { tree, put } from '../kit/tree.mts';
import { installedBinary } from './real-tools.mts';
import { NPM } from './checkout.mts';

test('native Go keeps worktree sources, unpublished modules and workspace state across repeated linking (K664-4)', (t) => {
  const root = realpathSync(tree(t));
  const main = path.join(root, 'consumer');
  const provider = path.join(root, 'provider');
  const go = installedBinary('go');
  const env = { ...toolsEnvironment(repositoryRoot()), GO: go, GOPROXY: 'off', GOSUMDB: 'off', GOTOOLCHAIN: 'local', GOFLAGS: '-mod=readonly', GOWORK: 'off' };
  const command = (binary: string, args: string[], cwd: string, extra: NodeJS.ProcessEnv = {}) => {
    const result = spawnSync(binary, args, { cwd, env: { ...env, ...extra }, encoding: 'utf8' });
    assert.equal(result.status, 0, `${binary} ${args.join(' ')}: ${result.stdout}${result.stderr}`);
    return result.stdout.trim();
  };
  const source = (own: number, extra = false) => `package main\n\nimport ("fmt"; "github.com/polyspec/provider"${extra ? '; fresh "github.com/polyspec/provider/fresh"' : ''})\n\nfunc main() { fmt.Println(${own} + provider.Value()${extra ? ' + fresh.Value()' : ''}) }\n`;
  put(main, {
    '.gitignore': 'node_modules/\ngo.work\ngo.work.sum\n',
    'package.json': JSON.stringify({ name: 'go-worktree-consumer', private: true, devDependencies: { '@polyspec/kit': 'file:../kit' } }),
    'Makefile': 'link-state-check:\n\ttrue\n',
    'packages/go/go.mod': 'module github.com/polyspec/consumer\n\ngo 1.21\n\nrequire github.com/polyspec/provider v0.0.1\n',
    'packages/go/go.sum': '',
    'packages/go/main.go': source(100),
    '../kit/package.json': '{"name":"@polyspec/kit","type":"module","exports":{"./link":"./scripts/kit/link.mts"}}',
    '../kit/scripts/kit/link.mts': 'if (process.argv[2] !== "rebuild") process.exit(2);\n',
  });
  put(provider, {
    'go.mod': 'module github.com/polyspec/provider\n\ngo 1.21\n',
    'provider.go': 'package provider\n\nfunc Value() int { return 1 }\n',
  });
  command(NPM, ['install', '--offline', '--no-audit', '--no-fund'], main);
  for (const checkout of [main, provider]) {
    initRepository(checkout, '--initial-branch=main');
    command('git', ['add', '-A'], checkout);
    command('git', ['commit', '--quiet', '-m', 'base'], checkout);
  }
  const mainModule = path.join(main, 'packages/go');
  const mainWork = path.join(main, 'go.work');
  command(go, ['work', 'init', mainModule, provider], main, { GOWORK: mainWork });
  command('git', ['add', '-f', 'go.work'], main);
  command('git', ['commit', '--quiet', '-m', 'tracked workspace'], main);
  command(go, ['work', 'init', mainModule, provider], mainModule, { GOWORK: path.join(mainModule, 'go.work') });
  const records = new Map(['packages/go/go.mod', 'packages/go/go.sum', 'packages/go/main.go', 'go.work', 'packages/go/go.work'].map(file => [file, readFileSync(path.join(main, file), 'utf8')]));
  const row = { name: 'native-go', id: 'K664-4', type: 'fix' };
  const worktree = setupWorktree(main, row, { go, npm: NPM, print: () => {} });
  const folder = path.join(worktree, 'packages/go');
  put(folder, { 'main.go': source(10) });
  const localEnv = { GOWORK: path.join(folder, 'go.work') };
  const run = () => command(go, ['run', '.'], folder, localEnv);
  const state = () => ['go.work', 'go.work.sum', 'go.mod', 'go.sum'].map(file => existsSync(path.join(folder, file)) ? readFileSync(path.join(folder, file), 'utf8') : null);
  const linkSources = () => assert.equal(link({ checkouts: [provider], directories: [folder], check: false, print: () => {}, env }), true);
  assert.equal(run(), '11', 'an absolute main-checkout use must select this worktree source');
  linkSources();
  const first = state();
  linkSources();
  assert.deepEqual(state(), first, 'a repeated native link preserves workspace and checksum state');
  put(provider, { 'provider.go': 'package provider\n\nfunc Value() int { return 2 }\n' });
  assert.equal(run(), '12', 'a provider edit is read without another link or release');
  const fresh = path.join(provider, 'fresh');
  mkdirSync(fresh);
  command(go, ['mod', 'init', 'github.com/polyspec/provider/fresh'], fresh);
  put(fresh, { 'fresh.go': 'package fresh\n\nfunc Value() int { return 3 }\n' });
  command('git', ['add', 'fresh'], provider);
  command(go, ['mod', 'edit', '-require=github.com/polyspec/provider/fresh@v0.0.0'], folder, localEnv);
  put(folder, { 'main.go': source(10, true) });
  const manifest = readFileSync(path.join(folder, 'go.mod'), 'utf8');
  linkSources();
  assert.equal(run(), '15', 'a newly declared module needs no published version');
  const expanded = state();
  linkSources();
  setupWorktree(main, row, { go, npm: NPM, print: () => {} });
  assert.deepEqual(state(), expanded, 'repeated setup retains the worktree workspace, including its new provider module');
  assert.equal(run(), '15');
  assert.equal(readFileSync(path.join(folder, 'go.mod'), 'utf8'), manifest);
  for (const [file, original] of records) assert.equal(readFileSync(path.join(main, file), 'utf8'), original, `main ${file} remains unchanged`);
});
