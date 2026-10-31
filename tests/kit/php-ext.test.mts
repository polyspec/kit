// Tests of the PHP extension of a repository (php-extension.mts, S10): its names, its one stub and the optional arginfo hash,
// the temporary generation and build with phpize, and the declaration test, which compares by Reflection what the extension registers
// with what the PHP library declares. The extension of tests/kit/php-ext-fixture registers Polyspec\Demo\add and
// Polyspec\Demo\Counter; it is built with the phpize, php-config and php on PATH.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { execute } from '../../scripts/kit/process.mts';
import * as phpExtension from '../../scripts/kit/php-extension.mts';
import { declarationFindings, declarations, declarationsOf, extensionFindings, extensionNames, stubHash, type Declarations } from '../../scripts/kit/php-extension.mts';
import { put, tree } from './tree.mts';
import { toolsPath } from '../../scripts/kit/bootstrap/tool-wrappers.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FIXTURE = path.join(ROOT, 'tests/kit/php-ext-fixture');
const STUB = readFileSync(path.join(FIXTURE, 'polyspec_demo.stub.php'), 'utf8');
const HEADER = readFileSync(path.join(FIXTURE, 'polyspec_demo_arginfo.h'), 'utf8');

// The build tests start the PHP of the checkout, its wrappers in var/tools/bin (K393-1). The fixture checkout gets wrappers that
// run the PHP of kit's own var/tools/bin, the php of PATH that install-tools wrapped, whose gen_stub.php needs the PHP-Parser that kit pins; the PHP
// first on PATH may be another release (K630).
function phpWrappers(root: string) {
  const bin = path.join(root, 'var/tools/bin');
  mkdirSync(bin, { recursive: true });
  for (const name of ['php', 'php-config', 'phpize']) {
    const real = toolsPath(ROOT, 'bin', name);
    writeFileSync(path.join(bin, name), `#!/bin/sh\nexec '${real}' "$@"\n`);
    chmodSync(path.join(bin, name), 0o755);
  }
}

// The files of a repository whose extension follows S10, as { path: text }.
const good = (): Record<string, string> => ({
  'packages/php/composer.json': '{"name": "polyspec/demo"}',
  'packages/php-ext/composer.json': '{"name": "polyspec/demo-php-ext"}',
  'packages/php-ext/src/config.m4': readFileSync(path.join(FIXTURE, 'config.m4'), 'utf8'),
  'packages/php-ext/src/polyspec_demo.stub.php': STUB,
  'packages/php-ext/src/polyspec_demo_arginfo.h': HEADER,
});

const findings = (files: Record<string, string>) => extensionFindings(Object.keys(files), file => files[file]);

test('K670-1: the build keeps the PHP configuration that loads tokenizer', { timeout: 10000 }, (t) => {
  const root = tree(t, { ...good(), '.gitignore': 'var/\n' });
  cpSync(path.join(FIXTURE, 'polyspec_demo.c'), path.join(root, 'packages/php-ext/src/polyspec_demo.c'));
  assert.equal(spawnSync('git', ['add', '-A'], { cwd: root }).status, 0);
  phpWrappers(root);
  const php = path.join(root, 'var/tools/bin/php');
  const real = toolsPath(ROOT, 'bin', 'php');
  writeFileSync(php, `#!/bin/sh\nif [ "$1" = -n ]; then echo 'The "tokenizer" extension is not available' >&2; exit 93; fi\nexec '${real}' "$@"\n`);
  const built = spawnSync(process.execPath, [path.join(ROOT, 'scripts/kit/php-extension.mts'), 'build'], { cwd: root, encoding: 'utf8' });
  assert.equal(built.status, 0, `${built.stdout}\n${built.stderr}`);
});

test('the names of an extension follow from the repository, a hyphen an underscore (S10)', () => {
  assert.deepEqual(extensionNames('demo-codec'), {
    composer: 'polyspec/demo-codec-php-ext',
    extension: 'polyspec_demo_codec',
    stub: 'packages/php-ext/src/polyspec_demo_codec.stub.php',
    arginfo: 'packages/php-ext/src/polyspec_demo_codec_arginfo.h',
  });
  assert.equal(stubHash(STUB), /Stub hash: ([0-9a-f]+)/.exec(HEADER)?.[1], 'the hash of gen_stub.php');
  assert.equal(stubHash('a\r\nb\n'), stubHash('a\nb\n'));
});

test('an extension that follows S10 has no finding, and a repository without one has none', () => {
  assert.deepEqual(findings(good()), []);
  const withoutHeader = good();
  delete withoutHeader['packages/php-ext/src/polyspec_demo_arginfo.h'];
  assert.deepEqual(findings(withoutHeader), []);
  assert.deepEqual(findings({ 'packages/php/composer.json': '{"name": "x"}' }), []);
});

