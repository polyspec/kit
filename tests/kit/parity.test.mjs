// Tests of scripts/kit/parity.mjs, the language-parity check. Each test builds a mini repository of five implementations
// (go, rust, ts, php, python) whose declaration config/parity.json passes, changes one dimension of it and expects the
// finding of exactly one rule: R1 to R11 and the declaration errors. Stub commands stand in for go, cargo, php and the
// Python of var/tools; the TypeScript tests run on the real node. A stub prints the `PASS`/`FAIL` lines of the test file it
// runs (go: as `go test -json` events of the subtests of the -run symbol) and exits with the status of its `EXIT <n>` line (go: `EXIT <symbol> <n>`).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkParity } from '../../scripts/kit/parity.mjs';
import { tree } from './tree.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../scripts/kit');
const TIMEOUT = { timeout: 120_000 };

// The stub of go: `go test -json -count=1 -run ^<symbol>$ ./<directory>` in the module directory. It reads the lines
// `PASS <symbol>/<case>` and `FAIL <symbol>/<case>` of the *_test.go files of the directory and writes the events of go test;
// it exits with the status of the line `EXIT <symbol> <n>`, so a test function of the same directory keeps status 0.
const GO_STUB = `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const args = process.argv.slice(2);
const symbol = args[args.indexOf('-run') + 1].replace(/^\\^|\\$$/g, '');
const directory = args[args.length - 1];
let exit = 0;
console.log(JSON.stringify({ Action: 'start', Package: 'example' }));
for (const file of fs.readdirSync(directory).filter(name => name.endsWith('_test.go')).sort()) {
  for (const line of fs.readFileSync(path.join(directory, file), 'utf8').split('\\n')) {
    const found = /^(PASS|FAIL) (\\S+)$/.exec(line);
    if (found && found[2].startsWith(symbol + '/')) {
      console.log(JSON.stringify({ Action: 'run', Test: found[2] }));
      console.log(JSON.stringify({ Action: 'output', Test: found[2], Output: '=== RUN ' + found[2] + '\\n' }));
      console.log(JSON.stringify({ Action: found[1] === 'PASS' ? 'pass' : 'fail', Test: found[2] }));
    }
    const status = /^EXIT (\\S+) (\\d+)$/.exec(line);
    if (status && status[1] === symbol) exit = Number(status[2]);
  }
}
console.log(JSON.stringify({ Action: exit ? 'fail' : 'pass', Test: symbol }));
process.exit(exit);
`;

// The stub of php, cargo and python3: it prints the PASS and FAIL lines of the test file and exits with its EXIT line. cargo
// reads tests/<name>.rs of the crate for --test <name> and src/lib.rs for --lib.
const LINE_STUB = `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const args = process.argv.slice(2);
let file = args[0];
if (path.basename(process.argv[1]) === 'cargo') {
  const crate = path.dirname(args[args.indexOf('--manifest-path') + 1]);
  file = args.includes('--lib') ? path.join(crate, 'src/lib.rs') : path.join(crate, 'tests', args[args.indexOf('--test') + 1] + '.rs');
}
let exit = 0;
for (const line of fs.readFileSync(file, 'utf8').split('\\n')) {
  if (/^(PASS|FAIL) /.test(line)) console.log(line);
  const status = /^EXIT (\\d+)$/.exec(line);
  if (status) exit = Number(status[1]);
}
process.exit(exit);
`;

const STUBS = mkdtempSync(path.join(tmpdir(), 'kit-parity-stubs-'));
for (const [name, text] of [['go', GO_STUB], ['cargo', LINE_STUB], ['php', LINE_STUB]]) {
  writeFileSync(path.join(STUBS, name), text);
  chmodSync(path.join(STUBS, name), 0o755);
}
test.after(() => rmSync(STUBS, { recursive: true, force: true }));
const ENV = { ...process.env, PATH: `${STUBS}${path.delimiter}${process.env.PATH}` };

