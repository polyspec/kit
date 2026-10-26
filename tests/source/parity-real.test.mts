// The language-parity runs of the real tools of this checkout: node runs its test file with node:test, go and cargo run their
// native tests, python3 runs unittest and PHPUnit 13 runs the PHP case. Nothing is stubbed; a missing tool fails the case.
// The tools come from `make install-tools`: the go, the python3 and the Composer of mise.toml, which a temporary tree runs
// through shims of its own (real-tools.mts), and var/tools/phpunit/vendor, the Composer project of config/phpunit that holds
// PHPUnit 13.4.2.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, realpathSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkParity } from '../../scripts/kit/parity.mts';
import { installExtractor } from '../../scripts/kit/install-symbols.mts';
import { toolsPath } from '../../scripts/kit/bootstrap/tool-wrappers.mts';
import { toolsEnvironment } from '../../scripts/kit/mise-tools.mts';
import { tree } from '../kit/tree.mts';
import { sandboxMise, sandboxShims } from './real-tools.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** The directory of the PHPUnit of the checkout: `make install-tools` installs it into var/tools/phpunit. */
function phpunitVendor() {
  const vendor = toolsPath(ROOT, 'phpunit/vendor');
  if (!existsSync(path.join(vendor, 'bin/phpunit'))) assert.fail(`${path.relative(ROOT, vendor)}/bin/phpunit does not exist; run make install-tools`);
  return vendor;
}

/**
 * Gives the temporary tree root the go, the python3 and the Composer of the checkout as its shims: they run as the tools of
 * mise.toml, never those of PATH. Its mise wrapper names the installs of the checkout, which the go extractor builds with.
 */
const giveTools = (root: string) => {
  sandboxShims(root, ['go', 'python3', 'composer']);
  sandboxMise(root);
};

/** The findings of the check of a repository as `<rule> <unit> <implementation>`. */
const keys = (findings: Array<{ rule: string; unit?: string | undefined; implementation?: string | undefined }>) => findings.map(finding => [finding.rule, finding.unit ?? '-', finding.implementation ?? '-'].join(' '));

// The real tools of the check: node runs its test file with node:test, go and cargo run their native tests, and python3 runs
// unittest. Each case of the suite is one native test, and the check reads the outcome of each from the output of the tool.
// The spec of the declarations (K273): one requirement, which a feature or suite unit tests in every implementation (R13, R15);
// an api unit cites it too, since every unit holds in every implementation (K276).
const SPEC = '# Codec\n\n- **CX-1** The codec holds every vector.\n';
// A PHPUnit test that traces CX-1, for each php implementation of a declaration (K273).
const PHP_TRACE = "<?php\n// CX-1\nfinal class TraceTest extends \\PHPUnit\\Framework\\TestCase\n{\n    public function test_trace(): void { $this->assertTrue(true); }\n}\n";

/** A feature unit that traces CX-1: one native test of each implementation, named by its id (K273). */
const trace = (bindings: { implementation: string; test: string; id: string }[]) => ({ id: 'trace', kind: 'feature', bindings });

/** The text of a declaration with its requirement pattern, and each unit citing CX-1 (K273). */
function declared(config: Record<string, unknown> & { units?: object[] }): string {
  const units = config.units ?? [];
  return `${JSON.stringify({ schema: 1, requirements: { pattern: 'CX-[0-9]+' }, ...config, units: units.map(unit => ({ requirements: ['CX-1'], ...unit })) }, null, 2)}\n`;
}

