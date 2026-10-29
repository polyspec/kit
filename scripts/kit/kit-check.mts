#!/usr/bin/env node
// Checks a repository against the installed package @polyspec/kit, without a network (`make kit-check`): each copy that the
// package declares (`kit.copies` of its package.json) is byte for byte its file of the installed package, of whatever version;
// npm ci installs the version of package-lock.json by its integrity, and a local link is the development state (K267). The
// configuration of config/*.json is checked against the schemas of the package as well, and a config/release.json with a
// wheel package or the wheel consumer against pythonBackend of config/toolchain.json, which the wheels need, a repository
// that needs PHP against .php-version, the PHP that CI and the release workflow set up (K193), and no recipe of the Makefile
// starts a tool of the checkout by its bare name (recipe-tools.mts, K171), no target of the Makefile repeats a fixed task
// of kit.mk under another name and each runtime of packages/ has its targets (K246). kit itself, the source of the copies,
// checks its configuration and its recipes only.
//
//   node scripts/kit/kit-check.mts
//
// A change of a copy is made in kit and written with `make kit-sync`, never in the repository; the check names each copy that
// is missing or differs, and the fix.
import { lstatSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readConfig, readConfigFindings, SCHEMAS } from './schema-validate.mts';
import { backendFinding, type WheelUsers } from './release-wheel.mts';
import { isMain, repositoryRoot } from './paths.mts';
import { readNpmManifest } from './manifests.mts';
import { PHPUNIT_MANIFEST, toolchainConfig } from './bootstrap/toolchain-declared.mts';
import { MISE_LOCKS } from './toolchain-lock.mts';
import { DECLARATION, makeDatabase, ownerDeclaration, select, suiteTargets, type MakeDatabase, type OwnerDeclaration } from './owner-check.mts';
import { implementationFolders } from './parity-declaration.mts';
import { trackedFiles } from './tracked-files.mts';
import { bareToolFindings, testRunnerFindings } from './recipe-tools.mts';
import { git } from './git.mts';
import { kitFile } from './kit-files.mts';

export const PACKAGE = '@polyspec/kit';
export const INSTALLED = `node_modules/${PACKAGE}`;

/** The part of the package.json of @polyspec/kit that a sync and a check read: its version and its copies. */
export type KitPackage = { name?: string; version?: string; kit?: { copies?: Record<string, string> } };

/**
 * The copies of `manifest`: `kit.copies` maps the path of a file in the repository to its file in the package. Both are
 * relative paths that stay inside their directory.
 */
export function copiesOf(manifest: Pick<KitPackage, 'kit'>): { file: string; from: string }[] {
  return Object.entries(manifest.kit?.copies ?? {}).map(([file, from]) => {
    for (const value of [file, from]) {
      if (path.isAbsolute(value) || value.split('/').includes('..') || value.includes('\\')) throw new Error(`kit.copies path ${JSON.stringify(value)} is not a relative path inside its directory`);
    }
    return { file, from };
  });
}

/**
 * The package.json of the @polyspec/kit that runs this module, found by Node's self-reference of the package by its name:
 * kit's own in its checkout, and the linked package's in a repository, which runs it from the scripts/kit of the kit checkout (K613).
 */
export function runningKit(): KitPackage {
  const manifest = fileURLToPath(import.meta.resolve(`${PACKAGE}/package.json`));
  return readNpmManifest(path.dirname(manifest), 'package.json');
}

/**
 * Whether kit writes the file `file` (relative to the repository root) of every repository: a copy of kit.copies of the
 * running package (make kit-sync), the Composer project of PHPUnit that install-tools installs, or a file of the lock tree that
 * mise writes under .mise/locks (make toolchain-lock). Such a file belongs to kit, not to a package of the repository (K167).
 */
export function writtenByKit(copies: readonly { file: string }[]): (file: string) => boolean {
  const files = new Set([...copies.map(({ file }) => file), PHPUNIT_MANIFEST]);
  return file => files.has(file) || file.startsWith(MISE_LOCKS);
}