test('a wrong name, a second stub, a stale header and a library of another name are findings (S10)', () => {
  assert.deepEqual(findings({ ...good(), 'packages/php-ext/composer.json': '{"name": "polyspec/demo-extension"}' }), ['packages/php-ext/composer.json: the extension is named polyspec/demo-php-ext, not polyspec/demo-extension']);
  assert.deepEqual(findings({ ...good(), 'packages/php-ext/stubs/other.stub.php': '<?php\n' }), ['packages/php-ext/stubs/other.stub.php: the extension has one stub, packages/php-ext/src/polyspec_demo.stub.php']);
  assert.deepEqual(findings({ ...good(), 'packages/php-ext/src/config.m4': 'PHP_NEW_EXTENSION([demo], [demo.c])\n' }), ['packages/php-ext/src/config.m4: PHP_NEW_EXTENSION names the extension polyspec_demo, not demo']);
  const changed = `${STUB}\nfunction more(): void {}\n`;
  assert.deepEqual(findings({ ...good(), 'packages/php-ext/src/polyspec_demo.stub.php': changed }), [`packages/php-ext/src/polyspec_demo_arginfo.h: the stub hash is ${stubHash(STUB)}, the stub's is ${stubHash(changed)}. Fix: regenerate it with the gen_stub.php that phpize copies into build/ of the extension source: \`php build/gen_stub.php packages/php-ext/src/polyspec_demo.stub.php\` after phpize (K941)`]);
  assert.deepEqual(findings({ ...good(), 'packages/php/composer.json': '{"name": "other/demo"}' }), ['packages/php/composer.json: the PHP library, whose classes the extension registers, is named polyspec/<repository>, not other/demo']);
});

// K616: a repository whose packages/php is an application (a consumer test bed, as in fsm) declares no PHP library, so its extension
// implements none and is named after the repository by its own composer.json; the names, the stub and the header are checked as before.
test('an extension of a repository without a PHP library is named by its own composer.json, with no library to match (K616)', () => {
  const { 'packages/php/composer.json': _, ...extension } = good();
  const bed = { ...extension, 'packages/php/composer.json': '{"name": "polyspec/demo", "type": "project"}' };
  assert.deepEqual(findings(bed), []);
  assert.deepEqual(findings(extension), []);
  assert.deepEqual(findings({ ...bed, 'packages/php-ext/composer.json': '{"name": "polyspec/demo-extension"}' }), ['packages/php-ext/composer.json: the extension of a repository without a PHP library is named polyspec/<repository>-php-ext, not polyspec/demo-extension']);
  assert.deepEqual(findings({ ...bed, 'packages/php-ext/src/config.m4': 'PHP_NEW_EXTENSION([demo], [demo.c])\n' }), ['packages/php-ext/src/config.m4: PHP_NEW_EXTENSION names the extension polyspec_demo, not demo']);
});

// A repository with two PHP libraries, packages/<component>/php, and one extension (S10, K293).
const components = (): Record<string, string> => {
  const { 'packages/php/composer.json': _, ...rest } = good();
  return { ...rest, 'packages/validator/php/composer.json': '{"name": "polyspec/demo-validator"}', 'packages/generator/php/composer.json': '{"name": "polyspec/demo-generator"}' };
};

test('an extension of a repository with libraries per component follows S10 when each library is named after its component (K293)', () => {
  assert.deepEqual(findings(components()), []);
  assert.deepEqual(findings({ ...components(), 'packages/generator/php/composer.json': '{"name": "polyspec/demo-codec"}' }), ['packages/generator/php/composer.json: the PHP library, whose classes the extension registers, is named polyspec/<repository>-generator, not polyspec/demo-codec']);
  assert.deepEqual(findings({ ...components(), 'packages/generator/php/composer.json': '{"name": "polyspec/other-generator"}' }), ['packages/validator/php/composer.json: the PHP libraries name two repositories, other and demo; the repository has one extension']);
  assert.deepEqual(findings({ ...components(), 'packages/php/composer.json': '{"name": "polyspec/demo"}' }), []);
});

test('a declaration that differs from the library, or that the library lacks, is a finding', () => {
  const method = (returnType: string) => ({ static: false, returnType, parameters: [{ name: 'a', type: 'int' }] });
  const extension = { classes: { 'A\\B': { kind: 'class', methods: { run: method('int') } } }, functions: { 'A\\f': method('int') }, constants: {} };
  assert.deepEqual(declarationFindings(extension, extension), []);
  const library = { classes: { 'A\\B': { kind: 'class', methods: { run: method('string') } } }, functions: { 'A\\f': null }, constants: {} };
  assert.deepEqual(declarationFindings(extension, library), ['class A\\B methods run returnType: extension "int", library "string"', 'function A\\f: the extension registers it, and the PHP library declares none']);
});

test('an extension-only class is allowed only when its stub explicitly marks it internal (K569)', () => {
  const extension: Declarations = { classes: { 'A\\PublicApi': { kind: 'class' }, 'A\\Callback': { kind: 'class' } }, functions: {}, constants: {} };
  const library: Declarations = { classes: { 'A\\PublicApi': { kind: 'class' } }, functions: {}, constants: {} };
  const stub = `<?php\nnamespace A;\n/** Documentation example: namespace B\\Fake; */\n/** @internal callback state */\nfinal class Callback {}\nfinal class PublicApi {}\n`;
  const internalClasses = phpExtension.internalClassesOfStub?.(stub) ?? new Set<string>();
  assert.deepEqual(internalClasses, new Set(['A\\Callback']));
  assert.deepEqual(declarationFindings(extension, library, internalClasses), []);
  assert.deepEqual(declarationFindings(extension, library), ['class A\\Callback: the extension registers it, and the PHP library declares none']);
});

test('a library self type equals the declaring class type in extension arginfo (K569)', () => {
  const extension: Declarations = { classes: { 'A\\PublicApi': { kind: 'class', methods: { make: { returnType: 'A\\PublicApi' } } } }, functions: {}, constants: {} };
  const library: Declarations = { classes: { 'A\\PublicApi': { kind: 'class', methods: { make: { returnType: 'self' } } } }, functions: {}, constants: {} };
  assert.deepEqual(declarationFindings(extension, library), []);
});

