// The local links of 0.0.x development (docs/plans/local-links.md, K201). With the polyspec root declared in
// POLYSPEC_CHECKOUTS, each installed polyspec package of a consumer is pointed at the source of the main checkout that
// provides it (link-providers.mts), after that provider was built (link-build.mts):
//   npm       each copy that npm's own record, the hidden lockfile node_modules/.package-lock.json of an npm project,
//             lists becomes a link to the provider's package folder;
//   Composer  each copy that Composer's own record, <vendor>/composer/installed.json (its install-path), lists becomes a link
//             to the provider's package folder; composer dump-autoload runs when the provider's autoload rules differ;
//   Python    one uv pip install per environment of a pyproject, with dependencies: -e for each declared polyspec package
//             and each polyspec package below it, and an --overrides file of -e lines for every polyspec package, so a
//             sibling that a provider requires by its release URL resolves to the editable provider too;
//   Go        var/link/go.work uses the consumer's modules and the provider modules; kit.mk exports it as GOWORK;
//   Rust      `cargo <dir> <args>` runs one cargo command with --config patches and a lock copy under var/link/cargo.
// Without POLYSPEC_CHECKOUTS, link, check and cargo do nothing more than run cargo as given, and the installs stay the
// locked releases. unlink restores the locked installs with each tool's own install. A consumer is a directory: the top
// of a work tree stands for every tracked manifest of it, another directory for those below it.
//   node link.mjs link|check|unlink <dir>... | rebuild <repository>... | packages <dir> <ecosystem> | cargo <dir> <args>...
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { isJsonObject, readJsonObject, writeAtomic } from './bootstrap/files.mts';
import { toolsPath } from './bootstrap/tool-wrappers.mts';
import { gitResult } from './git.mts';
import { build, buildState } from './link-build.mts';
import { declaredRoot, type Ecosystem, goModule, MANIFESTS, type Provider, providerKey, providers, readPyproject, repositoryOf, trackedManifests, workTreeOf } from './link-providers.mts';
import { toolCommand, toolsEnvironment } from './mise-tools.mts';
import { isMain } from './paths.mts';
import { execute, run } from './process.mts';
import { dependencyArrays, normalizeName } from './pyproject-dependencies.mts';
import { readToml } from './toml.mts';

type Print = (text: string) => void;
type Tool = { command: string; env: NodeJS.ProcessEnv };

// Folders that hold no project of the consumer: a test project of a release consumer, a fixture or the tools of mise.
const NOT_CONSUMER = /(^|\/)(tests\/release-[^/]*|release-consumer|[^/]*fixtures?|\.mise)\//;

/**
 * The command `name` of the consumer `top`: the variable `variable` when the recipe gives it, else the shim of mise of a
 * kit checkout, else var/tools/bin/<name>; undefined when the consumer has none.
 */
function consumerTool(top: string, name: string, variable: string, env: NodeJS.ProcessEnv): Tool | undefined {
  const given = env[variable];
  if (given) return { command: given, env };
  if (existsSync(toolCommand(top, name))) return { command: toolCommand(top, name), env: toolsEnvironment(top, env) };
  const bin = toolsPath(top, 'bin', name);
  return existsSync(bin) ? { command: bin, env } : undefined;
}

/** The real path of `file`, or undefined when it does not exist. */
function real(file: string): string | undefined {
  try { return realpathSync(file); } catch { return undefined; }
}

/** Prints a state line: `state` (linked, NOT linked, STALE, own) of `ecosystem` and the text. */
const line = (print: Print, state: string, ecosystem: string, text: string) => print(`  ${state.padEnd(10)} ${ecosystem.padEnd(8)} ${text}`);

/** The consumer of a directory: its work tree, its repository, the folder that bounds it and its tracked manifests. */
type Consumer = { top: string; repository: string; scope: string; manifests: (ecosystem: Ecosystem) => string[] };

