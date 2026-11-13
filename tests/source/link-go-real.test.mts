// The real go reads the go.work that link writes (K1212). A consumer module requires a provider module at a version that no tag
// names, and a module of a repository that is not linked: go loads the module graph of a workspace for a package of such a module,
// and reads the go.mod of every required version there. Go reads each repository of the run from its folder (GOPROXY=direct, a Git
// URL rewrite to the folders of the run, and Git limited to the file transport), so nothing reaches the network.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { link, unlink } from '../../scripts/kit/link.mts';
import { toolCommand } from '../../scripts/kit/mise-tools.mts';
import { initRepository } from '../kit/sandbox-repository.mts';
import { toolsEnvironment } from '../kit/tools-environment.mts';
import { put } from '../kit/tree.mts';

const KIT = path.resolve(import.meta.dirname, '../..');
const PROVIDED = 'github.com/polyspec/prov/legacy/packages/go';
const EXTERNAL = 'github.com/polyspec/ext';

/** The outcome of a command: its status, its standard output, and both of its outputs. */
type Outcome = { status: number | null; stdout: string; text: string };

/**
 * The repositories of a run below one folder, which stands for https://github.com/: the provider `prov` with the module PROVIDED and no
 * tag of it, and `ext` with the module EXTERNAL at the tag v0.0.1, which no checkout links. `consumer` makes the consumer checkout.
 */
