// Tests of scripts/kit/owner-check.mts: the validation of the declaration, the selection of the owners of changed paths
// and the command that runs them. Each rule has a passing and a failing case.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { commandsOf, importGraph, makeDatabase, npmProject, parseMakeDatabase, select, suiteTargets, validate } from '../../scripts/kit/owner-check.mts';
import type { OwnerDeclaration } from '../../scripts/kit/owner-check.mts';
import { trackedFiles } from '../../scripts/kit/tracked-files.mts';
import { readConfig } from '../../scripts/kit/schema-validate.mts';
import { put, tree } from './tree.mts';
import { tool } from './kit-tools.mts';
import { known } from './known.mts';

const MAKEFILE = `CHECK_TARGETS := docs-check unit-test lint
include extra.mk

docs-check:
\t@echo docs
unit-test: build
\t@echo unit
build:
\t@echo build
lint:
\t@echo lint
check:
\tnode scripts/kit/ci-targets.mts var/report/ci docs-check unit-test lint
`;
const FILES = {
  Makefile: MAKEFILE,
  'extra.mk': 'extra-check:\n\t@echo extra\n',
  'README.md': '# readme\n',
  'src/a.js': '1\n',
  'tests/a.test.mjs': '1\n',
  'package.json': JSON.stringify({ scripts: { 'test:forms': 'x' }, workspaces: ['packages/*'] }),
  'packages/one/package.json': JSON.stringify({ name: '@x/one', scripts: { test: 'x' } }),
  'tools/bench/package.json': JSON.stringify({ name: 'bench', scripts: { test: 'x' } }),
  'packages/none/package.json': JSON.stringify({ name: '@x/none' }),
};
const DECLARATION: OwnerDeclaration & { schema: number } = {
  schema: 1,
  always: ['tests/a.test.mjs'],
  owners: [
    { paths: ['*.md'], targets: ['docs-check'] },
    { paths: ['src/**'], targets: ['unit-test', 'extra-check'], scripts: ['test:forms'], tests: ['tests/a.test.mjs'] },
    { paths: ['tests/*.test.mjs'], tests: ['$path'] },
    { paths: ['Makefile', 'extra.mk', 'package.json'], targets: ['lint'] },
    { paths: ['packages/one/**'], workspaces: ['@x/one'] },
    { paths: ['packages/none/**'], targets: ['lint'] },
    { paths: ['tools/bench/**'], prefixes: ['tools/bench'] },
  ],
};

function project(t: TestContext, files: Record<string, string> = FILES) {
  const root = tree(t, files);
  const tracked = trackedFiles(root);
  return { root, tracked, project: { make: makeDatabase(root), ...npmProject(root, tracked) } };
}
const errorsOf = (t: TestContext, declaration: OwnerDeclaration, files?: Record<string, string>) => {
  const { tracked, project: found } = project(t, files);
  return validate(declaration, tracked, found, file => tracked.includes(file));
};
const has = (errors: string[], ...parts: string[]) => assert.ok(errors.some(line => parts.every(part => line.includes(part))), `expected ${parts.join(' ... ')}\nin\n${errors.join('\n')}`);

test('npm workspaces are a list; the object form of Yarn is refused, not read as no workspaces', (t) => {
  assert.throws(() => project(t, { ...FILES, 'package.json': JSON.stringify({ workspaces: { packages: ['packages/*'] } }) }), /package\.json: \/workspaces must be array \{"type":"array"\}/);
});

test('a declaration that owns every path passes, with targets of an included file and the npm project', (t) => {
  const { tracked, project: found } = project(t);
  assert.deepEqual(found.workspaces, ['@x/one']);
  assert.deepEqual(found.prefixes, ['tools/bench']);
  assert.deepEqual(Object.keys(found.scripts), ['test:forms']);
  assert.deepEqual(validate(DECLARATION, tracked, found, file => tracked.includes(file)), []);
  assert.deepEqual(suiteTargets(found.make), ['docs-check', 'unit-test', 'lint']);
});