function consumerOf(directory: string): Consumer {
  const scope = realpathSync(directory);
  const top = workTreeOf(scope);
  const inside = (file: string) => (scope === top || `${file}/`.startsWith(`${scope}/`)) && !NOT_CONSUMER.test(path.relative(top, file));
  const tracked = gitResult(top, 'rev-parse').status === 0;
  return {
    top, scope, repository: repositoryOf(scope),
    manifests: ecosystem => (tracked ? trackedManifests(top, [MANIFESTS[ecosystem]]).map(file => path.join(top, file)) : [path.join(scope, MANIFESTS[ecosystem])].filter(existsSync)).filter(inside),
  };
}

/** The work of one run: the root, the providers and the repositories already built. */
type Run = { root: string; found: Map<string, Provider>; built: Set<string>; check: boolean; print: Print; failed: boolean; env: NodeJS.ProcessEnv };

/** The provider of `name`, or a reason why there is none to link: own repository or no provider. */
function providerFor(work: Run, consumer: Consumer, ecosystem: Ecosystem, name: string): Provider | string {
  const found = work.found.get(providerKey(ecosystem, name));
  if (!found) return 'no provider';
  return found.repository === consumer.repository ? 'own' : found;
}

/** Builds the repository of `provider` once per run, before it is linked or found linked; check builds nothing. */
function ensureBuilt(work: Run, provider: Provider) {
  if (work.check || work.built.has(provider.repository)) return;
  work.built.add(provider.repository);
  build(workTreeOf(provider.folder), work.print);
}

/** Replaces the installed copy `installed` with a link to `provider`, or reports its state. */
function linkCopy(work: Run, ecosystem: Ecosystem, name: string, installed: string, provider: Provider): boolean {
  ensureBuilt(work, provider);
  if (real(installed) === realpathSync(provider.folder)) {
    const state = ecosystem === 'npm' ? buildState(workTreeOf(provider.folder), provider.folder) : 'fresh';
    if (state.startsWith('stale')) { line(work.print, 'STALE', ecosystem, `${name} -> ${provider.folder}: ${state}; run link.mjs rebuild ${workTreeOf(provider.folder)}`); work.failed = true; return false; }
    line(work.print, 'linked', ecosystem, `${name} -> ${provider.folder}`);
    return false;
  }
  if (work.check) { line(work.print, 'NOT linked', ecosystem, `${name} (${installed})`); work.failed = true; return false; }
  rmSync(installed, { recursive: true, force: true });
  symlinkSync(provider.folder, installed);
  line(work.print, 'linked', ecosystem, `${name} -> ${provider.folder} (now)`);
  return true;
}

/** Reports a polyspec dependency that is not linked for `reason`; own packages are listed and pass. */
function unlinkable(work: Run, ecosystem: Ecosystem, name: string, reason: string) {
  if (reason === 'own') { line(work.print, 'own', ecosystem, `${name} (this repository)`); return; }
  line(work.print, 'NOT linked', ecosystem, `${name} (${reason})`);
  work.failed = true;
}

// --- npm: the hidden lockfile of each npm project records every installed copy.

/** The polyspec dependencies that the npm manifests of the consumer declare, in every section and overrides. */
function declaredNpm(consumer: Consumer): Set<string> {
  const names = new Set<string>();
  for (const file of consumer.manifests('npm')) {
    const manifest = readJsonObject(file);
    for (const section of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies', 'overrides']) {
      const value = manifest[section];
      if (isJsonObject(value)) for (const name of Object.keys(value)) if (name.startsWith('@polyspec/')) names.add(name);
    }
  }
  return names;
}

function linkNpm(work: Run, consumer: Consumer) {
  const installed = new Set<string>();
  for (const lock of consumer.manifests('npm').map(file => path.join(path.dirname(file), 'node_modules/.package-lock.json')).filter(existsSync)) {
    const packages = readJsonObject(lock).packages;
    if (!isJsonObject(packages)) continue;
    for (const [key, entry] of Object.entries(packages)) {
      const name = key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length);
      if (!key.includes('node_modules/') || !name.startsWith('@polyspec/')) continue;
      // A link of npm into the project itself is a workspace package, not an installed copy.
      const project = path.dirname(path.dirname(lock));
      if (isJsonObject(entry) && entry.link === true && typeof entry.resolved === 'string' && `${path.resolve(project, entry.resolved)}/`.startsWith(`${consumer.top}/`)) continue;
      installed.add(name);
      const provider = providerFor(work, consumer, 'npm', name);
      if (typeof provider === 'string') { unlinkable(work, 'npm', name, provider); continue; }
      linkCopy(work, 'npm', name, path.join(project, key), provider);
    }
  }
  for (const name of declaredNpm(consumer)) {
    if (installed.has(name)) continue;
    const provider = providerFor(work, consumer, 'npm', name);
    unlinkable(work, 'npm', name, typeof provider === 'string' ? provider : 'not installed');
  }
}