// The PHP library of the fixture, with the return type of Counter::next.
const library = (next: string) => `<?php

declare(strict_types=1);

namespace Polyspec\\Demo;

function add(int $a, int $b = 1): int
{
    return $a + $b;
}

final class Counter
{
    private int $value;

    public function __construct(int $start = 0)
    {
        $this->value = $start;
    }

    public function next(): ${next}
    {
        return ++$this->value;
    }
}
`;

test('the build publishes the extension, which reports the version of its composer.json, and whose declarations Reflection compares with those of the library (S10)', (t) => {
  const root = tree(t, { ...good(), 'packages/php-ext/composer.json': '{"name": "polyspec/demo-php-ext", "version": "1.2.3"}', 'packages/php/src/Demo.php': library('int'), 'packages/php/autoload.php': "<?php\n\nrequire __DIR__ . '/src/Demo.php';\n" });
  cpSync(path.join(FIXTURE, 'polyspec_demo.c'), path.join(root, 'packages/php-ext/src/polyspec_demo.c'));
  assert.equal(spawnSync('git', ['add', '-A'], { cwd: root }).status, 0);
  phpWrappers(root);
  const built = spawnSync(process.execPath, [path.join(ROOT, 'scripts/kit/php-extension.mts'), 'build'], { cwd: root, encoding: 'utf8' });
  assert.equal(built.status, 0, built.stderr);
  const extension = path.join(root, 'var/php-ext/polyspec_demo.so');
  assert.ok(existsSync(extension), 'the library is published');
  assert.equal(execute(toolsPath(ROOT, 'bin', 'php'), ['-d', `extension=${extension}`, '-r', 'echo phpversion("polyspec_demo");'], { cwd: root }).stdout, '1.2.3', 'the version of composer.json');
  const script = path.join(ROOT, 'scripts/kit/symbols/php/reflection.php');
  const read = (args: string[]) => {
    const result = execute(toolsPath(ROOT, 'bin', 'php'), args, { cwd: root });
    assert.equal(result.status, 0, result.stderr);
    return declarationsOf(result.stdout);
  };
  const registered = read(['-d', `extension=${extension}`, script, 'extension', 'polyspec_demo']);
  assert.deepEqual(Object.keys(registered.classes), ['Polyspec\\Demo\\Counter']);
  assert.deepEqual(Object.keys(registered.functions), ['Polyspec\\Demo\\add']);
  const names = path.join(root, 'var/names.json');
  writeFileSync(names, JSON.stringify({ classes: Object.keys(registered.classes), functions: Object.keys(registered.functions), constants: Object.keys(registered.constants) }));
  const declared = () => read([script, 'library', path.join(root, 'packages/php/autoload.php'), names]);
  assert.deepEqual(declarationFindings(registered, declared()), []);
  put(root, { 'packages/php/src/Demo.php': library('string') });
  assert.deepEqual(declarationFindings(registered, declared()), ['class Polyspec\\Demo\\Counter methods next returnType: extension "int", library "string"']);
});

// K941: php-config --prefix names the prefix of the PHP, which on Ubuntu has no lib/php/build (its build directory is
// /usr/lib/php/<api>/build); the arginfo comes from the gen_stub.php that phpize copies into build/ of the source.
test('the arginfo comes from the gen_stub.php that phpize copies, whatever prefix php-config names (K941)', (t) => {
  const files = good();
  delete files['packages/php-ext/src/polyspec_demo_arginfo.h'];
  const root = tree(t, { ...files, '.gitignore': 'var/\n' });
  cpSync(path.join(FIXTURE, 'polyspec_demo.c'), path.join(root, 'packages/php-ext/src/polyspec_demo.c'));
  assert.equal(spawnSync('git', ['add', '-A'], { cwd: root }).status, 0);
  phpWrappers(root);
  const real = toolsPath(ROOT, 'bin', 'php-config');
  writeFileSync(path.join(root, 'var/tools/bin/php-config'), `#!/bin/sh\nif [ "$1" = "--prefix" ]; then echo /nonexistent/prefix; else exec '${real}' "$@"; fi\n`);
  chmodSync(path.join(root, 'var/tools/bin/php-config'), 0o755);
  const built = spawnSync(process.execPath, [path.join(ROOT, 'scripts/kit/php-extension.mts'), 'build'], { cwd: root, encoding: 'utf8' });
  assert.equal(built.status, 0, `${built.stdout}\n${built.stderr}`);
  assert.ok(existsSync(path.join(root, 'var/php-ext/polyspec_demo.so')));
});

