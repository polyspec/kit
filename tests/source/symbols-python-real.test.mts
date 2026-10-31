// The Python symbol extractor on the source package of an entry: the .py files on disk under it (K977), named from
// the import root (the src folder beside the nearest pyproject.toml, else its folder), read by the python3 of mise.toml with no
// environment and no install. The leaks (K307-1): a public function, method or class whose annotations or bases name a private
// symbol of the package (a name that starts with one _) is a leak; a public name is not. Nothing is stubbed; make
// install-tools installs the python3 that this test runs.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { toolsEnvironment } from '../../scripts/kit/mise-tools.mts';
import { pythonListed } from '../../scripts/kit/parity-symbols.mts';
import { tree } from '../kit/tree.mts';
import { sandboxShims } from './real-tools.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// A setuptools project of the distribution fixture whose flat layout holds the package pkg.
const PYPROJECT = '[build-system]\nrequires = ["setuptools==84.0.0"]\nbuild-backend = "setuptools.build_meta"\n\n[project]\nname = "fixture"\nversion = "0.0.1"\n';

/** A git repository of the files with the python3 of this checkout, the checkout that the extractor reads its source package from. */
function checkout(t: Parameters<typeof tree>[0], files: Record<string, string>): string {
  const root = tree(t, files);
  const done = spawnSync('git', ['init', '--quiet'], { cwd: root, encoding: 'utf8' });
  assert.equal(done.status, 0, `git init of ${root} failed: ${done.stderr}`);
  sandboxShims(root, ['python3']);
  return root;
}

/** The output of the extractor on the entry of the checkout `root`, as a list of strings. */
function listedAt(root: string, entry: string, ...flags: string[]): string[] {
  const result = pythonListed(root, entry, toolsEnvironment(ROOT), flags);
  if (!('symbols' in result)) throw new Error(result.error);
  return result.symbols;
}

/** The output of the extractor on the package pkg of the files, in the flat project of PYPROJECT. */
function run(t: Parameters<typeof tree>[0], files: Record<string, string>, ...flags: string[]): string[] {
  const root = checkout(t, { 'project/pyproject.toml': PYPROJECT, ...Object.fromEntries(Object.entries(files).map(([file, text]) => [`project/${file}`, text])) });
  return listedAt(root, 'project/pkg', ...flags);
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

// K977: what is public is what the package ships, read from the disk, so a generated module that Git ignores is public; a folder that
// is no Python identifier, such as a .venv, holds no module that the package imports.
test('K977: a module that git ignores, such as a generated one, is public, and the src folder is the import root', (t) => {
  const root = checkout(t, {
    'pkg/pyproject.toml': '[build-system]\nrequires = ["setuptools==84.0.0"]\nbuild-backend = "setuptools.build_meta"\n\n[project]\nname = "fixture"\nversion = "0.0.1"\n',
    'pkg/.gitignore': '/src/pkg/generated/\n',
    'pkg/src/pkg/__init__.py': 'class Public:\n    pass\n',
    'pkg/src/pkg/api.py': 'class Api:\n    def call(self):\n        return None\n',
    'pkg/src/pkg/generated/__init__.py': 'class GeneratedModel:\n    pass\n',
    'pkg/src/pkg/generated/models.py': 'class Account:\n    pass\n',
    'pkg/src/pkg/.cache/stale.py': 'class Stale:\n    pass\n',
  });
  assert.deepEqual(listedAt(root, 'pkg/src/pkg'), ['pkg.Public', 'pkg.api.Api', 'pkg.api.Api.call', 'pkg.generated.GeneratedModel', 'pkg.generated.models.Account']);
});

test('K704 reports an entry that no pyproject.toml holds', (t) => {
  const root = checkout(t, { 'loose/pkg/__init__.py': 'class Open:\n    pass\n' });
  const result = pythonListed(root, 'loose/pkg', toolsEnvironment(ROOT));
  assert.ok('error' in result);
  assert.match(result.error, /no pyproject\.toml from loose\/pkg up to the checkout/);
});

test('K855 reads every module of the source package, one never installed included, and makes no environment', (t) => {
  const root = checkout(t, { 'project/pyproject.toml': PYPROJECT, 'project/pkg/__init__.py': 'class Open:\n    pass\n' });
  writeFileSync(path.join(root, 'project/pkg/added.py'), 'class Added:\n    pass\n');
  assert.deepEqual(listedAt(root, 'project/pkg'), ['pkg.Open', 'pkg.added.Added']);
  assert.equal(existsSync(path.join(root, 'project/.venv')), false, 'the reader made no environment');
});

test('K855 names the modules from the src folder even when the entry is the project folder, and leaves out its tests', (t) => {
  const root = checkout(t, {
    'python/pyproject.toml': PYPROJECT,
    'python/src/codec/__init__.py': 'class Codec:\n    pass\n',
    'python/tests/test_codec.py': 'class Case:\n    pass\n',
  });
  assert.deepEqual(listedAt(root, 'python'), ['codec.Codec']);
});

test('K855 refuses a symlinked module, which it never follows, and an entry without source', (t) => {
  const root = checkout(t, { 'project/pyproject.toml': PYPROJECT, 'project/pkg/__init__.py': 'class Open:\n    pass\n', 'project/empty/README.md': 'none\n' });
  const empty = pythonListed(root, 'project/empty', toolsEnvironment(ROOT));
  assert.ok('error' in empty);
  assert.match(empty.error, /project\/empty holds no \.py file under the import root project/);
  if (process.platform === 'win32') return;
  symlinkSync('__init__.py', path.join(root, 'project/pkg/linked.py'));
  const linked = pythonListed(root, 'project/pkg', toolsEnvironment(ROOT));
  assert.ok('error' in linked);
  assert.match(linked.error, /project\/pkg\/linked\.py is a symlink; the python symbols read no symlink/);
});