const snapshot = entries => `${JSON.stringify(Object.fromEntries(entries.map(([id, exported]) => [id, { exported }])), null, 2)}\n`;

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
  'rust/tests/size.rs': 'PASS size/small\n',
  'go/codes.go': 'package codec\n\nconst (\n\tCodeConfig = "CONFIG"\n\tCodeDecode = "CODEC_DECODE"\n)\n',
  'rust/Cargo.toml': '[package]\nname = "codec"\n',
  'rust/src/lib.rs': 'PASS width/narrow\nPASS width/wide\n',
  'rust/src/codes.rs': 'pub const CONFIG: &str = "CONFIG";\npub const CODEC_DECODE: &str = "CODEC_DECODE";\n',
  'rust/tests/codec.rs': 'PASS codec/empty\nPASS codec/ascii\n',
  'ts/src/index.ts': 'export const encode = () => 1;\n',
  'ts/src/codes.ts': "export const CONFIG = 'CONFIG';\nexport const CODEC_DECODE = 'CODEC_DECODE';\n",
  'ts/tests/codec.mjs': "console.log('RUN codec/empty deadline=1m0s');\nconsole.log('PASS codec/empty elapsed=1ms');\nconsole.log('PASS codec/ascii elapsed=1ms');\n",
  'php/src/Code.php': "<?php\nfinal class Code\n{\n    const CONFIG = 'CONFIG';\n    const CODEC_DECODE = 'CODEC_DECODE';\n}\n",
  'php/tests/codec.php': 'PASS codec/empty elapsed=1ms\nPASS codec/ascii elapsed=1ms\n',
  'python/codes.py': 'CONFIG = "CONFIG"\nCODEC_DECODE = "CODEC_DECODE"\n',
  'python/tests/test_codec.py': 'PASS codec/empty\nPASS codec/ascii\n',
  'var/tools/bin/python3': LINE_STUB,
  'contracts/symbols/go.json': snapshot([['go/codec.go::Encode', true], ['go/codec.go::encodeHost', false]]),
  'contracts/symbols/rust.json': snapshot([['rust/src/lib.rs::encode', true], ['rust/src/lib.rs::hex_upper', true]]),
  'contracts/symbols/ts.json': snapshot([['ts/src/index.ts::encode', true]]),
  'contracts/symbols/php.json': snapshot([['php/src/Codec.php::Codec::encode', true]]),
  'contracts/symbols/python.json': snapshot([['python/codec.py::encode', true], ['python/codec.py::_split', false]]),
  'docs/errors.yaml': '- code: CONFIG\n- code: CODEC_DECODE\n',
  'tools/languages.mjs': "export const LANGUAGES = ['go', 'rust', 'ts', 'php', 'python'];\n",
  'docs/index.md': '# Codec\n\nFive languages share the codec: Go, Rust, TS, PHP and Python.\nThe two implementations go and rust compile.\n',
  'docs/index.ko.md': '# Codec\n\n다섯 언어가 codec을 공유한다: Go, Rust, TS, PHP와 Python.\n',
};