const REAL_CONFIG = {
  schema: 1,
  implementations: [
    { name: 'go', runner: 'go', roots: ['go'], tests: ['go/*_test.go'] },
    { name: 'rust', runner: 'cargo', roots: ['rust'], tests: ['rust/tests/*.rs'] },
    { name: 'ts', runner: 'node', roots: ['ts'], tests: ['ts/tests/*.mjs'] },
    { name: 'python', runner: 'python', roots: ['python'], tests: ['python/tests/test_*.py'] },
    { name: 'php', runner: 'php', roots: ['php'], tests: ['php/tests/*.php'] },
  ],
  testPatterns: [{ runner: 'go', globs: ['**/*_test.go'] }, { runner: 'cargo', globs: ['**/tests/**/*.rs'] }, { runner: 'node', globs: ['**/tests/**/*.mjs'] }, { runner: 'python', globs: ['**/tests/**/test_*.py'] }, { runner: 'php', globs: ['**/tests/**/*.php'] }],
  units: [{
    id: 'codec', kind: 'suite', file: 'tests/vectors/codec.json', cases: '$.vectors[*].name',
    bindings: [
      { implementation: 'go', test: 'go/codec_test.go', symbol: 'TestCodec' },
      { implementation: 'rust', test: 'rust/tests/codec.rs', symbol: 'vectors' },
      { implementation: 'ts', test: 'ts/tests/codec.mjs' },
      { implementation: 'python', test: 'python/tests/test_codec.py' },
      { implementation: 'php', test: 'php/tests/codec.php' },
    ],
  }],
};

test('K33 reads the output of real node, go, cargo, unittest and PHPUnit runs through the shared parsers (K47)', { timeout: 300_000 }, (t) => {
  const vendor = phpunitVendor();
  const root = tree(t, {
    '.gitignore': 'var/\ntarget/\n',
    'php/composer.json': '{}\n',
    'php/tests/codec.php': "<?php\nfinal class Codec extends \\PHPUnit\\Framework\\TestCase\n{\n    public function test_empty(): void { $this->assertTrue(true); }\n    public function test_ascii(): void { $this->assertTrue(true); }\n}\n",
    'tests/vectors/codec.json': JSON.stringify({ requirement: 'CX-1', vectors: [{ name: 'empty' }, { name: 'ascii' }] }),
    'go/go.mod': 'module example.com/codec\n\ngo 1.21\n',
    'go/codec_test.go': 'package codec\n\nimport "testing"\n\nfunc TestCodec(t *testing.T) {\n\tt.Run("empty", func(t *testing.T) {})\n\tt.Run("ascii", func(t *testing.T) {})\n}\n',
    'rust/Cargo.toml': '[package]\nname = "codec"\nversion = "0.1.0"\nedition = "2021"\n',
    'rust/src/lib.rs': '',
    'rust/tests/codec.rs': 'mod vectors {\n    #[test]\n    fn empty() {}\n\n    #[test]\n    fn ascii() {}\n}\n',
    'ts/package.json': '{"name":"codec","version":"0.1.0","type":"module"}\n',
    'ts/tests/codec.mjs': "import test from 'node:test';\ntest('empty', () => {});\ntest('ascii', () => {});\n",
    'python/pyproject.toml': '[project]\nname = "codec"\nversion = "0.1.0"\n',
    'python/tests/test_codec.py': 'import unittest\n\n\nclass Codec(unittest.TestCase):\n    def test_empty(self):\n        pass\n\n    def test_ascii(self):\n        pass\n',
    'docs/spec/codec.md': SPEC,
    'config/parity.json': `${declared(REAL_CONFIG)}`,
  });
  giveTools(root);
  symlinkSync(vendor, path.join(root, 'php/vendor'));
  const { findings, ledger } = checkParity(root, { execute: true, env: toolsEnvironment(root), say: () => {} });
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
    'tests/vectors/codec.json': JSON.stringify({ requirement: 'CX-1', vectors: [{ name: 'empty' }, { name: 'flag' }, { name: 'skipped' }, { name: 'incomplete' }] }),
    'php/composer.json': '{}\n',
    'php/phpunit.xml': '<phpunit>\n  <php>\n    <const name="CODEC_FLAG" value="1"/>\n  </php>\n</phpunit>\n',
    'php/tests/codec.php': "<?php\nfinal class Codec extends \\PHPUnit\\Framework\\TestCase\n{\n    public function test_empty(): void { $this->assertTrue(true); }\n    public function test_flag(): void { $this->assertTrue(defined('CODEC_FLAG')); }\n    public function test_skipped(): void { $this->markTestSkipped('later'); }\n    public function test_incomplete(): void { $this->markTestIncomplete('todo'); }\n}\n",
    'docs/spec/codec.md': SPEC,
    'config/parity.json': `${declared({
      schema: 1,
      implementations: [{ name: 'php', runner: 'php', roots: ['php'], tests: ['php/tests/*.php'] }],
      testPatterns: [{ runner: 'php', globs: ['**/tests/**/*.php'] }],
      units: [{ id: 'codec', kind: 'suite', file: 'tests/vectors/codec.json', cases: '$.vectors[*].name', bindings: [{ implementation: 'php', test: 'php/tests/codec.php' }] }],
    })}`,
  });
  symlinkSync(vendor, path.join(root, 'php/vendor'));
  const { findings, ledger } = checkParity(root, { execute: true, env: toolsEnvironment(root), say: () => {} });
  assert.deepEqual(keys(findings), ['R3 codec php']);
  const first = findings[0];
  assert.ok(first, 'checkParity found nothing');
  assert.equal(first.message, 'skipped: skipped, incomplete');
  assert.deepEqual(ledger.cases.map(entry => `${entry.case} ${entry.outcome}`), ['empty pass', 'flag pass', 'skipped skip', 'incomplete skip']);
});

