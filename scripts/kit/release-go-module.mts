// The release of a Go module that links a static library (K1205). Go fetches a module as the source of a tag, so the tag of such a
// module names a commit that carries what no branch tracks: the generated Go files and the static library of each platform. The
// release makes that commit from the commit of the tag vX.Y.Z and tags it <directory of the Go module>/vX.Y.Z:
//   - its one parent is the commit of vX.Y.Z, and its tree is that tree with the generated files and the libraries added below the
//     directory of the Go module, and nothing else;
//   - no branch holds it, and the release pushes the tags alone;
//   - a library that is missing, empty, built for another platform or that holds a test entry point, a go.mod with a replace or
//     a v0.0.0 requirement, and a tag that exists each stop the release before any commit or tag is made;
//   - a consumer module that requires the Go module at the tag, with GOPROXY=direct and no CGO_LDFLAGS, passes go test before the
//     tag is made in the repository.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { matchesAny } from './glob.mts';
import { execute, run, Stop } from './process.mts';

/** The platforms of a Go module, `<GOOS>_<GOARCH>`, by the platform of the release whose set builds the library. */
export const GO_PLATFORMS = { 'linux-x64-gnu': 'linux_amd64', 'linux-arm64-gnu': 'linux_arm64', 'darwin-arm64': 'darwin_arm64' } as const;
export type GoPlatform = typeof GO_PLATFORMS[keyof typeof GO_PLATFORMS];
export const GO_PLATFORM_NAMES: readonly GoPlatform[] = Object.values(GO_PLATFORMS);

/** The object format and the machine of the objects of a library of each platform. */
const OBJECTS: Record<GoPlatform, string> = { linux_amd64: 'ELF x86-64', linux_arm64: 'ELF AArch64', darwin_arm64: 'Mach-O arm64' };

/** `goModule` of a go-static package of config/release.json. */
export type GoModule = {
  /** The directory of the Go module in the repository, which holds its go.mod. */
  directory: string;
  /** The directory of the libraries below the Go module; the library of a platform lies in `<library>/<GOOS>_<GOARCH>/`. */
  library: string;
  /** The globs, relative to the Go module, of the generated files that the commit of the module carries. */
  generated: string[];
  /** The parts of the names of the test entry points, which no library of a release defines. */
  testSymbols: string[];
};

/** A Go module of a release with the library file of each platform; a platform without a file is missing. */
export type GoModuleRelease = { module: GoModule; libraries: Partial<Record<GoPlatform, string>> };

export type GoModuleRun = {
  root: string;
  env: NodeJS.ProcessEnv;
  log: (text: string) => void;
  /** The tag vX.Y.Z of the release, whose commit is the parent. */
  tag: string;
  /** The remote that receives the tags. */
  remote: string;
  modules: GoModuleRelease[];
  /** llvm-nm and llvm-size of the Rust toolchain, and the go of the checkout. */
  llvmNm: string;
  llvmSize: string;
  go: string;
};

/** The tag that Go reads for the version `tag` of the module in `directory`. */
export const goModuleTag = (directory: string, tag: string): string => `${directory}/${tag}`;

/**
 * The object format and machine of the members of the ar archive `file`, each once: `ELF x86-64`, `ELF AArch64`, `Mach-O arm64`, or
 * `ELF machine <n>`, `Mach-O cpu <n>` and `no object` for another member. A symbol table of ar is no member.
 */