const CONFIG = {
  schema: 1,
  implementations: [
    { name: 'go', runner: 'go', roots: ['go'], tests: ['go/**/*_test.go'], symbols: 'contracts/symbols/go.json', errors: { file: 'go/codes.go', pattern: '^\\tCode\\w+ = "(\\w+)"$' } },
    { name: 'rust', runner: 'cargo', roots: ['rust'], tests: ['rust/tests/*.rs'], symbols: 'contracts/symbols/rust.json', errors: { file: 'rust/src/codes.rs', pattern: '^pub const \\w+: &str = "(\\w+)";$' } },
    { name: 'ts', runner: 'node', roots: ['ts'], tests: ['ts/tests/*.mjs'], symbols: 'contracts/symbols/ts.json', errors: { file: 'ts/src/codes.ts', pattern: "^export const \\w+ = '(\\w+)';$" } },
    { name: 'php', runner: 'php', roots: ['php'], tests: ['php/tests/*.php'], symbols: 'contracts/symbols/php.json', errors: { file: 'php/src/Code.php', pattern: "^    const \\w+ = '(\\w+)';$" } },
    { name: 'python', runner: 'python', roots: ['python'], tests: ['python/tests/*.py'], symbols: 'contracts/symbols/python.json', errors: { file: 'python/codes.py', pattern: '^\\w+ = "(\\w+)"$' } },
  ],
  profiles: [
    { name: 'all', implementations: ['go', 'rust', 'ts', 'php', 'python'] },
    { name: 'compiled', implementations: ['go', 'rust'], reason: 'the width tables exist only in the compiled implementations' },
  ],
  suites: ['tests/vectors/*.json'],
  units: [
    {
      id: 'codec', kind: 'suite', profile: 'all', file: 'tests/vectors/codec.json', cases: '$.vectors[*].name',
      bindings: [
        { implementation: 'go', test: 'go/codec_test.go', symbol: 'TestCodec' },
        { implementation: 'rust', test: 'rust/tests/codec.rs', symbol: 'vectors' },
        { implementation: 'ts', test: 'ts/tests/codec.mjs' },
        { implementation: 'php', test: 'php/tests/codec.php' },
        { implementation: 'python', test: 'python/tests/test_codec.py' },
      ],
    },
    {
      id: 'width', kind: 'suite', profile: 'compiled', file: 'tests/vectors/width.json', cases: '$[*]',
      bindings: [
        { implementation: 'go', test: 'go/width_test.go', symbol: 'TestWidth' },
        { implementation: 'rust', test: 'rust/src/lib.rs', symbol: 'width::tests::vectors' },
      ],
    },
    {
      id: 'size', kind: 'suite', profile: 'compiled', file: 'tests/vectors/size.json', cases: '$[*]',
      bindings: [
        { implementation: 'go', test: 'go/size_test.go', symbol: 'TestSize' },
        { implementation: 'rust', test: 'rust/tests/size.rs', symbol: 'vectors' },
      ],
    },
    {
      id: 'encode', kind: 'api', profile: 'all',
      symbols: [
        { implementation: 'go', symbol: 'go/codec.go::Encode' },
        { implementation: 'rust', symbol: 'rust/src/lib.rs::encode' },
        { implementation: 'ts', symbol: 'ts/src/index.ts::encode' },
        { implementation: 'php', symbol: 'php/src/Codec.php::Codec::encode' },
        { implementation: 'python', symbol: 'python/codec.py::encode' },
      ],
    },
  ],
  nativeOnly: [{ implementation: 'rust', symbol: 'rust/src/lib.rs::hex_upper', reason: 'the hex helper of the Rust codec, which the crate exports for its benchmarks' }],
  exclusions: [],
  errors: { profile: 'all', catalog: { file: 'docs/errors.yaml', pattern: '^- code: (\\w+)$' } },
  languageLists: [{ file: 'tools/languages.mjs', pattern: 'LANGUAGES = \\[([^\\]]*)\\]', profile: 'all' }],
  documents: { globs: ['docs/**/*.md'], nouns: ['languages', 'implementations', '언어'] },
};

/** A mini repository: FILES with `files` applied (null removes) and the declaration that `edit` returns from a copy of CONFIG. */
function repository(t, { files = {}, edit = config => config } = {}) {
  const all = { ...FILES, ...files, 'config/parity.json': `${JSON.stringify(edit(structuredClone(CONFIG)), null, 2)}\n` };
  const root = tree(t, Object.fromEntries(Object.entries(all).filter(([, text]) => text !== null)));
  chmodSync(path.join(root, 'var/tools/bin/python3'), 0o755);
  return root;
}

/** The findings of the check of a mini repository; `execute` false checks the declarations only. */
function check(t, change, { execute = true } = {}) {
  return checkParity(repository(t, change), { execute, env: ENV, say: () => {} });
}

/** Each finding as `<rule> <unit> <implementation>`, the fields that a finding names. */
const keys = findings => findings.map(finding => [finding.rule, finding.unit ?? '-', finding.implementation ?? '-'].join(' '));

const binding = (config, unit, implementation) => config.units.find(entry => entry.id === unit).bindings.find(entry => entry.implementation === implementation);

