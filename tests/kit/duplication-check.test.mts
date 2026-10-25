// Tests of scripts/kit/duplication-check.mts: jscpd, a dependency of the package, fails on a piece of code that exists
// twice in the checkout, outside the folders that config/duplication.json excludes with their reasons (K248-3).
import assert from 'node:assert/strict';
import test from 'node:test';
import { duplicationCheck } from '../../scripts/kit/duplication-check.mts';
import { put, tree } from './tree.mts';

// Eight distinct lines, a piece that jscpd reports when it exists twice.
const PIECE = Array.from({ length: 8 }, (_, index) => `export const value${index} = compute(${index}, 'name${index}', [${index}, ${index + 1}]);`).join('\n');

test('a piece of code that exists twice fails with both places, and a tree without one passes (K248-3)', (t) => {
  const root = tree(t, { 'src/a.ts': `${PIECE}\n`, 'src/b.ts': 'export const other = 1;\n' });
  assert.equal(duplicationCheck(root, () => {}).status, 0);
  put(root, { 'src/c.ts': `// another module\n${PIECE}\n` });
  const found = duplicationCheck(root, () => {});
  assert.equal(found.status, 1);
  assert.match(found.output, /src\/a\.ts/);
  assert.match(found.output, /src\/c\.ts/);
});

test('a folder that config/duplication.json excludes with its reason is not read, and an exclusion needs a reason (K248-3)', (t) => {
  const root = tree(t, { 'src/a.ts': `${PIECE}\n`, 'tests/a.test.ts': `${PIECE}\n` });
  assert.equal(duplicationCheck(root, () => {}).status, 1);
  put(root, { 'config/duplication.json': JSON.stringify({ schema: 1, exclude: [{ glob: 'tests/**', reason: 'a test states its case in full' }] }) });
  assert.equal(duplicationCheck(root, () => {}).status, 0);
  put(root, { 'config/duplication.json': JSON.stringify({ schema: 1, exclude: [{ glob: 'tests/**', reason: '' }] }) });
  assert.throws(() => duplicationCheck(root, () => {}), /reason/);
});

// K310: jscpd splits its --ignore value at each comma, so the braces of a glob must not reach it that way.
test('a brace glob of config/duplication.json excludes the files it names, and a file outside it still fails (K310)', (t) => {
  const root = tree(t, { 'src/a.ts': `${PIECE}\n`, 'tests/b.ts': `${PIECE}\n`, 'spec/c.ts': `${PIECE}\n` });
  put(root, { 'config/duplication.json': JSON.stringify({ schema: 1, exclude: [{ glob: '{tests,spec}/**', reason: 'test: a test states its case in full' }] }) });
  assert.equal(duplicationCheck(root, () => {}).status, 0);
  put(root, { 'src/d.ts': `// another module\n${PIECE}\n` });
  const found = duplicationCheck(root, () => {});
  assert.equal(found.status, 1, 'the files outside the braces still duplicate');
  assert.match(found.output, /src\/d\.ts/);
  assert.doesNotMatch(found.output, /tests\/b\.ts|spec\/c\.ts/);
});