const UNITTEST_CONFIG = {
  schema: 1,
  implementations: [{ name: 'python', runner: 'python', roots: ['python'], tests: ['python/tests/test_*.py'] }],
  testPatterns: [{ runner: 'python', globs: ['**/tests/**/test_*.py'] }],
  units: [{
    id: 'codec', kind: 'suite', file: 'tests/vectors/codec.json', cases: '$.vectors[*].name',
    bindings: [{ implementation: 'python', test: 'python/tests/test_codec.py' }],
  }],
};

// Moved from tests/kit/parity.test.mjs (K81): a vendored test runs in every consumer, and a consumer that declares no
// Python cannot install the one this case runs.
test('R3: a unittest expected failure is a todo, which is no pass, so its case fails (real unittest, K47)', { timeout: 120_000 }, (t) => {
  const root = tree(t, {
    '.gitignore': 'var/\n',
    'tests/vectors/codec.json': JSON.stringify({ requirement: 'CX-1', vectors: [{ name: 'empty' }, { name: 'known' }] }),
    'python/pyproject.toml': '[project]\nname = "codec"\nversion = "0.1.0"\n',
    'python/tests/test_codec.py': 'import unittest\n\n\nclass Codec(unittest.TestCase):\n    def test_empty(self):\n        pass\n\n    @unittest.expectedFailure\n    def test_known(self):\n        self.fail("not yet")\n',
    'docs/spec/codec.md': SPEC,
    'config/parity.json': `${declared(UNITTEST_CONFIG)}`,
  });
  giveTools(root);
  const { findings, ledger } = checkParity(root, { execute: true, env: toolsEnvironment(root), say: () => {} });
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
    'go/roundtrip_test.go': '// CX-1\npackage codec\n\nimport "testing"\n\nfunc TestRoundtrip(t *testing.T) {\n\tt.Run("bytes", func(t *testing.T) {})\n}\n\nfunc TestOther(t *testing.T) {}\n',
    'rust/Cargo.toml': '[package]\nname = "codec"\nversion = "0.1.0"\nedition = "2021"\n',
    'rust/src/lib.rs': '',
    'rust/tests/roundtrip.rs': '// CX-1\nmod roundtrip {\n    #[test]\n    fn bytes() {}\n}\n',
    'ts/package.json': '{"name":"codec","version":"0.1.0","type":"module"}\n',
    'ts/tests/roundtrip.test.mjs': "// CX-1\nimport { describe, test } from 'node:test';\ndescribe('roundtrip', () => {\n  describe('nested', () => {\n    test('bytes', () => {});\n  });\n});\n",
    'python/pyproject.toml': '[project]\nname = "codec"\nversion = "0.1.0"\n',
    'python/tests/test_roundtrip.py': '# CX-1\nimport unittest\n\n\nclass Roundtrip(unittest.TestCase):\n    def test_bytes(self):\n        pass\n',
    'docs/spec/codec.md': SPEC,
    'config/parity.json': `${declared({
      schema: 1,
      implementations: [
        { name: 'go', runner: 'go', roots: ['go'] },
        { name: 'rust', runner: 'cargo', roots: ['rust'] },
        { name: 'ts', runner: 'node', roots: ['ts'] },
        { name: 'python', runner: 'python', roots: ['python'] },
      ],
      units: [{
        id: 'roundtrip', kind: 'feature', bindings: [
          { implementation: 'go', test: 'go/roundtrip_test.go', id: 'TestRoundtrip/bytes' },
          { implementation: 'rust', test: 'rust/tests/roundtrip.rs', id: 'roundtrip::bytes' },
          { implementation: 'ts', test: 'ts/tests/roundtrip.test.mjs', id: 'roundtrip › nested › bytes' },
          { implementation: 'python', test: 'python/tests/test_roundtrip.py', id: 'test_bytes' },
        ],
      }],
    })}`,
  });
  giveTools(root);
  const { findings, ledger } = checkParity(root, { execute: true, env: toolsEnvironment(root), say: () => {} });
  assert.deepEqual(findings, []);
  assert.deepEqual(ledger.cases.map(entry => `${entry.implementation} ${entry.case} ${entry.outcome}`), [
    'go TestRoundtrip/bytes pass', 'rust roundtrip::bytes pass', 'ts roundtrip › nested › bytes pass', 'python test_bytes pass',
  ]);
});

