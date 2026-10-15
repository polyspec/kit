// The local links of 0.0.x development (docs/plans/local-links.md, K201). With the polyspec root declared in
// POLYSPEC_CHECKOUTS, each installed polyspec package of a consumer that is pinned at 0.0.x is pointed at the source of the
// main checkout that provides it (link-providers.mts). link only links; it never builds (link-build.mts rebuilds):
//   npm       each copy that `npm query` lists below node_modules becomes a link to the provider's package folder;
//   Composer  each copy that installed.json of the vendor of the consumer's Composer project (composer config vendor-dir)
//             lists at its install-path becomes a link to the provider's package folder, then composer dump-autoload runs;
//   Python    one uv pip install per environment, with dependencies: -e for each declared polyspec package and each
//             polyspec package below it, and an --overrides file of -e lines, so a sibling that a provider requires by
//             its release URL resolves to the editable provider too;
//   Go        var/link/go.work uses the consumer's modules and the provider modules; kit.mk exports it as GOWORK;
//   Rust      `cargo <dir> <args>` runs one cargo command with --config patches and a lock copy under var/link/cargo.
// Without POLYSPEC_CHECKOUTS every command does nothing (cargo runs as given), and the installs stay the locked releases.
// A consumer is a directory: the top of a work tree stands for every tracked manifest of it, another directory for those
// below it. Each file that link writes into a repository is one that Git ignores there: var/link of the consumer, else
// var/link/consumers/<consumer> of the kit checkout under the root, and link prints the GOWORK to export (K203).
//   node link.mjs link|check|unlink <dir>... | rebuild <repository>... | packages <dir> python|npm | cargo <dir> <args>...
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { parsePipRequirementsLine } from 'pip-requirements-js';
import { isJsonObject, readJsonObject, writeAtomic } from './bootstrap/files.mts';
import { toolsPath } from './bootstrap/tool-wrappers.mts';
import { composerVendor } from './composer-vendor.mts';
import { composerCommand } from './install-composer-project.mts';
import { buildState, rebuild } from './link-build.mts';
import {
  assertIgnored, declaredRoot, isIgnored, type Ecosystem, EXCLUDED, goModule, type GoRequirement, mainCheckouts, MANIFESTS, type Provider,
  providerKey, providers, readTomlFile, repositoryOf, type Tool, trackedManifests, workTreeOf,
} from './link-providers.mts';
import { toolCommand, toolsEnvironment } from './mise-tools.mts';
import { isMain } from './paths.mts';
import { errorCode, execute, run } from './process.mts';
import { dependencyArrays, dependencyGroups, normalizeName } from './pyproject-dependencies.mts';

type Print = (text: string) => void;

/** The pin rule of the links: only a package pinned at 0.0.x is linked (docs/plans/local-links.md). */
const ZERO = /^v?0\.0\./;

/**
 * The command `name` of the consumer `top`: the variable `variable` when the recipe gives it, else the tool of the checkout
 * (the shim of mise, var/tools/bin/npm, the Composer of mise.toml, or the cargo of rustup); a missing tool fails with its cause.
 */
function consumerTool(top: string, name: 'npm' | 'composer' | 'uv' | 'go' | 'cargo', env: NodeJS.ProcessEnv): Tool {
  const variable = { npm: 'NPM', composer: 'COMPOSER_BIN', uv: 'UV', go: 'GO', cargo: 'CARGO' }[name];
  const given = env[variable];
  if (given) return { command: given, env };
  if (name === 'cargo') return { command: 'cargo', env };
  if (name === 'composer') return { command: composerCommand(top, `the links of ${top}`), env: toolsEnvironment(top, env) };
  const command = name === 'npm' ? toolsPath(top, 'bin', 'npm') : toolCommand(top, name);
  if (!existsSync(command)) throw new Error(`the links of ${top} need ${command}; run make install-tools there, or give ${variable}`);
  return { command, env: toolsEnvironment(top, env) };
}

/** The real path of `file`, or undefined when it does not exist; any other error is thrown. */
function real(file: string): string | undefined {
  try { return realpathSync(file); } catch (error) {
    if (errorCode(error) === 'ENOENT') return undefined;
    throw error;
  }
}

