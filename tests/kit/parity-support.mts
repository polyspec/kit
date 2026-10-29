// Tests of scripts/kit/parity.mts, the language-parity check. Each test builds a mini repository of five implementations
// (go, rust, ts, php, python) whose declaration config/parity.json passes, changes one dimension of it and expects the
// finding of exactly one rule: R1 to R11 and the declaration errors. Stub commands stand in for go, cargo, php and the
// Python of var/tools, and print the native output of their tool for the cases of the test file they run; the TypeScript
// tests are node:test files that run on the real node. A stub reads the lines `PASS <name>` and `FAIL <name>` of its test
// file (the name of a native test: a go subtest, a libtest path, a PHPUnit or unittest method) and exits with the status of
// its `EXIT <n>` line (go: `EXIT <symbol> <n>`).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { checkParity, type ParityFinding } from '../../scripts/kit/parity.mts';
import { readDeclaration, resolveReferences, symbolEntries, type ParityConfig, type ParityImplementation, type ParityModel } from '../../scripts/kit/parity-declaration.mts';
import { misplacedTests, missingImplementations, undeclaredPublic } from '../../scripts/kit/parity-units.mts';
import { checkedFiles } from '../../scripts/kit/tracked-files.mts';
import { type BindingCommand, type RunError, runOf } from '../../scripts/kit/parity-runners.mts';
import { tree } from './tree.mts';
import { initRepository } from './sandbox-repository.mts';
import { KIT, KIT_MAKE, tool } from './kit-tools.mts';
import { known } from './known.mts';
import { isJsonObject } from '../../scripts/kit/bootstrap/files.mts';
import { sha256 } from '../../scripts/kit/bootstrap/digest.mts';
import { bindinglessCatches, emptyCatches } from '../../scripts/kit/catch-check.mts';

const TIMEOUT = { timeout: 120_000 };
// A declaration config/parity.json that a case edits, also into a shape that breaks the schema on purpose: each type names
// the fields that the cases read, and every value that a case replaces is unknown.
type Entry = { [field: string]: unknown };
type BindingJson = Entry & { implementation: string };
type ToolBindingJson = Entry & { test: string; id: string };
type ToolUnitJson = Entry & { id: string; requirements: string[]; bindings: ToolBindingJson[] };
type ToolJson = Entry & { root?: string; files?: string[]; reason: string; units?: ToolUnitJson[] };
// A unit of the kind api declares symbols, every other kind bindings.
type UnitJson = Entry & { id: string; bindings?: BindingJson[]; symbols?: BindingJson[] };
type ImplementationJson = Entry & { name: string; runner: string; env?: Entry[] };
type Declaration = Entry & {
  implementations: ImplementationJson[];
  tools?: ToolJson[];
  units: UnitJson[];
  requirements: { pattern: string };
  suites: string[];
  testPatterns?: { runner: string; globs: string[] }[];
  errors: { catalog: { file: string; pattern: string } };
  languageLists: Entry[];
  documents: { globs: string[]; nouns: string[] };
};

/** The item at `index` of `list`; a missing item fails the case. */
function itemAt<T>(list: T[], index: number): T {
  const found = list[index];
  if (found === undefined) throw new Error(`the list holds no item ${index}: ${list.length} items`);
  return found;
}

/** The first item of `list` that `test` accepts; a missing item fails the case. */
function itemWhere<T>(list: T[], test: (item: T) => boolean): T {
  const found = list.find(test);
  if (found === undefined) throw new Error('the list holds no item that the case names');
  return found;
}
/** The change of a mini repository: files to write or remove (null), and the edit of the declaration. */
type Change = { files?: Record<string, string | null>; edit?: (config: Declaration) => Declaration };

// The stub of go: `go test -json -count=1 -run ^<symbol>$ ./<directory>` in the module directory. It reads the lines
// `PASS <symbol>/<case>` and `FAIL <symbol>/<case>` of the *_test.go files of the directory and writes the events of go test;
// it exits with the status of the line `EXIT <symbol> <n>`, so a test function of the same directory keeps status 0. Without
// -run it writes every PASS and FAIL line of the directory and exits with 1 when one is FAIL.
const GO_STUB = `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const args = process.argv.slice(2);
const symbol = args.includes('-run') ? args[args.indexOf('-run') + 1].replace(/^\\^|\\$$/g, '') : undefined;
// An alternation (a feature run) selects the top-level tests it names with all their subtests; a suite symbol selects its subtests (K214).
const ids = symbol !== undefined && symbol.startsWith('(') ? symbol.slice(1, -1).split('|') : undefined;
const selected = name => symbol === undefined || (ids ? ids.includes(name.split('/')[0]) : name.startsWith(symbol + '/'));
const directory = args[args.length - 1];
let exit = 0;
// A line \`BUILD <message>\` makes the package fail to build, with the events that go 1.27 writes, observed with a real module.
const build = fs.readdirSync(directory).filter(name => name.endsWith('_test.go')).sort()
  .flatMap(file => fs.readFileSync(path.join(directory, file), 'utf8').split('\\n').filter(line => line.startsWith('BUILD ')).map(line => line.slice(6)));
if (build.length) {
  const id = 'example.com/codec [example.com/codec.test]';
  console.log(JSON.stringify({ ImportPath: id, Action: 'build-output', Output: '# ' + id + '\\n' }));
  for (const message of build) console.log(JSON.stringify({ ImportPath: id, Action: 'build-output', Output: message + '\\n' }));
  console.log(JSON.stringify({ ImportPath: id, Action: 'build-fail' }));
  console.log(JSON.stringify({ Action: 'start', Package: 'example.com/codec' }));
  console.log(JSON.stringify({ Action: 'output', Package: 'example.com/codec', Output: 'FAIL\\texample.com/codec [build failed]\\n', OutputType: 'frame' }));
  console.log(JSON.stringify({ Action: 'fail', Package: 'example.com/codec', Elapsed: 0.003, FailedBuild: id }));
  process.exit(1);
}
console.log(JSON.stringify({ Action: 'start', Package: 'example' }));
for (const file of fs.readdirSync(directory).filter(name => name.endsWith('_test.go')).sort()) {
  for (const line of fs.readFileSync(path.join(directory, file), 'utf8').split('\\n')) {
    const found = /^(PASS|FAIL) (\\S+)$/.exec(line);
    if (found && selected(found[2])) {
      if ((symbol === undefined || ids) && found[1] === 'FAIL') exit = 1;
      console.log(JSON.stringify({ Action: 'run', Package: 'example', Test: found[2] }));
      console.log(JSON.stringify({ Action: 'output', Package: 'example', Test: found[2], Output: '=== RUN ' + found[2] + '\\n' }));
      console.log(JSON.stringify({ Action: found[1] === 'PASS' ? 'pass' : 'fail', Package: 'example', Test: found[2], Elapsed: 0 }));
    }
    const status = /^EXIT (\\S+) (\\d+)$/.exec(line);
    if (status && status[1] === symbol) exit = Number(status[2]);
  }
}
if (symbol !== undefined && !ids) console.log(JSON.stringify({ Action: exit ? 'fail' : 'pass', Package: 'example', Test: symbol, Elapsed: 0 }));
process.exit(exit);
`;