/**
 * The installed package of `root`: its version and its copies; otherwise the finding that names the cause and the fix. The
 * version is not compared with package-lock.json: npm ci enforces the lock at install time by its integrity, and a local link of
 * a kit checkout is the development state (K267), so the copies are those of the installed content.
 */
export function installedKit(root: string): { version: string; copies: { file: string; from: string }[] } | { finding: string } {
  if (!existsSync(path.join(root, 'package-lock.json'))) return { finding: `package-lock.json is missing; it locks ${PACKAGE}. Fix: run make install-packages and commit package-lock.json` };
  if (!existsSync(path.join(root, INSTALLED, 'package.json'))) return { finding: `${INSTALLED} is not installed. Fix: make install-packages` };
  const installed = readNpmManifest(root, `${INSTALLED}/package.json`);
  return { version: installed.version ?? 'without a version', copies: copiesOf(installed) };
}

// The release configuration, whose wheels need pythonBackend of config/toolchain.json.
const RELEASE = 'config/release.json';

// The file of the PHP minor release that CI and the release workflow set up (shivammathur/setup-php php-version-file).
export const PHP_VERSION = '.php-version';

/** The part of config/release.json that needs PHP: the Composer packages and the Composer consumer. */
export type PhpUsers = { packages: { kind: string; name: string }[]; consumers?: { composer?: unknown } };

/**
 * The finding of `root` when it needs PHP and has no .php-version: a Composer package or the Composer consumer of
 * config/release.json, or php of config/toolchain.json. The release workflow sets up the PHP of .php-version only; without
 * it, the release proof ran the PHP of the runner (K193).
 */
export function phpVersionFinding(root: string, release: PhpUsers | undefined): string | null {
  if (existsSync(path.join(root, PHP_VERSION))) return null;
  const composer = (release?.packages ?? []).filter(({ kind }) => kind === 'composer').map(({ name }) => name);
  const php = toolchainConfig(root).php;
  const users = [
    ...(composer.length ? [`the Composer packages [${composer.join(', ')}] of ${RELEASE}`] : []),
    ...(release?.consumers?.composer ? [`the Composer consumer of ${RELEASE}`] : []),
    ...(php === undefined ? [] : [`php ${JSON.stringify(php)} of config/toolchain.json`]),
  ];
  if (!users.length) return null;
  const minor = Array.isArray(php) && typeof php[0] === 'string' ? php[0] : '<major>.<minor>';
  return `${PHP_VERSION} is missing, but ${users.join(' and ')} need PHP; CI and the release workflow set up the PHP of ${PHP_VERSION}, and without it the release runs the PHP of the runner. Fix: declare ${PHP_VERSION} with the PHP minor release, such as ${minor}`;
}

/**
 * The findings of the configuration of `root` against the schemas of the package: each config/<name>.json that the repository
 * has must validate against its schema <name>.schema.json; an error names the file, the location and the rule.
 */
export function checkConfig(root: string): string[] {
  const found: string[] = [];
  for (const schemaFile of readdirSync(SCHEMAS).filter(name => name.endsWith('.schema.json')).sort()) {
    const name = schemaFile.slice(0, -'.schema.json'.length);
    const config = `config/${name}.json`;
    // A repository declares a configuration by having its file; the schema checks the declared file only.
    if (!existsSync(path.join(root, config))) continue;
    // The check needs the errors of the schema only, so the value stays unknown.
    const { errors } = readConfigFindings<unknown>(root, config, schemaFile);
    for (const error of errors ?? []) found.push(`${error}. Rule: the schema ${schemaFile} of ${PACKAGE}`);
  }
  if (found.length) return found;
  // A release whose configuration holds its schema needs the build backend that config/toolchain.json declares (K166).
  const release = existsSync(path.join(root, RELEASE)) ? readConfig<WheelUsers & PhpUsers>(root, RELEASE, 'release.schema.json') : undefined;
  const backend = release && backendFinding(root, release);
  if (backend) found.push(backend);
  // A repository that needs PHP declares the PHP that CI and the release set up (K193).
  const php = phpVersionFinding(root, release);
  if (php) found.push(php);
  return found;
}