test('a tracked path without an owner and a glob without a path fail', (t) => {
  // DECLARATION declares seven owners.
  const declaration = { ...DECLARATION, owners: [known(DECLARATION.owners[1], 'DECLARATION.owners[1]'), { paths: ['gone/**'], targets: ['lint'] }] };
  const errors = errorsOf(t, declaration);
  has(errors, 'README.md', 'matches no owner in config/owner-checks.json', 'add a rule');
  has(errors, 'the glob gone/** matches no tracked path');
});

test('a target that is not in the Makefile and a target that runs the full suite fail', (t) => {
  const missing = errorsOf(t, { ...DECLARATION, owners: [...DECLARATION.owners, { paths: ['src/**'], targets: ['nope'] }] });
  has(missing, 'the target nope of src/** is not a target of the Makefile');
  const full = errorsOf(t, { ...DECLARATION, owners: [...DECLARATION.owners, { paths: ['src/**'], targets: ['check'] }] });
  has(full, 'the target check of src/** runs the full suite');
  const named = errorsOf(t, { ...DECLARATION, fullSuite: ['lint'] });
  has(named, 'the target lint', 'runs the full suite');
  has(errorsOf(t, { ...DECLARATION, fullSuite: ['absent'] }), 'fullSuite names absent');
});

test('a target that runs ci-targets through $(KIT) of kit.mk is a full-suite target (K71-2)', (t) => {
  // kit.mk names its tools as $(KIT)/<tool>.$(KIT_EXT), so a repository writes the full run the same way.
  const makefile = `${MAKEFILE}gate:\n\tnode $(KIT)/ci-targets.$(KIT_EXT) var/report/ci docs-check lint\n`;
  const full = errorsOf(t, { ...DECLARATION, owners: [...DECLARATION.owners, { paths: ['src/**'], targets: ['gate'] }] }, { ...FILES, Makefile: makefile });
  has(full, 'the target gate of src/** runs the full suite');
});

test('a rule that selects every target of CHECK_TARGETS fails', (t) => {
  const errors = errorsOf(t, { ...DECLARATION, owners: [...DECLARATION.owners, { paths: ['src/**'], targets: ['docs-check', 'unit-test', 'lint'] }] });
  has(errors, 'a rule selects every target of CHECK_TARGETS');
});

test('a script, workspace, directory, test file or test target that does not exist fails', (t) => {
  const errors = errorsOf(t, {
    ...DECLARATION,
    always: ['tests/absent.mjs'],
    testTarget: 'absent-target',
    owners: [...DECLARATION.owners, { paths: ['src/**'], scripts: ['absent'], workspaces: ['@x/none'], prefixes: ['packages/none'], tests: ['tests/missing.test.mjs'] }, { paths: ['src/**'], variable: 'CASES' }],
  });
  has(errors, 'the script absent of src/** is not a script of package.json');
  has(errors, 'the workspace @x/none of src/** is not a workspace with a test script');
  has(errors, 'the directory packages/none of src/** is not a package directory with a test script');
  has(errors, 'the test tests/missing.test.mjs of src/** does not exist');
  has(errors, 'the test tests/absent.mjs of always does not exist');
  has(errors, 'testTarget absent-target is not a target');
  has(errors, 'sets the variable CASES but selects no target');
});

test('inputs: a path that a check reads needs a rule that selects the check or a target that runs it', (t) => {
  const inputs = (check: string, paths: string[]) => ({ ...DECLARATION, inputs: [{ check, paths }] });
  assert.deepEqual(errorsOf(t, inputs('make build', ['src/a.js'])), [], 'unit-test has the prerequisite build');
  assert.deepEqual(errorsOf(t, inputs('npm run test:forms', ['src/a.js'])), []);
  has(errorsOf(t, inputs('make lint', ['src/a.js'])), 'src/a.js: an input of make lint, which no owner rule of the path selects');
  has(errorsOf(t, inputs('make absent', ['src/a.js'])), 'inputs of "make absent" name no make target');
  has(errorsOf(t, inputs('make lint', ['nothing/**'])), 'the input glob nothing/** of make lint matches no tracked path');
});