// --- Composer: <vendor>/composer/installed.json of each vendor below the consumer records every installed copy.

/** Each installed.json of a vendor below `folder`, wherever COMPOSER_VENDOR_DIR placed it; node_modules, .git and var/tools are skipped. */
function composerRecords(folder: string): string[] {
  const found: string[] = [];
  const walk = (directory: string) => {
    const record = path.join(directory, 'composer/installed.json');
    if (existsSync(record)) { found.push(record); return; }
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || ['node_modules', '.git'].includes(entry.name)) continue;
      const next = path.join(directory, entry.name);
      if (path.relative(folder, next) === 'var/tools') continue;
      walk(next);
    }
  };
  walk(folder);
  return found.sort();
}

/** The packages of an installed.json, in either of Composer's formats. */
function installedPackages(record: string): Record<string, unknown>[] {
  const parsed = JSON.parse(readFileSync(record, 'utf8')) as unknown;
  const list = isJsonObject(parsed) ? parsed.packages : parsed;
  return Array.isArray(list) ? list.filter(isJsonObject) : [];
}

function linkComposer(work: Run, consumer: Consumer) {
  for (const record of composerRecords(consumer.scope)) {
    const vendor = path.dirname(path.dirname(record));
    let dump = false;
    for (const entry of installedPackages(record)) {
      if (typeof entry.name !== 'string' || !entry.name.startsWith('polyspec/')) continue;
      const provider = providerFor(work, consumer, 'composer', entry.name);
      if (typeof provider === 'string') { unlinkable(work, 'composer', entry.name, provider); continue; }
      const installed = typeof entry['install-path'] === 'string' ? path.resolve(path.dirname(record), entry['install-path']) : path.join(vendor, entry.name);
      const changed = linkCopy(work, 'composer', entry.name, installed, provider);
      const autoload = readJsonObject(path.join(provider.folder, MANIFESTS.composer)).autoload;
      if (changed && JSON.stringify(autoload) !== JSON.stringify(entry.autoload)) dump = true;
    }
    if (!dump) continue;
    const project = path.dirname(vendor);
    const composer = consumerTool(consumer.top, 'composer', 'COMPOSER_BIN', work.env);
    if (composer && existsSync(path.join(project, MANIFESTS.composer))) run(composer.command, ['dump-autoload', '--working-dir', project], { env: composer.env });
    else { work.print(`  composer   the autoload rules of a linked package differ; run composer dump-autoload in the project of ${vendor}`); work.failed = true; }
  }
}

// --- Python: the environment of each pyproject, uv's project environment of its workspace root.

/** The environment of the pyproject in `folder`: VENV, else UV_PROJECT_ENVIRONMENT or .venv of `uv workspace dir`; undefined when none exists. */
function environmentOf(uv: Tool, folder: string): string | undefined {
  if (uv.env.VENV) return existsSync(path.join(uv.env.VENV, 'pyvenv.cfg')) ? uv.env.VENV : undefined;
  const outcome = execute(uv.command, ['workspace', 'dir'], { cwd: folder, env: uv.env });
  const workspace = outcome.status === 0 ? outcome.stdout.trim() : folder;
  const venv = path.resolve(workspace, uv.env.UV_PROJECT_ENVIRONMENT ?? '.venv');
  return existsSync(path.join(venv, 'pyvenv.cfg')) ? venv : undefined;
}

