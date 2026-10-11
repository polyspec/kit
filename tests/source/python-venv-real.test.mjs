// The real venv of this checkout: make python-venv (scripts/kit/python-venv.mjs) makes a virtual environment from
// var/tools/bin/python3, installed by `make install-tools`, and the environment holds no symbolic link on any platform
// (CPython links lib64 to lib on 64-bit posix other than macOS; the tool removes that link). Nothing is stubbed.
import assert from 'node:assert/strict';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { makeVenv, venvProblem } from '../../scripts/kit/python-venv.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// The interpreter and its home that kit's own targets pass (checkoutPython of tool-wrappers.mjs).
const CHECKOUT = { python: path.join(ROOT, 'var/tools/bin/python3'), home: path.join(ROOT, 'var/tools/python-build/python/bin') };

/** The symbolic links under `directory`; a link found here fails the case. */
function linksUnder(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) return [file];
    return entry.isDirectory() ? linksUnder(file) : [];
  });
}

test('make python-venv makes a venv from the checkout Python with no symbolic link, and run-tests accepts it', (t) => {
  const python = path.join(ROOT, 'var/tools/bin/python3');
  assert.ok(existsSync(python), `${path.relative(ROOT, python)} is missing; make install-tools TOOLS=python installs the Python of pythonBuild`);
  const folder = mkdtempSync(path.join(tmpdir(), 'kit-python-venv-real-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const directory = path.join(folder, 'venv');
  const steps = [];
  makeVenv({ root: ROOT, directory, ...CHECKOUT, print: text => steps.push(text) });
  assert.equal(venvProblem(directory, { root: ROOT, home: CHECKOUT.home }), undefined, 'run-tests accepts the environment');
  assert.equal(existsSync(path.join(directory, 'lib64')), false, 'no lib64 link is left on any platform');
  assert.deepEqual(linksUnder(directory), [], 'the environment holds no symbolic link');
  const probe = spawnSync(path.join(directory, 'bin/python'), ['-c', 'import sys, json; print(json.dumps([sys.prefix, sys.path]))'], { encoding: 'utf8' });
  assert.equal(probe.status, 0, probe.stderr);
  const [prefix, paths] = JSON.parse(probe.stdout);
  assert.equal(prefix, directory, 'the interpreter runs with the environment as its prefix');
  assert.ok(!paths.some(entry => entry.includes('lib64')), 'no sys.path entry names lib64');
  assert.ok(lstatSync(path.join(directory, 'pyvenv.cfg')).isFile());
}, { timeout: 300000 });

// The run is idempotent: a second run over a venv it made changes nothing and reports it; an existing directory that is not
// such a venv is an error with its reason, and is neither removed nor repaired.
test('make python-venv run twice leaves the venv unchanged, and refuses an existing directory that is not its venv', (t) => {
  const folder = mkdtempSync(path.join(tmpdir(), 'kit-python-venv-twice-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const directory = path.join(folder, 'venv');
  makeVenv({ root: ROOT, directory, ...CHECKOUT });
  const config = readFileSync(path.join(directory, 'pyvenv.cfg'), 'utf8');
  const steps = [];
  makeVenv({ root: ROOT, directory, ...CHECKOUT, print: text => steps.push(text) });
  assert.ok(steps.some(step => step.includes('unchanged')), steps.join('\n'));
  assert.equal(readFileSync(path.join(directory, 'pyvenv.cfg'), 'utf8'), config, 'the second run rewrote the venv');
  const other = path.join(folder, 'other');
  mkdirSync(other);
  writeFileSync(path.join(other, 'keep.txt'), 'x');
  assert.throws(() => makeVenv({ root: ROOT, directory: other, ...CHECKOUT }), /other exists and is not a venv of the interpreter var\/tools\/bin\/python3: .*no pyvenv\.cfg/);
  assert.ok(existsSync(path.join(other, 'keep.txt')), 'the refused directory was changed');
}, { timeout: 300000 });

// K56: the caller names the interpreter and its home. A copy of the checkout Python at the prefix var/tools/python with the wrapper
// var/tools/bin/python3.14 of another root makes a venv that the home check accepts; the home of another interpreter is refused.
test('makeVenv with an interpreter at another prefix accepts that interpreter and refuses another home', (t) => {
  assert.ok(existsSync(CHECKOUT.python), 'make install-tools TOOLS=python installs the Python of pythonBuild');
  const folder = mkdtempSync(path.join(tmpdir(), 'kit-python-venv-prefix-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const prefix = path.join(folder, 'var/tools/python');
  cpSync(path.join(ROOT, 'var/tools/python-build'), prefix, { recursive: true });
  const python = path.join(folder, 'var/tools/bin/python3.14');
  mkdirSync(path.dirname(python), { recursive: true });
  writeFileSync(python, `#!/bin/sh\nexec '${path.join(prefix, 'python/bin/python3.14')}' "$@"\n`, { mode: 0o755 });
  const home = path.join(prefix, 'python/bin');
  const directory = path.join(folder, 'venv');
  makeVenv({ root: folder, directory, python, home });
  assert.equal(venvProblem(directory, { root: folder, home }), undefined, 'the home check accepts the interpreter of the caller');
  assert.deepEqual(linksUnder(folder), [], 'neither the prefix nor the venv holds a symbolic link');
  assert.match(venvProblem(directory, { root: folder, home: CHECKOUT.home }), /venv was made from .*, not from the interpreter home /);
  const refused = path.join(folder, 'refused');
  assert.throws(() => makeVenv({ root: folder, directory: refused, python, home: CHECKOUT.home }), /refused was made from .*, not from the interpreter home /);
  assert.equal(existsSync(refused), false, 'a refused venv that this run made is removed');
  assert.throws(() => makeVenv({ root: folder, directory: refused, python: CHECKOUT.python, home }), /refused was made from .*, not from the interpreter home /);
}, { timeout: 300000 });
