// The leaks of the Python symbol extractor (K307-1), run by the python3 of mise.toml: a public function, method or class whose
// annotations or bases name a private symbol of the package (a name that starts with one _) is a leak; a public name is not.
// Nothing is stubbed; make install-tools installs the python that this test runs.
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { toolsEnvironment } from '../../scripts/kit/mise-tools.mts';
import { pythonListed } from '../../scripts/kit/parity-symbols.mts';
import { tree } from '../kit/tree.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
/** The output of the extractor on the package `pkg` of the files, as a list of strings. */
function run(t: Parameters<typeof tree>[0], files: Record<string, string>, ...flags: string[]): string[] {
  return runEntry(t, files, 'pkg', ...flags);
}

function runEntry(t: Parameters<typeof tree>[0], files: Record<string, string>, entryName: string, ...flags: string[]): string[] {
  const root = tree(t, files);
  const entry = path.join(root, entryName);
  assert.ok(existsSync(entry));
  const result = pythonListed(ROOT, path.relative(ROOT, entry), toolsEnvironment(ROOT), flags);
  if (!('symbols' in result)) throw new Error(result.error);
  return result.symbols;
}

const SOURCE = `
class _Hidden:
    pass


class _Base:
    pass


class Open:
    pass


class Child(_Base):
    def take(self, value: "_Hidden", other: Open) -> list[_Hidden]:
        return []

    def _own(self, value: _Hidden) -> None:
        pass


def build(value: int | _Hidden) -> Open:
    return Open()


def fine(value: Open, *args: Open, **kwargs: Open) -> Open:
    return value


def _private(value: _Hidden) -> None:
    pass
`;

test('a public signature or base class that names a private symbol is a leak, and a public name is not (K307-1)', (t) => {
  assert.deepEqual(run(t, { 'pkg/__init__.py': SOURCE }, '--leaks'), [
    'pkg.Child names the private _Base',
    'pkg.Child.take names the private _Hidden',
    'pkg.build names the private _Hidden',
  ]);
  assert.deepEqual(run(t, { 'pkg/__init__.py': 'class Open:\n    pass\n\n\ndef fine(value: Open) -> Open:\n    return value\n' }, '--leaks'), []);
});

test('K701 honors setuptools package discovery exclusions when listing public symbols', (t) => {
  const symbols = runEntry(t, {
    'pkg/pyproject.toml': '[build-system]\nrequires = ["setuptools==84.0.0"]\nbuild-backend = "setuptools.build_meta"\n\n[project]\nname = "fixture"\nversion = "0.0.1"\n\n[tool.setuptools]\npackage-dir = {"" = "src"}\n\n[tool.setuptools.packages.find]\nwhere = ["src"]\nnamespaces = true\nexclude = ["pkg.generated", "pkg.generated.*"]\n',
    'pkg/src/pkg/__init__.py': 'class Public:\n    pass\n',
    'pkg/src/pkg/api.py': 'class Api:\n    def call(self):\n        return None\n',
    'pkg/src/pkg/generated/__init__.py': 'class GeneratedModel:\n    pass\n',
    'pkg/src/pkg/generated/models.py': 'class Account:\n    pass\n',
  }, 'pkg/src/pkg');
  assert.deepEqual(symbols, ['pkg.Public', 'pkg.api.Api', 'pkg.api.Api.call']);
});

test('K704 reports Python project discovery failures as extractor errors', (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'kit-python-project-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const entry = path.relative(ROOT, path.join(directory, 'missing.py'));
  const result = pythonListed(ROOT, entry, toolsEnvironment(ROOT));
  assert.ok('error' in result);
  assert.match(result.error, /ENOENT/);
});