// K941: gen_stub keeps the PHP-Parser it fetches in its own directory, which kit keeps once per checkout in var/php-ext/gen-stub,
// so a second build in the same checkout fetches nothing; the first build fetches it with PHP's own gen_stub.php.
test('a second build in the same checkout fetches no PHP-Parser, since gen_stub keeps it in var/php-ext/gen-stub (K941)', { timeout: 300000 }, (t) => {
  const files = good();
  delete files['packages/php-ext/src/polyspec_demo_arginfo.h'];
  const root = tree(t, { ...files, '.gitignore': 'var/\n' });
  cpSync(path.join(FIXTURE, 'polyspec_demo.c'), path.join(root, 'packages/php-ext/src/polyspec_demo.c'));
  assert.equal(spawnSync('git', ['add', '-A'], { cwd: root }).status, 0);
  phpWrappers(root);
  const build = (env: NodeJS.ProcessEnv) => spawnSync(process.execPath, [path.join(ROOT, 'scripts/kit/php-extension.mts'), 'build'], { cwd: root, encoding: 'utf8', env });
  const first = build(process.env);
  assert.equal(first.status, 0, `${first.stdout}\n${first.stderr}`);
  // Every fetch of the second build calls wget or curl; both record the call and fail, so a fetch fails the build as well.
  const bin = path.join(root, 'fake-bin');
  mkdirSync(bin, { recursive: true });
  const calls = path.join(root, 'fetch-calls.log');
  for (const name of ['wget', 'curl']) {
    writeFileSync(path.join(bin, name), `#!/bin/sh\necho "${name} $*" >> '${calls}'\nexit 1\n`);
    chmodSync(path.join(bin, name), 0o755);
  }
  const second = build({ ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}` });
  assert.equal(second.status, 0, `${second.stdout}\n${second.stderr}`);
  assert.equal(existsSync(calls) ? readFileSync(calls, 'utf8') : '', '', 'the second build calls no fetch');
});

// K941 (b1): gen_stub makes its PHP-Parser directory before tar extracts it, and a build that starts its own check after that
// mkdir but before tar ends trusts the half-extracted parser; gen_stub's flock does not cover that check. The fetch sleeps, the
// directory appears, then tar sleeps before it extracts; a second build starts while tar still sleeps.
test('a second build that starts while the parser is extracting waits for it, and builds (K941)', { timeout: 300000 }, async (t) => {
  const files = good();
  delete files['packages/php-ext/src/polyspec_demo_arginfo.h'];
  const root = tree(t, { ...files, '.gitignore': 'var/\n' });
  cpSync(path.join(FIXTURE, 'polyspec_demo.c'), path.join(root, 'packages/php-ext/src/polyspec_demo.c'));
  assert.equal(spawnSync('git', ['add', '-A'], { cwd: root }).status, 0);
  phpWrappers(root);
  const bin = path.join(root, 'slow-bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(path.join(bin, 'wget'), '#!/bin/sh\nsleep 4\nexec curl -fsSL -o "$2" "$3"\n');
  writeFileSync(path.join(bin, 'tar'), '#!/bin/sh\nsleep 8\nexec /usr/bin/tar "$@"\n');
  for (const name of ['wget', 'tar']) chmodSync(path.join(bin, name), 0o755);
  const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}` };
  const build = () => new Promise<{ status: number | null; output: string }>((resolve) => {
    const child = spawn(process.execPath, [path.join(ROOT, 'scripts/kit/php-extension.mts'), 'build'], { cwd: root, env });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => { output += chunk; });
    child.stderr.on('data', (chunk: Buffer) => { output += chunk; });
    child.on('close', (status) => resolve({ status, output }));
  });
  const first = build();
  await new Promise((resolve) => setTimeout(resolve, 8000));
  const second = build();
  const [one, two] = await Promise.all([first, second]);
  assert.equal(one.status, 0, one.output);
  assert.equal(two.status, 0, two.output);
  assert.ok(existsSync(path.join(root, 'var/php-ext/polyspec_demo.so')));
});

