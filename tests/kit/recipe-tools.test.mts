// A recipe starts a tool of the checkout by its absolute path (K171): make 3.81 looks up a recipe line without shell syntax on
// the PATH that make started with, so a bare `node` in kit.mk ran the node of the machine. The check reads the recipes from
// the database of make.
import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { makeDatabase } from '../../scripts/kit/owner-check.mts';
import { bareToolFindings, commandWords } from '../../scripts/kit/recipe-tools.mts';
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