// The stub of the go symbol extractor (var/tools/symbols-go/bin/kit-symbols-go <module directory>): it prints the lines of
// symbols.txt of the directory as a JSON array.
const GO_SYMBOLS_STUB = `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
console.log(JSON.stringify(fs.readFileSync(path.join(process.argv[2], 'symbols.txt'), 'utf8').split('\\n').filter(Boolean)));
`;

// The stub of cargo: `cargo test --manifest-path <crate>/Cargo.toml (--test <name> | --lib) -- --test-threads=1 <filter>`
// reads tests/<name>.rs or src/lib.rs of the crate and runs each test whose name starts with the filter. It writes what cargo
// writes for serial tests: `running <n> tests`, then `test <name> ... ok` or `FAILED` for each test, then the result line.
// A file with the line `HARNESS libtest-mimic` writes what libtest-mimic 0.8 writes, which pads each name to the longest one.
//
// Run as \`cargo +<nightly> rustdoc --manifest-path <crate>/Cargo.toml --lib [--features <features>] --target-dir <dir> -- ... --output-format json\`,
// it writes <dir>/doc/codec.json in the shape of rustdoc JSON: the crate codec whose root module holds a public function for
// each line of symbols.txt of the crate. Only nightly-2026-10-01 is installed.
const CARGO_STUB = `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const args = process.argv.slice(2);
if (args[1] === 'rustdoc') {
  if (args[0] !== '+nightly-2026-10-01') { process.stderr.write("error: toolchain '" + args[0].slice(1) + "' is not installed\\n"); process.exit(1); }
  const crate = path.dirname(args[args.indexOf('--manifest-path') + 1]);
  const required = path.join(crate, 'required-feature.txt');
  if (fs.existsSync(required)) {
    const features = args.includes('--features') ? args[args.indexOf('--features') + 1].split(',') : [];
    const missing = fs.readFileSync(required, 'utf8').trim().split(',').filter(name => name && !features.includes(name));
    if (missing.length) { process.stderr.write('missing rustdoc features: ' + missing.join(', ') + '\\n'); process.exit(2); }
  }
  const names = fs.readFileSync(path.join(crate, 'symbols.txt'), 'utf8').split('\\n').filter(Boolean);
  const index = { 0: { name: 'codec', visibility: 'public', inner: { module: { is_crate: true, items: names.map((_, i) => i + 1) } } } };
  names.forEach((name, i) => { index[i + 1] = { name, visibility: 'public', inner: { function: {} } }; });
  const doc = path.join(args[args.indexOf('--target-dir') + 1], 'doc');
  fs.mkdirSync(doc, { recursive: true });
  fs.writeFileSync(path.join(doc, 'codec.json'), JSON.stringify({ format_version: 61, root: 0, index }));
  process.exit(0);
}
const crate = path.dirname(args[args.indexOf('--manifest-path') + 1]);
const target = args[args.indexOf('--test') + 1];
// A test target is tests/<name>.rs or, in Cargo's layout of a target with modules, tests/<name>/main.rs.
const file = args.includes('--lib') ? path.join(crate, 'src/lib.rs') : fs.existsSync(path.join(crate, 'tests', target + '.rs')) ? path.join(crate, 'tests', target + '.rs') : path.join(crate, 'tests', target, 'main.rs');
const separator = args.indexOf('--');
const exact = separator !== -1 && args.slice(separator + 1).includes('--exact');
const filter = exact ? args[separator - 1] : args[args.length - 1].startsWith('--') ? '' : args[args.length - 1];
const source = fs.readFileSync(file, 'utf8');
const ignoresExact = source.split('\\n').includes('HARNESS ignores-exact');
const tests = source.split('\\n').map(line => /^(PASS|FAIL) (\\S+)$/.exec(line)).filter(match => match && (exact && !ignoresExact ? match[2] === filter : match[2].startsWith(filter)));
process.stderr.write('   Compiling codec v0.1.0\\n    Finished \\x60test\\x60 profile [unoptimized + debuginfo] target(s) in 0.01s\\n     Running ' + file + '\\n');
process.stdout.write('\\nrunning ' + tests.length + ' tests\\n');
let exit = 0;
const width = fs.readFileSync(file, 'utf8').split('\\n').includes('HARNESS libtest-mimic') ? Math.max(...tests.map(([, , name]) => name.length)) : 0;
// With the line HARNESS timed the stub writes what a timed libtest-mimic harness writes: the timing comes on the line of the
// name and the outcome on the next line.
const timed = fs.readFileSync(file, 'utf8').split('\\n').includes('HARNESS timed');
for (const [, outcome, name] of tests) {
  const result = outcome === 'PASS' ? 'ok' : 'FAILED';
  if (timed) process.stdout.write('test ' + name + ' ... cpu=12.5µs wall=13µs\\n' + result + '\\n');
  else process.stdout.write('test ' + name.padEnd(width) + ' ... ' + result + '\\n');
  if (outcome === 'FAIL') exit = 1;
}
for (const line of fs.readFileSync(file, 'utf8').split('\\n')) {
  const status = /^EXIT (\\d+)$/.exec(line);
  if (status) exit = Number(status[1]);
}
process.stdout.write(exit ? '\\nfailures:\\n\\ntest result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s\\n\\n' : '\\ntest result: ok. ' + tests.length + ' passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s\\n\\n');
process.exit(exit ? 101 : 0);
`;

