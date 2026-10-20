// Tests of scripts/kit/python-venv.mts: the rule of run-tests --venv (venvProblem) accepts an environment whose home is a
// Python that mise installed for the checkout (under var/tools/mise), with the symbolic links of the tool that made it, and
// refuses any other; makeVenv names the missing uv or Python, and refuses an existing directory that is not a venv of the
// checkout Python without changing it. The trees are fixtures in a temporary directory; no Python or uv runs.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, readdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { makeVenv, venvProblem } from '../../scripts/kit/python-venv.mts';
import { tree } from './tree.mts';
import { initRepository } from './sandbox-repository.mts';
import { known } from './known.mts';

// A venv tree as `uv venv` writes it: bin/python links to the interpreter of var/tools/mise/installs, bin/python3 links to python,
// and pyvenv.cfg names the interpreter's directory as its home (`home` overrides it).
function venvTree(t: TestContext, { home }: { home?: string } = {}) {
  const root = tree(t);
  const interpreter = path.join(root, 'var/tools/mise/installs/python/3.14.8/bin');
  mkdirSync(interpreter, { recursive: true });
  writeFileSync(path.join(interpreter, 'python3.14'), '#!/bin/sh\n');
  const venv = path.join(root, 'pkg/.venv');
  mkdirSync(path.join(venv, 'bin'), { recursive: true });
  symlinkSync(path.join(interpreter, 'python3.14'), path.join(venv, 'bin/python'));
  symlinkSync('python', path.join(venv, 'bin/python3'));
  writeFileSync(path.join(venv, 'pyvenv.cfg'), `home = ${home ?? interpreter}\nversion_info = 3.14.8\n`);
  return { root, venv };
}

test('a venv from the Python of mise in var/tools/mise is accepted with its links, which are kept', (t) => {
  const { root, venv } = venvTree(t);
  assert.equal(venvProblem(venv, root), undefined);
  assert.equal(readlinkSync(path.join(venv, 'bin/python3')), 'python', 'the link is kept as uv made it');
});

// K387-1: a worktree runs the Python that the main checkout installed (K387), so its venv names that Python as its home.
test('a venv of a worktree from the Python of the shared installs of the main checkout is accepted (K387-1)', (t) => {
  const { root: main } = venvTree(t);
  initRepository(main, '--initial-branch=main');
  spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--quiet', '--allow-empty', '-m', 'base'], { cwd: main });
  const worktree = `${main}-row`;
  t.after(() => rmSync(worktree, { recursive: true, force: true }));
  assert.equal(spawnSync('git', ['worktree', 'add', '--quiet', '-b', 'fix/row-K1', worktree], { cwd: main }).status, 0);
  const venv = path.join(worktree, 'pkg/.venv');
  mkdirSync(venv, { recursive: true });
  writeFileSync(path.join(venv, 'pyvenv.cfg'), `home = ${path.join(main, 'var/tools/mise/installs/python/3.14.8/bin')}\nversion_info = 3.14.8\n`);
  assert.equal(venvProblem(venv, worktree), undefined);
  writeFileSync(path.join(venv, 'pyvenv.cfg'), 'home = /usr/bin\nversion_info = 3.14.8\n');
  assert.match(venvProblem(venv, worktree) ?? '', /was made from \/usr\/bin, not from a Python of this checkout/);
});

test('a directory without pyvenv.cfg or a venv of another Python is refused with the fix', (t) => {
  const root = tree(t);
  mkdirSync(path.join(root, 'pkg/.venv'), { recursive: true });
  // Each venv below is refused, so venvProblem returns its problem.
  assert.match(known(venvProblem(path.join(root, 'pkg/.venv'), root), 'venvProblem(path.join(root, …), root)'), /^pkg\/\.venv is not a virtual environment \(no pyvenv\.cfg\); make it from the checkout Python, with make python-venv DIR=pkg\/\.venv or var\/tools\/mise\/shims\/uv venv --python var\/tools\/mise\/shims\/python3 pkg\/\.venv$/);
  const other = venvTree(t, { home: '/usr/bin' });
  assert.match(known(venvProblem(other.venv, other.root), 'venvProblem(other.venv, other.root)'), /^pkg\/\.venv was made from \/usr\/bin, not from a Python of this checkout \(var\/tools\/mise\); make it/);  // refused, as above.
});

test('makeVenv names the missing uv or Python and the install that provides it', (t) => {
  const root = tree(t);
  const directory = path.join(root, 'pkg/.venv');
  assert.throws(() => makeVenv({ root, directory }), /var\/tools\/mise\/shims\/uv is missing; declare uv in mise\.toml and run make install-tools/);
  mkdirSync(path.join(root, 'var/tools/mise/shims'), { recursive: true });
  writeFileSync(path.join(root, 'var/tools/mise/shims/uv'), '#!/bin/sh\nexit 1\n');
  chmodSync(path.join(root, 'var/tools/mise/shims/uv'), 0o755);
  assert.throws(() => makeVenv({ root, directory }), /var\/tools\/mise\/shims\/python3 is missing; declare python in mise\.toml and run make install-tools/);
});

test('makeVenv refuses an existing directory that is not a venv of the checkout Python, and changes nothing', (t) => {
  const root = tree(t);
  mkdirSync(path.join(root, 'var/tools/mise/shims'), { recursive: true });
  for (const name of ['uv', 'python3']) {
    writeFileSync(path.join(root, 'var/tools/mise/shims', name), '#!/bin/sh\nexit 1\n');
    chmodSync(path.join(root, 'var/tools/mise/shims', name), 0o755);
  }
  const directory = path.join(root, 'pkg/.venv');
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, 'keep.txt'), 'x');
  assert.throws(() => makeVenv({ root, directory }), /pkg\/\.venv exists and is not a venv of the checkout Python: .*no pyvenv\.cfg.*; it is neither removed nor repaired/);
  assert.deepEqual(readdirSync(directory), ['keep.txt']);
});