function sandbox(t: TestContext) {
  const base = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-link-go-')));
  const go = toolCommand(KIT, 'go');
  const { GOWORK: _inherited, ...inherited } = toolsEnvironment(KIT);
  const env: NodeJS.ProcessEnv = {
    ...inherited, GO: go, GIT_CONFIG_GLOBAL: path.join(base, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1', GIT_ALLOW_PROTOCOL: 'file',
    GOENV: 'off', GOTOOLCHAIN: 'local', GOPROXY: 'direct', GOSUMDB: 'off', GOFLAGS: '', GOPATH: path.join(base, 'gopath'), GOMODCACHE: path.join(base, 'gopath/pkg/mod'),
  };
  const outcome = (directory: string, program: string, ...args: string[]): Outcome => {
    const result = spawnSync(program, args, { cwd: directory, env, encoding: 'utf8' });
    return { status: result.status, stdout: result.stdout, text: `${result.stdout}${result.stderr}` };
  };
  /** The standard output of a command that must pass. */
  const command = (directory: string, program: string, ...args: string[]): string => {
    const result = outcome(directory, program, ...args);
    assert.equal(result.status, 0, `${program} ${args.join(' ')}: ${result.text}`);
    return result.stdout;
  };
  t.after(() => {
    // Go keeps the directories of a module cache read-only, so go removes it.
    if (existsSync(path.join(base, 'gopath'))) spawnSync(go, ['clean', '-modcache'], { cwd: base, env });
    rmSync(base, { recursive: true, force: true });
  });
  writeFileSync(path.join(base, 'gitconfig'), `[url "${base}/"]\n\tinsteadOf = https://github.com/\n`);
  const version = /^go(\d+\.\d+)/.exec(command(base, go, 'env', 'GOVERSION'))?.[1];
  assert.ok(version, 'the go of the checkout names its release');
  const repository = (name: string, files: Record<string, string>, tags: readonly string[] = []): string => {
    const directory = path.join(base, 'polyspec', name);
    initRepository(directory);
    put(directory, files);
    command(directory, 'git', 'add', '-A');
    command(directory, 'git', 'commit', '--quiet', '-m', 'files');
    for (const tag of tags) command(directory, 'git', 'tag', tag);
    return directory;
  };
  const provider = repository('prov', {
    'legacy/packages/go/go.mod': `module ${PROVIDED}\n\ngo ${version}\n`,
    'legacy/packages/go/value/value.go': '// Package value gives the number of the provider.\npackage value\n\n// Value is the number of the provider.\nfunc Value() int { return 7 }\n',
  });
  repository('ext', {
    'go.mod': `module ${EXTERNAL}\n\ngo ${version}\n`,
    'one/one.go': '// Package one gives one.\npackage one\n\n// One is one.\nfunc One() int { return 1 }\n',
  }, ['v0.0.1']);
  /** The files of a module `name` in `folder` that requires PROVIDED at `required` and EXTERNAL, and whose test adds their numbers. */
  const moduleFiles = (folder: string, name: string, required: string): Record<string, string> => ({
    [`${folder}go.mod`]: `module github.com/polyspec/cons/${name}\n\ngo ${version}\n\nrequire (\n\t${EXTERNAL} v0.0.1\n\t${PROVIDED} ${required}\n)\n`,
    [`${folder}sum.go`]: `// Package ${name} adds the numbers of two modules.\npackage ${name}\n\nimport (\n\t"${EXTERNAL}/one"\n\t"${PROVIDED}/value"\n)\n\n// Sum is the sum of both numbers.\nfunc Sum() int { return value.Value() + one.One() }\n`,
    [`${folder}sum_test.go`]: `package ${name}\n\nimport "testing"\n\nfunc TestSum(t *testing.T) {\n\tif Sum() != 8 {\n\t\tt.Fatal("the sum is not 8")\n\t}\n}\n`,
  });
  const consumer = (files: Record<string, string>): string => repository('cons', { '.gitignore': 'go.work\ngo.work.sum\nvar/\n', ...files });
  const run = (directory: string, check: boolean) => {
    const lines: string[] = [];
    const ok = link({ checkouts: [provider], directories: [directory], check, print: text => lines.push(text), env });
    return { ok, text: lines.join('\n') };
  };
  return { provider, env, go, version, moduleFiles, consumer, run, command, outcome };
}

test('K1212: a module that requires a linked Go module at a version without a tag lists, builds and passes its tests through the go.work that link writes', (t) => {
  const box = sandbox(t);
  const consumer = box.consumer(box.moduleFiles('', 'app', 'v0.0.34'));
  const work = path.join(consumer, 'go.work');
  const folder = '../prov/legacy/packages/go';
  // The defect: with the use directives alone, go reads the go.mod of the required version, which no tag names.
  box.command(consumer, box.go, 'work', 'init', '.', folder);
  for (const args of [['list', '-m', 'all'], ['build', './...']]) {
    const alone = box.outcome(consumer, box.go, ...args);
    assert.notEqual(alone.status, 0, `go ${args.join(' ')} with use alone: ${alone.text}`);
    assert.match(alone.text, /unknown revision legacy\/packages\/go\/v0\.0\.34/);
  }
  rmSync(work);
  const linked = box.run(consumer, false);
  assert.equal(linked.ok, true, linked.text);
  const text = readFileSync(work, 'utf8');
  assert.match(text, /^use \(\n\t\.\n\t\.\.\/prov\/legacy\/packages\/go\n\)$/m, text);
  assert.match(text, new RegExp(`^replace ${PROVIDED} v0\\.0\\.34 => ${folder}$`, 'm'), text);
  assert.equal(box.command(consumer, box.go, 'list', '-m', 'all'), `github.com/polyspec/cons/app\n${PROVIDED}\n${EXTERNAL} v0.0.1\n`);
  box.command(consumer, box.go, 'build', './...');
  assert.match(box.command(consumer, box.go, 'test', '-count=1', './...'), /^ok\s+github\.com\/polyspec\/cons\/app\s/m);
  const checked = box.run(consumer, true);
  assert.equal(checked.ok, true, checked.text);
  const again = box.run(consumer, false);
  assert.equal(again.ok, true, again.text);
  assert.equal(readFileSync(work, 'utf8'), text, 'a second link leaves the go.work as it is');
  assert.equal(box.command(consumer, 'git', 'status', '--porcelain'), '', 'the go.work and its go.work.sum are ignored by Git');
  assert.equal(box.command(box.provider, 'git', 'status', '--porcelain'), '', 'link writes nothing into the provider checkout');
  assert.equal(unlink({ directories: [consumer], print: () => {}, env: box.env }), true);
  assert.equal(existsSync(work) || existsSync(`${work}.sum`), false, 'unlink removes the go.work and its go.work.sum');
});

test('K1212: the go.work of a module of a tracked workspace replaces each version that a used module requires, and link-check names a replace that is missing or left over', (t) => {
  const box = sandbox(t);
  const tracked = `go ${box.version}\n\nuse (\n\t./a\n\t./b\n)\n`;
  const consumer = box.consumer({ ...box.moduleFiles('a/', 'a', 'v0.0.34'), ...box.moduleFiles('b/', 'b', 'v0.0.35') });
  // The go.work of the repository is ignored by .gitignore, so it is added by force, as a tracked file of the repository.
  put(consumer, { 'go.work': tracked });
  box.command(consumer, 'git', 'add', '-f', 'go.work');
  box.command(consumer, 'git', 'commit', '--quiet', '-m', 'workspace');
  const work = path.join(consumer, 'a/go.work');
  const folder = '../../prov/legacy/packages/go';
  /** The replace directives of the go.work of the module a, sorted: a single line, or the lines of a block. */
  const replaced = () => [...readFileSync(work, 'utf8').matchAll(/^(?:replace )?\t?(\S+) (v\S+) => (\S+)$/gm)].map(match => match.slice(1).join(' ')).sort();
  const linked = box.run(consumer, false);
  assert.equal(linked.ok, true, linked.text);
  assert.deepEqual(replaced(), [`${PROVIDED} v0.0.34 ${folder}`, `${PROVIDED} v0.0.35 ${folder}`]);
  for (const name of ['a', 'b']) {
    assert.equal(box.command(path.join(consumer, name), box.go, 'list', '-m', 'all'), `github.com/polyspec/cons/a\ngithub.com/polyspec/cons/b\n${PROVIDED}\n${EXTERNAL} v0.0.1\n`);
    box.command(path.join(consumer, name), box.go, 'build', './...');
  }
  assert.equal(box.run(consumer, true).ok, true);
  // A replace that is missing: go fails again on the version, and link-check names it; link writes it again.
  box.command(consumer, box.go, 'work', 'edit', `-dropreplace=${PROVIDED}@v0.0.35`, work);
  assert.match(box.outcome(path.join(consumer, 'a'), box.go, 'list', '-m', 'all').text, /unknown revision legacy\/packages\/go\/v0\.0\.35/);
  const missing = box.run(consumer, true);
  assert.equal(missing.ok, false, missing.text);
  assert.match(missing.text, new RegExp(`NOT linked +go +${PROVIDED} v0\\.0\\.35 \\(go\\.work of ${path.join(consumer, 'a')} does not replace it with `), missing.text);
  assert.equal(box.run(consumer, false).ok, true);
  assert.equal(box.run(consumer, true).ok, true);
  // A replace that is left over, and a requirement that moved to another version.
  box.command(consumer, box.go, 'work', 'edit', `-replace=${PROVIDED}@v0.0.99=${folder}`, work);
  put(consumer, { 'a/go.mod': readFileSync(path.join(consumer, 'a/go.mod'), 'utf8').replace('v0.0.34', 'v0.0.36') });
  const stale = box.run(consumer, true);
  assert.equal(stale.ok, false, stale.text);
  assert.match(stale.text, new RegExp(`NOT linked +go +${PROVIDED} v0\\.0\\.36 \\(go\\.work of ${path.join(consumer, 'a')} does not replace it with `), stale.text);
  for (const version of ['v0\\.0\\.34', 'v0\\.0\\.99']) assert.match(stale.text, new RegExp(`NOT linked +go +${PROVIDED} ${version} \\(go\\.work of ${path.join(consumer, 'a')} replaces it, though `), stale.text);
  assert.equal(box.run(consumer, false).ok, true);
  assert.deepEqual(replaced(), [`${PROVIDED} v0.0.35 ${folder}`, `${PROVIDED} v0.0.36 ${folder}`]);
  assert.equal(box.run(consumer, true).ok, true);
  box.command(path.join(consumer, 'a'), box.go, 'build', './...');
  assert.equal(readFileSync(path.join(consumer, 'go.work'), 'utf8'), tracked, 'the tracked go.work of the repository is unchanged');
});
