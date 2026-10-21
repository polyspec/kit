// A recipe starts a tool of the checkout by its absolute path (K171): make 3.81 looks up a recipe line without shell syntax on
// the PATH that make started with, so a bare `node` in kit.mk ran the node of the machine. The check reads the recipes from
// the database of make.
import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { makeDatabase } from '../../scripts/kit/owner-check.mts';
import { bareToolFindings, commandWords, testRunnerFindings } from '../../scripts/kit/recipe-tools.mts';
import { tree } from './tree.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('every command of a recipe line counts, after its prefixes, $(ONLINE) and its variable assignments', () => {
  assert.deepEqual(commandWords('@$(ONLINE) FOO=1 node a.mts && go test ./... | tee log; { npm ci; }'), ['node', 'go', 'tee', 'npm']);
  assert.deepEqual(commandWords('-$(NODE) a.mts'), ['$(NODE)']);
});

test('an operator or a blank inside quotes is text of a word, and the quotes are removed (K179)', () => {
  assert.deepEqual(commandWords('@echo "build-ts|go|node" && echo \'a; npm\' | node x'), ['echo', 'echo', 'node']);
  assert.deepEqual(commandWords('foo | node x'), ['foo', 'node']);
  assert.deepEqual(commandWords('FOO="a b" "node" a\\|b; echo "\\"|go"'), ['node', 'echo']);
  assert.deepEqual(commandWords('$(NODE) "$(NPM) | x"'), ['$(NODE)']);
});

test('a recipe line that already names the placeholder of a make reference fails instead of losing the word (K187)', () => {
  assert.throws(() => commandWords('${KIT_MAKE_REFERENCE_7} a.mts'), /recipe line `\$\{KIT_MAKE_REFERENCE_7\} a\.mts` already contains KIT_MAKE_REFERENCE_, the placeholder that recipe-tools puts in place of a make reference/);
});

test('a recipe that starts a tool of the checkout by its bare name is a finding; an absolute path and a machine tool are not', (t) => {
  const root = tree(t, { Makefile: 'NODE := $(CURDIR)/var/tools/bin/node\nbare:\n\tnode a.mts\n\t@$(ONLINE) npm ci && uv sync\nfine:\n\t$(NODE) a.mts\n\tgit status\n\t@echo "build-ts|go|node"\n' });
  const findings = bareToolFindings(makeDatabase(root));
  assert.equal(findings.length, 3, findings.join('\n'));
  assert.match(findings[0] ?? '', /^make target bare starts node by its bare name: `node a\.mts`; .* Fix: start it by its absolute path, such as \$\(NODE\) of kit\.mk for node$/);
  assert.ok(findings.every(finding => finding.startsWith('make target bare ')), findings.join('\n'));
});

test('no recipe of kit (its Makefile with kit.mk) starts a tool of the checkout by its bare name', () => {
  assert.deepEqual(bareToolFindings(makeDatabase(ROOT)), []);
});

test('a recipe that starts PHPUnit outside run-tests is a finding, also through a variable; run-tests and an echo are not (K436)', (t) => {
  const makefile = [
    'RUN_TESTS = $(NODE) node_modules/@polyspec/kit/dist/run-tests.mjs',
    'PHP_EXTENSION_TESTS = php -d extension=x.so vendor-php/bin/phpunit --configuration a.xml',
    'direct:',
    '\t$(PHP_EXTENSION_TESTS) tests/ModelTest.php',
    '\t@test -f env && vendor/bin/phpunit t.php',
    '\t/opt/homebrew/opt/php@8.4/bin/php8.4 vendor/bin/phpunit t.php',
    'fine:',
    '\t$(RUN_TESTS) phpunit --php-extension x.so -- --configuration a.xml tests/ModelTest.php',
    '\t@echo run phpunit',
    '\tphp -r "echo 1;"',
    '',
  ].join('\n');
  const findings = testRunnerFindings(makeDatabase(tree(t, { Makefile: makefile })));
  assert.equal(findings.length, 3, findings.join('\n'));
  assert.ok(findings.every(finding => finding.startsWith('make target direct starts PHPUnit outside run-tests: ')), findings.join('\n'));
  assert.match(findings[0] ?? '', /`\$\(PHP_EXTENSION_TESTS\) tests\/ModelTest\.php`; a test that hangs there has no time limit\. Fix: run it as \$\(RUN_TESTS\) phpunit \[--php-extension <file>\] -- <arguments>, which stops a test at its timeout$/);
});

test('no recipe of kit (its Makefile with kit.mk) starts PHPUnit outside run-tests (K436)', () => {
  assert.deepEqual(testRunnerFindings(makeDatabase(ROOT)), []);
});
