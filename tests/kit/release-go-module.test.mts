// Tests of the release of a Go module that links a static library (K1205): the commit that carries the generated files and the
// library of each platform, its tag <directory>/vX.Y.Z, and every refusal that makes no commit and no tag. Git is real; llvm-nm
// and go are stubs, so no library is built and no module is fetched here (tests/source/release-go-module-real.test.mts does both).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { Stop } from '../../scripts/kit/process.mts';
import { initRepository } from './sandbox-repository.mts';
import { archiveObjects, GO_PLATFORM_NAMES, goModProblems, releaseGoModules, type GoModule, type GoPlatform } from '../../scripts/kit/release-go-module.mts';

const TAG = 'v0.0.1';
const SYMBOLS = ['__panic_test', '__echo_', '__arm_faults', '__fault_left', '__alias_in_'];
const moduleOf = (directory: string): GoModule => ({ directory, library: 'internal/ffi/lib', generated: ['**/zz_generated_*.go', 'internal/ffi/generated/**'], testSymbols: SYMBOLS });

/** An ar archive with one member `name` of the bytes `body`. */
function archive(name: string, body: Buffer): Buffer {
  const header = Buffer.from(`${(name.startsWith('#1/') ? name : `${name}/`).padEnd(16)}${'0'.padEnd(12)}${'0'.padEnd(6)}${'0'.padEnd(6)}${'100644'.padEnd(8)}${String(body.length).padEnd(10)}\`\n`, 'latin1');
  return Buffer.concat([Buffer.from('!<arch>\n', 'latin1'), header, body, Buffer.alloc(body.length % 2, 0x0a)]);
}
/** The first bytes of an object of each platform: an ELF header with its machine, or a Mach-O header with its CPU type. */
function object(platform: GoPlatform): Buffer {
  const body = Buffer.alloc(64);
  if (platform === 'darwin_arm64') {
    body.writeUInt32LE(0xfeedfacf, 0);
    body.writeUInt32LE(0x0100000c, 4);
  } else {
    body.writeUInt32BE(0x7f454c46, 0);
    body.writeUInt16LE(platform === 'linux_amd64' ? 62 : 183, 18);
  }
  return body;
}

const LLVM_NM = `#!/bin/sh
# llvm-nm stub: prints the symbols that the test wrote beside the library.
for last; do :; done
[ -f "$last.symbols" ] && cat "$last.symbols"
exit 0
`;
const LLVM_SIZE = `#!/bin/sh
# llvm-size stub: prints the sections that the test wrote beside the library, in the form of llvm-size -A.
for last; do :; done
echo "fixture.o   (ex $last):"
echo "section     size   addr"
echo ".text         16      0"
[ -f "$last.sections" ] && cat "$last.sections"
echo "Total         16"
exit 0
`;
const GO = `#!/bin/sh
# go stub: records its arguments and what the consumer may not carry, and fails the command that STUB_GO_FAIL names.
echo "$* CGO_LDFLAGS=[$CGO_LDFLAGS] GOPROXY=$GOPROXY GOFLAGS=[$GOFLAGS]" >> "$STUB_GO_LOG"
[ "$1" = "mod" ] && cat go.mod >> "$STUB_GO_LOG" && git ls-remote --tags https://github.com/polyspec/fixture >> "$STUB_GO_LOG"
[ "$STUB_GO_FAIL" = "$1" ] && { echo "go $1 failed in the stub" >&2; exit 1; }
exit 0
`;

type Box = ReturnType<typeof sandbox>;