test('the declaration of five implementations passes, with every case of every suite executed', TIMEOUT, (t) => {
  const { findings, ledger } = check(t);
  assert.deepEqual(findings, []);
  assert.deepEqual(ledger.runs.map(run => `${run.unit} ${run.implementation} ${run.status}`), [
    'codec go 0', 'codec rust 0', 'codec ts 0', 'codec php 0', 'codec python 0', 'width go 0', 'width rust 0', 'size go 0', 'size rust 0',
  ]);
  assert.deepEqual(ledger.cases.map(entry => `${entry.unit} ${entry.implementation} ${entry.case} ${entry.outcome}`), [
    'codec go empty pass', 'codec go ascii pass', 'codec rust empty pass', 'codec rust ascii pass',
    'codec ts empty pass', 'codec ts ascii pass', 'codec php empty pass', 'codec php ascii pass',
    'codec python empty pass', 'codec python ascii pass',
    'width go narrow pass', 'width go wide pass', 'width rust narrow pass', 'width rust wide pass',
    'size go small pass', 'size rust small pass',
  ]);
});

test('a profile narrower than every implementation is printed on every run with what it omits and why', TIMEOUT, (t) => {
  const lines = [];
  const { findings } = checkParity(repository(t), { execute: false, env: ENV, say: line => lines.push(line) });
  assert.deepEqual(findings, []);
  assert.ok(lines.includes('profile compiled omits ts, php, python: the width tables exist only in the compiled implementations'), lines.join('\n'));
});

test('a narrower profile without a reason or with one unit, and an implementation in no profile, fail the declaration', TIMEOUT, (t) => {
  const messages = change => check(t, change, { execute: false }).findings.map(finding => `${finding.rule}: ${finding.message}`);
  assert.deepEqual(messages({ edit: (config) => { delete config.profiles[1].reason; return config; } }), [
    'declaration: profile compiled omits ts, php, python and gives no reason; write the reason in reason',
  ]);
  assert.deepEqual(messages({ edit: (config) => { config.profiles[1].reason = ' '; return config; } }), [
    'declaration: profile compiled omits ts, php, python and gives no reason; write the reason in reason',
  ]);
  assert.deepEqual(messages({ files: { 'go/size_test.go': null, 'rust/tests/size.rs': null, 'tests/vectors/size.json': null }, edit: (config) => { config.units = config.units.filter(unit => unit.id !== 'size'); return config; } }), [
    'declaration: profile compiled omits implementations and only the unit width uses it; a profile groups the units that share its reason, so put the unit in a wider profile or exclude what it lacks',
  ]);
  assert.deepEqual(messages({ edit: (config) => { config.implementations.push({ name: 'kotlin', runner: 'node', roots: ['kotlin'], tests: ['kotlin/*.mjs'] }); config.profiles[0].reason = 'kotlin starts later'; return config; } }), [
    'declaration: the implementation kotlin is in no profile, so no unit applies to it',
  ]);
});

test('each runner runs the native test of its binding', TIMEOUT, (t) => {
  const root = repository(t);
  const { ledger } = checkParity(root, { execute: true, env: ENV, say: () => {} });
  const commands = Object.fromEntries(ledger.runs.map(run => [`${run.unit} ${run.implementation}`, { cwd: run.cwd, command: [run.command, ...run.args] }]));
  assert.deepEqual(commands['codec go'], { cwd: 'go', command: ['go', 'test', '-json', '-count=1', '-run', '^TestCodec$', './'] });
  assert.deepEqual(commands['codec rust'], { cwd: '.', command: ['cargo', 'test', '--manifest-path', 'rust/Cargo.toml', '--test', 'codec', '--', '--exact', 'vectors', '--nocapture', '--test-threads=1'] });
  assert.deepEqual(commands['width rust'], { cwd: '.', command: ['cargo', 'test', '--manifest-path', 'rust/Cargo.toml', '--lib', '--', '--exact', 'width::tests::vectors', '--nocapture', '--test-threads=1'] });
  assert.deepEqual(commands['codec ts'], { cwd: '.', command: [process.execPath, 'ts/tests/codec.mjs'] });
  assert.deepEqual(commands['codec php'], { cwd: '.', command: ['php', 'php/tests/codec.php'] });
  assert.deepEqual(commands['codec python'], { cwd: '.', command: [path.join(root, 'var/tools/bin/python3'), 'python/tests/test_codec.py'] });
});

