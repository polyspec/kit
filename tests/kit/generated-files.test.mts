// Tests of the generated-file check (scripts/kit/generated-files.mts): a staged path that a generated glob of config/generated.json
// matches is a finding with its path named, unless the config declares it an exception; the cases declare the generated folders of
// kit's own config (K1105), and a segment that only contains a generated name is not generated. Each case works in a temporary checkout.
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { checkout, commitIndex, git, prepared, run } from './gates-checkout.mts';
import { tool } from './kit-tools.mts';
import { spawnSync } from 'node:child_process';
import { blobContent } from '../../scripts/kit/generated-files.mts';
import { tree } from './tree.mts';

// The generated folders and executable kinds that kit's own config/generated.json and Makefile declare (K1105).
const SEGMENTS = ['**/node_modules/**', '**/vendor/**', '**/.venv/**', '**/venv/**', '**/__pycache__/**', '**/target/**', '**/dist/**', '**/*.egg-info/**'];
const BINARIES = ['--binary', 'ELF', '--binary', 'Mach-O', '--binary', 'PE'];
// The generated-file header and the module files that kit's own config/generated.json declares (K1105).
const HEADERS = ['Code generated .* DO NOT EDIT'];
const MODULE_FILES = ['go.mod', 'Cargo.toml'];
const GENERATED_CONFIG = JSON.stringify({ schema: 1, paths: SEGMENTS, exceptions: [{ path: 'tests/*/fixtures/**', reason: 'test fixtures' }], headers: HEADERS, moduleFiles: MODULE_FILES });
const check = (work: string, kinds: readonly string[] = BINARIES) => run(work, process.execPath, [tool(import.meta.resolve('../../scripts/kit/generated-files.mts')), 'staged', ...kinds]);
// The install directories that the Makefile of kit declares (K1083), which the K372 cases check.
const DECLARED = ['var', 'package.json=node_modules', 'pyproject.toml=.venv', 'composer.json=vendor'];
const installs = (work: string, declared: readonly string[] = DECLARED) => run(work, process.execPath, [tool(import.meta.resolve('../../scripts/kit/generated-files.mts')), 'installs', ...declared]);
const stage = (work: string, file: string, text: string | Buffer = 'x\n') => {
  mkdirSync(path.dirname(path.join(work, file)), { recursive: true });
  writeFileSync(path.join(work, file), text);
  git(work, 'add', file);
};

test('a staged path that config/generated.json declares an exception is accepted', (t) => {
  const { work } = prepared(t, { files: { 'config/generated.json': GENERATED_CONFIG } });
  stage(work, 'tests/app/fixtures/node_modules/x/index.js');
  const accepted = check(work);
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.match(accepted.stdout, /no generated file is staged/);
});

test('every generated segment is refused, and a name that only contains one is accepted', (t) => {
  const { work } = prepared(t, { files: { 'config/generated.json': GENERATED_CONFIG } });
  const generated = ['.venv/lib/x.py', 'venv/bin/x', 'pkg/__pycache__/m.cpython.pyc', 'target/debug/app', 'dist/index.js', 'vendor/acme/x.php', 'pkg.egg-info/PKG-INFO', 'node_modules/x/index.js'];
  const accepted = ['docs/node_modules-notes.md', 'src/dist.ts', 'src/targets/a.ts', 'venvs.md'];
  for (const file of [...generated, ...accepted]) stage(work, file);
  const refused = check(work);
  assert.equal(refused.status, 1);
  for (const file of generated) assert.match(refused.stderr, new RegExp(`${file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} is a generated file`), file);
  for (const file of accepted) assert.doesNotMatch(refused.stderr, new RegExp(file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), file);
});

