// The language-parity runs of the real tools of this checkout: node runs its test file with node:test, go and cargo run their
// native tests, python3 runs unittest and PHPUnit 11 runs the PHP case. Nothing is stubbed; a missing tool fails the case.
// The tools come from `make install-tools` (python, pythonBackend and phpunit): var/tools/bin/python3 is the Python of the
// checkout, and var/tools/phpunit/vendor is the Composer project of config/phpunit that holds PHPUnit 11.5.57.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, chmodSync, existsSync, mkdirSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkParity } from '../../scripts/kit/parity.mts';
import { tree } from '../kit/tree.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** The directory of the PHPUnit of the checkout: `make install-tools TOOLS=phpunit` installs it into var/tools/phpunit. */
function phpunitVendor() {
  const vendor = path.join(ROOT, 'var/tools/phpunit/vendor');
  if (!existsSync(path.join(vendor, 'bin/phpunit'))) assert.fail(`${path.relative(ROOT, vendor)}/bin/phpunit does not exist; run make install-tools TOOLS="composer phpunit"`);
  return vendor;
}

/**
 * Gives the temporary tree root the Python of the checkout: Python runs as var/tools/bin/python3 of the checkout, never the
 * Python of PATH, so the tree gets the wrapper that install-tools wrote for this checkout.
 */
function givePython(root: string) {
  const wrapper = path.join(ROOT, 'var/tools/bin/python3');
  if (!existsSync(wrapper)) assert.fail(`${wrapper} does not exist; run make install-tools TOOLS="python pythonBackend"`);
  mkdirSync(path.join(root, 'var/tools/bin'), { recursive: true });
  copyFileSync(wrapper, path.join(root, 'var/tools/bin/python3'));
  chmodSync(path.join(root, 'var/tools/bin/python3'), 0o755);
}

/** The findings of the check of a repository as `<rule> <unit> <implementation>`. */
const keys = (findings: Array<{ rule: string; unit?: string | undefined; implementation?: string | undefined }>) => findings.map(finding => [finding.rule, finding.unit ?? '-', finding.implementation ?? '-'].join(' '));

// The real tools of the check: node runs its test file with node:test, go and cargo run their native tests, and python3 runs
// unittest. Each case of the suite is one native test, and the check reads the outcome of each from the output of the tool.
const REAL_CONFIG = {
  schema: 1,
  implementations: [
    { name: 'go', runner: 'go', roots: ['go'], tests: ['go/*_test.go'] },
    { name: 'rust', runner: 'cargo', roots: ['rust'], tests: ['rust/tests/*.rs'] },
    { name: 'ts', runner: 'node', roots: ['ts'], tests: ['ts/tests/*.mjs'] },
    { name: 'python', runner: 'python', roots: ['python'], tests: ['python/tests/test_*.py'] },
    { name: 'php', runner: 'php', roots: ['php'], tests: ['php/tests/*.php'] },
  ],
  profiles: [{ name: 'all', implementations: ['go', 'rust', 'ts', 'python', 'php'] }],
  testPatterns: [{ runner: 'go', globs: ['**/*_test.go'] }, { runner: 'cargo', globs: ['**/tests/**/*.rs'] }, { runner: 'node', globs: ['**/tests/**/*.mjs'] }, { runner: 'python', globs: ['**/tests/**/test_*.py'] }, { runner: 'php', globs: ['**/tests/**/*.php'] }],
  units: [{
    id: 'codec', kind: 'suite', profile: 'all', file: 'tests/vectors/codec.json', cases: '$.vectors[*].name',
    bindings: [
      { implementation: 'go', test: 'go/codec_test.go', symbol: 'TestCodec' },
      { implementation: 'rust', test: 'rust/tests/codec.rs', symbol: 'vectors' },
      { implementation: 'ts', test: 'ts/tests/codec.mjs' },
      { implementation: 'python', test: 'python/tests/test_codec.py' },
      { implementation: 'php', test: 'php/tests/codec.php' },
    ],
  }],
  nativeOnly: [],
  exclusions: [],
};