test('the targets and prerequisites are those of make: a variable expands, and a target-specific variable is no prerequisite (K121)', (t) => {
  // make reads `unit-test: $(STEP)` as the prerequisite compile, and `unit-test: export MODE := strict` as a variable of unit-test.
  const makefile = 'STEP := compile\nunit-test: $(STEP)\n\t@echo unit\nunit-test: export MODE := strict\ncompile:\n\t@echo compile\n';
  const declaration = { schema: 1, owners: [{ paths: ['src/**'], targets: ['unit-test'] }, { paths: ['Makefile'], targets: ['compile'] }], inputs: [{ check: 'make compile', paths: ['src/a.js'] }] };
  assert.deepEqual(errorsOf(t, declaration, { Makefile: makefile, 'src/a.js': '1\n' }), []);
});

test('the database of GNU make 4.x, which prints a target-specific variable as a line before the rule, gives the prerequisites (K121)', () => {
  // The Files section that GNU make 4.4.1 prints for the Makefile of the case above (`make -pRrq`, trimmed): the variable
  // MODE of unit-test is the line `unit-test: MODE := strict` after its origin comment, before the rule `unit-test: compile`.
  const database = [
    '# Make data base, printed by GNU make 4.4.1',
    '# makefile (from \'Makefile\', line 1)',
    'STEP := compile',
    '',
    '# Files',
    'compile:',
    '#  File does not exist.',
    '#  recipe to execute (from \'Makefile\', line 6):',
    '\t@echo compile',
    '',
    '# makefile (from \'Makefile\', line 4)',
    'unit-test: MODE := strict',
    'unit-test: compile',
    '#  File does not exist.',
    '#  recipe to execute (from \'Makefile\', line 3):',
    '\t@echo unit',
    '',
    '# files hash-table stats:',
    '',
  ].join('\n');
  const make = parseMakeDatabase(database);
  assert.deepEqual(Object.fromEntries([...make.targets].map(([name, { prerequisites, recipe }]) => [name, { prerequisites, recipe }])), {
    compile: { prerequisites: [], recipe: '@echo compile' },
    'unit-test': { prerequisites: ['compile'], recipe: '@echo unit' },
  });
  assert.equal(make.variables.get('STEP'), 'compile');
});

test('select: a changed path selects its owners; always, $path, variables and the suite order apply', () => {
  const declaration = {
    always: ['tests/always.test.mjs'],
    owners: [
      { paths: ['src/**'], targets: ['lint'], variable: 'CASES' },
      { paths: ['src/**'], targets: ['docs-check'], scripts: ['s'] },
      { paths: ['tests/*.test.mjs'], tests: ['$path'] },
    ],
  };
  const result = select(declaration, ['src/a.js', 'src/b.js', 'tests/x.test.mjs'], ['docs-check', 'lint'], () => true);
  assert.deepEqual(result.checks.map(check => check.name), ['make docs-check', 'make lint CASES=src/a.js src/b.js', 'npm run s']);
  // The names above are three checks.
  assert.deepEqual(known(result.checks[1], 'result.checks[1]').args, ['--no-print-directory', 'lint', 'CASES=src/a.js src/b.js']);
  assert.deepEqual(result.tests, ['tests/always.test.mjs', 'tests/x.test.mjs']);
  assert.deepEqual(result.unowned, []);
  assert.ok(result.reasons.includes('tests/x.test.mjs -> tests/x.test.mjs'));
});

test('select: a removed path that no rule owns selects nothing, an existing one is unowned, a removed test does not run', () => {
  const declaration = { owners: [{ paths: ['tests/*.test.mjs'], tests: ['$path'] }] };
  const result = select(declaration, ['gone.txt', 'here.txt', 'tests/gone.test.mjs'], [], file => file === 'here.txt');
  assert.deepEqual(result.unowned, ['here.txt']);
  assert.deepEqual(result.tests, []);
  assert.ok(result.reasons.includes('gone.txt -> nothing: the path was removed and no rule owns it'));
});