/** The findings of a check of `root` as `<rule> <implementation>: <message>`. */
const lines = (root: string) => checkParity(root, { execute: true, env: toolsEnvironment(root), say: () => {} }).findings.map(finding => `${finding.rule} ${finding.implementation ?? '-'}: ${finding.message}`);

test('the python extractor reads the public symbols of a package with ast: __all__, public names and public methods (K75)', { timeout: 120_000 }, (t) => {
  const declaration = (symbols: string[]) => `${declared({
    schema: 1,
    implementations: [{ name: 'python', runner: 'python', roots: ['python'], symbols: { extractor: 'python', entry: 'python/src/codec' } }],
    units: [...symbols.map(symbol => ({ id: symbol.replaceAll('.', '-'), kind: 'api', symbols: [{ implementation: 'python', symbol }] })), trace([{ implementation: 'python', test: 'python/tests/test_trace.py', id: 'test_trace' }])],
  })}`;
  const files = {
    '.gitignore': 'var/\n',
    'docs/spec/codec.md': SPEC,
    'python/pyproject.toml': '[project]\nname = "codec"\nversion = "0.1.0"\n',
    'python/tests/test_trace.py': '# CX-1\nimport unittest\n\n\nclass Trace(unittest.TestCase):\n    def test_trace(self):\n        pass\n',
    'python/src/codec/__init__.py': 'from .core import Codec, encode\n\n__all__ = ["encode", "Codec"]\n',
    'python/src/codec/core.py': 'import json\n\nLIMIT = 3\n_CACHE = {}\n\n\ndef encode(value):\n    return json.dumps(value)\n\n\ndef _split(value):\n    return value\n\n\nclass Codec:\n    def decode(self, text):\n        return text\n\n    def _hidden(self):\n        pass\n\n\nclass _Private:\n    def visible(self):\n        pass\n',
    'python/src/codec/_internal.py': 'def helper():\n    pass\n',
  };
  const all = ['codec.Codec', 'codec.encode', 'codec.core.Codec', 'codec.core.Codec.decode', 'codec.core.LIMIT', 'codec.core.encode'];
  const root = tree(t, { ...files, 'config/parity.json': declaration(all) });
  giveTools(root);
  assert.deepEqual(lines(root), []);
  // codec.Codec of __all__ names the class that core defines; its methods are ids of core.
  const partial = tree(t, { ...files, 'config/parity.json': declaration(['codec.encode', 'codec.core.decode']) });
  giveTools(partial);
  assert.deepEqual(lines(partial), [
    'R1 python: codec.core.decode is no public symbol of python, as its python extractor reads python/src/codec',
    'R11 python: codec.Codec is public, and no API unit declares it',
    'R11 python: codec.core.Codec is public, and no API unit declares it',
    'R11 python: codec.core.Codec.decode is public, and no API unit declares it',
    'R11 python: codec.core.LIMIT is public, and no API unit declares it',
    'R11 python: codec.core.encode is public, and no API unit declares it',
  ]);
});