// K941 (b2): a fetch that fails leaves no PHP-Parser directory, so the next build starts from nothing and fetches again.
// The PHP-Parser directories of a folder, which a failed run must not leave behind.
const parsersIn = (folder: string): string[] => (existsSync(folder) ? readdirSync(folder).filter(name => name.startsWith('PHP-Parser-')).sort() : []);
test('a failing PHP-Parser fetch leaves no PHP-Parser directory, so the next build starts from nothing (K941)', { timeout: 300000 }, (t) => {
  const files = good();
  delete files['packages/php-ext/src/polyspec_demo_arginfo.h'];
  const root = tree(t, { ...files, '.gitignore': 'var/\n' });
  cpSync(path.join(FIXTURE, 'polyspec_demo.c'), path.join(root, 'packages/php-ext/src/polyspec_demo.c'));
  assert.equal(spawnSync('git', ['add', '-A'], { cwd: root }).status, 0);
  phpWrappers(root);
  const bin = path.join(root, 'failing-bin');
  mkdirSync(bin, { recursive: true });
  for (const name of ['wget', 'curl']) {
    writeFileSync(path.join(bin, name), '#!/bin/sh\nexit 1\n');
    chmodSync(path.join(bin, name), 0o755);
  }
  const failed = spawnSync(process.execPath, [path.join(ROOT, 'scripts/kit/php-extension.mts'), 'build'], { cwd: root, encoding: 'utf8', env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}` } });
  assert.notEqual(failed.status, 0, `${failed.stdout}\n${failed.stderr}`);
  assert.deepEqual(parsersIn(path.join(root, 'var/php-ext/gen-stub')), [], 'the failed build leaves no PHP-Parser directory');
});

// K941 (1): the cleanup of a failed run removes only the PHP-Parser directories that the run created; a parser an earlier build
// fetched stays, and a later build uses it.
test('a stub syntax error after an earlier good fetch keeps the parser that the earlier build fetched (K941)', { timeout: 300000 }, (t) => {
  const files = good();
  delete files['packages/php-ext/src/polyspec_demo_arginfo.h'];
  const root = tree(t, { ...files, '.gitignore': 'var/\n' });
  cpSync(path.join(FIXTURE, 'polyspec_demo.c'), path.join(root, 'packages/php-ext/src/polyspec_demo.c'));
  assert.equal(spawnSync('git', ['add', '-A'], { cwd: root }).status, 0);
  phpWrappers(root);
  const firstBuild = spawnSync(process.execPath, [path.join(ROOT, 'scripts/kit/php-extension.mts'), 'build'], { cwd: root, encoding: 'utf8' });
  assert.equal(firstBuild.status, 0, `${firstBuild.stdout}\n${firstBuild.stderr}`);
  const fetched = parsersIn(path.join(root, 'var/php-ext/gen-stub'));
  assert.equal(fetched.length, 1, 'the good build fetched one PHP-Parser');
  writeFileSync(path.join(root, 'packages/php-ext/src/polyspec_demo.stub.php'), '<?php\nfunction broken(: int {}\n');
  const broken = spawnSync(process.execPath, [path.join(ROOT, 'scripts/kit/php-extension.mts'), 'build'], { cwd: root, encoding: 'utf8' });
  assert.notEqual(broken.status, 0, `${broken.stdout}\n${broken.stderr}`);
  assert.deepEqual(parsersIn(path.join(root, 'var/php-ext/gen-stub')), fetched, 'the earlier parser stays');
});

// K946: a failed configure keeps its config.log under var/ and names it, as a copy at var/php-ext/config.log, and a successful
// build removes that copy, so no stale failure log survives. The work folder is removed as before.
test('a failed configure keeps its config.log under var/ and names it, and a success removes it (K946)', { timeout: 300000 }, (t) => {
  const files = good();
  delete files['packages/php-ext/src/polyspec_demo_arginfo.h'];
  const config = readFileSync(path.join(FIXTURE, 'config.m4'), 'utf8');
  files['packages/php-ext/src/config.m4'] = `AS_ECHO(["K946 config.log marker"]) >&5\nAC_MSG_ERROR([K946 fixture: configure fails])\n${config}`;
  const root = tree(t, { ...files, '.gitignore': 'var/\n' });
  cpSync(path.join(FIXTURE, 'polyspec_demo.c'), path.join(root, 'packages/php-ext/src/polyspec_demo.c'));
  assert.equal(spawnSync('git', ['add', '-A'], { cwd: root }).status, 0);
  phpWrappers(root);
  const failed = spawnSync(process.execPath, [path.join(ROOT, 'scripts/kit/php-extension.mts'), 'build'], { cwd: root, encoding: 'utf8' });
  assert.notEqual(failed.status, 0, `${failed.stdout}\n${failed.stderr}`);
  const copied = path.join(root, 'var/php-ext/config.log');
  assert.match(failed.stdout + failed.stderr, /config\.log is kept at .*var\/php-ext\/config\.log/, 'the message names the copied config.log');
  assert.equal(existsSync(copied), true, 'the copy of config.log is kept under var/');
  assert.match(readFileSync(copied, 'utf8'), /K946 config\.log marker/, 'the copy holds the marker that the fixture wrote');
  assert.equal(existsSync(path.join(root, 'var/php-ext/configure-failed')), false, 'no folder of the failed build is kept');
  // A successful build removes the copy: the fixture no longer fails configure.
  writeFileSync(path.join(root, 'packages/php-ext/src/config.m4'), config);
  assert.equal(spawnSync('git', ['add', '-A'], { cwd: root }).status, 0);
  const built = spawnSync(process.execPath, [path.join(ROOT, 'scripts/kit/php-extension.mts'), 'build'], { cwd: root, encoding: 'utf8' });
  assert.equal(built.status, 0, `${built.stdout}\n${built.stderr}`);
  assert.equal(existsSync(copied), false, 'a successful build removes the failure log');
});

// K947: a build finds its PHP tools on the PATH of its checkout as make gives it: the checkout's own bin and shims first, then the
// PATH of the caller. A build without var/tools, such as a consumer's make or a pack copy, finds its PHP on that PATH.
function externalPhp(root: string): string {
  const external = path.join(root, 'external-bin');
  mkdirSync(external, { recursive: true });
  for (const name of ['php', 'php-config', 'phpize']) {
    writeFileSync(path.join(external, name), `#!/bin/sh\nexec '${toolsPath(ROOT, 'bin', name)}' "$@"\n`);
    chmodSync(path.join(external, name), 0o755);
  }
  return external;
}

test('a build finds php, php-config and phpize on the PATH of its caller when its checkout has no var/tools (K947)', { timeout: 300000 }, (t) => {
  const files = good();
  delete files['packages/php-ext/src/polyspec_demo_arginfo.h'];
  const root = tree(t, { ...files, '.gitignore': 'var/\n' });
  cpSync(path.join(FIXTURE, 'polyspec_demo.c'), path.join(root, 'packages/php-ext/src/polyspec_demo.c'));
  assert.equal(spawnSync('git', ['add', '-A'], { cwd: root }).status, 0);
  const external = externalPhp(root);
  const built = spawnSync(process.execPath, [path.join(ROOT, 'scripts/kit/php-extension.mts'), 'build'], { cwd: root, encoding: 'utf8', env: { ...process.env, PATH: `${external}${path.delimiter}${process.env.PATH ?? ''}` } });
  assert.equal(built.status, 0, `${built.stdout}\n${built.stderr}`);
  assert.ok(existsSync(path.join(root, 'var/php-ext/polyspec_demo.so')));
});

test('the build generates arginfo from the stub in its temporary source when no header is tracked (K560)', (t) => {
  const files = good();
  delete files['packages/php-ext/src/polyspec_demo_arginfo.h'];
  const root = tree(t, { ...files, '.gitignore': 'var/\n' });
  cpSync(path.join(FIXTURE, 'polyspec_demo.c'), path.join(root, 'packages/php-ext/src/polyspec_demo.c'));
  assert.equal(spawnSync('git', ['add', '-A'], { cwd: root }).status, 0);
  const before = spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).stdout;
  phpWrappers(root);
  const built = spawnSync(process.execPath, [path.join(ROOT, 'scripts/kit/php-extension.mts'), 'build'], { cwd: root, encoding: 'utf8' });
  assert.equal(built.status, 0, `${built.stdout}\n${built.stderr}`);
  assert.ok(existsSync(path.join(root, 'var/php-ext/polyspec_demo.so')));
  assert.equal(existsSync(path.join(root, 'packages/php-ext/src/polyspec_demo_arginfo.h')), false, 'generation stays out of package source');
  assert.equal(spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).stdout, before, 'build output stays ignored');
});

