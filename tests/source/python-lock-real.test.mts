// The Python lock with the real uv of this checkout (var/tools/bin/uv, `make install-tools TOOLS=uv`), fully offline. The
// direct requirements are the [project].dependencies of a pyproject.toml; the wheels are local: the pinned setuptools wheel of
// var/tools/wheels and a pure-Python wheel built here with the pinned Python from a source tree, both in a directory of the
// test under var/. The writer locks them with findLinks, the offline check passes, and a version drift or an unpinned
// transitive package fails by name. The lock holds no machine path. Everything the test writes is removed after it.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { readPylock } from '../../scripts/kit/pylock.mts';
import { checkPythonLock, writePythonLock } from '../../scripts/kit/python-lock.mts';
import { toolsPath } from '../../scripts/kit/bootstrap/tool-wrappers.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DIR = `var/python-lock-real-${process.pid}`;
const ENTRY = {
  lock: `${DIR}/pylock.toml`,
  source: { requirements: `${DIR}/app/pyproject.toml`, constraints: `${DIR}/app/constraints.txt`, findLinks: `${DIR}/links` },
};
const PYPROJECT = '[project]\nname = "app"\nversion = "0.0.0"\ndependencies = [\n  "tinylib==0.0.1",\n]\n';
// tinylib depends on setuptools, so setuptools is a transitive package that the constraints must pin too.
const CONSTRAINTS = 'tinylib==0.0.1\nsetuptools==84.0.0\n';
const TINYLIB_PYPROJECT = '[build-system]\nrequires = ["setuptools==84.0.0"]\nbuild-backend = "setuptools.build_meta"\n\n[project]\nname = "tinylib"\nversion = "0.0.1"\nrequires-python = ">=3.10"\ndependencies = [\n  "setuptools==84.0.0",\n]\n';
const write = () => writePythonLock({ root: ROOT, entry: ENTRY, env: process.env, print: () => {} });
const abs = (file: string) => path.join(ROOT, file);
const lockPath = abs(ENTRY.lock);

/** The sources of the test: the pyproject, the constraints, and the wheels of the find-links directory. */
function setup(t: TestContext) {
  const dir = abs(DIR);
  rmSync(dir, { recursive: true, force: true });
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  mkdirSync(abs(`${DIR}/app`), { recursive: true });
  mkdirSync(abs(`${DIR}/links`), { recursive: true });
  mkdirSync(abs(`${DIR}/tmp`), { recursive: true });
  mkdirSync(abs(`${DIR}/tinylib/tinylib`), { recursive: true });
  writeFileSync(abs(`${DIR}/app/pyproject.toml`), PYPROJECT);
  writeFileSync(abs(`${DIR}/app/constraints.txt`), CONSTRAINTS);
  writeFileSync(abs(`${DIR}/tinylib/pyproject.toml`), TINYLIB_PYPROJECT);
  writeFileSync(abs(`${DIR}/tinylib/tinylib/__init__.py`), '__version__ = "0.0.1"\n');
  copyFileSync(abs('var/tools/wheels/setuptools-84.0.0-py3-none-any.whl'), abs(`${DIR}/links/setuptools-84.0.0-py3-none-any.whl`));
  // The pinned Python builds the wheel with its build environment under var/, and no pip cache outside var/.
  const built = spawnSync(toolsPath(ROOT, 'bin', 'python3'), ['-m', 'pip', 'wheel', '--no-deps', '--no-index', '--no-cache-dir', '--disable-pip-version-check', '--find-links', toolsPath(ROOT, 'wheels'), '-w', abs(`${DIR}/links`), abs(`${DIR}/tinylib`)], {
    cwd: abs(DIR), encoding: 'utf8', env: { ...process.env, TMPDIR: abs(`${DIR}/tmp`) },
  });
  assert.equal(built.status, 0, built.stderr);
  assert.ok(readdirSync(abs(`${DIR}/links`)).includes('tinylib-0.0.1-py3-none-any.whl'));
}

test('uv writes a lock from the pyproject with find-links, no machine path is kept, and the offline check passes on it', (t) => {
  setup(t);
  assert.match(readFileSync(toolsPath(ROOT, 'bin', 'uv'), 'utf8'), /^#!\/bin\/sh\n/, 'var/tools/bin/uv is the wrapper of the pinned uv');
  assert.deepEqual(write(), { file: ENTRY.lock });
  const text = readFileSync(lockPath, 'utf8');
  assert.match(text, /^lock-version = "1\.0"$/m);
  assert.match(text, /^created-by = "uv"$/m);
  assert.ok(text.includes('path = "links/tinylib-0.0.1-py3-none-any.whl"'), 'a local wheel is a path relative to the lock');
  assert.ok(!text.includes('file:') && !text.includes(ROOT), 'the lock holds no machine path');
  assert.deepEqual(readPylock(text, ENTRY.lock).packages.map((item: { name: string; version: string }) => `${item.name}==${item.version}`).sort(), ['setuptools==84.0.0', 'tinylib==0.0.1']);
  assert.deepEqual(checkPythonLock({ root: ROOT, entry: ENTRY }), []);
});

test('a version drift of a locked package fails the offline check, and the finding names the package', (t) => {
  setup(t);
  write();
  const text = readFileSync(lockPath, 'utf8');
  writeFileSync(lockPath, text.replace('version = "0.0.1"', 'version = "0.0.2"'));
  const findings = checkPythonLock({ root: ROOT, entry: ENTRY });
  assert.ok(findings.some(line => line.startsWith(`${ENTRY.lock}: tinylib 0.0.2 is locked, ${ENTRY.source.constraints} pins tinylib 0.0.1`)), findings.join('\n'));
});

test('an unpinned transitive package fails the offline check, and the finding names it', (t) => {
  setup(t);
  write();
  writeFileSync(abs(ENTRY.source.constraints), 'tinylib==0.0.1\n');
  const findings = checkPythonLock({ root: ROOT, entry: ENTRY });
  assert.ok(findings.some(line => line.startsWith(`${ENTRY.lock}: setuptools 84.0.0 is in the lock and has no pin in ${ENTRY.source.constraints}`)), findings.join('\n'));
});
