#!/usr/bin/env node
// Runs the owner checks of the changed paths (`make owner-check`). config/owner-checks.json declares, for globs of
// repository paths, the checks that own them: make targets, scripts of the root package.json, the test script of
// workspaces and of package directories, and node test files. The command runs exactly the owners of the paths that a
// change touches, never the full suite.
//
// The declaration is checked on every run, before any owner runs (`--validate` checks only that):
//   - every tracked path matches a rule, and every glob matches a tracked path (new files that Git does not ignore count);
//   - every target exists in the Makefile or a file it includes and does not run the full suite, no rule selects every
//     target of CHECK_TARGETS, every script, workspace and package directory exists, every test file exists;
//   - for `inputs`, each path that a check reads has a rule that selects the check or a target that runs it.
// Every selected check runs to its end, also after an earlier one failed, and the failures are listed together.
//
//   node scripts/kit/owner-check.mts [--paths "<path> ..."] [--base <revision>] [--dry-run] [--validate]
//     --paths     the changed paths; default: the uncommitted tracked changes and the new files that Git does not ignore
//     --base      the changed paths are those between <revision> and the working tree
//     --dry-run   print the selection without running it
//     --validate  check the declaration only
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { globExpression } from './glob.mts';
import { trackedFiles } from './tracked-files.mts';
import { isMain, ROOT, siblingTool } from './paths.mts';
import { git } from './git.mts';

export const DECLARATION = 'config/owner-checks.json';

/** A rule of config/owner-checks.json (scripts/kit/schema/owner-checks.schema.json): globs of paths and the checks that own them. */
export type OwnerRule = {
  paths: string[];
  targets?: string[];
  scripts?: string[];
  workspaces?: string[];
  prefixes?: string[];
  tests?: string[];
  variable?: string;
};

/** The declaration of config/owner-checks.json. */
export type OwnerDeclaration = {
  always?: string[];
  testTarget?: string;
  fullSuite?: string[];
  owners: OwnerRule[];
  inputs?: { check: string; paths: string[] }[];
};

/** The scripts of the root package.json and the workspaces and package directories that have a test script. */
export type NpmProject = { scripts: Record<string, string>; workspaces: string[]; prefixes: string[] };

/** The targets of a checkout as make reads them: the prerequisites and the recipe of each target, and the variables. */
export type MakeDatabase = { targets: Map<string, { prerequisites: string[]; recipe: string }>; variables: Map<string, string> };

/** The npm project with the targets of make. */
export type Project = NpmProject & { make: MakeDatabase };

/** A check as the name that `inputs` uses, its make target when it is one, and the command that runs it. */
export type Check = { name: string; target?: string; command: string; args: string[] };

/** Whether the path of the checkout exists. */
type Exists = (file: string) => boolean;

/**
 * The targets and variables of the Makefile of `root` from the database that GNU make prints (`make -pRrq`), so that an
 * included file, a variable in a prerequisite and a target-specific variable are read as make reads them. A checkout
 * without a Makefile has no target.
 */
export function makeDatabase(root: string): MakeDatabase {
  if (!existsSync(path.join(root, 'Makefile'))) return { targets: new Map(), variables: new Map() };
  // -q runs no recipe; its exit status says whether the default goal is up to date, so only the printed database counts.
  const result = spawnSync('make', ['-pRrq', '-f', 'Makefile'], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 });
  if (result.error) throw new Error(`make could not start: ${result.error.message}`);
  if (!result.stdout.includes('# Make data base')) throw new Error(`make printed no database of ${path.join(root, 'Makefile')}: ${result.stderr.trim()}`);
  return parseMakeDatabase(result.stdout);
}