test('a path that config/generated.json declares generated is refused, and an exception of the config still allows it', (t) => {
  const config = JSON.stringify({ schema: 1, paths: ['build/**', '**/*.vsix', '.vitepress/cache/**'], exceptions: [{ path: 'build/keep/**', reason: 'kept output' }] });
  const { work } = prepared(t, { files: { 'config/generated.json': config } });
  const generated = ['build/tools/x', 'ext/a.vsix', '.vitepress/cache/x.json'];
  for (const file of [...generated, 'build/keep/y.txt']) stage(work, file);
  const refused = check(work);
  assert.equal(refused.status, 1, refused.stderr);
  for (const file of generated) assert.ok(refused.stderr.includes(`${file} is a generated file`), refused.stderr);
  assert.ok(!refused.stderr.includes('build/keep/y.txt'), 'the exception of the config is accepted');
});

test('K930 a generated path that config/generated.json tracks is accepted, and a path it does not track is still refused (P34)', (t) => {
  const config = JSON.stringify({ schema: 1, paths: ['build/**'], exceptions: [], tracked: [{ path: 'build/gomod/**', reason: 'a Go module that consumers install as the tagged tree' }], moduleFiles: MODULE_FILES });
  const { work } = prepared(t, { files: { 'config/generated.json': config } });
  for (const file of ['build/gomod/go.mod', 'build/tools/x']) stage(work, file);
  const refused = check(work);
  assert.equal(refused.status, 1, refused.stderr);
  assert.ok(refused.stderr.includes('build/tools/x is a generated file'), refused.stderr);
  assert.ok(!refused.stderr.includes('build/gomod/go.mod'), 'the tracked path of the config is accepted');
});

test('K930 a tracked entry outside a directory that holds go.mod or Cargo.toml is refused, naming the path and the rule (P34)', (t) => {
  const config = JSON.stringify({ schema: 1, paths: ['build/**'], exceptions: [], tracked: [{ path: 'build/tools/**', reason: 'not a tagged tree' }], moduleFiles: MODULE_FILES });
  const { work } = prepared(t, { files: { 'config/generated.json': config } });
  stage(work, 'build/tools/x');
  const refused = check(work);
  assert.equal(refused.status, 1, refused.stderr);
  assert.ok(refused.stderr.includes('build/tools/**'), refused.stderr);
  assert.ok(refused.stderr.includes('go.mod or Cargo.toml'), refused.stderr);
});

// F2: a declared tracked source is exempt from the header check, as it is from the generated-path check.
test('K930 a tracked go source with a generated-file header passes when config/generated.json tracks it', (t) => {
  const config = JSON.stringify({ schema: 1, paths: [], exceptions: [], tracked: [{ path: 'build/gomod/**', reason: 'a Go module that consumers install as the tagged tree' }], headers: HEADERS, moduleFiles: MODULE_FILES });
  const { work } = prepared(t, { files: { 'config/generated.json': config, 'build/gomod/go.mod': 'module x\n', 'build/gomod/gen.go': '// Code generated by tool. DO NOT EDIT.\npackage x\n' } });
  const tracked = run(work, process.execPath, [tool(import.meta.resolve('../../scripts/kit/generated-files.mts')), 'tracked', ...BINARIES]);
  assert.equal(tracked.status, 0, tracked.stderr);
});

