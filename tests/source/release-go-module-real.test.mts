// The release of a Go module with the real tools (K1205): cargo builds the static library of this machine, llvm-nm of the toolchain
// reads the symbols, and the go of the checkout fetches the module at its tag from a repository of the run and links the library
// that the module carries, with GOPROXY=direct and no CGO_LDFLAGS. No network: the module requires nothing, and Git reads its
// repository from the run. The libraries of the other platforms are archives of one object without a symbol, since no tool
// builds for another platform here.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { initRepository } from '../kit/sandbox-repository.mts';
import { toolCommand } from '../../scripts/kit/mise-tools.mts';
import { Stop } from '../../scripts/kit/process.mts';
import { GO_PLATFORM_NAMES, releaseGoModules, type GoPlatform } from '../../scripts/kit/release-go-module.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TAG = 'v0.0.1';
const MODULE = 'github.com/polyspec/kit-fixture/packages/go';
const HOST = `${process.platform}_${process.arch === 'x64' ? 'amd64' : process.arch}`;

/** An ar archive of one object of `platform` that defines no symbol: an ELF or a Mach-O header alone. */
function emptyLibrary(platform: GoPlatform): Buffer {
  const body = platform === 'darwin_arm64' ? Buffer.alloc(32) : Buffer.alloc(64);
  if (platform === 'darwin_arm64') {
    body.writeUInt32LE(0xfeedfacf, 0);
    body.writeUInt32LE(0x0100000c, 4);
    body.writeUInt32LE(1, 12);
  } else {
    Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1]).copy(body);
    body.writeUInt16LE(1, 16);
    body.writeUInt16LE(platform === 'linux_amd64' ? 62 : 183, 18);
    body.writeUInt32LE(1, 20);
    body.writeUInt16LE(64, 52);
  }
  const header = Buffer.from(`${'fixture.o/'.padEnd(16)}${'0'.padEnd(12)}${'0'.padEnd(6)}${'0'.padEnd(6)}${'100644'.padEnd(8)}${String(body.length).padEnd(10)}\`\n`, 'latin1');
  return Buffer.concat([Buffer.from('!<arch>\n', 'latin1'), header, body]);
}