// The stub of PHPUnit (`php <args> vendor/bin/phpunit --teamcity <test>`): each `PASS <name>` and `FAIL <name>` line of the test
// file is a test of the class CodecTest, a method or a data set `<method> with data set "<name>"`, which PHPUnit reports as
// TeamCity messages; with `--filter <regex>` only the tests whose `CodecTest::<name>` the regex matches run, as PHPUnit
// filters. A `##teamcity[` line of the file is printed as it is. It exits with 1 when a test failed. Run as the php symbol
// extractor (\`php <kit>/symbols/php/extract.php <autoload> <entry>\`), it prints the lines of symbols.txt of the entry
// directory as a JSON array.
const PHP_STUB = `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
if (args[0].endsWith('/symbols/php/extract.php')) {
  const listed = fs.readFileSync(args[2] + '/symbols.txt', 'utf8').split('\\n').filter(Boolean);
  // With --leaks the extractor prints the leaks, the LEAK lines of the file (K307-1); else the symbols, which are no leak.
  console.log(JSON.stringify(args.includes('--leaks') ? listed.filter(line => line.startsWith('LEAK ')).map(line => line.slice(5)) : listed.filter(line => !line.startsWith('LEAK '))));
  process.exit(0);
}
const file = args[args.length - 1];
const filter = args.includes('--filter') ? args[args.indexOf('--filter') + 1] : undefined;
const selected = filter === undefined ? () => true : name => new RegExp(filter.slice(1, filter.lastIndexOf('/'))).test('CodecTest::' + name);
let exit = 0;
const teamcity = (name, attributes) => '##teamcity[' + name + ' ' + Object.entries(attributes).map(([key, value]) => key + "='" + value + "'").join(' ') + ']';
for (const line of fs.readFileSync(file, 'utf8').split('\\n')) {
  const test = /^(PASS|FAIL) (.+)$/.exec(line);
  if (test && selected(test[2])) {
    const location = 'php_qn://' + file + '::\\\\CodecTest::' + test[2];
    console.log(teamcity('testStarted', { name: test[2], locationHint: location }));
    if (test[1] === 'FAIL') { console.log(teamcity('testFailed', { name: test[2], message: 'Failed asserting', details: 'at ' + file })); exit = 1; }
    console.log(teamcity('testFinished', { name: test[2], duration: '1' }));
  }
  if (line.startsWith('##teamcity[')) console.log(line);
  const status = /^EXIT (\\d+)$/.exec(line);
  if (status) exit = Number(status[1]);
}
process.exit(exit);
`;

// The stub of Python (`python3 <args> -m unittest -v <test>`), which writes its verbose results to standard error: a line
// `<method> (<module>.<class>.<method>) ... ok` for each `PASS <method>` line of the test file, `FAIL` for a `FAIL` line.
// With REQUIRE_SOURCE it reports nothing and exits with 3 unless CODEC_SOURCE is python/src and -B is its first argument. Run as
// the python symbol extractor, the python of <project>/.venv (\`-I <kit>/symbols/python.py <distribution>\`), it prints the
// lines of symbols.txt of the project as a JSON array.
const PY_STUB = `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
if (args[0] === '-I' && args[1].endsWith('/symbols/python.py')) {
  const listed = fs.readFileSync(require('path').join(process.argv[1], '../../../symbols.txt'), 'utf8').split('\\n').filter(Boolean);
  console.log(JSON.stringify(args.includes('--leaks') ? listed.filter(line => line.startsWith('LEAK ')).map(line => line.slice(5)) : listed.filter(line => !line.startsWith('LEAK '))));
  process.exit(0);
}
const file = args[args.length - 1];
if (process.env.REQUIRE_MISE && !process.env.MISE_GLOBAL_CONFIG_FILE) { process.stderr.write('mise.toml not trusted\\n'); process.exit(9); }
if (process.env.REQUIRE_SOURCE && !(process.env.CODEC_SOURCE === 'python/src' && args[0] === '-B')) process.exit(3);
let exit = 0;
for (const line of fs.readFileSync(file, 'utf8').split('\\n')) {
  const test = /^(PASS|FAIL) (\\S+)$/.exec(line);
  if (test) {
    process.stderr.write(test[2] + ' (test_codec.Codec.' + test[2] + ') ... ' + (test[1] === 'PASS' ? 'ok' : 'FAIL') + '\\n');
    if (test[1] === 'FAIL') exit = 1;
  }
  const status = /^EXIT (\\d+)$/.exec(line);
  if (status) exit = Number(status[1]);
}
process.exit(exit);
`;

const STUBS = mkdtempSync(path.join(tmpdir(), 'kit-parity-stubs-'));
for (const [name, text] of [['go', GO_STUB], ['cargo', CARGO_STUB], ['php', PHP_STUB]] as const) {
  writeFileSync(path.join(STUBS, name), text);
  chmodSync(path.join(STUBS, name), 0o755);
}
test.after(() => rmSync(STUBS, { recursive: true, force: true }));
const ENV = { ...process.env, PATH: `${STUBS}${path.delimiter}${process.env.PATH}` };

/** The declaration file of the ts implementation, which API Extractor reads, with the declarations `lines`. */
const TS_API = (...lines: string[]) => `${lines.join('\n')}\n`;

// A node:test file of the codec: its two cases.
const NODE_CODEC = "import test from 'node:test';\ntest('empty', () => {});\ntest('ascii', () => {});\n";