// A checkout whose tests reach their modules by import, re-export, import.meta.resolve and siblingTool (K191).
const GRAPH = {
  'src/leaf.mts': 'export const leaf = 1;\n',
  'src/middle.mts': "export { leaf } from './leaf.mts';\n",
  'src/started.mts': '1;\n',
  'src/starter.mts': "import { siblingTool } from './paths.mts';\nexport const started = siblingTool(import.meta.url, 'started');\n",
  'src/paths.mts': 'export const siblingTool = (url: string, name: string) => `${url}/${name}`;\n',
  'src/alone.mts': '1;\n',
  'src/data.json': '{}\n',
  'tests/leaf.test.mts': "import { leaf } from '../src/middle.mts';\nleaf;\n",
  'tests/spawn.test.mts': "import.meta.resolve('../src/starter.mts');\n",
  'tests/other.test.mts': "import '../src/started.mts';\n",
};
const IMPORTERS = ['tests/*.test.mts'];

function graph(t: TestContext, files: Record<string, string> = GRAPH) {
  const root = tree(t, files);
  const tracked = trackedFiles(root);
  return { tracked, importers: importGraph(root, tracked) };
}

test('importers: a changed module selects the tests that import it, directly or through other modules or started modules (K191)', (t) => {
  const { importers } = graph(t);
  const declaration = { owners: [{ paths: ['src/*.mts', 'tests/*.mts'], targets: ['lint'], importers: IMPORTERS }, { paths: ['src/data.json'], importers: IMPORTERS, modules: ['src/leaf.mts'] }] };
  const run = (...changed: string[]) => select(declaration, changed, [], () => true, importers).tests;
  assert.deepEqual(run('src/leaf.mts'), ['tests/leaf.test.mts'], 'a re-export carries the import');
  assert.deepEqual(run('src/started.mts'), ['tests/other.test.mts', 'tests/spawn.test.mts'], 'import.meta.resolve and siblingTool name the started module');
  assert.deepEqual(run('tests/leaf.test.mts'), ['tests/leaf.test.mts'], 'a changed test runs itself');
  assert.deepEqual(run('src/data.json'), ['tests/leaf.test.mts'], 'a path that is no module runs the importers of its modules');
  assert.deepEqual(select(declaration, ['src/leaf.mts'], [], () => true, importers).checks.map(check => check.name), ['make lint']);
});

test('importers: a module that no test imports fails, unless another rule of the path names its tests; modules must exist (K191)', (t) => {
  const { tracked, importers } = graph(t, { ...GRAPH, ...FILES });
  const { project: found } = project(t);
  const base = [{ paths: ['Makefile', 'extra.mk', 'package.json', 'README.md', 'src/a.js', 'tests/a.test.mjs', 'packages/**', 'tools/**', 'src/data.json'], targets: ['lint'] }];
  const errors = validate({ owners: [...base, { paths: ['src/*.mts', 'tests/*.mts'], importers: IMPORTERS }] }, tracked, found, () => true, importers);
  has(errors, 'src/alone.mts: no test of tests/*.test.mts imports it');
  assert.deepEqual(errors.filter(line => line.includes('imports it')).length, 1, errors.join('\n'));
  const owned = [...base, { paths: ['src/*.mts', 'tests/*.mts'], importers: IMPORTERS }, { paths: ['src/alone.mts'], tests: ['tests/leaf.test.mts'] }];
  assert.deepEqual(validate({ owners: owned }, tracked, found, () => true, importers), []);
  const missing = validate({ owners: [...owned, { paths: ['src/data.json'], importers: ['nothing/*.mts'], modules: ['src/gone.mts'] }] }, tracked, found, file => tracked.includes(file), importers);
  has(missing, 'the importers glob nothing/*.mts of src/data.json matches no tracked path');
  has(missing, 'the module src/gone.mts of src/data.json does not exist');
  has(validate({ owners: [...owned, { paths: ['src/data.json'], modules: ['src/leaf.mts'] }] }, tracked, found, () => true, importers), 'names modules but no importers');
});