test('K33 reads the output of real node, go, cargo, unittest and PHPUnit runs through the shared parsers (K47)', { timeout: 300_000 }, (t) => {
  const vendor = phpunitVendor();
  const root = tree(t, {
    '.gitignore': 'var/\ntarget/\n',
    'php/composer.json': '{}\n',
    'php/tests/codec.php': "<?php\nfinal class Codec extends \\PHPUnit\\Framework\\TestCase\n{\n    public function test_empty(): void { $this->assertTrue(true); }\n    public function test_ascii(): void { $this->assertTrue(true); }\n}\n",
    'tests/vectors/codec.json': JSON.stringify({ vectors: [{ name: 'empty' }, { name: 'ascii' }] }),
    'go/go.mod': 'module example.com/codec\n\ngo 1.21\n',
    'go/codec_test.go': 'package codec\n\nimport "testing"\n\nfunc TestCodec(t *testing.T) {\n\tt.Run("empty", func(t *testing.T) {})\n\tt.Run("ascii", func(t *testing.T) {})\n}\n',
    'rust/Cargo.toml': '[package]\nname = "codec"\nversion = "0.1.0"\nedition = "2021"\n',
    'rust/src/lib.rs': '',
    'rust/tests/codec.rs': 'mod vectors {\n    #[test]\n    fn empty() {}\n\n    #[test]\n    fn ascii() {}\n}\n',
    'ts/tests/codec.mjs': "import test from 'node:test';\ntest('empty', () => {});\ntest('ascii', () => {});\n",
    'python/tests/test_codec.py': 'import unittest\n\n\nclass Codec(unittest.TestCase):\n    def test_empty(self):\n        pass\n\n    def test_ascii(self):\n        pass\n',
    'config/parity.json': `${JSON.stringify(REAL_CONFIG, null, 2)}\n`,
  });
  givePython(root);
  symlinkSync(vendor, path.join(root, 'php/vendor'));
  const { findings, ledger } = checkParity(root, { execute: true, env: process.env, say: () => {} });
  assert.deepEqual(findings, []);
  // Each tool reports its tests in its own order (cargo and unittest sort them), so the order of the cases is not compared.
  assert.deepEqual(ledger.cases.map(entry => `${entry.implementation} ${entry.case} ${entry.outcome}`).sort(), [
    'go ascii pass', 'go empty pass', 'php ascii pass', 'php empty pass', 'python ascii pass', 'python empty pass', 'rust ascii pass', 'rust empty pass', 'ts ascii pass', 'ts empty pass',
  ]);
});


// The PHP case runs the PHPUnit of config/phpunit, which kit installs with its Composer; the test links that vendor directory into the temporary package.
test('K33 reads real PHPUnit: the configuration of the package applies, and a skipped or incomplete test is skipped, not passed (K47)', { timeout: 300_000 }, (t) => {
  const vendor = phpunitVendor();
  const root = tree(t, {
    '.gitignore': 'var/\n',
    'tests/vectors/codec.json': JSON.stringify({ vectors: [{ name: 'empty' }, { name: 'flag' }, { name: 'skipped' }, { name: 'incomplete' }] }),
    'php/composer.json': '{}\n',
    'php/phpunit.xml': '<phpunit>\n  <php>\n    <const name="CODEC_FLAG" value="1"/>\n  </php>\n</phpunit>\n',
    'php/tests/codec.php': "<?php\nfinal class Codec extends \\PHPUnit\\Framework\\TestCase\n{\n    public function test_empty(): void { $this->assertTrue(true); }\n    public function test_flag(): void { $this->assertTrue(defined('CODEC_FLAG')); }\n    public function test_skipped(): void { $this->markTestSkipped('later'); }\n    public function test_incomplete(): void { $this->markTestIncomplete('todo'); }\n}\n",
    'config/parity.json': `${JSON.stringify({
      schema: 1,
      implementations: [{ name: 'php', runner: 'php', roots: ['php'], tests: ['php/tests/*.php'] }],
      profiles: [{ name: 'all', implementations: ['php'] }],
      testPatterns: [{ runner: 'php', globs: ['**/tests/**/*.php'] }],
      units: [{ id: 'codec', kind: 'suite', profile: 'all', file: 'tests/vectors/codec.json', cases: '$.vectors[*].name', bindings: [{ implementation: 'php', test: 'php/tests/codec.php' }] }],
      nativeOnly: [],
      exclusions: [],
    }, null, 2)}\n`,
  });
  symlinkSync(vendor, path.join(root, 'php/vendor'));
  const { findings, ledger } = checkParity(root, { execute: true, env: process.env, say: () => {} });
  assert.deepEqual(keys(findings), ['R3 codec php']);
  const first = findings[0];
  assert.ok(first, 'checkParity found nothing');
  assert.equal(first.message, 'skipped: skipped, incomplete');
  assert.deepEqual(ledger.cases.map(entry => `${entry.case} ${entry.outcome}`), ['empty pass', 'flag pass', 'skipped skip', 'incomplete skip']);
});

