#!/usr/bin/env node
// Checks the configuration of a repository without a network (`make kit-check`): config/*.json against the schemas of kit, a
// repository that needs PHP against .php-version, the PHP that CI and the release workflow set up (K193), and no
// recipe of the Makefile starts a tool of the checkout by its bare name (recipe-tools.mts, K171). The names of the targets, the
// suite and the tracked files of a repository are its own (K810). Whether the copies
// of kit match the installed package is make kit-inject-check's, which runs kit-sync (K799, K851).
//
//   node scripts/kit/kit-check.mts
//
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readConfig, readConfigFindings, SCHEMAS } from './schema-validate.mts';
import { isMain, repositoryRoot } from './paths.mts';
import { readNpmManifest } from './manifests.mts';
import { PHPUNIT_MANIFEST, toolchainConfig } from './bootstrap/toolchain-declared.mts';
import { MISE_LOCKS } from './toolchain-mise.mts';
import { makeDatabase } from './owner-check.mts';
import { bareToolFindings, testRunnerFindings } from './recipe-tools.mts';
import { gitResult } from './git.mts';
import { trackedManifestPathFindings } from './link-check.mts';
import { couplingFindings } from './coupling.mts';

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

// The release configuration, whose Composer packages and consumer need PHP.
const RELEASE = 'config/release.json';

// The file of the PHP minor release that CI and the release workflow set up (shivammathur/setup-php php-version-file).
export const PHP_VERSION = '.php-version';

/** The part of config/release.json that needs PHP: the Composer packages. */
export type PhpUsers = { packages: { kind: string; name: string }[] };

/**
 * The finding of `root` when it needs PHP and has no .php-version: a Composer package of config/release.json, or php of
 * config/toolchain.json. The release workflow sets up the PHP of .php-version only; without it, the release ran the PHP of the
 * runner (K193).
 */