const FILES = {
  '.gitignore': 'var/\n',
  'tests/vectors/codec.json': JSON.stringify({ vectors: [{ name: 'empty' }, { name: 'ascii' }] }),
  'tests/vectors/width.json': JSON.stringify(['narrow', 'wide']),
  'go/go.mod': 'module example.com/codec\n',
  'go/codec.go': 'package codec\n',
  'go/codec_test.go': 'PASS TestCodec/empty\nPASS TestCodec/ascii\n',
  'go/width_test.go': 'PASS TestWidth/narrow\nPASS TestWidth/wide\n',
  'tests/vectors/size.json': JSON.stringify(['small']),
  'go/size_test.go': 'PASS TestSize/small\n',
  'rust/tests/size.rs': 'PASS vectors::small\n',
  'go/codes.go': 'package codec\n\nconst (\n\tCodeConfig = "CONFIG"\n\tCodeDecode = "CODEC_DECODE"\n)\n',
  'rust/Cargo.toml': '[package]\nname = "codec"\n',
  'python/pyproject.toml': '[project]\nname = "codec"\nversion = "0.0.0"\n',
  'rust/src/lib.rs': 'PASS width::tests::vectors::narrow\nPASS width::tests::vectors::wide\n',
  'rust/src/codes.rs': 'pub const CONFIG: &str = "CONFIG";\npub const CODEC_DECODE: &str = "CODEC_DECODE";\n',
  'rust/tests/codec.rs': 'PASS vectors::empty\nPASS vectors::ascii\n',
  'ts/src/index.ts': 'export const encode = () => 1;\n',
  'ts/src/codes.ts': "export const CONFIG = 'CONFIG';\nexport const CODEC_DECODE = 'CODEC_DECODE';\n",
  'ts/tests/codec.mjs': NODE_CODEC,
  'ts/tests/width.mjs': "import test from 'node:test';\ntest('narrow', () => {});\ntest('wide', () => {});\n",
  'ts/tests/size.mjs': "import test from 'node:test';\ntest('small', () => {});\n",
  'php/src/Code.php': "<?php\nfinal class Code\n{\n    const CONFIG = 'CONFIG';\n    const CODEC_DECODE = 'CODEC_DECODE';\n}\n",
  'php/tests/codec.php': 'PASS test_empty\nPASS test_ascii\n',
  'php/tests/width.php': 'PASS test_narrow\nPASS test_wide\n',
  'php/tests/size.php': 'PASS test_small\n',
  'php/composer.json': '{}\n',
  'php/vendor/bin/phpunit': '',
  'python/codes.py': 'CONFIG = "CONFIG"\nCODEC_DECODE = "CODEC_DECODE"\n',
  'python/tests/test_codec.py': 'PASS test_empty\nPASS test_ascii\n',
  'python/tests/test_width.py': 'PASS test_narrow\nPASS test_wide\n',
  'python/tests/test_size.py': 'PASS test_small\n',
  'var/tools/mise/shims/python3': PY_STUB,
  // The Composer of the checkout, which make parity-check asks for the vendor directory of a php binding (K184); the tests
  // that call checkParity ask the Composer of kit.
  'var/tools/mise/shims/composer': '#!/bin/sh\necho vendor\n',
  // The public symbols that the stubs of the go and python extractors print, and the .d.ts that API Extractor reads for ts.
  'var/tools/symbols-go/bin/kit-symbols-go': GO_SYMBOLS_STUB,
  'var/tools/symbols-php/vendor/autoload.php': '<?php\n',
  'go/symbols.txt': 'go/codec.go::Encode\n',
  'rust/symbols.txt': 'encode\n',
  // rustdoc JSON is unstable, so the rust extractor runs the Rust nightly that an exception declares.
  'config/toolchain.json': JSON.stringify({ schema: 1,
    requirements: { pattern: 'CX-[0-9]+' }, exceptions: [{ tool: 'rust', channel: 'nightly-2026-10-01', scope: '.', reason: 'rustdoc JSON is unstable', retry: 'rustdoc JSON is stable' }] }),
  'python/.venv/bin/python': PY_STUB,
  'ts/package.json': '{ "name": "codec-ts", "version": "0.0.0" }\n',
  'ts/index.d.ts': TS_API('export declare const encode: () => number;'),
  'php/symbols.txt': 'php/src/Codec.php::Codec::encode\n',
  'python/symbols.txt': 'python/codec.py::encode\n',
  'docs/errors.yaml': '- code: CONFIG\n- code: CODEC_DECODE\n',
  'tools/languages.mjs': "export const LANGUAGES = ['go', 'rust', 'ts', 'php', 'python'];\n",
  'docs/index.md': '# Codec\n\nFive languages share the codec: Go, Rust, TS, PHP and Python.\n',
  'docs/spec/codec.md': '# Codec\n\n- **CX-1** The codec encodes every vector.\n\n## Width tables\n\nEvery implementation holds the width tables.\n',
  'docs/index.ko.md': '# Codec\n\n다섯 언어가 codec을 공유한다: Go, Rust, TS, PHP와 Python.\n',
};

