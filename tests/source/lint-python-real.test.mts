// The real Python lint: lint-python.mts runs the ruff and the vulture of var/tools (make install-tools TOOLS="ruff vulture") on a
// repository that holds the ruff.toml of this checkout. A repository that follows S3 passes; each violation planted into a copy
// of it fails with the rule or the finding that names it, including the false greens of the plan's verification. Nothing is
// stubbed.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { lint } from '../../scripts/kit/lint-python.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TOOLS = ['ruff', 'vulture'].map(name => path.join(ROOT, 'var/tools/bin', name));

// A Python package whose code is used by its test, run against the installed package.
const GOOD: Record<string, string> = {
  '.gitignore': 'var/\n',
  'config/toolchain.json': JSON.stringify({ schema: 1, ruff: { version: '0.17.0', sha256: { 'linux-x64': 'f'.repeat(64) } }, vulture: { version: '2.16', sha256: 'f'.repeat(64) } }),
  'packages/python/pyproject.toml': '[project]\nname = "polyspec-demo"\nversion = "0.0.1"\n',
  'packages/python/src/polyspec/demo/__init__.py': 'def double(value: int) -> int:\n    return value * 2\n',
  'packages/python/tests/test_demo.py': 'import unittest\n\nfrom polyspec.demo import double\n\n\nclass TestDouble(unittest.TestCase):\n    def test_double(self) -> None:\n        self.assertEqual(double(2), 4)\n',
};

const TEST = 'packages/python/tests/test_demo.py';
const withLine = (line: string) => `${line}\n${GOOD[TEST]}`;

// One violation for each rule: the files it adds or replaces, and the text that the failing step prints for it.
const VIOLATIONS: { name: string; files: Record<string, string>; finding: RegExp }[] = [
  { name: 'sys.path.insert', files: { [TEST]: withLine('import sys\n\nsys.path.insert(0, "src")') }, finding: /TID251 `sys\.path` is banned/ },
  { name: 'from sys import path', files: { [TEST]: withLine('from sys import path\n\npath.append("src")') }, finding: /TID251 `sys\.path` is banned/ },
  // The false green of the verification: the module sys reached through importlib has no qualified name for the sys.path ban.
  { name: 'importlib.import_module("sys").path', files: { [TEST]: withLine('import importlib\n\nimportlib.import_module("sys").path.insert(0, "src")') }, finding: /TID251 `importlib\.import_module` is banned/ },
  { name: 'a module loaded from a file path', files: { [TEST]: withLine('import importlib.util\n\nimportlib.util.spec_from_file_location("demo", "src/polyspec/demo/__init__.py")') }, finding: /TID251 `importlib\.util\.spec_from_file_location` is banned/ },
  // A nested [tool.ruff] that selects fewer rules: ruff runs with the root configuration, so the ban still holds.
  { name: 'a nested [tool.ruff] that drops TID251', files: { 'packages/python/pyproject.toml': `${GOOD['packages/python/pyproject.toml']}\n[tool.ruff.lint]\nselect = ["E"]\n`, [TEST]: withLine('import sys\n\nsys.path.insert(0, "src")') }, finding: /TID251 `sys\.path` is banned/ },
  { name: 'an unused function', files: { 'packages/python/src/polyspec/demo/__init__.py': `${GOOD['packages/python/src/polyspec/demo/__init__.py']}\n\ndef triple(value: int) -> int:\n    return value * 3\n` }, finding: /src\/polyspec\/demo\/__init__\.py:\d+: unused function 'triple' \(60% confidence\)/ },
  // A package cannot raise the confidence of vulture: the run names its own.
  { name: 'an unused function under a raised min_confidence', files: { 'packages/python/pyproject.toml': `${GOOD['packages/python/pyproject.toml']}\n[tool.vulture]\nmin_confidence = 100\n`, 'packages/python/src/polyspec/demo/__init__.py': `${GOOD['packages/python/src/polyspec/demo/__init__.py']}\n\ndef triple(value: int) -> int:\n    return value * 3\n` }, finding: /unused function 'triple' \(60% confidence\)/ },
];

/** Writes `files` below `root`. */
function write(root: string, files: Record<string, string>) {
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  }
}

/** A repository in a temporary folder: GOOD with `files` over it, the ruff.toml of this checkout and its tools in var/tools/bin. */
function repository(t: TestContext, files: Record<string, string> = {}): string {
  const root = mkdtempSync(path.join(tmpdir(), 'kit-lint-python-real-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  write(root, { ...GOOD, ...files });
  copyFileSync(path.join(ROOT, 'ruff.toml'), path.join(root, 'ruff.toml'));
  mkdirSync(path.join(root, 'var/tools/bin'), { recursive: true });
  for (const tool of TOOLS) symlinkSync(tool, path.join(root, 'var/tools/bin', path.basename(tool)));
  const init = spawnSync('git', ['init', '--quiet'], { cwd: root, encoding: 'utf8' });
  assert.equal(init.status, 0, init.stderr);
  return root;
}

/** The labels of the failed steps of the lint of `root` and everything the steps printed. */
function lintOf(root: string): { failed: string[]; output: string } {
  let output = '';
  const failed = lint(root, text => { output += text; });
  return { failed, output };
}

test('the Python lint passes on a package that follows S3 and uses its code', (t) => {
  for (const tool of TOOLS) assert.ok(existsSync(tool), `${path.relative(ROOT, tool)} is missing; make install-tools TOOLS="ruff vulture" installs it`);
  const { failed, output } = lintOf(repository(t));
  assert.deepEqual(failed, [], output);
});

test('the Python lint fails on each planted violation with the finding that names it', (t) => {
  for (const { name, files, finding } of VIOLATIONS) {
    const { failed, output } = lintOf(repository(t, files));
    assert.notDeepEqual(failed, [], `${name}: the violation passed:\n${output}`);
    assert.match(output, finding, `${name} is not named:\n${output}`);
  }
});

test('an entry of the vulture whitelist of the package, with its reason, keeps a used-only-by-consumers function', (t) => {
  const root = repository(t, {
    'packages/python/src/polyspec/demo/__init__.py': `${GOOD['packages/python/src/polyspec/demo/__init__.py']}\n\ndef triple(value: int) -> int:\n    return value * 3\n`,
    'packages/python/vulture_whitelist.py': 'triple  # public API: the consumers call it (src/polyspec/demo/__init__.py:5)\n',
  });
  const { failed, output } = lintOf(root);
  assert.deepEqual(failed, [], output);
});
