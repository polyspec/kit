// uv owns editable distributions: source changes are visible without another install, and uv writes its own PEP 610 record.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { uvEditable } from '../../scripts/kit/uv-install.mts';
import { toolCommand, toolsEnvironment } from '../../scripts/kit/mise-tools.mts';
import { toolsPath } from '../../scripts/kit/bootstrap/tool-wrappers.mts';

const ROOT = path.resolve(import.meta.dirname, '../..');

test('uv editable installation exposes local source edits and owns the distribution record (K657-3)', { timeout: 120_000 }, (t) => {
  const directory = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-uv-editable-real-')));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const app = path.join(directory, 'app');
  const source = path.join(directory, 'source');
  mkdirSync(app);
  mkdirSync(path.join(source, 'src/native_editable'), { recursive: true });
  const manifest = '[project]\nname = "app"\nversion = "0.0.0"\n';
  const lock = 'version = 1\n';
  writeFileSync(path.join(app, 'pyproject.toml'), manifest);
  writeFileSync(path.join(app, 'uv.lock'), lock);
  writeFileSync(path.join(source, 'pyproject.toml'), '[build-system]\nrequires = ["setuptools==84.0.0"]\nbuild-backend = "setuptools.build_meta"\n\n[project]\nname = "kit-native-editable"\nversion = "0.0.1"\n');
  const module = path.join(source, 'src/native_editable/__init__.py');
  writeFileSync(module, 'value = 1\n');
  const uv = toolCommand(ROOT, 'uv');
  const python = toolCommand(ROOT, 'python3');
  const env = toolsEnvironment(ROOT, { ...process.env, UV_PROJECT_ENVIRONMENT: '.venv', UV_OFFLINE: '1', UV_NO_INDEX: '1', UV_FIND_LINKS: toolsPath(ROOT, 'wheels'), UV_CACHE_DIR: path.join(directory, 'cache'), PYTHONDONTWRITEBYTECODE: '1' });
  const command = (args: string[]) => {
    const result = spawnSync(uv, args, { cwd: app, env, encoding: 'utf8' });
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  };
  command(['venv', '--python', python, '.venv']);
  const interpreter = path.join(app, '.venv/bin/python');
  command(['pip', 'install', '--python', interpreter, source]);
  writeFileSync(module, 'value = 2\n');
  const selected = uvEditable({ directory: app, providers: [{ ecosystem: 'python', name: 'kit-native-editable', folder: source, repository: source, checkout: source }], uv, env });
  assert.deepEqual(selected, ['kit-native-editable']);
  const value = () => {
    const result = spawnSync(interpreter, ['-c', 'import native_editable; print(native_editable.value)'], { cwd: app, env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  assert.equal(value(), '2');
  writeFileSync(module, 'value = 3\n');
  assert.equal(value(), '3', 'an editable distribution reads the changed source without another install');
  const record = spawnSync(interpreter, ['-c', 'from importlib.metadata import distribution; print(distribution("kit-native-editable").read_text("direct_url.json"))'], { cwd: app, env, encoding: 'utf8' });
  assert.equal(record.status, 0, record.stderr);
  const metadata: unknown = JSON.parse(record.stdout);
  assert.deepEqual(metadata, { dir_info: { editable: true }, url: pathToFileURL(source).href });
  assert.equal(readFileSync(path.join(app, 'pyproject.toml'), 'utf8'), manifest);
  assert.equal(readFileSync(path.join(app, 'uv.lock'), 'utf8'), lock);
});
