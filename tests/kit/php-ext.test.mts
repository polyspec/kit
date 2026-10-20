// Tests of the PHP extension of a repository (php-extension.mts, S10): its names, its one stub and the stub hash of its
// arginfo header, the build with phpize, and the declaration test, which compares by Reflection what the extension registers
// with what the PHP library declares. The extension of tests/kit/php-ext-fixture registers Polyspec\Demo\add and
// Polyspec\Demo\Counter; it is built with the phpize, php-config and php on PATH.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { execute } from '../../scripts/kit/process.mts';
import { declarationFindings, declarationsOf, extensionFindings, extensionNames, stubHash } from '../../scripts/kit/php-extension.mts';
import { put, tree } from './tree.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FIXTURE = path.join(ROOT, 'tests/kit/php-ext-fixture');
const STUB = readFileSync(path.join(FIXTURE, 'polyspec_demo.stub.php'), 'utf8');
const HEADER = readFileSync(path.join(FIXTURE, 'polyspec_demo_arginfo.h'), 'utf8');

// The files of a repository whose extension follows S10, as { path: text }.
const good = (): Record<string, string> => ({
  'packages/php/composer.json': '{"name": "polyspec/demo"}',
  'packages/php-ext/composer.json': '{"name": "polyspec/demo-php-ext"}',
  'packages/php-ext/src/config.m4': readFileSync(path.join(FIXTURE, 'config.m4'), 'utf8'),
  'packages/php-ext/src/polyspec_demo.stub.php': STUB,
  'packages/php-ext/src/polyspec_demo_arginfo.h': HEADER,
});

const findings = (files: Record<string, string>) => extensionFindings(Object.keys(files), file => files[file]);

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
  assert.deepEqual(findings({ 'packages/php/composer.json': '{"name": "x"}' }), []);
});

test('a wrong name, a second stub, a stale header and a library of another name are findings (S10)', () => {
  assert.deepEqual(findings({ ...good(), 'packages/php-ext/composer.json': '{"name": "polyspec/demo-extension"}' }), ['packages/php-ext/composer.json: the extension is named polyspec/demo-php-ext, not polyspec/demo-extension']);
  assert.deepEqual(findings({ ...good(), 'packages/php-ext/stubs/other.stub.php': '<?php\n' }), ['packages/php-ext/stubs/other.stub.php: the extension has one stub, packages/php-ext/src/polyspec_demo.stub.php']);
  assert.deepEqual(findings({ ...good(), 'packages/php-ext/src/config.m4': 'PHP_NEW_EXTENSION([demo], [demo.c])\n' }), ['packages/php-ext/src/config.m4: PHP_NEW_EXTENSION names the extension polyspec_demo, not demo']);
  const changed = `${STUB}\nfunction more(): void {}\n`;
  assert.deepEqual(findings({ ...good(), 'packages/php-ext/src/polyspec_demo.stub.php': changed }), [`packages/php-ext/src/polyspec_demo_arginfo.h: the stub hash is ${stubHash(STUB)}, the stub's is ${stubHash(changed)}. Fix: make php-ext-arginfo`]);
  assert.deepEqual(findings({ ...good(), 'packages/php/composer.json': '{"name": "other/demo"}' }), ['packages/php/composer.json: the PHP library, whose classes the extension registers, is named polyspec/<repository>, not other/demo']);
});

test('a declaration that differs from the library, or that the library lacks, is a finding', () => {
  const method = (returnType: string) => ({ static: false, returnType, parameters: [{ name: 'a', type: 'int' }] });
  const extension = { classes: { 'A\\B': { kind: 'class', methods: { run: method('int') } } }, functions: { 'A\\f': method('int') } };
  assert.deepEqual(declarationFindings(extension, extension), []);
  const library = { classes: { 'A\\B': { kind: 'class', methods: { run: method('string') } } }, functions: { 'A\\f': null } };
  assert.deepEqual(declarationFindings(extension, library), ['class A\\B methods run returnType: extension "int", library "string"', 'function A\\f: the extension registers it, and the PHP library declares none']);
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
  const built = spawnSync(process.execPath, [path.join(ROOT, 'scripts/kit/php-extension.mts'), 'build'], { cwd: root, encoding: 'utf8' });
  assert.equal(built.status, 0, built.stderr);
  const extension = path.join(root, 'var/php-ext/polyspec_demo.so');
  assert.ok(existsSync(extension), 'the library is published');
  assert.equal(execute('php', ['-d', `extension=${extension}`, '-r', 'echo phpversion("polyspec_demo");'], { cwd: root }).stdout, '1.2.3', 'the version of composer.json');
  const script = path.join(ROOT, 'scripts/kit/symbols/php/reflection.php');
  const read = (args: string[]) => {
    const result = execute('php', args, { cwd: root });
    assert.equal(result.status, 0, result.stderr);
    return declarationsOf(result.stdout);
  };
  const registered = read(['-d', `extension=${extension}`, script, 'extension', 'polyspec_demo']);
  assert.deepEqual(Object.keys(registered.classes), ['Polyspec\\Demo\\Counter']);
  assert.deepEqual(Object.keys(registered.functions), ['Polyspec\\Demo\\add']);
  const names = path.join(root, 'var/names.json');
  writeFileSync(names, JSON.stringify({ classes: Object.keys(registered.classes), functions: Object.keys(registered.functions) }));
  const declared = () => read([script, 'library', path.join(root, 'packages/php/autoload.php'), names]);
  assert.deepEqual(declarationFindings(registered, declared()), []);
  put(root, { 'packages/php/src/Demo.php': library('string') });
  assert.deepEqual(declarationFindings(registered, declared()), ['class Polyspec\\Demo\\Counter methods next returnType: extension "int", library "string"']);
});

test('arginfo configures the copy before it makes the header, so make has its Makefile (K290)', (t) => {
  const root = tree(t, { ...good(), 'packages/php/src/Demo.php': library('int') });
  cpSync(path.join(FIXTURE, 'polyspec_demo.c'), path.join(root, 'packages/php-ext/src/polyspec_demo.c'));
  assert.equal(spawnSync('git', ['add', '-A'], { cwd: root }).status, 0);
  const written = spawnSync(process.execPath, [path.join(ROOT, 'scripts/kit/php-extension.mts'), 'arginfo'], { cwd: root, encoding: 'utf8' });
  // gen_stub.php downloads its PHP-Parser, so the run may fail offline; it must not fail for want of a Makefile.
  assert.doesNotMatch(written.stderr, /No rule to make target|No targets specified/, written.stderr);
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
