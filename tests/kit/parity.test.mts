// Tests of scripts/kit/parity.mts, the language-parity check. Each test builds a mini repository of five implementations
// (go, rust, ts, php, python) whose declaration config/parity.json passes, changes one dimension of it and expects the
// finding of exactly one rule: R1 to R11 and the declaration errors. Stub commands stand in for go, cargo, php and the
// Python of var/tools, and print the native output of their tool for the cases of the test file they run; the TypeScript
// tests are node:test files that run on the real node. A stub reads the lines `PASS <name>` and `FAIL <name>` of its test
// file (the name of a native test: a go subtest, a libtest path, a PHPUnit or unittest method) and exits with the status of
// its `EXIT <n>` line (go: `EXIT <symbol> <n>`).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { checkParity, type ParityFinding } from '../../scripts/kit/parity.mts';
import type { ParityConfig, ParityImplementation, ParityModel } from '../../scripts/kit/parity-declaration.mts';
import { misplacedTests } from '../../scripts/kit/parity-units.mts';
import { type BindingCommand, type RunError, runOf } from '../../scripts/kit/parity-runners.mts';
import { tree } from './tree.mts';
import { initRepository } from './sandbox-repository.mts';
import { KIT, KIT_MAKE, tool } from './kit-tools.mts';
import { known } from './known.mts';

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
// Run as \`cargo +<nightly> rustdoc --manifest-path <crate>/Cargo.toml --lib --target-dir <dir> -- ... --output-format json\`,
// it writes <dir>/doc/codec.json in the shape of rustdoc JSON: the crate codec whose root module holds a public function for
// each line of symbols.txt of the crate. Only nightly-2026-10-01 is installed.
const CARGO_STUB = `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const args = process.argv.slice(2);
if (args[1] === 'rustdoc') {
  if (args[0] !== '+nightly-2026-10-01') { process.stderr.write("error: toolchain '" + args[0].slice(1) + "' is not installed\\n"); process.exit(1); }
  const names = fs.readFileSync(path.join(path.dirname(args[args.indexOf('--manifest-path') + 1]), 'symbols.txt'), 'utf8').split('\\n').filter(Boolean);
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
// the python symbol extractor (\`-I <kit>/symbols/python.py <entry>\`), it prints the lines of the entry file as a JSON array.
const PY_STUB = `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
if (args[0] === '-I' && args[1].endsWith('/symbols/python.py')) {
  const listed = fs.readFileSync(args[2], 'utf8').split('\\n').filter(Boolean);
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
    { name: 'python', runner: 'python', roots: ['python'], tests: ['python/tests/*.py'], symbols: { extractor: 'python', entry: 'python/symbols.txt' }, errors: { file: 'python/codes.py', pattern: '^\\w+ = "(\\w+)"$' } },
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
  if (all['var/tools/symbols-go/bin/kit-symbols-go'] !== null) chmodSync(path.join(root, 'var/tools/symbols-go/bin/kit-symbols-go'), 0o755);
  return root;
}