test('importers: a computed import or a relative import of no file fails the graph (K191)', (t) => {
  assert.throws(() => graph(t, { 'src/a.mts': 'await import(name);\n', 'tests/a.test.mts': "import '../src/a.mts';\n" }).importers(['src/a.mts'], IMPORTERS), /src\/a\.mts: imports a computed specifier/);
  assert.throws(() => graph(t, { 'tests/a.test.mts': "import '../src/gone.mts';\n" }).importers(['src/a.mts'], IMPORTERS), /tests\/a\.test\.mts: imports \.\.\/src\/gone\.mts, which is no file/);
});

test("kit's owner rules: a change of scripts/kit/present.mts runs the tests that import it, not kit-test (K191)", () => {
  const root = path.resolve(import.meta.dirname, '../..');
  const tracked = trackedFiles(root);
  const declaration = readConfig<OwnerDeclaration>(root, 'config/owner-checks.json', 'owner-checks.schema.json');
  const result = select(declaration, ['scripts/kit/present.mts'], [], () => true, importGraph(root, tracked));
  assert.ok(!result.checks.some(check => check.target === 'kit-test'), result.checks.map(check => check.name).join(', '));
  assert.ok(result.tests.includes('tests/kit/owner-check.test.mts'), 'owner-check imports present.mts');
  assert.ok(!result.tests.includes('tests/kit/glob.test.mts'), 'glob.mts imports no present.mts');
});

// K904: each rule test runs with a change of what it reads: the rules, the Makefile and the entry points that check-rules
// reaches; every file of scripts/kit and tests/kit that isolation scans; every module of tests/kit that sandbox-repository scans.
test("kit's owner rules: a change of what a rule test reads runs that test (K904)", () => {
  const root = path.resolve(import.meta.dirname, '../..');
  const declaration = readConfig<OwnerDeclaration>(root, 'config/owner-checks.json', 'owner-checks.schema.json');
  const importers = importGraph(root, trackedFiles(root));
  const selected = (file: string) => select(declaration, [file], [], () => true, importers).tests;
  for (const file of ['PRINCIPLES.md', 'PRINCIPLES.ko.md', 'AGENTS.md', 'Makefile', 'scripts/kit/kit.mk', '.github/workflows/ci.yml', '.githooks/pre-commit']) assert.ok(selected(file).includes('tests/kit/check-rules.test.mts'), file);
  for (const file of ['scripts/kit/kit.mk', 'scripts/kit/glob.mts', 'tests/kit/tree.mts', 'tests/kit/glob.test.mts']) assert.ok(selected(file).includes('tests/kit/isolation.test.mts'), file);
  for (const file of ['tests/kit/tree.mts', 'tests/kit/glob.test.mts']) assert.ok(selected(file).includes('tests/kit/sandbox-repository.test.mts'), file);
});

test('the tests run through run-tests.mts or through the declared test target', () => {
  const selection = { checks: [], tests: ['tests/a.test.mjs', 'tests/b.test.mjs'] };
  const direct = commandsOf(selection, {});
  assert.deepEqual(direct.map(command => command.args), [[path.join(path.dirname(fileURLToPath(import.meta.url)), '../../scripts/kit/run-tests.mts'), 'node', '--', 'tests/a.test.mjs', 'tests/b.test.mjs']]);
  const target = commandsOf(selection, { testTarget: 'test-scripts' });
  // A selection with tests has the command of the tests.
  assert.deepEqual(known(target[0], 'target[0]').args, ['--no-print-directory', 'test-scripts', 'TESTS=tests/a.test.mjs tests/b.test.mjs']);
  assert.deepEqual(commandsOf({ checks: [], tests: [] }, {}), []);
});

// Running the owners is a group of the suite, which runs only in CI (ci-only.mts); `ci` marks the run as one.
function command(root: string, args: string[], { ci = true }: { ci?: boolean } = {}) {
  return spawnSync(process.execPath, [tool(import.meta.resolve('../../scripts/kit/owner-check.mts')), ...args], { cwd: root, encoding: 'utf8', env: { ...process.env, GITHUB_ACTIONS: ci ? 'true' : '' } });
}

