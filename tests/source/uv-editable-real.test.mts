// The application declares native development sources; uv owns installation, dependency checks and installed metadata.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { uvEditable } from '../../scripts/kit/uv-install.mts';
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
  const install = () => uvEditable({ directory: app, uv, env });
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
  assert.throws(install, /native Python development installation failed.*compatible local paths/s);
  assert.notEqual(command(['pip', 'check', '--python', python]).status, 0, 'native dependency checking rejects source 0.0.2 against the installed consumer exact release requirement');
});