test('the extension build stages declared sources and accepts an explicit output and configure argument', (t) => {
  const files = good();
  const originalConfig = readFileSync(path.join(FIXTURE, 'config.m4'), 'utf8');
  files['packages/php-ext/src/config.m4'] = originalConfig.replace(
    '[polyspec_demo.c]',
    '[polyspec_demo.c native/shared.c]',
  ).replace(
    'if test "$PHP_POLYSPEC_DEMO" != "no"; then',
    'PHP_ARG_ENABLE([polyspec-demo-offset], [whether to enable the test offset], [AS_HELP_STRING([--enable-polyspec-demo-offset], [Enable the test offset])], [no])\n\nif test "$PHP_POLYSPEC_DEMO_OFFSET" != "no"; then\n  AC_DEFINE([HAVE_POLYSPEC_DEMO_OFFSET], [1], [Test configure argument])\nfi\n\nif test "$PHP_POLYSPEC_DEMO" != "no"; then',
  );
  const source = readFileSync(path.join(FIXTURE, 'polyspec_demo.c'), 'utf8').replace(
    'static zend_class_entry *counter_entry;',
    'int shared_offset(void);\n\nstatic zend_class_entry *counter_entry;',
  ).replace('RETURN_LONG(a + b);', 'RETURN_LONG(a + b + shared_offset());');
  files['packages/php-ext/src/polyspec_demo.c'] = source;
  files['packages/php/src/native/shared.c'] = '#ifdef HAVE_CONFIG_H\n#include "config.h"\n#endif\n\n#ifdef HAVE_POLYSPEC_DEMO_OFFSET\nint shared_offset(void) { return 40; }\n#else\nint shared_offset(void) { return 0; }\n#endif\n';
  files['packages/php-ext/testing/mermaid/module.c'] = 'int mermaid_test_source_is_staged(void) { return 1; }\n';
  const root = tree(t, { ...files, '.gitignore': 'var/\n' });
  assert.equal(spawnSync('git', ['add', '-A'], { cwd: root }).status, 0);
  phpWrappers(root);
  const outputPath = path.join(root, 'var/custom-run/polyspec_demo.so');
  const built = spawnSync(process.execPath, [
    path.join(ROOT, 'scripts/kit/php-extension.mts'), 'build', '--output', outputPath,
    '--source-copy', 'packages/php-ext/testing/mermaid/module.c', 'src/mermaid_test.c',
    '--source-copy', 'packages/php/src/native/shared.c', 'src/native/shared.c',
    '--configure-arg', '--enable-polyspec-demo-offset',
  ], { cwd: root, encoding: 'utf8' });
  assert.equal(built.status, 0, `${built.stdout}\n${built.stderr}`);
  assert.equal(existsSync(path.join(root, 'var/php-ext/polyspec_demo.so')), false, 'an explicit output does not also publish to the default location');
  const output = spawnSync(path.join(root, 'var/tools/bin/php'), ['-d', `extension=${outputPath}`, '-r', 'echo Polyspec\\Demo\\add(1);'], { cwd: root, encoding: 'utf8' });
  assert.equal(output.status, 0, output.stderr);
  assert.equal(output.stdout, '42', 'the compiled extension called the staged shared source');
});

