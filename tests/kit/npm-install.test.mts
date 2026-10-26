// npm-install runs npm ci of the release lock, then npm link connects selected source packages.
// npm owns resolution, installed links and metadata; the release manifest and lock stay unchanged.
// Most cases use a stub; the native case checks source edits, while tests/source/npm-source-link-real.test.mts owns the release-to-source transition.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';
import { npmInstall, npmLink, npmSourceFolders } from '../../scripts/kit/npm-install.mts';
import { toolsPath } from '../../scripts/kit/bootstrap/tool-wrappers.mts';
import type { Provider } from '../../scripts/kit/link-providers.mts';

const LOCK = (names: string[]) => {
  const packages: Record<string, { version?: string }> = { '': {} };
  for (const name of names) packages[`node_modules/${name}`] = { version: '0.0.1' };
  return `${JSON.stringify({ name: 'app', lockfileVersion: 3, requires: true, packages })}\n`;
};

/**
 * A stub npm that logs each subcommand to npm.log and, for ci, writes its allow-remote to npm-ci.env (K526), empties node_modules and
 * installs each package of the lock as a copy.
 */
function stubNpm(root: string): { npm: string; log: string } {
  const log = path.join(root, 'npm.log');
  const script = path.join(root, 'npm-ci.mjs');
  writeFileSync(script, `import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, appendFileSync, symlinkSync, realpathSync } from 'node:fs';
import path from 'node:path';
appendFileSync(${JSON.stringify(log)}, process.argv[2] + '\\n');
if (process.argv[2] === 'link') {
  const names = process.argv.slice(3).filter(argument => !argument.startsWith('--'));
  const global = path.join(process.env.npm_config_prefix, 'lib/node_modules');
  const links = names.length === 0
    ? [{ target: process.cwd(), folder: path.join(global, JSON.parse(readFileSync('package.json', 'utf8')).name) }]
    : names.map(name => ({ target: realpathSync(path.join(global, name)), folder: path.join('node_modules', name) }));
  for (const { target, folder } of links) {
    rmSync(folder, { recursive: true, force: true });
    mkdirSync(path.dirname(folder), { recursive: true });
    symlinkSync(path.relative(path.dirname(path.resolve(folder)), target), folder);
  }
}
if (process.argv[2] === 'ci') {
  writeFileSync(${JSON.stringify(path.join(root, 'npm-ci.env'))}, 'allow-remote=' + (process.env.npm_config_allow_remote ?? 'unset') + '\\n');
  mkdirSync('node_modules', { recursive: true });
  for (const entry of readdirSync('node_modules')) rmSync(path.join('node_modules', entry), { recursive: true, force: true });
  const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
  for (const key of Object.keys(lock.packages ?? {})) {
    if (!key.startsWith('node_modules/')) continue;
    const name = key.slice('node_modules/'.length);
    mkdirSync(path.join('node_modules', name), { recursive: true });
    writeFileSync(path.join('node_modules', name, 'package.json'), JSON.stringify({ name, version: lock.packages[key].version }));
  }
}
`);
  const npm = path.join(root, 'npm');
  writeFileSync(npm, `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(script)} "$@"\n`, { mode: 0o755 });
  return { npm, log };
}

/** A root with a checkout folder that provides `name` and the project app, whose manifest declares `declared` and whose lock holds `locked`. */
function fixture(t: { after: (fn: () => void) => void }, prefix: string, declared: Record<string, string>, locked: string[]) {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), prefix)));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const project = path.join(root, 'app');
  mkdirSync(project, { recursive: true });
  const manifest = `${JSON.stringify({ name: 'app', version: '1.0.0', private: true, dependencies: declared }, null, 2)}\n`;
  writeFileSync(path.join(project, 'package.json'), manifest);
  writeFileSync(path.join(project, 'package-lock.json'), LOCK(locked));
  return { root, project, manifest, lock: LOCK(locked), ...stubNpm(root) };
}

/** The provider folder of the npm package folder `folder`: the real folder of its package.json, through a tree of per-file links (K558). */
const npmTarget = (folder: string): string => path.dirname(realpathSync(path.join(folder, 'package.json')));

const provider = (folder: string, name: string) => {
  mkdirSync(folder, { recursive: true });
  writeFileSync(path.join(folder, 'package.json'), JSON.stringify({ name, version: '0.0.9', main: 'index.js' }));
  writeFileSync(path.join(folder, 'index.js'), 'module.exports = 1;\n');
  return folder;
};

