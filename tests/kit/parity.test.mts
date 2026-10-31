// Native runner and exact-binding behavior of the parity checker.
import assert from 'node:assert/strict';
import test from 'node:test';
import * as parity from './parity-support.mts';
const {
  CONFIG, ENV, KIT, KIT_MAKE,
  NODE_CODEC, PY_STUB, TIMEOUT, binding,
  check, checkParity, checkedFiles, chmodSync,
  commandOf, feature, findingAt, itemAt,
  itemWhere, keys, known, path,
  readDeclaration, repository, runOf, spawnSync,
  symbolEntries, tool,
} = parity;
type Change = parity.Change;
type Declaration = parity.Declaration;
type ParityFinding = parity.ParityFinding;
type UnitJson = parity.UnitJson;

test('the declaration of five implementations passes, with every case of every suite executed once', TIMEOUT, (t) => {
  const { findings, ledger } = check(t);
  assert.deepEqual(findings, []);
  assert.deepEqual(ledger.runs.map(run => `${run.unit} ${run.implementation} ${run.status}`), [
    'codec go 0', 'codec rust 0', 'codec ts 0', 'codec php 0', 'codec python 0', 'width go 0', 'width rust 0', 'width ts 0',
    'width php 0', 'width python 0', 'size go 0', 'size rust 0', 'size ts 0', 'size php 0', 'size python 0',
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

test('parity selects runtime implementations without narrowing declaration checks or default execution (K700)', TIMEOUT, (t) => {
  const selected = check(t, undefined, { implementations: ['go'] });
  assert.deepEqual(selected.findings, []);
  assert.deepEqual([...new Set(selected.ledger.runs.map(run => run.implementation))], ['go']);
  assert.equal(selected.ledger.runs.length, 3, 'the three Go suite bindings each run once');

  const defaultRun = check(t);
  assert.deepEqual(defaultRun.findings, []);
  assert.deepEqual([...new Set(defaultRun.ledger.runs.map(run => run.implementation))], ['go', 'rust', 'ts', 'php', 'python']);
  assert.equal(defaultRun.ledger.runs.length, 15);

  for (const implementations of [[], ['']]) {
    const empty = check(t, undefined, { implementations });
    assert.equal(empty.ledger.runs.length, 0);
    assert.match(empty.findings[0]?.message ?? '', /one or more nonempty implementation names/);
  }
  const unknown = check(t, undefined, { implementations: ['missing'] });
  assert.equal(unknown.ledger.runs.length, 0);
  assert.match(unknown.findings[0]?.message ?? '', /--implementation missing names no implementation/);

  const noBindings = check(t, undefined, { units: ['encode'], implementations: ['go'] });
  assert.equal(noBindings.ledger.runs.length, 0);
  assert.match(noBindings.findings[0]?.message ?? '', /selects no runtime bindings in --unit encode/);

  const malformedPython = check(t, { edit: config => {
    binding(config, 'codec', 'python').test = 'python/tests/missing.py';
    return config;
  } }, { implementations: ['go'] });
  assert.equal(malformedPython.ledger.runs.length, 0);
  assert.equal(malformedPython.findings[0]?.rule, 'declaration', 'an unselected implementation still receives schema checks');

  const missingPythonBinding = check(t, { edit: config => {
    const codec = itemWhere(config.units, unit => unit.id === 'codec');
    codec.bindings = (codec.bindings ?? []).filter(entry => entry.implementation !== 'python');
    return config;
  } }, { implementations: ['go'] });
  assert.ok(missingPythonBinding.findings.some(finding => finding.rule === 'R2' && finding.unit === 'codec' && finding.implementation === 'python'));
  assert.deepEqual([...new Set(missingPythonBinding.ledger.runs.map(run => run.implementation))], ['go']);

  const root = repository(t);
  const parity = tool(import.meta.resolve('../../scripts/kit/parity.mts'));
  const run = (...args: string[]) => spawnSync(process.execPath, [parity, ...args], { cwd: root, env: ENV, encoding: 'utf8' });
  const selectedCommand = run('--unit', 'codec', '--implementation', 'go');
  assert.equal(selectedCommand.status, 0, selectedCommand.stdout + selectedCommand.stderr);
  assert.match(selectedCommand.stdout, /--implementation go: only their runtime bindings run, and their support files run when --unit is absent; implementation declarations and static checks stay global/);
  assert.doesNotMatch(selectedCommand.stdout, /run codec (rust|ts|php|python)/);
  const unknownCommand = run('--unit', 'codec', '--implementation', 'missing');
  assert.notEqual(unknownCommand.status, 0, unknownCommand.stdout + unknownCommand.stderr);
  assert.match(unknownCommand.stderr, /--implementation missing names no implementation/);
  assert.doesNotMatch(unknownCommand.stdout, /run codec /);
  const emptyCommand = run('--unit', 'codec', '--implementation=');
  assert.notEqual(emptyCommand.status, 0, emptyCommand.stdout + emptyCommand.stderr);
  assert.match(emptyCommand.stderr, /one or more nonempty implementation names/);
  assert.doesNotMatch(emptyCommand.stdout, /run codec /);

  const viaMake = spawnSync('make', ['--no-print-directory', ...KIT_MAKE, 'parity-check', 'UNITS=codec', 'IMPLEMENTATIONS=go'], { cwd: root, env: ENV, encoding: 'utf8' });
  assert.equal(viaMake.status, 0, viaMake.stdout + viaMake.stderr);
  assert.match(viaMake.stdout, /--implementation go: only their runtime bindings run/);
  assert.doesNotMatch(viaMake.stdout, /run codec (rust|ts|php|python)/);

  const supportChange: Change = {
    files: { 'ts/tests/case.mjs': 'export const cases = [];\n' },
    edit: config => { itemWhere(config.implementations, entry => entry.name === 'ts').support = ['ts/tests/case.mjs']; return config; },
  };
  for (const [implementation, shouldRunSupport] of [['go', false], ['ts', true]] as const) {
    const lines: string[] = [];
    const supportRun = checkParity(repository(t, supportChange), { env: ENV, implementations: [implementation], say: line => lines.push(line) });
    assert.deepEqual(supportRun.findings, []);
    assert.deepEqual([...new Set(supportRun.ledger.runs.map(run => run.implementation))], [implementation]);
    assert.equal(lines.some(line => line.startsWith('run the support file ts/tests/case.mjs of ts:')), shouldRunSupport);
  }
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

test('K702 keeps per-binding arguments isolated on the native runner', TIMEOUT, (t) => {
  const feature = (id: string, name: string, pattern: string): UnitJson => ({
    id,
    kind: 'feature',
    requirements: ['CX-1'],
    bindings: [
      { implementation: 'go', test: 'go/codec_test.go', id: `TestCodec/${name}` },
      { implementation: 'rust', test: 'rust/tests/codec.rs', id: `vectors::${name}` },
      { implementation: 'ts', test: 'ts/tests/codec.mjs', id: name, args: [`--test-name-pattern=${pattern}`] },
      { implementation: 'php', test: 'php/tests/codec.php', id: name },
      { implementation: 'python', test: 'python/tests/test_codec.py', id: name },
    ],
  });
  const change: Change = { edit: config => {
    itemWhere(config.implementations, entry => entry.name === 'ts').args = ['--no-warnings'];
    config.units.push(feature('node-empty', 'empty', '^empty$'), feature('node-ascii', 'ascii', '^ascii$'));
    return config;
  } };
  const { findings, ledger } = check(t, change, { units: ['node-empty', 'node-ascii'], implementations: ['ts'] });
  assert.deepEqual(findings, []);
  const runs = ledger.runs.filter(run => run.implementation === 'ts');
  assert.equal(runs.length, 2, 'different binding args get separate runs');
  for (const [index, id] of ['node-empty', 'node-ascii'].entries()) {
    const pair = runs.filter(run => run.unit === id);
    const pattern = index === 0 ? '--test-name-pattern=^empty$' : '--test-name-pattern=^ascii$';
    assert.equal(pair.length, 1, `${id} runs once`);
    for (const run of pair) {
      assert.equal(run.command, process.execPath);
      assert.deepEqual(run.args.slice(0, 2), ['--no-warnings', pattern]);
      assert.ok(run.args.includes(`--test-reporter=${path.join(KIT, 'parity-node-reporter.mts')}`));
      assert.equal(run.args.at(-1), 'ts/tests/codec.mjs');
    }
  }

  const ambiguous = check(t, { edit: config => {
    change.edit?.(config);
    Object.assign(binding(config, 'node-empty', 'ts'), { command: ['node', '--test', 'ts/tests/codec.mjs'] });
    return config;
  } }, { execute: false, units: ['node-empty'] });
  assert.ok(ambiguous.findings.some(finding => finding.rule === 'declaration'), 'a full command override cannot also declare runner args');
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
  assert.ok(lines.includes('run codec php: php -d extension=${PARITY_PHP}/codec.so php/vendor/bin/phpunit --teamcity --no-configuration php/tests/codec.php (in .)'), lines.join('\n'));
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

test('a feature unit holds when the native id of each binding passes once in its run (K75)', TIMEOUT, (t) => {
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

test('a php feature binding that names its test as Class::method, the id PHPUnit reports, passes (K229)', TIMEOUT, (t) => {
  const { findings, ledger } = check(t, feature({}, unit => ({ ...unit, bindings: (unit.bindings ?? []).map(entry => (entry.implementation === 'php' ? { ...entry, id: 'CodecTest::test_bytes' } : entry)) })));
  assert.deepEqual(findings, []);
  assert.deepEqual(ledger.cases.filter(entry => entry.unit === 'roundtrip' && entry.implementation === 'php').map(entry => `${entry.case} ${entry.outcome}`), ['CodecTest::test_bytes pass']);
});

test('K692: a php feature filters a shared file to its declared methods', TIMEOUT, (t) => {
  const files = { 'php/tests/RoundtripTest.php': 'PASS test_bytes\nFAIL test_unselected\n' };
  const { findings, ledger } = check(t, feature(files, unit => ({ ...unit, bindings: (unit.bindings ?? []).map(entry => (entry.implementation === 'php' ? { ...entry, id: 'CodecTest::test_bytes' } : entry)) })));
  assert.deepEqual(findings, []);
  assert.deepEqual(ledger.cases.filter(entry => entry.unit === 'roundtrip' && entry.implementation === 'php').map(entry => `${entry.case} ${entry.outcome}`), ['CodecTest::test_bytes pass']);

  const run = runOf({ name: 'php', runner: 'php' }, repository(t, { files }), {
    test: 'php/tests/RoundtripTest.php',
    ids: ['test_bytes', 'CodecTest::test_ascii', 'Example\\Tests\\CodecTest::test_regex+method'],
  }, 'feature', ENV);
  if (run.error) throw new Error(run.error);
  assert.deepEqual(run.args.slice(-3, -1), [
    '--filter',
    '/^(?:(?:[^:]+::)?test_bytes(?: with data set |$)|(?:[^:]*\\\\)?CodecTest::test_ascii(?: with data set |$)|Example\\\\Tests\\\\CodecTest::test_regex\\+method(?: with data set |$))/',
  ]);
  assert.equal(run.caseOf({ id: 'CodecTest::test_bytes', name: 'test_bytes' }), 'test_bytes');
  assert.equal(run.caseOf({ id: 'CodecTest::test_ascii with data set "sample"', name: 'test_ascii with data set "sample"' }), 'CodecTest::test_ascii');
  assert.equal(run.caseOf({ id: 'CodecTest::test_regex+method with data set "sample"', name: 'test_regex+method with data set "sample"' }), 'Example\\Tests\\CodecTest::test_regex+method');
});

test('K695: a short PHPUnit class id selects its namespaced class exactly', TIMEOUT, (t) => {
  const run = runOf({ name: 'php', runner: 'php' }, repository(t), {
    test: 'php/tests/ParentSlotExpansionTest.php',
    ids: [
      'ParentSlotExpansionTest::testBareDollarInLiteralIsPreserved',
      'Example\\Tests\\OtherTest::test_data',
    ],
  }, 'feature', ENV);
  if (run.error) throw new Error(run.error);
  const filterIndex = run.args.indexOf('--filter');
  assert.ok(filterIndex >= 0);
  const filter = run.args[filterIndex + 1];
  assert.ok(filter);
  assert.ok(filter.startsWith('/') && filter.endsWith('/'));
  const selected = new RegExp(filter.slice(1, -1));
  assert.equal(selected.test('Polyspec\\Orm\\Tests\\ParentSlotExpansionTest::testBareDollarInLiteralIsPreserved'), true);
  assert.equal(selected.test('ParentSlotExpansionTest::testBareDollarInLiteralIsPreserved with data set "dollar"'), true);
  assert.equal(selected.test('Example\\Tests\\OtherTest::test_data with data set "value"'), true);
  assert.equal(selected.test('Other\\ParentSlotExpansionTest::testBareDollarInLiteralIsPreserved'), true);
  assert.equal(selected.test('Polyspec\\Orm\\Tests\\PrefixParentSlotExpansionTest::testBareDollarInLiteralIsPreserved'), false);
  assert.equal(selected.test('Polyspec\\Orm\\Tests\\ParentSlotExpansionTest::testBareDollarInLiteralIsPreservedSuffix'), false);
});

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

test('a go feature run names its ids in one -run alternation, and a go suite run keeps its symbol (K214)', TIMEOUT, (t) => {
  const root = repository(t);
  const feature = commandOf(runOf({ name: 'go', runner: 'go' }, root, { test: 'go/roundtrip_test.go', ids: ['TestA', 'TestB/sub', 'TestA/other'] }, 'feature', ENV), 'the go feature run');
  assert.deepEqual(feature.args, ['test', '-json', '-count=1', '-run', '^(TestA|TestB)$', './']);
  const escaped = commandOf(runOf({ name: 'go', runner: 'go' }, root, { test: 'go/roundtrip_test.go', ids: ['TestX.y/z'] }, 'feature', ENV), 'the escaped go feature run');
  assert.deepEqual(escaped.args, ['test', '-json', '-count=1', '-run', '^(TestX\\.y)$', './']);
  const suite = commandOf(runOf({ name: 'go', runner: 'go' }, root, { test: 'go/codec_test.go', symbol: 'TestCodec' }, 'suite', ENV), 'the go suite run');
  assert.deepEqual(suite.args, ['test', '-json', '-count=1', '-run', '^TestCodec$', './']);
});

test('a failed feature run that names no test prints the last 20 lines of its output (K215)', TIMEOUT, (t) => {
  const lines: string[] = [];
  checkParity(repository(t, feature({ 'go/roundtrip_test.go': Array.from({ length: 25 }, (_, i) => `BUILD ./roundtrip_test.go:${i + 1}:1: boom`).join('\n') + '\n' })), { execute: true, env: ENV, say: line => lines.push(line) });
  const line = known(lines.find(text => text.startsWith('roundtrip go: exit 1')), 'the go feature line');
  assert.match(line, /last 20 lines: .*roundtrip_test\.go:25:1: boom/);
  assert.match(line, /roundtrip_test\.go:11:1: boom/);
  assert.doesNotMatch(line, /roundtrip_test\.go:5:1: boom/);
});

test('a timed cargo run whose every declared id passes counts each one as passed (K215)', TIMEOUT, (t) => {
  const lines: string[] = [];
  const { findings, ledger } = checkParity(repository(t, feature({ 'rust/tests/roundtrip.rs': 'HARNESS timed\nPASS roundtrip::bytes\n' })), { execute: true, env: ENV, say: line => lines.push(line) });
  assert.deepEqual(findings, []);
  assert.deepEqual(ledger.cases.filter(entry => entry.unit === 'roundtrip' && entry.implementation === 'rust').map(entry => `${entry.case} ${entry.outcome}`), ['roundtrip::bytes pass']);
  assert.ok(lines.includes('roundtrip rust: exit 0, 1 of 1 ids passed'));
});

test('a suite run counts only the declared cases that passed, so a count never exceeds the declared number (K215)', TIMEOUT, (t) => {
  const lines: string[] = [];
  const { findings } = checkParity(repository(t, { files: { 'ts/tests/codec.mjs': `${NODE_CODEC}test('empty', () => {});\ntest('latin1', () => {});\n` } }), { execute: true, env: ENV, say: line => lines.push(line) });
  const counts = lines.map(line => /^codec ts: exit 0, (\d+) of (\d+) cases passed$/.exec(line)).filter(match => match !== null);
  assert.ok(counts.length > 0, lines.join('\n'));
  for (const [, passed, declared] of counts) assert.ok(Number(passed) <= Number(declared), `${passed} passed of ${declared} declared`);
  assert.deepEqual(keys(findings), ['R3 codec ts']);
  assert.match(findingAt(findings, 0).message, /not in the suite: latin1/);
});

test('exit 0 with a declared id absent from the output is a failure that names the id (K215)', TIMEOUT, (t) => {
  const { findings } = check(t, feature({ 'rust/tests/roundtrip.rs': 'PASS roundtrip::other\n' }));
  assert.deepEqual(keys(findings), ['R3 roundtrip rust']);
  assert.match(findingAt(findings, 0).message, /not executed: roundtrip::bytes/);
});

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

test('a cargo source with an explicit target path selects the matching manifest target (K694)', TIMEOUT, (t) => {
  const root = repository(t, { files: {
    'rust/Cargo.toml': '[package]\nname = "codec"\n\n[[bin]]\nname = "integration"\npath = "src/integration.rs"\n\n[[test]]\nname = "vectors"\npath = "tests/custom.rs"\n',
    'rust/src/integration.rs': 'fn main() {}\n',
    'rust/tests/custom.rs': '#[test]\nfn bytes() {}\n',
    'rust/tests/integration/main.rs': 'mod coverage;\n',
    'rust/tests/integration/coverage.rs': '#[test]\nfn transactions() {}\n',
  } });
  const binary = commandOf(runOf({ name: 'rust', runner: 'cargo' }, root, { test: 'rust/src/integration.rs', ids: ['transactions'] }, 'feature', ENV), 'the explicit binary target');
  const testTarget = commandOf(runOf({ name: 'rust', runner: 'cargo' }, root, { test: 'rust/tests/custom.rs', ids: ['bytes'] }, 'feature', ENV), 'the explicit test target');
  const module = commandOf(runOf({ name: 'rust', runner: 'cargo' }, root, { test: 'rust/tests/integration/coverage.rs', ids: ['transactions'] }, 'feature', ENV), 'the module of an inferred test target');
  const fallback = commandOf(runOf({ name: 'rust', runner: 'cargo' }, root, { test: 'rust/tests/roundtrip.rs', ids: ['bytes'] }, 'feature', ENV), 'the inferred test target');
  assert.deepEqual(binary.args, ['test', '--manifest-path', 'rust/Cargo.toml', '--bin', 'integration', 'transactions', '--', '--test-threads=1', '--exact']);
  assert.deepEqual(testTarget.args, ['test', '--manifest-path', 'rust/Cargo.toml', '--test', 'vectors', 'bytes', '--', '--test-threads=1', '--exact']);
  assert.deepEqual(module.args, ['test', '--manifest-path', 'rust/Cargo.toml', '--test', 'integration', 'transactions', '--', '--test-threads=1', '--exact']);
  assert.deepEqual(fallback.args, ['test', '--manifest-path', 'rust/Cargo.toml', '--test', 'roundtrip', 'bytes', '--', '--test-threads=1', '--exact']);
});

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
  assert.deepEqual(failing.ledger.runs.filter(run => run.unit === 'roundtrip' && run.implementation === 'go').map(run => run.command), ['sh']);
});

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

test('K720 API phase extracts public symbols once and never runs native bindings', TIMEOUT, (t) => {
  const root = repository(t, {
    files: { 'go/api/symbols.txt': 'go/codec.go::Encode\n' },
    edit: config => {
      const go = itemWhere(config.implementations, implementation => implementation.name === 'go');
      go.symbols = { extractor: 'go', entries: [{ entry: 'go' }, { entry: 'go/api' }] };
      return config;
    },
  });
  const model = readDeclaration(root, new Set(checkedFiles(root))).model;
  assert.ok(model);
  const lines: string[] = [];
  const { findings, ledger } = checkParity(root, { phase: 'api', env: ENV, say: line => lines.push(line) });
  assert.deepEqual(findings, []);
  assert.deepEqual(ledger.runs, []);
  assert.deepEqual(ledger.cases, []);
  const expectedEntries = model.config.implementations.reduce((sum, implementation) => sum + (implementation.symbols === undefined ? 0 : symbolEntries(implementation.symbols).length), 0);
  assert.equal(lines.filter(line => line.startsWith('extract the symbols of ')).length, expectedEntries);
  for (const implementation of model.config.implementations) {
    const expected = implementation.symbols === undefined ? 0 : symbolEntries(implementation.symbols).length;
    assert.equal(lines.filter(line => line.startsWith(`extract the symbols of ${implementation.name}: `)).length, expected);
  }
  assert.ok(lines.includes('API phase: validate public symbols and all static parity rules; native bindings do not run'));
});

test('K720 API and bindings phases cover the same findings as the default check', TIMEOUT, (t) => {
  const root = repository(t, {
    files: {
      'tests/vectors/unclaimed.json': '[]\n',
      'php/symbols.txt': 'LEAK A\\\\Child::take names the internal A\\\\Hidden\n',
    },
    edit: config => {
      const codec = itemWhere(config.units, unit => unit.id === 'codec');
      codec.bindings = (codec.bindings ?? []).filter(entry => entry.implementation !== 'go');
      return config;
    },
  });
  const all = checkParity(root, { env: ENV, say: () => {} });
  const api = checkParity(root, { phase: 'api', env: ENV, say: () => {} });
  assert.ok(all.findings.some(finding => finding.rule === 'R2'));
  assert.ok(all.findings.some(finding => finding.rule === 'R4'));
  assert.ok(all.findings.some(finding => finding.rule === 'R17'));
  const describe = (findings: ParityFinding[]) => findings.map(finding => `${finding.rule} ${finding.unit ?? '-'} ${finding.implementation ?? '-'} ${finding.place ?? '-'} ${finding.message}`).sort((left, right) => left.localeCompare(right));
  assert.deepEqual(describe(api.findings), describe(all.findings.filter(finding => finding.rule !== 'R3')));
  assert.deepEqual(api.ledger.runs, []);
});

test('K720 bindings phase runs selected native bindings once without public symbol extraction', TIMEOUT, (t) => {
  const root = repository(t);
  const lines: string[] = [];
  const { findings, ledger } = checkParity(root, { phase: 'bindings', implementations: ['go'], env: ENV, say: line => lines.push(line) });
  assert.deepEqual(findings, []);
  assert.ok(ledger.runs.length > 0);
  assert.ok(ledger.runs.every(run => run.implementation === 'go'));
  for (const unit of new Set(ledger.runs.map(run => run.unit))) assert.equal(ledger.runs.filter(run => run.unit === unit).length, 1);
  assert.doesNotMatch(lines.join('\n'), /extract the symbols of /);
  assert.ok(lines.some(line => line.includes('bindings phase for go: native bindings run once; public symbol extraction is skipped')));
});

test('K720 phase CLI scopes partial passes and rejects unknown phases, invalid selections, missing cases, and declaration conflicts', TIMEOUT, (t) => {
  const run = (root: string, ...args: string[]) => spawnSync(process.execPath, [tool(import.meta.resolve('../../scripts/kit/parity.mts')), ...args], { cwd: root, env: ENV, encoding: 'utf8' });
  const root = repository(t);

  const apiPhase = run(root, '--phase', 'api');
  assert.equal(apiPhase.status, 0, apiPhase.stdout + apiPhase.stderr);
  assert.equal((apiPhase.stdout.match(/\[parity\] extract the symbols of /g) ?? []).length, CONFIG.implementations.length);
  assert.match(apiPhase.stdout, /API phase ran no native bindings/);
  assert.match(apiPhase.stdout, /API phase passed; native bindings were not run, so this is not a full parity pass/);
  assert.doesNotMatch(apiPhase.stdout, /\[parity\] run /);

  const bindingsPhase = run(root, '--phase', 'bindings', '--implementation', 'go');
  assert.equal(bindingsPhase.status, 0, bindingsPhase.stdout + bindingsPhase.stderr);
  assert.match(bindingsPhase.stdout, /bindings ran,/);
  assert.match(bindingsPhase.stdout, /bindings phase passed; public API extraction was not run, so this is not a full parity pass/);
  assert.doesNotMatch(bindingsPhase.stdout, /extract the symbols of /);

  const unknownPhase = run(root, '--phase', 'unknown');
  assert.equal(unknownPhase.status, 1, unknownPhase.stdout + unknownPhase.stderr);
  assert.match(unknownPhase.stderr, /--phase unknown is unknown; choose all, api, or bindings/);
  assert.doesNotMatch(unknownPhase.stdout, /\[parity\] run /);

  const unknownRuntime = run(root, '--phase', 'bindings', '--implementation', 'missing');
  assert.equal(unknownRuntime.status, 1, unknownRuntime.stdout + unknownRuntime.stderr);
  assert.match(unknownRuntime.stderr, /--implementation missing names no implementation/);
  assert.doesNotMatch(unknownRuntime.stdout, /\[parity\] run /);

  const emptyRuntime = run(root, '--phase', 'bindings', '--implementation', '');
  assert.equal(emptyRuntime.status, 1, emptyRuntime.stdout + emptyRuntime.stderr);
  assert.match(emptyRuntime.stderr, /--implementation needs one or more nonempty implementation names/);
  assert.doesNotMatch(emptyRuntime.stdout, /\[parity\] run /);

  const declarationConflict = run(root, '--declarations', '--phase', 'api');
  assert.equal(declarationConflict.status, 1, declarationConflict.stdout + declarationConflict.stderr);
  assert.match(declarationConflict.stderr, /--declarations cannot be combined with --phase api/);
  assert.doesNotMatch(declarationConflict.stdout, /extract the symbols of |\[parity\] run /);

  const missingCaseRoot = repository(t, { files: { 'go/codec_test.go': 'PASS TestCodec/empty\n' } });
  const missingCase = run(missingCaseRoot, '--phase', 'bindings', '--implementation', 'go');
  assert.equal(missingCase.status, 1, missingCase.stdout + missingCase.stderr);
  assert.match(missingCase.stderr, /R3 not-executed codec go go\/codec_test\.go: not executed: ascii/);
  assert.match(missingCase.stdout, /bindings ran,/);
  assert.doesNotMatch(missingCase.stdout, /extract the symbols of /);
});