test('a failed extension build keeps compiler warnings and the make cause without replacing the published module', (t) => {
  const root = tree(t, { ...good(), '.gitignore': 'var/\n' });
  cpSync(path.join(FIXTURE, 'polyspec_demo.c'), path.join(root, 'packages/php-ext/src/polyspec_demo.c'));
  assert.equal(spawnSync('git', ['add', '-A'], { cwd: root }).status, 0);
  phpWrappers(root);

  const bin = path.join(root, 'var/failing-make-bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(path.join(bin, 'make'), `#!/bin/sh\nprintf '%s\\n' 'fixture.c:12:3: warning: retained warning' "make: *** No rule to make target 'missing-target'. Stop."\nexit 2\n`);
  chmodSync(path.join(bin, 'make'), 0o755);

  const output = path.join(root, 'var/custom-run/polyspec_demo.so');
  const previousArtifact = 'previous extension artifact';
  mkdirSync(path.dirname(output), { recursive: true });
  mkdirSync(path.join(root, 'var/tmp'), { recursive: true });
  writeFileSync(output, previousArtifact);
  const env: NodeJS.ProcessEnv = {
    HOME: process.env.HOME,
    PATH: `${bin}${path.delimiter}${path.join(root, 'var/tools/bin')}${path.delimiter}${process.env.PATH ?? ''}`,
    TMPDIR: path.join(root, 'var/tmp'),
  };
  const result = spawnSync(process.execPath, [path.join(ROOT, 'scripts/kit/php-extension.mts'), 'build', '--output', output], {
    cwd: root, env, encoding: 'utf8',
  });

  assert.equal(result.error, undefined, `builder could not start: ${result.error?.message ?? ''}`);
  assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, /fixture\.c:12:3: warning: retained warning/);
  assert.match(result.stderr, /No rule to make target 'missing-target'/);
  assert.equal(readFileSync(output, 'utf8'), previousArtifact, 'the failed build preserves the previous published module');
  assert.deepEqual(readdirSync(path.dirname(output)).filter(name => name.startsWith('polyspec_demo.so.tmp.')), []);
  assert.deepEqual(readdirSync(path.join(root, 'var/php-ext')).filter(name => name.startsWith('build.')), []);
});

test('the declarations of the extension are compared with the library that declares each name (K293)', (t) => {
  const counter = library('int').replace(/function add[\s\S]*?\n}\n\n/, '');
  const adder = (type: string) => `<?php\n\ndeclare(strict_types=1);\n\nnamespace Polyspec\\Demo;\n\nfunction add(int $a, int $b = 1): ${type}\n{\n    return $a + $b;\n}\n`;
  const autoload = (name: string) => `<?php\n\nrequire __DIR__ . '/src/${name}.php';\n`;
  const root = tree(t, {
    ...components(),
    'packages/php-ext/composer.json': '{"name": "polyspec/demo-php-ext", "version": "1.2.3"}',
    'packages/validator/php/src/Counter.php': counter, 'packages/validator/php/vendor/autoload.php': autoload('Counter').replace('/src/', '/../src/'),
    'packages/generator/php/src/Adder.php': adder('int'), 'packages/generator/php/vendor/autoload.php': autoload('Adder').replace('/src/', '/../src/'),
  });
  cpSync(path.join(FIXTURE, 'polyspec_demo.c'), path.join(root, 'packages/php-ext/src/polyspec_demo.c'));
  assert.equal(spawnSync('git', ['add', '-A'], { cwd: root }).status, 0);
  phpWrappers(root);
  const built = spawnSync(process.execPath, [path.join(ROOT, 'scripts/kit/php-extension.mts'), 'build'], { cwd: root, encoding: 'utf8' });
  assert.equal(built.status, 0, built.stderr);
  assert.deepEqual(declarations(root), []);
  put(root, { 'packages/generator/php/src/Adder.php': adder('string') });
  assert.deepEqual(declarations(root), ['function Polyspec\\Demo\\add returnType: extension "int", library "string"']);
});

test('the build copy holds the sources of the extension only, so a stale build product of src/ is never built (K302)', (t) => {
  const root = tree(t, { ...good(), 'packages/php-ext/composer.json': '{"name": "polyspec/demo-php-ext", "version": "1.2.3"}', 'packages/php/src/Demo.php': library('int') });
  const source = path.join(root, 'packages/php-ext/src');
  cpSync(path.join(FIXTURE, 'polyspec_demo.c'), path.join(source, 'polyspec_demo.c'));
  assert.equal(spawnSync('git', ['add', '-A'], { cwd: root }).status, 0);
  phpWrappers(root);
  // An in-place build of src/ leaves objects, a libtool library and modules/polyspec_demo.so, as a repository that builds there does.
  for (const [command, args] of [['phpize', []], ['./configure', ['--enable-polyspec-demo']], ['make', []]] as const) {
    const made = spawnSync(command, args, { cwd: source, encoding: 'utf8' });
    assert.equal(made.status, 0, `${command}: ${made.stderr}`);
  }
  assert.ok(existsSync(path.join(source, 'modules/polyspec_demo.so')), 'the stale module');
  // The C no longer compiles, and is older than the objects, so make would find them current.
  const broken = path.join(source, 'polyspec_demo.c');
  writeFileSync(broken, 'this is not C\n');
  utimesSync(broken, new Date(0), new Date(0));
  const built = spawnSync(process.execPath, [path.join(ROOT, 'scripts/kit/php-extension.mts'), 'build'], { cwd: root, encoding: 'utf8' });
  assert.equal(built.status, 1, built.stdout);
  assert.equal(existsSync(path.join(root, 'var/php-ext/polyspec_demo.so')), false, 'nothing is published');
});

