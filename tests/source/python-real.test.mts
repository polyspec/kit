// The real Python of this checkout: the python3 of mise.toml (its shim var/tools/mise/shims/python3), which `make install-tools`
// installs with mise at the python-build-standalone build of mise.lock, and the uv of mise.toml, whose build installs the
// build-system.requires of the fixture's pyproject.toml. The fixture wheel is built with that Python, installed into a clean virtual environment with --no-index
// --require-hashes --no-deps, and its smoke import runs. Nothing here is stubbed; a missing install fails the case.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { declaredMiseTools } from '../../scripts/kit/toolchain-mise.mts';
import { buildWheel, wheelName } from '../../scripts/kit/release-wheel.mts';
import { toolsEnvironment } from '../kit/tools-environment.mts';
import { tree } from '../kit/tree.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FIXTURE = 'tests/kit/fixture/packages/fixture-python';

test('mise.toml declares the Python of the kit', () => {
  assert.deepEqual(declaredMiseTools(ROOT).python, { version: '3.14.8', source: 'mise.toml tools.python' });
});

test('the fixture wheel is built with the real Python and uv build', { timeout: 900000 }, (t) => {
  const python = path.join(ROOT, 'var/tools/mise/shims/python3');
  assert.ok(existsSync(python), `${path.relative(ROOT, python)} is missing; make install-tools installs the python of mise.toml`);
  const commit = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
  assert.match(commit, /^[0-9a-f]{40}$/);
  const folder = mkdtempSync(path.join(tmpdir(), 'kit-python-real-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const env = { ...process.env, PIP_CACHE_DIR: path.join(folder, 'pip-cache') };
  const output = path.join(folder, 'wheels');
  mkdirSync(output);
  buildWheel({ root: ROOT, env, commit, directory: FIXTURE, output, generated: [] });
  assert.deepEqual(readdirSync(output), [wheelName('kit-fixture', '0.0.0')]);
});

// K1215: a package whose tests import by the package path from the repository root (`lib.py.tests.support`) and whose harness
// module selects them with load_tests. The discovery of unittest in the root of the package cannot import that path, so the
// tests are reachable only through the module, which runtime-targets passes to the python runner for that root.
test('K1215: runtime-targets runs the harness module of a python root, whose tests import by the package path from the repository root', (t) => {
  const shim = path.join(ROOT, 'var/tools/mise/shims/python3');
  assert.ok(existsSync(shim), `${path.relative(ROOT, shim)} is missing; make install-tools installs the python of mise.toml`);
  const located = spawnSync(shim, ['-c', 'import sys; print(sys.executable)'], { cwd: ROOT, env: toolsEnvironment(ROOT), encoding: 'utf8' });
  assert.equal(located.status, 0, `${located.error?.message ?? ''}\n${located.stdout}\n${located.stderr}`);
  const python = located.stdout.trim();
  const root = tree(t, {
    // The python3 of the checkout of the fixture starts the interpreter of this checkout.
    'var/tools/mise/shims/python3': `#!/bin/sh\nexec '${python}' "$@"\n`,
    'lib/__init__.py': '',
    'lib/py/__init__.py': '',
    'lib/py/tests/__init__.py': '',
    'lib/py/tests/support.py': 'VALUE = 2\n',
    'lib/py/tests/test_value.py': [
      'import unittest',
      'from lib.py.tests.support import VALUE',
      '',
      'class ValueTest(unittest.TestCase):',
      '    def test_value(self):',
      '        self.assertEqual(VALUE, 2)',
      '',
      '    def test_double(self):',
      '        self.assertEqual(VALUE * 2, 4)',
      '',
    ].join('\n'),
    'lib/py/tests/harness.py': [
      'import unittest',
      'from lib.py.tests import test_value',
      '',
      'def load_tests(loader, standard_tests, pattern):',
      '    return loader.loadTestsFromModule(test_value)',
      '',
      'if __name__ == "__main__":',
      '    unittest.main()',
      '',
    ].join('\n'),
  });
  chmodSync(path.join(root, 'var/tools/mise/shims/python3'), 0o755);
  const cli = path.join(ROOT, 'scripts/kit/runtime-targets.mts');
  const { NODE_TEST_CONTEXT: _joined, CASES: _cases, ...outside } = process.env;
  const run = (...args: string[]) => spawnSync(process.execPath, [cli, 'test', '--runner', 'python', '--roots', 'lib/py', ...args], { cwd: root, env: outside, encoding: 'utf8' });
  const discovery = run();
  assert.equal(discovery.status, 1, `${discovery.stdout}\n${discovery.stderr}`);
  assert.match(discovery.stdout, /No module named 'lib'/, discovery.stdout);
  assert.match(discovery.stdout, /✖ python lib\/py: 0 passed, 1 failed, 0 skipped/, discovery.stdout);
  const module = run('--module', 'lib/py=lib.py.tests.harness');
  assert.equal(module.status, 0, `${module.stdout}\n${module.stderr}`);
  assert.match(module.stdout, /✔ test_value \(lib\.py\.tests\.test_value\.ValueTest\.test_value\)/, module.stdout);
  assert.match(module.stdout, /✔ python \.: 2 passed, 0 failed, 0 skipped/, module.stdout);
  const selected = run('--module', 'lib/py=lib.py.tests.harness', '--', '-k', 'test_double');
  assert.equal(selected.status, 0, `${selected.stdout}\n${selected.stderr}`);
  assert.match(selected.stdout, /✔ python \. -k test_double: 1 passed, 0 failed, 0 skipped/, selected.stdout);
});