test('a staged executable is refused whatever its path, and one that config/generated.json declares passes (K416)', (t) => {
  const machO = Buffer.concat([Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0x0c, 0x00, 0x00, 0x01]), Buffer.alloc(56)]);
  const elf = Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]), Buffer.alloc(56)]);
  const binary = 'packages/go/cmd/tool/tool';
  const machOCheckout = prepared(t, { files: { 'config/generated.json': GENERATED_CONFIG } });
  stage(machOCheckout.work, binary, machO);
  const refusedMachO = check(machOCheckout.work);
  assert.equal(refusedMachO.status, 1, refusedMachO.stderr);
  assert.match(refusedMachO.stderr, /packages\/go\/cmd\/tool\/tool is an executable object \(Mach-O 64-bit\)/);
  const elfCheckout = prepared(t, { files: { 'config/generated.json': GENERATED_CONFIG } });
  stage(elfCheckout.work, binary, elf);
  const refusedElf = check(elfCheckout.work);
  assert.equal(refusedElf.status, 1, refusedElf.stderr);
  assert.match(refusedElf.stderr, /packages\/go\/cmd\/tool\/tool is an executable object \(ELF\)/);
  const textCheckout = prepared(t, { files: { 'config/generated.json': GENERATED_CONFIG } });
  stage(textCheckout.work, 'packages/go/cmd/text/tool', 'package main\n');
  const accepted = check(textCheckout.work);
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.match(accepted.stdout, /no generated file is staged/);
  const declared = JSON.stringify({ schema: 1, paths: SEGMENTS, exceptions: [{ path: 'tests/*/fixtures/**', reason: 'test fixtures' }, { path: binary, reason: 'a binary fixture' }] });
  const declaredCheckout = prepared(t, { files: { 'config/generated.json': declared } });
  stage(declaredCheckout.work, binary, machO);
  const exempt = check(declaredCheckout.work);
  assert.equal(exempt.status, 0, exempt.stderr);
  assert.match(exempt.stdout, /no generated file is staged/);
});

test('an install directory that Git does not ignore is a finding naming the .gitignore to change (K372)', (t) => {
  const composer = checkout(t, { files: { 'composer.json': '{}\n' } });
  const unignored = installs(composer.work);
  assert.equal(unignored.status, 1, unignored.stderr);
  assert.match(unignored.stderr, /vendor\/ is not ignored by Git .*add vendor\/ to \.gitignore/);
  const ignored = checkout(t, { files: { 'composer.json': '{}\n', '.gitignore': '/var/\nvendor/\n' } });
  const passed = installs(ignored.work);
  assert.equal(passed.status, 0, passed.stderr);
  const go = checkout(t, { files: { 'packages/go/go.mod': 'module example.com/go\n', 'packages/go/vendor/x/x.go': 'package x\n' } });
  const goResult = installs(go.work);
  assert.equal(goResult.status, 0, goResult.stderr);
  const npm = checkout(t, { files: { 'packages/app/package.json': '{}\n' } });
  const npmResult = installs(npm.work);
  assert.equal(npmResult.status, 1, npmResult.stderr);
  assert.match(npmResult.stderr, /packages\/app\/node_modules\/ is not ignored by Git .*add packages\/app\/node_modules\/ to packages\/app\/\.gitignore/);
  const py = checkout(t, { files: { 'packages/py/pyproject.toml': '[project]\nname = "py"\n' } });
  const pyResult = installs(py.work);
  assert.equal(pyResult.status, 1, pyResult.stderr);
  assert.match(pyResult.stderr, /packages\/py\/\.venv\/ is not ignored by Git .*add packages\/py\/\.venv\/ to packages\/py\/\.gitignore/);
});

// K814: a worktree links its install folder to the install of main; Git sees the link as a file, beyond which no pathspec reaches.
test('a symlinked install folder is checked as the link: vendor ignores it and vendor/ does not (K814)', (t) => {
  const linked = (gitignore: string) => {
    const box = checkout(t, { files: { 'composer.json': '{}\n', '.gitignore': `/var/\n${gitignore}\n` } });
    mkdirSync(path.join(box.work, 'main-vendor'));
    symlinkSync(path.join(box.work, 'main-vendor'), path.join(box.work, 'vendor'));
    return installs(box.work);
  };
  const slash = linked('vendor/');
  assert.equal(slash.status, 1, slash.stderr);
  assert.match(slash.stderr, /vendor is not ignored by Git .*add vendor to \.gitignore/);
  assert.doesNotMatch(slash.stderr, /beyond a symbolic link/);
  const plain = linked('vendor');
  assert.equal(plain.status, 0, plain.stderr);
});