const CONFIG = {
  schema: 1,
    requirements: { pattern: 'CX-[0-9]+' },
  implementations: [
    { name: 'go', runner: 'go', roots: ['go'], tests: ['go/**/*_test.go'], symbols: { extractor: 'go', entry: 'go' }, errors: { file: 'go/codes.go', pattern: '^\\tCode\\w+ = "(\\w+)"$' } },
    { name: 'rust', runner: 'cargo', roots: ['rust'], tests: ['rust/tests/*.rs'], symbols: { extractor: 'rust', entry: 'rust/Cargo.toml' }, errors: { file: 'rust/src/codes.rs', pattern: '^pub const \\w+: &str = "(\\w+)";$' } },
    { name: 'ts', runner: 'node', roots: ['ts'], tests: ['ts/tests/*.mjs'], symbols: { extractor: 'ts', entry: 'ts/index.d.ts' }, errors: { file: 'ts/src/codes.ts', pattern: "^export const \\w+ = '(\\w+)';$" } },
    { name: 'php', runner: 'php', roots: ['php'], tests: ['php/tests/*.php'], symbols: { extractor: 'php', entry: 'php' }, errors: { file: 'php/src/Code.php', pattern: "^    const \\w+ = '(\\w+)';$" } },
    { name: 'python', runner: 'python', roots: ['python'], tests: ['python/tests/*.py'], symbols: { extractor: 'python', entry: 'python', distribution: 'codec' }, errors: { file: 'python/codes.py', pattern: '^\\w+ = "(\\w+)"$' } },
  ],
  suites: ['tests/vectors/*.json'],
  comparators: ['tests/compare'],
  testPatterns: [
    { runner: 'go', globs: ['**/*_test.go'] },
    { runner: 'cargo', globs: ['**/tests/**/*.rs'] },
    { runner: 'node', globs: ['**/tests/**/*.mjs'] },
    { runner: 'php', globs: ['**/tests/**/*.php'] },
    { runner: 'python', globs: ['**/tests/**/test_*.py'] },
  ],
  units: [
    {
      id: 'codec', kind: 'suite', requirements: ['CX-1'], file: 'tests/vectors/codec.json', cases: '$.vectors[*].name',
      bindings: [
        { implementation: 'go', test: 'go/codec_test.go', symbol: 'TestCodec' },
        { implementation: 'rust', test: 'rust/tests/codec.rs', symbol: 'vectors' },
        { implementation: 'ts', test: 'ts/tests/codec.mjs' },
        { implementation: 'php', test: 'php/tests/codec.php' },
        { implementation: 'python', test: 'python/tests/test_codec.py' },
      ],
    },
    {
      id: 'width', kind: 'suite', requirements: ['CX-1'], file: 'tests/vectors/width.json', cases: '$[*]',
      bindings: [
        { implementation: 'go', test: 'go/width_test.go', symbol: 'TestWidth' },
        { implementation: 'rust', test: 'rust/src/lib.rs', symbol: 'width::tests::vectors' },
        { implementation: 'ts', test: 'ts/tests/width.mjs' },
        { implementation: 'php', test: 'php/tests/width.php' },
        { implementation: 'python', test: 'python/tests/test_width.py' },
      ],
    },
    {
      id: 'size', kind: 'suite', requirements: ['CX-1'], file: 'tests/vectors/size.json', cases: '$[*]',
      bindings: [
        { implementation: 'go', test: 'go/size_test.go', symbol: 'TestSize' },
        { implementation: 'rust', test: 'rust/tests/size.rs', symbol: 'vectors' },
        { implementation: 'ts', test: 'ts/tests/size.mjs' },
        { implementation: 'php', test: 'php/tests/size.php' },
        { implementation: 'python', test: 'python/tests/test_size.py' },
      ],
    },
    {
      id: 'encode', kind: 'api', requirements: ['CX-1'],
      symbols: [
        { implementation: 'go', symbol: 'go/codec.go::Encode' },
        { implementation: 'rust', symbol: 'codec::encode' },
        { implementation: 'ts', symbol: 'codec-ts!encode:function(1)' },
        { implementation: 'php', symbol: 'php/src/Codec.php::Codec::encode' },
        { implementation: 'python', symbol: 'python/codec.py::encode' },
      ],
    },
  ],
  errors: { catalog: { file: 'docs/errors.yaml', pattern: '^- code: (\\w+)$' } },
  languageLists: [{ file: 'tools/languages.mjs', pattern: 'LANGUAGES = \\[([^\\]]*)\\]' }],
  documents: { globs: ['docs/**/*.md'], nouns: ['languages', 'implementations', '언어'] },
};

/** Each bound test of `config` names the requirements of its unit, as R15 asks (K273). */
function named(all: Record<string, string | null>, config: { units: { bindings?: Entry[] }[] }) {
  for (const unit of config.units) for (const entry of unit.bindings ?? []) {
    if (typeof entry.test !== 'string') continue;
    const text = all[entry.test];
    const comment = entry.test.endsWith('.py') ? '# CX-1' : '// CX-1';
    if (typeof text === 'string' && !text.includes('CX-1')) all[entry.test] = `${text}${text.endsWith('\n') || text === '' ? '' : '\n'}${comment}\n`;
  }
}

/** A mini repository: FILES with `files` applied (null removes) and the declaration that `edit` returns from a copy of CONFIG. */
function repository(t: TestContext, { files = {}, edit = config => config }: Change = {}) {
  const config = edit(structuredClone(CONFIG));
  const all: Record<string, string | null> = { ...FILES, ...files, 'config/parity.json': `${JSON.stringify(config, null, 2)}\n` };
  named(all, config);
  const root = tree(t, Object.fromEntries(Object.entries(all).filter(([, text]) => text !== null)));
  chmodSync(path.join(root, 'var/tools/mise/shims/python3'), 0o755);
  chmodSync(path.join(root, 'var/tools/mise/shims/composer'), 0o755);
  if (all['python/.venv/bin/python'] !== null) chmodSync(path.join(root, 'python/.venv/bin/python'), 0o755);
  if (all['var/tools/symbols-go/bin/kit-symbols-go'] !== null) chmodSync(path.join(root, 'var/tools/symbols-go/bin/kit-symbols-go'), 0o755);
  return root;
}

/** The findings of the check of a mini repository; `execute` false checks the declarations only. */
function check(t: TestContext, change?: Change, { execute = true, units, implementations }: { execute?: boolean; units?: string[]; implementations?: string[] } = {}) {
  return checkParity(repository(t, change), { execute, env: ENV, say: () => {}, units, implementations });
}

/** Each finding as `<rule> <unit> <implementation>`, the fields that a finding names. */
const keys = (findings: ParityFinding[]) => findings.map(finding => [finding.rule, finding.unit ?? '-', finding.implementation ?? '-'].join(' '));

/** The finding at `index`; a missing finding fails the case, as reading a field of it did before. */
function findingAt(findings: ParityFinding[], index: number) {
  const found = findings[index];
  if (found === undefined) throw new Error(`the findings hold no item ${index}: ${findings.length} findings`);
  return found;
}