test('the ts extractor reads the API model that API Extractor builds from the .d.ts that tsc 7 emits (K75)', { timeout: 120_000 }, (t) => {
  const root = tree(t, {
    '.gitignore': 'dist/\n',
    'docs/spec/codec.md': SPEC,
    'ts/tests/trace.test.mjs': "// CX-1\nimport test from 'node:test';\ntest('trace', () => {});\n",
    'ts/package.json': '{ "name": "@demo/codec", "version": "1.0.0", "types": "dist/index.d.ts" }\n',
    'ts/src/index.ts': 'export function encode(value: string): string {\n  return value;\n}\n\nexport class Codec {\n  decode(text: string): string {\n    return text;\n  }\n\n  private hidden(): void {}\n}\n\nfunction internal(): void {}\ninternal();\n',
    'config/parity.json': `${declared({
      schema: 1,
      implementations: [{ name: 'ts', runner: 'node', roots: ['ts'], symbols: { extractor: 'ts', entry: 'ts/dist/index.d.ts' } }],
      units: [
        { id: 'encode', kind: 'api', symbols: [{ implementation: 'ts', symbol: '@demo/codec!encode:function(1)' }] },
        { id: 'codec', kind: 'api', symbols: [{ implementation: 'ts', symbol: '@demo/codec!Codec:class' }] },
        trace([{ implementation: 'ts', test: 'ts/tests/trace.test.mjs', id: 'trace' }]),
      ],
    })}`,
  });
  const tsc = spawnSync(process.execPath, [path.join(ROOT, 'node_modules/typescript/bin/tsc'), '--declaration', '--emitDeclarationOnly', '--strict', '--target', 'es2024', '--module', 'nodenext', '--outDir', 'ts/dist', 'ts/src/index.ts'], { cwd: root, encoding: 'utf8' });
  assert.equal(tsc.status, 0, tsc.stdout + tsc.stderr);
  assert.deepEqual(lines(root), ['R11 ts: @demo/codec!Codec#decode:member(1) is public, and no API unit declares it']);
});

test('install-tools builds the go extractor, which reads the exported API of a module with go/packages (K75)', { timeout: 300_000 }, (t) => {
  const root = tree(t, {
    '.gitignore': 'var/\n',
    // The workspace of the consumer, which does not use the module of the extractor (K196).
    'go.work': 'go 1.21\n\nuse ./go\n',
    'go/go.mod': 'module example.com/codec\n\ngo 1.21\n',
    'go/codec.go': 'package codec\n\nconst Limit = 3\n\ntype Codec struct {\n\tStrict bool\n\thidden int\n}\n\nfunc (c *Codec) Encode(v string) string { return v }\n\nfunc (c Codec) decode() {}\n\nfunc encodeHost() {}\n',
    'go/codec_test.go': 'package codec\n\nfunc Helper() {}\n',
    'docs/spec/codec.md': SPEC,
    'go/trace_test.go': '// CX-1\npackage codec\n\nimport "testing"\n\nfunc TestTrace(t *testing.T) {}\n',
    'go/internal/x/x.go': 'package x\n\nfunc Hidden() {}\n',
    'go/sub/sub.go': 'package sub\n\ntype Option interface{ Apply() }\n',
    'config/parity.json': `${declared({
      schema: 1,
      implementations: [{ name: 'go', runner: 'go', roots: ['go'], support: ['go/codec_test.go'], symbols: { extractor: 'go', entry: 'go' } }],
      units: [{ id: 'codec', kind: 'api', symbols: [{ implementation: 'go', symbol: 'example.com/codec.Codec' }] }, trace([{ implementation: 'go', test: 'go/trace_test.go', id: 'TestTrace' }])],
    })}`,
  });
  // The extractor builds with the go of mise.toml, through the shim that giveTools writes. kit lies under node_modules of a
  // consumer, so go finds the go.work of the consumer above the extractor; GOWORK names it here, as `go help environment`
  // gives for a go.work that go finds, and the build of the extractor, a module of its own, ignores it (K196). The path is the
  // real one, as go reads its working directory, so the workspace holds the module of go/ on a temporary directory behind a
  // symbolic link (/var of macOS).
  giveTools(root);
  const saved = process.env.GOWORK;
  process.env.GOWORK = path.join(realpathSync(root), 'go.work');
  t.after(() => { if (saved === undefined) delete process.env.GOWORK; else process.env.GOWORK = saved; });
  assert.equal(installExtractor({ root, extractor: 'go' }).installed, true);
  assert.equal(installExtractor({ root, extractor: 'go' }).installed, false, 'a second install of the same release builds nothing');
  assert.deepEqual(lines(root), [
    'R11 go: example.com/codec.Codec.Encode is public, and no API unit declares it',
    'R11 go: example.com/codec.Codec.Strict is public, and no API unit declares it',
    'R11 go: example.com/codec.Limit is public, and no API unit declares it',
    'R11 go: example.com/codec/sub.Option is public, and no API unit declares it',
    'R11 go: example.com/codec/sub.Option.Apply is public, and no API unit declares it',
  ]);
});