export function archiveObjects(file: string): string[] {
  const data = readFileSync(file);
  if (data.subarray(0, 8).toString('latin1') !== '!<arch>\n') throw new Stop(`${file} is no ar archive`);
  const found = new Set<string>();
  for (let at = 8; at + 60 <= data.length;) {
    const name = data.subarray(at, at + 16).toString('latin1').trim();
    const size = Number(data.subarray(at + 48, at + 58).toString('latin1').trim());
    if (!Number.isInteger(size)) throw new Stop(`${file}: a member header at byte ${at} holds no size`);
    // A BSD name `#1/<n>` lies in the first n bytes of the member.
    const long = /^#1\/(\d+)$/.exec(name);
    const skip = long ? Number(long[1]) : 0;
    const shown = long ? data.subarray(at + 60, at + 60 + skip).toString('latin1').replace(/\0+$/, '') : name;
    const body = data.subarray(at + 60 + skip, at + 60 + size);
    if (!(shown === '/' || shown === '//' || shown === '/SYM64/' || shown.startsWith('__.SYMDEF'))) {
      if (body.length >= 20 && body.readUInt32BE(0) === 0x7f454c46) {
        const machine = body.readUInt16LE(18);
        found.add(machine === 62 ? 'ELF x86-64' : machine === 183 ? 'ELF AArch64' : `ELF machine ${machine}`);
      } else if (body.length >= 8 && body.readUInt32LE(0) === 0xfeedfacf) {
        const cpu = body.readUInt32LE(4);
        found.add(cpu === 0x0100000c ? 'Mach-O arm64' : `Mach-O cpu ${cpu}`);
      } else found.add('no object');
    }
    at += 60 + size + (size % 2);
  }
  return [...found].sort();
}

/** The problems of the go.mod text `text` of `file` for a release: a replace, and a requirement of v0.0.0, which no tag gives. */
export function goModProblems(text: string, file: string): string[] {
  const problems: string[] = [];
  let block = '';
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\/\/.*$/, '').trim();
    if (!line) continue;
    if (line === ')') { block = ''; continue; }
    const open = /^(\w+)\s*\($/.exec(line);
    if (open) { block = open[1] ?? ''; continue; }
    const words = line.split(/\s+/);
    const directive = block || (words.shift() ?? '');
    if (directive === 'replace') problems.push(`${file} holds the line replace ${words.join(' ')}; a released module names no replace`);
    if (directive === 'require' && words[1] === 'v0.0.0') problems.push(`${file} requires ${words[0] ?? ''} v0.0.0, the version of a local path; a released module requires the tag of a release`);
  }
  return problems;
}

/** The module path of the go.mod text `text` of `file`. */
function modulePath(text: string, file: string): string {
  const found = /^module\s+(\S+)\s*$/m.exec(text)?.[1];
  if (found === undefined) throw new Stop(`${file} names no module`);
  return found;
}

/** The problems of the library `file` of `platform`: missing or empty, objects of another platform, or a test entry point. */
function libraryProblems(run_: GoModuleRun, module: GoModule, platform: GoPlatform, file: string | undefined): string[] {
  const where = `${module.directory}: the library of ${platform}`;
  if (file === undefined || !existsSync(file)) return [`${where} is missing`];
  if (statSync(file).size === 0) return [`${where}, ${path.basename(file)}, is empty`];
  const objects = archiveObjects(file);
  const problems = objects.length === 1 && objects[0] === OBJECTS[platform] ? [] : [`${where}, ${path.basename(file)}, holds [${objects.join(', ')}], not ${OBJECTS[platform]} alone`];
  const names = execute(run_.llvmNm, ['--defined-only', '--format=just-symbols', file], { cwd: run_.root, env: run_.env });
  if (names.error || names.status !== 0) return [...problems, `${where}: llvm-nm could not read ${path.basename(file)}: ${(names.error?.message ?? names.stderr).trim()}`];
  const tests = [...new Set(names.stdout.split('\n').map(line => line.trim()).filter(line => module.testSymbols.some(part => line.includes(part))))];
  problems.push(...debugSections(run_, file).map(found => `${where}, ${path.basename(file)}, ${found}`));
  return tests.length ? [...problems, `${where}, ${path.basename(file)}, defines the test entry points ${tests.slice(0, 5).join(', ')}${tests.length > 5 ? ` and ${tests.length - 5} more` : ''}; a release builds it without a feature`] : problems;
}

/**
 * The finding of the debug sections of the library `file`, none when it holds none: the sections `__debug_*`, `.debug_*` and
 * `.zdebug_*` of a size other than 0 that `llvm-size -A` lists, each once with the sum of its sizes over the members (K1208).
 */