test('native npm links expose source edits and retain release files on repeated linking (K657-1)', (t) => {
  const { root, project, manifest, lock } = fixture(t, 'kit-npm-native-', { '@example/local': 'https://example.invalid/local-0.0.1.tgz' }, ['@example/local']);
  const source = provider(path.join(root, 'source'), '@example/local');
  const npm = toolsPath(path.resolve(import.meta.dirname, '../..'), 'bin', 'npm');
  const folders = [{ ecosystem: 'npm' as const, name: '@example/local', folder: path.join(project, 'node_modules/@example/local'), target: source }];
  const env = { ...process.env, npm_config_offline: 'true' };
  const value = () => spawnSync(process.execPath, ['-p', 'require("@example/local")'], { cwd: project, encoding: 'utf8' });
  npmLink(project, folders, npm, env, () => {});
  assert.equal(value().stdout.trim(), '1');
  writeFileSync(path.join(source, 'index.js'), 'module.exports = 2;\n');
  npmLink(project, folders, npm, env, () => {});
  assert.equal(value().stdout.trim(), '2');
  assert.equal(readFileSync(path.join(project, 'package.json'), 'utf8'), manifest);
  assert.equal(readFileSync(path.join(project, 'package-lock.json'), 'utf8'), lock);
});

test('npm install runs npm ci of the tracked lock, then links each provided package to its checkout and changes no tracked file (K448)', (t) => {
  const { root, project, manifest, lock, npm, log } = fixture(t, 'kit-npm-', { '@polyspec/fixture-codec': '0.0.9', 'left-pad': '1.3.0' }, ['@polyspec/fixture-codec', 'left-pad']);
  const sibling = provider(path.join(root, 'fixture-codec'), '@polyspec/fixture-codec');
  const lines: string[] = [];
  assert.equal(npmInstall({ directory: project, checkouts: [sibling], npm, print: text => lines.push(text), env: process.env }), 'linked', lines.join('\n'));
  assert.equal(readFileSync(log, 'utf8'), 'ci\nlink\nlink\n', 'npm owns both the locked install and the local link (K657-1)');
  const link = path.join(project, 'node_modules/@polyspec/fixture-codec');
  assert.equal(lstatSync(link).isSymbolicLink(), true, 'the provided package is one symlink, its installed copy removed (K591)');
  assert.equal(npmTarget(link), realpathSync(sibling));
  assert.equal(lstatSync(path.join(project, 'node_modules/left-pad')).isDirectory(), true, 'a package that no checkout provides stays as installed');
  assert.equal(readFileSync(path.join(project, 'package.json'), 'utf8'), manifest, 'the tracked manifest is unchanged');
  assert.equal(readFileSync(path.join(project, 'package-lock.json'), 'utf8'), lock, 'the tracked lock is unchanged');
});

test('npm install keeps the node_modules directory itself, so a mount point stays (K448)', (t) => {
  const { root, project, npm } = fixture(t, 'kit-npm-mount-', { '@polyspec/fixture-codec': '0.0.9' }, ['@polyspec/fixture-codec']);
  const sibling = provider(path.join(root, 'fixture-codec'), '@polyspec/fixture-codec');
  mkdirSync(path.join(project, 'node_modules'), { recursive: true });
  const kept = statSync(path.join(project, 'node_modules')).ino;
  npmInstall({ directory: project, checkouts: [sibling], npm, print: () => undefined, env: process.env });
  assert.equal(statSync(path.join(project, 'node_modules')).ino, kept, 'node_modules is the same directory');
});

