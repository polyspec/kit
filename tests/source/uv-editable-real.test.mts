// The application declares native development sources; uv owns installation, dependency checks and installed metadata.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { uvEditable, uvInstallCommand } from '../../scripts/kit/uv-install.mts';
import { toolCommand, toolsEnvironment } from '../../scripts/kit/mise-tools.mts';
import { toolsPath } from '../../scripts/kit/bootstrap/tool-wrappers.mts';

const ROOT = path.resolve(import.meta.dirname, '../..');

test('K664-1: native declared Python sources install new packages, remain idempotent and expose live edits', { timeout: 120_000 }, (t) => {
  const directory = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-uv-declared-real-')));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const app = path.join(directory, 'app');
  mkdirSync(app);
  const provider = (name: string, version: string) => {
    const source = path.join(directory, name);
    mkdirSync(path.join(source, 'src', name), { recursive: true });
    writeFileSync(path.join(source, 'pyproject.toml'), `[build-system]\nrequires = ["setuptools==84.0.0"]\nbuild-backend = "setuptools.build_meta"\n[project]\nname = "${name}"\nversion = "${version}"\n`);
    writeFileSync(path.join(source, 'src', name, '__init__.py'), 'value = 1\n');
    return source;
  };
  const source = provider('declared_provider', '0.0.1');
  provider('declared_fresh', '0.0.1');
  mkdirSync(path.join(app, 'src/app'), { recursive: true });
  writeFileSync(path.join(app, 'src/app/__init__.py'), '');
  const manifest = '[build-system]\nrequires = ["setuptools==84.0.0"]\nbuild-backend = "setuptools.build_meta"\n[project]\nname = "app"\nversion = "0.0.0"\ndependencies = ["declared-provider>=0.0.1", "declared-fresh>=0.0.1"]\n[tool.uv.sources]\ndeclared-provider = { path = "../declared_provider", editable = true }\ndeclared-fresh = { path = "../declared_fresh", editable = true }\n';
  writeFileSync(path.join(app, 'pyproject.toml'), manifest);
  const uv = toolCommand(ROOT, 'uv');
  const env = toolsEnvironment(ROOT, { ...process.env, UV_PROJECT_ENVIRONMENT: '.venv', UV_OFFLINE: '1', UV_NO_INDEX: '1', UV_FIND_LINKS: toolsPath(ROOT, 'wheels'), UV_CACHE_DIR: path.join(directory, 'cache'), PYTHONDONTWRITEBYTECODE: '1' });
  const command = (args: string[]) => spawnSync(uv, args, { cwd: app, env, encoding: 'utf8' });
  const success = (args: string[]) => {
    const result = command(args);
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    return result.stdout;
  };
  success(['venv', '--python', toolCommand(ROOT, 'python3'), '.venv']);
  const python = path.join(app, '.venv/bin/python');
  success(['pip', 'install', '--python', python, source]);
  writeFileSync(path.join(source, 'pyproject.toml'), readFileSync(path.join(source, 'pyproject.toml'), 'utf8').replace('0.0.1', '0.0.2'));
  success(['lock']); // The application prepares its development lock with uv, independently of kit.
  const lock = readFileSync(path.join(app, 'uv.lock'), 'utf8');
  const install = () => {
    const output: string[] = [];
    if (uvInstallCommand([app], { ...env, UV: uv }, message => output.push(message)) !== 0) throw new Error(output.join(''));
    return uvEditable({ directory: app, uv, env });
  };
  assert.deepEqual(install().sort(), ['app', 'declared-fresh', 'declared-provider']);
  const state = () => success(['pip', 'freeze', '--python', python]);
  const first = state();
  assert.deepEqual(install().sort(), ['app', 'declared-fresh', 'declared-provider']);
  assert.equal(state(), first, 'repeated installation has the same native observable state');
  const value = () => {
    const result = spawnSync(python, ['-c', 'import declared_provider, declared_fresh; from importlib.metadata import version; print(declared_provider.value, declared_fresh.value, version("declared-provider")); print(declared_provider.__file__)'], { cwd: app, env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const [values, file] = result.stdout.trim().split('\n');
    assert.equal(file, path.join(source, 'src/declared_provider/__init__.py'), 'the native editable resolves the declared development source');
    return values;
  };
  assert.equal(value(), '1 1 0.0.2');
  writeFileSync(path.join(source, 'src/declared_provider/__init__.py'), 'value = 3\n');
  assert.equal(value(), '3 1 0.0.2', 'source edits need no reinstall');
  assert.equal(readFileSync(path.join(app, 'uv.lock'), 'utf8'), lock);
  assert.equal(readFileSync(path.join(app, 'pyproject.toml'), 'utf8'), manifest);
  writeFileSync(path.join(app, 'pyproject.toml'), manifest.replace('declared-provider>=0.0.1', 'declared-provider==0.0.1'));
  assert.throws(install, /native Python development installation failed.*local provider is compatible/s);
  assert.notEqual(command(['pip', 'check', '--python', python]).status, 0, 'native dependency checking rejects source 0.0.2 against the installed consumer exact release requirement');
});

test("K664-1: uv's native local source is installed editable without changing the application lock", { timeout: 120_000 }, (t) => {
  const directory = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-uv-source-fallback-')));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const app = path.join(directory, 'app');
  const source = path.join(directory, 'source');
  mkdirSync(app);
  mkdirSync(path.join(source, 'src/fallback_provider'), { recursive: true });
  writeFileSync(path.join(source, 'pyproject.toml'), '[build-system]\nrequires = ["setuptools==84.0.0"]\nbuild-backend = "setuptools.build_meta"\n[project]\nname = "polyspec-fallback-provider"\nversion = "0.0.1"\n');
  writeFileSync(path.join(source, 'src/fallback_provider/__init__.py'), 'value = 1\n');
  const manifest = '[project]\nname = "app"\nversion = "0.0.0"\ndependencies = ["polyspec-fallback-provider"]\n[tool.uv]\npackage = false\n[tool.uv.sources]\npolyspec-fallback-provider = { path = "../source" }\n';
  writeFileSync(path.join(app, 'pyproject.toml'), manifest);
  const uv = toolCommand(ROOT, 'uv');
  const env = toolsEnvironment(ROOT, { ...process.env, UV_PROJECT_ENVIRONMENT: '.venv', UV_OFFLINE: '1', UV_NO_INDEX: '1', UV_FIND_LINKS: toolsPath(ROOT, 'wheels'), UV_CACHE_DIR: path.join(directory, 'cache'), PYTHONDONTWRITEBYTECODE: '1' });
  const lock = () => {
    const result = spawnSync(uv, ['lock', '--python', toolCommand(ROOT, 'python3')], { cwd: app, env, encoding: 'utf8' });
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  };
  const providers = [{ ecosystem: 'python' as const, name: 'polyspec-fallback-provider', folder: source, repository: source, checkout: source }];
  lock();
  const locked = readFileSync(path.join(app, 'uv.lock'), 'utf8');
  assert.equal(uvInstallCommand([app, source], { ...env, UV: uv }, () => {}), 0);
  assert.deepEqual(uvEditable({ directory: app, providers, uv, env }), ['polyspec-fallback-provider']);
  const python = path.join(app, '.venv/bin/python');
  const probe = spawnSync(python, ['-c', 'import fallback_provider; print(fallback_provider.value, fallback_provider.__file__)'], { cwd: app, env, encoding: 'utf8' });
  assert.equal(probe.status, 0, probe.stderr);
  assert.equal(probe.stdout.trim(), `1 ${path.join(source, 'src/fallback_provider/__init__.py')}`);
  assert.equal(readFileSync(path.join(app, 'pyproject.toml'), 'utf8'), manifest);
  assert.equal(readFileSync(path.join(app, 'uv.lock'), 'utf8'), locked);
});

test('K689: offline native uv source linking preserves the release URL lock and imports the local editable', { timeout: 120_000 }, (t) => {
  const directory = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-uv-release-source-')));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const app = path.join(directory, 'app');
  const release = path.join(directory, 'release');
  const source = path.join(directory, 'source');
  const wheels = path.join(directory, 'wheels');
  for (const folder of [app, release, source, wheels]) mkdirSync(folder, { recursive: true });
  const packageSource = (folder: string, version: string, value: string) => {
    mkdirSync(path.join(folder, 'src', 'polyspec_provider'), { recursive: true });
    writeFileSync(path.join(folder, 'pyproject.toml'), `[build-system]\nrequires = ["setuptools==84.0.0"]\nbuild-backend = "setuptools.build_meta"\n[project]\nname = "polyspec-provider"\nversion = "${version}"\n`);
    writeFileSync(path.join(folder, 'src', 'polyspec_provider', '__init__.py'), `value = "${value}"\n`);
  };
  packageSource(release, '0.0.1', 'release');
  packageSource(source, '0.0.2', 'source');
  const uv = toolCommand(ROOT, 'uv');
  const env = toolsEnvironment(ROOT, {
    ...process.env,
    UV_CACHE_DIR: path.join(directory, 'cache'),
    UV_FIND_LINKS: toolsPath(ROOT, 'wheels'),
    UV_NO_INDEX: '1',
    UV_OFFLINE: '1',
    UV_PROJECT_ENVIRONMENT: '.venv',
    PYTHONDONTWRITEBYTECODE: '1',
  });
  const run = (args: string[], cwd: string) => {
    const result = spawnSync(uv, args, { cwd, env, encoding: 'utf8' });
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    return result.stdout;
  };
  run(['build', '--wheel', '--out-dir', wheels], release);
  const wheelName = readdirSync(wheels).find(name => name.endsWith('.whl'));
  assert.ok(wheelName, 'the offline build produces its release wheel');
  const wheel = path.join(wheels, wheelName);
  const digest = createHash('sha256').update(readFileSync(wheel)).digest('hex');
  const manifest = `[project]\nname = "consumer"\nversion = "0.0.0"\ndependencies = ["polyspec-provider @ ${pathToFileURL(wheel).href}#sha256=${digest}"]\n[tool.uv]\npackage = false\n`;
  writeFileSync(path.join(app, 'pyproject.toml'), manifest);
  run(['venv', '--python', toolCommand(ROOT, 'python3'), '.venv'], app);
  run(['lock', '--no-sources'], app);
  const lock = readFileSync(path.join(app, 'uv.lock'), 'utf8');
  const python = path.join(app, '.venv/bin/python');
  const provider = { ecosystem: 'python' as const, name: 'polyspec-provider', folder: source, repository: source, checkout: source };
  assert.deepEqual(uvEditable({ directory: app, providers: [provider], uv, env }), ['polyspec-provider']);
  const probe = spawnSync(python, ['-c', 'import polyspec_provider; from importlib.metadata import version; print(polyspec_provider.value, version("polyspec-provider"), polyspec_provider.__file__)'], { cwd: app, env, encoding: 'utf8' });
  assert.equal(probe.status, 0, probe.stderr);
  assert.equal(probe.stdout.trim(), `source 0.0.2 ${path.join(source, 'src/polyspec_provider/__init__.py')}`);
  assert.equal(readFileSync(path.join(app, 'pyproject.toml'), 'utf8'), manifest);
  assert.equal(readFileSync(path.join(app, 'uv.lock'), 'utf8'), lock);
});

test('K689-2: one native transaction resolves an unpublished local runtime dependency and cached external dependency', { timeout: 120_000 }, (t) => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-uv-runtime-graph-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const app = path.join(root, 'app');
  const wheels = path.join(root, 'wheels');
  mkdirSync(app);
  mkdirSync(wheels);
  const source = (folder: string, name: string, version: string, dependencies: string[], value: string) => {
    mkdirSync(path.join(folder, 'src', name.replaceAll('-', '_')), { recursive: true });
    writeFileSync(path.join(folder, 'pyproject.toml'), `[build-system]\nrequires = ["setuptools==84.0.0"]\nbuild-backend = "setuptools.build_meta"\n[project]\nname = "${name}"\nversion = "${version}"\ndependencies = ${JSON.stringify(dependencies)}\n`);
    writeFileSync(path.join(folder, 'src', name.replaceAll('-', '_'), '__init__.py'), `value = "${value}"\n`);
    return { ecosystem: 'python' as const, name, folder, repository: folder, checkout: folder };
  };
  const release = source(path.join(root, 'release'), 'polyspec-beta', '0.0.1', [], 'release');
  const beta = source(path.join(root, 'beta'), 'polyspec-beta', '0.0.2', ['polyspec-unpublished-c>=0.0.1', 'setuptools==84.0.0'], 'development');
  const child = source(path.join(root, 'child'), 'polyspec-unpublished-c', '0.0.1', [], 'unpublished');
  const uv = toolCommand(ROOT, 'uv');
  const env = toolsEnvironment(ROOT, { ...process.env, UV_PROJECT_ENVIRONMENT: '.venv', UV_OFFLINE: '1', UV_NO_INDEX: '1', UV_FIND_LINKS: toolsPath(ROOT, 'wheels'), UV_CACHE_DIR: path.join(root, 'cache'), PYTHONDONTWRITEBYTECODE: '1' });
  const success = (args: string[], cwd = app) => {
    const result = spawnSync(uv, args, { cwd, env, encoding: 'utf8' });
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    return result.stdout;
  };
  success(['build', '--wheel', '--out-dir', wheels], release.folder);
  const wheel = path.join(wheels, readdirSync(wheels).find(file => file.endsWith('.whl')) ?? 'missing');
  const hash = createHash('sha256').update(readFileSync(wheel)).digest('hex');
  const manifest = `[project]\nname = "app"\nversion = "0.0.0"\ndependencies = ["polyspec-beta @ ${pathToFileURL(wheel).href}#sha256=${hash}"]\n[tool.uv]\npackage = false\n`;
  writeFileSync(path.join(app, 'pyproject.toml'), manifest);
  success(['venv', '--python', toolCommand(ROOT, 'python3'), '.venv']);
  success(['lock', '--no-sources']);
  const locked = readFileSync(path.join(app, 'uv.lock'), 'utf8');
  assert.deepEqual(uvEditable({ directory: app, providers: [beta, child], uv, env }).sort(), ['polyspec-beta', 'polyspec-unpublished-c']);
  const python = path.join(app, '.venv/bin/python');
  const probe = () => {
    const result = spawnSync(python, ['-c', 'import polyspec_beta, polyspec_unpublished_c; from importlib.metadata import version; print(polyspec_beta.value, polyspec_unpublished_c.value, version("setuptools")); print(polyspec_beta.__file__); print(polyspec_unpublished_c.__file__)'], { cwd: app, env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim().split('\n');
  };
  assert.deepEqual(probe(), ['development unpublished 84.0.0', path.join(beta.folder, 'src/polyspec_beta/__init__.py'), path.join(child.folder, 'src/polyspec_unpublished_c/__init__.py')]);
  writeFileSync(path.join(child.folder, 'src/polyspec_unpublished_c/__init__.py'), 'value = "edited"\n');
  assert.equal(probe()[0], 'development edited 84.0.0');
  assert.equal(readFileSync(path.join(app, 'pyproject.toml'), 'utf8'), manifest);
  assert.equal(readFileSync(path.join(app, 'uv.lock'), 'utf8'), locked);
});


test('K689-3: newly declared source links into an existing environment while the release installer retains its lock contract', { timeout: 120_000 }, (t) => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-uv-source-only-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const app = path.join(root, 'app');
  const source = path.join(root, 'source');
  mkdirSync(app);
  mkdirSync(path.join(source, 'src/polyspec_new_c'), { recursive: true });
  writeFileSync(path.join(source, 'pyproject.toml'), '[build-system]\nrequires = ["setuptools==84.0.0"]\nbuild-backend = "setuptools.build_meta"\n[project]\nname = "polyspec-new-c"\nversion = "0.0.1"\n');
  writeFileSync(path.join(source, 'src/polyspec_new_c/__init__.py'), 'value = "new-source"\n');
  const initial = '[project]\nname = "app"\nversion = "0.0.0"\ndependencies = []\n[tool.uv]\npackage = false\n';
  writeFileSync(path.join(app, 'pyproject.toml'), initial);
  const uv = toolCommand(ROOT, 'uv');
  const env = toolsEnvironment(ROOT, { ...process.env, UV_PROJECT_ENVIRONMENT: '.venv', UV_OFFLINE: '1', UV_NO_INDEX: '1', UV_FIND_LINKS: toolsPath(ROOT, 'wheels'), UV_CACHE_DIR: path.join(root, 'cache'), PYTHONDONTWRITEBYTECODE: '1' });
  const success = (args: string[]) => {
    const result = spawnSync(uv, args, { cwd: app, env, encoding: 'utf8' });
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  };
  success(['venv', '--python', toolCommand(ROOT, 'python3'), '.venv']);
  success(['lock']);
  success(['sync', '--locked']);
  const locked = readFileSync(path.join(app, 'uv.lock'), 'utf8');
  const manifest = initial.replace('dependencies = []', 'dependencies = ["polyspec-new-c"]');
  writeFileSync(path.join(app, 'pyproject.toml'), manifest);
  const providers = [{ ecosystem: 'python' as const, name: 'polyspec-new-c', folder: source, repository: source, checkout: source }];
  assert.deepEqual(uvEditable({ directory: app, providers, uv, env }), ['polyspec-new-c']);
  const python = path.join(app, '.venv/bin/python');
  const probe = spawnSync(python, ['-c', 'import polyspec_new_c; print(polyspec_new_c.value, polyspec_new_c.__file__)'], { cwd: app, env, encoding: 'utf8' });
  assert.equal(probe.status, 0, probe.stderr);
  assert.equal(probe.stdout.trim(), `new-source ${path.join(source, 'src/polyspec_new_c/__init__.py')}`);
  const errors: string[] = [];
  assert.equal(uvInstallCommand([app, source], { ...env, UV: uv }, message => errors.push(message)), 1, 'the installer still refuses a newly declared package absent from the release lock');
  assert.match(errors.join(''), /native Python development installation failed/);
  assert.equal(readFileSync(path.join(app, 'uv.lock'), 'utf8'), locked);
  assert.equal(readFileSync(path.join(app, 'pyproject.toml'), 'utf8'), manifest);
});