function checkout(t: TestContext, declaration: OwnerDeclaration = DECLARATION, files: Record<string, string> = {}) {
  return tree(t, { ...FILES, ...files, 'config/owner-checks.json': JSON.stringify(declaration) });
}
const full = { ...DECLARATION, owners: [...DECLARATION.owners, { paths: ['config/**'], targets: ['lint'] }] };

test('the command validates the declaration and names each error', (t) => {
  const root = checkout(t, DECLARATION);
  const failed = command(root, ['--validate']);
  assert.equal(failed.status, 1, failed.stdout + failed.stderr);
  assert.match(failed.stderr, /\[owner-check\] config\/owner-checks\.json: the path matches no owner in config\/owner-checks\.json; add a rule/);
  const passed = command(checkout(t, full), ['--validate']);
  assert.equal(passed.status, 0, passed.stdout + passed.stderr);
  assert.match(passed.stdout, /owns every tracked path/);
});

test('the command prints the selection of --dry-run and fails for an unowned path', (t) => {
  const root = checkout(t, full);
  const dry = command(root, ['--paths', 'README.md src/a.js', '--dry-run']);
  assert.equal(dry.status, 0, dry.stdout + dry.stderr);
  assert.match(dry.stdout, /2 changed paths select make docs-check; make unit-test; make extra-check; npm run test:forms; node tests tests\/a\.test\.mjs/);
  put(root, { 'new.bin': 'x' });
  const unowned = command(root, ['--paths', 'new.bin', '--dry-run']);
  assert.equal(unowned.status, 1, unowned.stdout + unowned.stderr);
});

test('the command runs every selected check, also after one failed, and lists the failures', (t) => {
  const makefile = 'CHECK_TARGETS := first second third\nfirst:\n\t@echo ran-first\nsecond:\n\t@echo ran-second; exit 3\nthird:\n\t@echo ran-third\n';
  const root = tree(t, { Makefile: makefile, 'a.txt': 'x', 'config/owner-checks.json': JSON.stringify({ schema: 1, owners: [{ paths: ['a.txt'], targets: ['first', 'second'] }, { paths: ['Makefile', 'config/**'], targets: ['third'] }] }) });
  const run = command(root, ['--paths', 'a.txt']);
  assert.equal(run.status, 1, run.stdout + run.stderr);
  assert.match(run.stdout, /ran-first/);
  assert.match(run.stdout, /ran-second/);
  assert.match(run.stdout, /\[owner-check\] make first passed in [\d.]+ s/);
  assert.match(run.stdout, /\[owner-check\] make second failed with 2 in [\d.]+ s/);
  assert.match(run.stdout, /\[owner-check\] failed: make second/);
  const ok = command(root, ['--paths', 'Makefile']);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.match(ok.stdout, /every owner check passed/);
});

test('the command fails with the fix when the declaration is missing', (t) => {
  const root = tree(t, { 'a.txt': 'x' });
  const run = command(root, ['--validate']);
  assert.equal(run.status, 1);
  assert.match(run.stderr, /config\/owner-checks\.json does not exist; declare the owner of each path there/);
});

test('running the owners refuses outside CI and runs no check; --dry-run prints the selection', (t) => {
  const makefile = 'CHECK_TARGETS := first second\nfirst:\n\t@echo ran-first\nsecond:\n\t@echo ran-second\n';
  const root = tree(t, { Makefile: makefile, 'a.txt': 'x', 'config/owner-checks.json': JSON.stringify({ schema: 1, owners: [{ paths: ['a.txt'], targets: ['first'] }, { paths: ['Makefile', 'config/**'], targets: ['second'] }] }) });
  const refused = command(root, ['--paths', 'a.txt'], { ci: false });
  assert.equal(refused.status, 1, refused.stdout + refused.stderr);
  assert.match(refused.stderr, /make owner-check runs only in CI/);
  assert.doesNotMatch(refused.stdout, /ran-first/);
  const dry = command(root, ['--paths', 'a.txt', '--dry-run'], { ci: false });
  assert.equal(dry.status, 0, dry.stdout + dry.stderr);
});
