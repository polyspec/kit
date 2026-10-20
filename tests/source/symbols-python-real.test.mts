// The leaks of the Python symbol extractor (K307-1), run by the python3 of mise.toml: a public function, method or class whose
// annotations or bases name a private symbol of the package (a name that starts with one _) is a leak; a public name is not.
// Nothing is stubbed; make install-tools installs the python that this test runs.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { toolsEnvironment } from '../../scripts/kit/mise-tools.mts';
import { parseJson } from '../../scripts/kit/schema-validate.mts';
import { tree } from '../kit/tree.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SHIM = path.join(ROOT, 'var/tools/mise/shims/python3');
const EXTRACTOR = path.join(ROOT, 'scripts/kit/symbols/python.py');

/** The output of the extractor on the package `pkg` of the files, as a list of strings. */
function run(t: Parameters<typeof tree>[0], files: Record<string, string>, ...flags: string[]): string[] {
  const root = tree(t, files);
  const result = spawnSync(SHIM, ['-I', EXTRACTOR, path.join(root, 'pkg'), ...flags], { cwd: ROOT, env: toolsEnvironment(ROOT), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return parseJson<string[]>(result.stdout, 'symbol-ids.schema.json', 'python.py');
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
