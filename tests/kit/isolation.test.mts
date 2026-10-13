// kit depends on no repository: the tools import only Node built-ins and files of their own directory, and neither the
// tools nor the tests name another repository. A repository differs from another only in config/*.json.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const REPOSITORY_NAMES = /\b(template|crudui|hyper|ordered-json|orm|limepie)\b/i;

const files = (directory) => readdirSync(path.join(ROOT, directory)).sort().flatMap((entry) => {
  const relative = `${directory}/${entry}`;
  if (relative === 'tests/kit/fixture') return [];
  return statSync(path.join(ROOT, relative)).isDirectory() ? files(relative) : [relative];
});
const tools = files('scripts/kit');
// This file lists the names, so it is the one file the scan skips.
const sources = [...tools, ...files('tests/kit')].filter(file => /\.(mts|json|mk)$/.test(file) && file !== 'tests/kit/isolation.test.mts');

test('a kit tool imports only Node built-ins and files of scripts/kit', () => {
  const modules = tools.filter(name => name.endsWith('.mts'));
  // An empty selection would pass without checking anything, as it did when the tools were renamed (K71-1).
  assert.ok(modules.length > 0, 'the scan found the modules of scripts/kit');
  for (const file of modules) {
    const text = readFileSync(path.join(ROOT, file), 'utf8');
    for (const [, specifier] of text.matchAll(/(?:from|import\()\s*'([^']+)'/g)) {
      const allowed = specifier.startsWith('node:') || (specifier.startsWith('./') && !specifier.slice(2).includes('..'));
      assert.ok(allowed, `${file} imports ${specifier}, which is neither a node: built-in nor a file of its directory`);
    }
  }
});

test('no tool or test of kit names another repository', () => {
  assert.ok(sources.some(file => file.endsWith('.mts')), 'the scan found the modules and tests of kit');
  for (const file of sources) {
    const lines = readFileSync(path.join(ROOT, file), 'utf8').split('\n');
    lines.forEach((line, index) => {
      const hit = REPOSITORY_NAMES.exec(line.replaceAll('github.com/polyspec/kit', ''));
      assert.equal(hit, null, `${file}:${index + 1} names the repository ${hit?.[0]}: ${line.trim()}`);
    });
  }
});
