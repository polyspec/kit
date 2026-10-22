// K448: `make npm-install` installs the tracked lock with npm ci as it is, then replaces each installed package that a checkout provides with a
// direct symlink to the checkout's package folder; the tracked package.json and package-lock.json stay byte for byte, and no npm resolution
// touches a provided package. The npm of these tests is a stub: its ci installs each package of the lock as a copy, as a release would be.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';
import { npmInstall } from '../../scripts/kit/npm-install.mts';

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
  writeFileSync(script, `import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import path from 'node:path';
appendFileSync(${JSON.stringify(log)}, process.argv[2] + '\\n');
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

const provider = (folder: string, name: string) => {
  mkdirSync(folder, { recursive: true });
  writeFileSync(path.join(folder, 'package.json'), JSON.stringify({ name, version: '0.0.9', main: 'index.js' }));
  writeFileSync(path.join(folder, 'index.js'), 'module.exports = 1;\n');
  return folder;
};

test('npm install runs npm ci of the tracked lock, then links each provided package to its checkout and changes no tracked file (K448)', (t) => {
  const { root, project, manifest, lock, npm, log } = fixture(t, 'kit-npm-', { '@polyspec/ordered-json': '0.0.9', 'left-pad': '1.3.0' }, ['@polyspec/ordered-json', 'left-pad']);
  const sibling = provider(path.join(root, 'ordered-json'), '@polyspec/ordered-json');
  const lines: string[] = [];
  assert.equal(npmInstall({ directory: project, checkouts: [sibling], npm, print: text => lines.push(text), env: process.env }), 'linked', lines.join('\n'));
  assert.equal(readFileSync(log, 'utf8'), 'ci\n', 'npm ci of the tracked lock is the only npm run');
  const link = path.join(project, 'node_modules/@polyspec/ordered-json');
  assert.equal(lstatSync(link).isSymbolicLink(), true, 'the provided package is a link, its installed copy removed');
  assert.equal(realpathSync(link), realpathSync(sibling));
  assert.equal(lstatSync(path.join(project, 'node_modules/left-pad')).isDirectory(), true, 'a package that no checkout provides stays as installed');
  assert.equal(readFileSync(path.join(project, 'package.json'), 'utf8'), manifest, 'the tracked manifest is unchanged');
  assert.equal(readFileSync(path.join(project, 'package-lock.json'), 'utf8'), lock, 'the tracked lock is unchanged');
});

test('npm install keeps the node_modules directory itself, so a mount point stays (K448)', (t) => {
  const { root, project, npm } = fixture(t, 'kit-npm-mount-', { '@polyspec/ordered-json': '0.0.9' }, ['@polyspec/ordered-json']);
  const sibling = provider(path.join(root, 'ordered-json'), '@polyspec/ordered-json');
  mkdirSync(path.join(project, 'node_modules'), { recursive: true });
  const kept = statSync(path.join(project, 'node_modules')).ino;
  npmInstall({ directory: project, checkouts: [sibling], npm, print: () => undefined, env: process.env });
  assert.equal(statSync(path.join(project, 'node_modules')).ino, kept, 'node_modules is the same directory');
});

test('npm install takes repository roots in CHECKOUTS, finds their package folders under packages/, and a root that shares its package name (K448)', (t) => {
  const { root, project, npm } = fixture(t, 'kit-npm-roots-', { '@polyspec/template': '0.0.11', '@polyspec/hyper-server': '0.0.18', '@polyspec/ordered-json': '0.0.9' }, ['@polyspec/template', '@polyspec/hyper-server', '@polyspec/ordered-json']);
  const template = provider(path.join(root, 'template/packages/ts'), '@polyspec/template');
  const server = provider(path.join(root, 'hyper/packages/server/ts'), '@polyspec/hyper-server');
  provider(path.join(root, 'ordered-json'), '@polyspec/ordered-json');
  const js = provider(path.join(root, 'ordered-json/packages/js'), '@polyspec/ordered-json');
  const phpOnly = path.join(root, 'json-schema');
  mkdirSync(phpOnly, { recursive: true });
  writeFileSync(path.join(phpOnly, 'composer.json'), '{"name":"opis/json-schema"}');
  npmInstall({ directory: project, checkouts: [path.join(root, 'template'), path.join(root, 'hyper'), path.join(root, 'ordered-json'), phpOnly], npm, explicit: true, print: () => undefined, env: process.env });
  assert.equal(realpathSync(path.join(project, 'node_modules/@polyspec/template')), realpathSync(template));
  assert.equal(realpathSync(path.join(project, 'node_modules/@polyspec/hyper-server')), realpathSync(server), 'a package two folders down is found');
  assert.equal(realpathSync(path.join(project, 'node_modules/@polyspec/ordered-json')), realpathSync(js), 'the package folder, not the root that shares its name');
  assert.throws(() => npmInstall({ directory: project, checkouts: [path.join(root, 'absent')], npm, explicit: true, print: () => undefined, env: process.env }), /absent is no existing directory/);
});

test('npm install with ADD links a checkout whose package the project does not declare, with the tracked files unchanged (K448)', (t) => {
  const { root, project, manifest, lock, npm } = fixture(t, 'kit-npm-add-', {}, []);
  const core = provider(path.join(root, 'limepie/packages/core'), '@limepie/core');
  npmInstall({ directory: project, checkouts: [], added: [path.join(root, 'limepie')], npm, print: () => undefined, env: process.env });
  assert.equal(realpathSync(path.join(project, 'node_modules/@limepie/core')), realpathSync(core));
  assert.equal(readFileSync(path.join(project, 'package.json'), 'utf8'), manifest);
  assert.equal(readFileSync(path.join(project, 'package-lock.json'), 'utf8'), lock);
});

test('make npm-install forwards CHECKOUTS to the tool, which installs the lock and links the package folder (K448)', (t) => {
  const { root, project, npm, log } = fixture(t, 'kit-npm-make-', { '@polyspec/template': '0.0.11' }, ['@polyspec/template']);
  const folder = provider(path.join(root, 'template/packages/ts'), '@polyspec/template');
  const kit = fileURLToPath(new URL('../..', import.meta.url));
  const made = spawnSync('make', ['--no-print-directory', '-C', kit, 'npm-install', `DIR=${project}`, `CHECKOUTS=${folder}`, `NPM=${npm}`, `NODE=${process.execPath}`], { encoding: 'utf8' });
  assert.equal(made.status, 0, made.stderr);
  assert.equal(readFileSync(log, 'utf8'), 'ci\n');
  assert.equal(realpathSync(path.join(project, 'node_modules/@polyspec/template')), realpathSync(folder));
  assert.equal(existsSync(path.join(project, 'node_modules/@polyspec/template/index.js')), true);
});

// K483-1: a declared polyspec package with no checkout fails in every mode, naming the package, and no npm ci or npm install runs.
test('npm install refuses a declared polyspec package with no checkout in every mode, naming it, and runs no npm (K483-1)', (t) => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-npm-k483-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const sibling = path.join(root, 'ordered-json');
  const project = path.join(root, 'app');
  mkdirSync(sibling, { recursive: true });
  mkdirSync(project, { recursive: true });
  writeFileSync(path.join(sibling, 'package.json'), JSON.stringify({ name: '@polyspec/ordered-json', version: '0.0.9' }));
  writeFileSync(path.join(project, 'package.json'), JSON.stringify({ name: 'app', version: '1.0.0', private: true, dependencies: { '@polyspec/ordered-json': 'https://example.invalid/ordered-json-0.0.9.tgz', '@polyspec/missing': 'https://example.invalid/missing-0.0.1.tgz' } }, null, 2) + '\n');
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