function debugSections(run_: GoModuleRun, file: string): string[] {
  const listed = execute(run_.llvmSize, ['-A', file], { cwd: run_.root, env: run_.env });
  if (listed.error || listed.status !== 0) return [`is not read by llvm-size: ${(listed.error?.message ?? listed.stderr).trim()}`];
  const sizes = new Map<string, number>();
  for (const line of listed.stdout.split('\n')) {
    const row = /^(\S+)\s+(\d+)\s+\d+\s*$/.exec(line);
    const [, name, size] = row ?? [];
    if (name !== undefined && size !== undefined && /^(?:__debug_|\.debug_|\.zdebug_)/.test(name) && Number(size) > 0) sizes.set(name, (sizes.get(name) ?? 0) + Number(size));
  }
  return sizes.size ? [`holds the debug sections ${[...sizes].map(([name, size]) => `${name} (${size} bytes)`).join(', ')}; the set of its platform strips them with llvm-strip --strip-debug`] : [];
}

/** The files of the checkout below the Go module that Git does not track and the globs of `module.generated` name. */
function generatedFiles(run_: GoModuleRun, module: GoModule): string[] {
  const untracked = run('git', ['ls-files', '--others', '-z', '--', module.directory], { cwd: run_.root, env: run_.env }).split('\0').filter(Boolean);
  return untracked.filter(file => matchesAny(module.generated, path.posix.relative(module.directory, file))).sort();
}

const git = (run_: GoModuleRun, args: readonly string[], env: NodeJS.ProcessEnv = {}): string => run('git', args, { cwd: run_.root, env: { ...run_.env, ...env } }).trim();

/**
 * Passes when a consumer module that requires each Go module at its tag builds and passes go test with the library that the
 * module carries: Git reads the repository of each module path from `remote`, a repository of the run that holds the tags, and Go
 * asks no proxy, no checksum database and no setting of the machine. A requirement of another repository is fetched from its own
 * remote, so its tag must exist.
 */
