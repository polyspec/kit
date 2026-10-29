// uv installs the application's lock; kit links each installed polyspec package folder to its checkout (K765). No build backend runs.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { uvInstallCommand, uvLink } from '../../scripts/kit/uv-install.mts';
import { toolCommand, toolsEnvironment } from '../../scripts/kit/mise-tools.mts';
import { toolsPath } from '../../scripts/kit/bootstrap/tool-wrappers.mts';

const ROOT = path.resolve(import.meta.dirname, '../..');

/** A consumer that locks the release wheel of polyspec-provider, and a checkout of the provider whose build backend is in no cache. */
function consumer(t: { after: (fn: () => void) => void }) {
  const directory = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-uv-link-')));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const app = path.join(directory, 'app');
  const release = path.join(directory, 'release');
  const checkout = path.join(directory, 'provider');
  const wheels = path.join(directory, 'wheels');
  const packageSource = (folder: string, backend: string, version: string, value: string) => {
    mkdirSync(path.join(folder, 'src', 'polyspec_provider'), { recursive: true });
    writeFileSync(path.join(folder, 'pyproject.toml'), `[build-system]\nrequires = ["${backend}"]\nbuild-backend = "setuptools.build_meta"\n[project]\nname = "polyspec-provider"\nversion = "${version}"\n`);
    writeFileSync(path.join(folder, 'src', 'polyspec_provider', '__init__.py'), `value = "${value}"\n`);
  };
  packageSource(release, 'setuptools==84.0.0', '0.0.1', 'release');
  // The checkout's backend is in no cache and no find-links folder: a build of it would fail offline.
  packageSource(checkout, 'setuptools==99.0.0', '0.0.2', 'checkout');
  for (const folder of [app, wheels]) mkdirSync(folder);
  const uv = toolCommand(ROOT, 'uv');
  const env = toolsEnvironment(ROOT, { ...process.env, UV_CACHE_DIR: path.join(directory, 'cache'), UV_FIND_LINKS: toolsPath(ROOT, 'wheels'), UV_NO_INDEX: '1', UV_OFFLINE: '1', UV_PROJECT_ENVIRONMENT: '.venv', PYTHONDONTWRITEBYTECODE: '1' });
  const run = (args: string[], cwd: string) => {
    const result = spawnSync(uv, args, { cwd, env, encoding: 'utf8' });
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  };
  run(['build', '--wheel', '--out-dir', wheels], release);
  const wheel = path.join(wheels, readdirSync(wheels).find(name => name.endsWith('.whl')) ?? 'missing');
  const digest = createHash('sha256').update(readFileSync(wheel)).digest('hex');
  const manifest = `[project]\nname = "consumer"\nversion = "0.0.0"\ndependencies = ["polyspec-provider @ ${pathToFileURL(wheel).href}#sha256=${digest}"]\n[tool.uv]\npackage = false\n`;
  writeFileSync(path.join(app, 'pyproject.toml'), manifest);
  run(['venv', '--python', toolCommand(ROOT, 'python3'), '.venv'], app);
  run(['lock'], app);
  run(['sync', '--locked'], app);
  const site = path.join(app, '.venv/lib', readdirSync(path.join(app, '.venv/lib'))[0] ?? 'missing', 'site-packages');
  const provider = { ecosystem: 'python' as const, name: 'polyspec-provider', folder: checkout, repository: checkout, checkout };
  const probe = () => {
    const result = spawnSync(path.join(app, '.venv/bin/python'), ['-c', 'import polyspec_provider; from importlib.metadata import version; print(polyspec_provider.value, version("polyspec-provider"), polyspec_provider.__file__)'], { cwd: app, env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  return { app, checkout, env, manifest, provider, probe, site, uv };
}

test('K765: the installed package folder becomes one link to the checkout, with no build and the release record kept', { timeout: 120_000 }, (t) => {
  const { app, checkout, env, manifest, provider, probe, site, uv } = consumer(t);
  const lock = readFileSync(path.join(app, 'uv.lock'), 'utf8');
  assert.deepEqual(uvLink({ directory: app, providers: [provider], uv, env }), ['polyspec-provider']);
  const folder = path.join(site, 'polyspec_provider');
  assert.ok(lstatSync(folder).isSymbolicLink());
  assert.equal(realpathSync(folder), path.join(checkout, 'src/polyspec_provider'));
  assert.equal(probe(), `checkout 0.0.1 ${path.join(folder, '__init__.py')}`);
  writeFileSync(path.join(checkout, 'src/polyspec_provider/__init__.py'), 'value = "edited"\n');
  assert.match(probe(), /^edited /);
  assert.deepEqual(uvLink({ directory: app, providers: [provider], uv, env }), ['polyspec-provider'], 'a second link changes nothing');
  assert.equal(readFileSync(path.join(app, 'pyproject.toml'), 'utf8'), manifest);
  assert.equal(readFileSync(path.join(app, 'uv.lock'), 'utf8'), lock);
});

test('K765, K539: the installer removes the links before uv writes, so the checkout keeps its files, and links again', { timeout: 120_000 }, (t) => {
  const { app, checkout, env, provider, site, uv } = consumer(t);
  uvLink({ directory: app, providers: [provider], uv, env });
  const lines: string[] = [];
  const status = uvInstallCommand([app, checkout], { ...env, UV: uv, UV_SYNC: '--all-groups' }, line => lines.push(line));
  assert.equal(status, 0, lines.join(''));
  assert.ok(existsSync(path.join(checkout, 'src/polyspec_provider/__init__.py')), 'uv deleted nothing through the link');
  assert.equal(realpathSync(path.join(site, 'polyspec_provider')), path.join(checkout, 'src/polyspec_provider'));
});

test('K769: the installer installs a project locked by pylock.toml and no uv.lock as its own install does, then links', { timeout: 120_000 }, (t) => {
  const { app, checkout, env, site, uv } = consumer(t);
  const exported = spawnSync(uv, ['export', '--frozen', '--format', 'pylock.toml', '--output-file', 'pylock.toml'], { cwd: app, env, encoding: 'utf8' });
  assert.equal(exported.status, 0, exported.stderr);
  rmSync(path.join(app, 'uv.lock'));
  rmSync(path.join(app, '.venv'), { recursive: true });
  const venv = spawnSync(uv, ['venv', '--python', toolCommand(ROOT, 'python3'), '.venv'], { cwd: app, env, encoding: 'utf8' });
  assert.equal(venv.status, 0, venv.stderr);
  const lines: string[] = [];
  assert.equal(uvInstallCommand([app, checkout], { ...env, UV: uv }, line => lines.push(line)), 0, lines.join(''));
  assert.equal(realpathSync(path.join(site, 'polyspec_provider')), path.join(checkout, 'src/polyspec_provider'));
  assert.equal(existsSync(path.join(app, 'uv.lock')), false, 'the installer writes no uv.lock');
});