const binding = (config: Declaration, unit: string, implementation: string) => itemWhere(itemWhere(config.units, (entry: { id: string }) => entry.id === unit).bindings ?? [], (entry: { implementation: string }) => entry.implementation === implementation);















// A feature unit: one native test of each implementation, named by the id that its runner reports.
const FEATURE_FILES = {
  'go/roundtrip_test.go': 'PASS TestRoundtrip/bytes\nPASS TestRoundtrip/text\n',
  'rust/tests/roundtrip.rs': 'PASS roundtrip::bytes\n',
  'ts/tests/roundtrip.test.mjs': "import { describe, test } from 'node:test';\ndescribe('roundtrip', () => {\n  test('bytes', () => {});\n  test('text', () => {});\n});\n",
  'php/tests/RoundtripTest.php': 'PASS test_bytes\n',
  'python/tests/test_roundtrip.py': 'PASS test_bytes\n',
};
const FEATURE = {
  id: 'roundtrip', kind: 'feature', requirements: ['CX-1'],
  bindings: [
    { implementation: 'go', test: 'go/roundtrip_test.go', id: 'TestRoundtrip/bytes' },
    { implementation: 'rust', test: 'rust/tests/roundtrip.rs', id: 'roundtrip::bytes' },
    { implementation: 'ts', test: 'ts/tests/roundtrip.test.mjs', id: 'roundtrip › bytes' },
    { implementation: 'php', test: 'php/tests/RoundtripTest.php', id: 'test_bytes' },
    { implementation: 'python', test: 'python/tests/test_roundtrip.py', id: 'test_bytes' },
  ],
};
/** The feature change: FEATURE_FILES with `files` over them, and FEATURE (edited by `edit`) as a unit of the declaration. */
const feature = (files: Record<string, string | null> = {}, edit = (unit: UnitJson) => unit): Change => ({ files: { ...FEATURE_FILES, ...files }, edit: (config) => { config.units.push(edit(structuredClone(FEATURE))); return config; } });





// PHPUnit names a test by its class and method, `<Class>::<method>` (the id that its TeamCity location gives), and a
// binding may declare that form; the bare method name stays a valid id too (K229). Both are judged by the output of the run.






// A PHPUnit method with data sets runs once per data set; the id of the method names all of them, which pass only when each
// passes, and a failing data set fails the id (K229).
// A node:test case that a coverage file runs once per database item reports `<case> [<database>]` for each item; the case passes
// when each report passes, and the report of an item is no extra case (K231).






// A unittest method that runs once per database item is reported once per item; its id passes when each report passes (K229).








/** The command of a run that the test knows to be runnable: a RunError fails the test with its sentence (K222 typing). */
function commandOf(run: BindingCommand | RunError, what: string): BindingCommand {
  if ('error' in run) assert.fail(`${what}: ${run.error}`);
  return run;
}

// A go run of a feature file runs only the ids of its bindings, in one alternation; a suite run keeps its symbol (K214).


// A failed run that names no test shows the last 20 lines of its output, so its cause is visible (K215).


// cargo test of a timed libtest-mimic harness prints the timing after the name and the outcome on the next line, so
// every id that passes is a pass (K215); the stub writes that layout with the line HARNESS timed.


// A suite run counts the declared cases it passed, never a case that the suite does not declare or a repeated one (K215).


// A run that exits 0 without a declared id reports that id as not executed (K215).


// Cargo builds tests/<name>/main.rs as the test target <name>, and the other files of tests/<name>/ are its modules (K148).




// A binding with command runs that command instead of the runner's default, in the directory of its implementation; the runner
// still reads its output, so the ids that pass count (K216). The go stub is the program of the command, so the command runs.


// A command that cannot start, or that exits non-zero, is an R3 finding that names the command; the runner's default is never run instead (K216).


// A binding with its own runner runs its test with the program, arguments and output parser of that runner, not those of its
// implementation, and counts for its implementation: the php suite binding here checks its contract in node, so a
// php implementation whose contract a node test checks can bind; a runner without a reason, or a reason without a runner, is a
// declaration finding that names the unit and the implementation.


// A binding command references the invoking environment as its implementation's values do: ${NAME} is resolved when the runs
// happen, an unset or empty NAME is a finding of that binding's runs and nothing runs, and the reference is printed, not its value (K223).




// One binding per native feature id (K209, K567); a suite or API unit keeps one entry per implementation.










// The stub of vitest (`node node_modules/vitest/vitest.mjs run [--dir <dir>] --reporter=json --outputFile.json=<file> <test>`):
// it discovers test files as vitest does, every file below --dir (else the working directory), following symbolic links and
// skipping node_modules, whose path ends with the filter <test>; each `PASS <name>`, `FAIL <name>`, `SKIP <name>` and
// `TODO <name>` line of each such file is a test, its name the titles of its suites and its own joined by ' › ', which it
// writes to <file> as the JSON reporter of vitest 5 does. It exits with 1 when a test failed.
const VITEST_STUB = `const fs = require('fs');
const path = require('path');
const args = process.argv.slice(2);
const output = args.find(arg => arg.startsWith('--outputFile.json=')).slice(18);
const filter = args[args.length - 1];
const dir = args.includes('--dir') ? path.resolve(args[args.indexOf('--dir') + 1]) : process.cwd();
const status = { PASS: 'passed', FAIL: 'failed', SKIP: 'skipped', TODO: 'todo' };
const found = [];
const walk = (folder) => { for (const entry of fs.readdirSync(folder)) { if (entry === 'node_modules') continue; const next = path.join(folder, entry); if (fs.statSync(next).isDirectory()) walk(next); else if (next.endsWith(path.sep + filter)) found.push(next); } };
walk(dir);
const testResults = found.map(file => ({ name: file, assertionResults: fs.readFileSync(file, 'utf8').split('\\n').map(line => /^(PASS|FAIL|SKIP|TODO) (.+)$/.exec(line)).filter(Boolean).map(([, outcome, name]) => {
  const titles = name.split(' › ');
  return { ancestorTitles: titles.slice(0, -1), title: titles[titles.length - 1], fullName: titles.join(' '), status: status[outcome] };
}) }));
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify({ testResults }));
process.stdout.write('JSON report written to ' + output + '\\n');
process.exit(testResults.some(file => file.assertionResults.some(result => result.status === 'failed')) ? 1 : 0);
`;

