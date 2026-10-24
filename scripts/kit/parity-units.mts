// The rules of the language-parity check that compare the units with the tree, without running anything: R1 (an API unit
// without the exported symbol of an implementation), R2 (a suite or feature without a binding of an implementation), R4 (a
// suite file that no unit declares), R5 (a test file that no binding runs), R6 (a binding test outside its implementation)
// and R11 (an exported symbol that no API unit declares).
import path from 'node:path';
import { matchesAny } from './glob.mts';
import { CONVENTIONS, finding, sharedRoots, testNamed, within } from './parity-declaration.mts';
import type { ParityModel, ParityUnit, Runner } from './parity-declaration.mts';
import { present } from './present.mts';

/** The pairs of each unit of `kind` with each applicable implementation, in declaration order. */
export function pairs(model: ParityModel, kind: ParityUnit['kind']) {
  return model.config.units.filter(unit => unit.kind === kind).flatMap(unit => (model.unitImplementations.get(unit.id) ?? model.config.implementations).map(implementation => ({ unit, implementation })));
}

/** The public symbols of each implementation, by its name, as its extractor gave them (parity-symbols.mts). */
export type Snapshots = ReadonlyMap<string, ReadonlySet<string>>;

/**
 * R1: each API unit has a public symbol in each implementation. An implementation whose extractor failed has no
 * snapshot, and that failure is already its finding.
 */
export function missingImplementations(model: ParityModel, snapshots: Snapshots) {
  return pairs(model, 'api').flatMap(({ unit, implementation }) => {
    const where = { unit: unit.id, implementation: implementation.name, place: implementation.symbols?.entry };
    // readDeclaration requires symbols of an API unit, and the rules do not run on a declaration with findings.
    const declared = present(unit.symbols, 'unit.symbols').find(entry => entry.implementation === implementation.name);
    if (!declared) return [finding('R1', `the API unit ${unit.id} declares no symbol of ${implementation.name}`, where)];
    const snapshot = snapshots.get(implementation.name);
    if (snapshot === undefined || snapshot.has(declared.symbol)) return [];
    return [finding('R1', `${declared.symbol} is no public symbol of ${implementation.name}, as its ${implementation.symbols?.extractor} extractor reads ${implementation.symbols?.entry}`, where)];
  });
}

/** R2: each suite and feature unit has a binding of each applicable implementation. */
export function missingBindings(model: ParityModel) {
  return [...pairs(model, 'suite'), ...pairs(model, 'feature')]
    // readDeclaration reports a suite or feature unit without bindings, and the rules do not run on a declaration with findings.
    .filter(({ unit, implementation }) => !present(unit.bindings, 'unit.bindings').some(entry => entry.implementation === implementation.name))
    .map(({ unit, implementation }) => finding('R2', `${unit.file ?? `the feature ${unit.id}`} has no binding of ${implementation.name}`, { unit: unit.id, implementation: implementation.name, place: unit.file }));
}

/** R4: each file of the suite globs is the file of a suite unit or lies in the case directory of one. */
export function undeclaredSuites(model: ParityModel, files: Iterable<string>) {
  const declared = model.config.units.flatMap(unit => (unit.file === undefined ? [] : [unit.file]));
  return [...files].filter(file => matchesAny(model.config.suites ?? [], file) && !declared.some(name => name === file || within(name, file)))
    .map(file => finding('R4', 'the vector file is the file of no suite unit; declare a unit for it', { place: file }));
}

/** Whether `file` is a support file of an implementation of `runner`: it holds no test of that runner. */
const supportFile = (model: ParityModel, runner: Runner, file: string) => model.config.implementations.some(implementation => implementation.runner === runner && matchesAny(implementation.support ?? [], file));

/**
 * R5: each test file of an implementation, except its support files, is the test of a binding of that implementation; so is
 * each file in its roots that is named like a test and that no convention selects (R6 judges a test of another runner), which
 * its runner does not run unless a binding names it.
 */