/** The targets and the makefile variables of the database text that `make -pRrq` prints. */
export function parseMakeDatabase(text: string): MakeDatabase {
  const variables = new Map<string, string>();
  const lines = text.split('\n');
  lines.forEach((line, index) => {
    const assignment = /^([^#\s=:]+) (?::{1,2}=|\?=|=) ?(.*)$/.exec(line);
    // A variable of a makefile follows its origin comment; the groups of the pattern always take part in a match.
    if (assignment && lines[index - 1]?.startsWith('# makefile')) variables.set(assignment[1]!, assignment[2]!);
  });
  const targets = new Map<string, { prerequisites: string[]; recipe: string }>();
  const files = text.slice(text.indexOf('\n# Files\n'), text.indexOf('\n# files hash-table stats'));
  for (const entry of files.split('\n\n')) {
    const entryLines = entry.split('\n').filter(Boolean);
    if (entryLines[0] === '# Not a target:') continue;
    // The rule is the first line that is no comment, no recipe line and no target-specific variable: GNU make 4.x prints such
    // a variable as `<target>: <name> := <value>` after its origin comment (`# makefile (from …)`), before the rule; make 3.81
    // prints it as comments after the rule.
    const rule = entryLines.find((line, index) => !line.startsWith('#') && !line.startsWith('\t') && !/^# (?:makefile|command line|environment|override|automatic|default)\b/.test(entryLines[index - 1] ?? ''));
    const match = rule === undefined ? null : /^(.+?)::?(?:\s+(.*))?$/.exec(rule);
    // The first group of the pattern always takes part in a match; a special target such as .PHONY is no check.
    if (!match || match[1]!.startsWith('.')) continue;
    const name = match[1]!;
    const prerequisites = (match[2] ?? '').split(/\s+/).filter(word => word && word !== '|');
    const recipe = entryLines.filter(line => line.startsWith('\t')).map(line => line.slice(1)).join('\n');
    // A double-colon target has an entry for each of its rules.
    const known = targets.get(name);
    targets.set(name, known ? { prerequisites: [...known.prerequisites, ...prerequisites], recipe: `${known.recipe}\n${recipe}` } : { prerequisites, recipe });
  }
  return { targets, variables };
}

/** The prerequisites of each target of make. */
function makePrerequisites(make: MakeDatabase) {
  return new Map([...make.targets].map(([name, { prerequisites }]) => [name, prerequisites]));
}

/** The targets that `target` runs: itself and its prerequisites, transitively. */
function closure(target: string, prerequisites: Map<string, string[]>, result = new Set<string>()): Set<string> {
  if (result.has(target)) return result;
  result.add(target);
  for (const prerequisite of prerequisites.get(target) ?? []) closure(prerequisite, prerequisites, result);
  return result;
}

/** The targets of the suite, in order: the words of the make variable CHECK_TARGETS. */
export function suiteTargets(make: MakeDatabase) {
  return (make.variables.get('CHECK_TARGETS') ?? '').split(/\s+/).filter(Boolean);
}

/**
 * The targets that run the full suite: those the declaration names and those whose recipe starts full-run, by its path in
 * kit (`scripts/kit/full-run.mts`) or as kit.mk names it (`$(KIT)/full-run.$(KIT_EXT)`).
 */
export function fullSuiteTargets(make: MakeDatabase, declared: string[] = []) {
  const result = new Set(declared);
  for (const [name, { recipe }] of make.targets) if (/(?:scripts\/(?:kit\/)?|\$\(KIT\)\/)full-run\.(?:mts|\$\(KIT_EXT\))/.test(recipe)) result.add(name);
  return result;
}

/** The checks of a rule, each as the name that `inputs` uses and the command that runs it. */
export function ruleChecks(rule: OwnerRule): Check[] {
  return [
    ...(rule.targets ?? []).map(target => ({ name: `make ${target}`, target, command: 'make', args: ['--no-print-directory', target] })),
    ...(rule.scripts ?? []).map(script => ({ name: `npm run ${script}`, command: 'npm', args: ['run', script] })),
    ...(rule.workspaces ?? []).map(workspace => ({ name: `npm test -w ${workspace}`, command: 'npm', args: ['test', '-w', workspace] })),
    ...(rule.prefixes ?? []).map(prefix => ({ name: `npm test --prefix ${prefix}`, command: 'npm', args: ['test', '--prefix', prefix] })),
  ];
}

const compile = (declaration: OwnerDeclaration) => declaration.owners.map(rule => ({ ...rule, expressions: rule.paths.map(globExpression) }));

/**
 * The errors of the declaration against the tracked paths, the targets of make and the npm manifests. `project` holds
 * `make` (makeDatabase), `scripts` (the scripts of the root package.json), `workspaces` and `prefixes` (the names and
 * directories with a test script).
 */
export function validate(declaration: OwnerDeclaration, tracked: string[], project: Project, exists: Exists) {
  const errors: string[] = [];
  const targets = new Set(project.make.targets.keys());
  const fullSuite = fullSuiteTargets(project.make, declaration.fullSuite);
  const suite = suiteTargets(project.make);
  const rules = compile(declaration);
  for (const rule of rules) {
    const label = rule.paths.join(' ');
    rule.paths.forEach((glob, index) => {
      // expressions holds the expression of each glob of paths at its index.
      if (!tracked.some(file => rule.expressions[index]!.test(file))) errors.push(`${DECLARATION}: the glob ${glob} matches no tracked path; remove it or correct it`);
    });
    for (const target of rule.targets ?? []) {
      if (!targets.has(target)) errors.push(`${DECLARATION}: the target ${target} of ${label} is not a target of the Makefile or of a file it includes`);
      if (fullSuite.has(target)) errors.push(`${DECLARATION}: the target ${target} of ${label} runs the full suite, which an owner check never runs`);
    }
    for (const script of rule.scripts ?? []) if (!(script in project.scripts)) errors.push(`${DECLARATION}: the script ${script} of ${label} is not a script of package.json`);
    for (const workspace of rule.workspaces ?? []) if (!project.workspaces.includes(workspace)) errors.push(`${DECLARATION}: the workspace ${workspace} of ${label} is not a workspace with a test script`);
    for (const prefix of rule.prefixes ?? []) if (!project.prefixes.includes(prefix)) errors.push(`${DECLARATION}: the directory ${prefix} of ${label} is not a package directory with a test script`);
    for (const test of rule.tests ?? []) if (test !== '$path' && !exists(test)) errors.push(`${DECLARATION}: the test ${test} of ${label} does not exist`);
    if (rule.variable && !(rule.targets ?? []).length) errors.push(`${DECLARATION}: the rule of ${label} sets the variable ${rule.variable} but selects no target`);
  }
  for (const test of declaration.always ?? []) if (!exists(test)) errors.push(`${DECLARATION}: the test ${test} of always does not exist`);
  if (declaration.testTarget && !targets.has(declaration.testTarget)) errors.push(`${DECLARATION}: testTarget ${declaration.testTarget} is not a target of the Makefile or of a file it includes`);
  for (const target of declaration.fullSuite ?? []) if (!targets.has(target)) errors.push(`${DECLARATION}: fullSuite names ${target}, which is not a target of the Makefile or of a file it includes`);
  if (suite.length && rules.some(rule => suite.every(target => rule.targets?.includes(target)))) errors.push(`${DECLARATION}: a rule selects every target of CHECK_TARGETS, which is the full suite`);
  for (const file of tracked) {
    if (!rules.some(rule => rule.expressions.some(expression => expression.test(file)))) errors.push(`${file}: the path matches no owner in ${DECLARATION}; add a rule whose paths match it`);
  }
  // `inputs` names the paths that a check reads. For each of them a rule must select the check, or for a make target a
  // target that runs it as a prerequisite, so a change of the path runs a check that reads it.
  const prerequisites = makePrerequisites(project.make);
  const runs = new Map<string, Set<string>>();
  const selects = (rule: OwnerRule, check: string) => ruleChecks(rule).some(({ name, target }) => {
    if (name === check) return true;
    if (!target || !check.startsWith('make ')) return false;
    if (!runs.has(target)) runs.set(target, closure(target, prerequisites));
    // The line above sets every missing target.
    return runs.get(target)!.has(check.slice('make '.length));
  });
  const known = new Set([...targets].map(target => `make ${target}`).concat(
    Object.keys(project.scripts).map(script => `npm run ${script}`),
    project.workspaces.map(workspace => `npm test -w ${workspace}`),
    project.prefixes.map(prefix => `npm test --prefix ${prefix}`)));
  for (const { check, paths } of declaration.inputs ?? []) {
    if (!known.has(check)) {
      errors.push(`${DECLARATION}: the inputs of "${check}" name no make target, npm script, workspace or package directory; write make <target>, npm run <script>, npm test -w <workspace> or npm test --prefix <directory>`);
      continue;
    }
    for (const glob of paths) {
      const expression = globExpression(glob);
      const matched = tracked.filter(file => expression.test(file));
      if (!matched.length) errors.push(`${DECLARATION}: the input glob ${glob} of ${check} matches no tracked path`);
      for (const file of matched) {
        if (!rules.some(rule => rule.expressions.some(owner => owner.test(file)) && selects(rule, check))) errors.push(`${file}: an input of ${check}, which no owner rule of the path selects; add the check to the rule of the path`);
      }
    }
  }
  return [...new Set(errors)];
}

/**
 * The owners of the changed paths: the checks in order (make targets in the order of CHECK_TARGETS, then the others in the
 * order of the declaration), the test files, and the reasons. A removed path that no rule owns selects nothing; an existing
 * path that no rule owns is unowned.
 */
export function select(declaration: OwnerDeclaration, changed: string[], order: string[] = [], exists: Exists = () => true) {
  const rules = compile(declaration);
  const checks = new Map<string, Check>();
  const selected = new Set(declaration.always ?? []);
  const variables = new Map<string, Record<string, string[]>>();
  const reasons: string[] = [];
  const unowned: string[] = [];
  for (const file of changed) {
    const matched = rules.filter(rule => rule.expressions.some(expression => expression.test(file)));
    if (!matched.length && !exists(file)) reasons.push(`${file} -> nothing: the path was removed and no rule owns it`);
    else if (!matched.length) unowned.push(file);
    for (const rule of matched) {
      // A test that is the changed path itself runs only while the path exists.
      const tests = (rule.tests ?? []).flatMap(test => (test !== '$path' ? [test] : exists(file) ? [file] : []));
      const owned = ruleChecks(rule);
      reasons.push(`${file} -> ${[...owned.map(check => check.name), ...tests].join(', ') || 'nothing'}`);
      for (const check of owned) {
        checks.set(check.name, check);
        if (rule.variable && check.target) {
          const map = variables.get(check.name) ?? {};
          map[rule.variable] = [...(map[rule.variable] ?? []), file];
          variables.set(check.name, map);
        }
      }
      for (const test of tests) selected.add(test);
    }
  }
  const position = (check: Check) => (check.target && order.includes(check.target) ? order.indexOf(check.target) : order.length);
  const ordered = [...checks.values()].map((check, index) => ({ check, index })).sort((a, b) => position(a.check) - position(b.check) || a.index - b.index);
  const result = ordered.map(({ check }) => {
    const assignments = Object.entries(variables.get(check.name) ?? {}).map(([name, files]) => `${name}=${files.join(' ')}`);
    return assignments.length ? { ...check, name: `${check.name} ${assignments.join(' ')}`, args: [...check.args, ...assignments] } : check;
  });
  return { checks: result, tests: [...selected].sort(), reasons, unowned };
}

/** The scripts of the root package.json and the workspaces and package directories that have a test script. */
export function npmProject(root: string, tracked: string[]): NpmProject {
  const manifestFile = path.join(root, 'package.json');
  if (!existsSync(manifestFile)) return { scripts: {}, workspaces: [], prefixes: [] };
  const manifest: { workspaces?: unknown; scripts?: Record<string, string> } = JSON.parse(readFileSync(manifestFile, 'utf8'));
  // npm reads workspaces as a list of paths and globs (package.json of npm 7 and later); a package without it has none.
  const declared = manifest.workspaces ?? [];
  if (!Array.isArray(declared) || !declared.every(item => typeof item === 'string')) throw new Error(`package.json: workspaces is ${JSON.stringify(declared)}; npm reads a list of paths and globs`);
  const globs = declared.map(globExpression);
  const workspaces: string[] = [];
  const prefixes: string[] = [];
  for (const file of tracked.filter(name => name.endsWith('/package.json'))) {
    const packageManifest: { name?: string; scripts?: Record<string, string> } = JSON.parse(readFileSync(path.join(root, file), 'utf8'));
    if (!packageManifest.scripts?.test) continue;
    const directory = path.dirname(file);
    if (globs.some(glob => glob.test(directory)) && packageManifest.name) workspaces.push(packageManifest.name);
    else prefixes.push(directory);
  }
  return { scripts: manifest.scripts ?? {}, workspaces, prefixes };
}

const gitLines = (root: string, ...args: string[]): string[] => git(root, ...args).split('\n').filter(Boolean);

/** The changed paths of `values` (`paths`, `base`): the given ones, or those changed since the revision or since HEAD. */
export function changedPaths(root: string, values: { paths?: string | undefined; base?: string | undefined }) {
  if (values.paths !== undefined) return values.paths.split(/\s+/).filter(Boolean);
  const changed = gitLines(root, 'diff', '--name-only', values.base ?? 'HEAD');
  return [...new Set([...changed, ...gitLines(root, 'ls-files', '--others', '--exclude-standard')])].sort();
}

/** The commands that run the selection: the checks, then one run of the selected test files. */
export function commandsOf(selection: { checks: Check[]; tests: string[] }, declaration: Pick<OwnerDeclaration, 'testTarget'>): Check[] {
  if (!selection.tests.length) return selection.checks;
  const tests = declaration.testTarget
    ? { name: `make ${declaration.testTarget} TESTS=${selection.tests.join(' ')}`, command: 'make', args: ['--no-print-directory', declaration.testTarget, `TESTS=${selection.tests.join(' ')}`] }
    : { name: `node tests ${selection.tests.join(' ')}`, command: process.execPath, args: [siblingTool(import.meta.url, 'run-tests'), 'node', '--', ...selection.tests] };
  return [...selection.checks, tests];
}

const say = (text: string) => console.log(`[owner-check] ${text}`);
const complain = (text: string) => console.error(`[owner-check] ${text}`);

function step(root: string, { name, command, args }: Check) {
  say(`start ${name}`);
  const started = performance.now();
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  const passed = result.status === 0;
  say(`${name} ${passed ? 'passed' : `failed with ${result.error?.message ?? result.status ?? result.signal}`} in ${seconds} s`);
  return passed;
}

if (isMain(import.meta.url)) {
  const root = ROOT;
  const { values } = parseArgs({ options: { paths: { type: 'string' }, base: { type: 'string' }, 'dry-run': { type: 'boolean' }, validate: { type: 'boolean' } } });
  if (!existsSync(path.join(root, DECLARATION))) {
    complain(`${DECLARATION} does not exist; declare the owner of each path there (scripts/kit/schema/owner-checks.schema.json)`);
    process.exit(1);
  }
  const declaration: OwnerDeclaration = JSON.parse(readFileSync(path.join(root, DECLARATION), 'utf8'));
  const tracked = trackedFiles(root);
  const project = { make: makeDatabase(root), ...npmProject(root, tracked) };
  say(`checking ${DECLARATION} against ${tracked.length} paths`);
  const errors = validate(declaration, tracked, project, file => existsSync(path.join(root, file)));
  if (errors.length) {
    for (const error of errors) complain(error);
    complain(`${errors.length} errors in ${DECLARATION}`);
    process.exit(1);
  }
  if (values.validate) {
    say(`${DECLARATION} owns every tracked path`);
    process.exit(0);
  }
  const changed = changedPaths(root, values);
  const selection = select(declaration, changed, suiteTargets(project.make), file => existsSync(path.join(root, file)));
  if (selection.unowned.length) {
    for (const file of selection.unowned) complain(`${file}: the path matches no owner in ${DECLARATION}; add a rule whose paths match it`);
    process.exit(1);
  }
  for (const reason of selection.reasons) say(reason);
  const commands = commandsOf(selection, declaration);
  say(`${changed.length} changed paths select ${commands.map(command => command.name).join('; ') || 'nothing'}`);
  if (values['dry-run']) process.exit(0);
  const failed = commands.filter(command => !step(root, command)).map(command => command.name);
  say(failed.length ? `failed: ${failed.join('; ')}` : 'every owner check passed');
  process.exitCode = failed.length ? 1 : 0;
}