test('R1: an API unit whose symbol is missing, not exported or not declared in an implementation fails', TIMEOUT, (t) => {
  const { findings } = check(t, {
    files: {
      'contracts/symbols/go.json': snapshot([['go/codec.go::Encode', false], ['go/codec.go::encodeHost', false]]),
      'contracts/symbols/rust.json': snapshot([['rust/src/lib.rs::hex_upper', true]]),
    },
    edit: config => {
      const unit = config.units.find(entry => entry.id === 'encode');
      unit.symbols = unit.symbols.filter(entry => entry.implementation !== 'python');
      return config;
    },
  }, { execute: false });
  // The python symbol that the unit no longer declares is also an undeclared exported symbol (R11).
  assert.deepEqual(keys(findings), ['R1 encode go', 'R1 encode rust', 'R1 encode python', 'R11 - python']);
  assert.match(findings[0].message, /go\/codec\.go::Encode is not exported/);
  assert.match(findings[1].message, /rust\/src\/lib\.rs::encode is not in contracts\/symbols\/rust\.json/);
  assert.match(findings[2].message, /declares no symbol of python/);
});

test('R2: a suite without a binding of an implementation of its profile fails', TIMEOUT, (t) => {
  const { findings } = check(t, {
    files: { 'python/tests/test_codec.py': null },
    edit: config => {
      const unit = config.units.find(entry => entry.id === 'codec');
      unit.bindings = unit.bindings.filter(entry => entry.implementation !== 'python');
      return config;
    },
  });
  assert.deepEqual(keys(findings), ['R2 codec python']);
  assert.match(findings[0].message, /tests\/vectors\/codec\.json has no binding of python/);
});

test('R3: a binding that fails, misses a case, adds a case or exits with an error fails', TIMEOUT, (t) => {
  const { findings, ledger } = check(t, {
    files: {
      'go/codec_test.go': 'PASS TestCodec/empty\nFAIL TestCodec/ascii\nEXIT TestCodec 1\n',
      'ts/tests/codec.mjs': "console.log('PASS codec/empty elapsed=1ms');\nconsole.log('PASS codec/ascii elapsed=1ms');\nconsole.log('PASS codec/latin1 elapsed=1ms');\n",
      'php/tests/codec.php': 'PASS codec/empty\nPASS codec/ascii\nEXIT 2\n',
      'python/tests/test_codec.py': 'PASS codec/empty\n',
    },
  });
  assert.deepEqual(keys(findings), ['R3 codec go', 'R3 codec ts', 'R3 codec php', 'R3 codec python']);
  assert.match(findings[0].message, /exited with 1/);
  assert.match(findings[0].message, /failed: ascii/);
  assert.match(findings[1].message, /not in the suite: latin1/);
  assert.match(findings[2].message, /exited with 2/);
  assert.match(findings[3].message, /not executed: ascii/);
  assert.ok(ledger.cases.some(entry => entry.implementation === 'go' && entry.case === 'ascii' && entry.outcome === 'fail'));
});

test('R3: a binding whose runner cannot start fails, and a check of the declarations runs no binding', TIMEOUT, (t) => {
  const root = repository(t);
  rmSync(path.join(root, 'var/tools/bin/python3'));
  const missing = checkParity(root, { execute: true, env: ENV, say: () => {} }).findings;
  assert.deepEqual(keys(missing), ['R3 codec python']);
  assert.match(missing[0].message, /could not start/);
  const declarations = checkParity(root, { execute: false, env: ENV, say: () => {} });
  assert.deepEqual(declarations.findings, []);
  assert.deepEqual(declarations.ledger.runs, []);
});