/** Whether `root` is kit itself, the source of the copies: its package.json names the package. */
export function isSource(root: string): boolean {
  return existsSync(path.join(root, 'package.json')) && readNpmManifest(root, 'package.json').name === PACKAGE;
}

/** The directory of a repository that holds the copies of kit only (K133). */
export const COPY_DIRECTORY = 'scripts/kit';

/** The files of scripts/kit of `root` that `copies` does not declare, as paths of the repository, sorted. */
export function strayCopies(root: string, copies: { file: string }[]): string[] {
  const directory = path.join(root, COPY_DIRECTORY);
  if (!existsSync(directory)) return [];
  const declared = new Set(copies.map(({ file }) => file));
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter(entry => !entry.isDirectory())
    .map(entry => path.relative(root, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'))
    .filter(file => !declared.has(file))
    .sort();
}

// The configurations that kit no longer reads.
const RETIRED = ['config/commits.json'];

/**
 * The files that an earlier kit copied into the repository and that kit now reads from its package (K514): the lint
 * configurations, which each lint of kit.mk names by their path in the package. kit-sync removes them, and kit-check names one
 * that a consumer still holds (K514-1).
 */
export const RETIRED_COPIES = ['ruff.toml', 'phpcs.xml.dist', 'phpstan.dist.neon', '.golangci.yml', 'clippy.toml', '.oxlintrc.json', 'knip.json', 'config/api-extractor.kit.json'] as const;

// The mode of a symbolic link in the index of Git.
const LINK_MODE = '120000';

/** A finding for each configuration that kit no longer reads, so a stale file does not look like a rule (K243). */
export function retiredFindings(root: string): string[] {
  return RETIRED.filter(file => existsSync(path.join(root, file))).map(file => `${file}: kit no longer reads it; the commit rules are COMMIT_RULES of check-commits.mts (K243). Fix: git rm ${file}`);
}

/** A finding for each tracked symbolic link: shared files are regular copies of the installed kit package. */
export function symlinkFindings(root: string): string[] {
  return git(root, 'ls-files', '--stage', '-z').split('\0').filter(Boolean).flatMap(entry => {
    if (!entry.startsWith(`${LINK_MODE} `)) return [];
    const tab = entry.indexOf('\t');
    const file = entry.slice(tab + 1);
    return [`${file}: a tracked symbolic link; a repository tracks regular files, including the shared files copied from its installed kit package (K671-2). Fix: git rm --cached ${file} and track the file it names`];
  });
}

// A target of the repository whose name starts with one of the fixed tasks repeats that task under another name (K246); check is
// the suite of a repository, which runs only in CI, and no fixed task (K246-2).
const TASK_NAME = /^(?:install|build|test|lint)(?:-|$)/;

/** The targets that the rules of the makefile `text` define: a line out of a recipe with a colon that assigns nothing. */
export function ruleTargets(text: string): string[] {
  return text.split('\n').flatMap(line => {
    const rule = /^([^\t#$.=:][^=:]*?)\s*::?(?!=)/.exec(line);
    return rule ? (rule[1] ?? '').split(/\s+/).filter(Boolean) : [];
  });
}

/**
 * The findings of the Makefile `repository` against the targets `kit` of kit.mk and kit-bootstrap.mk: a target of a fixed
 * task's name that kit does not define; the repository joins a fixed task by a prerequisite, such as `build: kit-build` (K246).
 */
export function taskNameFindings(repository: string, kit: ReadonlySet<string>): string[] {
  return [...new Set(ruleTargets(repository))].filter(name => TASK_NAME.test(name) && !kit.has(name)).map(name => `Makefile: the target ${name} repeats a fixed task of kit.mk under another name. Fix: name it <repository>-<task> and add it as a prerequisite of the fixed task, such as build: kit-build`);
}

/** The findings of the runtimes of packages/ among `files` that lack one of the targets build-, test- and lint-<runtime> in `make` (K246). */
export function runtimeTargetFindings(files: readonly string[], make: MakeDatabase): string[] {
  const runtimes = [...new Set(implementationFolders(files).map(folder => path.posix.basename(folder)))].sort();
  return runtimes.flatMap(runtime => ['build', 'test', 'lint'].map(task => `${task}-${runtime}`).filter(target => !make.targets.has(target)).map(target => `packages/: the runtime ${runtime} has no target ${target}; kit.mk defines the targets of each runtime`));
}

// The gates of kit-gates that apply to a repository only when it holds code of the language: the lint of that language, and the
// lint and test of a PHP extension.
const LANGUAGE_GATES: Record<string, { name: string; code: RegExp }> = {
  'lint-php': { name: 'PHP', code: /\.php$/ },
  'lint-python': { name: 'Python', code: /\.py$/ },
  'lint-ts': { name: 'TypeScript', code: /\.[cm]?[jt]sx?$/ },
  'lint-go': { name: 'Go', code: /\.go$/ },
  'lint-rust': { name: 'Rust', code: /\.rs$/ },
  'lint-php-ext': { name: 'PHP extension', code: /^packages\/php-ext\// },
  'test-php-ext': { name: 'PHP extension', code: /^packages\/php-ext\// },
};

/**
 * The findings of the suite CHECK_TARGETS of `make` against kit-gates (K289): each prerequisite is run by the suite as a word or a
 * prerequisite of one; the parity gate may instead be the complete provider-owned API and implementation binding partition.
 */
export function parityPhaseFindings(make: MakeDatabase, implementations: readonly string[]): string[] {
  const phaseTargets = new Set(['parity-api-check', ...implementations.map(name => `parity-bindings-${name}-check`)]);

  const suite = suiteTargets(make);
  const occurrences = new Map<string, number>();
  const walk = (name: string, ancestry: Set<string>) => {
    if (ancestry.has(name)) return;
    if (phaseTargets.has(name) || name === 'parity-check' || (name.startsWith('parity-bindings-') && name.endsWith('-check'))) {
      occurrences.set(name, (occurrences.get(name) ?? 0) + 1);
    }
    const next = new Set(ancestry).add(name);
    for (const prerequisite of make.targets.get(name)?.prerequisites ?? []) walk(prerequisite, next);
  };
  suite.forEach(name => walk(name, new Set()));

  const fullCount = occurrences.get('parity-check') ?? 0;
  const phaseCount = [...occurrences].filter(([name]) => name !== 'parity-check').reduce((sum, [, count]) => sum + count, 0);
  if (phaseCount === 0) return [];
  const findings: string[] = [];
  const apiRecipe = make.targets.get('parity-api-check')?.recipe.trim();
  if (makeRecipe(apiRecipe) !== '$(NODE) $(KIT)/parity.$(KIT_EXT) --phase api') findings.push('Makefile: parity-api-check does not use the provider API recipe. Fix: keep the provider recipe and add setup prerequisites only');
  if (fullCount > 0) findings.push('Makefile: CHECK_TARGETS mixes parity-check with parity phases. Fix: choose parity-check once or parity-api-check and every parity-bindings-<implementation>-check once');
  if ((occurrences.get('parity-api-check') ?? 0) !== 1) findings.push(`Makefile: CHECK_TARGETS must run parity-api-check exactly once; found ${occurrences.get('parity-api-check') ?? 0}. Fix: add parity-api-check once`);
  for (const name of new Set([...occurrences.keys()].filter(name => name.startsWith('parity-bindings-') && name.endsWith('-check')))) {
    const implementation = name.slice('parity-bindings-'.length, -'-check'.length);
    if (!implementation || !implementations.includes(implementation)) findings.push(`Makefile: CHECK_TARGETS selects unknown parity implementation ${implementation || '(empty)'}. Fix: use a name from config/parity.json`);
  }
  for (const implementation of implementations) {
    const target = `parity-bindings-${implementation}-check`;
    const count = occurrences.get(target) ?? 0;
    if (count !== 1) findings.push(`Makefile: CHECK_TARGETS must run ${target} exactly once; found ${count}. Fix: add the provider target once`);
    const rule = make.targets.get(target);
    if (!rule) findings.push(`Makefile: ${target} has no provider target. Fix: use the implementation names generated from config/parity.json`);
    else if (makeRecipe(rule.recipe.trim()) !== `$(NODE) $(KIT)/parity.$(KIT_EXT) --phase bindings --implementation ${implementation}`) findings.push(`Makefile: ${target} does not use its provider binding recipe. Fix: add setup prerequisites without replacing the recipe`);
  }
  return findings;
}

/** Make's database retains doubled dollars that were escaped through eval; compare the expanded provider recipe. */
const makeRecipe = (recipe: string | undefined): string | undefined => recipe?.replaceAll('$$(', '$(');

export function gateFindings(files: readonly string[], make: MakeDatabase, implementations: readonly string[] = []): string[] {
  const gates = make.targets.get('kit-gates')?.prerequisites ?? [];
  const reached = new Set<string>();
  const visit = (name: string) => {
    if (reached.has(name)) return;
    reached.add(name);
    for (const next of make.targets.get(name)?.prerequisites ?? []) visit(next);
  };
  suiteTargets(make).forEach(visit);
  const parityPhases = parityPhaseFindings(make, implementations);
  const hasCompletePhases = parityPhases.length === 0 && make.targets.has('parity-api-check') && implementations.length > 0 && suiteTargets(make).some(name => {
    const visit = (target: string, seen = new Set<string>()): boolean => {
      if (target === 'parity-api-check') return true;
      if (seen.has(target)) return false;
      seen.add(target);
      return (make.targets.get(target)?.prerequisites ?? []).some(next => visit(next, seen));
    };
    return visit(name);
  });
  if (hasCompletePhases) reached.add('parity-check');
  return [...gates.filter(gate => !reached.has(gate) && (LANGUAGE_GATES[gate] === undefined || files.some(file => LANGUAGE_GATES[gate]?.code.test(file) && !file.startsWith('scripts/kit/')))).map((gate) => {
    const language = LANGUAGE_GATES[gate];
    return `Makefile: CHECK_TARGETS runs no ${gate}, a gate of kit-gates${language ? ` for the ${language.name} of this repository` : ''}; add it to CHECK_TARGETS`;
  }), ...parityPhases];
}

// The gate that every source path selects with the lint of its language (K534).
const DUPLICATION_GATE = 'duplication-check';

/**
 * The findings of the owner rules `declaration` for the tracked `files` (K534): for each language whose lint is a gate of kit-gates
 * in `make`, each source path, outside the copies of kit, selects that lint and duplication-check, since land and the commit gate run
 * what the owners of the changed paths select. One finding per language and missed gate, with the number of paths and one of them.
 */
export function lintSelectionFindings(files: readonly string[], make: MakeDatabase, declaration: OwnerDeclaration): string[] {
  const gates = make.targets.get('kit-gates')?.prerequisites ?? [];
  const selected = new Map<string, Set<string | undefined>>();
  const targetsOf = (file: string) => {
    const known = selected.get(file);
    if (known) return known;
    // The importers of a rule add tests, never targets, so the selection of targets reads no import graph.
    const targets = new Set(select(declaration, [file], [], () => true, () => []).checks.map(check => check.target));
    selected.set(file, targets);
    return targets;
  };
  return gates.flatMap((gate) => {
    const language = LANGUAGE_GATES[gate];
    if (language === undefined || !gate.startsWith('lint-')) return [];
    const sources = files.filter(file => language.code.test(file) && !file.startsWith('scripts/kit/'));
    return [gate, ...(gates.includes(DUPLICATION_GATE) ? [DUPLICATION_GATE] : [])].flatMap((target) => {
      const missed = sources.filter(file => !targetsOf(file).has(target));
      if (missed.length === 0) return [];
      return [`${DECLARATION}: ${missed.length} ${language.name} source paths, such as ${missed[0]}, select no ${target}, so land and the commit gate never run it on them; add ${target} to the targets of a rule that owns them`];
    });
  });
}

/**
 * The targets that kit defines: those of the kit.mk beside this module and of the kit-bootstrap.mk of the kit that runs, which a
 * repository includes from the kit checkout beside it and holds no copy of (K614, K617).
 */
export function kitTargets(): Set<string> {
  const files = [path.join(path.dirname(fileURLToPath(import.meta.url)), 'kit.mk'), kitFile('scripts/kit/kit-bootstrap.mk')];
  return new Set(files.filter(file => existsSync(file)).flatMap(file => ruleTargets(readFileSync(file, 'utf8'))));
}

/** The findings of the targets of `root`: the names of its Makefile and the targets of its runtimes (K246). */
function targetFindings(root: string, make: MakeDatabase): string[] {
  const makefile = path.join(root, 'Makefile');
  const names = existsSync(makefile) ? taskNameFindings(readFileSync(makefile, 'utf8'), kitTargets()) : [];
  const files = trackedFiles(root);
  let implementations: string[] = [];
  if (existsSync(path.join(root, 'config/parity.json'))) {
    const declaration = readConfigFindings<{ implementations: { name: string }[] }>(root, 'config/parity.json', 'parity.schema.json');
    if (declaration.value !== undefined) implementations = declaration.value.implementations.map(({ name }) => name);
  }
  // K534: the owner rules as land reads them select the lint of each language for its sources.
  const owners = existsSync(path.join(root, DECLARATION)) ? lintSelectionFindings(files, make, ownerDeclaration(root)) : [];
  return [...names, ...runtimeTargetFindings(files, make), ...(isSource(root) ? [] : gateFindings(files, make, implementations)), ...owners];
}

/**
 * The findings of `root`: the configuration, the recipes, the tracked links, and the installed package and its copies; empty
 * when they match.
 */
export function check(root: string): string[] {
  const make = makeDatabase(root);
  const config = [...checkConfig(root), ...bareToolFindings(make), ...testRunnerFindings(make), ...targetFindings(root, make), ...symlinkFindings(root), ...retiredFindings(root)];
  if (isSource(root)) return config;
  const kit = installedKit(root);
  if ('finding' in kit) return [...config, kit.finding];
  const found: string[] = RETIRED_COPIES.filter(file => existsSync(path.join(root, file))).map(file => `${file}: kit no longer copies it and reads it from ${PACKAGE} (K514), so this copy is stale. Fix: make kit-sync, which removes it`);
  for (const { file, from } of kit.copies) {
    if (!existsSync(path.join(root, file))) {
      found.push(`${file}: the copy of ${PACKAGE} ${kit.version} is missing. Fix: make kit-sync`);
    } else if (lstatSync(path.join(root, file)).isSymbolicLink()) {
      found.push(`${file}: the copy of ${PACKAGE} ${kit.version} is a symbolic link, not a regular file. Fix: make kit-sync`);
    } else if (!readFileSync(path.join(root, file)).equals(readFileSync(path.join(root, INSTALLED, from)))) {
      found.push(`${file}: differs from ${INSTALLED}/${from} of ${PACKAGE} ${kit.version}. Fix: make kit-sync`);
    }
  }
  for (const file of strayCopies(root, kit.copies)) found.push(`${file} is no copy of ${PACKAGE} ${kit.version}; ${COPY_DIRECTORY} holds the copies of kit only. Fix: make kit-sync, which removes it`);
  return [...config, ...found];
}

if (isMain(import.meta.url)) {
  const root = repositoryRoot();
  const found = check(root);
  for (const line of found) console.error(`[kit-check] ${line}`);
  if (found.length) {
    console.error(`[kit-check] ${found.length} findings in the configuration and the copies of ${PACKAGE}`);
    process.exit(1);
  }
  console.log(isSource(root) ? '[kit-check] the configuration matches its schemas' : `[kit-check] the configuration matches its schemas and the copies match ${PACKAGE} ${readNpmManifest(root, `${INSTALLED}/package.json`).version ?? ''}`);
}