export function phpVersionFinding(root: string, release: PhpUsers | undefined): string | null {
  if (existsSync(path.join(root, PHP_VERSION))) return null;
  const composer = (release?.packages ?? []).filter(({ kind }) => kind === 'composer').map(({ name }) => name);
  const php = toolchainConfig(root).php;
  const users = [
    ...(composer.length ? [`the Composer packages [${composer.join(', ')}] of ${RELEASE}`] : []),
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
  const release = existsSync(path.join(root, RELEASE)) ? readConfig<PhpUsers>(root, RELEASE, 'release.schema.json') : undefined;
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

/**
 * The files that an earlier kit copied into the repository and that kit now reads from its package (K514): the lint
 * configurations, which each lint of kit.mk names by their path in the package, and the gates workflow, which the CI pipeline
 * replaced (K910). kit-sync removes them, and kit-check names one that a consumer still holds (K514-1).
 */
export const RETIRED_COPIES = ['ruff.toml', 'phpcs.xml.dist', 'phpstan.dist.neon', '.golangci.yml', 'clippy.toml', '.oxlintrc.json', 'knip.json', 'config/api-extractor.kit.json', '.github/workflows/gates.yml'] as const;

// The release workflow that kit copies and the CI workflow of the repository, whose success starts it (K987).
const RELEASE_WORKFLOW = '.github/workflows/release.yml';
const CI_WORKFLOW = '.github/workflows/ci.yml';
const CI_CONFIG = 'config/ci.json';

/**
 * The finding of a repository whose CI workflow is not the one its release workflow waits for (K987): the workflow_run of
 * release.yml names the CI workflow by its name, so a ci.yml of another name never starts a release. Each file's top-level key
 * is read by its line, as a workflow writes it at the start of a line.
 */
export function ciNameFinding(root: string): string | null {
  const release = path.join(root, RELEASE_WORKFLOW);
  if (!existsSync(release)) return null;
  const waited = /^\s+workflows:\s*\[\s*([^\],\s]+)\s*\]\s*$/m.exec(readFileSync(release, 'utf8'))?.[1];
  if (waited === undefined) return null;
  const ci = path.join(root, CI_WORKFLOW);
  if (!existsSync(ci)) return `${CI_WORKFLOW} is missing, though ${RELEASE_WORKFLOW} waits for the CI workflow ${waited}; a green CI starts the release (K987)`;
  const name = /^name:\s*['"]?([^'"\s#]+)['"]?\s*(?:#.*)?$/m.exec(readFileSync(ci, 'utf8'))?.[1];
  return name === waited ? null : `${CI_WORKFLOW} is named ${name ?? '(no name)'}, but ${RELEASE_WORKFLOW} waits for the CI workflow ${waited}, so no CI run starts a release; name it ${waited} (K987)`;
}

// The folder of the workflows of a repository, and the command that only the bootstrap of kit runs: an npm ci of the locked
// packages that allows the remote kit package, in each form a kit release gave it, the npm of devEngines with --prefix (K938-1),
// the earlier npm of packageManager and npm.cmd; and the install of the npm of the bootstrap, which a copy runs also when its npm
// ci runs through a target of the repository, such as make bootstrap (K996).
const WORKFLOWS = '.github/workflows';
const BOOTSTRAP_COMMANDS = [/\bnpm(?:\.cmd)?\b.*\bci\b.*--allow-remote=root/, /^\s*(?:- )?(?:run: )?make install-tools TOOLS=npm\s*$/];

/**
 * The findings of the workflows of `root` that carry their own copy of the bootstrap of kit (K992): the composite action that
 * kit-sync vendors is the one bootstrap of a job, so a kit release that changes it reaches every job; each finding names the
 * file and line. The copies of kit are left to the copy check.
 */
export function bootstrapCopyFindings(root: string, copies: ReadonlySet<string>): string[] {
  const folder = path.join(root, WORKFLOWS);
  if (!existsSync(folder)) return [];
  return readdirSync(folder).filter(name => /\.ya?ml$/.test(name)).sort().flatMap(name => {
    const file = `${WORKFLOWS}/${name}`;
    if (copies.has(file)) return [];
    return readFileSync(path.join(folder, name), 'utf8').split('\n').flatMap((line, index) => BOOTSTRAP_COMMANDS.some(command => command.test(line))
      ? [`${file}:${index + 1} carries a copy of the bootstrap of kit; run the vendored action with \`uses: ./.github/actions/kit-bootstrap\` after the checkout of the job instead (K992, K996)`]
      : []);
  });
}

/** The workflows of the repository `root`, those that `copies` declares left out, each with its lines (K998). */
function ownWorkflows(root: string, copies: ReadonlySet<string>): { file: string; lines: string[] }[] {
  const folder = path.join(root, WORKFLOWS);
  if (!existsSync(folder)) return [];
  return readdirSync(folder).filter(name => /\.ya?ml$/.test(name)).sort()
    .map(name => ({ file: `${WORKFLOWS}/${name}`, lines: readFileSync(path.join(folder, name), 'utf8').split('\n') }))
    .filter(({ file }) => !copies.has(file));
}

/** A key of a mapping at `indent` spaces, plain or quoted, and the name it gives. */
const keyAt = (line: string, indent: number) => new RegExp(`^ {${indent}}(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9_-]+)):\\s*$`).exec(line);

/** The jobs of a workflow by their lines: each key two spaces under `jobs:`, with the index of its first line (K998). */
function workflowJobs(lines: readonly string[]): { name: string; start: number; body: string[] }[] {
  const top = lines.indexOf('jobs:');
  if (top < 0) return [];
  // A comment or a blank line at the margin belongs to the jobs; the next top-level key ends them.
  const end = lines.findIndex((line, index) => index > top && /^[^\s#]/.test(line));
  const last = end < 0 ? lines.length : end;
  const starts = lines.flatMap((line, index) => index > top && index < last && keyAt(line, 2) ? [index] : []);
  return starts.map((start, at) => {
    const key = keyAt(lines[start] ?? '', 2);
    return { name: key?.[1] ?? key?.[2] ?? key?.[3] ?? '', start, body: lines.slice(start + 1, starts[at + 1] ?? last) };
  });
}

/** The jobs that the needs of a job body name: a scalar, a flow list or a block list, each name plain or quoted. */
function jobNeeds(body: readonly string[]): string[] {
  const unquote = (word: string) => word.trim().replace(/^(["'])(.*)\1$/, '$2');
  const at = body.findIndex(line => /^ {4}needs:/.test(line));
  if (at < 0) return [];
  const value = (body[at] ?? '').replace(/^ {4}needs:/, '').replace(/\s#.*$/, '').trim();
  if (value.startsWith('[')) return value.replace(/^\[|\]$/g, '').split(',').map(unquote).filter(Boolean);
  if (value) return [unquote(value)];
  const items: string[] = [];
  for (const line of body.slice(at + 1)) {
    const item = /^ {6}-\s+(.*?)\s*(?:#.*)?$/.exec(line);
    if (!item) break;
    items.push(unquote(item[1] ?? ''));
  }
  return items;
}

const PIPELINE_USES = './.github/workflows/ci-pipeline.yml';
/** The options of make that take the next word as their argument. */
const MAKE_ARGUMENT_OPTIONS = new Set(['-C', '-f', '-I', '-o', '-W', '--directory', '--file', '--include-dir', '--old-file', '--what-if']);

/**
 * The make targets that the command `line` runs, and the words of its TARGETS of ci-targets: the words after make up to the end of
 * the command, without its options, their arguments and its variables.
 */
function makeTargets(line: string): string[] {
  const command = /(?:^|[;&|]\s*|^\s*(?:-\s+)?(?:run:\s+)?)make\s+([^;&|#]*)/.exec(line);
  if (!command) return [];
  const words = (command[1] ?? '').match(/[A-Za-z0-9_]+=(?:"[^"]*"|'[^']*'|\S*)|\S+/g) ?? [];
  const targets: string[] = [];
  for (let at = 0; at < words.length; at++) {
    const word = words[at] ?? '';
    if (MAKE_ARGUMENT_OPTIONS.has(word)) at++;
    else if (word.startsWith('TARGETS=')) targets.push(...word.slice('TARGETS='.length).replace(/^(["'])(.*)\1$/, '$2').split(/\s+/));
    else if (!word.startsWith('-') && !word.includes('=')) targets.push(word);
  }
  return targets.filter(Boolean);
}

/** The make targets that the inputs of config/ci.json name: every list of `setup` and `targets` (S12). */
function ciInputTargets(root: string): string[] {
  if (!existsSync(path.join(root, CI_CONFIG))) return [];
  const read = readConfigFindings<{ setup?: unknown; targets?: unknown }>(root, CI_CONFIG, 'ci.schema.json');
  // A configuration that breaks its schema is a finding of checkConfig.
  if (read.errors) return [];
  const names = (value: unknown): string[] => typeof value === 'string' ? [value] : Array.isArray(value) ? value.flatMap(names)
    : value !== null && typeof value === 'object' ? Object.values(value).flatMap(names) : [];
  return [...names(read.value.setup), ...names(read.value.targets)];
}

/**
 * S12, K998: the findings of the CI of the consumer `root`. Its ci.yml calls ci-pipeline.yml as its job kit and ci-passed joins every other job; independent jobs run concurrently; no workflow of the repository and no input of config/ci.json names a gate of `gates` again, as a make
 * target or a word of TARGETS, and no workflow checks out another repository or to a path, or clones a repository, so one
 * pipeline at the root of the checkout runs the gates. The copies of kit are left to the copy check, and a repository without
 * workflows has no CI to judge.
 */
export function pipelineFindings(root: string, copies: ReadonlySet<string>, gates: ReadonlySet<string>): string[] {
  const own = ownWorkflows(root, copies);
  const found: string[] = [];
  const ci = own.find(({ file }) => file === CI_WORKFLOW);
  if (ci) {
    const jobs = workflowJobs(ci.lines);
    if (!jobs.some(job => job.name === 'kit' && job.body.some(line => line.trim() === `uses: ${PIPELINE_USES}`))) found.push(`${CI_WORKFLOW} has no job kit that calls ${PIPELINE_USES} (S12)`);
    const required = jobs.find(job => job.name === 'ci-passed');
    if (!required) found.push(`${CI_WORKFLOW}: job ci-passed is missing; join every CI job before reporting success (S12)`);
    else {
      const dependencies = new Set(jobNeeds(required.body));
      for (const job of jobs.filter(job => job.name !== 'ci-passed' && !dependencies.has(job.name))) {
        found.push(`${CI_WORKFLOW}: job ci-passed does not require job ${job.name}; include it in needs (S12)`);
      }
    }
  }
  for (const { file, lines } of own) {
    let heredoc: string | undefined;
    lines.forEach((line, index) => {
      const at = `${file}:${index + 1}`;
      // The text of a heredoc is data that a command reads, not a command of the step.
      if (heredoc !== undefined) {
        if (line.trim() === heredoc) heredoc = undefined;
        return;
      }
      if (/^\s*#/.test(line)) return;
      if (/^\s+path:\s*\S/.test(line) && checkoutKey(lines, index)) found.push(`${at} checks out to a path; a job checks the repository out at the root of the workspace (S12)`);
      if (/^\s+repository:\s*\S/.test(line) && checkoutKey(lines, index)) found.push(`${at} checks out another repository; a job runs the released packages of its providers (S12, P30)`);
      if (/\bgit\s+clone\b/.test(line)) found.push(`${at} clones a repository; a job runs the released packages of its providers (S12, P30)`);
      for (const gate of makeTargets(line).filter(name => gates.has(name))) found.push(`${at} names the gate ${gate} of kit-gates again, which the job kit runs once (S12)`);
      heredoc = /<<-?\s*(["']?)([A-Za-z_][A-Za-z0-9_]*)\1/.exec(line)?.[2];
    });
  }
  for (const gate of ciInputTargets(root).filter(name => gates.has(name))) found.push(`${CI_CONFIG} names the gate ${gate} of kit-gates again, which the job kit runs once (S12)`);
  return found;
}

/**
 * The gates that the job kit runs once (S12, K998): the prerequisites of kit-gates, and kit-gates and each of its partitions
 * kit-gates-*, which run them all at once. A Makefile that declares no kit-gates has no gate to run again.
 */
export function gateNames(targets: ReadonlyMap<string, { prerequisites: readonly string[] }>): Set<string> {
  const gates = targets.get('kit-gates')?.prerequisites;
  if (gates === undefined) return new Set();
  return new Set([...gates, ...[...targets.keys()].filter(name => name === 'kit-gates' || name.startsWith('kit-gates-'))]);
}

/** Whether the key at `index` of `lines` belongs to a step that uses actions/checkout, whichever key of the step comes first. */
function checkoutKey(lines: readonly string[], index: number): boolean {
  let start = index;
  while (start >= 0 && !/^\s*-\s/.test(lines[start] ?? '')) start--;
  if (start < 0) return false;
  const indent = (/^(\s*)-/.exec(lines[start] ?? '')?.[1] ?? '').length;
  let end = start + 1;
  // The step ends at the next line at its own indentation or less: the next step, or the next key of the job.
  while (end < lines.length && !(/\S/.test(lines[end] ?? '') && (/^(\s*)/.exec(lines[end] ?? '')?.[1] ?? '').length <= indent)) end++;
  return lines.slice(start, end).some(line => /^\s*(?:-\s+)?uses:\s*actions\/checkout@/.test(line));
}

/** The link steps of package managers that S11 rules out: npm link, and an editable install of pip or uv. */
const LINK_STEPS = [/\bnpm\s+link\b/, /\bpip\s+install\b[^#]*\s(?:-e|--editable)\b/, /\buv\s+add\b[^#]*\s--editable\b/];

/**
 * S11, K998: each line of a tracked Makefile, *.mk or workflow of `root` that runs a link step of a package manager; a provider
 * checkout is linked by the plain folder link of make link, from .links. A comment is no step; the copies of kit are left out.
 */
export function linkStepFindings(root: string, copies: ReadonlySet<string>): string[] {
  const listed = gitResult(root, 'ls-files', '-z', '--', 'Makefile', '*/Makefile', '*.mk', `${WORKFLOWS}/*.yml`, `${WORKFLOWS}/*.yaml`);
  if (listed.error || listed.status !== 0) throw new Error(`git ls-files failed in ${root}: ${listed.error?.message ?? listed.stderr.trim()}`);
  return listed.stdout.split('\0').filter(file => file && !copies.has(file) && !file.startsWith(`${COPY_DIRECTORY}/`)).sort().flatMap(file => readFileSync(path.join(root, file), 'utf8').split('\n')
    .flatMap((line, index) => !/^\s*#/.test(line) && LINK_STEPS.some(step => step.test(line))
      ? [`${file}:${index + 1} runs a link step of a package manager; link a provider checkout with .links and make link (S11)`]
      : []));
}

/** The findings of `root`: the configuration, the workflows of CI and the recipes; empty when they match. */
export function check(root: string): string[] {
  const make = makeDatabase(root);
  const ci = ciNameFinding(root);
  const installed = installedKit(root);
  const copies = new Set('copies' in installed ? installed.copies.map(({ file }) => file) : []);
  // kit's own ci.yml tests the bootstrap itself on every platform, so it is no consumer CI (S12).
  const source = isSource(root);
  const bootstrap = source ? [] : bootstrapCopyFindings(root, copies);
  // The rules that held no check (K998): one pipeline (S12), no link step (S11) and no tracked manifest path out of the repository (P30);
  // and no part reaching another past its interface (S15, K1002).
  const pipeline = source ? [] : pipelineFindings(root, copies, gateNames(make.targets));
  return [...checkConfig(root), ...(ci === null ? [] : [ci]), ...bootstrap, ...pipeline, ...linkStepFindings(root, copies), ...trackedManifestPathFindings(root), ...couplingFindings(root, source),
    ...bareToolFindings(make), ...testRunnerFindings(make)];
}

if (isMain(import.meta.url)) {
  const root = repositoryRoot();
  const found = check(root);
  for (const line of found) console.error(`[kit-check] ${line}`);
  if (found.length) {
    console.error(`[kit-check] ${found.length} findings in the configuration`);
    process.exit(1);
  }
  console.log('[kit-check] the configuration matches its schemas');
}