test('R4: a suite file that no unit declares fails', TIMEOUT, (t) => {
  const { findings } = check(t, { files: { 'tests/vectors/events.json': '[]' } }, { execute: false });
  assert.deepEqual(keys(findings), ['R4 - -']);
  assert.equal(findings[0].place, 'tests/vectors/events.json');
});

test('R5: a test file of an implementation that no binding runs fails', TIMEOUT, (t) => {
  const { findings } = check(t, { files: { 'python/tests/test_vector.py': 'PASS codec/empty\n' } }, { execute: false });
  assert.deepEqual(keys(findings), ['R5 - python']);
  assert.equal(findings[0].place, 'python/tests/test_vector.py');
});

test('R6: a binding whose test lies outside the roots of its implementation fails', TIMEOUT, (t) => {
  const { findings } = check(t, {
    files: { 'php/tests/codec.php': null, 'tests/php/codec.php': FILES['php/tests/codec.php'] },
    edit: config => { binding(config, 'codec', 'php').test = 'tests/php/codec.php'; return config; },
  });
  assert.deepEqual(keys(findings), ['R6 codec php']);
  assert.match(findings[0].message, /outside php/);
});

test('R7: an implementation whose error codes differ from the catalog, or that declares none, fails', TIMEOUT, (t) => {
  const { findings } = check(t, {
    files: { 'python/codes.py': 'CONFIG = "CONFIG"\nEXTRA = "EXTRA"\n' },
    edit: config => { delete config.implementations.find(entry => entry.name === 'php').errors; return config; },
  }, { execute: false });
  assert.deepEqual(keys(findings), ['R7 - php', 'R7 - python']);
  assert.match(findings[0].message, /declares no error codes/);
  assert.match(findings[1].message, /missing CODEC_DECODE/);
  assert.match(findings[1].message, /not in the catalog: EXTRA/);
});

