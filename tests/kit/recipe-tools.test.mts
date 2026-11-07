// The words of a recipe line by the quoting rules of the POSIX shell (K179, K184, K984, K563), which the hook, the rules check,
// land and the owner check read; kit judges no recipe with them (K1051).
import assert from 'node:assert/strict';
import test from 'node:test';
import { commandParts } from '../../scripts/kit/recipe-tools.mts';

test('a recipe line splits into its command parts at the control operators, with its prefixes and assignments', () => {
  assert.deepEqual(commandParts('@$(ONLINE) FOO=1 node a.mts && go test ./... | tee log; { npm ci; }'), [['@$(ONLINE)', 'FOO=1', 'node', 'a.mts'], ['go', 'test', './...'], ['tee', 'log'], ['{', 'npm', 'ci'], ['}']]);
  assert.deepEqual(commandParts('-$(NODE) a.mts'), [['-$(NODE)', 'a.mts']]);
});

test('an operator or a blank inside quotes is text of a word, and the quotes are removed (K179)', () => {
  assert.deepEqual(commandParts('@echo "build-ts|go|node" && echo \'a; npm\' | node x'), [['@echo', 'build-ts|go|node'], ['echo', 'a; npm'], ['node', 'x']]);
  assert.deepEqual(commandParts('foo | node x'), [['foo'], ['node', 'x']]);
  assert.deepEqual(commandParts('FOO="a b" "node" a\\|b; echo "\\"|go"'), [['FOO=a b', 'node', 'a|b'], ['echo', '"|go']]);
  assert.deepEqual(commandParts('$(NODE) "$(NPM) | x"'), [['$(NODE)', '$(NPM) | x']]);
});

test('a recipe line that already names the placeholder of a make reference fails instead of losing the word (K187)', () => {
  assert.throws(() => commandParts('${KIT_MAKE_REFERENCE_7} a.mts'), /recipe line `\$\{KIT_MAKE_REFERENCE_7\} a\.mts` already contains KIT_MAKE_REFERENCE_, the placeholder that recipe-tools puts in place of a make reference/);
});

// K984: the file descriptor number written against a redirection is no word; a number parted from it by a blank is one.
test('the file descriptor number of a redirection is no word of the command (K984)', () => {
  assert.deepEqual(commandParts('node --test a.mts 2>&1 | grep x'), [['node', '--test', 'a.mts'], ['grep', 'x']]);
  assert.deepEqual(commandParts('echo 2 > f'), [['echo', '2']]);
  assert.deepEqual(commandParts('echo a\\ 2>f'), [['echo', 'a 2']]);
  assert.deepEqual(commandParts('echo "a\\" 2>x" 3>y'), [['echo', 'a" 2>x']]);
});

test('POSIX parameter expansions are restored as their original shell tokens (K563)', () => {
  assert.deepEqual(commandParts('out=${1:?usage: build.sh <output>}'), [['out=${1:?usage: build.sh <output>}']]);
  assert.deepEqual(commandParts('echo "${X:-${Y:-a b}}"'), [['echo', '${X:-${Y:-a b}}']]);
  assert.deepEqual(commandParts('echo \\${X:-a}'), [['echo', '${X:-a}']]);
  assert.deepEqual(commandParts('echo "${KIT_SHELL_PARAMETER_0:-${Y:-ok}}" KIT_SHELL_PARAMETER_1'), [['echo', '${KIT_SHELL_PARAMETER_0:-${Y:-ok}}', 'KIT_SHELL_PARAMETER_1']]);
});