test('npm install takes repository roots in CHECKOUTS, finds their package folders under packages/, and a root that shares its package name (K448)', (t) => {
  const { root, project, npm } = fixture(t, 'kit-npm-roots-', { '@polyspec/fixture-client': '0.0.11', '@polyspec/fixture-server': '0.0.18', '@polyspec/fixture-codec': '0.0.9' }, ['@polyspec/fixture-client', '@polyspec/fixture-server', '@polyspec/fixture-codec']);
  const template = provider(path.join(root, 'client-fixture/packages/ts'), '@polyspec/fixture-client');
  const server = provider(path.join(root, 'server-fixture/packages/server/ts'), '@polyspec/fixture-server');
  provider(path.join(root, 'fixture-codec'), '@polyspec/fixture-codec');
  const js = provider(path.join(root, 'fixture-codec/packages/js'), '@polyspec/fixture-codec');
  const phpOnly = path.join(root, 'json-schema');
  mkdirSync(phpOnly, { recursive: true });
  writeFileSync(path.join(phpOnly, 'composer.json'), '{"name":"opis/json-schema"}');
  npmInstall({ directory: project, checkouts: [path.join(root, 'client-fixture'), path.join(root, 'server-fixture'), path.join(root, 'fixture-codec'), phpOnly], npm, explicit: true, print: () => undefined, env: process.env });
  assert.equal(npmTarget(path.join(project, 'node_modules/@polyspec/fixture-client')), realpathSync(template));
  assert.equal(npmTarget(path.join(project, 'node_modules/@polyspec/fixture-server')), realpathSync(server), 'a package two folders down is found');
  assert.equal(npmTarget(path.join(project, 'node_modules/@polyspec/fixture-codec')), realpathSync(js), 'the package folder, not the root that shares its name');
  assert.throws(() => npmInstall({ directory: project, checkouts: [path.join(root, 'absent')], npm, explicit: true, print: () => undefined, env: process.env }), /absent is no existing directory/);
});

test('npm install with ADD links a checkout whose package the project does not declare, with the tracked files unchanged (K448)', (t) => {
  const { root, project, manifest, lock, npm } = fixture(t, 'kit-npm-add-', {}, []);
  const core = provider(path.join(root, 'limepie/packages/core'), '@limepie/core');
  npmInstall({ directory: project, checkouts: [], added: [path.join(root, 'limepie')], npm, print: () => undefined, env: process.env });
  assert.equal(npmTarget(path.join(project, 'node_modules/@limepie/core')), realpathSync(core));
  assert.equal(readFileSync(path.join(project, 'package.json'), 'utf8'), manifest);
  assert.equal(readFileSync(path.join(project, 'package-lock.json'), 'utf8'), lock);
});

test('make npm-install forwards CHECKOUTS to the tool, which installs the lock and links the package folder (K448)', (t) => {
  const { root, project, npm, log } = fixture(t, 'kit-npm-make-', { '@polyspec/fixture-client': '0.0.11' }, ['@polyspec/fixture-client']);
  const folder = provider(path.join(root, 'client-fixture/packages/ts'), '@polyspec/fixture-client');
  const kit = fileURLToPath(new URL('../..', import.meta.url));
  const made = spawnSync('make', ['--no-print-directory', '-C', kit, 'npm-install', `DIR=${project}`, `CHECKOUTS=${folder}`, `NPM=${npm}`, `NODE=${process.execPath}`], { encoding: 'utf8' });
  assert.equal(made.status, 0, made.stderr);
  assert.equal(readFileSync(log, 'utf8'), 'ci\nlink\nlink\n');
  assert.equal(npmTarget(path.join(project, 'node_modules/@polyspec/fixture-client')), realpathSync(folder));
  assert.equal(existsSync(path.join(project, 'node_modules/@polyspec/fixture-client/index.js')), true);
});

// K483-1: a declared polyspec package with no checkout fails in every mode, naming the package, and no npm ci or npm install runs.
test('npm install refuses a declared polyspec package with no checkout in every mode, naming it, and runs no npm (K483-1)', (t) => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-npm-k483-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const sibling = path.join(root, 'fixture-codec');
  const project = path.join(root, 'app');
  mkdirSync(sibling, { recursive: true });
  mkdirSync(project, { recursive: true });
  writeFileSync(path.join(sibling, 'package.json'), JSON.stringify({ name: '@polyspec/fixture-codec', version: '0.0.9' }));
  writeFileSync(path.join(project, 'package.json'), JSON.stringify({ name: 'app', version: '1.0.0', private: true, dependencies: { '@polyspec/fixture-codec': 'https://example.invalid/fixture-codec-0.0.9.tgz', '@polyspec/missing': 'https://example.invalid/missing-0.0.1.tgz' } }, null, 2) + '\n');
  // The stub npm records each subcommand it is run with; it runs no real npm.
  const log = path.join(root, 'npm.log');
  const stub = path.join(root, 'npm');
  writeFileSync(stub, `#!/bin/sh\nprintf "%s\\n" "$1" >> "${log}"\nmkdir -p node_modules\n`, { mode: 0o755 });
  const modes: [string, string[], boolean][] = [
    ['no checkout is given or found', [], false],
    ['a checkout is found that provides another package', [sibling], false],
    ['the checkouts are named explicitly', [sibling], true],
  ];
  for (const [mode, checkouts, explicit] of modes) {
    assert.throws(() => npmInstall({ directory: project, checkouts, npm: stub, explicit, print: () => undefined, env: process.env }), /@polyspec\/missing/, `${mode}: the refusal names the package`);
  }
  assert.equal(existsSync(log), false, 'no npm subcommand runs in any mode');
});