test('the catalog pattern reads every line of the catalog that is not blank or a comment, and reads at least one code', TIMEOUT, (t) => {
  const messages = change => check(t, change, { execute: false }).findings.map(finding => `${finding.rule} ${finding.place}: ${finding.message}`);
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

test('R8: an exclusion is always a finding, with its reason and item', TIMEOUT, (t) => {
  const change = {
    files: { 'python/tests/test_codec.py': null },
    edit: config => {
      const unit = config.units.find(entry => entry.id === 'codec');
      unit.bindings = unit.bindings.filter(entry => entry.implementation !== 'python');
      config.exclusions.push({ unit: 'codec', implementation: 'python', reason: 'the Python harness reports no cases yet', item: 'T76-1' });
      return config;
    },
  };
  for (const execute of [false, true]) {
    const { findings } = check(t, change, { execute });
    assert.deepEqual(keys(findings), ['R8 codec python']);
    assert.match(findings[0].message, /excluded: the Python harness reports no cases yet \(T76-1\)/);
  }
});

test('R9: a language list of another file that differs from its profile fails', TIMEOUT, (t) => {
  const { findings } = check(t, { files: { 'tools/languages.mjs': "export const LANGUAGES = ['go', 'rust', 'ts', 'php'];\n" } }, { execute: false });
  assert.deepEqual(keys(findings), ['R9 - -']);
  assert.match(findings[0].message, /missing python/);
  assert.equal(findings[0].place, 'tools/languages.mjs:1');
});

test('R10: a document that counts or lists the implementations unlike every profile fails', TIMEOUT, (t) => {
  const { findings } = check(t, {
    files: {
      'docs/index.md': '# Codec\n\nFour languages share the codec.\nGo, PHP, Rust, and TS share one contract.\n',
      'docs/index.ko.md': '# Codec\n\n네 언어가 codec을 공유한다.\n',
    },
  }, { execute: false });
  assert.deepEqual(findings.map(finding => `${finding.rule} ${finding.place}`), ['R10 docs/index.ko.md:3', 'R10 docs/index.md:3', 'R10 docs/index.md:4']);
  assert.match(findings[1].message, /Four languages/);
  assert.match(findings[2].message, /go, php, rust, ts/);
});

test('R11: an exported symbol that no API unit and no native-only entry declares fails', TIMEOUT, (t) => {
  const { findings } = check(t, {
    files: { 'contracts/symbols/ts.json': snapshot([['ts/src/index.ts::encode', true], ['ts/src/index.ts::orderedJsonOutput', true], ['ts/src/index.ts::hidden', false]]) },
  }, { execute: false });
  assert.deepEqual(keys(findings), ['R11 - ts']);
  assert.match(findings[0].message, /ts\/src\/index\.ts::orderedJsonOutput/);
});

test('a declaration that breaks its schema fails, and no rule runs on it', TIMEOUT, (t) => {
  const { findings } = check(t, { edit: (config) => { config.extra = true; config.units[0].kind = 'vector'; return config; } });
  assert.deepEqual(findings.map(finding => `${finding.rule}: ${finding.message}`), [
    'declaration: config/parity.json: $.units[0].kind is "vector", the schema allows "suite", "api"',
    'declaration: config/parity.json: $.extra is not in the schema',
  ]);
});

test('a declaration that names what does not exist or holds a stale entry fails, and no rule runs on it', TIMEOUT, (t) => {
  const { findings, ledger } = check(t, {
    files: { 'tests/vectors/width.json': JSON.stringify(['narrow', 'narrow']) },
    edit: (config) => {
      config.profiles[1].implementations.push('swift');
      config.nativeOnly.push({ implementation: 'go', symbol: 'go/codec.go::encodeHost', reason: 'not exported, so the entry is stale' });
      binding(config, 'codec', 'php').test = 'php/tests/missing.php';
      delete binding(config, 'codec', 'go').symbol;
      config.exclusions.push({ unit: 'codec', implementation: 'ts', reason: 'bound and excluded', item: 'T1' });
      config.languageLists[0].pattern = 'LANGUAGES = [^\\]]*';
      return config;
    },
  });
  const messages = findings.map(finding => `${finding.rule}: ${finding.message}`);
  assert.ok(findings.every(finding => finding.rule === 'declaration'), messages.join('\n'));
  assert.deepEqual(ledger.runs, []);
  for (const expected of [
    /profile compiled names swift, which is no implementation/,
    /go\/codec\.go::encodeHost is not an exported symbol of go/,
    /the test php\/tests\/missing\.php of php does not exist/,
    /the binding of go needs symbol/,
    /exclusions: codec declares ts; remove the exclusion or the declaration/,
    /languageLists tools\/languages\.mjs: the pattern LANGUAGES = \[\^\\\]\]\* has no group/,
    /tests\/vectors\/width\.json repeats the case narrow/,
  ]) assert.ok(messages.some(message => expected.test(message)), `${expected} in\n${messages.join('\n')}`);
});

test('make parity-check and parity-declarations-check pass without a finding; parity.mjs exits 1 on one', TIMEOUT, (t) => {
  const root = repository(t);
  cpSync(KIT, path.join(root, 'scripts/kit'), { recursive: true });
  const make = target => spawnSync('make', ['--no-print-directory', '-f', 'scripts/kit/kit.mk', target], { cwd: root, env: ENV, encoding: 'utf8' });
  const passed = make('parity-check');
  assert.equal(passed.status, 0, passed.stdout + passed.stderr);
  assert.match(passed.stdout, /\[parity\] run codec go: go test -json -count=1 -run \^TestCodec\$ \.\//);
  assert.match(passed.stdout, /\[parity\] every unit holds in every implementation/);
  writeFileSync(path.join(root, 'python/tests/test_codec.py'), 'PASS codec/empty\n');
  assert.equal(make('parity-declarations-check').status, 0, 'the declarations do not run the bindings');
  assert.notEqual(make('parity-check').status, 0);
  const failed = spawnSync(process.execPath, ['scripts/kit/parity.mjs'], { cwd: root, env: ENV, encoding: 'utf8' });
  assert.equal(failed.status, 1, failed.stdout + failed.stderr);
  assert.match(failed.stderr, /\[parity\] R3 not-executed codec python python\/tests\/test_codec\.py: .*not executed: ascii/);
  assert.match(failed.stderr, /\[parity\] 1 findings/);
});
