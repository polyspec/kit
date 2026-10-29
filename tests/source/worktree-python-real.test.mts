// Native uv creates an independent Python worktree environment and installs editable inputs for that worktree's own sources.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { prepareWorktreePython } from '../../scripts/kit/worktree-setup.mts';
import { toolCommand, toolsEnvironment } from '../../scripts/kit/mise-tools.mts';
import { toolsPath } from '../../scripts/kit/bootstrap/tool-wrappers.mts';

const ROOT = path.resolve(import.meta.dirname, '../..');

test('native uv Python worktree environments read worktree source and own their installed metadata (K657-4)', { timeout: 120_000 }, (t) => {
  const directory = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-worktree-python-real-')));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const main = path.join(directory, 'main');
  const folder = path.join(directory, 'worktree');
  for (const [checkout, value] of [[main, 1], [folder, 2]] as const) {
    const project = path.join(checkout, 'packages/demo');
    mkdirSync(path.join(project, 'src/worktree_demo'), { recursive: true });
    writeFileSync(path.join(project, 'pyproject.toml'), '[build-system]\nrequires = ["setuptools==84.0.0"]\nbuild-backend = "setuptools.build_meta"\n\n[project]\nname = "kit-worktree-demo"\nversion = "0.0.1"\n');
    writeFileSync(path.join(project, 'src/worktree_demo/__init__.py'), `value = ${value}\n`);
  }
  const uv = toolCommand(ROOT, 'uv');
  const env = toolsEnvironment(ROOT, { ...process.env, UV_CACHE_DIR: toolsPath(ROOT, 'mise', 'cache', 'uv'), PYTHONDONTWRITEBYTECODE: '1' });
  const invoke = (args: string[]) => {
    const result = spawnSync(uv, args, { cwd: main, env, encoding: 'utf8' });
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  };
  const pyproject = '[project]\nname = "worktree-app"\nversion = "0.0.1"\ndependencies = ["kit-worktree-demo"]\n\n[tool.uv.sources]\nkit-worktree-demo = { workspace = true }\n\n[tool.uv.workspace]\nmembers = ["packages/demo"]\n';
  writeFileSync(path.join(main, 'pyproject.toml'), pyproject);
  writeFileSync(path.join(folder, 'pyproject.toml'), pyproject);
  invoke(['lock']);
  writeFileSync(path.join(folder, 'uv.lock'), readFileSync(path.join(main, 'uv.lock')));
  invoke(['venv', '--python', toolCommand(ROOT, 'python3'), '.venv']);
  invoke(['pip', 'install', '--python', path.join(main, '.venv/bin/python'), '--editable', path.join(main, 'packages/demo')]);
  const sourceConfig = readFileSync(path.join(main, '.venv/pyvenv.cfg'), 'utf8');
  prepareWorktreePython({ main, folder, venv: '.venv', uv, env, print: () => {} });
  const python = path.join(folder, '.venv/bin/python');
  const value = () => {
    const result = spawnSync(python, ['-c', 'import worktree_demo; print(worktree_demo.value)'], { cwd: folder, env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  assert.equal(value(), '2');
  writeFileSync(path.join(folder, 'packages/demo/src/worktree_demo/__init__.py'), 'value = 3\n');
  assert.equal(value(), '3', 'local edits are visible without reinstalling');
  prepareWorktreePython({ main, folder, venv: '.venv', uv, env, print: () => {} });
  assert.equal(value(), '3');
  assert.equal(readFileSync(path.join(main, '.venv/pyvenv.cfg'), 'utf8'), sourceConfig);
  assert.equal(lstatSync(path.join(folder, '.venv/pyvenv.cfg')).isSymbolicLink(), false);
  assert.equal(readFileSync(path.join(folder, 'uv.lock'), 'utf8'), readFileSync(path.join(main, 'uv.lock'), 'utf8'));
  const record = spawnSync(python, ['-c', 'from importlib.metadata import distribution; print(distribution("kit-worktree-demo").read_text("direct_url.json"))'], { cwd: folder, env, encoding: 'utf8' });
  assert.equal(record.status, 0, record.stderr);
  assert.deepEqual(JSON.parse(record.stdout), { dir_info: { editable: true }, url: pathToFileURL(path.join(folder, 'packages/demo')).href });
});