// K426: the tracked mode checks every tracked file, not only the staged paths, so a generated file committed before the hook existed is a finding.
test('a tracked generated file, executable object or generated-header file is refused unless config/generated.json declares it (K426)', (t) => {
  const tracked = (work: string) => run(work, process.execPath, [tool(import.meta.resolve('../../scripts/kit/generated-files.mts')), 'tracked', ...BINARIES]);
  const models = 'packages/python/src/polyspec/fixture_models/models/models.py';
  const header = '# Code generated by fixture-gen; DO NOT EDIT\nclass Model:\n    pass\n';
  const cache = prepared(t, { files: { 'config/generated.json': GENERATED_CONFIG, '__pycache__/x.pyc': 'x\n' } });
  const refusedCache = tracked(cache.work);
  assert.equal(refusedCache.status, 1, refusedCache.stderr);
  assert.match(refusedCache.stderr, /__pycache__\/x\.pyc is a generated file/);
  const generated = prepared(t, { files: { 'config/generated.json': GENERATED_CONFIG, [models]: header } });
  const refusedHeader = tracked(generated.work);
  assert.equal(refusedHeader.status, 1, refusedHeader.stderr);
  assert.match(refusedHeader.stderr, /packages\/python\/src\/polyspec\/fixture_models\/models\/models\.py has a generated-file header/);
  const declared = JSON.stringify({ schema: 1, paths: SEGMENTS, exceptions: [{ path: 'tests/*/fixtures/**', reason: 'test fixtures' }, { path: models, reason: 'a generated model' }], headers: HEADERS, moduleFiles: MODULE_FILES });
  const exempt = prepared(t, { files: { 'config/generated.json': declared, [models]: header } });
  const passed = tracked(exempt.work);
  assert.equal(passed.status, 0, passed.stderr);
  assert.match(passed.stdout, /no tracked file is generated/);
  const source = prepared(t, { files: { 'config/generated.json': GENERATED_CONFIG, 'src/app.py': '# Application code, not generated\nprint("hi")\n' } });
  const accepted = tracked(source.work);
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.match(accepted.stdout, /no tracked file is generated/);
  // A shebang is no header: the generated-file header on the line after it counts.
  const script = prepared(t, { files: { 'config/generated.json': GENERATED_CONFIG, 'bin/gen.sh': '#!/bin/sh\n# Code generated by gen; DO NOT EDIT\n' } });
  const refusedScript = tracked(script.work);
  assert.equal(refusedScript.status, 1, refusedScript.stderr);
  assert.match(refusedScript.stderr, /bin\/gen\.sh has a generated-file header/);
  // A tracked symbolic link to a folder and a tracked file deleted from the work tree are read as no file, not as an error.
  symlinkSync('src', path.join(source.work, 'linked'));
  git(source.work, 'add', 'linked');
  commitIndex(source.work, 'link');
  rmSync(path.join(source.work, 'src/app.py'));
  const unread = tracked(source.work);
  assert.equal(unread.status, 0, unread.stderr);
});

// K1073: staged reads config/generated.json only for its paths and exceptions; a checkout without one runs as a declaration of none.
test('K1073 staged runs without config/generated.json: a plain path passes and a named executable kind is still refused', (t) => {
  const { work } = checkout(t, { files: { 'src/a.ts': 'x\n' } });
  rmSync(path.join(work, 'config/generated.json'));
  stage(work, 'src/b.ts');
  const plain = check(work);
  assert.equal(plain.status, 0, plain.stderr);
  assert.match(plain.stdout, /no generated file is staged/);
  stage(work, 'bin/tool', Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46]), Buffer.alloc(60)]));
  const refused = check(work);
  assert.equal(refused.status, 1, refused.stderr);
  assert.match(refused.stderr, /bin\/tool is an executable object \(ELF\)/);
});

