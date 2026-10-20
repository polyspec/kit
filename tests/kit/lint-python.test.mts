// Tests of the Python lint: it runs ruff check and ruff format --check on the checkout with the root ruff.toml and the var
// directory excluded, then vulture on the Python files of each package, from the package folder and with the confidence of
// kit; every step runs after a failure of an earlier one, and a missing tool or ruff.toml fails with the fix. ruff and vulture
// are stubs as the shims of mise.
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { lint, lintSteps } from '../../scripts/kit/lint-python.mts';
import { initRepository } from './sandbox-repository.mts';
import { tree } from './tree.mts';

const FILES: Record<string, string> = {
  'ruff.toml': '[lint]\nselect = ["F"]\n',
  'packages/python/pyproject.toml': '[project]\nname = "demo"\n',
  'packages/python/src/demo/__init__.py': '',
  'packages/python/tests/test_demo.py': '',
  'packages/python/vulture_whitelist.py': '',
  'packages/docs/pyproject.toml': '[project]\nname = "docs"\n',
  'packages/docs/README.md': '# docs\n',
};

function checkout(t: TestContext, { installed = ['ruff', 'vulture'], failing = '', omit = '' }: { installed?: string[]; failing?: string; omit?: string } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'kit-lint-python-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [file, text] of Object.entries(FILES)) {
    if (file === omit) continue;
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  }
  writeFileSync(path.join(root, '.gitignore'), 'var/\n*.log\n');
  const log = path.join(root, 'calls.log');
  mkdirSync(path.join(root, 'var/tools/mise/shims'), { recursive: true });
  for (const tool of installed) {
    writeFileSync(path.join(root, 'var/tools/mise/shims', tool), `#!/bin/sh
echo "${tool} $* [$(basename "$PWD")]" >> "${log}"
${failing ? `case "${tool} $1" in "${failing}"*) echo "found a problem" >&2; exit 1;; esac` : ''}
`);
    chmodSync(path.join(root, 'var/tools/mise/shims', tool), 0o755);
  }
  initRepository(root);
  return { root, calls: () => readFileSync(log, 'utf8').split('\n').filter(Boolean) };
}

const ALL = [
  'ruff check --config ruff.toml --extend-exclude var . [kit-lint-python-',
  'ruff format --check --config ruff.toml --extend-exclude var . [kit-lint-python-',
  'vulture --min-confidence 60 src/demo/__init__.py tests/test_demo.py vulture_whitelist.py [python]',
];
const shape = (calls: string[]) => calls.map(call => call.replace(/\[kit-lint-python-[^\]]*\]$/, '[kit-lint-python-'));

test('ruff runs on the checkout with ruff.toml, and vulture on the Python files of each package from its folder', (t) => {
  const { root, calls } = checkout(t);
  assert.deepEqual(lint(root, () => {}), []);
  assert.deepEqual(shape(calls()), ALL, 'a package without a Python file has no vulture step');
});

test('every step runs after an earlier one failed, and each failure is named', (t) => {
  const { root, calls } = checkout(t, { failing: 'ruff check' });
  assert.deepEqual(lint(root, () => {}), ['ruff check .']);
  assert.deepEqual(shape(calls()), ALL);
  const vulture = checkout(t, { failing: 'vulture --min-confidence' });
  assert.deepEqual(lint(vulture.root, () => {}), ['vulture packages/python']);
});

test('a missing tool and a missing ruff.toml fail with their fix', (t) => {
  assert.throws(() => lintSteps(checkout(t, { installed: ['vulture'] }).root), /var\/tools\/mise\/shims\/ruff is missing; declare ruff and pypi:vulture in mise\.toml and run make install-tools/);
  assert.throws(() => lintSteps(checkout(t, { installed: ['ruff'] }).root), /var\/tools\/mise\/shims\/vulture is missing; declare ruff and pypi:vulture in mise\.toml and run make install-tools/);
  assert.throws(() => lintSteps(checkout(t, { omit: 'ruff.toml' }).root), /ruff\.toml is missing; it is the ruff configuration that kit copies into every repository \(make kit-sync\)/);
});

test('a repository without Python sources lints nothing, with no tool and no configuration installed (K319)', (t) => {
  assert.deepEqual(lintSteps(tree(t, { 'docs/a.md': '# a\n' })), []);
});
