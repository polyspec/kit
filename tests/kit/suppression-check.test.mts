// Tests of the suppression check (P8, K334): a suppression of a lint finding in each ecosystem fails without the reason that names the
// need of the code, passes with it, and a directive inside a string literal is text.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { suppressionFindings } from '../../scripts/kit/suppression-check.mts';
import { tool } from './kit-tools.mts';
import { put, tree } from './tree.mts';
import { initRepository } from './sandbox-repository.mts';

// Each case: a file, a suppression without its reason, and the same suppression with it.
const CASES: { file: string; bare: string; stated: string }[] = [
  { file: 'src/a.ts', bare: '// eslint-disable-next-line no-control-regex', stated: '// eslint-disable-next-line no-control-regex -- the pattern matches the escape codes of a terminal' },
  { file: 'src/a.mjs', bare: '/* oxlint-disable no-empty */', stated: '/* oxlint-disable no-empty -- the generated stubs have empty bodies by design */' },
  { file: 'pkg/a.py', bare: 'import os  # noqa: F401', stated: 'import os  # noqa: F401 - the import registers the plugin of the module' },
  { file: 'src/A.php', bare: '/** @phpstan-ignore argument.type */', stated: '/** @phpstan-ignore argument.type (the stub of the extension types the argument loosely) */' },
  { file: 'src/B.php', bare: '// phpcs:ignore Generic.PHP.NoSilencedErrors.Discouraged', stated: '// phpcs:ignore Generic.PHP.NoSilencedErrors.Discouraged -- the read fails on a missing file, which the next line checks' },
  { file: 'go/a.go', bare: '_ = os.Remove(name) //nolint:errcheck', stated: '_ = os.Remove(name) //nolint:errcheck // the temporary file may be gone already' },
  { file: 'rust/src/lib.rs', bare: '#[allow(clippy::unwrap_used)]', stated: '#[allow(clippy::unwrap_used, reason = "the literal always parses")]' },
];

test('a suppression without its reason fails in each ecosystem, and with its reason passes (K334)', () => {
  for (const { file, bare, stated } of CASES) {
    const found = suppressionFindings(file, `first\n${bare}\n`);
    assert.equal(found.length, 1, `${file}: ${bare}`);
    assert.match(found[0] ?? '', new RegExp(`^${file.replaceAll('.', '\\.')}:2: \\S+ states no reason; a suppression names the need of the code, as `));
    assert.deepEqual(suppressionFindings(file, `first\n${stated}\n`), [], `${file}: ${stated}`);
  }
});

test('a directive inside a string literal, or in a file of another language, is no suppression (K334)', () => {
  assert.deepEqual(suppressionFindings('tests/a.test.mts', "const fixture = 'import os  # noqa\\n// eslint-disable-next-line no-x\\n';\n"), []);
  assert.deepEqual(suppressionFindings('tests/a.test.mts', 'const go = `\\t_ = f() //nolint:errcheck\\n`;\n'), []);
  assert.deepEqual(suppressionFindings('docs/a.md', '// eslint-disable-next-line no-x\n'), []);
  assert.deepEqual(suppressionFindings('pkg/a.py', 'text = "# noqa"\n'), []);
});

test('make suppression-check fails on a tracked suppression without its reason and passes once it states one (K334)', (t) => {
  const root = tree(t, { 'src/a.ts': '// eslint-disable-next-line no-x\nexport const a = 1;\n' });
  initRepository(root, '--initial-branch=main');
  const add = spawnSync('git', ['add', '-A'], { cwd: root });
  assert.equal(add.status, 0);
  const run = () => spawnSync(process.execPath, [tool(import.meta.resolve('../../scripts/kit/suppression-check.mts'))], { cwd: root, encoding: 'utf8' });
  const red = run();
  assert.equal(red.status, 1, red.stdout + red.stderr);
  assert.match(red.stderr, /\[suppression-check\] src\/a\.ts:1: eslint-disable-next-line states no reason/);
  put(root, { 'src/a.ts': '// eslint-disable-next-line no-x -- the generated name breaks the rule by design\nexport const a = 1;\n' });
  const green = run();
  assert.equal(green.status, 0, green.stdout + green.stderr);
});