const UNITTEST_CONFIG = {
  schema: 1,
  implementations: [{ name: 'python', runner: 'python', roots: ['python'], tests: ['python/tests/test_*.py'] }],
  profiles: [{ name: 'all', implementations: ['python'] }],
  testPatterns: [{ runner: 'python', globs: ['**/tests/**/test_*.py'] }],
  units: [{
    id: 'codec', kind: 'suite', profile: 'all', file: 'tests/vectors/codec.json', cases: '$.vectors[*].name',
    bindings: [{ implementation: 'python', test: 'python/tests/test_codec.py' }],
  }],
  nativeOnly: [],
  exclusions: [],
};

// Moved from tests/kit/parity.test.mjs (K81): a vendored test runs in every consumer, and a consumer that declares no
// Python cannot install the one this case runs.
test('R3: a unittest expected failure is a todo, which is no pass, so its case fails (real unittest, K47)', { timeout: 120_000 }, (t) => {
  const root = tree(t, {
    '.gitignore': 'var/\n',
    'tests/vectors/codec.json': JSON.stringify({ vectors: [{ name: 'empty' }, { name: 'known' }] }),
    'python/tests/test_codec.py': 'import unittest\n\n\nclass Codec(unittest.TestCase):\n    def test_empty(self):\n        pass\n\n    @unittest.expectedFailure\n    def test_known(self):\n        self.fail("not yet")\n',
    'config/parity.json': `${JSON.stringify(UNITTEST_CONFIG, null, 2)}\n`,
  });
  givePython(root);
  const { findings, ledger } = checkParity(root, { execute: true, env: process.env, say: () => {} });
  assert.deepEqual(keys(findings), ['R3 codec python']);
  const [first] = findings;
  assert.ok(first, 'the check reports the R3 finding');
  assert.equal(first.message, 'failed: known');
  assert.deepEqual(ledger.cases.map(entry => `${entry.case} ${entry.outcome}`).sort(), ['empty pass', 'known fail']);
});

test('a feature unit holds on the ids that real go, cargo, node and unittest runs of the whole test file passed (K75)', { timeout: 300_000 }, (t) => {
  const root = tree(t, {
    '.gitignore': 'var/\ntarget/\n',
    'go/go.mod': 'module example.com/codec\n\ngo 1.21\n',
    'go/roundtrip_test.go': 'package codec\n\nimport "testing"\n\nfunc TestRoundtrip(t *testing.T) {\n\tt.Run("bytes", func(t *testing.T) {})\n}\n\nfunc TestOther(t *testing.T) {}\n',
    'rust/Cargo.toml': '[package]\nname = "codec"\nversion = "0.1.0"\nedition = "2021"\n',
    'rust/src/lib.rs': '',
    'rust/tests/roundtrip.rs': 'mod roundtrip {\n    #[test]\n    fn bytes() {}\n}\n',
    'ts/tests/roundtrip.test.mjs': "import { describe, test } from 'node:test';\ndescribe('roundtrip', () => {\n  describe('nested', () => {\n    test('bytes', () => {});\n  });\n});\n",
    'python/tests/test_roundtrip.py': 'import unittest\n\n\nclass Roundtrip(unittest.TestCase):\n    def test_bytes(self):\n        pass\n',
    'config/parity.json': `${JSON.stringify({
      schema: 1,
      implementations: [
        { name: 'go', runner: 'go', roots: ['go'] },
        { name: 'rust', runner: 'cargo', roots: ['rust'] },
        { name: 'ts', runner: 'node', roots: ['ts'] },
        { name: 'python', runner: 'python', roots: ['python'] },
      ],
      profiles: [{ name: 'all', implementations: ['go', 'rust', 'ts', 'python'] }],
      units: [{
        id: 'roundtrip', kind: 'feature', profile: 'all',
        bindings: [
          { implementation: 'go', test: 'go/roundtrip_test.go', id: 'TestRoundtrip/bytes' },
          { implementation: 'rust', test: 'rust/tests/roundtrip.rs', id: 'roundtrip::bytes' },
          { implementation: 'ts', test: 'ts/tests/roundtrip.test.mjs', id: 'roundtrip › nested › bytes' },
          { implementation: 'python', test: 'python/tests/test_roundtrip.py', id: 'test_bytes' },
        ],
      }],
    }, null, 2)}\n`,
  });
  givePython(root);
  const { findings, ledger } = checkParity(root, { execute: true, env: process.env, say: () => {} });
  assert.deepEqual(findings, []);
  assert.deepEqual(ledger.cases.map(entry => `${entry.implementation} ${entry.case} ${entry.outcome}`), [
    'go TestRoundtrip/bytes pass', 'rust roundtrip::bytes pass', 'ts roundtrip › nested › bytes pass', 'python test_bytes pass',
  ]);
});