/** A repository with a Go module that calls a Rust static library through cgo, its tag, a remote, and the library of each platform. */
function sandbox(t: TestContext) {
  const base = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-go-module-real-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, 'repository');
  const remote = path.join(base, 'remote.git');
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_CONFIG_GLOBAL: path.join(base, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1', CARGO_NET_OFFLINE: 'true', CARGO_TARGET_DIR: path.join(base, 'target'), GOTOOLCHAIN: 'local' };
  writeFileSync(path.join(base, 'gitconfig'), '[user]\n\tname = Kit Test\n\temail = kit@example.invalid\n[init]\n\tdefaultBranch = main\n');
  const command = (program: string, args: string[], cwd = root) => {
    const result = spawnSync(program, args, { cwd, env, encoding: 'utf8' });
    assert.equal(result.status, 0, `${program} ${args.join(' ')}: ${result.stdout}${result.stderr}`);
    return result.stdout.trim();
  };
  const write = (file: string, text: string) => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  };
  const go = toolCommand(ROOT, 'go');
  mkdirSync(root, { recursive: true });
  const goVersion = /^go(\d+\.\d+)/.exec(command(go, ['env', 'GOVERSION'], base))?.[1];
  assert.ok(goVersion, 'the go of the checkout names its release');
  copyFileSync(path.join(ROOT, 'rust-toolchain.toml'), path.join(root, 'rust-toolchain.toml'));
  write('.gitignore', 'zz_generated_*.go\n*.a\n');
  write('Cargo.toml', '[workspace]\nresolver = "3"\nmembers = ["packages/go/internal/ffi"]\n');
  write('packages/go/internal/ffi/Cargo.toml', '[package]\nname = "kit-fixture-go"\nversion = "0.0.1"\nedition = "2024"\npublish = false\n\n[lib]\nname = "kit_fixture_go"\ncrate-type = ["staticlib"]\n');
  write('packages/go/internal/ffi/src/lib.rs', '/// Adds two numbers for the Go program.\n#[unsafe(no_mangle)]\npub extern "C" fn kit_fixture_add(left: i32, right: i32) -> i32 {\n    left.wrapping_add(right)\n}\n');
  write('packages/go/go.mod', `module ${MODULE}\n\ngo ${goVersion}\n`);
  write('packages/go/internal/binding/binding.go', 'package binding\n\n// #cgo LDFLAGS: -lkit_fixture_go\n// int kit_fixture_add(int left, int right);\nimport "C"\n\n// Add adds two numbers in the static library.\nfunc Add(left, right int) int { return int(C.kit_fixture_add(C.int(left), C.int(right))) }\n');
  write('packages/go/sum/sum.go', `package sum\n\nimport "${MODULE}/internal/binding"\n\n// Add adds two numbers.\nfunc Add(left, right int) int { return binding.Add(left, right) }\n`);
  write('packages/go/sum/sum_test.go', 'package sum\n\nimport "testing"\n\nfunc TestAdd(t *testing.T) {\n\tif Add(2, 3) != 5 {\n\t\tt.Fatal("2 + 3")\n\t}\n}\n');
  initRepository(remote, '--bare');
  initRepository(root);
  command('cargo', ['generate-lockfile', '--offline']);
  command('git', ['add', '-A']);
  command('git', ['commit', '--quiet', '-m', 'fixture']);
  command('git', ['tag', '-a', TAG, '-m', TAG]);
  command('git', ['remote', 'add', 'origin', remote]);
  command('git', ['push', '--quiet', 'origin', 'main', TAG]);
  // The generated files: for each platform the file that names the directory of its library, and the package of that directory.
  for (const platform of GO_PLATFORM_NAMES) {
    write(`packages/go/internal/binding/zz_generated_link_${platform}.go`, `package binding\n\n// #cgo LDFLAGS: -L\${SRCDIR}/../ffi/lib/${platform}\nimport "C"\n\nimport _ "${MODULE}/internal/ffi/lib/${platform}"\n`);
    write(`packages/go/internal/ffi/lib/${platform}/zz_generated_lib.go`, `// Package ${platform} holds the static library of ${platform}.\npackage ${platform}\n`);
  }
  command('cargo', ['build', '--release', '--locked', '--offline', '-p', 'kit-fixture-go']);
  const built = path.join(base, 'target/release/libkit_fixture_go.a');
  const libraries = Object.fromEntries(GO_PLATFORM_NAMES.map((platform) => {
    const file = path.join(base, 'libraries', platform, 'libkit_fixture_go.a');
    mkdirSync(path.dirname(file), { recursive: true });
    if (platform === HOST) copyFileSync(built, file);
    else writeFileSync(file, emptyLibrary(platform));
    return [platform, file];
  })) as Partial<Record<GoPlatform, string>>;
  const llvmNm = path.join(command('rustc', ['--print', 'sysroot']), 'lib/rustlib', command('rustc', ['--print', 'host-tuple']), 'bin/llvm-nm');
  const release = () => releaseGoModules({ root, env, log: () => {}, tag: TAG, remote: 'origin', modules: [{ module: { directory: 'packages/go', library: 'internal/ffi/lib', generated: ['**/zz_generated_*.go'], testSymbols: ['__panic_test'] }, libraries }], llvmNm, go });
  return { root, remote, env, command, libraries, release };
}

test('K1205: a consumer that requires the released Go module at its tag links the library that the module carries, with no CGO_LDFLAGS', (t) => {
  assert.ok((GO_PLATFORM_NAMES as readonly string[]).includes(HOST), `${HOST} is no platform of a Go module, so no consumer links here`);
  const box = sandbox(t);
  const parent = box.command('git', ['rev-parse', `${TAG}^{commit}`]);
  const { commit, tags } = box.release();
  assert.deepEqual(tags, [`packages/go/${TAG}`]);
  assert.equal(box.command('git', ['rev-list', '--parents', '-n', '1', commit]), `${commit} ${parent}`);
  assert.equal(box.command('git', ['--git-dir', box.remote, 'rev-parse', `refs/tags/packages/go/${TAG}^{commit}`]), commit, 'the tag is pushed');
  assert.equal(box.command('git', ['--git-dir', box.remote, 'branch', '--contains', commit]), '', 'no branch holds the commit');
  assert.ok(box.command('git', ['ls-tree', '-r', '--name-only', commit, '--', 'packages/go/internal/ffi/lib']).split('\n').includes(`packages/go/internal/ffi/lib/${HOST}/libkit_fixture_go.a`));
});

test('K1205: a module whose library of this platform lacks the function fails the go test of the consumer, and no tag is made', (t) => {
  const box = sandbox(t);
  // The library of another platform has no object of this one, so one of this platform without a symbol stands for a broken build.
  const host = GO_PLATFORM_NAMES.find(platform => platform === HOST);
  assert.ok(host);
  writeFileSync(box.libraries[host] ?? '', emptyLibrary(host));
  assert.throws(() => box.release(), error => error instanceof Stop && /fails go test -count=1 \., so no tag is made/.test(error.message));
  assert.equal(box.command('git', ['tag', '--list', 'packages/*']), '', 'no tag in the repository');
  assert.equal(box.command('git', ['--git-dir', box.remote, 'tag', '--list', 'packages/*']), '', 'no tag on the remote');
});