/** The normalized polyspec requirements of the pyproject `file`: dependencies, extras and dependency groups. */
function declaredPython(file: string): string[] {
  return dependencyArrays(readPyproject(file), file).flatMap(array => array.list)
    .flatMap(item => (typeof item === 'string' ? [normalizeName(/^\s*([A-Za-z0-9][A-Za-z0-9._-]*)/.exec(item)?.[1] ?? '')] : []))
    .filter(name => name.startsWith('polyspec-'));
}

/** `names` with every polyspec package that their providers require, as providers. */
function closure(work: Run, consumer: Consumer, names: Iterable<string>): Provider[] {
  const result = new Map<string, Provider>();
  const pending = [...names];
  for (let name = pending.pop(); name !== undefined; name = pending.pop()) {
    const provider = providerFor(work, consumer, 'python', name);
    if (typeof provider === 'string' || result.has(name)) continue;
    result.set(name, provider);
    pending.push(...declaredPython(path.join(provider.folder, MANIFESTS.python)));
  }
  return [...result.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function linkPython(work: Run, consumer: Consumer) {
  const files = consumer.manifests('python');
  if (!files.length) return;
  const uv = consumerTool(consumer.top, 'uv', 'UV', work.env);
  const byVenv = new Map<string, Set<string>>();
  for (const file of files) {
    const names = declaredPython(file);
    if (!names.length) continue;
    const venv = uv && environmentOf(uv, path.dirname(file));
    if (!uv || !venv) { for (const name of names) unlinkable(work, 'python', name, uv ? `environment not installed for ${path.relative(consumer.top, path.dirname(file)) || '.'}: run the repository's install, or give VENV or UV_PROJECT_ENVIRONMENT` : 'no uv of the consumer: give UV'); continue; }
    const set = byVenv.get(venv) ?? new Set<string>();
    for (const name of names) set.add(name);
    byVenv.set(venv, set);
  }
  for (const [venv, names] of byVenv) {
    if (!uv) break;
    for (const name of names) { const provider = providerFor(work, consumer, 'python', name); if (typeof provider === 'string') unlinkable(work, 'python', name, provider); }
    const linked = closure(work, consumer, names);
    const python = path.join(venv, 'bin/python');
    const editable = (name: string) => /^Editable project location: (.*)$/m.exec(execute(uv.command, ['pip', 'show', '--python', python, name], { env: uv.env }).stdout)?.[1];
    if (work.check) {
      for (const provider of linked) {
        if (real(editable(provider.name) ?? '') === realpathSync(provider.folder)) line(work.print, 'linked', 'python', `${provider.name} -> ${provider.folder} (${venv})`);
        else { line(work.print, 'NOT linked', 'python', `${provider.name} (${venv})`); work.failed = true; }
      }
      continue;
    }
    for (const provider of linked) ensureBuilt(work, provider);
    const overrides = path.join(consumer.top, 'var/link', `${path.relative(consumer.top, venv).replaceAll('/', '_') || 'venv'}.overrides.txt`);
    writeAtomic(overrides, [...work.found.values()].filter(item => item.ecosystem === 'python' && item.repository !== consumer.repository).map(item => `-e ${item.folder}\n`).sort().join(''));
    run(uv.command, ['pip', 'install', '--python', python, '--overrides', overrides, ...linked.flatMap(item => ['--reinstall-package', item.name]), ...linked.flatMap(item => ['-e', item.folder])], { env: uv.env });
    for (const provider of linked) line(work.print, 'linked', 'python', `${provider.name} -> ${provider.folder} (${venv})`);
  }
}

// --- Go: one go.work of the consumer.

/** The go.work that link writes for the consumer `top`, which kit.mk exports as GOWORK. */
export const goWork = (top: string): string => path.join(top, 'var/link/go.work');

function linkGo(work: Run, consumer: Consumer, go: Tool | undefined) {
  const files = consumer.manifests('go');
  if (!files.length) return;
  if (!go) { work.print('  NOT linked go       no go of the consumer: give GO'); work.failed = true; return; }
  const modules = files.map(file => path.dirname(file));
  const requires = new Map<string, Provider>();
  for (const file of files) {
    for (const name of goModule(go.command, file, consumer.top, go.env).requires.filter(item => item.startsWith('github.com/polyspec/'))) {
      const provider = providerFor(work, consumer, 'go', name);
      if (typeof provider === 'string') unlinkable(work, 'go', name, provider);
      else requires.set(name, provider);
    }
  }
  const file = goWork(consumer.top);
  if (work.check) {
    for (const [name, provider] of requires) {
      const dir = existsSync(file) ? execute(go.command, ['list', '-m', '-f', '{{.Dir}}', name], { cwd: path.dirname(files[0] ?? consumer.top), env: { ...go.env, GOWORK: file } }).stdout.trim() : '';
      if (real(dir) === realpathSync(provider.folder)) line(work.print, 'linked', 'go', `${name} -> ${provider.folder} (GOWORK=${file})`);
      else { line(work.print, 'NOT linked', 'go', `${name} (GOWORK=${file})`); work.failed = true; }
    }
    return;
  }
  rmSync(file, { force: true });
  rmSync(`${file}.sum`, { force: true });
  if (!requires.size) return;
  mkdirSync(path.dirname(file), { recursive: true });
  run(go.command, ['work', 'init', ...modules, ...new Set([...requires.values()].map(item => item.folder))], { cwd: consumer.top, env: { ...go.env, GOWORK: file } });
  for (const [name, provider] of requires) line(work.print, 'linked', 'go', `${name} -> ${provider.folder} (GOWORK=${file})`);
}

// --- the commands.

/** Links (or with `check`, reports) every polyspec dependency of each directory of `directories`. */
export function link({ directories, check, print, env = process.env }: { directories: readonly string[]; check: boolean; print: Print; env?: NodeJS.ProcessEnv }): boolean {
  const root = declaredRoot(env);
  if (!root) { print('link: POLYSPEC_CHECKOUTS is not set; the installs stay the locked releases'); return true; }
  const firstTop = workTreeOf(directories[0] ?? '.');
  const go = consumerTool(firstTop, 'go', 'GO', env);
  const work: Run = { root, found: providers(root, go?.command, firstTop, go?.env ?? env), built: new Set(), check, print, failed: false, env };
  for (const directory of directories) {
    const consumer = consumerOf(directory);
    print(`== ${consumer.scope}`);
    linkNpm(work, consumer);
    linkComposer(work, consumer);
    linkPython(work, consumer);
    linkGo(work, consumer, consumerTool(consumer.top, 'go', 'GO', env));
  }
  return !work.failed;
}

/** Rebuilds each provider repository in place, without relinking. */
export function rebuild(repositories: readonly string[], print: Print): void {
  for (const repository of repositories) build(workTreeOf(repository), print);
}

/** The polyspec packages of `ecosystem` that the consumer `directory` declares, for a recipe (uv sync --no-install-package). */
export function packages(directory: string, ecosystem: Ecosystem): string[] {
  const consumer = consumerOf(directory);
  if (ecosystem === 'python') return [...new Set(consumer.manifests('python').flatMap(declaredPython))].sort();
  if (ecosystem === 'npm') return [...declaredNpm(consumer)].sort();
  throw new Error(`packages: ${ecosystem} is not listed; use python or npm`);
}

/** Restores the locked installs of each directory with each tool's own install, and removes var/link. */
export function unlink({ directories, print, env = process.env }: { directories: readonly string[]; print: Print; env?: NodeJS.ProcessEnv }): void {
  if (!declaredRoot(env)) { print('unlink: POLYSPEC_CHECKOUTS is not set; nothing is linked'); return; }
  for (const directory of directories) {
    const consumer = consumerOf(directory);
    print(`== ${consumer.scope}`);
    const npm = consumerTool(consumer.top, 'npm', 'NPM', env);
    for (const file of consumer.manifests('npm')) {
      const folder = path.dirname(file);
      if (npm && existsSync(path.join(folder, 'package-lock.json')) && existsSync(path.join(folder, 'node_modules'))) run(npm.command, ['ci'], { cwd: folder, env: npm.env });
    }
    const composer = consumerTool(consumer.top, 'composer', 'COMPOSER_BIN', env);
    for (const record of composerRecords(consumer.scope)) {
      const vendor = path.dirname(path.dirname(record));
      for (const entry of readdirSync(vendor, { withFileTypes: true }).filter(item => item.isDirectory())) {
        for (const item of readdirSync(path.join(vendor, entry.name))) {
          const copy = path.join(vendor, entry.name, item);
          if (lstatSync(copy).isSymbolicLink() && !`${real(copy) ?? ''}/`.startsWith(`${consumer.top}/`)) rmSync(copy);
        }
      }
      const project = path.dirname(vendor);
      if (composer && existsSync(path.join(project, 'composer.lock'))) run(composer.command, ['install', '--no-interaction'], { cwd: project, env: composer.env });
      else print(`  composer   run composer install in the project of ${vendor}`);
    }
    const uv = consumerTool(consumer.top, 'uv', 'UV', env);
    for (const file of consumer.manifests('python')) {
      const venv = uv && environmentOf(uv, path.dirname(file));
      if (uv && venv && existsSync(path.join(path.dirname(file), 'uv.lock'))) run(uv.command, ['sync', '--locked'], { cwd: path.dirname(file), env: { ...uv.env, UV_PROJECT_ENVIRONMENT: venv } });
    }
    rmSync(path.join(consumer.top, 'var/link'), { recursive: true, force: true });
  }
}

/** Runs one cargo command in `directory` with the polyspec git sources patched to their providers and a lock copy. */
export function cargo({ directory, args, env = process.env }: { directory: string; args: readonly string[]; env?: NodeJS.ProcessEnv }): number {
  const root = declaredRoot(env);
  const config: string[] = [];
  if (root) {
    const consumer = consumerOf(directory);
    const workspace = path.dirname(run('cargo', ['locate-project', '--workspace', '--message-format', 'plain'], { cwd: consumer.scope, env }).trim());
    const copy = path.join(consumer.top, 'var/link/cargo', path.relative(consumer.top, workspace).replaceAll('/', '_') || 'root', 'Cargo.lock');
    if (!existsSync(copy)) { mkdirSync(path.dirname(copy), { recursive: true }); copyFileSync(path.join(workspace, 'Cargo.lock'), copy); }
    config.push('--config', `resolver.lockfile-path=${JSON.stringify(copy)}`);
    for (const checkout of readdirSync(root).map(entry => path.join(root, entry)).filter(entry => existsSync(path.join(entry, '.git')))) {
      if (repositoryOf(checkout) === consumer.repository) continue;
      const url = execute('git', ['remote', 'get-url', 'origin'], { cwd: checkout }).stdout.trim();
      if (!url) continue;
      for (const file of trackedManifests(checkout, ['Cargo.toml'])) {
        const crate = cargoName(path.join(checkout, file));
        if (crate) config.push('--config', `patch.${JSON.stringify(url)}.${crate}.path=${JSON.stringify(path.join(checkout, path.dirname(file)))}`);
      }
    }
  }
  return execute('cargo', [...config, ...args], { cwd: directory, env }).status ?? 1;
}

/** The [package] name of the Cargo.toml `file`, or undefined for a workspace manifest. */
function cargoName(file: string): string | undefined {
  const pkg = readToml(readFileSync(file, 'utf8'), file).package;
  return isJsonObject(pkg) && typeof pkg.name === 'string' ? pkg.name : undefined;
}

if (isMain(import.meta.url)) {
  const [command, ...rest] = process.argv.slice(2);
  const print: Print = text => process.stdout.write(`${text}\n`);
  try {
    switch (command) {
      case 'link': case 'check':
        if (!link({ directories: rest.length ? rest : ['.'], check: command === 'check', print })) process.exitCode = 1;
        break;
      case 'unlink': unlink({ directories: rest.length ? rest : ['.'], print }); break;
      case 'rebuild': rebuild(rest, print); break;
      case 'packages': {
        const [directory, ecosystem] = rest;
        if (!directory || (ecosystem !== 'python' && ecosystem !== 'npm')) throw new Error('Usage: link.mjs packages <dir> python|npm');
        for (const name of declaredRoot() ? packages(directory, ecosystem) : []) print(name);
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