test('install-tools installs the php extractor, which reads the public API of sources and of a stub with php-parser (K75)', { timeout: 300_000 }, (t) => {
  const root = tree(t, {
    '.gitignore': 'var/\n',
    'php/src/Codec.php': "<?php\nnamespace Demo\\Codec;\n\nconst LIMIT = 3;\n\nfinal class Codec\n{\n    public const MODE = 1;\n    private const HIDDEN = 2;\n    public function __construct(public readonly string $name, private int $size = 0) {}\n    public function decode(): void {}\n    private function hidden(): void {}\n}\n",
    'php-ext/codec.stub.php': "<?php\nnamespace Demo\\Codec;\n\nfunction encode(string $value): string {}\n",
    'php/composer.json': '{}\n',
    'php/tests/TraceTest.php': PHP_TRACE,
    'php-ext/composer.json': '{}\n',
    'php-ext/tests/TraceTest.php': PHP_TRACE,
    'docs/spec/codec.md': SPEC,
    'config/parity.json': `${declared({
      schema: 1,
      implementations: [
        { name: 'php', runner: 'php', roots: ['php'], symbols: { extractor: 'php', entry: 'php/src' } },
        { name: 'php-ext', runner: 'php', roots: ['php-ext'], symbols: { extractor: 'php', entry: 'php-ext/codec.stub.php' } },
      ],
      units: [trace([{ implementation: 'php', test: 'php/tests/TraceTest.php', id: 'test_trace' }, { implementation: 'php-ext', test: 'php-ext/tests/TraceTest.php', id: 'test_trace' }])],
    })}`,
  });
  // The PHPUnit of the checkout runs the trace tests of both implementations (each package links it as its vendor directory).
  symlinkSync(phpunitVendor(), path.join(root, 'php/vendor'));
  symlinkSync(phpunitVendor(), path.join(root, 'php-ext/vendor'));
  // The Composer of this checkout installs php-parser, with its home and cache in the tree.
  giveTools(root);
  assert.equal(installExtractor({ root, extractor: 'php' }).installed, true);
  assert.deepEqual(lines(root), [
    'R11 php: Demo\\Codec\\Codec is public, and no API unit declares it',
    'R11 php: Demo\\Codec\\Codec::$name is public, and no API unit declares it',
    'R11 php: Demo\\Codec\\Codec::MODE is public, and no API unit declares it',
    'R11 php: Demo\\Codec\\Codec::__construct is public, and no API unit declares it',
    'R11 php: Demo\\Codec\\Codec::decode is public, and no API unit declares it',
    'R11 php: Demo\\Codec\\LIMIT is public, and no API unit declares it',
    'R11 php-ext: Demo\\Codec\\encode is public, and no API unit declares it',
  ]);
});