// K1083: the install directories are the ones the caller declares; without a declaration nothing is checked, and a bare directory
// is one of the root.
test('K1083 installs checks only the declared install directories, and a call that declares none is a usage error', (t) => {
  const composer = checkout(t, { files: { 'composer.json': '{}\n' } });
  const none = installs(composer.work, []);
  assert.equal(none.status, 2, none.stderr);
  assert.match(none.stderr, /Usage: .*installs <directory> \| <manifest>=<directory>/);
  const other = installs(composer.work, ['package.json=node_modules']);
  assert.equal(other.status, 0, other.stderr);
  const bare = installs(composer.work, ['build']);
  assert.equal(bare.status, 1, bare.stderr);
  assert.match(bare.stderr, /build\/ is not ignored by Git .*add build\/ to \.gitignore/);
  for (const entry of ['=vendor', 'composer.json=', 'a=b=c']) {
    const malformed = installs(composer.work, [entry]);
    assert.equal(malformed.status, 2, `${entry}: ${malformed.stderr}`);
    assert.match(malformed.stderr, /Usage: /, entry);
  }
});

// K1105: the generated folders, headers and module files are the ones that config/generated.json declares and the executable kinds
// are the ones the caller names with --binary; kit sets none of them, and a call that checks nothing is a usage error.
test('K1105 generated folders, headers, module files and executable kinds are only the declared ones', (t) => {
  const elf = Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]), Buffer.alloc(56)]);
  const bare = prepared(t, { files: { 'config/generated.json': JSON.stringify({ schema: 1, paths: [], exceptions: [] }) } });
  stage(bare.work, 'node_modules/x/index.js');
  stage(bare.work, 'pkg.egg-info/PKG-INFO');
  stage(bare.work, 'bin/tool', elf);
  const undeclared = check(bare.work, []);
  assert.equal(undeclared.status, 2, undeclared.stderr);
  assert.match(undeclared.stderr, /staged checks nothing: name a kind with --binary, or declare paths, tracked entries with moduleFiles in config\/generated\.json/);
  // Tracked entries alone, or module files alone, check nothing, so without --binary the call is a usage error.
  const goModule = { path: 'build/gomod/**', reason: 'a Go module that consumers install as the tagged tree' };
  for (const config of [{ schema: 1, paths: [], exceptions: [], tracked: [goModule] }, { schema: 1, paths: [], exceptions: [], moduleFiles: ['go.mod'] }]) {
    const alone = prepared(t, { files: { 'config/generated.json': JSON.stringify(config) } });
    stage(alone.work, 'build/gomod/gen.go');
    const unchecked = check(alone.work, []);
    assert.equal(unchecked.status, 2, `${JSON.stringify(config)}: ${unchecked.stderr}`);
    assert.match(unchecked.stderr, /staged checks nothing/);
  }
  // Tracked entries with their module files are a declaration to check, so a config of only those runs without --binary.
  const modules = prepared(t, { files: { 'config/generated.json': JSON.stringify({ schema: 1, paths: [], exceptions: [], tracked: [{ path: 'build/gomod/**', reason: 'a Go module that consumers install as the tagged tree' }], moduleFiles: ['go.mod'] }), 'build/gomod/go.mod': 'module x\n' } });
  stage(modules.work, 'build/gomod/gen.go');
  const moduleOnly = check(modules.work, []);
  assert.equal(moduleOnly.status, 0, moduleOnly.stderr);
  assert.match(moduleOnly.stdout, /no generated file is staged/);
  const misplaced = prepared(t, { files: { 'config/generated.json': JSON.stringify({ schema: 1, paths: [], exceptions: [], tracked: [{ path: 'build/tools/**', reason: 'not a tagged tree' }], moduleFiles: ['go.mod'] }) } });
  stage(misplaced.work, 'build/tools/x');
  const refusedModule = check(misplaced.work, []);
  assert.equal(refusedModule.status, 1, refusedModule.stderr);
  assert.match(refusedModule.stderr, /tracked build\/tools\/\*\* is not under a directory that holds go\.mod/);
  const otherKind = check(bare.work, ['--binary', 'Mach-O']);
  assert.equal(otherKind.status, 0, otherKind.stderr);
  const named = check(bare.work, ['--binary', 'ELF']);
  assert.equal(named.status, 1, named.stderr);
  assert.match(named.stderr, /bin\/tool is an executable object \(ELF\)/);
  assert.doesNotMatch(named.stderr, /node_modules/);
  const globbed = prepared(t, { files: { 'config/generated.json': JSON.stringify({ schema: 1, paths: ['**/node_modules/**'], exceptions: [] }) } });
  stage(globbed.work, 'node_modules/x/index.js');
  const refused = check(globbed.work, []);
  assert.equal(refused.status, 1, refused.stderr);
  assert.match(refused.stderr, /node_modules\/x\/index\.js is a generated file/);
  const unknown = check(globbed.work, ['--binary', 'COFF']);
  assert.equal(unknown.status, 2, unknown.stderr);
  // A header is a generated-file header only when the config declares its pattern, and the module file of a tracked entry is one
  // that moduleFiles names.
  const trackedRun = (work: string) => run(work, process.execPath, [tool(import.meta.resolve('../../scripts/kit/generated-files.mts')), 'tracked', '--binary', 'ELF']);
  const header = '// Code generated by tool. DO NOT EDIT.\nexport {};\n';
  const undeclaredHeader = prepared(t, { files: { 'config/generated.json': JSON.stringify({ schema: 1, paths: [], exceptions: [] }), 'src/gen.ts': header } });
  assert.equal(trackedRun(undeclaredHeader.work).status, 0);
  const ownHeader = prepared(t, { files: { 'config/generated.json': JSON.stringify({ schema: 1, paths: [], exceptions: [], headers: ['@generated'] }), 'src/gen.ts': header, 'src/own.ts': '// @generated by codegen\nexport {};\n' } });
  const refusedHeader = trackedRun(ownHeader.work);
  assert.equal(refusedHeader.status, 1, refusedHeader.stderr);
  assert.match(refusedHeader.stderr, /src\/own\.ts has a generated-file header/);
  assert.doesNotMatch(refusedHeader.stderr, /src\/gen\.ts/);
  const tracked = { path: 'build/mod/**', reason: 'a module that consumers install as the tagged tree' };
  const ownModule = prepared(t, { files: { 'config/generated.json': JSON.stringify({ schema: 1, paths: [], exceptions: [], tracked: [tracked], moduleFiles: ['package.json'] }), 'build/mod/package.json': '{}\n', 'build/mod/index.js': 'x\n' } });
  assert.equal(trackedRun(ownModule.work).status, 0);
  const goOnly = prepared(t, { files: { 'config/generated.json': JSON.stringify({ schema: 1, paths: [], exceptions: [], tracked: [tracked], moduleFiles: ['go.mod'] }), 'build/mod/package.json': '{}\n' } });
  const refusedGoOnly = trackedRun(goOnly.work);
  assert.equal(refusedGoOnly.status, 1, refusedGoOnly.stderr);
  assert.match(refusedGoOnly.stderr, /tracked build\/mod\/\*\* is not under a directory that holds go\.mod/);
});

// A revision that git cannot read is a failure, not an entry that is no blob (K1156).
test('blobContent throws on a revision that git cannot read and returns undefined only for a gitlink (K1156)', (t) => {
  const root = tree(t, { 'a.txt': 'a\n' });
  assert.throws(() => blobContent(root, 'f'.repeat(40), 'a.txt'), /git cat-file/);
  spawnSync('git', ['update-index', '--add', '--cacheinfo', `160000,${'e'.repeat(40)},vendored`], { cwd: root });
  assert.equal(blobContent(root, ':', 'vendored'), undefined);
});