test('the sources of the extension are read from the working tree, so generated sources that are not tracked pass the check (K297)', (t) => {
  const generated = Object.fromEntries(Object.entries(good()).filter(([file]) => file.startsWith('packages/php-ext/src/')));
  const tracked = Object.fromEntries(Object.entries(good()).filter(([file]) => !(file in generated)));
  // The generated sources are ignored by Git, as a repository that never tracks generated output ignores them.
  const root = tree(t, { ...tracked, '.gitignore': 'packages/php-ext/src/\n' });
  assert.equal(spawnSync('git', ['add', '-A'], { cwd: root }).status, 0);
  put(root, generated);
  const checked = spawnSync(process.execPath, [path.join(ROOT, 'scripts/kit/php-extension.mts'), 'check'], { cwd: root, encoding: 'utf8' });
  assert.equal(checked.status, 0, checked.stderr);
  // A second stub among the generated sources is a finding as well.
  put(root, { 'packages/php-ext/src/other.stub.php': '<?php\n' });
  const second = spawnSync(process.execPath, [path.join(ROOT, 'scripts/kit/php-extension.mts'), 'check'], { cwd: root, encoding: 'utf8' });
  assert.equal(second.status, 1);
  assert.match(second.stderr, /other\.stub\.php: the extension has one stub/);
});

test('the build refuses an extension with a finding before phpize runs', (t) => {
  const root = tree(t, { ...good(), 'packages/php-ext/composer.json': '{"name": "polyspec/demo-ext"}' });
  assert.equal(spawnSync('git', ['add', '-A'], { cwd: root }).status, 0);
  const built = spawnSync(process.execPath, [path.join(ROOT, 'scripts/kit/php-extension.mts'), 'build'], { cwd: root, encoding: 'utf8' });
  assert.equal(built.status, 1);
  assert.match(built.stderr, /the extension is named polyspec\/demo-php-ext, not polyspec\/demo-ext/);
  assert.equal(existsSync(path.join(root, 'var/php-ext')), false);
});

test('a repository without an extension passes the check, the build and the test, and says so (S10)', (t) => {
  const root = tree(t, { 'packages/php/composer.json': '{"name": "polyspec/demo"}' });
  assert.equal(spawnSync('git', ['add', '-A'], { cwd: root }).status, 0);
  for (const command of ['check', 'build', 'test']) {
    const result = spawnSync(process.execPath, [path.join(ROOT, 'scripts/kit/php-extension.mts'), command], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /the repository has no PHP extension/);
  }
});

test('the build of an extension fails on a dropped result that must be checked, P8 for C (K334)', (t) => {
  // A function that warn_unused_result declares: its result is dropped in MINIT, or used in the variant.
  const checkedFunction = '__attribute__((warn_unused_result)) static int checked(void) { return 1; }\n\n';
  const source = readFileSync(path.join(FIXTURE, 'polyspec_demo.c'), 'utf8');
  const build = (call: string) => {
    const injected = source.replace('static PHP_MINIT_FUNCTION(polyspec_demo)', `${checkedFunction}static PHP_MINIT_FUNCTION(polyspec_demo)`).replace(
      'counter_entry = register_class_Polyspec_Demo_Counter();',
      `counter_entry = register_class_Polyspec_Demo_Counter();\n\t${call}`,
    );
    const root = tree(t, { ...good(), 'packages/php-ext/composer.json': '{"name": "polyspec/demo-php-ext", "version": "1.2.3"}', 'packages/php/src/Demo.php': library('int'), 'packages/php-ext/src/polyspec_demo.c': injected });
    assert.equal(spawnSync('git', ['add', '-A'], { cwd: root }).status, 0);
    phpWrappers(root);
    return spawnSync(process.execPath, [path.join(ROOT, 'scripts/kit/php-extension.mts'), 'build'], { cwd: root, encoding: 'utf8' });
  };
  const dropped = build('checked();');
  assert.notEqual(dropped.status, 0, 'a dropped result fails the build');
  assert.match(`${dropped.stdout}${dropped.stderr}`, /unused-result|warn_unused_result/);
  const used = build('if (checked() != 1) { return FAILURE; }');
  assert.equal(used.status, 0, used.stderr);
});

test('the compare of test-php-ext fails on a class, function or constant that the extension registers outside the library (K338)', (t) => {
  // The fixture registers one more class and one more constant in its MINIT, in the namespace Polyspec\Native, which the library does not have.
  const extra = readFileSync(path.join(FIXTURE, 'polyspec_demo.c'), 'utf8').replace(
    'counter_entry = register_class_Polyspec_Demo_Counter();',
    'counter_entry = register_class_Polyspec_Demo_Counter();\n\t{ zend_class_entry extra; INIT_NS_CLASS_ENTRY(extra, "Polyspec\\\\Native", "Extra", NULL); zend_register_internal_class(&extra); }\n\tREGISTER_NS_LONG_CONSTANT("Polyspec\\\\Native", "EXTRA", 1, CONST_CS | CONST_PERSISTENT);',
  );
  const autoload = "<?php\n\nrequire __DIR__ . '/../src/Demo.php';\n";
  const root = tree(t, { ...good(), 'packages/php-ext/composer.json': '{"name": "polyspec/demo-php-ext", "version": "1.2.3"}', 'packages/php/src/Demo.php': library('int'), 'packages/php/vendor/autoload.php': autoload, 'packages/php-ext/src/polyspec_demo.c': extra });
  assert.equal(spawnSync('git', ['add', '-A'], { cwd: root }).status, 0);
  phpWrappers(root);
  const built = spawnSync(process.execPath, [path.join(ROOT, 'scripts/kit/php-extension.mts'), 'build'], { cwd: root, encoding: 'utf8' });
  assert.equal(built.status, 0, built.stderr);
  assert.deepEqual(declarations(root), ['class Polyspec\\Native\\Extra: the extension registers it, and the PHP library declares none', 'constant Polyspec\\Native\\EXTRA: the extension registers it, and the PHP library declares none']);});