// Lines that carry no logic, the file header of each format (K287): the declarations and imports that jscpd's own ignore-pattern
// skips. Each case: two files that share only a header pass, and two files that share a 6-line body still fail, so a pattern
// that matched more than the header would show here.
const COUNT = 60;
const lines = (count: number, line: (index: number) => string) => Array.from({ length: count }, (_, index) => line(index));
const HEADERS: Record<string, { extension: string; header: string[]; statement: (prefix: string, index: number) => string }> = {
  php: { extension: 'php', header: ['<?php', 'declare(strict_types=1);', 'namespace Acme\\Rules;', ...lines(COUNT, i => `use Acme\\Expr\\Field${i};`)], statement: (p, i) => `$${p}${i} = compute(${i}, 'name${i}', [${i}, ${i + 1}]);` },
  ts: { extension: 'ts', header: [...lines(COUNT, i => `import { member${i} } from './module${i}.ts';`), "import {", '  first,', '  second,', "} from './many.ts';", "import './effect.ts';"], statement: (p, i) => `export const ${p}${i} = compute(${i}, 'name${i}', [${i}, ${i + 1}]);` },
  go: { extension: 'go', header: ['package acme', '', 'import (', ...lines(COUNT, i => `\t"example.com/acme/pkg${i}"`), ')'], statement: (p, i) => `${p}${i} := compute(${i}, "name${i}", []int{${i}, ${i + 1}})` },
  'go-single': { extension: 'go', header: ['package acme', '', ...lines(COUNT, i => `import "example.com/acme/pkg${i}"`)], statement: (p, i) => `${p}${i} := compute(${i}, "name${i}", []int{${i}, ${i + 1}})` },
  python: { extension: 'py', header: [...lines(COUNT, i => `import acme.module${i}`), 'from acme.names import (', '    first,', '    second,', ')', 'from acme.other import third'], statement: (p, i) => `${p}${i} = compute(${i}, 'name${i}', [${i}, ${i + 1}])` },
  rust: { extension: 'rs', header: [...lines(COUNT, i => `use acme::module${i}::Member${i};`), 'use acme::{', '    first,', '    second,', '};'], statement: (p, i) => `let ${p}${i} = compute(${i}, "name${i}", [${i}, ${i + 1}]);` },
  c: { extension: 'c', header: lines(COUNT, i => `#include <acme/header${i}.h>`), statement: (p, i) => `int ${p}${i} = compute(${i}, "name${i}", ${i + 1});` },
};
for (const [name, { extension, header, statement }] of Object.entries(HEADERS)) {
  test(`${name}: two files that share only a header pass, two that share a 6-line body fail (K287)`, (t) => {
    const file = (body: string) => `${header.join('\n')}\n${body}\n`;
    const own = (prefix: string) => lines(8, i => statement(prefix, i)).join('\n');
    const root = tree(t, { [`src/a.${extension}`]: file(own('alpha')), [`src/b.${extension}`]: file(own('beta')) });
    const headerOnly = duplicationCheck(root, () => {});
    assert.equal(headerOnly.status, 0, headerOnly.output);
    put(root, { [`src/c.${extension}`]: file(own('alpha')) });
    const body = duplicationCheck(root, () => {});
    assert.equal(body.status, 1, body.output);
    assert.match(body.output, new RegExp(`src/a\\.${extension}`));
  });
}

// K366: the stub of a PHP extension declares the classes of the PHP library under the same names and signatures (S10), so the check
// leaves out the stub by its path, and a clone inside the library still fails.
test('the S10 stub of a PHP extension is left out of the duplication check, and a clone inside the library is not (K366)', (t) => {
  const greeter = [
    '<?php',
    'final class Greeter',
    '{',
    ...Array.from({ length: 8 }, (_, index) => `    public const NAME${index} = 'name${index}';`),
    '}',
    '',
  ].join('\n');
  const root = tree(t, { 'packages/php/src/Greeter.php': greeter, 'packages/php-ext/src/polyspec_fixture.stub.php': greeter });
  assert.equal(duplicationCheck(root, () => {}).status, 0, 'a stub that mirrors a library class is no finding');
  put(root, { 'packages/php/src/Other.php': greeter });
  const found = duplicationCheck(root, () => {});
  assert.equal(found.status, 1, found.output);
  assert.match(found.output, /packages\/php\/src\/Greeter\.php/);
  assert.match(found.output, /packages\/php\/src\/Other\.php/);
  assert.doesNotMatch(found.output, /polyspec_fixture/);
});

// K640: a generated file repeats what its generator writes for each model; config/generated.json declares it, and no second list does.
test('a file that config/generated.json declares generated is left out of the duplication check, and a clone outside it is not (K640)', (t) => {
  const root = tree(t, { 'src/a.ts': `${PIECE}\n`, 'src/model.ts': `// Code generated by orm-gen; DO NOT EDIT.\n${PIECE}\n`, 'out/b.ts': `${PIECE}\n` });
  assert.equal(duplicationCheck(root, () => {}).status, 1);
  put(root, { 'config/generated.json': JSON.stringify({ schema: 1, paths: ['out/**'], exceptions: ['src/model.ts'] }) });
  assert.equal(duplicationCheck(root, () => {}).status, 0);
  put(root, { 'src/c.ts': `// another module\n${PIECE}\n` });
  assert.equal(duplicationCheck(root, () => {}).status, 1);
});
