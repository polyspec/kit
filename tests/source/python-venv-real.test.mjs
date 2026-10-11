// The real venv of this checkout: make python-venv (scripts/kit/python-venv.mjs) makes a virtual environment from
// var/tools/bin/python3, installed by `make install-tools`, and the environment holds no symbolic link on any platform
// (CPython links lib64 to lib on 64-bit posix other than macOS; the tool removes that link). Nothing is stubbed.
import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { makeVenv, venvProblem } from '../../scripts/kit/python-venv.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

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
  makeVenv({ root: ROOT, directory, print: text => steps.push(text) });
  assert.equal(venvProblem(directory, ROOT), undefined, 'run-tests accepts the environment');
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
  makeVenv({ root: ROOT, directory });
  const config = readFileSync(path.join(directory, 'pyvenv.cfg'), 'utf8');
  const steps = [];
  makeVenv({ root: ROOT, directory, print: text => steps.push(text) });
  assert.ok(steps.some(step => step.includes('unchanged')), steps.join('\n'));
  assert.equal(readFileSync(path.join(directory, 'pyvenv.cfg'), 'utf8'), config, 'the second run rewrote the venv');
  const other = path.join(folder, 'other');
  mkdirSync(other);
  writeFileSync(path.join(other, 'keep.txt'), 'x');
  assert.throws(() => makeVenv({ root: ROOT, directory: other }), /other exists and is not a venv of the checkout Python: .*no pyvenv\.cfg/);
  assert.ok(existsSync(path.join(other, 'keep.txt')), 'the refused directory was changed');
}, { timeout: 300000 });

// A virtual environment that uv makes from the checkout Python is accepted as uv makes it (K63): uv links bin/python to the
// interpreter and bin/python3 to python, and run-tests --venv keeps those links and runs the tests with the environment's
// interpreter. The uv of config/toolchain.json makes it (var/tools/bin/uv, make install-tools TOOLS=uv). No link is copied,
// removed or rewritten.
test('run-tests --venv accepts and runs a venv that uv made from the checkout Python, with its links as uv made them', (t) => {
  const python = path.join(ROOT, 'var/tools/bin/python3');
  assert.ok(existsSync(python), `${path.relative(ROOT, python)} is missing; make install-tools TOOLS=python installs the Python of pythonBuild`);
  const folder = mkdtempSync(path.join(tmpdir(), 'kit-python-venv-uv-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const directory = path.join(folder, 'venv');
  const uv = path.join(ROOT, 'var/tools/bin/uv');
  assert.ok(existsSync(uv), `${path.relative(ROOT, uv)} is missing; make install-tools TOOLS=uv installs the uv of config/toolchain.json`);
  const made = spawnSync(uv, ['venv', '--python', python, directory], { encoding: 'utf8' });
  assert.equal(made.status, 0, made.stderr);
  const links = linksUnder(directory);
  assert.ok(links.length > 0, 'uv made the environment with its links');
  assert.equal(venvProblem(directory, ROOT), undefined, 'run-tests accepts the environment');
  const tests = path.join(folder, 'tests');
  mkdirSync(tests);
  writeFileSync(path.join(tests, 'test_prefix.py'), [
    'import sys, unittest',
    'class Prefix(unittest.TestCase):',
    `    def test_prefix(self): self.assertEqual(sys.prefix, ${JSON.stringify(directory)})`,
    '',
  ].join('\n'));
  const ran = spawnSync(process.execPath, [path.join(ROOT, 'scripts/kit/run-tests.mjs'), 'python', '--venv', directory, '--cwd', tests, 'discover'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(ran.status, 0, `${ran.stdout}${ran.stderr}`);
  assert.match(ran.stdout, /test_prefix/);
  assert.deepEqual(linksUnder(directory), links, 'the links of uv are kept as uv made them');
}, { timeout: 300000 });