// The case runs the Rust nightly that its exception declares, which `rustup toolchain install nightly-2026-10-01 --profile
// minimal` installs; a nightly that is not installed fails the case with the error of rustup.
test('the rust extractor reads the public API of a crate from the rustdoc JSON of the declared nightly (K75)', { timeout: 300_000 }, (t) => {
  const root = tree(t, {
    '.gitignore': 'var/\ntarget/\n',
    'config/toolchain.json': JSON.stringify({ schema: 1, exceptions: [{ tool: 'rust', channel: 'nightly-2026-10-01', scope: 'rust', reason: 'rustdoc JSON is unstable', retry: 'rustdoc JSON is stable' }] }),
    'rust/tests/trace.rs': '// CX-1\n#[test]\nfn trace() {}\n',
    'rust/Cargo.toml': '[package]\nname = "codec"\nversion = "0.1.0"\nedition = "2024"\n',
    'rust/src/lib.rs': 'pub struct Codec {\n    pub strict: bool,\n    hidden: u8,\n}\n\nimpl Codec {\n    pub fn encode(&self) -> u8 {\n        self.hidden\n    }\n\n    fn private(&self) {}\n}\n\npub enum Mode {\n    Fast,\n}\n\npub trait Apply {\n    fn apply(&self);\n}\n\nmod inner {\n    pub fn hidden() {}\n}\n\npub use inner::hidden as reexported;\n',
    'docs/spec/codec.md': SPEC,
    'config/parity.json': `${declared({
      schema: 1,
      implementations: [{ name: 'rust', runner: 'cargo', roots: ['rust'], symbols: { extractor: 'rust', entry: 'rust/Cargo.toml' } }],
      units: [{ id: 'codec', kind: 'api', symbols: [{ implementation: 'rust', symbol: 'codec::Codec' }] }, trace([{ implementation: 'rust', test: 'rust/tests/trace.rs', id: 'trace' }])],
    })}`,
  });
  assert.deepEqual(lines(root), [
    'R11 rust: codec::Codec::strict is public, and no API unit declares it',
    'R11 rust: codec::Codec::encode is public, and no API unit declares it',
    'R11 rust: codec::Mode is public, and no API unit declares it',
    'R11 rust: codec::Mode::Fast is public, and no API unit declares it',
    'R11 rust: codec::Apply is public, and no API unit declares it',
    'R11 rust: codec::Apply::apply is public, and no API unit declares it',
    'R11 rust: codec::reexported is public, and no API unit declares it',
  ]);
});

test('K42 reads the case directories of a suite from real go as nested subtests', { timeout: 300_000 }, (t) => {
  const root = tree(t, {
    '.gitignore': 'var/\n',
    'tests/cases/echo/html-escape-five-chars/case.json': '{"requirements":["CX-1"]}\n',
    'tests/cases/echo/bool/case.json': '{"requirements":["CX-1"]}\n',
    'tests/cases/if/true/case.json': '{"requirements":["CX-1"]}\n',
    'go/go.mod': 'module example.com/cases\n\ngo 1.21\n',
    'go/cases_test.go': [
      '// CX-1', 'package cases', '', 'import "testing"', '',
      'func TestCases(t *testing.T) {',
      '\tfor group, names := range map[string][]string{"echo": {"html-escape-five-chars", "bool"}, "if": {"true"}} {',
      '\t\tt.Run(group, func(t *testing.T) {',
      '\t\t\tfor _, name := range names {',
      '\t\t\t\tt.Run(name, func(t *testing.T) {})',
      '\t\t\t}',
      '\t\t})',
      '\t}',
      '}', '',
    ].join('\n'),
    'docs/spec/codec.md': SPEC,
    'config/parity.json': `${declared({
      schema: 1,
      implementations: [{ name: 'go', runner: 'go', roots: ['go'] }],
      units: [{ id: 'cases', kind: 'suite', file: 'tests/cases', cases: '*/*', bindings: [{ implementation: 'go', test: 'go/cases_test.go', symbol: 'TestCases' }] }],
    })}`,
  });
  giveTools(root);
  const { findings, ledger } = checkParity(root, { execute: true, env: toolsEnvironment(root), say: () => {} });
  assert.deepEqual(findings, []);
  assert.deepEqual(ledger.cases.map(entry => `${entry.case} ${entry.outcome}`).sort(), ['echo/bool pass', 'echo/html-escape-five-chars pass', 'if/true pass']);
});