test('make npm-install ADD=<checkout> passes each checkout to the tool with --add, and none without ADD (K485)', () => {
  const kitRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
  const dry = (...extra: string[]) => spawnSync('make', ['-n', 'npm-install', 'DIR=examples/app', ...extra], { cwd: kitRoot, encoding: 'utf8' });
  const plain = dry();
  assert.equal(plain.status, 0, plain.stderr);
  assert.doesNotMatch(plain.stdout, /--add/, plain.stdout);
  const added = dry('ADD=/work/core /work/template');
  assert.equal(added.status, 0, added.stderr);
  assert.match(added.stdout, /npm-install\.(mts|mjs|js) examples\/app\s+--add \/work\/core --add \/work\/template\s*$/m, added.stdout);
});

// K526: every consumer lock resolves @polyspec/kit from the URL of its release asset, which npm refuses unless allow-remote opts in, so
// the npm ci of npm-install runs with allow-remote=root, as install-packages does: only the URLs that package.json names.
test('npm install runs npm ci with allow-remote=root, so a lock that names the release of kit installs (K526)', (t) => {
  const { root, project, npm } = fixture(t, 'kit-npm-', { 'left-pad': '1.3.0' }, ['left-pad']);
  const { npm_config_allow_remote: _unset, ...env } = process.env;
  npmInstall({ directory: project, checkouts: [], npm, print: () => {}, env });
  assert.equal(readFileSync(path.join(root, 'npm-ci.env'), 'utf8'), 'allow-remote=root\n');
});


test('npmSourceFolders includes all declared provider sections and installed transitives without selecting unrelated sources (K664-5)', (t) => {
  const { root, project } = fixture(t, 'kit-npm-source-candidates-', {}, []);
  const manifest = { dependencies: { direct: '0.0.1', unknown: '0.0.1' }, devDependencies: { dev: '0.0.1' }, optionalDependencies: { optional: '0.0.1' }, peerDependencies: { peer: '0.0.1' } };
  writeFileSync(path.join(project, 'package.json'), JSON.stringify(manifest));
  mkdirSync(path.join(project, 'node_modules/transitive'), { recursive: true });
  const providers: Provider[] = ['direct', 'dev', 'optional', 'peer', 'transitive', 'unrelated'].map(name => ({ ecosystem: 'npm', name, folder: path.join(root, name), repository: root, checkout: root }));
  providers.push({ ecosystem: 'composer', name: 'other', folder: path.join(root, 'other'), repository: root, checkout: root });
  const selected = npmSourceFolders(project, providers);
  assert.deepEqual(selected.map(folder => folder.name).sort(), ['dev', 'direct', 'optional', 'peer', 'transitive']);
  for (const folder of selected) {
    assert.equal(folder.ecosystem, 'npm');
    assert.equal(folder.folder, path.join(project, 'node_modules', folder.name));
    assert.equal(folder.target, path.join(root, folder.name));
  }
  assert.equal(existsSync(path.join(project, 'node_modules/direct')), false, 'candidate selection installs nothing');
  assert.equal(readFileSync(path.join(project, 'package.json'), 'utf8'), JSON.stringify(manifest));
});