/** The findings of the check of a mini repository; `execute` false checks the declarations only. */
function check(t: TestContext, change?: Change, { execute = true } = {}) {
  return checkParity(repository(t, change), { execute, env: ENV, say: () => {} });
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

test('the declaration of five implementations passes, with every case of every suite executed twice alike', TIMEOUT, (t) => {
  const { findings, ledger } = check(t);
  assert.deepEqual(findings, []);
  assert.deepEqual(ledger.runs.map(run => `${run.unit} ${run.implementation} ${run.attempt} ${run.status}`), [
    'codec go 1 0', 'codec go 2 0', 'codec rust 1 0', 'codec rust 2 0', 'codec ts 1 0', 'codec ts 2 0', 'codec php 1 0', 'codec php 2 0',
    'codec python 1 0', 'codec python 2 0', 'width go 1 0', 'width go 2 0', 'width rust 1 0', 'width rust 2 0', 'width ts 1 0', 'width ts 2 0',
    'width php 1 0', 'width php 2 0', 'width python 1 0', 'width python 2 0', 'size go 1 0', 'size go 2 0', 'size rust 1 0', 'size rust 2 0',
    'size ts 1 0', 'size ts 2 0', 'size php 1 0', 'size php 2 0', 'size python 1 0', 'size python 2 0',
  ]);
  assert.deepEqual(ledger.cases.map(entry => `${entry.unit} ${entry.implementation} ${entry.case} ${entry.outcome}`), [
    'codec go empty pass', 'codec go ascii pass', 'codec rust empty pass', 'codec rust ascii pass',
    'codec ts empty pass', 'codec ts ascii pass', 'codec php empty pass', 'codec php ascii pass',
    'codec python empty pass', 'codec python ascii pass',
    'width go narrow pass', 'width go wide pass', 'width rust narrow pass', 'width rust wide pass',
    'width ts narrow pass', 'width ts wide pass', 'width php narrow pass', 'width php wide pass', 'width python narrow pass', 'width python wide pass',
    'size go small pass', 'size rust small pass', 'size ts small pass', 'size php small pass', 'size python small pass',
  ]);
});

test('each runner runs the native test of its binding', TIMEOUT, (t) => {
  const root = repository(t);
  const { ledger } = checkParity(root, { execute: true, env: ENV, say: () => {} });
  const commands = Object.fromEntries(ledger.runs.map(run => [`${run.unit} ${run.implementation}`, { cwd: run.cwd, command: [run.command, ...run.args] }]));
  assert.deepEqual(commands['codec go'], { cwd: 'go', command: ['go', 'test', '-json', '-count=1', '-run', '^TestCodec$', './'] });
  assert.deepEqual(commands['codec rust'], { cwd: '.', command: ['cargo', 'test', '--manifest-path', 'rust/Cargo.toml', '--test', 'codec', '--', '--test-threads=1', 'vectors::'] });
  assert.deepEqual(commands['width rust'], { cwd: '.', command: ['cargo', 'test', '--manifest-path', 'rust/Cargo.toml', '--lib', '--', '--test-threads=1', 'width::tests::vectors::'] });
  assert.deepEqual(commands['codec ts'], { cwd: '.', command: [process.execPath, '--test', `--test-reporter=${path.join(KIT, 'parity-node-reporter.mts')}`, 'ts/tests/codec.mjs'] });
  assert.deepEqual(commands['codec php'], { cwd: '.', command: ['php', 'php/vendor/bin/phpunit', '--teamcity', '--no-configuration', 'php/tests/codec.php'] });
  assert.deepEqual(commands['codec python'], { cwd: '.', command: [path.join(root, 'var/tools/mise/shims/python3'), '-m', 'unittest', '-v', 'python/tests/test_codec.py'] });
});

test('an implementation declares the command, the arguments and the environment of its runner', TIMEOUT, (t) => {
  const declare = (withEnvironment: boolean) => (config: Declaration) => {
    const implementation = (name: string) => itemWhere(config.implementations, (entry: { name: string }) => entry.name === name);
    Object.assign(implementation('python'), { command: 'python/.venv/bin/python', args: ['-B'], env: withEnvironment ? [{ name: 'CODEC_SOURCE', value: 'python/src' }, { name: 'REQUIRE_SOURCE', value: '1' }] : [{ name: 'REQUIRE_SOURCE', value: '1' }] });
    implementation('php').args = ['-d', 'extension=php/modules/codec.so'];
    implementation('go').args = ['-tags', 'parity'];
    implementation('rust').args = ['--features', 'vectors'];
    return config;
  };
  const files = { '.gitignore': 'var/\n.venv/\n', 'python/.venv/bin/python': PY_STUB };
  const root = repository(t, { files, edit: declare(true) });
  chmodSync(path.join(root, 'python/.venv/bin/python'), 0o755);
  const { findings, ledger } = checkParity(root, { execute: true, env: ENV, say: () => {} });
  assert.deepEqual(findings, []);
  const commands = Object.fromEntries(ledger.runs.map(run => [`${run.unit} ${run.implementation}`, [run.command, ...run.args]]));
  assert.deepEqual(commands['codec python'], [path.join(root, 'python/.venv/bin/python'), '-B', '-m', 'unittest', '-v', 'python/tests/test_codec.py']);
  assert.deepEqual(commands['codec php'], ['php', '-d', 'extension=php/modules/codec.so', 'php/vendor/bin/phpunit', '--teamcity', '--no-configuration', 'php/tests/codec.php']);
  assert.deepEqual(commands['codec go'], ['go', 'test', '-tags', 'parity', '-json', '-count=1', '-run', '^TestCodec$', './']);
  assert.deepEqual(commands['codec rust'], ['cargo', 'test', '--features', 'vectors', '--manifest-path', 'rust/Cargo.toml', '--test', 'codec', '--', '--test-threads=1', 'vectors::']);
  assert.equal(process.env.REQUIRE_SOURCE, undefined, 'the environment of an implementation reaches only its runs');
  const other = repository(t, { files, edit: declare(false) });
  chmodSync(path.join(other, 'python/.venv/bin/python'), 0o755);
  const missing = checkParity(other, { execute: true, env: ENV, say: () => {} }).findings;
  assert.deepEqual(keys(missing), ['R3 codec python', 'R3 width python', 'R3 size python']);
  assert.match(findingAt(missing, 0).message, /exited with 3/);
});

test('a runner value references the invoking environment as ${NAME}, resolved when the bindings run and never printed', TIMEOUT, (t) => {
  const declare = (config: Declaration) => {
    const implementation = (name: string) => itemWhere(config.implementations, (entry: { name: string }) => entry.name === name);
    Object.assign(implementation('python'), { command: '${PARITY_VENV}/bin/python', args: ['-B'], env: [{ name: 'CODEC_SOURCE', value: '${PARITY_PYTHON}/src' }, { name: 'REQUIRE_SOURCE', value: '1' }] });
    implementation('php').args = ['-d', 'extension=${PARITY_PHP}/codec.so'];
    return config;
  };
  const files = { '.gitignore': 'var/\n.venv/\n', 'python/.venv/bin/python': PY_STUB };
  const root = repository(t, { files, edit: declare });
  chmodSync(path.join(root, 'python/.venv/bin/python'), 0o755);
  const env = { ...ENV, PARITY_VENV: path.join(root, 'python/.venv'), PARITY_PYTHON: 'python', PARITY_PHP: 'php/modules' };
  const lines: string[] = [];
  const { findings, ledger } = checkParity(root, { execute: true, env, say: line => lines.push(line) });
  assert.deepEqual(findings, []);
  const commands = Object.fromEntries(ledger.runs.map(run => [`${run.unit} ${run.implementation}`, [run.command, ...run.args]]));
  assert.deepEqual(commands['codec python'], [path.join(root, 'python/.venv/bin/python'), '-B', '-m', 'unittest', '-v', 'python/tests/test_codec.py']);
  assert.deepEqual(commands['codec php'], ['php', '-d', 'extension=php/modules/codec.so', 'php/vendor/bin/phpunit', '--teamcity', '--no-configuration', 'php/tests/codec.php']);
  assert.ok(lines.includes('run codec php (1 of 2): php -d extension=${PARITY_PHP}/codec.so php/vendor/bin/phpunit --teamcity --no-configuration php/tests/codec.php (in .)'), lines.join('\n'));
  assert.ok(!lines.some(line => line.includes('php/modules') || line.includes(env.PARITY_VENV)), lines.join('\n'));
  const messages = (environment: NodeJS.ProcessEnv) => checkParity(root, { execute: true, env: environment, say: () => {} }).findings.map(finding => `${finding.rule} ${finding.unit} ${finding.implementation}: ${finding.message}`);
  assert.deepEqual(checkParity(root, { execute: false, env: ENV, say: () => {} }).findings, [], 'the declarations do not read the environment');
  const unset: NodeJS.ProcessEnv = { ...env };
  delete unset.PARITY_PHP;
  assert.deepEqual(messages(unset), ['R3 codec php: cannot start: args references ${PARITY_PHP}, which the environment does not set', 'R3 width php: cannot start: args references ${PARITY_PHP}, which the environment does not set', 'R3 size php: cannot start: args references ${PARITY_PHP}, which the environment does not set']);
  assert.deepEqual(messages({ ...env, PARITY_VENV: '' }), ['R3 codec python: cannot start: command references ${PARITY_VENV}, which the environment sets to an empty string', 'R3 width python: cannot start: command references ${PARITY_VENV}, which the environment sets to an empty string', 'R3 size python: cannot start: command references ${PARITY_VENV}, which the environment sets to an empty string']);
  const other = repository(t, { files, edit: (config) => { itemAt(itemWhere(declare(config).implementations, (entry: { name: string }) => entry.name === 'python').env ?? [], 0).value = '${PARITY_PYTHON:-python}/src'; return config; } });
  assert.deepEqual(checkParity(other, { execute: false, env, say: () => {} }).findings.map(finding => `${finding.rule}: ${finding.message}`), [
    'declaration: implementation python: env CODEC_SOURCE holds ${PARITY_PYTHON:-python}, which is no reference; a reference is ${NAME} and has no default',
  ]);
  const empty = repository(t, { files, edit: (config) => { itemWhere(declare(config).implementations, (entry: { name: string }) => entry.name === 'python').command = ''; return config; } });
  assert.deepEqual(checkParity(empty, { execute: true, env, say: () => {} }).findings.map(finding => `${finding.rule}: ${finding.message}`), [
    'declaration: config/parity.json: /implementations/4/command must NOT have fewer than 1 characters {"limit":1}, value ""',
  ]);
});

test('a support file of an implementation is never a test: it lies in its roots and holds no test that its runner runs', TIMEOUT, (t) => {
  const support: Record<string, string[]> = { go: ['go/helpers_test.go'], php: ['php/tests/cases.php'], ts: ['ts/tests/case.mjs'] };
  const declare = (extra: Record<string, string[]> = {}) => (config: Declaration) => {
    for (const entry of config.implementations) {
      const globs = [...(support[entry.name] ?? []), ...(extra[entry.name] ?? [])];
      if (globs.length) entry.support = globs;
    }
    return config;
  };
  const helpers = 'package codec\n\nfunc testHelper() {}\nfunc (s suite) TestMethod() {}\nfunc Testing() {}\n';
  const files = { 'go/helpers_test.go': helpers, 'php/tests/cases.php': '<?php\n', 'ts/tests/case.mjs': 'export const cases = [];\n' };
  assert.deepEqual(check(t, { files, edit: declare() }).findings, []);
  const messages = (change: Change) => check(t, change, { execute: false }).findings.map(finding => `${finding.rule}: ${finding.message}`);
  assert.deepEqual(messages({
    files: { ...files, 'go/helpers_test.go': 'package codec\n\nfunc TestHelper(t *testing.T) {}\nfunc Example() {}\n', 'rust/tests/support.rs': '#[tokio::test]\nasync fn helper() {}\n', 'tools/tests/case.mjs': 'export const cases = [];\n' },
    edit: (config) => { declare({ rust: ['rust/tests/support.rs'], ts: ['tools/tests/case.mjs', 'ts/tests/gone.mjs'] })(config); itemWhere(config.implementations, (entry: { name: string }) => entry.name === 'python').support = ['python/tests/test_codec.py']; return config; },
  }), [
    'declaration: implementation go: the support file go/helpers_test.go declares func TestHelper, which go test runs; a support file holds no test',
    'declaration: implementation go: the support file go/helpers_test.go declares func Example, which go test runs; a support file holds no test',
    'declaration: implementation rust: the support file rust/tests/support.rs holds #[tokio::test], which cargo test runs; a support file holds no test',
    'declaration: implementation ts: the support file tools/tests/case.mjs lies outside ts, the roots of ts',
    'declaration: implementation ts: the support glob ts/tests/gone.mjs selects no test file; remove it',
    'declaration: unit codec: the test python/tests/test_codec.py of python matches its support globs',
  ]);
  // A support file exempts a file only from the pattern of the runner of its implementation.
  assert.deepEqual(messages({ files, edit: (config) => { declare()(config); itemWhere(config.testPatterns ?? [], (pattern: { runner: string }) => pattern.runner === 'node').globs.push('**/tests/**/*.php'); return config; } }), [
    'R6: a node test outside ts, the roots of the node implementations, and outside tests/compare, the comparator roots; move it into the package of its implementation',
  ]);
  // parity-check runs each node, php and python support file once; a harness line in its output is a test that no binding declares.
  const reporting = check(t, { files: { ...files, 'ts/tests/case.mjs': "import test from 'node:test';\ntest('empty', () => {});\n", 'php/tests/cases.php': 'FAIL test_ascii\n' }, edit: declare() });
  assert.deepEqual(reporting.findings.map(finding => `${finding.rule} ${finding.implementation} ${finding.place}: ${finding.message}`), [
    'R5 ts ts/tests/case.mjs: the support file reports cases (empty); declare it as the test of a binding',
    'R5 php php/tests/cases.php: the support file reports cases (ascii); declare it as the test of a binding',
  ]);
});

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

test('a feature unit holds when the native id of each binding passes in both runs (K75)', TIMEOUT, (t) => {
  const { findings, ledger } = check(t, feature());
  assert.deepEqual(findings, []);
  assert.deepEqual(ledger.cases.filter(entry => entry.unit === 'roundtrip').map(entry => `${entry.implementation} ${entry.case} ${entry.outcome}`), [
    'go TestRoundtrip/bytes pass', 'rust roundtrip::bytes pass', 'ts roundtrip › bytes pass', 'php test_bytes pass', 'python test_bytes pass',
  ]);
  const commands = Object.fromEntries(ledger.runs.filter(run => run.unit === 'roundtrip').map(run => [run.implementation, [run.command, ...run.args]]));
  assert.deepEqual(commands.go, ['go', 'test', '-json', '-count=1', '-run', '^(TestRoundtrip)$', './']);
  assert.deepEqual(commands.rust, ['cargo', 'test', '--manifest-path', 'rust/Cargo.toml', '--test', 'roundtrip', 'roundtrip::bytes', '--', '--test-threads=1', '--exact']);
});

test('K566: a Cargo feature executes only its exact native test id', TIMEOUT, (t) => {
  const { findings, ledger } = check(t, feature({ 'rust/tests/roundtrip.rs': 'PASS roundtrip::bytes\nPASS rollback_failed_sqlite\nPASS rollback_failed_mysql\nPASS rollback_failed_postgres\nPASS savepoint_rollback_failed_sqlite\nPASS savepoint_rollback_failed_mysql\nPASS savepoint_rollback_failed_postgres\nPASS rollback_fault_sqlite\nPASS rollback_fault_mysql\nPASS rollback_fault_postgres\n' }));
  assert.deepEqual(findings, []);
  assert.deepEqual(ledger.cases.filter(entry => entry.unit === 'roundtrip' && entry.implementation === 'rust').map(entry => `${entry.case} ${entry.outcome}`), ['roundtrip::bytes pass']);
  const rustRun = known(ledger.runs.find(run => run.unit === 'roundtrip' && run.implementation === 'rust'), 'the cargo feature run');
  assert.deepEqual([rustRun.command, ...rustRun.args], ['cargo', 'test', '--manifest-path', 'rust/Cargo.toml', '--test', 'roundtrip', 'roundtrip::bytes', '--', '--test-threads=1', '--exact']);

  const zeroMatches = check(t, feature({ 'rust/tests/roundtrip.rs': 'PASS roundtrip::other\n' }));
  assert.deepEqual(keys(zeroMatches.findings), ['R3 roundtrip rust']);
  assert.match(findingAt(zeroMatches.findings, 0).message, /not executed: roundtrip::bytes/);

  const ignoredFilter = check(t, feature({ 'rust/tests/roundtrip.rs': 'HARNESS ignores-exact\nPASS roundtrip::bytes\nPASS roundtrip::bytes_database\n' }));
  assert.deepEqual(keys(ignoredFilter.findings), ['R3 roundtrip rust']);
  assert.match(findingAt(ignoredFilter.findings, 0).message, /reported outside the exact feature ids.*roundtrip::bytes_database/);
});

// PHPUnit names a test by its class and method, `<Class>::<method>` (the id that its TeamCity location gives), and a
// binding may declare that form; the bare method name stays a valid id too (K229). Both are judged by the output of the run.
test('a php feature binding that names its test as Class::method, the id PHPUnit reports, passes (K229)', TIMEOUT, (t) => {
  const { findings, ledger } = check(t, feature({}, unit => ({ ...unit, bindings: (unit.bindings ?? []).map(entry => (entry.implementation === 'php' ? { ...entry, id: 'CodecTest::test_bytes' } : entry)) })));
  assert.deepEqual(findings, []);
  assert.deepEqual(ledger.cases.filter(entry => entry.unit === 'roundtrip' && entry.implementation === 'php').map(entry => `${entry.case} ${entry.outcome}`), ['CodecTest::test_bytes pass']);
});

// A PHPUnit method with data sets runs once per data set; the id of the method names all of them, which pass only when each
// passes, and a failing data set fails the id (K229).
// A node:test case that a coverage file runs once per database item reports `<case> [<database>]` for each item; the case passes
// when each report passes, and the report of an item is no extra case (K231).
test('a ts suite case reported once per database item passes when each report passes (K231)', TIMEOUT, (t) => {
  const items = "import test from 'node:test';\ntest('empty [mysql]', () => {});\ntest('empty [sqlite]', () => {});\ntest('ascii [mysql]', () => {});\ntest('ascii [sqlite]', () => {});\n";
  const { findings, ledger } = checkParity(repository(t, { files: { 'ts/tests/codec.mjs': items } }), { execute: true, env: ENV, say: () => {} });
  assert.deepEqual(findings.filter(finding => finding.implementation === 'ts'), []);
  assert.deepEqual(ledger.cases.filter(entry => entry.unit === 'codec' && entry.implementation === 'ts').map(entry => `${entry.case} ${entry.outcome}`), ['empty pass', 'ascii pass']);
});

test('a ts feature id reported once per database item passes when each report passes (K231)', TIMEOUT, (t) => {
  const items = "import { describe, test } from 'node:test';\ndescribe('roundtrip', () => {\n  test('bytes [mysql]', () => {});\n  test('bytes [sqlite]', () => {});\n});\n";
  const { findings, ledger } = check(t, feature({ 'ts/tests/roundtrip.test.mjs': items }));
  assert.deepEqual(findings, []);
  assert.deepEqual(ledger.cases.filter(entry => entry.unit === 'roundtrip' && entry.implementation === 'ts').map(entry => `${entry.case} ${entry.outcome}`), ['roundtrip › bytes pass']);
});

test('a php feature id names a method with data sets: it passes when each data set passes (K229)', TIMEOUT, (t) => {
  const files = { 'php/tests/RoundtripTest.php': 'PASS test_bytes with data set "sqlite"\nPASS test_bytes with data set "mysql"\n' };
  const { findings, ledger } = check(t, feature(files, unit => ({ ...unit, bindings: (unit.bindings ?? []).map(entry => (entry.implementation === 'php' ? { ...entry, id: 'CodecTest::test_bytes' } : entry)) })));
  assert.deepEqual(findings, []);
  assert.deepEqual(ledger.cases.filter(entry => entry.unit === 'roundtrip' && entry.implementation === 'php').map(entry => `${entry.case} ${entry.outcome}`), ['CodecTest::test_bytes pass']);
});

// A unittest method that runs once per database item is reported once per item; its id passes when each report passes (K229).
test('a python feature id reported once per database item passes when each report passes (K229)', TIMEOUT, (t) => {
  const { findings, ledger } = check(t, feature({ 'python/tests/test_roundtrip.py': 'PASS test_bytes\nPASS test_bytes\n' }));
  assert.deepEqual(findings, []);
  assert.deepEqual(ledger.cases.filter(entry => entry.unit === 'roundtrip' && entry.implementation === 'python').map(entry => `${entry.case} ${entry.outcome}`), ['test_bytes pass']);
});

test('a php feature id whose method has a failing data set fails, and the finding names it (K229)', TIMEOUT, (t) => {
  const files = { 'php/tests/RoundtripTest.php': 'PASS test_bytes with data set "sqlite"\nFAIL test_bytes with data set "mysql"\n' };
  const { findings } = check(t, feature(files, unit => ({ ...unit, bindings: (unit.bindings ?? []).map(entry => (entry.implementation === 'php' ? { ...entry, id: 'CodecTest::test_bytes' } : entry)) })));
  assert.deepEqual(keys(findings), ['R3 roundtrip php']);
  assert.match(findingAt(findings, 0).message, /failed: CodecTest::test_bytes/);
});

test('a php feature binding whose Class::method names no test of its file is not executed (K229)', TIMEOUT, (t) => {
  const { findings } = check(t, feature({}, unit => ({ ...unit, bindings: (unit.bindings ?? []).map(entry => (entry.implementation === 'php' ? { ...entry, id: 'OtherTest::test_bytes' } : entry)) })));
  assert.deepEqual(keys(findings), ['R3 roundtrip php']);
  assert.match(findingAt(findings, 0).message, /not executed: OtherTest::test_bytes/);
});

test('a feature run that exits 1 names the failing tests outside its ids, read from its output (K213)', TIMEOUT, (t) => {
  const reported = (change: Change) => {
    const lines: string[] = [];
    checkParity(repository(t, change), { execute: true, env: ENV, say: line => lines.push(line) });
    return lines.filter(line => line.startsWith('roundtrip '));
  };
  // go test runs the top-level test of an id with all its subtests (K214), so a failing sibling subtest of that test is outside the ids.
  assert.ok(reported(feature({ 'go/roundtrip_test.go': 'PASS TestRoundtrip/bytes\nFAIL TestRoundtrip/text\n' })).includes(
    'roundtrip go: exit 1, 1 of 1 ids passed; failed outside the ids: TestRoundtrip/text',
  ));
  // A package that does not build reports no test name, and the line says so.
  assert.ok(reported(feature({ 'go/roundtrip_test.go': 'BUILD ./roundtrip_test.go:1:1: undefined: boom\n' })).some(line => line.startsWith(
    'roundtrip go: exit 1, 0 of 1 ids passed; failed outside the ids: no test name readable from the output; last 20 lines: ',
  ) && line.includes('undefined: boom')));
  // node:test names a failing test with its enclosing suites, and the failing suite is named too, as the parser reads it.
  assert.ok(reported(feature({ 'ts/tests/roundtrip.test.mjs': "import { describe, test } from 'node:test';\ndescribe('roundtrip', () => {\n  test('bytes', () => {});\n  test('text', () => { throw new Error('no'); });\n});\n" })).includes(
    'roundtrip ts: exit 1, 1 of 1 ids passed; failed outside the ids: roundtrip › text, roundtrip',
  ));
});

/** The command of a run that the test knows to be runnable: a RunError fails the test with its sentence (K222 typing). */
function commandOf(run: BindingCommand | RunError, what: string): BindingCommand {
  if ('error' in run) assert.fail(`${what}: ${run.error}`);
  return run;
}

// A go run of a feature file runs only the ids of its bindings, in one alternation; a suite run keeps its symbol (K214).
test('a go feature run names its ids in one -run alternation, and a go suite run keeps its symbol (K214)', TIMEOUT, (t) => {
  const root = repository(t);
  const feature = commandOf(runOf({ name: 'go', runner: 'go' }, root, { test: 'go/roundtrip_test.go', ids: ['TestA', 'TestB/sub', 'TestA/other'] }, 'feature', ENV), 'the go feature run');
  assert.deepEqual(feature.args, ['test', '-json', '-count=1', '-run', '^(TestA|TestB)$', './']);
  const escaped = commandOf(runOf({ name: 'go', runner: 'go' }, root, { test: 'go/roundtrip_test.go', ids: ['TestX.y/z'] }, 'feature', ENV), 'the escaped go feature run');
  assert.deepEqual(escaped.args, ['test', '-json', '-count=1', '-run', '^(TestX\\.y)$', './']);
  const suite = commandOf(runOf({ name: 'go', runner: 'go' }, root, { test: 'go/codec_test.go', symbol: 'TestCodec' }, 'suite', ENV), 'the go suite run');
  assert.deepEqual(suite.args, ['test', '-json', '-count=1', '-run', '^TestCodec$', './']);
});

// A failed run that names no test shows the last 20 lines of its output, so its cause is visible (K215).
test('a failed feature run that names no test prints the last 20 lines of its output (K215)', TIMEOUT, (t) => {
  const lines: string[] = [];
  checkParity(repository(t, feature({ 'go/roundtrip_test.go': Array.from({ length: 25 }, (_, i) => `BUILD ./roundtrip_test.go:${i + 1}:1: boom`).join('\n') + '\n' })), { execute: true, env: ENV, say: line => lines.push(line) });
  const line = known(lines.find(text => text.startsWith('roundtrip go: exit 1')), 'the go feature line');
  assert.match(line, /last 20 lines: .*roundtrip_test\.go:25:1: boom/);
  assert.match(line, /roundtrip_test\.go:11:1: boom/);
  assert.doesNotMatch(line, /roundtrip_test\.go:5:1: boom/);
});

// cargo test of a timed libtest-mimic harness prints the timing after the name and the outcome on the next line, so
// every id that passes is a pass (K215); the stub writes that layout with the line HARNESS timed.
test('a timed cargo run whose every declared id passes counts each one as passed (K215)', TIMEOUT, (t) => {
  const lines: string[] = [];
  const { findings, ledger } = checkParity(repository(t, feature({ 'rust/tests/roundtrip.rs': 'HARNESS timed\nPASS roundtrip::bytes\n' })), { execute: true, env: ENV, say: line => lines.push(line) });
  assert.deepEqual(findings, []);
  assert.deepEqual(ledger.cases.filter(entry => entry.unit === 'roundtrip' && entry.implementation === 'rust').map(entry => `${entry.case} ${entry.outcome}`), ['roundtrip::bytes pass']);
  assert.ok(lines.includes('roundtrip rust: exit 0, 1 of 1 ids passed'));
});

// A suite run counts the declared cases it passed, never a case that the suite does not declare or a repeated one (K215).
test('a suite run counts only the declared cases that passed, so a count never exceeds the declared number (K215)', TIMEOUT, (t) => {
  const lines: string[] = [];
  const { findings } = checkParity(repository(t, { files: { 'ts/tests/codec.mjs': `${NODE_CODEC}test('empty', () => {});\ntest('latin1', () => {});\n` } }), { execute: true, env: ENV, say: line => lines.push(line) });
  const counts = lines.map(line => /^codec ts \(\d of 2\): exit 0, (\d+) of (\d+) cases passed$/.exec(line)).filter(match => match !== null);
  assert.ok(counts.length > 0, lines.join('\n'));
  for (const [, passed, declared] of counts) assert.ok(Number(passed) <= Number(declared), `${passed} passed of ${declared} declared`);
  assert.deepEqual(keys(findings), ['R3 codec ts']);
  assert.match(findingAt(findings, 0).message, /not in the suite: latin1/);
});

// A run that exits 0 without a declared id reports that id as not executed (K215).
test('exit 0 with a declared id absent from the output is a failure that names the id (K215)', TIMEOUT, (t) => {
  const { findings } = check(t, feature({ 'rust/tests/roundtrip.rs': 'PASS roundtrip::other\n' }));
  assert.deepEqual(keys(findings), ['R3 roundtrip rust']);
  assert.match(findingAt(findings, 0).message, /not executed: roundtrip::bytes/);
});

// Cargo builds tests/<name>/main.rs as the test target <name>, and the other files of tests/<name>/ are its modules (K148).
test('a cargo test target of tests/<name>/main.rs runs as --test <name> and its module files belong to its binding (K148)', TIMEOUT, (t) => {
  const { findings, ledger } = check(t, feature({
    'rust/tests/roundtrip.rs': null,
    'rust/tests/roundtrip/main.rs': 'mod vectors;\nPASS roundtrip::bytes\n',
    'rust/tests/roundtrip/vectors.rs': '#[test]\nfn bytes() {}\n',
  }, (unit) => { itemAt(unit.bindings ?? [], 1).test = 'rust/tests/roundtrip/main.rs'; return unit; }));
  assert.deepEqual(findings, []);
  const rust = known(ledger.runs.find(run => run.unit === 'roundtrip' && run.implementation === 'rust'), 'ledger.runs.find(run => run.unit === … && run.implementation === …)');
  assert.deepEqual([rust.command, ...rust.args], ['cargo', 'test', '--manifest-path', 'rust/Cargo.toml', '--test', 'roundtrip', 'roundtrip::bytes', '--', '--test-threads=1', '--exact']);
});

// A binding with command runs that command instead of the runner's default, in the directory of its implementation; the runner
// still reads its output, so the ids that pass count (K216). The go stub is the program of the command, so the command runs.
test('a binding with command runs that command in its implementation directory, and its passing ids count (K216)', TIMEOUT, (t) => {
  const { findings, ledger } = check(t, feature({}, (unit) => {
    itemAt(unit.bindings ?? [], 0).command = ['go', 'test', '-json', '-count=1', '-tags', 'feature', '-run', '^(TestRoundtrip)$', './'];
    return unit;
  }));
  assert.deepEqual(findings, []);
  const go = known(ledger.runs.find(run => run.unit === 'roundtrip' && run.implementation === 'go'), 'the go feature run');
  assert.deepEqual([go.cwd, go.command, ...go.args], ['go', 'go', 'test', '-json', '-count=1', '-tags', 'feature', '-run', '^(TestRoundtrip)$', './']);
  assert.deepEqual(ledger.cases.filter(entry => entry.unit === 'roundtrip' && entry.implementation === 'go').map(entry => `${entry.case} ${entry.outcome}`), ['TestRoundtrip/bytes pass']);
});

// A command that cannot start, or that exits non-zero, is an R3 finding that names the command; the runner's default is never run instead (K216).
test('a binding command that cannot start or exits non-zero is an R3 finding that names it, with no fallback to the default (K216)', TIMEOUT, (t) => {
  const missing = check(t, feature({}, (unit) => {
    itemAt(unit.bindings ?? [], 0).command = ['no-such-parity-command', 'roundtrip'];
    return unit;
  }));
  assert.deepEqual(keys(missing.findings), ['R3 roundtrip go']);
  assert.match(findingAt(missing.findings, 0).message, /^no-such-parity-command roundtrip could not start: /);
  const failing = check(t, feature({}, (unit) => {
    itemAt(unit.bindings ?? [], 0).command = ['sh', '-c', 'echo failing run >&2; exit 3'];
    return unit;
  }));
  assert.deepEqual(keys(failing.findings), ['R3 roundtrip go']);
  assert.match(findingAt(failing.findings, 0).message, /exited with 3: failing run/);
  assert.deepEqual(failing.ledger.runs.filter(run => run.unit === 'roundtrip' && run.implementation === 'go').map(run => run.command), ['sh', 'sh']);
});

// A binding with its own runner runs its test with the program, arguments and output parser of that runner, not those of its
// implementation, and counts for its implementation: the php suite binding here checks its contract in node, so a
// php implementation whose contract a node test checks can bind; a runner without a reason, or a reason without a runner, is a
// declaration finding that names the unit and the implementation.
test('a binding with its own runner and its reason runs with that runner and binds its implementation (K422)', TIMEOUT, (t) => {
  const files = { 'php/tests/size.php': null, 'php/tests/size.test.mjs': "import test from 'node:test';\ntest('small', () => {});\n" };
  const declare = (reason?: string) => (config: Declaration) => {
    Object.assign(binding(config, 'size', 'php'), { test: 'php/tests/size.test.mjs', runner: 'node', ...(reason === undefined ? {} : { reason }) });
    return config;
  };
  const { findings, ledger } = checkParity(repository(t, { files, edit: declare('the php extension checks the contract of its C engine in node') }), { execute: true, env: ENV, say: () => {} });
  assert.deepEqual(findings, []);
  const run = known(ledger.runs.find(entry => entry.unit === 'size' && entry.implementation === 'php'), 'the php run of size');
  assert.deepEqual([run.command, ...run.args], [process.execPath, '--test', `--test-reporter=${path.join(KIT, 'parity-node-reporter.mts')}`, 'php/tests/size.test.mjs']);
  assert.deepEqual(ledger.cases.filter(entry => entry.unit === 'size' && entry.implementation === 'php').map(entry => `${entry.case} ${entry.outcome}`), ['small pass']);
  const missing = check(t, { files, edit: declare() });
  assert.deepEqual(keys(missing.findings), ['declaration size php']);
  const alone = check(t, { edit: (config) => { Object.assign(binding(config, 'size', 'php'), { reason: 'a reason with no runner' }); return config; } });
  assert.deepEqual(keys(alone.findings), ['declaration size php']);
});

// A binding command references the invoking environment as its implementation's values do: ${NAME} is resolved when the runs
// happen, an unset or empty NAME is a finding of that binding's runs and nothing runs, and the reference is printed, not its value (K223).
test('a binding command references the invoking environment as ${NAME}, resolved when the runs happen (K223)', TIMEOUT, (t) => {
  const root = repository(t, feature({}, (unit) => {
    itemAt(unit.bindings ?? [], 0).command = ['go', 'test', '-json', '-count=1', '-tags', '${PARITY_TAG}', '-run', '^(TestRoundtrip)$', './'];
    return unit;
  }));
  const lines: string[] = [];
  const set = checkParity(root, { execute: true, env: { ...ENV, PARITY_TAG: 'feature' }, say: line => lines.push(line) });
  assert.deepEqual(set.findings, []);
  const go = known(set.ledger.runs.find(run => run.unit === 'roundtrip' && run.implementation === 'go'), 'the go feature run');
  assert.deepEqual([go.command, ...go.args], ['go', 'test', '-json', '-count=1', '-tags', 'feature', '-run', '^(TestRoundtrip)$', './']);
  assert.ok(lines.some(line => line.includes('-tags ${PARITY_TAG}')), lines.join('\n'));
  assert.deepEqual(set.ledger.cases.filter(entry => entry.unit === 'roundtrip' && entry.implementation === 'go').map(entry => `${entry.case} ${entry.outcome}`), ['TestRoundtrip/bytes pass']);
  const unset: NodeJS.ProcessEnv = { ...ENV };
  delete unset.PARITY_TAG;
  const missing = checkParity(root, { execute: true, env: unset, say: () => {} });
  assert.deepEqual(keys(missing.findings), ['R3 roundtrip go']);
  assert.equal(findingAt(missing.findings, 0).message, 'cannot start: binding command references ${PARITY_TAG}, which the environment does not set');
  assert.deepEqual(missing.ledger.runs.filter(run => run.unit === 'roundtrip' && run.implementation === 'go'), []);
  const empty = checkParity(root, { execute: true, env: { ...ENV, PARITY_TAG: '' }, say: () => {} });
  assert.deepEqual(keys(empty.findings), ['R3 roundtrip go']);
  assert.equal(findingAt(empty.findings, 0).message, 'cannot start: binding command references ${PARITY_TAG}, which the environment sets to an empty string');
  assert.deepEqual(empty.ledger.runs.filter(run => run.unit === 'roundtrip' && run.implementation === 'go'), []);
});

test('a feature unit fails R2 without a binding and R3 when its id is missing, fails or is not the full native id (K75)', TIMEOUT, (t) => {
  const missing = check(t, feature({ 'python/tests/test_roundtrip.py': null }, (unit) => { unit.bindings?.pop(); return unit; }));
  assert.deepEqual(keys(missing.findings), ['R2 roundtrip python']);
  const { findings } = check(t, feature({ 'rust/tests/roundtrip.rs': 'FAIL roundtrip::bytes\n' }, (unit) => {
    itemAt(unit.bindings ?? [], 0).id = 'TestRoundtrip/binary';
    // node reports the nested test as roundtrip › bytes; its bare name is no id of the run.
    itemAt(unit.bindings ?? [], 2).id = 'bytes';
    return unit;
  }));
  assert.deepEqual(findings.map(finding => `${finding.rule} ${finding.unit} ${finding.implementation} ${finding.place}`), [
    'R3 roundtrip go go/roundtrip_test.go',
    'R3 roundtrip rust rust/tests/roundtrip.rs',
    'R3 roundtrip ts ts/tests/roundtrip.test.mjs',
  ]);
  assert.match(findingAt(findings, 0).message, /not executed: TestRoundtrip\/binary/);
  assert.match(findingAt(findings, 1).message, /failed: roundtrip::bytes/);
  assert.match(findingAt(findings, 2).message, /not executed: bytes/);
});

// One binding per native feature id (K209, K567); a suite or API unit keeps one entry per implementation.
test('R12: a feature unit rejects the same native id even when the second binding names another test file (K209)', TIMEOUT, (t) => {
  const { findings } = check(t, feature({ 'ts/tests/other-roundtrip.test.mjs': "import { test } from 'node:test';\ntest('bytes', () => {});\n" }, (unit) => { unit.bindings?.push({ implementation: 'ts', test: 'ts/tests/other-roundtrip.test.mjs', id: 'roundtrip › bytes' }); return unit; }), { execute: false });
  assert.deepEqual(keys(findings), ['R12 roundtrip ts']);
  assert.equal(findingAt(findings, 0).message, 'unit roundtrip binds ts case roundtrip › bytes twice; keep one binding');
});

test('parity allows one TypeScript feature case per database under a shared native test file (K567)', TIMEOUT, (t) => {
  const source = "import { describe, test } from 'node:test';\ndescribe('transaction_rollback', () => {\n  test('sqlite', () => {});\n  test('mysql', () => {});\n  test('postgres', () => {});\n});\n";
  const { findings, ledger } = check(t, feature({ 'ts/tests/roundtrip.test.mjs': source }, unit => {
    const ts = itemWhere(unit.bindings ?? [], (entry: { implementation: string }) => entry.implementation === 'ts');
    ts.id = 'transaction_rollback › sqlite';
    unit.bindings?.push({ ...ts, id: 'transaction_rollback › mysql' }, { ...ts, id: 'transaction_rollback › postgres' });
    return unit;
  }));
  assert.deepEqual(findings, []);
  assert.deepEqual(ledger.cases.filter(entry => entry.unit === 'roundtrip' && entry.implementation === 'ts').map(entry => `${entry.case} ${entry.outcome}`), [
    'transaction_rollback › sqlite pass',
    'transaction_rollback › mysql pass',
    'transaction_rollback › postgres pass',
  ]);
});

test('parity rejects two bindings of one database-specific native case (K567)', TIMEOUT, (t) => {
  const { findings } = check(t, feature({}, unit => {
    const ts = itemWhere(unit.bindings ?? [], (entry: { implementation: string }) => entry.implementation === 'ts');
    ts.id = 'transaction_rollback › mysql';
    unit.bindings?.push({ ...ts });
    return unit;
  }), { execute: false });
  assert.deepEqual(keys(findings), ['R12 roundtrip ts']);
  assert.equal(findingAt(findings, 0).message, 'unit roundtrip binds ts case transaction_rollback › mysql twice; keep one binding');
});

test('suite and API units still reject duplicate implementation declarations (K567)', TIMEOUT, (t) => {
  const suite = check(t, { edit: config => {
    const unit = itemWhere(config.units, (entry: { id: string }) => entry.id === 'size');
    const go = binding(config, 'size', 'go');
    unit.bindings = [...unit.bindings ?? [], { ...go }];
    return config;
  } }, { execute: false });
  assert.deepEqual(keys(suite.findings), ['R12 size go']);

  const api = check(t, { edit: config => {
    const unit = itemWhere(config.units, (entry: { id: string }) => entry.id === 'encode');
    const ts = itemWhere(unit.symbols ?? [], (entry: { implementation: string }) => entry.implementation === 'ts');
    unit.symbols?.push({ ...ts });
    return config;
  } }, { execute: false });
  assert.deepEqual(keys(api.findings), ['R12 encode ts']);
});

test('a feature binding names its id and no symbol, and a feature unit has no vector file (K75)', TIMEOUT, (t) => {
  const { findings } = check(t, feature({}, (unit) => {
    delete itemAt(unit.bindings ?? [], 0).id;
    itemAt(unit.bindings ?? [], 1).symbol = 'roundtrip';
    unit.file = 'tests/vectors/codec.json';
    return unit;
  }), { execute: false });
  assert.deepEqual(findings.map(finding => `${finding.rule} ${finding.message}`), [
    'declaration unit roundtrip: a unit of kind feature has no file',
    'declaration unit roundtrip: the binding of go needs id, the native test id that its runner reports',
    'declaration unit roundtrip: the binding of rust has symbol, which a feature binding does not take; its id names the test',
  ]);
});

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

test('a vitest test that lies under none of the declared roots is a run error that names the test and the roots (K202)', TIMEOUT, (t) => {
  const root = vitestRepository(t);
  const run = runOf({ name: 'web', runner: 'vitest', roots: ['other'] }, root, { test: 'web/src/codec.spec.ts', symbol: 'codec' }, 'suite', ENV);
  assert.ok('error' in run, 'the run is an error, not a guessed root');
  assert.match(run.error, /web\/src\/codec\.spec\.ts/);
  assert.match(run.error, /\bother\b/);
});

test('the vitest runner reads the JSON report of vitest: a suite case is a top-level test, a feature id the joined titles (K75)', TIMEOUT, (t) => {
  const root = vitestRepository(t);
  const { findings, ledger } = checkParity(root, { execute: true, env: ENV, say: () => {} });
  assert.deepEqual(findings, []);
  assert.deepEqual(ledger.cases.filter(entry => entry.implementation === 'web').map(entry => `${entry.unit} ${entry.case} ${entry.outcome}`), [
    'codec empty pass', 'codec ascii pass', 'roundtrip roundtrip › nested › bytes pass',
  ]);
  const run = known(ledger.runs.find(entry => entry.implementation === 'web'), 'ledger.runs.find(entry => entry.implementation === …)');
  assert.deepEqual([run.command, ...run.args], [process.execPath, path.join(root, 'node_modules/vitest/vitest.mjs'), 'run', '--dir', 'web', '--reporter=json', `--outputFile.json=${path.join(root, 'var/parity/vitest.json')}`, 'web/src/codec.spec.ts']);
  const failing = checkParity(vitestRepository(t, { 'web/src/roundtrip.test.ts': 'TODO roundtrip › nested › bytes\n', 'web/src/codec.spec.ts': 'PASS empty\nFAIL ascii\n' }), { execute: true, env: ENV, say: () => {} }).findings;
  assert.deepEqual(keys(failing), ['R3 codec web', 'R3 roundtrip web']);
  assert.match(findingAt(failing, 0).message, /failed: ascii/);
  assert.match(findingAt(failing, 1).message, /failed: roundtrip › nested › bytes/);
  const missing = checkParity(vitestRepository(t, { 'node_modules/vitest/vitest.mjs': null }), { execute: true, env: ENV, say: () => {} }).findings;
  assert.deepEqual(keys(missing), ['R3 codec web', 'R3 roundtrip web']);
  assert.match(findingAt(missing, 0).message, /node_modules\/vitest\/vitest\.mjs does not exist/);
});

test('vitest discovers the tests of a binding only in the root of its implementation, not through a link under var/ (K202)', TIMEOUT, (t) => {
  const root = vitestRepository(t);
  // A link under var/ to a folder that holds a test of the same path, as the trust records of mise link to the home folder,
  // where an old checkout of the repository may hold one.
  const elsewhere = mkdtempSync(path.join(tmpdir(), 'kit-parity-elsewhere-'));
  t.after(() => rmSync(elsewhere, { recursive: true, force: true }));
  mkdirSync(path.join(elsewhere, 'old/web/src'), { recursive: true });
  writeFileSync(path.join(elsewhere, 'old/web/src/codec.spec.ts'), 'PASS empty\nPASS ascii\n');
  mkdirSync(path.join(root, 'var/tools/mise/state/trusted-configs'), { recursive: true });
  symlinkSync(elsewhere, path.join(root, 'var/tools/mise/state/trusted-configs/home'));
  const { findings, ledger } = checkParity(root, { execute: true, env: ENV, say: () => {} });
  assert.deepEqual(findings, []);
  assert.deepEqual(ledger.cases.filter(entry => entry.implementation === 'web' && entry.unit === 'codec').map(entry => `${entry.case} ${entry.outcome}`), ['empty pass', 'ascii pass']);
});

test('the parity command runs the shims of mise with the environment of mise of the checkout (K306)', TIMEOUT, (t) => {
  const root = repository(t);
  const run = spawnSync(process.execPath, [tool(import.meta.resolve('../../scripts/kit/parity.mts'))], { cwd: root, env: { ...ENV, REQUIRE_MISE: '1' }, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stdout + run.stderr);
});

test('R6: a test that two conventions select lies in a root of one of their runners (K75)', TIMEOUT, (t) => {
  const { findings } = checkParity(vitestRepository(t, { 'tools/extra.test.ts': '', 'web/src/extra.test.ts': 'PASS extra\n' }), { execute: false, env: ENV, say: () => {} });
  assert.deepEqual(findings.map(finding => `${finding.rule} ${finding.implementation ?? '-'} ${finding.place}`), ['R5 web web/src/extra.test.ts', 'R6 - tools/extra.test.ts']);
  assert.match(findingAt(findings, 1).message, /a node or vitest test/);
});

test('R1: an API unit whose symbol an extractor does not give, or that declares none of an implementation, fails (K75)', TIMEOUT, (t) => {
  const { findings } = check(t, {
    files: { 'rust/symbols.txt': 'hex_upper\n' },
    edit: config => {
      const unit = itemWhere(config.units, (entry: { id: string }) => entry.id === 'encode');
      unit.symbols = (unit.symbols ?? []).filter((entry: { implementation: string }) => entry.implementation !== 'python');
      return config;
    },
  });
  // The python symbol that the unit no longer declares is also an undeclared public symbol (R11).
  assert.deepEqual(keys(findings), ['R1 encode rust', 'R1 encode python', 'R11 - rust', 'R11 - python']);
  assert.match(findingAt(findings, 0).message, /codec::encode is no public symbol of rust/);
  assert.match(findingAt(findings, 1).message, /declares no symbol of python/);
  // An extractor that fails is a finding that names it, and the rules of its symbols do not run on a guess.
  const failed = check(t, { files: { 'ts/index.d.ts': TS_API('export declare const encode: (;') } }).findings;
  assert.deepEqual(keys(failed), ['R1 - ts']);
  assert.match(findingAt(failed, 0).message, /the ts extractor of ts\/index\.d\.ts gives no symbols: API Extractor failed/);
  // A check of the declarations runs no extractor, so it judges no symbol.
  assert.deepEqual(check(t, { files: { 'rust/symbols.txt': '' } }, { execute: false }).findings, []);
});

test('the ts extractor reads a declaration of the ES2015+ library, such as ReadonlyMap, from a folder without TypeScript (K129)', TIMEOUT, (t) => {
  // The repository has no node_modules, tsconfig or @types, and the check runs in it, as a consumer runs kit.
  const root = repository(t, { files: { 'ts/index.d.ts': TS_API('export declare const encode: (table?: ReadonlyMap<string, number>) => number;') } });
  const cwd = process.cwd();
  process.chdir(root);
  try {
    const found = checkParity(root, { execute: true, env: ENV, say: () => {} }).findings;
    assert.deepEqual(keys(found), [], found.map(item => item.message).join('\n'));
  } finally {
    process.chdir(cwd);
  }
});

test('an API unit without symbols fails the declaration and names the unit, and one with an empty list is R1 (K107)', TIMEOUT, (t) => {
  const without = check(t, {
    edit: config => {
      delete itemWhere(config.units, (entry: { id: string }) => entry.id === 'encode').symbols;
      return config;
    },
  }, { execute: false });
  assert.deepEqual(keys(without.findings), ['declaration - -']);
  assert.equal(findingAt(without.findings, 0).message, 'unit encode: a unit of kind api needs symbols');
  const empty = check(t, {
    edit: config => {
      itemWhere(config.units, (entry: { id: string }) => entry.id === 'encode').symbols = [];
      return config;
    },
  });
  assert.deepEqual(keys(empty.findings).filter(key => key.startsWith('R1 ')), ['R1 encode go', 'R1 encode rust', 'R1 encode ts', 'R1 encode php', 'R1 encode python']);
});

test('the rust extractor runs the Rust nightly of the exception whose scope holds the crate, and names a missing one (K75)', TIMEOUT, (t) => {
  const exception = (channel: string, scope = '.') => ({ tool: 'rust', channel, scope, reason: 'rustdoc JSON is unstable', retry: 'rustdoc JSON is stable' });
  const messages = (exceptions: unknown[]) => check(t, { files: { 'config/toolchain.json': JSON.stringify({ schema: 1,
    requirements: { pattern: 'CX-[0-9]+' }, exceptions }) } }).findings.map(finding => `${finding.rule} ${finding.implementation}: ${finding.message}`);
  assert.deepEqual(messages([exception('nightly-2026-10-01', 'rust')]), []);
  const [none] = messages([exception('nightly-2026-10-01', 'go')]);
  assert.match(known(none, 'none'), /^R1 rust: the rust extractor of rust\/Cargo\.toml gives no symbols: rustdoc JSON needs a Rust nightly \(rust-lang\/rust#76578\), and config\/toolchain\.json exceptions declares none whose scope holds rust\/Cargo\.toml/);
  const [two] = messages([exception('nightly-2026-10-01'), exception('nightly-2026-09-01', 'rust')]);
  assert.match(known(two, 'two'), /holds 2 Rust nightlies whose scope holds rust\/Cargo\.toml: nightly-2026-10-01, nightly-2026-09-01; keep one/);
  const [uninstalled] = messages([exception('nightly-2026-09-01')]);
  assert.match(known(uninstalled, 'uninstalled'), /cargo \+nightly-2026-09-01 rustdoc .* exited with 1: error: toolchain 'nightly-2026-09-01' is not installed/);
});

test('R2: a suite without a binding of an implementation fails', TIMEOUT, (t) => {
  const { findings } = check(t, {
    files: { 'python/tests/test_codec.py': null },
    edit: config => {
      const unit = itemWhere(config.units, (entry: { id: string }) => entry.id === 'codec');
      unit.bindings = (unit.bindings ?? []).filter((entry: { implementation: string }) => entry.implementation !== 'python');
      return config;
    },
  });
  assert.deepEqual(keys(findings), ['R2 codec python']);
  assert.match(findingAt(findings, 0).message, /tests\/vectors\/codec\.json has no binding of python/);
});

test('an invalid node reporter line fails its bindings and later bindings still run (K691)', TIMEOUT, (t) => {
  const invalidReporter = ['sh', '-c', 'printf "exit 0\\n"'];
  const { findings, ledger } = check(t, {
    files: FEATURE_FILES,
    edit: config => {
      binding(config, 'codec', 'ts').command = invalidReporter;
      const roundtrip = structuredClone(FEATURE) as UnitJson;
      itemWhere(roundtrip.bindings ?? [], (entry: BindingJson) => entry.implementation === 'ts').command = invalidReporter;
      config.units.push(roundtrip);
      return config;
    },
  });
  const invalid = findings.filter(entry => entry.implementation === 'ts' && (entry.unit === 'codec' || entry.unit === 'roundtrip'));
  assert.deepEqual(keys(invalid), ['R3 codec ts', 'R3 roundtrip ts']);
  for (const entry of invalid) {
    assert.match(entry.message, /invalid reporter output in run 1: the parity node reporter wrote a line that is no case: exit 0/);
    assert.match(entry.message, /invalid reporter output in run 2: the parity node reporter wrote a line that is no case: exit 0/);
  }
  assert.ok(ledger.runs.some(run => run.unit === 'codec' && run.implementation === 'php'),
    'the suite continued after the malformed reporter output');
  assert.ok(ledger.runs.some(run => run.unit === 'roundtrip' && run.implementation === 'php'), 'later feature bindings still ran');
  assert.ok(ledger.cases.some(entry => entry.unit === 'codec' && entry.implementation === 'php' && entry.outcome === 'pass'));
});

test('R3: a binding that fails, misses a case, adds a case or exits with an error fails', TIMEOUT, (t) => {
  const { findings, ledger } = check(t, {
    files: {
      'go/codec_test.go': 'PASS TestCodec/empty\nFAIL TestCodec/ascii\nEXIT TestCodec 1\n',
      'ts/tests/codec.mjs': `${NODE_CODEC}test('latin1', () => {});\n`,
      'php/tests/codec.php': 'PASS test_empty\nPASS test_ascii\nEXIT 2\n',
      'python/tests/test_codec.py': 'PASS test_empty\n',
    },
  });
  assert.deepEqual(keys(findings), ['R3 codec go', 'R3 codec ts', 'R3 codec php', 'R3 codec python']);
  assert.match(findingAt(findings, 0).message, /exited with 1/);
  assert.match(findingAt(findings, 0).message, /failed: ascii/);
  assert.match(findingAt(findings, 1).message, /not in the suite: latin1/);
  assert.match(findingAt(findings, 2).message, /exited with 2/);
  assert.match(findingAt(findings, 3).message, /not executed: ascii/);
  assert.ok(ledger.cases.some(entry => entry.implementation === 'go' && entry.case === 'ascii' && entry.outcome === 'fail'));
});

test('R3: a binding whose second run executes other cases or other results than the first fails, naming the cases', TIMEOUT, (t) => {
  // The test counts its runs in var/ (ignored): the first run passes ascii, the second fails it and adds latin1.
  const flaky = [
    "import test from 'node:test';",
    "import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';",
    'let runs = 0;',
    "try { runs = Number(readFileSync('var/ts-runs', 'utf8')); } catch {}",
    "mkdirSync('var', { recursive: true });",
    "writeFileSync('var/ts-runs', String(runs + 1));",
    "test('empty', () => {});",
    "test('ascii', () => { if (runs) throw new Error('flaky'); });",
    "if (runs) test('latin1', () => {});",
  ].join('\n');
  const { findings, ledger } = check(t, { files: { 'ts/tests/codec.mjs': `${flaky}\n` } });
  assert.deepEqual(keys(findings), ['R3 codec ts']);
  assert.equal(findingAt(findings, 0).message, 'the second run differs from the first: exit 0 then 1; ascii pass then fail; latin1 only in the second run');
  assert.deepEqual(ledger.runs.filter(run => run.unit === 'codec' && run.implementation === 'ts').map(run => run.attempt), [1, 2]);
});

test('R3: a binding whose runner cannot start fails, and a check of the declarations runs no binding', TIMEOUT, (t) => {
  const root = repository(t);
  rmSync(path.join(root, 'var/tools/mise/shims/python3'));
  const missing = checkParity(root, { execute: true, env: ENV, say: () => {} }).findings;
  // The python extractor, which the stub implementations use, cannot start either. A tool that the checkout lacks is the finding
  // of its runs, naming the tool and its install, and no error ends the check (K393-2).
  assert.deepEqual(keys(missing), ['R1 - python', 'R3 codec python', 'R3 width python', 'R3 size python']);
  assert.match(findingAt(missing, 0).message, /the python extractor of python\/symbols\.txt gives no symbols: python3 of the checkout is missing .*run make install/);
  assert.match(findingAt(missing, 1).message, /python3 of the checkout is missing .*run make install/);
  // An extractor that install-tools did not build names the declaration and the install.
  const unbuilt = check(t, { files: { 'var/tools/symbols-go/bin/kit-symbols-go': null, 'var/tools/symbols-php/vendor/autoload.php': null } }).findings;
  assert.deepEqual(keys(unbuilt), ['R1 - go', 'R1 - php']);
  assert.match(findingAt(unbuilt, 1).message, /var\/tools\/symbols-php\/vendor\/autoload\.php does not exist; name php in symbolExtractors/);
  assert.match(findingAt(unbuilt, 0).message, /var\/tools\/symbols-go\/bin\/kit-symbols-go does not exist; name go in symbolExtractors of config\/toolchain\.json and run make install-tools/);
  const declarations = checkParity(root, { execute: false, env: ENV, say: () => {} });
  assert.deepEqual(declarations.findings, []);
  assert.deepEqual(declarations.ledger.runs, []);
});

test('R3: a Go package that does not build names the compiler output', TIMEOUT, (t) => {
  const { findings } = check(t, { files: { 'go/codec_test.go': 'BUILD ./codec_test.go:7:2: undefined: undefinedThing\n' } });
  assert.deepEqual(keys(findings), ['R3 codec go', 'R3 width go', 'R3 size go']);
  assert.equal(findingAt(findings, 0).message, 'exited with 1: ./codec_test.go:7:2: undefined: undefinedThing; not executed: empty, ascii');
});

test('a case name that a runner cannot report, and a Go symbol that is no test function, fail the declaration', TIMEOUT, (t) => {
  const messages = (change: Change) => check(t, change, { execute: false }).findings.map(finding => `${finding.rule}: ${finding.message}`);
  assert.deepEqual(messages({ files: { 'tests/vectors/codec.json': JSON.stringify({ vectors: [{ name: 'empty' }, { name: 'two words' }, { name: 'a/b' }] }) } }), [
    'declaration: unit codec: tests/vectors/codec.json: the case "two words" holds whitespace, which no test name of the check can match',
    'declaration: unit codec: tests/vectors/codec.json: the case "a/b" holds /, which Go nests as a subtest; the unit has a go binding',
  ]);
  assert.deepEqual(messages({ files: { 'tests/vectors/width.json': JSON.stringify(['a/b']) }, edit: (config) => { binding(config, 'width', 'go').symbol = 'Width'; return config; } }), [
    'declaration: unit width: the go binding names Width, which is no test function (^Test\\w*$)',
    'declaration: unit width: tests/vectors/width.json: the case "a/b" holds /, which Go nests as a subtest; the unit has a go binding',
  ]);
});

test('R4: a suite file that no unit declares fails', TIMEOUT, (t) => {
  const { findings } = check(t, { files: { 'tests/vectors/events.json': '[]' } }, { execute: false });
  assert.deepEqual(keys(findings), ['R4 - -']);
  assert.equal(findingAt(findings, 0).place, 'tests/vectors/events.json');
});

test('R5: a test file of an implementation that no binding runs fails', TIMEOUT, (t) => {
  const { findings } = check(t, { files: { 'python/tests/test_vector.py': 'PASS codec/empty\n' } }, { execute: false });
  assert.deepEqual(keys(findings), ['R5 - python']);
  assert.equal(findingAt(findings, 0).place, 'python/tests/test_vector.py');
});

test('R5: kit fixes the test files of each runner, and a declaration adds to them but never removes one (K75)', TIMEOUT, (t) => {
  // No implementation declares tests and no testPatterns are declared: the convention of each runner alone selects the files.
  const conventional = (config: Declaration) => {
    for (const entry of config.implementations) if (entry.runner !== 'node' && entry.runner !== 'php') delete entry.tests;
    delete config.testPatterns;
    return config;
  };
  assert.deepEqual(check(t, { edit: conventional }, { execute: false }).findings, []);
  const { findings } = check(t, {
    files: {
      'go/extra_test.go': 'package codec\n',
      'rust/tests/extra.rs': '#[test]\nfn extra() {}\n',
      'rust/src/inline.rs': '#[cfg(test)]\nmod tests {\n    #[test]\n    fn inline() {}\n}\n',
      'ts/src/extra.test.mts': "import test from 'node:test';\n",
      'php/tests/ExtraTest.php': '<?php\n',
      'python/tests/test_extra.py': 'import unittest\n',
      'tools/extra_test.go': 'package tools\n',
    },
    edit: conventional,
  }, { execute: false });
  assert.deepEqual(findings.map(finding => `${finding.rule} ${finding.implementation ?? '-'} ${finding.place}`), [
    'R5 go go/extra_test.go',
    'R5 rust rust/src/inline.rs',
    'R5 rust rust/tests/extra.rs',
    'R5 ts ts/src/extra.test.mts',
    'R5 php php/tests/ExtraTest.php',
    'R5 python python/tests/test_extra.py',
    'R6 - tools/extra_test.go',
  ]);
});

test('R5: a file named like a test that its runner does not run, and that no binding runs, fails (K75)', TIMEOUT, (t) => {
  // A PHP script named *_test.php that imports no PHPUnit is a test that neither the php convention nor a binding runs.
  const { findings } = check(t, {
    files: { 'php/scripts/codec_test.php': '<?php\necho "ok\\n";\n', 'python/codec.spec.py': '', 'go/testdata/test_input.json': '{}' },
  }, { execute: false });
  assert.deepEqual(findings.map(finding => `${finding.rule} ${finding.implementation} ${finding.place}`), [
    'R5 go go/testdata/test_input.json',
    'R5 php php/scripts/codec_test.php',
    'R5 python python/codec.spec.py',
  ]);
  assert.match(findingAt(findings, 1).message, /\*\*\/\*Test\.php/);
  // A support glob takes a file named like a test out of the rule; it holds no test.
  assert.deepEqual(check(t, {
    files: { 'go/testdata/test_input.json': '{}' },
    edit: (config) => { itemAt(config.implementations, 0).support = ['go/testdata/**']; return config; },
  }, { execute: false }).findings, []);
});

test('R5: a Rust file whose only test attribute lies in a comment or a string holds no test; one in code does (K204)', TIMEOUT, (t) => {
  // The doc comment quotes #[tokio::test], the block comment #[test] and the string literal #[test]; only real.rs has one in code.
  const { findings } = check(t, {
    files: {
      'rust/src/doc.rs': '/// ```\n/// #[tokio::test]\n/// async fn quoted() {}\n/// ```\n/* #[test] */\npub const SAMPLE: &str = "#[test]";\npub fn doc() {}\n',
      'rust/src/real.rs': '#[tokio::test]\nasync fn real() {}\n',
    },
  }, { execute: false });
  assert.deepEqual(findings.map(finding => `${finding.rule} ${finding.implementation ?? '-'} ${finding.place}`), ['R5 rust rust/src/real.rs']);
});

test('R6: a binding whose test lies outside the roots of its implementation fails', TIMEOUT, (t) => {
  const { findings } = check(t, {
    files: { 'php/tests/codec.php': null, 'tests/php/codec.php': FILES['php/tests/codec.php'], 'tests/composer.json': '{}\n', 'tests/vendor/bin/phpunit': '' },
    edit: config => { binding(config, 'codec', 'php').test = 'tests/php/codec.php'; return config; },
  });
  assert.deepEqual(keys(findings), ['R6 codec php']);
  assert.match(findingAt(findings, 0).message, /outside php/);
});

/** Adds gonative, a go implementation whose bindings run the go tests of width and size. */
function sharing(config: Declaration, shares: string | undefined): Declaration {
  config.implementations.push({ name: 'gonative', runner: 'go', roots: ['gonative'], symbols: { extractor: 'go', entry: 'gonative' }, ...(shares === undefined ? {} : { shares }) });
  for (const id of ['width', 'size']) {
    itemWhere(config.units, entry => entry.id === id).bindings?.push({ ...binding(config, id, 'go'), implementation: 'gonative' });
  }
  return config;
}

test('R6: a binding of an implementation that shares the tests of another lies in the roots of either (K232)', TIMEOUT, (t) => {
  const placed = (findings: ParityFinding[]) => findings.filter(finding => finding.rule === 'R6').map(finding => `${finding.unit} ${finding.implementation}`);
  // Without shares, the go tests are outside gonative's roots.
  assert.deepEqual(placed(check(t, { files: { 'gonative/doc.go': 'package gonative\n', 'gonative/go.mod': 'module example.com/gonative\n' }, edit: config => sharing(config, undefined) }, { execute: false }).findings), ['width gonative', 'size gonative']);
  // With shares, gonative's bindings may run go's tests, and R5 still judges only gonative's own roots.
  const { findings } = check(t, { files: { 'gonative/doc.go': 'package gonative\n', 'gonative/go.mod': 'module example.com/gonative\n' }, edit: config => sharing(config, 'go') }, { execute: false });
  // The declaration holds, so the rules ran and R6 found the shared roots.
  assert.deepEqual(findings.filter(finding => finding.rule === 'declaration').map(finding => finding.message), []);
  assert.deepEqual(placed(findings), []);
  assert.deepEqual(findings.filter(finding => finding.rule === 'R5' && finding.implementation === 'gonative'), []);
});

test('R6: the tests of the PHP extension are those of packages/php, with no shares declared (K285)', () => {
  const implementations: ParityImplementation[] = [
    { name: 'php', runner: 'php', roots: ['packages/php'] },
    { name: 'php-ext', runner: 'php', roots: ['packages/php-ext'] },
  ];
  const config: ParityConfig = {
    schema: 1, implementations, requirements: { pattern: 'CX-[0-9]+' },
    units: [{ id: 'width', kind: 'feature', requirements: [], bindings: implementations.map(entry => ({ implementation: entry.name, test: 'packages/php/tests/WidthTest.php' })) }],
  };
  const model: ParityModel = { config, implementations: new Map(implementations.map(entry => [entry.name, entry])), cases: new Map(), tests: new Map(), testRunners: new Map(), unitImplementations: new Map() };
  assert.deepEqual(misplacedTests(model, []).map(finding => finding.implementation), []);
});

test('R6: the tests of the PHP extension are those of every PHP library, packages/<component>/php too (K293)', () => {
  const implementations: ParityImplementation[] = [
    { name: 'validator', runner: 'php', roots: ['packages/validator/php'] },
    { name: 'generator', runner: 'php', roots: ['packages/generator/php'] },
    { name: 'php-ext', runner: 'php', roots: ['packages/php-ext'] },
  ];
  const tests = ['packages/validator/php/tests/AT.php', 'packages/generator/php/tests/BT.php'];
  const config: ParityConfig = {
    schema: 1, implementations, requirements: { pattern: 'CX-[0-9]+' },
    units: tests.map((test, index) => ({ id: `unit${index}`, kind: 'feature' as const, requirements: [], bindings: [{ implementation: 'php-ext', test }] })),
  };
  const model: ParityModel = { config, implementations: new Map(implementations.map(entry => [entry.name, entry])), cases: new Map(), tests: new Map(), testRunners: new Map(), unitImplementations: new Map() };
  assert.deepEqual(misplacedTests(model, []).map(finding => finding.implementation), []);
});

test('R6 leaves out a file that an internal glob of any implementation selects (K332)', () => {
  const implementations: ParityImplementation[] = [
    { name: 'ts', runner: 'node', roots: ['packages/ts'] },
    { name: 'php-ext', runner: 'php', roots: ['packages/php-ext'], internal: [{ glob: 'packages/php-ext/tests/engine/*.mjs', reason: 'test: the node-run test of the engine of the extension' }] },
  ];
  const file = 'packages/php-ext/tests/engine/engine.test.mjs';
  const model = (declared: boolean): ParityModel => {
    const list = declared ? implementations : implementations.map(({ internal: _internal, ...entry }) => entry);
    return { config: { schema: 1, implementations: list, requirements: { pattern: 'CX-[0-9]+' }, units: [] }, implementations: new Map(list.map(entry => [entry.name, entry])), cases: new Map(), tests: new Map(), testRunners: new Map([[file, ['node']]]), unitImplementations: new Map() };
  };
  assert.deepEqual(misplacedTests(model(false), [file]).map(finding => finding.place), [file], 'without the declaration the node test outside the node roots is R6');
  assert.deepEqual(misplacedTests(model(true), [file]), []);
});

const INTERNAL = (config: Declaration, glob = 'php/tests/Internal*.php') => {
  const php = config.implementations.find(entry => entry.name === 'php');
  if (php === undefined) throw new Error('the fixture declares php');
  php.internal = [{ glob, reason: 'tests of the private helpers of the PHP package, no behaviour of the contract' }];
  return config;
};

test('an internal test is no parity unit: R5 asks no binding for it, and the same file without the declaration is R5 (K313)', TIMEOUT, (t) => {
  const files = { 'php/tests/Internal.php': 'PASS test_helper\n' };
  const plain = check(t, { files }, { execute: false }).findings;
  assert.deepEqual(keys(plain.filter(item => item.place === 'php/tests/Internal.php')), ['R5 - php']);
  const declared = check(t, { files, edit: INTERNAL }, { execute: false }).findings;
  assert.deepEqual(declared.filter(item => item.place === 'php/tests/Internal.php'), []);
  assert.deepEqual(declared.filter(item => item.rule === 'declaration').map(item => item.message), []);
});

// K342: only a match that docs/spec defines is a requirement named; UTF-8 matches the pattern of requirements and is none.
test('an internal test that mentions UTF-8 names no requirement, and one that names a defined requirement after it still does (K342)', TIMEOUT, (t) => {
  const broad = (config: Declaration) => { config.requirements = { pattern: '[A-Z0-9]+-[0-9]+' }; return INTERNAL(config); };
  const plain = check(t, { files: { 'php/tests/Internal.php': 'PASS test_helper\n// encodes UTF-8 and SHA-256\n' }, edit: broad }, { execute: false }).findings;
  assert.deepEqual(plain.filter(item => item.rule === 'R16'), []);
  const named = check(t, { files: { 'php/tests/Internal.php': 'PASS test_helper\n// UTF-8 then CX-1\n' }, edit: broad }, { execute: false }).findings;
  assert.match(findingAt(named.filter(item => item.rule === 'R16'), 0).message, /names CX-1, a requirement of the spec/);
});

test('an internal test that names a requirement of the spec is R16, and an internal glob that selects no test is a declaration finding (K313)', TIMEOUT, (t) => {
  const named = check(t, { files: { 'php/tests/Internal.php': 'PASS test_helper\n// CX-1\n' }, edit: INTERNAL }, { execute: false }).findings;
  assert.deepEqual(keys(named.filter(item => item.rule === 'R16')), ['R16 - php']);
  assert.match(findingAt(named.filter(item => item.rule === 'R16'), 0).message, /names CX-1, a requirement of the spec/);
  const stale = check(t, { edit: config => INTERNAL(config, 'php/tests/Nothing*.php') }, { execute: false }).findings;
  assert.deepEqual(stale.filter(item => item.rule === 'declaration').map(item => item.message), ['implementation php: the internal glob php/tests/Nothing*.php selects no test file of php']);
});

test('a shares that names itself, no implementation, or another runner is a declaration finding (K232)', TIMEOUT, (t) => {
  const messages = (shares: string) => check(t, { files: { 'gonative/doc.go': 'package gonative\n', 'gonative/go.mod': 'module example.com/gonative\n' }, edit: config => sharing(config, shares) }, { execute: false }).findings
    .filter(finding => finding.rule === 'declaration').map(finding => finding.message);
  assert.deepEqual(messages('gonative'), ['implementation gonative shares its own tests; shares names the implementation whose tests it runs']);
  assert.deepEqual(messages('swift'), ['implementation gonative shares the tests of swift, which is no implementation']);
  assert.deepEqual(messages('php'), ['implementation gonative shares the tests of php, whose runner php is not its runner go']);
});

test('R6: a test of a runner outside the roots of every implementation of that runner and every comparator root fails', TIMEOUT, (t) => {
  const { findings } = check(t, {
    files: {
      'tools/extra_test.go': 'package tools\n',
      'php/tests/codec_test.go': 'package php\n',
      'tests/compare/all_test.go': 'package compare\n',
      'tests/compare/codec.php': FILES['php/tests/codec.php'],
      'tests/composer.json': '{}\n',
      'tests/vendor/bin/phpunit': '',
      'php/tests/codec.php': null,
    },
    edit: (config) => { binding(config, 'codec', 'php').test = 'tests/compare/codec.php'; return config; },
  });
  assert.deepEqual(findings.map(finding => `${finding.rule} ${finding.place}`), ['R6 php/tests/codec_test.go', 'R6 tools/extra_test.go']);
  assert.match(findingAt(findings, 1).message, /a go test outside go, the roots of the go implementations, and outside tests\/compare, the comparator roots/);
});

test('the whole repository is no root, and a declared tests list is not empty', TIMEOUT, (t) => {
  const messages = (change: Change) => check(t, change, { execute: false }).findings.map(finding => `${finding.rule}: ${finding.message}`);
  assert.deepEqual(messages({ edit: (config) => { itemAt(config.implementations, 0).roots = ['.']; config.comparators = ['./']; return config; } }), [
    'declaration: implementation go: the root . is the whole repository; name the directories of the implementation',
    'declaration: comparators: the root ./ is the whole repository; name the directories of the comparators',
  ]);
  assert.deepEqual(messages({ edit: (config) => { itemAt(config.implementations, 0).tests = []; return config; } }), [
    'declaration: config/parity.json: /implementations/0/tests must NOT have fewer than 1 items {"limit":1}',
  ]);
});

test('the schema rejects PYTHONPATH and every path that leaves the repository; a resolved reference may not leave it either (K75)', TIMEOUT, (t) => {
  const places = (edit: (config: Declaration) => Declaration) => check(t, { edit }, { execute: false }).findings.map(finding => `${finding.rule} ${/(?<=^config\/parity\.json: )\/\S*/.exec(finding.message)?.[0]}`);
  const python = (config: Declaration) => itemWhere(config.implementations, (entry: { name: string }) => entry.name === 'python');
  assert.deepEqual(places((config) => { python(config).env = [{ name: 'PYTHONPATH', value: 'python/src' }]; return config; }), ['declaration /implementations/4/env/0/name']);
  assert.deepEqual(places((config) => {
    itemAt(config.implementations, 0).roots = ['go', '../shared'];
    python(config).command = '/usr/bin/python3';
    python(config).args = ['-d', 'extension=../modules/codec.so', '--root=/opt/codec', '~/codec'];
    python(config).env = [{ name: 'CODEC_SOURCE', value: 'python/../../src' }];
    itemAt(config.units, 0).file = '../vectors/codec.json';
    config.comparators = ['/srv/compare'];
    return config;
  }), [
    'declaration /implementations/0/roots/1',
    'declaration /implementations/4/command',
    'declaration /implementations/4/args/1',
    'declaration /implementations/4/args/2',
    'declaration /implementations/4/args/3',
    'declaration /implementations/4/env/0/value',
    'declaration /comparators/0',
    'declaration /units/0/file',
  ]);
  // A path inside the repository, a name on PATH, a version range and a reference stay valid.
  assert.deepEqual(places((config) => { python(config).command = 'python3'; python(config).args = ['-X', 'dev', '--range=1..2', '${PARITY_ARGS}']; return config; }), []);
  const root = repository(t, { edit: (config) => { python(config).command = '${PARITY_VENV}/bin/python'; return config; } });
  const outside = checkParity(root, { execute: true, env: { ...ENV, PARITY_VENV: path.dirname(root) }, say: () => {} }).findings;
  assert.deepEqual(keys(outside), ['R3 codec python', 'R3 width python', 'R3 size python']);
  assert.match(findingAt(outside, 0).message, /cannot start: command/);
  assert.ok(findingAt(outside, 0).message.includes(path.dirname(root)) === false, 'the value of a reference is never printed');
});

test('R7: an implementation whose error codes differ from the catalog, or that declares none, fails', TIMEOUT, (t) => {
  const { findings } = check(t, {
    files: { 'python/codes.py': 'CONFIG = "CONFIG"\nEXTRA = "EXTRA"\n' },
    edit: config => { delete itemWhere(config.implementations, (entry: { name: string }) => entry.name === 'php').errors; return config; },
  }, { execute: false });
  assert.deepEqual(keys(findings), ['R7 - php', 'R7 - python']);
  assert.match(findingAt(findings, 0).message, /declares no error codes/);
  assert.match(findingAt(findings, 1).message, /missing CODEC_DECODE/);
  assert.match(findingAt(findings, 1).message, /not in the catalog: EXTRA/);
});

test('the catalog pattern reads every line of the catalog that is not blank or a comment, and reads at least one code', TIMEOUT, (t) => {
  const messages = (change: Change) => check(t, change, { execute: false }).findings.map(finding => `${finding.rule} ${finding.place}: ${finding.message}`);
  assert.deepEqual(messages({ files: { 'docs/errors.yaml': '# The codes.\n\n- code: CONFIG # a missing secret\n- code: CODEC_DECODE\n' } }), [
    'declaration docs/errors.yaml:3: the catalog pattern ^- code: (\\w+)$ does not read the line "- code: CONFIG # a missing secret"; write a pattern that reads every line of the catalog',
  ]);
  assert.deepEqual(messages({ files: { 'docs/errors.yaml': '# The codes.\n// none yet\n' } }), [
    'declaration docs/errors.yaml: the catalog pattern ^- code: (\\w+)$ reads no code',
  ]);
  assert.deepEqual(messages({ files: { 'python/codes.py': '# generated\n' } }), [
    'declaration python/codes.py: the pattern ^\\w+ = "(\\w+)"$ of python reads no code',
  ]);
  assert.deepEqual(messages({
    files: { 'docs/errors.yaml': 'codes:\n  - code: CONFIG\n    meaning: a missing secret\n  - code: CODEC_DECODE\n' },
    edit: (config) => { config.errors.catalog.pattern = '^  - code: (\\w+)$|^codes:$|^    \\w+: .*$'; return config; },
  }), [], 'a line that the pattern matches without its group holds no code');
});

test('R9: a language list of another file that differs from the implementations fails', TIMEOUT, (t) => {
  const { findings } = check(t, { files: { 'tools/languages.mjs': "export const LANGUAGES = ['go', 'rust', 'ts', 'php'];\n" } }, { execute: false });
  assert.deepEqual(keys(findings), ['R9 - -']);
  assert.match(findingAt(findings, 0).message, /missing python/);
  assert.equal(findingAt(findings, 0).place, 'tools/languages.mjs:1');
});

test('R10: a document that counts or lists the implementations unlike the implementations fails', TIMEOUT, (t) => {
  const { findings } = check(t, {
    files: {
      'docs/index.md': '# Codec\n\nFour languages share the codec.\nGo, PHP, Rust, and TS share one contract.\n',
      'docs/index.ko.md': '# Codec\n\n네 언어가 codec을 공유한다.\n',
    },
  }, { execute: false });
  assert.deepEqual(findings.map(finding => `${finding.rule} ${finding.place}`), ['R10 docs/index.ko.md:3', 'R10 docs/index.md:3', 'R10 docs/index.md:4']);
  assert.match(findingAt(findings, 1).message, /Four languages/);
  assert.match(findingAt(findings, 2).message, /go, php, rust, ts/);
});

test('R10: a count or a list is judged against every implementation, read from the prose of a Markdown passage', TIMEOUT, (t) => {
  // Each paragraph, and the findings that it gives: `count` or `list`, at its first line or at the line after @.
  const paragraphs: [string, string[]][] = [
    ['The codec has one language.', ['count']],
    ['Both implementations, Go and Rust, compile ahead of time.', ['count']],
    ['Both implementations, Go and PHP, compile ahead of time.', ['count']],
    ['The four-language check runs the vectors.', ['count']],
    ['Three languages share the planner: Go, Rust and TS.', ['count', 'list']],
    ['Five languages share the codec: Go, Rust, TS, PHP and Python.', []],
    ['Go `x`, PHP `y`, Rust `z`, and TS `w` share one contract.', ['list']],
    ['Go, PHP, Rust and TS share the contract. Python is planned.', ['list']],
    ['Go, PHP, Rust and TS share the contract (see `python/src`).', ['list']],
    ['Go, PHP, Rust and TS share it, as [the guide](https://x/python/guide) and <https://x/python> say.', ['list']],
    ['> Go, PHP, Rust\n> and TS share the contract.', ['list']],
    ['Python\n------\nGo, PHP, Rust and TS share the contract.', ['list@3']],
    ['Go, PHP, Rust and TS share the contract.\n<!-- python --> <span title="python">x</span>', ['list']],
    ['```markdown\n~~~\n```\nGo, PHP,\nRust and TS share the contract.', ['list@4']],
    ['Go, Rust and TS generate the methods; PHP and Python resolve them.', []],
    ['| Go, PHP, Rust and TS | shared |\n|---|---|\n| Python | planned |', ['list']],
    // A link destination is no prose, also one with parentheses (K130).
    ['See [the guide](https://example.com/a_(b)/go/php/rust/ts).', []],
    ['1. Go, PHP,\n   Rust and TS share it.\n2. Python reads it.', ['list']],
    ['#5 names Go, PHP, Rust and TS\n# Python', ['list']],
    ['    Go, PHP, Rust and TS share it in an indented code block.', []],
  ];
  const lines = ['# Codec', ''];
  const expected: string[] = [];
  for (const [text, kinds] of paragraphs) {
    for (const kind of kinds) {
      const [name, offset] = kind.split('@');
      expected.push(`R10 docs/index.md:${lines.length + Number(offset ?? 1)} ${name}`);
    }
    lines.push(...text.split('\n'), '');
  }
  const { findings } = check(t, {
    files: {
      'docs/index.md': lines.join('\n'),
      'docs/index.ko.md': '# Codec\n\n다섯 언어가 codec을 공유한다: Go, Rust, TS, PHP와 Python.\n\n검사를 한 언어에서 실행한다.\n\norm은 6개 언어로 배포된다.\n\ncodec은 다섯 개 언어로 구현된다.\n\n세 가지 언어가 planner를 공유한다.\n',
    },
    edit: (config) => { config.documents.nouns.push('language'); return config; },
  }, { execute: false });
  const kind = (finding: ParityFinding) => (finding.message.startsWith('the list') ? 'list' : 'count');
  assert.deepEqual(findings.map(finding => `${finding.rule} ${finding.place} ${kind(finding)}`), [
    'R10 docs/index.ko.md:5 count', 'R10 docs/index.ko.md:7 count', 'R10 docs/index.ko.md:11 count', ...expected,
  ]);
  const message = (place: string) => findings.filter(finding => finding.place === place).map(finding => finding.message);
  assert.deepEqual(message(`docs/index.md:${3 + 2 * 4}`), [
    '"Three languages" counts 3, and there are 5 implementations (the implementations: go, rust, ts, php, python)',
    'the list go, rust, ts is in a sentence that names go, rust, ts, which is not every implementation (the implementations: go, rust, ts, php, python)',
  ]);
});

// The sentences of Korean documents of a consumer that R10 misread (K197): a number after a distributive word counts per item, and a run
// of names with another item of its enumeration on both sides lists those items, such as toolchains.
test('R10: a distributive count and a run of names inside a list of other items are no count and no list of implementations (K197)', TIMEOUT, (t) => {
  const { findings } = check(t, {
    files: {
      'docs/index.md': [
        '# Codec', '',
        'The Go module, the Rust crate and the PHP package are each one implementation.', '',
        'The recipes pin Node.js, npm, Go, Rust, PHP and Composer.', '',
        'Go and Rust are one implementation.', '',
        'For example, Go, Rust and PHP implementations, which share it.', '',
        'Go, Rust, PHP, Composer and npm share it.', '',
      ].join('\n'),
      'docs/index.ko.md': [
        '# Codec', '',
        'Go module, Rust crate, PHP package, Python package도 각각 한 구현이다.', '',
        'recipe의 Node.js, npm, Go, Rust, PHP minor version, Composer가 이 파일과 다르면 실패한다.', '',
        'Go, Rust와 PHP 구현이 codec을 공유한다.', '',
      ].join('\n'),
    },
    edit: (config) => { config.documents.nouns.push('implementation', '구현'); return config; },
  }, { execute: false });
  const kind = (finding: ParityFinding) => (finding.message.startsWith('the list') ? 'list' : 'count');
  assert.deepEqual(findings.map(finding => `${finding.rule} ${finding.place} ${kind(finding)}`), [
    'R10 docs/index.ko.md:7 list', 'R10 docs/index.md:7 count', 'R10 docs/index.md:9 list', 'R10 docs/index.md:11 list',
  ]);
});

// K311: a prose number followed by a noun of the implementations states a count only when it counts implementations.
test('R10: a noun that modifies a compound and the pair of a comparison are no count of implementations (K311)', TIMEOUT, (t) => {
  const { findings } = check(t, {
    files: {
      'docs/index.md': [
        '# Codec', '',
        'The tests run against one language service.', '',
        'The checker fails when code blocks differ between the two languages.', '',
        'The three languages implement it.', '',
      ].join('\n'),
    },
    edit: (config) => { config.documents.nouns.push('language', 'languages'); return config; },
  }, { execute: false });
  assert.deepEqual(findings.filter(finding => finding.rule === 'R10').map(finding => `${finding.place} ${finding.message.split('"')[1]}`), ['docs/index.md:7 three languages']);
});

test('R10: a bullet list of one implementation per item is one list, and a declared prose name is its implementation (K43)', TIMEOUT, (t) => {
  const prose = (config: Declaration) => { itemWhere(config.implementations, (entry: { name: string }) => entry.name === 'ts').prose = ['TypeScript', 'Node package']; return config; };
  const { findings } = check(t, {
    files: {
      'docs/index.md': [
        '# Codec', '',
        '- Go', '- PHP', '- Rust', '- TypeScript', '',
        'The five:', '',
        '- Go', '- Rust', '- TS', '- PHP', '- Python', '',
        'Paragraph.', '',
        '* Go and Rust compile.', '* PHP reads.', '* TS runs.', '',
        'The Node package, Go, PHP and Rust share one contract.', '',
        'Five languages share the codec: Go, Rust, TypeScript, PHP and Python.', '',
      ].join('\n'),
    },
    edit: prose,
  }, { execute: false });
  assert.deepEqual(findings.map(finding => `${finding.rule} ${finding.place}: ${finding.message}`), [
    'R10 docs/index.md:3: the Markdown list go, php, rust, ts names one implementation per item, which is not every implementation (the implementations: go, rust, ts, php, python)',
    'R10 docs/index.md:22: the list ts, go, php, rust is in a sentence that names ts, go, php, rust, which is not every implementation (the implementations: go, rust, ts, php, python)',
  ]);
  const messages = (edit: (config: Declaration) => Declaration) => check(t, { edit }, { execute: false }).findings.map(finding => `${finding.rule}: ${finding.message}`);
  assert.deepEqual(messages((config) => { itemAt(prose(config).implementations, 0).prose = ['typescript']; return config; }), [
    'declaration: implementation go: the prose name typescript is also a name of ts',
    'declaration: implementation ts: the prose name TypeScript is also a name of go',
  ]);
  assert.deepEqual(messages((config) => { itemAt(config.implementations, 0).prose = ['Rust']; return config; }), [
    'declaration: implementation go: the prose name Rust is also a name of rust',
  ]);
  assert.deepEqual(messages((config) => { itemAt(config.implementations, 0).prose = [' Go']; return config; }).length, 1);
  // A prose name is declared once: a repeated one breaks the schema.
  assert.deepEqual(messages((config) => { itemAt(config.implementations, 0).prose = ['Golang', 'Golang']; return config; }), [
    'declaration: config/parity.json: /implementations/0/prose must NOT have duplicate items (items ## 1 and 0 are identical) {"i":0,"j":1}',
  ]);
});

test('R11: a public symbol that no API unit declares fails (K75)', TIMEOUT, (t) => {
  const { findings } = check(t, {
    files: {
      'ts/index.d.ts': TS_API('export declare const encode: () => number;', 'export declare function orderedJsonOutput(): string;'),
      'rust/symbols.txt': 'encode\n',
    },
  });
  assert.deepEqual(findings.map(finding => `${finding.rule} ${finding.implementation}: ${finding.message}`), [
    'R11 ts: codec-ts!orderedJsonOutput:function(1) is public, and no API unit declares it',
  ]);
});

// K307-1: a leak that the php or python extractor reports is an R17 finding that names the public symbol and the internal one.
test('R17: a public signature that names an internal symbol fails, in each extractor that reports leaks (K307-1)', TIMEOUT, (t) => {
  const { findings } = check(t, {
    files: {
      'php/symbols.txt': 'LEAK A\\\\Child::take names the internal A\\\\Hidden\n',
      'python/symbols.txt': 'LEAK pkg.build names the private _Hidden\n',
    },
  });
  assert.deepEqual(findings.filter(finding => finding.rule === 'R17').map(finding => `${finding.implementation}: ${finding.message}`), [
    'php: A\\\\Child::take names the internal A\\\\Hidden: a public signature, parent or interface names a symbol that is no public API',
    'python: pkg.build names the private _Hidden: a public signature, parent or interface names a symbol that is no public API',
  ]);
});

// K336: an implementation is a source root with the manifest of its ecosystem; test globs alone do not make one.
test('an implementation with no manifest of its ecosystem below its roots, or with the roots of another, is a declaration finding (K336)', TIMEOUT, (t) => {
  const messages = (edit: (config: Declaration) => Declaration, files: Record<string, string | null> = {}) => check(t, { files, edit }, { execute: false }).findings.filter(item => item.rule === 'declaration').map(item => item.message);
  assert.deepEqual(messages(config => config), []);
  const engine = (config: Declaration) => {
    config.implementations.push({ name: 'php-engine', runner: 'php', roots: ['php/tests/engine'], tests: ['php/tests/engine/*.php'] });
    return config;
  };
  assert.deepEqual(messages(engine, { 'php/tests/engine/a.php': 'PASS x\n' }).filter(message => message.startsWith('implementation ')), ['implementation php-engine: no root of php/tests/engine holds a composer.json; an implementation is a source root with the manifest of its ecosystem, never only test globs']);
  const twin = (config: Declaration) => {
    config.implementations.push({ name: 'php-twin', runner: 'php', roots: ['php'], tests: ['php/tests/twin/*.php'] });
    return config;
  };
  assert.match(messages(twin, { 'php/tests/twin/a.php': 'PASS x\n' }).join('\n'), /implementation php-twin: it has the roots of php; two implementations of one package only split its tests/);
});

test('K276: free-form profiles, nativeOnly and exclusions fail; only a provenance-backed owner scope may narrow a feature', TIMEOUT, (t) => {
  const { findings } = check(t, { edit: (config) => { config.profiles = [{ name: 'all', implementations: ['go'] }]; config.nativeOnly = []; config.exclusions = []; return config; } }, { execute: false });
  assert.deepEqual(findings.map(finding => `${finding.rule}: ${finding.message}`), [
    'declaration: config/parity.json: / must NOT have additional properties {"additionalProperty":"profiles"}',
    'declaration: config/parity.json: / must NOT have additional properties {"additionalProperty":"nativeOnly"}',
    'declaration: config/parity.json: / must NOT have additional properties {"additionalProperty":"exclusions"}',
  ]);
});

test('K276-1: a suite that declares admit fails the schema, since every implementation runs every case', TIMEOUT, (t) => {
  const { findings } = check(t, { edit: (config) => { itemWhere(config.units, (unit: { id: string }) => unit.id === 'codec').admit = 'kinds'; return config; } }, { execute: false });
  assert.deepEqual(findings.map(finding => `${finding.rule}: ${finding.message}`), [
    'declaration: config/parity.json: /units/0 must NOT have additional properties {"additionalProperty":"admit"}',
  ]);
});

test('K566: a feature owner scope derives its implementation from a declared coverage part and runs its native case', TIMEOUT, (t) => {
  const files = {
    'docs/spec/owner-scope.md': '# Native ownership\n\n- **RX-1** Go exposes its rollback fault through its test-only entry point.\n',
    'contracts/features.json': JSON.stringify({ features: [{ id: 'roundtrip', parity: ['go-native-roundtrip'], tests: ['go/roundtrip_test.go'], coverage: { owners: { go: { part: 'go', tests: ['go/roundtrip_test.go'] } } } }] }),
    'go/roundtrip_test.go': `${FEATURE_FILES['go/roundtrip_test.go']}\n// RX-1\n`,
  };
  const change: Change = {
    files,
    edit: config => {
      config.requirements.pattern = '(?:CX-[0-9]+|RX-[0-9]+)';
      config.units.push({
        id: 'go-native-roundtrip', kind: 'feature', requirements: ['RX-1'], owner: { kind: 'coverage-part', feature: 'roundtrip', part: 'owner/go' },
        bindings: [{ implementation: 'go', test: 'go/roundtrip_test.go', id: 'TestRoundtrip/bytes' }],
      });
      return config;
    },
  };
  const noRequirementTrace = check(t, { ...change, files: { ...files, 'go/roundtrip_test.go': FEATURE_FILES['go/roundtrip_test.go'] } }, { execute: false });
  assert.ok(noRequirementTrace.findings.some(finding => finding.rule === 'R15' && finding.unit === 'go-native-roundtrip' && finding.implementation === 'go' && finding.requirements?.includes('RX-1')));
  const root = repository(t, change);
  const { findings, ledger } = checkParity(root, { execute: true, env: ENV, say: () => {}, units: ['go-native-roundtrip'] });
  assert.deepEqual(findings, []);
  assert.deepEqual(ledger.runs.map(run => `${run.implementation} ${run.attempt} ${run.status}`), ['go 1 0', 'go 2 0']);
});

test('K566 rejects component scope for a shared SQL requirement and an unowned coverage part', TIMEOUT, (t) => {
  const files = {
    'docs/spec/owner-scope.md': '# Native ownership\n\n- **RX-2** Every client executes SQL using its declared dialect.\n',
    'contracts/features.json': JSON.stringify({ features: [{ id: 'roundtrip', parity: ['go-native-roundtrip'], tests: ['go/roundtrip_test.go'], coverage: { owners: { go: { part: 'go', tests: ['go/roundtrip_test.go'] } } } }] }),
    'go/roundtrip_test.go': `${FEATURE_FILES['go/roundtrip_test.go']}\n// RX-2\n`,
  };
  const makeChange = (owner: Entry): Change => ({
    files,
    edit: config => {
      config.requirements.pattern = '(?:CX-[0-9]+|RX-[0-9]+)';
      config.units.push({ id: 'go-native-roundtrip', kind: 'feature', requirements: ['RX-2'], owner, bindings: [{ implementation: 'go', test: 'go/roundtrip_test.go', id: 'TestRoundtrip/bytes' }] });
      return config;
    },
  });
  const shared = check(t, makeChange({ kind: 'coverage-part', feature: 'roundtrip', part: 'owner/go' }), { execute: false });
  assert.ok(shared.findings.some(finding => finding.rule === 'declaration' && finding.message.includes('requirement RX-2 does not name its owner go')));
  const nonSubject = check(t, { ...makeChange({ kind: 'coverage-part', feature: 'roundtrip', part: 'owner/go' }), files: {
    ...files,
    'docs/spec/owner-scope.md': '# Native ownership\n\n- **RX-2** Rollback fault handling exposes SQL errors through the native entry point.\n',
  } }, { execute: false });
  assert.ok(nonSubject.findings.some(finding => finding.rule === 'declaration' && finding.message.includes('requirement RX-2 does not name its owner go')));
  const unknownPart = check(t, makeChange({ kind: 'coverage-part', feature: 'missing', part: 'owner/go' }), { execute: false });
  assert.ok(unknownPart.findings.some(finding => finding.rule === 'declaration' && finding.message.includes('feature missing does not exist in contracts/features.json')));
  const absentOwner = check(t, makeChange({ kind: 'coverage-part', feature: 'roundtrip', part: 'owner/rust' }), { execute: false });
  assert.ok(absentOwner.findings.some(finding => finding.rule === 'declaration' && finding.message.includes('does not name a coverage owner in contracts/features.json')));
  const unlistedTest = check(t, { ...makeChange({ kind: 'coverage-part', feature: 'roundtrip', part: 'owner/go' }), edit: config => {
    config.requirements.pattern = '(?:CX-[0-9]+|RX-[0-9]+)';
    config.units.push({ id: 'go-native-roundtrip', kind: 'feature', requirements: ['RX-2'], owner: { kind: 'coverage-part', feature: 'roundtrip', part: 'owner/go' }, bindings: [{ implementation: 'go', test: 'go/unlisted_test.go', id: 'TestRoundtrip/bytes' }] });
    return config;
  } }, { execute: false });
  assert.ok(unlistedTest.findings.some(finding => finding.rule === 'declaration' && finding.message.includes('does not exist')));
  assert.ok(unlistedTest.findings.some(finding => finding.rule === 'declaration' && finding.message.includes('does not declare each bound test in its feature tests')));
});

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

test('K650: a coverage part may contain one implementation’s multiple roots', TIMEOUT, (t) => {
  const result = check(t, coveragePartChange('go', 'go/orm/roundtrip_test.go'), { execute: false });
  assert.deepEqual(result.findings, []);
});

test('K650: a coverage part spanning implementations or excluding its bound test is rejected', TIMEOUT, (t) => {
  const ambiguous = check(t, coveragePartChange('go', 'go/orm/roundtrip_test.go', true), { execute: false });
  assert.ok(ambiguous.findings.some(finding => finding.rule === 'declaration' && finding.message.includes('resolves to 2 implementation roots')));
  const outside = check(t, coveragePartChange('go/orm', 'go/engine/roundtrip_test.go'), { execute: false });
  assert.ok(outside.findings.some(finding => finding.rule === 'declaration' && finding.message.includes('does not contain every bound test')));
});

test('K635 resolves an explicit multi-owner feature without narrowing it to every implementation', TIMEOUT, (t) => {
  const phpExt = { name: 'php-extension', prose: ['PHP extension'], runner: 'php', roots: ['php-ext'], tests: ['php-ext/tests/*.php'], symbols: { extractor: 'php', entry: 'php-ext' }, errors: { file: 'php-ext/src/Code.php', pattern: "^    const \\w+ = '(\\w+)';$" }, shares: 'php' };
  const files = {
    'php/composer.json': '{}\n',
    'php-ext/composer.json': '{}\n',
    'php-ext/symbols.txt': 'php-ext/src/Codec.php::Codec::encode\n',
    'php-ext/src/Code.php': "<?php\n    const CONFIG = 'CONFIG';\n    const CODEC_DECODE = 'CODEC_DECODE';\n",
    'python/pyproject.toml': '[project]\nname = "example"\n',
    'php/tests/SessionTest.php': 'PASS test_session\n// RX-6\n',
    'php-ext/tests/SessionNativeTest.php': 'PASS test_session_native\n// RX-6\n',
    'python/tests/test_session.py': 'PASS test_session\n# RX-6\n',
    'docs/index.md': '# Codec\n\nSix implementations share the codec: Go, Rust, TS, PHP, PHP extension and Python.\n',
    'docs/index.ko.md': '# Codec\n\n여섯 구현이 codec을 공유한다: Go, Rust, TS, PHP, PHP extension과 Python.\n',
    'tools/languages.mjs': "export const LANGUAGES = ['go', 'rust', 'ts', 'php', 'python', 'php-extension'];\n",
    'docs/spec/owner-scope.md': '# Session setup\n\n- **RX-6** The PHP and Python clients apply their declared session initialization before the first query.\n',
    'contracts/features.json': JSON.stringify({ features: [{
      id: 'session-initialization',
      parity: ['session-initialization'],
      tests: ['php/tests/SessionTest.php', 'php-ext/tests/SessionNativeTest.php', 'python/tests/test_session.py'],
      coverage: { owners: {
        php: { part: 'php', tests: ['php/tests/SessionTest.php'] },
        'php-extension': { part: 'php-ext', tests: ['php-ext/tests/SessionNativeTest.php'] },
        python: { part: 'python', tests: ['python/tests/test_session.py'] },
      } },
    }] }),
  };
  const change: Change = {
    files,
    edit: config => {
      config.requirements.pattern = '(?:CX-[0-9]+|RX-[0-9]+)';
      config.implementations.push(phpExt);
      for (const unit of config.units.filter(item => item.kind === 'suite')) {
        const phpBinding = unit.bindings?.find(binding => binding.implementation === 'php');
        if (phpBinding) unit.bindings?.push({ ...phpBinding, implementation: 'php-extension' });
      }
      const encode = config.units.find(unit => unit.kind === 'api' && unit.id === 'encode');
      assert.ok(encode?.symbols);
      encode.symbols.push({ implementation: 'php-extension', symbol: 'php-ext/src/Codec.php::Codec::encode' });
      config.units.push({
        id: 'session-initialization',
        kind: 'feature',
        requirements: ['RX-6'],
        owner: { kind: 'coverage-parts', feature: 'session-initialization', parts: ['owner/php', 'owner/php-extension', 'owner/python'] },
        bindings: [
          { implementation: 'php', test: 'php/tests/SessionTest.php', id: 'test_session' },
          { implementation: 'php-extension', test: 'php-ext/tests/SessionNativeTest.php', id: 'test_session_native' },
          { implementation: 'python', test: 'python/tests/test_session.py', id: 'test_session' },
        ],
      });
      return config;
    },
  };
  const { findings } = check(t, change, { execute: false });
  assert.deepEqual(findings, []);
  const sharedRequirement = check(t, { ...change, files: {
    ...files,
    'docs/spec/owner-scope.md': '# Session setup\n\n- **RX-6** Every client applies declared session initialization before the first query.\n',
  } }, { execute: false }).findings;
  assert.ok(sharedRequirement.some(finding => finding.message.includes('requirement RX-6 does not name or share owner')));
});

test('K635 rejects empty, duplicate, unknown and unbound members of a multi-owner scope', TIMEOUT, (t) => {
  const base: Change = {
    files: {
      'contracts/features.json': JSON.stringify({ features: [{ id: 'roundtrip', parity: ['roundtrip'], tests: ['go/roundtrip_test.go', 'python-extra/tests/test_roundtrip.py'], coverage: { owners: {
        go: { part: 'go', tests: ['go/roundtrip_test.go'] },
        'python-extra': { part: 'python-extra', tests: ['python-extra/tests/test_roundtrip.py'] },
      } } }] }),
      'docs/spec/owner-scope.md': '# Native ownership\n\n- **RX-7** Go exposes its rollback fault through its test-only entry point.\n',
      'python-extra/pyproject.toml': '[project]\nname = "extra"\n',
      'python-extra/tests/test_roundtrip.py': 'PASS test_roundtrip\n# RX-7\n',
    },
    edit: config => {
      config.requirements.pattern = '(?:CX-[0-9]+|RX-[0-9]+)';
      config.units.push({ id: 'roundtrip', kind: 'feature', requirements: ['RX-7'], owner: { kind: 'coverage-parts', feature: 'roundtrip', parts: ['owner/go'] }, bindings: [{ implementation: 'go', test: 'go/roundtrip_test.go', id: 'TestRoundtrip/bytes' }] });
      return config;
    },
  };
  const findings = (parts: string[]) => check(t, { ...base, edit: config => {
    base.edit?.(config);
    const unit = config.units.at(-1);
    assert.ok(unit);
    unit.owner = { kind: 'coverage-parts', feature: 'roundtrip', parts };
    return config;
  } }, { execute: false }).findings;
  assert.ok(findings([]).some(finding => finding.rule === 'declaration'));
  assert.ok(findings(['owner/go', 'owner/missing']).some(finding => finding.message.includes('does not name a coverage owner')));
  assert.ok(findings(['owner/go', 'owner/go']).some(finding => finding.rule === 'declaration'));
  const missingBinding = check(t, { ...base, edit: config => {
    config.requirements.pattern = '(?:CX-[0-9]+|RX-[0-9]+)';
    config.implementations.push({ name: 'python-extra', runner: 'python', roots: ['python-extra'], tests: ['python-extra/tests/*.py'] });
    config.units.push({ id: 'roundtrip', kind: 'feature', requirements: ['RX-7'], owner: { kind: 'coverage-parts', feature: 'roundtrip', parts: ['owner/go', 'owner/python-extra'] }, bindings: [{ implementation: 'go', test: 'go/roundtrip_test.go', id: 'TestRoundtrip/bytes' }] });
    return config;
  } }, { execute: false }).findings;
  assert.ok(missingBinding.some(finding => finding.message.includes('has no native binding')));
  const unrelatedOwner = check(t, { ...base, edit: config => {
    config.requirements.pattern = '(?:CX-[0-9]+|RX-[0-9]+)';
    config.implementations.push({ name: 'python-extra', runner: 'python', roots: ['python-extra'], tests: ['python-extra/tests/*.py'] });
    config.units.push({ id: 'roundtrip', kind: 'feature', requirements: ['RX-7'], owner: { kind: 'coverage-parts', feature: 'roundtrip', parts: ['owner/go', 'owner/python-extra'] }, bindings: [
      { implementation: 'go', test: 'go/roundtrip_test.go', id: 'TestRoundtrip/bytes' },
      { implementation: 'python-extra', test: 'python-extra/tests/test_roundtrip.py', id: 'test_roundtrip' },
    ] });
    return config;
  } }, { execute: false }).findings;
  assert.ok(unrelatedOwner.some(finding => finding.message.includes('does not name or share owner python-extra')));
});

test('K566: a release-package owner resolves its implementation from config/release.json', TIMEOUT, (t) => {
  const files = {
    'docs/spec/owner-scope.md': '# Native package\n\n- **RX-3** The codec-ts package exports its client declarations at its package root.\n',
    'config/release.json': JSON.stringify({ packages: [{ name: 'codec-ts', directory: 'ts' }] }),
    'ts/tests/roundtrip.test.mjs': `import { test } from 'node:test';\ntest('native', () => {});\n// RX-3\n`,
  };
  const change: Change = {
    files,
    edit: config => {
      config.requirements.pattern = '(?:CX-[0-9]+|RX-[0-9]+)';
      config.units.push({ id: 'ts-native-entry', kind: 'feature', requirements: ['RX-3'], owner: { kind: 'release-package', artifact: 'archive', package: 'codec-ts' }, bindings: [{ implementation: 'ts', test: 'ts/tests/roundtrip.test.mjs', id: 'native' }] });
      return config;
    },
  };
  const { findings, ledger } = check(t, change);
  assert.deepEqual(findings, []);
  assert.deepEqual(ledger.runs.filter(run => run.unit === 'ts-native-entry').map(run => `${run.implementation} ${run.attempt} ${run.status}`), ['ts 1 0', 'ts 2 0']);
  const mismatched = check(t, { ...change, files: { ...files, 'config/release.json': JSON.stringify({ packages: [{ name: 'codec-ts', directory: 'php' }] }) } }, { execute: false });
  assert.ok(mismatched.findings.some(finding => finding.rule === 'declaration' && finding.message.includes('binds an implementation other than php')));
  const unknownPackage = check(t, { ...change, edit: config => {
    config.requirements.pattern = '(?:CX-[0-9]+|RX-[0-9]+)';
    config.units.push({ id: 'ts-native-entry', kind: 'feature', requirements: ['RX-3'], owner: { kind: 'release-package', artifact: 'archive', package: 'missing-package' }, bindings: [{ implementation: 'ts', test: 'ts/tests/roundtrip.test.mjs', id: 'native' }] });
    return config;
  } }, { execute: false });
  assert.ok(unknownPackage.findings.some(finding => finding.rule === 'declaration' && finding.message.includes('missing-package with artifact archive resolves to 0')));
  const implementationNameOnly = check(t, { ...change, files: {
    ...files,
    'docs/spec/owner-scope.md': '# Native package\n\n- **RX-3** TypeScript exports its client declarations at its package root.\n',
  } }, { execute: false });
  assert.ok(implementationNameOnly.findings.some(finding => finding.rule === 'declaration' && finding.message.includes('requirement RX-3 does not name its owner ts')));
  const extraOwnerOverride = check(t, { ...change, edit: config => {
    config.requirements.pattern = '(?:CX-[0-9]+|RX-[0-9]+)';
    config.units.push({ id: 'ts-native-entry', kind: 'feature', requirements: ['RX-3'], owner: { kind: 'release-package', artifact: 'archive', package: 'codec-ts', implementations: ['ts'] }, bindings: [{ implementation: 'ts', test: 'ts/tests/roundtrip.test.mjs', id: 'native' }] });
    return config;
  } }, { execute: false });
  assert.ok(extraOwnerOverride.findings.some(finding => finding.rule === 'declaration' && finding.message.includes('additionalProperty')));
});

test('K566: release owners resolve Go modules and Rust git-tag crates from their declared artifacts', TIMEOUT, (t) => {
  const files = {
    'docs/spec/owner-scope.md': '# Native package owners\n\n- **RX-4** The example/go package exports its ORM client from its module path.\n- **RX-5** The example-rust package exposes its ORM client from its crate root.\n',
    'config/release.json': JSON.stringify({ packages: [], goModules: { go: 'example/go' }, proof: { gitTag: { 'rust/Cargo.toml': { kind: 'rust', name: 'example-rust', smoke: ['cargo', 'check'] } } } }),
    'go/go.mod': 'module example/go\n',
    'go/orm/roundtrip_test.go': 'package orm\nfunc TestRoundtrip(t *testing.T) {}\n// RX-4\n',
    'rust/Cargo.toml': '[package]\nname = "example-rust"\n',
    'rust/tests/roundtrip.rs': '#[test]\nfn roundtrip() {}\n// RX-5\n',
  };
  const { findings } = check(t, { files, edit: config => {
    config.requirements.pattern = '(?:CX-[0-9]+|RX-[0-9]+)';
    config.units.push(
      { id: 'go-native-package', kind: 'feature', requirements: ['RX-4'], owner: { kind: 'release-package', artifact: 'go-module', package: 'example/go' }, bindings: [{ implementation: 'go', test: 'go/orm/roundtrip_test.go', id: 'TestRoundtrip' }] },
      { id: 'rust-native-package', kind: 'feature', requirements: ['RX-5'], owner: { kind: 'release-package', artifact: 'git-tag', package: 'example-rust' }, bindings: [{ implementation: 'rust', test: 'rust/tests/roundtrip.rs', id: 'roundtrip' }] },
    );
    return config;
  } }, { execute: false });
  assert.deepEqual(findings, []);
  const crossArtifactSameName = check(t, { files: { ...files, 'config/release.json': JSON.stringify({ packages: [{ name: 'example-rust', directory: 'python' }], goModules: { go: 'example/go' }, proof: { gitTag: { 'rust/Cargo.toml': { name: 'example-rust' } } } }) }, edit: config => {
    config.requirements.pattern = '(?:CX-[0-9]+|RX-[0-9]+)';
    config.units.push(
      { id: 'go-native-package', kind: 'feature', requirements: ['RX-4'], owner: { kind: 'release-package', artifact: 'go-module', package: 'example/go' }, bindings: [{ implementation: 'go', test: 'go/orm/roundtrip_test.go', id: 'TestRoundtrip' }] },
      { id: 'rust-native-package', kind: 'feature', requirements: ['RX-5'], owner: { kind: 'release-package', artifact: 'git-tag', package: 'example-rust' }, bindings: [{ implementation: 'rust', test: 'rust/tests/roundtrip.rs', id: 'roundtrip' }] },
    );
    return config;
  } }, { execute: false });
  assert.deepEqual(crossArtifactSameName.findings, []);
});

test('a declaration that breaks its schema fails, and no rule runs on it', TIMEOUT, (t) => {
  const { findings } = check(t, { edit: (config) => { config.extra = true; itemAt(config.units, 0).kind = 'vector'; return config; } });
  assert.deepEqual(findings.map(finding => `${finding.rule}: ${finding.message}`), [
    'declaration: config/parity.json: / must NOT have additional properties {"additionalProperty":"extra"}',
    'declaration: config/parity.json: /units/0/kind must be equal to one of the allowed values {"allowedValues":["suite","feature","api"]}, value "vector"',
  ]);
});

test('a declaration that names what does not exist or holds a stale entry fails, and no rule runs on it', TIMEOUT, (t) => {
  const { findings, ledger } = check(t, {
    files: { 'tests/vectors/width.json': JSON.stringify(['narrow', 'narrow']) },
    edit: (config) => {
      itemAt(config.units, 0).bindings?.push({ implementation: 'swift', test: 'php/tests/codec.php' });
      binding(config, 'codec', 'php').test = 'php/tests/missing.php';
      delete binding(config, 'codec', 'go').symbol;
      itemAt(config.languageLists, 0).pattern = 'LANGUAGES = [^\\]]*';
      return config;
    },
  });
  const messages = findings.map(finding => `${finding.rule}: ${finding.message}`);
  assert.ok(findings.every(finding => finding.rule === 'declaration'), messages.join('\n'));
  assert.deepEqual(ledger.runs, []);
  for (const expected of [
    /unit codec names swift, which is no implementation/,
    /the test php\/tests\/missing\.php of php does not exist/,
    /the binding of go needs symbol/,
    /languageLists tools\/languages\.mjs: the pattern LANGUAGES = \[\^\\\]\]\* has no group/,
    /tests\/vectors\/width\.json repeats the case narrow/,
  ]) assert.ok(messages.some(message => expected.test(message)), `${expected} in\n${messages.join('\n')}`);
});

test('make parity-check and parity-declarations-check pass without a finding; parity.mts exits 1 on one', TIMEOUT, (t) => {
  const root = repository(t);
  // A full parity-check runs only in CI (ci-only.mts), so the run is marked as one.
  const make = (target: string) => spawnSync('make', ['--no-print-directory', ...KIT_MAKE, target], { cwd: root, env: { ...ENV, GITHUB_ACTIONS: 'true' }, encoding: 'utf8' });
  const passed = make('parity-check');
  assert.equal(passed.status, 0, passed.stdout + passed.stderr);
  assert.match(passed.stdout, /\[parity\] run codec go \(1 of 2\): go test -json -count=1 -run \^TestCodec\$ \.\//);
  assert.match(passed.stdout, /\[parity\] every applicable unit holds/);
  writeFileSync(path.join(root, 'python/tests/test_codec.py'), 'PASS test_empty\n# CX-1\n');
  assert.equal(make('parity-declarations-check').status, 0, 'the declarations do not run the bindings');
  assert.notEqual(make('parity-check').status, 0);
  const failed = spawnSync(process.execPath, [tool(import.meta.resolve('../../scripts/kit/parity.mts'))], { cwd: root, env: ENV, encoding: 'utf8' });
  assert.equal(failed.status, 1, failed.stdout + failed.stderr);
  assert.match(failed.stderr, /\[parity\] R3 not-executed codec python python\/tests\/test_codec\.py: .*not executed: ascii/);
  assert.match(failed.stderr, /\[parity\] 1 findings/);
});

test('--unit runs only the named unit through the runner of a full run, and reports its outcome (K221)', TIMEOUT, (t) => {
  const root = repository(t, { files: { 'python/tests/test_codec.py': 'PASS test_empty\n' } });
  const run = (...args: string[]) => spawnSync(process.execPath, [tool(import.meta.resolve('../../scripts/kit/parity.mts')), ...args], { cwd: root, env: ENV, encoding: 'utf8' });
  const only = run('--unit', 'codec');
  const viaMake = spawnSync('make', ['--no-print-directory', ...KIT_MAKE, 'parity-check', 'UNITS=codec'], { cwd: root, env: ENV, encoding: 'utf8' });
  assert.notEqual(viaMake.status, 0, viaMake.stdout + viaMake.stderr);
  assert.match(viaMake.stdout, /\[parity\] run codec go \(1 of 2\)/);
  assert.doesNotMatch(viaMake.stdout, /run width /);
  assert.equal(only.status, 1, only.stdout + only.stderr);
  assert.match(only.stdout, /\[parity\] run codec go \(1 of 2\): go test -json -count=1 -run \^TestCodec\$ \.\//);
  assert.doesNotMatch(only.stdout, /run width /);
  assert.match(only.stdout, /\[parity\] codec python \(1 of 2\): exit 0, 1 of 2 cases passed/);
  assert.match(only.stderr, /\[parity\] R3 not-executed codec python python\/tests\/test_codec\.py: .*not executed: ascii/);
  assert.match(only.stdout, /\[parity\] --unit codec: only their bindings \(R3\) run; the cross-unit rules \(R1, R2, R4 to R11\) need every unit and do not run/);
  assert.match(only.stderr, /\[parity\] 1 findings/);
});

test('--unit with an id that no unit of the declaration holds is an error that names the id, and runs nothing (K221)', TIMEOUT, (t) => {
  const root = repository(t);
  const unknown = spawnSync(process.execPath, [tool(import.meta.resolve('../../scripts/kit/parity.mts')), '--unit', 'codec', '--unit', 'nope'], { cwd: root, env: ENV, encoding: 'utf8' });
  assert.notEqual(unknown.status, 0, unknown.stdout + unknown.stderr);
  assert.match(unknown.stderr, /--unit nope names no unit of config\/parity\.json/);
  assert.doesNotMatch(unknown.stdout, /\[parity\] run /);
});

// K400: a row that fixes the declarations of its units verifies them alone, while the units of other rows still have findings.
test('parity-declarations-check UNITS reports the findings of the named units and of config/parity.json only (K400)', TIMEOUT, (t) => {
  const root = repository(t, { edit: config => {
    itemWhere(config.units, (entry: { id: string }) => entry.id === 'width').requirements = ['CX-9'];
    return config;
  } });
  const declarations = (units?: string[]) => checkParity(root, { execute: false, env: ENV, say: () => {}, units }).findings;
  const width = declarations().filter(item => item.unit === 'width');
  assert.ok(width.length > 0, keys(declarations()).join('\n'));
  assert.deepEqual(keys(declarations(['width'])), keys(width), 'the findings of width, the unit still failing');
  assert.deepEqual(declarations(['codec']), [], 'codec, the unit fixed, has no finding of its own');
  const make = (directory: string, units: string) => spawnSync('make', ['--no-print-directory', ...KIT_MAKE, 'parity-declarations-check', `UNITS=${units}`], { cwd: directory, env: ENV, encoding: 'utf8' });
  const fixed = make(root, 'codec');
  assert.equal(fixed.status, 0, fixed.stdout + fixed.stderr);
  const failing = make(root, 'width');
  assert.notEqual(failing.status, 0, failing.stdout + failing.stderr);
  assert.match(failing.stderr, /\[parity\] R14 unknown-requirement width: cites CX-9/);
  assert.doesNotMatch(failing.stderr, / codec[ :]/);
  // A finding of config/parity.json itself counts with any units: a binding named twice in size fails the check of codec.
  const twice = repository(t, { edit: config => {
    const size = itemWhere(config.units, (entry: { id: string }) => entry.id === 'size');
    size.bindings = [...size.bindings ?? [], binding(config, 'size', 'go')];
    return config;
  } });
  const declaration = make(twice, 'codec');
  assert.notEqual(declaration.status, 0, declaration.stdout + declaration.stderr);
  assert.match(declaration.stderr, /R12 .* size go config\/parity\.json: .*names go twice/);
});

// K400-1: a schema finding of another unit does not fail the check of a valid unit, whose rules run without it (K517), and the schema
// finding of the named unit still counts.
test('parity-declarations-check UNITS scopes the schema findings of config/parity.json to the named units (K400-1)', TIMEOUT, (t) => {
  const root = repository(t, { edit: config => {
    const width = itemWhere(config.units, (entry: { id: string }) => entry.id === 'width');
    delete width.requirements;
    return config;
  } });
  const lines: string[] = [];
  const declarations = (units?: string[]) => checkParity(root, { execute: false, env: ENV, say: line => lines.push(line), units }).findings;
  assert.deepEqual(declarations(['codec']), [], 'codec holds, and the schema finding of width is another unit');
  assert.ok(lines.some(line => /^width breaks the schema of config\/parity\.json and is left out; the rules run on the other units$/.test(line)), lines.join('\n'));
  const scopedWidth = declarations(['width']);
  assert.equal(scopedWidth.length, 1, keys(scopedWidth).join('\n'));
  assert.match(scopedWidth[0]?.message ?? '', /^config\/parity\.json: \/units\/1 must have required property 'requirements'/);
  assert.match(declarations()[0]?.message ?? '', /^config\/parity\.json: \/units\/1 must have required property 'requirements'/, 'unscoped, the schema finding counts');
  assert.deepEqual(declarations(['nope']).map(item => item.message), ['--unit nope names no unit of config/parity.json'], 'an unknown unit is still a finding');
  const make = (units: string) => spawnSync('make', ['--no-print-directory', ...KIT_MAKE, 'parity-declarations-check', `UNITS=${units}`], { cwd: root, env: ENV, encoding: 'utf8' });
  const valid = make('codec');
  assert.equal(valid.status, 0, valid.stdout + valid.stderr);
  assert.match(valid.stdout, /\[parity\] width breaks the schema of config\/parity\.json and is left out; the rules run on the other units/);
  const broken = make('width');
  assert.notEqual(broken.status, 0, broken.stdout + broken.stderr);
  assert.match(broken.stderr, /\[parity\] declaration declaration config\/parity\.json: config\/parity\.json: \/units\/1 must have required property 'requirements'/);
  const unknown = make('nope');
  assert.notEqual(unknown.status, 0, unknown.stdout + unknown.stderr);
  assert.match(unknown.stderr, /--unit nope names no unit of config\/parity\.json/);
});

// K414: a row whose fact is a rule of the documents verifies it while the findings of other rules still exist.
test('parity-declarations-check RULES reports the findings of the named rules only (K414)', TIMEOUT, (t) => {
  const root = repository(t, {
    edit: config => {
      itemWhere(config.units, (entry: { id: string }) => entry.id === 'width').requirements = ['CX-9'];
      return config;
    },
    files: { 'docs/spec/tooling.md': '# Tooling\n\nThe tooling runs the checks; it defines no requirement.\n' },
  });
  const declarations = (rules?: string[]) => checkParity(root, { execute: false, env: ENV, say: () => {}, rules }).findings;
  const all = keys(declarations());
  assert.ok(all.some(line => line.startsWith('R14 ')) && all.some(line => line.startsWith('R19 ')), all.join('\n'));
  const unknownRequirement = keys(declarations(['R14']));
  assert.ok(unknownRequirement.length > 0 && unknownRequirement.every(line => line.startsWith('R14 ')), unknownRequirement.join('\n'));
  assert.deepEqual(keys(declarations(['unknown-requirement'])), unknownRequirement, 'the rule named by its id and by its name give the same findings');
  assert.deepEqual(keys(declarations(['R19'])), all.filter(line => line.startsWith('R19 ')), 'only the findings of R19');
  assert.deepEqual(keys(declarations(['R10'])), [], 'R10 holds, so it has no finding');
  assert.deepEqual(keys(declarations(['nope'])), ['declaration - -'], 'a rule that is no rule of the check is a finding of its own');
  const make = (rules: string) => spawnSync('make', ['--no-print-directory', ...KIT_MAKE, 'parity-declarations-check', `RULES=${rules}`], { cwd: root, env: ENV, encoding: 'utf8' });
  const only = make('R14');
  assert.notEqual(only.status, 0, only.stdout + only.stderr);
  assert.match(only.stderr, /\[parity\] R14 unknown-requirement width: cites CX-9/);
  assert.doesNotMatch(only.stderr, /R19 /);
  const holds = make('R10');
  assert.equal(holds.status, 0, holds.stdout + holds.stderr);
  const unknown = make('nope');
  assert.notEqual(unknown.status, 0, unknown.stdout + unknown.stderr);
  assert.match(unknown.stderr, /--rule nope names no rule of the parity check/);
});

// K414-1: a row that moves the citation of one requirement verifies it with IDS alone, while the findings of the other ids remain.
test('parity-declarations-check IDS reports only the findings that name the requested requirements (K414-1)', TIMEOUT, (t) => {
  const spec = '# Codec\n\n- **CX-1** The codec encodes every vector.\n- **CX-2** The codec passes the conformance suite.\n- **CX-3** Every implementation holds the width tables.\n';
  // Before: the width unit cites CX-2 and CX-3 but binds only Go, so CX-2 selects both its R2 and R15 findings.
  const before = repository(t, {
    files: { 'docs/spec/codec.md': spec },
    edit: config => {
      const width = itemWhere(config.units, (entry: { id: string }) => entry.id === 'width');
      const go = binding(config, 'width', 'go');
      width.requirements = ['CX-2', 'CX-3'];
      width.bindings = [go];
      return config;
    },
  });
  // After: the citation of CX-2 moves from the width unit to the conformance unit, whose test names it.
  const after = repository(t, {
    files: {
      'docs/spec/codec.md': spec,
      'tests/vectors/conformance.json': JSON.stringify(['case']),
      'go/conformance_test.go': 'PASS TestConformance/case\n// CX-2\n',
      'rust/tests/conformance.rs': 'PASS conformance::case\n// CX-2\n',
      'ts/tests/conformance.test.mjs': "import { test } from 'node:test';\ntest('case', () => {});\n// CX-2\n",
      'php/tests/ConformanceTest.php': 'PASS test_conformance\n// CX-2\n',
      'python/tests/test_conformance.py': 'PASS test_conformance\n# CX-2\n',
    },
    edit: config => {
      const width = itemWhere(config.units, (entry: { id: string }) => entry.id === 'width');
      const go = binding(config, 'width', 'go');
      width.requirements = ['CX-3'];
      width.bindings = [go];
      config.units.push({ id: 'conformance', kind: 'suite', requirements: ['CX-2'], file: 'tests/vectors/conformance.json', cases: '$[*]', bindings: [
        { implementation: 'go', test: 'go/conformance_test.go', symbol: 'TestConformance' },
        { implementation: 'rust', test: 'rust/tests/conformance.rs', symbol: 'conformance' },
        { implementation: 'ts', test: 'ts/tests/conformance.test.mjs' },
        { implementation: 'php', test: 'php/tests/ConformanceTest.php' },
        { implementation: 'python', test: 'python/tests/test_conformance.py' },
      ] });
      return config;
    },
  });
  const run = (root: string, ids?: string[], rules?: string[]) => checkParity(root, { execute: false, env: ENV, say: () => {}, ids, rules }).findings;
  assert.deepEqual(run(before).filter(item => item.rule === 'R15').map(item => item.requirements), [['CX-2'], ['CX-3']], 'one R15 finding per id');
  assert.deepEqual(keys(run(before, ['CX-2'])), ['R2 width rust', 'R2 width ts', 'R2 width php', 'R2 width python', 'R15 width go'], 'R2 missing bindings also name the unit requirements');
  assert.deepEqual(keys(run(before, ['CX-2'], ['R15'])), ['R15 width go'], 'with RULES R15 the same');
  assert.deepEqual(keys(run(after, ['CX-2'])), [], 'the citation of CX-2 moved to a unit whose test names it: no finding');
  assert.deepEqual(keys(run(after)).filter(line => line.startsWith('R15 ')), ['R15 width go'], 'unscoped, the R15 finding of CX-3 remains');
  const misspelt = run(after, ['CX-9']);
  assert.deepEqual(keys(misspelt), ['declaration - -'], 'an id that no unit cites is a finding of its own');
  assert.match(misspelt[0]?.message ?? '', /--id CX-9 names no requirement that a unit of config\/parity\.json cites/);
  const make = (directory: string, ids: string) => spawnSync('make', ['--no-print-directory', ...KIT_MAKE, 'parity-declarations-check', `IDS=${ids}`], { cwd: directory, env: ENV, encoding: 'utf8' });
  const failing = make(before, 'CX-2');
  assert.notEqual(failing.status, 0, failing.stdout + failing.stderr);
  assert.match(failing.stderr, /\[parity\] R15 unnamed-requirement width go: cites CX-2, which its test go\/width_test\.go does not name/);
  const fixed = make(after, 'CX-2');
  assert.equal(fixed.status, 0, fixed.stdout + fixed.stderr);
});

test('K638 requirement and rule filters retain R2 bindings of the cited unit', TIMEOUT, (t) => {
  const root = repository(t, {
    files: {
      'docs/spec/codec.md': '# Codec\n\n- **CX-1** The codec encodes every vector.\n- **CX-2** The codec passes the conformance suite.\n- **CX-3** Every implementation holds the width tables.\n',
    },
    edit: config => {
      const width = itemWhere(config.units, (entry: { id: string }) => entry.id === 'width');
      width.requirements = ['CX-2'];
      width.bindings = [binding(config, 'width', 'go')];
      return config;
    },
  });
  const selected = checkParity(root, { execute: false, env: ENV, say: () => {}, ids: ['CX-2'], rules: ['R2'] });
  assert.deepEqual(selected.findings.filter(item => item.rule === 'R2').map(item => `${item.unit} ${item.implementation} ${item.requirements?.join(',')}`), [
    'width rust CX-2', 'width ts CX-2', 'width php CX-2', 'width python CX-2',
  ]);
  assert.deepEqual(keys(checkParity(root, { execute: false, env: ENV, say: () => {}, ids: ['CX-1'], rules: ['R2'] }).findings), []);
  assert.deepEqual(keys(checkParity(root, { execute: false, env: ENV, say: () => {}, units: ['width'], rules: ['R2'] }).findings), [
    'R2 width rust', 'R2 width ts', 'R2 width php', 'R2 width python',
  ]);
  const cli = spawnSync('make', ['--no-print-directory', ...KIT_MAKE, 'parity-declarations-check', 'IDS=CX-2', 'RULES=R2'], { cwd: root, env: ENV, encoding: 'utf8' });
  assert.notEqual(cli.status, 0, cli.stdout + cli.stderr);
  assert.match(cli.stderr, /\[parity\] R2 missing-binding width rust/);
});

// K337: a document of docs/spec that defines no requirement is a finding that names it; the fixture's own spec document defines CX-1.
test('a document of docs/spec that defines no requirement is a finding that names it (K337)', TIMEOUT, (t) => {
  const root = repository(t, { files: { 'docs/spec/tooling.md': '# Tooling\n\nThe tooling runs the checks; it defines no requirement.\n' } });
  const { findings } = checkParity(root, { execute: false, env: ENV, say: () => {} });
  assert.deepEqual(keys(findings), ['R19 - -']);
  assert.equal(findings[0]?.place, 'docs/spec/tooling.md');
});

test('K33 reads the TeamCity messages of a PHPUnit run through the php runner: a class is a group, a method a case (K47)', TIMEOUT, (t) => {
  // The messages of PHPUnit 11 for a class with a passing and a failing test method, as the php runner reads them.
  const teamcity = [
    "##teamcity[testSuiteStarted name='CodecTest' locationHint='php_qn://php/tests/codec.php::\\\\CodecTest' nodeId='1' parentNodeId='0']",
    "##teamcity[testStarted name='test_empty' locationHint='php_qn://php/tests/codec.php::\\\\CodecTest::test_empty' nodeId='2' parentNodeId='1']",
    "##teamcity[testFinished name='test_empty' duration='1' nodeId='2' parentNodeId='1']",
    "##teamcity[testStarted name='test_ascii' locationHint='php_qn://php/tests/codec.php::\\\\CodecTest::test_ascii' nodeId='3' parentNodeId='1']",
    "##teamcity[testFailed name='test_ascii' message='Failed asserting that false is true.' details='php/tests/codec.php:9' nodeId='3' parentNodeId='1']",
    "##teamcity[testFinished name='test_ascii' duration='2' nodeId='3' parentNodeId='1']",
    "##teamcity[testSuiteFinished name='CodecTest' nodeId='1' parentNodeId='0']",
    'EXIT 1',
  ].join('\n');
  const { findings, ledger } = check(t, { files: { 'php/tests/codec.php': `${teamcity}\n` } });
  assert.deepEqual(keys(findings), ['R3 codec php']);
  assert.equal(findingAt(findings, 0).message, 'exited with 1; failed: ascii');
  assert.deepEqual(ledger.cases.filter(entry => entry.unit === 'codec' && entry.implementation === 'php').map(entry => `${entry.case} ${entry.outcome}`), ['empty pass', 'ascii fail']);
});

test('R3 reads each case of a cargo binding whose harness libtest-mimic pads the test names (K136)', TIMEOUT, (t) => {
  const { findings, ledger } = check(t, { files: { 'rust/src/lib.rs': 'HARNESS libtest-mimic\nPASS width::tests::vectors::narrow\nPASS width::tests::vectors::wide\n' } });
  assert.deepEqual(findings, []);
  assert.deepEqual(ledger.cases.filter(entry => entry.unit === 'width' && entry.implementation === 'rust').map(entry => `${entry.case} ${entry.outcome}`), ['narrow pass', 'wide pass']);
});

test('a php suite binding with the symbol <class>::<method> runs that method alone, and each data set is a case (K137)', TIMEOUT, (t) => {
  const tests = 'PASS testCodec with data set "empty"\nFAIL testCodec with data set "ascii"\nPASS testCodecExtra with data set "empty"\nPASS testOther\nEXIT 1\n';
  const edit = (config: Declaration) => { binding(config, 'codec', 'php').symbol = 'CodecTest::testCodec'; return config; };
  const root = repository(t, { files: { 'php/tests/codec.php': tests }, edit });
  const { findings, ledger } = checkParity(root, { execute: true, env: ENV, say: () => {} });
  assert.deepEqual(keys(findings), ['R3 codec php']);
  assert.equal(findingAt(findings, 0).message, 'exited with 1; failed: ascii');
  assert.deepEqual(ledger.cases.filter(entry => entry.unit === 'codec' && entry.implementation === 'php').map(entry => `${entry.case} ${entry.outcome}`), ['empty pass', 'ascii fail']);
  const run = known(ledger.runs.find(entry => entry.unit === 'codec' && entry.implementation === 'php'), 'ledger.runs.find(entry => entry.unit === … && entry.implementation === …)');
  assert.deepEqual([run.command, ...run.args], ['php', 'php/vendor/bin/phpunit', '--teamcity', '--no-configuration', '--filter', '/^CodecTest::testCodec(?: with data set |$)/', 'php/tests/codec.php']);
  // A namespaced class is escaped for the regular expression; an integer key of a data set is a case that no suite declares.
  const namespaced = runOf({ name: 'php', runner: 'php' }, root, { test: 'php/tests/codec.php', symbol: 'Example\\Tests\\CodecTest::testCodec' }, 'suite', ENV);
  if (namespaced.error) throw new Error(namespaced.error);
  assert.equal(namespaced.args.at(-2), '/^Example\\\\Tests\\\\CodecTest::testCodec(?: with data set |$)/');
  assert.deepEqual(['testCodec with data set "a/b"', 'testCodec with data set #0', 'testCodec', 'testCodecExtra with data set "a"'].map(name => namespaced.caseOf({ id: name, name })), ['a/b', '#0', undefined, undefined]);
  const declared = (symbol: string) => check(t, { edit: (config) => { binding(config, 'codec', 'php').symbol = symbol; return config; } }, { execute: false }).findings.map(finding => `${finding.rule}: ${finding.message}`);
  assert.deepEqual(declared('testCodec'), ['declaration: unit codec: the php binding names testCodec, which is no test method <class>::<method> of a fully qualified class']);
  assert.deepEqual(declared('\\Example\\CodecTest::testCodec'), ['declaration: unit codec: the php binding names \\Example\\CodecTest::testCodec, which is no test method <class>::<method> of a fully qualified class']);
});

test('R3: a case that one run reports twice fails, and the finding names the case (K47)', TIMEOUT, (t) => {
  const { findings } = check(t, { files: { 'go/codec_test.go': 'PASS TestCodec/empty\nPASS TestCodec/empty\nPASS TestCodec/ascii\n' } });
  assert.deepEqual(keys(findings), ['R3 codec go']);
  assert.equal(findingAt(findings, 0).message, 'reported twice in run 1: empty; reported twice in run 2: empty');
});

test('the PHPUnit run names the configuration of its package, phpunit.xml or phpunit.xml.dist, or none (K47)', TIMEOUT, (t) => {
  const args = (files: Record<string, string>) => {
    const run = runOf({ name: 'php', runner: 'php' }, repository(t, { files }), { test: 'php/tests/codec.php' }, 'suite', ENV);
    if (run.error) throw new Error(`the php binding cannot start: ${run.error}`);
    return run.args;
  };
  assert.deepEqual(args({}), ['php/vendor/bin/phpunit', '--teamcity', '--no-configuration', 'php/tests/codec.php']);
  assert.deepEqual(args({ 'php/phpunit.xml': '<phpunit/>\n' }), ['php/vendor/bin/phpunit', '--teamcity', '--configuration', 'php/phpunit.xml', 'php/tests/codec.php']);
  assert.deepEqual(args({ 'php/phpunit.xml.dist': '<phpunit/>\n' }), ['php/vendor/bin/phpunit', '--teamcity', '--configuration', 'php/phpunit.xml.dist', 'php/tests/codec.php']);
});


// K178: a Composer monorepo has one development composer.json at the root, which requires its libraries through path
// repositories, and one vendor directory beside it; a library has none of its own.
test('a php binding of a Composer monorepo runs the PHPUnit of the root project, and one with no vendor directory above it fails with the fix (K178)', TIMEOUT, (t) => {
  const monorepo = { 'php/vendor/bin/phpunit': null, 'composer.json': '{}\n', 'vendor/bin/phpunit': '' };
  const run = runOf({ name: 'php', runner: 'php' }, repository(t, { files: monorepo }), { test: 'php/tests/codec.php' }, 'suite', ENV);
  if (run.error) throw new Error(`the php binding cannot start: ${run.error}`);
  assert.deepEqual(run.args, ['vendor/bin/phpunit', '--teamcity', '--no-configuration', 'php/tests/codec.php']);
  assert.deepEqual(check(t, { files: monorepo }).findings, []);
  const { findings } = check(t, { files: { 'php/vendor/bin/phpunit': null } });
  assert.deepEqual(keys(findings), ['R3 codec php', 'R3 width php', 'R3 size php']);
  assert.match(findingAt(findings, 0).message, /php\/vendor\/bin\/phpunit does not exist; run composer install in php, or in the project that requires it/);
});
/** The unit width of `config`, the go and rust suite that the K42 cases read in other forms. */
const widthUnit = (config: Declaration) => itemWhere(config.units, (unit: { id: string }) => unit.id === 'width');

test('a case path step .~ selects the keys of an object as the case names (K42)', TIMEOUT, (t) => {
  const keyed = { files: { 'tests/vectors/width.json': JSON.stringify({ narrow: { width: 1 }, wide: { width: 2 } }) }, edit: (config: Declaration) => { widthUnit(config).cases = '$.~'; return config; } };
  const { findings, ledger } = check(t, keyed);
  assert.deepEqual(findings, []);
  assert.deepEqual(ledger.cases.filter(entry => entry.unit === 'width').map(entry => `${entry.implementation} ${entry.case}`), ['go narrow', 'go wide', 'rust narrow', 'rust wide', 'ts narrow', 'ts wide', 'php narrow', 'php wide', 'python narrow', 'python wide']);
  const messages = (change: Change) => check(t, change, { execute: false }).findings.map(finding => `${finding.rule}: ${finding.message}`);
  assert.deepEqual(messages({ edit: keyed.edit }), ['declaration: unit width: tests/vectors/width.json: $ is no object']);
  assert.deepEqual(messages({ files: { 'tests/vectors/width.json': '{}' }, edit: keyed.edit }), ['declaration: unit width: $.~ selects no case in tests/vectors/width.json']);
  assert.deepEqual(messages({ files: keyed.files, edit: (config) => { widthUnit(config).cases = '$.~.name'; return config; } }).length, 1);
});

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
test('two suite units that cite the same requirements from different case sets are a finding naming both (K350)', TIMEOUT, (t) => {
  const files = {
    'docs/spec/forms.md': '# Forms\n\n- **CX-2** The form keeps its history.\n- **CX-3** The form saves its draft.\n',
    'tests/forms/form-history/save/case.json': '{"requirements": ["CX-2"]}\n',
    'tests/forms/form-history-2/restore/case.json': '{"requirements": ["CX-2"]}\n',
    'tests/forms/other/draft/case.json': '{"requirements": ["CX-3"]}\n',
  };
  const suite = (id: string, requirement: string) => ({ id, kind: 'suite', requirements: [requirement], file: `tests/forms/${id}`, cases: '*', bindings: [] });
  const edit = (config: Declaration) => {
    // A third unit with another requirement is no finding.
    config.units.push(suite('form-history', 'CX-2'), suite('form-history-2', 'CX-2'), suite('other', 'CX-3'));
    return config;
  };
  const { findings } = check(t, { files, edit }, { execute: false });
  const overlaps = findings.filter(item => item.rule === 'R18');
  assert.equal(overlaps.length, 1, 'only the two suites sharing a requirement conflict');
  const overlap = overlaps[0];
  assert.ok(overlap);
  assert.deepEqual(overlap.requirements, ['CX-2']);
  for (const name of ['form-history', 'form-history-2']) assert.ok(overlap.message.includes(name));
  assert.match(overlap.message, /different case sets/);
  assert.match(overlap.message, /merge.*suites.*one unit/);
  assert.ok(!overlap.message.includes('other'), 'the unrelated suite is no conflict');
});

test('a suite file names a directory whose case glob matches one directory per case, which go runs as nested subtests (K42)', TIMEOUT, (t) => {
  const { findings, ledger } = check(t, { files: CASE_DIRECTORIES, edit: caseDirectories });
  // The other implementations hold the unit too, and their native test names are no nested case of the suite.
  assert.deepEqual(keys(findings), ['R3 width rust', 'R3 width ts', 'R3 width php', 'R3 width python']);
  assert.deepEqual(ledger.cases.filter(entry => entry.unit === 'width' && entry.implementation === 'go').map(entry => `${entry.implementation} ${entry.case} ${entry.outcome}`), ['go echo/bool pass', 'go echo/html-escape-five-chars pass', 'go if/true pass']);
  // A subtest below a case is no case of the suite.
  const nested = check(t, { files: { ...CASE_DIRECTORIES, 'go/width_test.go': `${CASE_DIRECTORIES['go/width_test.go']}PASS TestWidth/if/true/sub\n` }, edit: caseDirectories });
  assert.deepEqual(nested.findings.map(finding => `${finding.rule} ${finding.unit}: ${finding.message}`), ['R3 width: not in the suite: if/true/sub', 'R3 width: not executed: echo/bool, echo/html-escape-five-chars, if/true; not in the suite: narrow, wide', 'R3 width: not executed: echo/bool, echo/html-escape-five-chars, if/true; not in the suite: narrow, wide', 'R3 width: not executed: echo/bool, echo/html-escape-five-chars, if/true; not in the suite: narrow, wide', 'R3 width: not executed: echo/bool, echo/html-escape-five-chars, if/true; not in the suite: narrow, wide']);
  const messages = (change: Change) => check(t, change, { execute: false }).findings.map(finding => `${finding.rule}: ${finding.message}`);
  assert.deepEqual(messages({ files: { ...CASE_DIRECTORIES, 'tests/cases/README.md': 'x\n', 'tests/cases/echo/notes.md': 'x\n' }, edit: caseDirectories }), [
    'declaration: unit width: tests/cases/README.md is a file where the case glob */* matches a directory',
    'declaration: unit width: tests/cases/echo/notes.md is a file where the case glob */* matches a directory',
  ]);
  assert.deepEqual(messages({ files: CASE_DIRECTORIES, edit: (config) => { caseDirectories(config); widthUnit(config).cases = '$[*]'; return config; } }), [
    'declaration: unit width: tests/cases is a directory, so cases is a glob of its case directories, not $[*]',
  ]);
  assert.deepEqual(messages({ files: CASE_DIRECTORIES, edit: (config) => { caseDirectories(config); widthUnit(config).cases = '**'; return config; } }), [
    'declaration: unit width: the case glob ** holds **; each / step of the glob matches one directory level',
  ]);
  assert.deepEqual(messages({ edit: (config) => { widthUnit(config).cases = '*'; return config; } }), [
    'declaration: unit width: tests/vectors/width.json is a file, so cases is a path $… of its case names, not *',
  ]);
  assert.deepEqual(messages({ edit: (config) => { widthUnit(config).caseFile = 'out.html'; return config; } }), [
    'declaration: unit width: caseFile out.html applies only to a suite whose file is a directory, and tests/vectors/width.json is a file',
  ]);
  assert.deepEqual(messages({ files: CASE_DIRECTORIES, edit: (config) => { caseDirectories(config); widthUnit(config).cases = 'none/*'; return config; } }), [
    'declaration: unit width: none/* selects no case in tests/cases',
  ]);
});

test('a tools root holds single-language tooling tests that R6 accepts and every run prints (K42)', TIMEOUT, (t) => {
  const files = { 'tools/tests/grammar.mjs': "import test from 'node:test';\ntest('grammar', () => {});\n" };
  assert.deepEqual(check(t, { files }, { execute: false }).findings.map(finding => `${finding.rule} ${finding.place}`), ['R6 tools/tests/grammar.mjs']);
  const tools = (config: Declaration) => { config.tools = [{ root: 'tools', reason: 'the editor grammar, tested in node only' }]; return config; };
  const lines: string[] = [];
  const { findings } = checkParity(repository(t, { files, edit: tools }), { execute: false, env: ENV, say: line => lines.push(line) });
  assert.deepEqual(findings, []);
  assert.ok(lines.includes('tools root tools: the editor grammar, tested in node only'), lines.join('\n'));
  const messages = (change: Change) => check(t, change, { execute: false }).findings.map(finding => `${finding.rule}: ${finding.message}`);
  assert.deepEqual(messages({ edit: (config) => { config.tools = [{ root: 'ts/tools', reason: 'x' }, { root: 'go/../go', reason: 'y' }]; return config; } }).length, 1, 'the schema refuses a path with ..');
  assert.deepEqual(messages({ edit: (config) => { config.tools = [{ root: 'ts/tools', reason: 'x' }, { root: 'tools', reason: ' ' }]; return config; } }), [
    'declaration: tools: the root ts/tools overlaps ts, a root of the implementation ts',
    'declaration: tools: the root tools gives no reason; write why its tests belong outside the shared implementation set',
  ]);
  assert.deepEqual(messages({ files: { 'tools/tests/codec.mjs': NODE_CODEC }, edit: (config) => { tools(config); binding(config, 'codec', 'ts').test = 'tools/tests/codec.mjs'; return config; } }), [
    'declaration: tools: the root tools holds tools/tests/codec.mjs, the test of the suite codec in ts',
  ]);
});

test('a tool-owned requirement uses its exact native case without becoming an implementation binding (K604)', TIMEOUT, (t) => {
  const files = {
    'docs/spec/editor.md': '# Editor\n\n- **CX-2** The editor tool handles its native behavior.\n',
    'tools/editor/adapter.test.mjs': "test('native adapter case', () => {}); // CX-2\n",
  };
  const edit = (config: Declaration) => {
    config.tools = [{
      root: 'tools/editor',
      reason: 'The editor package has a native contract outside the shared runtimes.',
      units: [{ id: 'editor-adapter', requirements: ['CX-2'], bindings: [{ test: 'tools/editor/adapter.test.mjs', id: 'native adapter case' }] }],
    }];
    return config;
  };
  const root = repository(t, { files, edit });
  assert.deepEqual(checkParity(root, { execute: false, env: ENV, ids: ['CX-2'], say: () => {} }).findings, []);

  const findings = (change: Change) => check(t, { files, edit: change.edit ?? edit, ...(change.files === undefined ? {} : { files: { ...files, ...change.files } }) }, { execute: false }).findings;
  const fakeCase = findings({ edit: config => {
    edit(config);
    const tool = itemWhere(config.tools ?? [], entry => entry.root === 'tools/editor');
    itemAt(itemAt(tool.units ?? [], 0).bindings, 0).id = 'CX-2 missing case';
    return config;
  } });
  assert.ok(fakeCase.some(item => item.rule === 'declaration' && item.message.includes('CX-2 missing case')), keys(fakeCase).join('\n'));

  const missingTest = findings({ edit: config => {
    edit(config);
    const tool = itemWhere(config.tools ?? [], entry => entry.root === 'tools/editor');
    itemAt(itemAt(tool.units ?? [], 0).bindings, 0).test = 'tools/editor/missing.test.mjs';
    return config;
  } });
  assert.ok(missingTest.some(item => item.rule === 'declaration' && item.message.includes('missing.test.mjs')), keys(missingTest).join('\n'));

  const misplaced = findings({ files: { 'tools/other.test.mjs': "test('native adapter case', () => {}); // CX-2\n" }, edit: config => {
    edit(config);
    const tool = itemWhere(config.tools ?? [], entry => entry.root === 'tools/editor');
    itemAt(itemAt(tool.units ?? [], 0).bindings, 0).test = 'tools/other.test.mjs';
    return config;
  } });
  assert.ok(misplaced.some(item => item.rule === 'declaration' && item.message.includes('outside its tools root')), keys(misplaced).join('\n'));

  const uncited = findings({ files: { 'tools/editor/adapter.test.mjs': "test('native adapter case', () => {});\n" } });
  assert.ok(uncited.some(item => item.rule === 'R15' && item.requirements?.includes('CX-2')), keys(uncited).join('\n'));
});

test('an exact oracle test file inside an implementation root is tool-owned without hiding its sibling tests (K651)', TIMEOUT, (t) => {
  const oracle = 'go/oracle/facts_test.go';
  const sibling = 'go/oracle/client_contract_test.go';
  const files = {
    'docs/spec/oracle.md': '# Vendor facts\n\n- **CX-2** A vendor oracle records the declared database fact.\n',
    [oracle]: 'package oracle\n\nimport "testing"\n\nfunc TestVendorFacts(t *testing.T) {} // CX-2\n',
    [sibling]: 'package oracle\n\nimport "testing"\n\nfunc TestClientContract(t *testing.T) {}\n',
  };
  const edit = (config: Declaration) => {
    config.tools = [{
      files: [oracle],
      reason: 'The exact Go test records external database facts and is not an ORM implementation test.',
      units: [{ id: 'vendor-facts', requirements: ['CX-2'], bindings: [{ test: oracle, id: 'TestVendorFacts' }] }],
    }];
    return config;
  };
  const { findings } = check(t, { files, edit }, { execute: false });
  assert.deepEqual(findings.map(item => `${item.rule} ${item.place}`), [`R5 ${sibling}`]);

  const changed = (change: (config: Declaration) => Declaration) => check(t, { files, edit: change }, { execute: false }).findings;
  const directory = changed(config => {
    edit(config);
    itemWhere(config.tools ?? [], tool => tool.files?.[0] === oracle).files = ['go/oracle'];
    return config;
  });
  assert.ok(directory.some(item => item.rule === 'declaration' && item.message.includes('go/oracle')), keys(directory).join('\n'));
  const glob = changed(config => {
    edit(config);
    itemWhere(config.tools ?? [], tool => tool.files?.[0] === oracle).files = ['go/oracle/*.go'];
    return config;
  });
  assert.ok(glob.some(item => item.rule === 'declaration' && item.message.includes('go/oracle/*.go')), keys(glob).join('\n'));
  const unbound = changed(config => {
    edit(config);
    itemWhere(config.tools ?? [], tool => tool.files?.[0] === oracle).units = [];
    return config;
  });
  assert.ok(unbound.some(item => item.rule === 'declaration' && item.message.includes('is not bound by a tool unit')), keys(unbound).join('\n'));
  const dual = changed(config => {
    edit(config);
    config.units.push({
      id: 'vendor-facts-as-client', kind: 'feature', requirements: ['CX-2'],
      bindings: [{ implementation: 'go', test: oracle, id: 'TestVendorFacts' }],
    });
    return config;
  });
  assert.ok(dual.some(item => item.rule === 'declaration' && item.message.includes('also bound to an implementation unit')), keys(dual).join('\n'));
  const duplicate = changed(config => {
    edit(config);
    config.tools?.push({
      files: [oracle], reason: 'A second tool cannot own the same test file.',
      units: [{ id: 'vendor-facts-second-owner', requirements: ['CX-2'], bindings: [{ test: oracle, id: 'TestVendorFacts' }] }],
    });
    return config;
  });
  assert.ok(duplicate.some(item => item.rule === 'declaration' && item.message.includes('has more than one tool owner')), keys(duplicate).join('\n'));
});

test('a repository with one implementation needs no parity declaration; one with two fails without it (K248-2)', TIMEOUT, (t) => {
  const git = (root: string) => {
    initRepository(root);
    const added = spawnSync('git', ['add', '-A'], { cwd: root, encoding: 'utf8' });
    assert.equal(added.status, 0, added.stderr);
  };
  const one = tree(t, { 'packages/ts/src/a.ts': '', 'scripts/b.mts': '' });
  git(one);
  assert.deepEqual(checkParity(one, { execute: false }).findings, []);
  const two = tree(t, { 'packages/ts/src/a.ts': '', 'packages/validator/go/a.go': '', 'packages/validator/php/A.php': '' });
  git(two);
  const findings = checkParity(two, { execute: false }).findings.map(item => item.message);
  assert.deepEqual(findings, ['config/parity.json does not exist, and packages/ holds 3 implementations (packages/ts, packages/validator/go, packages/validator/php); declare them and their units there (scripts/kit/schema/parity.schema.json)']);
});

// K517: a check that did not run never passes: a run scoped to codec leaves out width, which breaks the schema, names it, and runs
// the rules on the rest, so the finding of codec counts; with no other unit broken, the run is the same as before.
test('parity-declarations-check UNITS runs the rules on the named units while another unit breaks the schema (K517)', TIMEOUT, (t) => {
  const root = repository(t, { edit: config => {
    delete itemWhere(config.units, (entry: { id: string }) => entry.id === 'width').requirements;
    itemWhere(config.units, (entry: { id: string }) => entry.id === 'codec').requirements = ['CX-9'];
    return config;
  } });
  const lines: string[] = [];
  const codec = checkParity(root, { execute: false, env: ENV, say: line => lines.push(line), units: ['codec'] }).findings;
  assert.ok(codec.some(item => item.unit === 'codec' && item.rule === 'R14'), keys(codec).join('\n'));
  assert.ok(lines.some(line => /^width breaks the schema of config\/parity\.json and is left out; the rules run on the other units$/.test(line)), lines.join('\n'));
  const make = spawnSync('make', ['--no-print-directory', ...KIT_MAKE, 'parity-declarations-check', 'UNITS=codec'], { cwd: root, env: ENV, encoding: 'utf8' });
  assert.notEqual(make.status, 0, make.stdout + make.stderr);
  assert.match(make.stderr, /\[parity\] R14 unknown-requirement codec: cites CX-9/);
});

test('R13 reports active gaps separately from a valid held requirement (K656)', TIMEOUT, (t) => {
  const checklist = (state: string) => `# Held work\n\n| ID | Task | Deliverables | Verification | State |\n|---|---|---|---|---|\n| K656 | Held CX-2 behavior | source | \`node test.mts\` | ${state} |\n`;
  const files = {
    'config/checklist.json': '{"schema":1,"hooks":["pre-push"],"idPattern":"K[0-9]+"}\n',
    'docs/spec/held.md': '# Held behavior\n\n- **CX-2** A requirement remains defined while its checklist item is held.\n- **CX-3** An active requirement remains untraced until a unit tests it.\n',
    'docs/plans/held/checklist.md': checklist('[!] cause: user held it; retry: user reopens the work'),
  };
  const root = repository(t, {
    files,
    edit: config => {
      (config as Entry).deferredRequirements = [{ id: 'CX-2', checklist: 'docs/plans/held/checklist.md', item: 'K656' }];
      return config;
    },
  });
  const lines: string[] = [];
  const result = checkParity(root, { execute: false, env: ENV, say: line => lines.push(line) });
  assert.deepEqual(result.findings.filter(item => item.rule === 'R13').map(item => item.requirements), [['CX-3']]);
  assert.ok(lines.includes('DEFERRED CX-2: held by K656 in docs/plans/held/checklist.md'), lines.join('\n'));
});

test('deferred requirement entries reject unrecognized fields (K656)', TIMEOUT, (t) => {
  const files = {
    'config/checklist.json': '{"schema":1,"hooks":["pre-push"],"idPattern":"K[0-9]+"}\n',
    'docs/spec/held.md': '# Held behavior\n\n- **CX-2** A requirement remains defined while its checklist item is held.\n',
    'docs/plans/held/checklist.md': '# Held work\n\n| ID | Task | Deliverables | Verification | State |\n|---|---|---|---|---|\n| K656 | Held CX-2 behavior | source | `node test.mts` | [!] cause: user held it; retry: user reopens the work |\n',
  };
  const messages = check(t, {
    files,
    edit: config => {
      (config as Entry).deferredRequirements = [{ id: 'CX-2', checklist: 'docs/plans/held/checklist.md', item: 'K656', extra: true }];
      return config;
    },
  }, { execute: false }).findings.map(item => item.message);
  assert.ok(messages.some(message => message.includes('additional properties') && message.includes('extra')), messages.join('\n'));
});

// K520: a run scoped to a unit fails while docs/spec defines a requirement twice: the duplicate is a finding of the spec itself.
test('parity-declarations-check UNITS fails while docs/spec defines a requirement twice (K520)', TIMEOUT, (t) => {
  const root = repository(t, { files: { 'docs/spec/codec.md': '# Codec\n\n- **CX-1** The codec encodes every vector.\n- **CX-1** Defined again.\n' } });
  const scoped = checkParity(root, { execute: false, env: ENV, say: () => {}, units: ['codec'] }).findings;
  assert.ok(scoped.some(item => /CX-1 is defined at docs\/spec\/codec\.md:3 and docs\/spec\/codec\.md:4/.test(item.message)), keys(scoped).join('\n'));
});