/** A repository of a node and a vitest implementation with a suite and a feature unit. */
function vitestRepository(t: TestContext, files: Record<string, string | null> = {}) {
  const config = {
    schema: 1,
    requirements: { pattern: 'CX-[0-9]+' },
    implementations: [{ name: 'ts', runner: 'node', roots: ['ts'] }, { name: 'web', runner: 'vitest', roots: ['web'] }],
    units: [
      { id: 'codec', kind: 'suite', requirements: ['CX-1'], file: 'tests/vectors/codec.json', cases: '$[*]', bindings: [{ implementation: 'ts', test: 'ts/codec.test.mjs' }, { implementation: 'web', test: 'web/src/codec.spec.ts' }] },
      { id: 'roundtrip', kind: 'feature', requirements: ['CX-1'], bindings: [{ implementation: 'ts', test: 'ts/codec.test.mjs', id: 'empty' }, { implementation: 'web', test: 'web/src/roundtrip.test.ts', id: 'roundtrip › nested › bytes' }] },
    ],
  };
  const all = {
    '.gitignore': 'var/\nnode_modules/\n',
    'ts/package.json': '{ "name": "codec-ts", "version": "0.0.0" }\n',
    'web/package.json': '{ "name": "codec-web", "version": "0.0.0" }\n',
    'tests/vectors/codec.json': JSON.stringify(['empty', 'ascii']),
    'docs/spec/codec.md': '- **CX-1** The codec encodes every vector.\n',
    'ts/codec.test.mjs': NODE_CODEC,
    'web/src/codec.spec.ts': 'PASS empty\nPASS ascii\nPASS group › inner\n',
    'web/src/roundtrip.test.ts': 'PASS roundtrip › nested › bytes\nSKIP roundtrip › later\n',
    'node_modules/vitest/vitest.mjs': VITEST_STUB.replaceAll('require(', 'process.getBuiltinModule('),
    ...files,
    'config/parity.json': `${JSON.stringify(config, null, 2)}\n`,
  };
  named(all, config);
  return tree(t, Object.fromEntries(Object.entries(all).filter(([, text]) => text !== null)));
}

















































/** Adds gonative, a go implementation whose bindings run the go tests of width and size. */
function sharing(config: Declaration, shares: string | undefined): Declaration {
  config.implementations.push({ name: 'gonative', runner: 'go', roots: ['gonative'], symbols: { extractor: 'go', entry: 'gonative' }, ...(shares === undefined ? {} : { shares }) });
  for (const id of ['width', 'size']) {
    itemWhere(config.units, entry => entry.id === id).bindings?.push({ ...binding(config, id, 'go'), implementation: 'gonative' });
  }
  return config;
}









const INTERNAL = (config: Declaration, glob = 'php/tests/Internal*.php') => {
  const php = config.implementations.find(entry => entry.name === 'php');
  if (php === undefined) throw new Error('the fixture declares php');
  php.internal = [{ glob, reason: 'tests of the private helpers of the PHP package, no behaviour of the contract' }];
  return config;
};



// K342: only a match that docs/spec defines is a requirement named; UTF-8 matches the pattern of requirements and is none.
























// The sentences of Korean documents of a consumer that R10 misread (K197): a number after a distributive word counts per item, and a run
// of names with another item of its enumeration on both sides lists those items, such as toolchains.


// K311: a prose number followed by a noun of the implementations states a count only when it counts implementations.






// K307-1: a leak that the php or python extractor reports is an R17 finding that names the public symbol and the internal one.


// K336: an implementation is a source root with the manifest of its ecosystem; test globs alone do not make one.










function coveragePartChange(part: string, testPath: string, extraRustRoot = false): Change {
  const files: Record<string, string | null> = {
    'go/codec_test.go': null,
    'go/width_test.go': null,
    'go/size_test.go': null,
    'go/engine/codec_test.go': FILES['go/codec_test.go'],
    'go/engine/width_test.go': FILES['go/width_test.go'],
    'go/engine/size_test.go': FILES['go/size_test.go'],
    'go/engine/roundtrip_test.go': null,
    'go/orm/roundtrip_test.go': null,
    'go/engine/codec.go': FILES['go/codec.go'],
    'go/engine/go.mod': 'module example.com/engine\n',
    'go/codec.go': null,
    'go/engine/codes.go': FILES['go/codes.go'],
    'go/codes.go': null,
    'go/engine/symbols.txt': 'go/engine/codec.go::Encode\n',
    'go/symbols.txt': null,
    'go/orm/orm.go': 'package orm\n',
    'go/orm/go.mod': 'module example.com/orm\n',
    'go/other/Cargo.toml': extraRustRoot ? '[package]\nname = "other"\n' : null,
    'go/other/other.go': extraRustRoot ? 'package other\n' : null,
    'docs/spec/owner-scope.md': '# Native ownership\n\n- **RX-1** Go exposes this behavior through its native owner.\n',
    [testPath]: 'PASS TestRoundtrip/bytes\n// RX-1\n',
    'contracts/features.json': JSON.stringify({ features: [{
      id: 'roundtrip',
      parity: ['go-native-roundtrip'],
      tests: [testPath],
      coverage: { owners: { go: { part, tests: [testPath] } } },
    }] }),
  };
  return {
    files,
    edit: config => {
      config.requirements.pattern = '(?:CX-[0-9]+|RX-[0-9]+)';
      const go = itemWhere(config.implementations, implementation => implementation.name === 'go');
      go.roots = ['go/engine', 'go/orm'];
      go.symbols = { extractor: 'go', entry: 'go/engine' };
      go.errors = { file: 'go/engine/codes.go', pattern: '^\\tCode\\w+ = "(\\w+)"$' };
      const rust = itemWhere(config.implementations, implementation => implementation.name === 'rust');
      if (extraRustRoot) rust.roots = ['rust', 'go/other'];
      for (const unit of config.units) {
        for (const binding of unit.bindings ?? []) {
          if (binding.implementation !== 'go') continue;
          if (binding.test === 'go/codec_test.go') binding.test = 'go/engine/codec_test.go';
          if (binding.test === 'go/width_test.go') binding.test = 'go/engine/width_test.go';
          if (binding.test === 'go/size_test.go') binding.test = 'go/engine/size_test.go';
        }
        for (const symbol of unit.symbols ?? []) {
          if (symbol.implementation === 'go' && symbol.symbol === 'go/codec.go::Encode') symbol.symbol = 'go/engine/codec.go::Encode';
        }
      }
      config.units.push({
        id: 'go-native-roundtrip',
        kind: 'feature',
        requirements: ['RX-1'],
        owner: { kind: 'coverage-part', feature: 'roundtrip', part: 'owner/go' },
        bindings: [{ implementation: 'go', test: testPath, id: 'TestRoundtrip/bytes' }],
      });
      return config;
    },
  };
}