export function undeclaredTests(model: ParityModel, files: Iterable<string>) {
  const tests = new Set([...model.tests.values()].flat());
  const support = (file: string) => model.config.implementations.some(implementation => matchesAny(implementation.support ?? [], file));
  return model.config.implementations.flatMap((implementation) => {
    const bound = new Set(model.config.units.flatMap(unit => unit.bindings ?? []).filter(entry => entry.implementation === implementation.name).map(entry => entry.test));
    // readDeclaration gives each implementation its test files.
    // A file below the directory of a bound tests/<name>/main.rs is a module of that cargo test target (K148).
    const targetDirectories = implementation.runner === 'cargo' ? [...bound].filter(test => test.endsWith('/main.rs') && path.posix.basename(path.posix.dirname(path.posix.dirname(test))) === 'tests').map(test => path.posix.dirname(test)) : [];
    const unbound = present(model.tests.get(implementation.name), 'model.tests.get(implementation.name)').filter(file => !bound.has(file) && !targetDirectories.some(directory => within(directory, file)) && !matchesAny(implementation.support ?? [], file) && !matchesAny((implementation.internal ?? []).map(item => item.glob), file))
      .map(file => finding('R5', `the test file of ${implementation.name} is the test of no binding, so no check runs it`, { implementation: implementation.name, place: file }));
    const named = [...files].filter(file => implementation.roots.some(root => within(root, file)) && testNamed(file) && !tests.has(file) && !model.testRunners.has(file) && !bound.has(file) && !support(file))
      .map(file => finding('R5', `the file is named like a test, and the ${implementation.runner} convention of ${implementation.name} is ${CONVENTIONS[implementation.runner].join(', ')}; name it so, bind it, or declare it a support file`, { implementation: implementation.name, place: file }));
    return [...unbound, ...named].sort((left, right) => (left.place ?? '').localeCompare(right.place ?? ''));
  });
}

// The vendored tools and tests of kit, which test kit and belong to no implementation.
const KIT_DIRECTORIES = ['scripts/kit', 'tests/kit'];

/**
 * R6: the test of each binding lies in a root of its implementation, in a root of the implementation it shares (K232) or in a
 * comparator root, and every other file of the test
 * patterns of a runner, except a support file of an implementation of that runner, lies in a root of an implementation of that
 * runner, in a comparator root or in a tools root.
 */
export function misplacedTests(model: ParityModel, files: Iterable<string>) {
  const comparators = model.config.comparators ?? [];
  const tools = (model.config.tools ?? []).map(tool => tool.root);
  const inComparator = (file: string) => comparators.some(root => within(root, file));
  const internalGlobs = model.config.implementations.flatMap(entry => (entry.internal ?? []).map(item => item.glob));
  const bound = model.config.units.flatMap(unit => (unit.bindings ?? []).map(entry => ({ unit, entry })));
  const bindings = bound.flatMap(({ unit, entry }) => {
    // readDeclaration reports a binding of an implementation that is no declared implementation.
    const implementation = present(model.implementations.get(entry.implementation), 'model.implementations.get(entry.implementation)');
    const roots = [...implementation.roots, ...sharedRoots(implementation, model.implementations)];
    return roots.some(root => within(root, entry.test)) || inComparator(entry.test) ? [] : [finding('R6', `the test lies outside ${roots.join(', ')}, the roots of ${entry.implementation}`, { unit: unit.id, implementation: entry.implementation, place: entry.test })];
  });
  const tests = new Set(bound.map(({ entry }) => entry.test));
  const patterns = [...files].filter(file => !tests.has(file) && !inComparator(file) && !matchesAny(internalGlobs, file) && ![...KIT_DIRECTORIES, ...tools].some(root => within(root, file))).flatMap((file) => {
    // Conventions overlap (a *.test.ts file is a node and a vitest test), so a file lies in a root of one of its runners.
    const runners = (model.testRunners.get(file) ?? []).filter(runner => !supportFile(model, runner, file));
    if (!runners.length) return [];
    const roots = model.config.implementations.filter(entry => runners.includes(entry.runner)).flatMap(entry => entry.roots);
    if (roots.some(root => within(root, file))) return [];
    const named = runners.join(' or ');
    return [finding('R6', `a ${named} test outside ${roots.join(', ') || 'nothing'}, the roots of the ${named} implementations, and outside ${comparators.join(', ') || 'nothing'}, the comparator roots; move it into the package of its implementation`, { place: file })];
  });
  return [...bindings, ...patterns];
}

/** R11: each public symbol of an implementation is the symbol of an API unit of it. */
export function undeclaredPublic(model: ParityModel, snapshots: Snapshots) {
  return model.config.implementations.flatMap((implementation) => {
    const snapshot = snapshots.get(implementation.name);
    if (snapshot === undefined) return [];
    const declared = new Set(model.config.units.flatMap(unit => unit.symbols ?? []).filter(entry => entry.implementation === implementation.name).map(entry => entry.symbol));
    return [...snapshot].filter(id => !declared.has(id)).map(id => finding('R11', `${id} is public, and no API unit declares it`, { implementation: implementation.name, place: implementation.symbols?.entry }));
  });
}