function consumerCheck(run_: GoModuleRun, remote: string, required: readonly { path: string; version: string; packages: string[] }[], goVersion: string, work: string): void {
  const consumer = path.join(work, 'consumer');
  const modcache = path.join(work, 'modcache');
  mkdirSync(consumer, { recursive: true });
  const bases = [...new Set(required.map(item => item.path.split('/').slice(0, 3).join('/')))];
  writeFileSync(path.join(work, 'gitconfig'), bases.map(base => `[url "${remote}"]\n\tinsteadOf = https://${base}\n`).join(''));
  const imports = required.flatMap(item => item.packages.map(folder => `\t_ "${folder === '' ? item.path : `${item.path}/${folder}`}"`));
  writeFileSync(path.join(consumer, 'go.mod'), `module example.invalid/consumer\n\ngo ${goVersion}\n\n${required.map(item => `require ${item.path} ${item.version}\n`).join('')}`);
  writeFileSync(path.join(consumer, 'consumer_test.go'), `package consumer\n\nimport (\n\t"testing"\n\n${imports.join('\n')}\n)\n\n// TestLinked passes when the program of the consumer links the library that each module carries.\nfunc TestLinked(t *testing.T) {}\n`);
  const env: NodeJS.ProcessEnv = { ...run_.env, GIT_CONFIG_GLOBAL: path.join(work, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1', GOENV: 'off', GOTOOLCHAIN: 'local', GOWORK: 'off', GOPROXY: 'direct', GOSUMDB: 'off', GOMODCACHE: modcache, GOCACHE: path.join(work, 'gocache'), GOFLAGS: '', CGO_ENABLED: '1', CGO_LDFLAGS: '' };
  try {
    for (const args of [['mod', 'tidy'], ['test', '-count=1', '.']]) {
      run_.log(`[release] go ${args.join(' ')} of a consumer that requires ${required.map(item => `${item.path} ${item.version}`).join(', ')}`);
      const result = execute(run_.go, args, { cwd: consumer, env });
      if (result.error || result.status !== 0) throw new Stop(`a consumer that requires ${required.map(item => `${item.path} ${item.version}`).join(', ')} fails go ${args.join(' ')}, so no tag is made: ${(result.error?.message ?? `${result.stdout}${result.stderr}`).trim()}`);
    }
    if (/^replace\b/m.test(readFileSync(path.join(consumer, 'go.mod'), 'utf8'))) throw new Stop('the go.mod of the consumer holds a replace, so it does not fetch the module at its tag');
  } finally {
    // Go keeps the directories of a module cache read-only, so go removes it.
    if (existsSync(modcache)) execute(run_.go, ['clean', '-modcache'], { cwd: work, env });
  }
}

/** The platform of this machine as Go names it, when it is a platform of a Go module. */
function hostGoPlatform(): GoPlatform | undefined {
  const name = `${process.platform === 'darwin' ? 'darwin' : process.platform}_${process.arch === 'x64' ? 'amd64' : process.arch}`;
  return GO_PLATFORM_NAMES.find(platform => platform === name);
}

/**
 * Makes the commit of the Go modules of the release `tag` and tags it `<directory>/<tag>` for each module, then pushes those tags
 * alone; returns the commit and the tags. One commit carries every module of the repository. Every problem of every module is
 * found before a commit or a tag is made, and one Stop names them all.
 */
export function releaseGoModules(run_: GoModuleRun): { commit: string; tags: string[] } {
  const { modules, tag } = run_;
  if (modules.length === 0) throw new Stop('no go-static package of config/release.json declares a goModule, so the release carries no Go module');
  const parent = git(run_, ['rev-parse', '--verify', `refs/tags/${tag}^{commit}`]);
  const head = git(run_, ['rev-parse', '--verify', 'HEAD^{commit}']);
  if (head !== parent) throw new Stop(`HEAD ${head} is not ${parent}, the commit of ${tag}; check out ${tag}, whose make targets write the generated files of the Go module`);
  const tags = modules.map(({ module }) => goModuleTag(module.directory, tag));
  const problems: string[] = [];
  const remoteTags = git(run_, ['ls-remote', '--tags', run_.remote, ...tags.map(name => `refs/tags/${name}`)]);
  for (const name of tags) {
    const local = execute('git', ['rev-parse', '--verify', '--quiet', `refs/tags/${name}`], { cwd: run_.root, env: run_.env });
    if (local.status === 0 || remoteTags.split('\n').some(line => line.endsWith(`\trefs/tags/${name}`))) problems.push(`the tag ${name} exists ${local.status === 0 ? 'in the repository' : `on ${run_.remote}`}; a published tag is never moved, so the Go module of ${tag} is not released again`);
  }
  const adds: { path: string; file: string }[] = [];
  const required: { path: string; version: string; packages: string[] }[] = [];
  let goVersion: string | undefined;
  for (const { module, libraries } of modules) {
    const goModFile = `${module.directory}/go.mod`;
    const goMod = execute('git', ['show', `${parent}:${goModFile}`], { cwd: run_.root, env: run_.env });
    if (goMod.status !== 0) { problems.push(`${goModFile} is no file of the commit of ${tag}`); continue; }
    problems.push(...goModProblems(goMod.stdout, goModFile));
    goVersion ??= /^go\s+(\S+)\s*$/m.exec(goMod.stdout)?.[1];
    const generated = generatedFiles(run_, module);
    if (generated.length === 0) problems.push(`${module.directory}: the checkout holds no generated file of [${module.generated.join(', ')}]; the make targets of the package write them before this step`);
    adds.push(...generated.map(file => ({ path: file, file: path.join(run_.root, file) })));
    for (const platform of GO_PLATFORM_NAMES) {
      const file = libraries[platform];
      const found = libraryProblems(run_, module, platform, file);
      problems.push(...found);
      if (file !== undefined && found.length === 0) adds.push({ path: path.posix.join(module.directory, module.library, platform, path.basename(file)), file });
    }
    const tracked = git(run_, ['ls-tree', '-r', '--name-only', parent, '--', module.directory]).split('\n');
    const sources = [...tracked, ...generated].map(file => path.posix.relative(module.directory, file)).filter(file => file.endsWith('.go') && !file.endsWith('_test.go'));
    const packages = [...new Set(sources.map(file => (path.posix.dirname(file) === '.' ? '' : path.posix.dirname(file))))].filter(folder => !folder.split('/').some(part => part === 'internal' || part === 'testdata' || part.startsWith('_') || part.startsWith('.'))).sort();
    required.push({ path: modulePath(goMod.stdout, goModFile), version: tag, packages });
  }
  if (hostGoPlatform() === undefined) problems.push(`this machine is no platform of a Go module (${GO_PLATFORM_NAMES.join(', ')}), so no consumer can link the library that the module carries; run the step on a runner of one of them`);
  if (goVersion === undefined) problems.push('the go.mod of the Go module names no Go version');
  if (problems.length || goVersion === undefined) throw new Stop(`the Go module of ${tag} is not released, and no commit and no tag is made: ${problems.join('; ')}`);
  const work = mkdtempSync(path.join(os.tmpdir(), 'kit-go-module-'));
  try {
    // The tree is built in an index of the run, so the index, the work tree and every branch of the checkout stay as they are.
    const index = { GIT_INDEX_FILE: path.join(work, 'index') };
    git(run_, ['read-tree', parent], index);
    for (const add of adds) git(run_, ['update-index', '--add', '--cacheinfo', `100644,${git(run_, ['hash-object', '-w', '--no-filters', add.file])},${add.path}`], index);
    const tree = git(run_, ['write-tree'], index);
    const actor = run_.env.GITHUB_ACTOR;
    const identity = actor ? ['-c', `user.name=${actor}`, '-c', `user.email=${actor}@users.noreply.github.com`] : [];
    // The dates are those of the commit of the tag, so a second run on the same inputs writes the same commit.
    const date = git(run_, ['show', '-s', '--format=%cI', parent]);
    const message = `chore(release): Carry the Go module of ${tag}\n\nThe generated files and the static library of each platform of\n${modules.map(({ module }) => module.directory).join(', ')}, which no branch tracks.\n`;
    const commit = git(run_, [...identity, 'commit-tree', tree, '-p', parent, '-m', message], { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date });
    // A repository of the run stands for the remote: it holds the commit under the tags, which the checkout does not hold yet.
    const remote = path.join(work, 'remote.git');
    run('git', ['init', '--quiet', '--bare', remote], { cwd: work, env: run_.env });
    // No maintenance of git outlives a command in it, so the removal of the work folder meets no file that one writes.
    for (const [name, value] of [['maintenance.auto', 'false'], ['gc.auto', '0'], ['receive.autogc', 'false']] as const) run('git', ['--git-dir', remote, 'config', name, value], { cwd: work, env: run_.env });
    git(run_, ['push', '--quiet', remote, ...tags.map(name => `${commit}:refs/tags/${name}`)]);
    consumerCheck(run_, remote, required, goVersion, work);
    for (const name of tags) git(run_, [...identity, 'tag', '-a', name, '-m', name, commit], { GIT_COMMITTER_DATE: date });
    git(run_, ['push', run_.remote, ...tags.map(name => `refs/tags/${name}`)]);
    for (const name of tags) run_.log(`[release] tagged the Go module ${name} at ${commit}, a commit of no branch whose parent is ${tag}`);
    return { commit, tags };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** The library file `lib<name>.a` in `folder`, the one file that the zip of a go-static asset holds; undefined when it holds none. */
export function libraryIn(folder: string): string | undefined {
  const files = existsSync(folder) ? readdirSync(folder).filter(name => name.endsWith('.a')) : [];
  return files.length === 1 && files[0] !== undefined ? path.join(folder, files[0]) : undefined;
}