test('npmSourceFolders follows each selected local package to its transitive local providers (K672)', (t) => {
  const { root, project } = fixture(t, 'kit-npm-source-graph-', { '@polyspec/fixture-language': '0.0.18' }, []);
  const language = provider(path.join(root, 'providers/language'), '@polyspec/fixture-language');
  const storage = provider(path.join(root, 'providers/storage'), '@polyspec/fixture-storage');
  const codec = provider(path.join(root, 'providers/fixture-codec'), '@polyspec/fixture-codec');
  writeFileSync(path.join(language, 'package.json'), JSON.stringify({ name: '@polyspec/fixture-language', dependencies: { '@polyspec/fixture-storage': '0.0.18' } }));
  writeFileSync(path.join(storage, 'package.json'), JSON.stringify({ name: '@polyspec/fixture-storage', dependencies: { '@polyspec/fixture-codec': '0.0.9' } }));
  const unrelated = provider(path.join(root, 'providers/unrelated'), '@polyspec/unrelated');
  const providerFolders: [string, string][] = [['@polyspec/fixture-language', language], ['@polyspec/fixture-storage', storage],
    ['@polyspec/fixture-codec', codec], ['@polyspec/unrelated', unrelated]];
  const providers: Provider[] = providerFolders.map(([name, folder]) => ({ ecosystem: 'npm', name, folder, repository: root, checkout: root }));
  const selected = npmSourceFolders(project, providers);
  assert.deepEqual(selected.map(item => item.name).sort(), ['@polyspec/fixture-codec', '@polyspec/fixture-language', '@polyspec/fixture-storage']);
  for (const item of selected) assert.equal(item.folder, path.join(project, 'node_modules', item.name));
  assert.equal(selected.find(item => item.name === '@polyspec/fixture-codec')?.target, codec);
});

test('npmLink skips consumer reification when every selected transitive source is already linked (K673)', (t) => {
  const { root, project } = fixture(t, 'kit-npm-source-idempotence-', { '@polyspec/dbspec-language': '0.0.18' }, []);
  const language = provider(path.join(root, 'providers/language'), '@polyspec/dbspec-language');
  const orm = provider(path.join(root, 'providers/orm'), '@polyspec/orm');
  const orderedJson = provider(path.join(root, 'providers/ordered-json'), '@polyspec/ordered-json');
  writeFileSync(path.join(language, 'package.json'), JSON.stringify({ name: '@polyspec/dbspec-language', dependencies: { '@polyspec/orm': '0.0.18' } }));
  writeFileSync(path.join(orm, 'package.json'), JSON.stringify({ name: '@polyspec/orm', dependencies: { '@polyspec/ordered-json': '0.0.9' } }));
  writeFileSync(path.join(project, 'package.json'), JSON.stringify({ name: 'app', private: true, dependencies: { '@polyspec/dbspec-language': '0.0.18' },
    overrides: { '@polyspec/ordered-json': 'https://example.invalid/ordered-json-0.0.9.tgz' } }));
  const providerFolders: [string, string][] = [['@polyspec/dbspec-language', language], ['@polyspec/orm', orm], ['@polyspec/ordered-json', orderedJson]];
  for (const [name, target] of providerFolders) {
    const installed = path.join(project, 'node_modules', name);
    mkdirSync(path.dirname(installed), { recursive: true });
    symlinkSync(path.relative(path.dirname(installed), target), installed, 'dir');
  }
  const providers: Provider[] = providerFolders.map(([name, folder]) => ({ ecosystem: 'npm', name, folder, repository: root, checkout: root }));
  const selected = npmSourceFolders(project, providers);
  const output: string[] = [];
  const npm = toolsPath(path.resolve(import.meta.dirname, '../..'), 'bin', 'npm');
  npmLink(project, selected, npm, { ...process.env, npm_config_offline: 'true', npm_config_cache: path.join(root, 'npm-cache') }, message => output.push(message));
  assert.deepEqual(selected.map(item => item.name).sort(), ['@polyspec/dbspec-language', '@polyspec/ordered-json', '@polyspec/orm']);
  assert.deepEqual(output, ['npm link: every selected package already resolves to its source; skipped consumer reification']);
  assert.equal(existsSync(path.join(project, 'var/link/npm')), false, 'the no-op creates no npm prefix');
});

test('npmLink still uses native linking when one selected source path is wrong (K673)', (t) => {
  const { root, project } = fixture(t, 'kit-npm-source-mixed-', { '@example/local': '0.0.9' }, []);
  const source = provider(path.join(root, 'providers/source'), '@example/local');
  const wrong = provider(path.join(root, 'providers/wrong'), '@example/local');
  const installed = path.join(project, 'node_modules/@example/local');
  mkdirSync(path.dirname(installed), { recursive: true });
  symlinkSync(path.relative(path.dirname(installed), wrong), installed, 'dir');
  const { npm, log } = stubNpm(root);
  const output: string[] = [];
  npmLink(project, [{ ecosystem: 'npm', name: '@example/local', folder: installed, target: source }], npm, process.env,
    message => output.push(message));
  assert.equal(realpathSync(installed), realpathSync(source));
  assert.deepEqual(readFileSync(log, 'utf8').trim().split('\n'), ['link', 'link']);
  assert.equal(output.at(-1), 'npm link: passed');
});