/** A repository with the tag v0.0.1, a remote, the Go modules `directories` with their generated files, and the library of each platform. */
function sandbox(t: TestContext, directories: string[] = ['packages/go']) {
  const base = mkdtempSync(path.join(os.tmpdir(), 'kit-go-module-test-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, 'repository');
  const remote = path.join(base, 'remote.git');
  const libraries = path.join(base, 'libraries');
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_CONFIG_GLOBAL: path.join(base, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1', STUB_GO_LOG: path.join(base, 'go.log'), STUB_GO_FAIL: '' };
  writeFileSync(path.join(base, 'gitconfig'), '[user]\n\tname = Kit Test\n\temail = kit@example.invalid\n[init]\n\tdefaultBranch = main\n');
  const git = (...args: string[]) => {
    const result = spawnSync('git', args, { cwd: root, env, encoding: 'utf8' });
    assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
    return result.stdout.trim();
  };
  const write = (file: string, text: string | Buffer) => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  };
  mkdirSync(root, { recursive: true });
  initRepository(remote, '--bare');
  initRepository(root);
  write('.gitignore', 'zz_generated_*.go\n/packages/*/internal/ffi/generated/\n/packages/*/internal/ffi/lib/*/*.a\n');
  write('README.md', 'fixture\n');
  for (const directory of directories) {
    write(`${directory}/go.mod`, `module github.com/polyspec/fixture/${directory}\n\ngo 1.26\n`);
    write(`${directory}/media/media.go`, 'package media\n');
    write(`${directory}/internal/binding/binding.go`, 'package binding\n');
  }
  git('add', '-A');
  git('commit', '--quiet', '-m', 'fixture');
  git('tag', '-a', TAG, '-m', TAG);
  git('remote', 'add', 'origin', remote);
  git('push', '--quiet', 'origin', 'main', TAG);
  // What the make targets of the package write: generated files that Git ignores, and one that no glob names.
  for (const directory of directories) {
    write(`${directory}/media/zz_generated_media.go`, 'package media\n');
    write(`${directory}/internal/ffi/generated/lib.rs`, '// generated\n');
    write(`${directory}/internal/ffi/lib/linux_amd64/zz_generated_lib.go`, 'package linux_amd64\n');
    write(`${directory}/notes.txt`, 'no generated file\n');
  }
  mkdirSync(libraries, { recursive: true });
  const library = (directory: string, platform: GoPlatform, body: Buffer = archive('fixture.o', object(platform))) => {
    const file = path.join(libraries, directory.replaceAll('/', '_'), platform, 'libpolyspec_fixture_go.a');
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, body);
    return file;
  };
  for (const [name, source] of [['llvm-nm', LLVM_NM], ['llvm-size', LLVM_SIZE], ['go', GO]] as const) {
    writeFileSync(path.join(base, name), source);
    chmodSync(path.join(base, name), 0o755);
  }
  const modules = directories.map(directory => ({ module: moduleOf(directory), libraries: Object.fromEntries(GO_PLATFORM_NAMES.map(platform => [platform, library(directory, platform)])) as Partial<Record<GoPlatform, string>> }));
  const release = (change: Partial<{ env: NodeJS.ProcessEnv }> = {}) => releaseGoModules({ root, env: { ...env, ...change.env }, log: () => {}, tag: TAG, remote: 'origin', modules, llvmNm: path.join(base, 'llvm-nm'), llvmSize: path.join(base, 'llvm-size'), go: path.join(base, 'go') });
  /** Every ref and every commit object of the repository and the refs of the remote: what a refused release leaves as it was. */
  const state = () => ({
    refs: git('for-each-ref', '--format=%(refname) %(objectname)'),
    commits: git('cat-file', '--batch-all-objects', '--batch-check').split('\n').filter(line => line.includes(' commit ')).length,
    remote: spawnSync('git', ['--git-dir', remote, 'for-each-ref', '--format=%(refname) %(objectname)'], { env, encoding: 'utf8' }).stdout.trim(),
    status: git('status', '--porcelain'),
  });
  return { root, remote, env, git, write, modules, library, release, state, goLog: () => (existsSync(path.join(base, 'go.log')) ? readFileSync(path.join(base, 'go.log'), 'utf8') : '') };
}

/** The release stops with `pattern` and leaves every ref, every commit and the remote as they were. */
function refused(box: Box, pattern: RegExp, change: Partial<{ env: NodeJS.ProcessEnv }> = {}) {
  const before = box.state();
  assert.throws(() => box.release(change), error => error instanceof Stop && pattern.test(error.message), String(pattern));
  assert.deepEqual({ ...box.state(), commits: 0 }, { ...before, commits: 0 }, 'no ref of the repository or of the remote changed');
  return { before, after: box.state() };
}

test('K1205: the commit of a Go module has the commit of the tag as its one parent and adds the generated files and the libraries below the module alone', (t) => {
  const box = sandbox(t);
  const parent = box.git('rev-parse', `${TAG}^{commit}`);
  const status = box.git('status', '--porcelain');
  const { commit, tags } = box.release();
  assert.deepEqual(tags, ['packages/go/v0.0.1'], 'the tag that Go reads for a module in a subdirectory');
  assert.equal(box.git('rev-list', '--parents', '-n', '1', commit), `${commit} ${parent}`, 'one parent, the commit of the tag');
  assert.deepEqual(box.git('diff', '--name-status', parent, commit).split('\n'), [
    'A\tpackages/go/internal/ffi/generated/lib.rs',
    'A\tpackages/go/internal/ffi/lib/darwin_arm64/libpolyspec_fixture_go.a',
    'A\tpackages/go/internal/ffi/lib/linux_amd64/libpolyspec_fixture_go.a',
    'A\tpackages/go/internal/ffi/lib/linux_amd64/zz_generated_lib.go',
    'A\tpackages/go/internal/ffi/lib/linux_arm64/libpolyspec_fixture_go.a',
    'A\tpackages/go/media/zz_generated_media.go',
  ], 'only additions below the Go module: a file that no glob names is not carried');
  assert.equal(box.git('cat-file', '-t', 'refs/tags/packages/go/v0.0.1'), 'tag', 'an annotated tag');
  assert.equal(box.git('rev-parse', 'packages/go/v0.0.1^{commit}'), commit);
  assert.equal(box.git('branch', '--all', '--contains', commit), '', 'no branch of the repository holds the commit');
  const remote = (...args: string[]) => spawnSync('git', ['--git-dir', box.remote, ...args], { env: box.env, encoding: 'utf8' }).stdout.trim();
  assert.equal(remote('rev-parse', 'refs/tags/packages/go/v0.0.1^{commit}'), commit, 'the tag is pushed');
  assert.equal(remote('branch', '--contains', commit), '', 'no branch of the remote holds the commit');
  assert.equal(remote('rev-parse', 'refs/heads/main'), parent, 'the branch of the remote stays');
  assert.equal(box.git('rev-parse', 'HEAD'), parent, 'HEAD stays');
  assert.equal(box.git('status', '--porcelain'), status, 'the index and the work tree stay');
});

test('K1205: a consumer requires the module at its tag from the repository of the run, with GOPROXY=direct and no CGO_LDFLAGS, before the tag is made', (t) => {
  const box = sandbox(t);
  const { commit } = box.release();
  const log = box.goLog();
  assert.match(log, /^mod tidy CGO_LDFLAGS=\[\] GOPROXY=direct GOFLAGS=\[\]$/m);
  assert.match(log, /^test -count=1 \. CGO_LDFLAGS=\[\] GOPROXY=direct GOFLAGS=\[\]$/m);
  assert.match(log, /^require github\.com\/polyspec\/fixture\/packages\/go v0\.0\.1$/m, 'the consumer names the require alone');
  assert.doesNotMatch(log, /^replace/m);
  assert.ok(log.includes(`${commit}\trefs/tags/packages/go/v0.0.1`), `Git reads the tag of the module path from the repository of the run: ${log}`);
  refused(sandbox(t), /a consumer that requires github\.com\/polyspec\/fixture\/packages\/go v0\.0\.1 fails go test -count=1 \., so no tag is made: go test failed in the stub/, { env: { STUB_GO_FAIL: 'test' } });
});

test('K1205: a missing or empty library of a platform stops the release with the name of the platform, and no commit and no tag is made', (t) => {
  const missing = sandbox(t);
  delete missing.modules[0]?.libraries.linux_arm64;
  const { before, after } = refused(missing, /no commit and no tag is made: packages\/go: the library of linux_arm64 is missing$/);
  assert.equal(after.commits, before.commits, 'no commit object is written');
  assert.equal(missing.goLog(), '', 'no consumer runs');
  const empty = sandbox(t);
  empty.library('packages/go', 'darwin_arm64', Buffer.alloc(0));
  refused(empty, /packages\/go: the library of darwin_arm64, libpolyspec_fixture_go\.a, is empty/);
});

test('K1205: a library that defines a test entry point stops the release', (t) => {
  const box = sandbox(t);
  writeFileSync(`${box.modules[0]?.libraries.linux_amd64 ?? ''}.symbols`, 'fixture.o:\npolyspec_fixture_parse\npolyspec_fixture__panic_test\n');
  const { before, after } = refused(box, /packages\/go: the library of linux_amd64, libpolyspec_fixture_go\.a, defines the test entry points polyspec_fixture__panic_test; a release builds it without a feature/);
  assert.equal(after.commits, before.commits);
});

test('K1208: a library that holds a debug section of a size other than 0 stops the release with the names of the sections', (t) => {
  const box = sandbox(t);
  writeFileSync(`${box.modules[0]?.libraries.linux_arm64 ?? ''}.sections`, '.debug_info  1200  0\n.debug_str  0  0\n.zdebug_line  40  0\n.comment  12  0\n');
  writeFileSync(`${box.modules[0]?.libraries.darwin_arm64 ?? ''}.sections`, '__debug_abbrev  7  0\n');
  const { before, after } = refused(box, /packages\/go: the library of linux_arm64, libpolyspec_fixture_go\.a, holds the debug sections \.debug_info \(1200 bytes\), \.zdebug_line \(40 bytes\); the set of its platform strips them with llvm-strip --strip-debug.*the library of darwin_arm64, libpolyspec_fixture_go\.a, holds the debug sections __debug_abbrev \(7 bytes\)/);
  assert.equal(after.commits, before.commits, 'no commit object is written');
  // A debug section of size 0 and a section of another name are none.
  const clean = sandbox(t);
  writeFileSync(`${clean.modules[0]?.libraries.linux_amd64 ?? ''}.sections`, '.debug_str  0  0\n.comment  12  0\n.note.debug_like  9  0\n');
  assert.deepEqual(clean.release().tags, ['packages/go/v0.0.1']);
});

test('K1205: a library whose objects are of another platform stops the release', (t) => {
  const box = sandbox(t);
  box.library('packages/go', 'linux_amd64', archive('fixture.o', object('linux_arm64')));
  refused(box, /packages\/go: the library of linux_amd64, libpolyspec_fixture_go\.a, holds \[ELF AArch64\], not ELF x86-64 alone/);
  assert.deepEqual(archiveObjects(box.library('packages/go', 'darwin_arm64')), ['Mach-O arm64']);
  // A BSD archive names a member in the first bytes of its body, and its symbol table is no member.
  const bsd = Buffer.concat([Buffer.from('!<arch>\n', 'latin1'), archive('#1/12', Buffer.concat([Buffer.from('__.SYMDEF\0\0\0'), Buffer.alloc(8)])).subarray(8), archive('#1/12', Buffer.concat([Buffer.from('fixture.o\0\0\0'), object('darwin_arm64')])).subarray(8)]);
  assert.deepEqual(archiveObjects(box.library('packages/go', 'darwin_arm64', bsd)), ['Mach-O arm64']);
  assert.throws(() => archiveObjects(box.library('packages/go', 'darwin_arm64', Buffer.from('no archive'))), /is no ar archive/);
});

test('K1205: a go.mod with a replace or a v0.0.0 requirement stops the release', (t) => {
  assert.deepEqual(goModProblems('module m\n\ngo 1.26\n\nrequire example.com/a v1.2.3 // indirect\n', 'go.mod'), []);
  assert.deepEqual(goModProblems('module m\nrequire (\n\texample.com/a v0.0.0\n\texample.com/b v0.0.1\n)\nreplace example.com/a => ../a\n', 'go.mod'), [
    'go.mod requires example.com/a v0.0.0, the version of a local path; a released module requires the tag of a release',
    'go.mod holds the line replace example.com/a => ../a; a released module names no replace',
  ]);
  const box = sandbox(t);
  box.write('packages/go/go.mod', 'module github.com/polyspec/fixture/packages/go\n\ngo 1.26\n\nrequire github.com/polyspec/other/packages/go v0.0.0\n\nreplace github.com/polyspec/other/packages/go => ../../../other/packages/go\n');
  box.git('commit', '--quiet', '-am', 'a local path');
  box.git('tag', '-f', '-a', TAG, '-m', TAG);
  refused(box, /packages\/go\/go\.mod requires github\.com\/polyspec\/other\/packages\/go v0\.0\.0.*packages\/go\/go\.mod holds the line replace/);
});

test('K1205: a second run refuses the tag that exists and moves nothing, in the repository and on the remote', (t) => {
  const box = sandbox(t);
  box.release();
  refused(box, /the tag packages\/go\/v0\.0\.1 exists in the repository; a published tag is never moved/);
  box.git('tag', '-d', 'packages/go/v0.0.1');
  refused(box, /the tag packages\/go\/v0\.0\.1 exists on origin; a published tag is never moved/);
});

test('K1205: the Go modules of several contracts share one commit, which each of their tags names', (t) => {
  const box = sandbox(t, ['packages/go', 'packages/go-extra']);
  const { commit, tags } = box.release();
  assert.deepEqual(tags, ['packages/go/v0.0.1', 'packages/go-extra/v0.0.1']);
  for (const tag of tags) assert.equal(box.git('rev-parse', `${tag}^{commit}`), commit);
  assert.equal(box.git('diff', '--name-only', `${TAG}^{commit}`, commit).split('\n').every(file => file.startsWith('packages/go/') || file.startsWith('packages/go-extra/')), true);
});

test('K1205: a checkout that is not the commit of the tag, or that holds no generated file, stops the release', (t) => {
  const box = sandbox(t);
  rmSync(path.join(box.root, 'packages/go/media/zz_generated_media.go'));
  rmSync(path.join(box.root, 'packages/go/internal/ffi/generated'), { recursive: true });
  rmSync(path.join(box.root, 'packages/go/internal/ffi/lib'), { recursive: true });
  refused(box, /packages\/go: the checkout holds no generated file of \[\*\*\/zz_generated_\*\.go, internal\/ffi\/generated\/\*\*\]/);
  const moved = sandbox(t);
  moved.write('README.md', 'later\n');
  moved.git('commit', '--quiet', '-am', 'later');
  assert.throws(() => moved.release(), /HEAD [0-9a-f]+ is not [0-9a-f]+, the commit of v0\.0\.1/);
});