// K400: a row that fixes the declarations of its units verifies them alone, while the units of other rows still have findings.


// K400-1: a schema finding of another unit does not fail the check of a valid unit, whose rules run without it (K517), and the schema
// finding of the named unit still counts.


// K414: a row whose fact is a rule of the documents verifies it while the findings of other rules still exist.


// K414-1: a row that moves the citation of one requirement verifies it with IDS alone, while the findings of the other ids remain.




// K337: a document of docs/spec that defines no requirement is a finding that names it; the fixture's own spec document defines CX-1.













// K178: a Composer monorepo has one development composer.json at the root, which requires its libraries through path
// repositories, and one vendor directory beside it; a library has none of its own.

/** The unit width of `config`, the go and rust suite that the K42 cases read in other forms. */
const widthUnit = (config: Declaration) => itemWhere(config.units, (unit: { id: string }) => unit.id === 'width');



// Case directories, a suite whose file is a directory: tests/cases/<group>/<case>/, each holding the files of its case.
const CASE_DIRECTORIES = {
  'tests/cases/echo/html-escape-five-chars/case.json': '{"requirements": ["CX-1"]}\n',
  'tests/cases/echo/html-escape-five-chars/expected.html': '&lt;\n',
  'tests/cases/echo/bool/case.json': '{"requirements": ["CX-1"]}\n',
  'tests/cases/if/true/case.json': '{"requirements": ["CX-1"]}\n',
  'tests/cases/if/true/input.tpl': 'x\n',
  'tests/cases/if/true/nested/deeper.json': '{}\n',
  'tests/vectors/width.json': null,
  'go/width_test.go': 'PASS TestWidth/echo\nPASS TestWidth/echo/bool\nPASS TestWidth/echo/html-escape-five-chars\nPASS TestWidth/if\nPASS TestWidth/if/true\n',
};
const caseDirectories = (config: Declaration) => {
  Object.assign(widthUnit(config), { file: 'tests/cases', cases: '*/*' });
  config.suites.push('tests/cases/**');
  return config;
};

// K350: two directory suites that cite the same requirement from different case sets are one feature written twice; R18 names both.












// K517: a check that did not run never passes: a run scoped to codec leaves out width, which breaks the schema, names it, and runs
// the rules on the rest, so the finding of codec counts; with no other unit broken, the run is the same as before.










// K520: a run scoped to a unit fails while docs/spec defines a requirement twice: the duplicate is a finding of the spec itself.






/** Sets the exact public symbols of the Python encoding API without adding another implementation binding. */
function pythonEncodingSymbols(config: Declaration, symbols: string[]): Declaration {
  const unit = itemWhere(config.units, entry => entry.id === 'encode');
  const binding = itemWhere(known(unit.symbols, 'the API symbols'), entry => entry.implementation === 'python');
  delete binding.symbol;
  binding.symbols = symbols;
  return config;
}

/** Reads the real declaration schema and checks the inventory rules against a controlled Python extractor snapshot. */
function pythonEncodingFindings(t: TestContext, edit: (config: Declaration) => Declaration, symbols: string[]) {
  const root = repository(t, { edit });
  const declaration = readDeclaration(root, new Set(checkedFiles(root)));
  assert.deepEqual(declaration.errors, []);
  const model = known(declaration.model, 'the validated API model');
  const snapshots = new Map([['python', new Set(symbols)]]);
  return [...missingImplementations(model, snapshots), ...undeclaredPublic(model, snapshots)];
}










export {
  CARGO_STUB, CASE_DIRECTORIES,
  CONFIG, ENV, FEATURE, FEATURE_FILES,
  FILES, GO_STUB, GO_SYMBOLS_STUB, INTERNAL,
  KIT, KIT_MAKE, NODE_CODEC, PHP_STUB,
  PY_STUB, STUBS, TIMEOUT,
  TS_API, VITEST_STUB, binding,
  bindinglessCatches, caseDirectories, check, checkParity,
  checkedFiles, chmodSync, commandOf, coveragePartChange,
  emptyCatches, existsSync, feature, findingAt,
  initRepository, isJsonObject, itemAt, itemWhere,
  keys, known, misplacedTests, missingImplementations,
  mkdirSync, mkdtempSync, named, path,
  pythonEncodingFindings, pythonEncodingSymbols, readDeclaration, readFileSync,
  readdirSync, repository, resolveReferences, rmSync,
  runOf, sha256, sharing, spawnSync,
  symbolEntries, symlinkSync, tmpdir, tool,
  tree, undeclaredPublic, vitestRepository, widthUnit,
  writeFileSync,
};
export type {
  BindingCommand, BindingJson, Change, Declaration,
  Entry, ImplementationJson, ParityConfig, ParityFinding,
  ParityImplementation, ParityModel, RunError, TestContext,
  ToolBindingJson, ToolJson, ToolUnitJson, UnitJson,
};