/** The findings of a check of `root` as `<rule> <implementation>: <message>`. */
const lines = (root: string) => checkParity(root, { execute: true, env: process.env, say: () => {} }).findings.map(finding => `${finding.rule} ${finding.implementation ?? '-'}: ${finding.message}`);

test('the python extractor reads the public symbols of a package with ast: __all__, public names and public methods (K75)', { timeout: 120_000 }, (t) => {
  const declaration = (symbols: string[]) => `${JSON.stringify({
    schema: 1,
    implementations: [{ name: 'python', runner: 'python', roots: ['python'], symbols: { extractor: 'python', entry: 'python/src/codec' } }],
    profiles: [{ name: 'all', implementations: ['python'] }],
    units: symbols.map(symbol => ({ id: symbol.replaceAll('.', '-'), kind: 'api', profile: 'all', symbols: [{ implementation: 'python', symbol }] })),
  }, null, 2)}\n`;
  const files = {
    '.gitignore': 'var/\n',
    'python/src/codec/__init__.py': 'from .core import Codec, encode\n\n__all__ = ["encode", "Codec"]\n',
    'python/src/codec/core.py': 'import json\n\nLIMIT = 3\n_CACHE = {}\n\n\ndef encode(value):\n    return json.dumps(value)\n\n\ndef _split(value):\n    return value\n\n\nclass Codec:\n    def decode(self, text):\n        return text\n\n    def _hidden(self):\n        pass\n\n\nclass _Private:\n    def visible(self):\n        pass\n',
    'python/src/codec/_internal.py': 'def helper():\n    pass\n',
  };
  const all = ['codec.Codec', 'codec.encode', 'codec.core.Codec', 'codec.core.Codec.decode', 'codec.core.LIMIT', 'codec.core.encode'];
  const root = tree(t, { ...files, 'config/parity.json': declaration(all) });
  givePython(root);
  assert.deepEqual(lines(root), []);
  // codec.Codec of __all__ names the class that core defines; its methods are ids of core.
  const partial = tree(t, { ...files, 'config/parity.json': declaration(['codec.encode', 'codec.core.decode']) });
  givePython(partial);
  assert.deepEqual(lines(partial), [
    'R1 python: codec.core.decode is no public symbol of python, as its python extractor reads python/src/codec',
    'R11 python: codec.Codec is public, and no API unit and no nativeOnly entry declares it',
    'R11 python: codec.core.Codec is public, and no API unit and no nativeOnly entry declares it',
    'R11 python: codec.core.Codec.decode is public, and no API unit and no nativeOnly entry declares it',
    'R11 python: codec.core.LIMIT is public, and no API unit and no nativeOnly entry declares it',
    'R11 python: codec.core.encode is public, and no API unit and no nativeOnly entry declares it',
  ]);
});

test('the ts extractor reads the API model that API Extractor builds from the .d.ts that tsc 7 emits (K75)', { timeout: 120_000 }, (t) => {
  const root = tree(t, {
    '.gitignore': 'dist/\n',
    'ts/package.json': '{ "name": "@demo/codec", "version": "1.0.0", "types": "dist/index.d.ts" }\n',
    'ts/src/index.ts': 'export function encode(value: string): string {\n  return value;\n}\n\nexport class Codec {\n  decode(text: string): string {\n    return text;\n  }\n\n  private hidden(): void {}\n}\n\nfunction internal(): void {}\ninternal();\n',
    'config/parity.json': `${JSON.stringify({
      schema: 1,
      implementations: [{ name: 'ts', runner: 'node', roots: ['ts'], symbols: { extractor: 'ts', entry: 'ts/dist/index.d.ts' } }],
      profiles: [{ name: 'all', implementations: ['ts'] }],
      units: [
        { id: 'encode', kind: 'api', profile: 'all', symbols: [{ implementation: 'ts', symbol: '@demo/codec!encode:function(1)' }] },
        { id: 'codec', kind: 'api', profile: 'all', symbols: [{ implementation: 'ts', symbol: '@demo/codec!Codec:class' }] },
      ],
    }, null, 2)}\n`,
  });
  const tsc = spawnSync(process.execPath, [path.join(ROOT, 'node_modules/typescript/bin/tsc'), '--declaration', '--emitDeclarationOnly', '--strict', '--target', 'es2024', '--module', 'nodenext', '--outDir', 'ts/dist', 'ts/src/index.ts'], { cwd: root, encoding: 'utf8' });
  assert.equal(tsc.status, 0, tsc.stdout + tsc.stderr);
  assert.deepEqual(lines(root), ['R11 ts: @demo/codec!Codec#decode:member(1) is public, and no API unit and no nativeOnly entry declares it']);
});