/** The JSON of the file `file`, an error naming the file when it is malformed. */
function readJsonOf(file: string): unknown {
  try { return JSON.parse(readFileSync(file, 'utf8')) as unknown; } catch (error) {
    throw new Error(`${file} holds no valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** The JSON that a command prints, an error naming the command when it is malformed. */
function parseOutput(text: string, what: string): unknown {
  try { return JSON.parse(text) as unknown; } catch (error) {
    throw new Error(`${what} printed no valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** The consumer of a directory: its work tree, its repository, the folder that bounds it and its tracked manifests. */
type Consumer = { top: string; repository: string; scope: string; manifests: (ecosystem: Ecosystem, all?: boolean) => string[] };

function consumerOf(directory: string): Consumer {
  const scope = realpathSync(directory);
  const top = workTreeOf(scope);
  const inside = (file: string) => scope === top || `${file}/`.startsWith(`${scope}/`);
  return {
    top, scope, repository: repositoryOf(scope),
    // Go lists every module, so the go.work covers each module that a go command can run in; the others leave out EXCLUDED.
    manifests: (ecosystem, all = false) => trackedManifests(top, [MANIFESTS[ecosystem]]).filter(file => all || !EXCLUDED.test(file)).map(file => path.join(top, file)).filter(inside),
  };
}

/** The work of one run. */
type Run = { root: string; found: Map<string, Provider>; check: boolean; print: Print; failed: boolean; env: NodeJS.ProcessEnv };

/** Prints a state line: `state` (linked, NOT linked, STALE, own) of `ecosystem` and the text. */
const line = (work: Run, state: string, ecosystem: string, text: string) => work.print(`  ${state.padEnd(10)} ${ecosystem.padEnd(8)} ${text}`);

/** The provider of `name`, or why there is none to link: own repository or no provider. */
function providerFor(work: Run, consumer: Consumer, ecosystem: Ecosystem, name: string): Provider | 'own' | 'no provider' {
  const found = work.found.get(providerKey(ecosystem, name));
  if (!found) return 'no provider';
  return found.repository === consumer.repository ? 'own' : found;
}

/** Reports a polyspec package that is not linked for `reason`, which fails the run; own packages are listed and pass. */
function unlinkable(work: Run, ecosystem: Ecosystem, name: string, reason: string) {
  if (reason === 'own') { line(work, 'own', ecosystem, `${name} (this repository)`); return; }
  line(work, 'NOT linked', ecosystem, `${name} (${reason})`);
  work.failed = true;
}

/** The reason that the pin `version` is not linked, or undefined for a 0.0.x pin. */
const pinProblem = (version: string): string | undefined => (ZERO.test(version) ? undefined : `pinned ${version}, not 0.0.x`);

/** Reports the state of the link `installed` of `provider`: linked, or STALE when its npm build is behind its sources. */
function reportLink(work: Run, ecosystem: Ecosystem, name: string, provider: Provider) {
  const state = ecosystem === 'npm' ? buildState(provider.checkout, provider.folder) : 'fresh';
  if (!state.startsWith('stale')) { line(work, 'linked', ecosystem, `${name} -> ${provider.folder}`); return; }
  line(work, 'STALE', ecosystem, `${name} -> ${provider.folder}: ${state}; run link.mjs rebuild ${provider.checkout}`);
  if (work.check) work.failed = true;
}

/**
 * Links the installed copy `installed` (pinned at `version`) of `name` to `provider`, or with check reports it. Returns
 * whether a link was made.
 */
function linkCopy(work: Run, ecosystem: Ecosystem, name: string, installed: string, version: string, provider: Provider): boolean {
  if (real(installed) === realpathSync(provider.folder)) { reportLink(work, ecosystem, name, provider); return false; }
  const problem = pinProblem(version);
  if (problem) { unlinkable(work, ecosystem, name, `${problem}: ${installed}`); return false; }
  if (work.check) { unlinkable(work, ecosystem, name, installed); return false; }
  assertIgnored(installed);
  rmSync(installed, { recursive: true, force: true });
  symlinkSync(path.relative(path.dirname(installed), provider.folder), installed);
  line(work, 'linked', ecosystem, `${name} -> ${provider.folder} (now)`);
  return true;
}

/**
 * The file `relative` of the links of the consumer `top`: in var/link of the consumer when Git ignores it there, else, as for
 * a consumer that ignores no var/ (one without kit), in var/link/consumers/<consumer> of the kit checkout under the root,
 * which kit ignores; a path that neither ignores fails with it (K203).
 */
export function linkFile(root: string, top: string, relative: string): string {
  const local = path.join(top, 'var/link', relative);
  if (isIgnored(local)) return local;
  const shared = path.join(root, 'kit/var/link/consumers', top.replaceAll(path.sep, '_').replace(/^_/, ''), relative);
  assertIgnored(shared);
  return shared;
}

// --- npm: npm query lists the installed copies; every @polyspec folder of a node_modules is either such a copy or a link.

/** Every @polyspec/<name> folder of the node_modules trees of `project`, as it is found: a link or a folder. */
function polyspecFolders(project: string): string[] {
  const found: string[] = [];
  const walk = (modules: string) => {
    if (!existsSync(modules)) return;
    for (const entry of readdirSync(modules, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const folder = path.join(modules, entry.name);
      const packages = entry.name.startsWith('@') && entry.isDirectory() ? readdirSync(folder, { withFileTypes: true }).map(item => ({ item, at: path.join(folder, item.name) })) : [{ item: entry, at: folder }];
      for (const { item, at } of packages) {
        if (entry.name === '@polyspec') found.push(at);
        if (item.isDirectory()) walk(path.join(at, 'node_modules'));
      }
    }
  };
  walk(path.join(project, 'node_modules'));
  return found.sort();
}

/** The polyspec dependencies that the npm manifest `file` declares, in every section and overrides. */
function declaredNpm(file: string): string[] {
  const manifest = readJsonObject(file);
  return ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies', 'overrides']
    .flatMap(section => (isJsonObject(manifest[section]) ? Object.keys(manifest[section]) : [])).filter(name => name.startsWith('@polyspec/'));
}

function linkNpm(work: Run, consumer: Consumer) {
  const files = consumer.manifests('npm');
  const projects = files.map(file => path.dirname(file)).filter(folder => existsSync(path.join(folder, 'package-lock.json')) && existsSync(path.join(folder, 'node_modules')));
  const seen = new Set<string>();
  if (projects.length) {
    const npm = consumerTool(consumer.top, 'npm', work.env);
    for (const project of projects) {
      const queried = parseOutput(run(npm.command, ['query', '[name^="@polyspec/"]'], { cwd: project, env: npm.env }), `npm query in ${project}`);
      const versions = new Map<string, string>();
      for (const entry of Array.isArray(queried) ? queried.filter(isJsonObject) : []) {
        if (typeof entry.location === 'string' && entry.location.includes('node_modules/') && !entry.location.startsWith('..') && typeof entry.version === 'string') versions.set(path.join(project, entry.location), entry.version);
      }
      for (const folder of polyspecFolders(project)) {
        const name = `@polyspec/${path.basename(folder)}`;
        seen.add(name);
        const provider = providerFor(work, consumer, 'npm', name);
        if (typeof provider === 'string') { unlinkable(work, 'npm', name, provider); continue; }
        const version = versions.get(folder);
        if (version === undefined && !lstatSync(folder).isSymbolicLink()) { unlinkable(work, 'npm', name, `a plain copy that npm does not record: ${folder}`); continue; }
        linkCopy(work, 'npm', name, folder, version ?? '0.0.0', provider);
      }
    }
  }
  for (const name of new Set(files.flatMap(declaredNpm))) {
    if (seen.has(name)) continue;
    const provider = providerFor(work, consumer, 'npm', name);
    unlinkable(work, 'npm', name, typeof provider === 'string' ? provider : 'not installed');
  }
}

// --- Composer: the vendor of each Composer project of the consumer, and Composer's record of it.

/** The packages of installed.json, in either of Composer's formats. */
function installedPackages(record: string): Record<string, unknown>[] {
  const parsed = readJsonOf(record);
  const list = isJsonObject(parsed) ? parsed.packages : parsed;
  if (!Array.isArray(list)) throw new Error(`${record} lists no packages`);
  return list.filter(isJsonObject);
}

/** The Composer project of each composer.json of the consumer: the nearest project at or above it whose vendor holds installed.json. */
function composerProjects(consumer: Consumer, composer: Tool): { project: string; vendor: string }[] {
  const found = new Map<string, string>();
  for (const file of consumer.manifests('composer')) {
    for (let project = path.dirname(file); `${project}/`.startsWith(`${consumer.top}/`); project = path.dirname(project)) {
      if (!existsSync(path.join(project, MANIFESTS.composer))) continue;
      const vendor = composerVendor(project, composer);
      if (existsSync(path.join(vendor, 'composer/installed.json'))) { found.set(vendor, project); break; }
    }
  }
  return [...found].map(([vendor, project]) => ({ project, vendor }));
}

function linkComposer(work: Run, consumer: Consumer) {
  if (!consumer.manifests('composer').length) return;
  const composer = consumerTool(consumer.top, 'composer', work.env);
  for (const { project, vendor } of composerProjects(consumer, composer)) {
    const record = path.join(vendor, 'composer/installed.json');
    const recorded = new Set<string>();
    let linked = false;
    for (const entry of installedPackages(record)) {
      if (typeof entry.name !== 'string' || !entry.name.startsWith('polyspec/')) continue;
      const installed = typeof entry['install-path'] === 'string' ? path.resolve(path.dirname(record), entry['install-path']) : path.join(vendor, entry.name);
      recorded.add(installed);
      const provider = providerFor(work, consumer, 'composer', entry.name);
      if (typeof provider === 'string') { unlinkable(work, 'composer', entry.name, provider); continue; }
      if (linkCopy(work, 'composer', entry.name, installed, typeof entry.version === 'string' ? entry.version : '', provider)) linked = true;
    }
    const folder = path.join(vendor, 'polyspec');
    for (const item of existsSync(folder) ? readdirSync(folder) : []) {
      if (!recorded.has(path.join(folder, item))) unlinkable(work, 'composer', `polyspec/${item}`, `a plain copy that Composer does not record: ${path.join(folder, item)}`);
    }
    // Composer's own answer to autoload rules that a linked package changed.
    if (linked) run(composer.command, ['dump-autoload', '--working-dir', project], { env: composer.env });
  }
}

// --- Python: the environment of each pyproject, uv's project environment of its workspace root.

/** The environment of the pyproject in `folder`: VENV, else UV_PROJECT_ENVIRONMENT or .venv of `uv workspace dir`; undefined when none exists. */
function environmentOf(uv: Tool, folder: string): string | undefined {
  if (uv.env.VENV) return existsSync(path.join(uv.env.VENV, 'pyvenv.cfg')) ? path.resolve(uv.env.VENV) : undefined;
  const workspace = run(uv.command, ['workspace', 'dir'], { cwd: folder, env: uv.env }).trim();
  const venv = path.resolve(workspace, uv.env.UV_PROJECT_ENVIRONMENT ?? '.venv');
  return existsSync(path.join(venv, 'pyvenv.cfg')) ? venv : undefined;
}

/** The normalized polyspec requirements of the pyproject `file`: dependencies, extras and dependency groups (PEP 508, PEP 735). */
function declaredPython(file: string): string[] {
  const document = readTomlFile(file);
  const requirements = [
    ...dependencyArrays(document, file).filter(array => !array.kind.startsWith('group:')).flatMap(array => array.list),
    ...[...dependencyGroups(document, file).values()].flat(),
  ];
  return [...new Set(requirements.flatMap((item) => {
    if (typeof item !== 'string') return [];
    const parsed = parsePipRequirementsLine(item);
    return parsed && (parsed.type === 'ProjectName' || parsed.type === 'ProjectURL') ? [normalizeName(parsed.name)] : [];
  }).filter(name => name.startsWith('polyspec-')))];
}

/** `names` with every polyspec package that their providers require, as providers; a requirement without a provider is reported. */
function closure(work: Run, consumer: Consumer, names: Iterable<string>): Provider[] {
  const result = new Map<string, Provider>();
  const pending = [...names];
  for (let name = pending.pop(); name !== undefined; name = pending.pop()) {
    if (result.has(name)) continue;
    const provider = providerFor(work, consumer, 'python', name);
    if (typeof provider === 'string') { unlinkable(work, 'python', name, provider); continue; }
    result.set(name, provider);
    pending.push(...declaredPython(path.join(provider.folder, MANIFESTS.python)));
  }
  return [...result.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** The installed distributions of `venv` by normalized name: version and editable location (uv pip list --format json). */
function installedPython(uv: Tool, venv: string): Map<string, { version: string; editable?: string }> {
  const listed = parseOutput(run(uv.command, ['pip', 'list', '--format', 'json', '--python', path.join(venv, 'bin/python')], { env: uv.env }), `uv pip list in ${venv}`);
  const found = new Map<string, { version: string; editable?: string }>();
  for (const item of Array.isArray(listed) ? listed.filter(isJsonObject) : []) {
    if (typeof item.name !== 'string' || typeof item.version !== 'string') continue;
    found.set(normalizeName(item.name), typeof item.editable_project_location === 'string' ? { version: item.version, editable: item.editable_project_location } : { version: item.version });
  }
  return found;
}

function linkPython(work: Run, consumer: Consumer) {
  const byVenv = new Map<string, Set<string>>();
  const files = consumer.manifests('python').filter(file => declaredPython(file).length);
  if (!files.length) return;
  const uv = consumerTool(consumer.top, 'uv', work.env);
  for (const file of files) {
    const venv = environmentOf(uv, path.dirname(file));
    if (!venv) { for (const name of declaredPython(file)) unlinkable(work, 'python', name, `environment not installed for ${path.relative(consumer.top, path.dirname(file)) || '.'}: run the repository's install, or give VENV or UV_PROJECT_ENVIRONMENT`); continue; }
    byVenv.set(venv, new Set([...byVenv.get(venv) ?? [], ...declaredPython(file)]));
  }
  for (const [venv, names] of byVenv) {
    const installed = installedPython(uv, venv);
    const linked = closure(work, consumer, names).filter((provider) => {
      const problem = pinProblem(installed.get(provider.name)?.version ?? '0.0.0');
      if (problem) unlinkable(work, 'python', provider.name, `${problem} in ${venv}`);
      return !problem;
    });
    const isLinked = (provider: Provider) => real(installed.get(provider.name)?.editable ?? '') === realpathSync(provider.folder);
    if (work.check || linked.every(isLinked)) {
      for (const provider of linked) {
        if (isLinked(provider)) line(work, 'linked', 'python', `${provider.name} -> ${provider.folder} (${venv})`);
        else unlinkable(work, 'python', provider.name, venv);
      }
      continue;
    }
    // uv reads the paths of a requirements file relative to its working directory, the consumer's top.
    const relative = (folder: string) => path.relative(consumer.top, folder) || '.';
    const overrides = linkFile(work.root, consumer.top, `${path.relative(consumer.top, venv).replaceAll('/', '_') || 'venv'}.overrides.txt`);
    writeAtomic(overrides, [...work.found.values()].filter(item => item.ecosystem === 'python' && item.repository !== consumer.repository).map(item => `-e ${relative(item.folder)}\n`).sort().join(''));
    run(uv.command, ['pip', 'install', '--python', path.join(venv, 'bin/python'), '--overrides', relative(overrides), ...linked.flatMap(item => ['--reinstall-package', item.name]), ...linked.flatMap(item => ['-e', relative(item.folder)])], { cwd: consumer.top, env: uv.env });
    for (const provider of linked) line(work, 'linked', 'python', `${provider.name} -> ${provider.folder} (${venv}, now)`);
  }
}

// --- Go: one go.work of the consumer.

/** The go.work that link writes for the consumer `top`; kit.mk exports var/link/go.work of a kit checkout as GOWORK. */
export const goWork = (root: string, top: string): string => linkFile(root, top, 'go.work');

function linkGo(work: Run, consumer: Consumer) {
  const files = consumer.manifests('go', true);
  if (!files.length) return;
  const go = consumerTool(consumer.top, 'go', work.env);
  const requires = new Map<string, { provider: Provider; requirement: GoRequirement }>();
  for (const file of files) {
    for (const requirement of goModule(go, file, consumer.top).requires.filter(item => item.path.startsWith('github.com/polyspec/'))) {
      const provider = providerFor(work, consumer, 'go', requirement.path);
      const problem = typeof provider === 'string' ? provider : pinProblem(requirement.version);
      if (problem) unlinkable(work, 'go', requirement.path, problem);
      else if (typeof provider !== 'string') requires.set(requirement.path, { provider, requirement });
    }
  }
  const file = goWork(work.root, consumer.top);
  if (work.check) {
    for (const [name, { provider }] of requires) {
      const dir = existsSync(file) ? run(go.command, ['list', '-m', '-f', '{{.Dir}}', name], { cwd: path.dirname(files[0] ?? consumer.top), env: { ...go.env, GOWORK: file } }).trim() : '';
      if (real(dir) === realpathSync(provider.folder)) line(work, 'linked', 'go', `${name} -> ${provider.folder} (GOWORK=${file})`);
      else unlinkable(work, 'go', name, `GOWORK=${file}`);
    }
    return;
  }
  assertIgnored(`${file}.sum`);
  rmSync(file, { force: true });
  rmSync(`${file}.sum`, { force: true });
  if (!requires.size) return;
  mkdirSync(path.dirname(file), { recursive: true });
  const folders = [...files.map(item => path.dirname(item)), ...new Set([...requires.values()].map(item => item.provider.folder))];
  run(go.command, ['work', 'init', ...folders.map(folder => path.relative(path.dirname(file), folder))], { cwd: path.dirname(file), env: { ...go.env, GOWORK: file } });
  for (const [name, { provider }] of requires) line(work, 'linked', 'go', `${name} -> ${provider.folder} (GOWORK=${file})`);
  work.print(`  export GOWORK=${file}`);
}

// --- the commands.

/** Links (or with `check`, reports) every polyspec package of each directory of `directories`; false when one is not linked. */
export function link({ directories, check, print, env = process.env }: { directories: readonly string[]; check: boolean; print: Print; env?: NodeJS.ProcessEnv }): boolean {
  const root = declaredRoot(env);
  if (!root) { print(`${check ? 'check' : 'link'}: POLYSPEC_CHECKOUTS is not set; the installs stay the locked releases`); return true; }
  const consumers = directories.map(consumerOf);
  const first = consumers[0];
  const go = first && first.manifests('go', true).length ? consumerTool(first.top, 'go', env) : undefined;
  const work: Run = { root, found: providers(root, go, first?.top ?? root), check, print, failed: false, env };
  for (const consumer of consumers) {
    print(`== ${consumer.scope}`);
    linkNpm(work, consumer);
    linkComposer(work, consumer);
    linkPython(work, consumer);
    linkGo(work, consumer);
  }
  return !work.failed;
}

/** The polyspec packages of `ecosystem` that the consumer `directory` declares, for a recipe (uv sync --no-install-package). */
export function packages(directory: string, ecosystem: 'python' | 'npm', env: NodeJS.ProcessEnv = process.env): string[] {
  if (!declaredRoot(env)) return [];
  const consumer = consumerOf(directory);
  const names = ecosystem === 'python' ? consumer.manifests('python').flatMap(declaredPython) : consumer.manifests('npm').flatMap(declaredNpm);
  return [...new Set(names)].sort();
}

/** Restores the locked installs of each directory with each tool's own install and removes var/link; false when one is skipped. */
export function unlink({ directories, print, env = process.env }: { directories: readonly string[]; print: Print; env?: NodeJS.ProcessEnv }): boolean {
  const root = declaredRoot(env);
  if (!root) { print('unlink: POLYSPEC_CHECKOUTS is not set; nothing is linked'); return true; }
  let restored = true;
  const skip = (text: string) => { print(`  skipped    ${text}`); restored = false; };
  for (const consumer of directories.map(consumerOf)) {
    print(`== ${consumer.scope}`);
    for (const folder of consumer.manifests('npm').map(file => path.dirname(file)).filter(item => existsSync(path.join(item, 'node_modules')))) {
      if (!existsSync(path.join(folder, 'package-lock.json'))) { skip(`npm ${folder}: no package-lock.json; its workspace root restores it`); continue; }
      const npm = consumerTool(consumer.top, 'npm', env);
      run(npm.command, ['ci'], { cwd: folder, env: npm.env });
      print(`  restored   npm      ${folder}`);
    }
    if (consumer.manifests('composer').length) {
      const composer = consumerTool(consumer.top, 'composer', env);
      for (const { project, vendor } of composerProjects(consumer, composer)) {
        const folder = path.join(vendor, 'polyspec');
        for (const item of existsSync(folder) ? readdirSync(folder) : []) if (lstatSync(path.join(folder, item)).isSymbolicLink()) rmSync(path.join(folder, item));
        if (!existsSync(path.join(project, 'composer.lock'))) { skip(`composer ${project}: no composer.lock`); continue; }
        run(composer.command, ['install', '--no-interaction'], { cwd: project, env: composer.env });
        print(`  restored   composer ${project}`);
      }
    }
    const pythonFiles = consumer.manifests('python').filter(file => declaredPython(file).length);
    if (pythonFiles.length) {
      const uv = consumerTool(consumer.top, 'uv', env);
      for (const file of pythonFiles) {
        const venv = environmentOf(uv, path.dirname(file));
        const workspace = run(uv.command, ['workspace', 'dir'], { cwd: path.dirname(file), env: uv.env }).trim();
        if (!venv || !existsSync(path.join(workspace, 'uv.lock'))) { skip(`python ${path.dirname(file)}: no environment or no uv.lock; run the repository's install`); continue; }
        run(uv.command, ['sync', '--locked'], { cwd: workspace, env: { ...uv.env, UV_PROJECT_ENVIRONMENT: venv } });
        print(`  restored   python   ${venv}`);
      }
    }
    rmSync(path.dirname(linkFile(root, consumer.top, 'go.work')), { recursive: true, force: true });
  }
  return restored;
}

/** The repository URL that the checkout `checkout` declares in config/release.json. */
function declaredUrl(checkout: string): string {
  const file = path.join(checkout, 'config/release.json');
  const url = existsSync(file) ? readJsonObject(file).repositoryUrl : undefined;
  if (typeof url !== 'string') throw new Error(`${file} declares no repositoryUrl, which the Cargo patch of ${checkout} needs`);
  return url;
}

/** Runs one cargo command in `directory`; with the root declared, the polyspec git sources are patched to their providers. */
export function cargo({ directory, args, env = process.env }: { directory: string; args: readonly string[]; env?: NodeJS.ProcessEnv }): number {
  const root = declaredRoot(env);
  const consumer = consumerOf(directory);
  const tool = consumerTool(consumer.top, 'cargo', env);
  const config: string[] = [];
  if (root) {
    const workspace = path.dirname(run(tool.command, ['locate-project', '--workspace', '--message-format', 'plain'], { cwd: consumer.scope, env: tool.env }).trim());
    // A fresh copy of the tracked lock on every run, so the patches resolve against the lock of the tree.
    const copy = linkFile(root, consumer.top, path.join('cargo', path.relative(consumer.top, workspace).replaceAll('/', '_') || 'root', 'Cargo.lock'));
    mkdirSync(path.dirname(copy), { recursive: true });
    copyFileSync(path.join(workspace, 'Cargo.lock'), copy);
    config.push('--config', `resolver.lockfile-path=${JSON.stringify(copy)}`);
    for (const checkout of mainCheckouts(root).filter(item => repositoryOf(item) !== consumer.repository)) {
      const crates = trackedManifests(checkout, ['Cargo.toml']).filter(file => !EXCLUDED.test(file)).flatMap((file) => {
        const pkg = readTomlFile(path.join(checkout, file)).package;
        return isJsonObject(pkg) && typeof pkg.name === 'string' ? [{ name: pkg.name, folder: path.join(checkout, path.dirname(file)) }] : [];
      });
      if (!crates.length) continue;
      const url = declaredUrl(checkout);
      for (const crate of crates) config.push('--config', `patch.${JSON.stringify(url)}.${crate.name}.path=${JSON.stringify(crate.folder)}`);
    }
  }
  const outcome = execute(tool.command, [...config, ...args], { cwd: directory, env: tool.env });
  if (outcome.error) throw new Error(`${tool.command} could not start: ${outcome.error.message}`);
  process.stdout.write(outcome.stdout);
  process.stderr.write(outcome.stderr);
  return outcome.status ?? 1;
}

if (isMain(import.meta.url)) {
  const [command, ...rest] = process.argv.slice(2);
  const print: Print = text => process.stdout.write(`${text}\n`);
  const directories = rest.length ? rest : ['.'];
  try {
    switch (command) {
      case 'link': case 'check':
        if (!link({ directories, check: command === 'check', print })) process.exitCode = 1;
        break;
      case 'unlink':
        if (!unlink({ directories, print })) process.exitCode = 1;
        break;
      case 'rebuild':
        for (const repository of rest) rebuild(workTreeOf(repository), print);
        break;
      case 'packages': {
        const [directory, ecosystem] = rest;
        if (!directory || (ecosystem !== 'python' && ecosystem !== 'npm')) throw new Error('Usage: link.mjs packages <dir> python|npm');
        for (const name of packages(directory, ecosystem)) print(name);
        break;
      }
      case 'cargo': {
        const [directory, ...args] = rest;
        if (!directory) throw new Error('Usage: link.mjs cargo <dir> <cargo args>...');
        process.exitCode = cargo({ directory, args });
        break;
      }
      default: throw new Error('Usage: link.mjs link|check|unlink <dir>... | rebuild <repository>... | packages <dir> python|npm | cargo <dir> <args>...');
    }
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
