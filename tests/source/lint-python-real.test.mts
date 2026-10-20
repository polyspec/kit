// The real Python lint: lint-python.mts runs the ruff and the vulture of mise.toml on a
// repository that holds the ruff.toml of this checkout. A repository that follows S3 passes; each violation planted into a copy
// of it fails with the rule or the finding that names it, including the false greens of the plan's verification. Nothing is
// stubbed.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { lint } from '../../scripts/kit/lint-python.mts';
import { installedBinary, sandboxShims } from './real-tools.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TOOLS = ['ruff', 'vulture'];

// A Python package whose code is used by its test, run against the installed package.
const GOOD: Record<string, string> = {
  '.gitignore': 'var/\n',
  'config/toolchain.json': JSON.stringify({ schema: 1, ruff: { version: '0.17.0', sha256: { 'linux-x64': 'f'.repeat(64) } }, vulture: { version: '2.16', sha256: 'f'.repeat(64) } }),
  'packages/python/pyproject.toml': '[project]\nname = "polyspec-demo"\nversion = "0.0.1"\n',
  'packages/python/src/polyspec/demo/__init__.py': 'def double(value: int) -> int:\n    return value * 2\n',
  'packages/python/tests/test_demo.py': 'import unittest\n\nfrom polyspec.demo import double\n\n\nclass TestDouble(unittest.TestCase):\n    def test_double(self) -> None:\n        self.assertEqual(double(2), 4)\n',
};

const TEST = 'packages/python/tests/test_demo.py';
const INIT = 'packages/python/src/polyspec/demo/__init__.py';
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
  // No swallowed error (K256): a blind except and an except that only passes.
  { name: 'a blind except that passes', files: { 'packages/python/src/polyspec/demo/__init__.py': `${GOOD['packages/python/src/polyspec/demo/__init__.py']}\n\ndef safe() -> int:\n    try:\n        return double(1)\n    except Exception:\n        pass\n    return 0\n` }, finding: /BLE001[\s\S]*S110|S110[\s\S]*BLE001/ },
  // P8 (K334): an error is never hidden. A typed except that only passes, an except that only re-raises, a re-raise that drops
  // the traceback, an error logged without it, a jump out of finally, a blanket type: ignore and noqa, and a noqa that suppresses nothing.
  { name: 'a typed except that only passes', files: { [INIT]: doubleBody('    try:\n        value.bit_length()\n    except AttributeError:\n        pass\n    return value * 2\n') }, finding: /SIM105[\s\S]*S110|S110[\s\S]*SIM105/ },
  { name: 'an except that only re-raises', files: { [INIT]: doubleBody('    try:\n        return value * 2\n    except ValueError:\n        raise\n') }, finding: /TRY203/ },
  { name: 'a raise of the caught exception', files: { [INIT]: doubleBody('    try:\n        return value * 2\n    except ValueError as error:\n        raise error\n') }, finding: /TRY201/ },
  { name: 'an error logged without its traceback', files: { [INIT]: `import logging\n\n\n${doubleBody('    try:\n        return value * 2\n    except ValueError:\n        logging.error("failed")\n        raise\n')}` }, finding: /TRY400/ },
  { name: 'a return in finally', files: { [INIT]: doubleBody('    try:\n        return value * 2\n    finally:\n        return 0\n') }, finding: /B012/ },
  { name: 'a blanket type: ignore', files: { [INIT]: doubleBody('    return value * 2  # type: ignore\n') }, finding: /PGH003/ },
  { name: 'a blanket noqa', files: { [INIT]: `import os  # noqa\n\n\n${GOOD[INIT]}` }, finding: /PGH004/ },
  { name: 'a noqa that suppresses nothing', files: { [INIT]: doubleBody('    return value * 2  # noqa: F401 - nothing to suppress\n') }, finding: /RUF100/ },
];

// The variants that state their need pass (P8): a blind except that names why it is blind, and a re-raise that logs the traceback.
const STATED: { name: string; files: Record<string, string> }[] = [
  { name: 'a blind except with its reason', files: { [INIT]: doubleBody('    try:\n        return value * 2\n    except Exception as error:  # noqa: BLE001 - every error of the multiplication is the failure of this call\n        return len(str(error))\n') } },
  { name: 'a re-raise that keeps the traceback and logs it', files: { [INIT]: `import logging\n\n\n${doubleBody('    try:\n        return value * 2\n    except ValueError:\n        logging.exception("failed")\n        raise\n')}` } },
];

/** The module `polyspec.demo` whose function double has the body `body`. */
function doubleBody(body: string): string {
  return `def double(value: int) -> int:\n${body}`;
}

/** Writes `files` below `root`. */
function write(root: string, files: Record<string, string>) {
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  }
}

/** A repository in a temporary folder: GOOD with `files` over it, the ruff.toml of this checkout and the shims of its tools. */
function repository(t: TestContext, files: Record<string, string> = {}): string {
  const root = mkdtempSync(path.join(tmpdir(), 'kit-lint-python-real-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  write(root, { ...GOOD, ...files });
  copyFileSync(path.join(ROOT, 'ruff.toml'), path.join(root, 'ruff.toml'));
  sandboxShims(root, TOOLS);
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
  for (const tool of TOOLS) assert.ok(existsSync(installedBinary(tool)), `the ${tool} of mise.toml is missing; make install-tools installs it`);
  const root = repository(t);
  const { failed, output } = lintOf(root);
  assert.deepEqual(failed, [], output);
  // ruff keeps its cache in var/ruff (cache-dir of ruff.toml), not in .ruff_cache at the root, which layout S5 refuses (K147).
  assert.ok(!existsSync(path.join(root, '.ruff_cache')), 'ruff wrote .ruff_cache at the root');
  assert.ok(existsSync(path.join(root, 'var/ruff')), 'ruff wrote no cache in var/ruff');
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

test('a variant that states its need passes the Python lint', (t) => {
  for (const { name, files } of STATED) {
    const { failed, output } = lintOf(repository(t, files));
    assert.deepEqual(failed, [], `${name}: ${output}`);
  }
});
