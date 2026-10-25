// K613: a consumer runs the kit sources through its link. Its node_modules/@polyspec/kit is a plain symbolic link to the kit
// checkout (K591), so Node follows it to the real path of a source outside node_modules and strips the types there; a change of a
// source reaches the consumer at once, with no build. An installed copy of a .mts module stays under node_modules, where Node
// refuses to strip types, which is why a release packs dist (prepack) and development never reads it.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const NODE = process.execPath;

/** A consumer folder, removed with `t.after`, whose node_modules/@polyspec/kit is `install` (a link to `target`, or a copy it writes). */
function consumer(t: TestContext): string {
  const root = mkdtempSync(path.join(tmpdir(), 'kit-linked-sources-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'node_modules/@polyspec'), { recursive: true });
  writeFileSync(path.join(root, 'package.json'), '{"name":"consumer","private":true,"type":"module"}\n');
  return root;
}

/** Runs `source` as an ES module in `cwd` with the node of this test. */
const run = (cwd: string, source: string) => spawnSync(NODE, ['--input-type=module', '-e', source], { cwd, encoding: 'utf8' });

test('every export of the package resolves through the link to its source in scripts/kit', (t) => {
  const root = consumer(t);
  symlinkSync(ROOT, path.join(root, 'node_modules/@polyspec/kit'), 'dir');
  const manifest = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { exports: Record<string, unknown> };
  const subpaths = Object.keys(manifest.exports).filter(subpath => subpath !== './package.json');
  assert.ok(subpaths.length > 0, 'the package exports its modules');
  for (const subpath of subpaths) {
    const specifier = `@polyspec/kit/${subpath.slice(2)}`;
    const resolved = run(root, `process.stdout.write(import.meta.resolve(${JSON.stringify(specifier)}))`);
    assert.equal(resolved.status, 0, `${specifier}: ${resolved.stderr}`);
    const file = realpathSync(fileURLToPath(resolved.stdout));
    assert.equal(file, realpathSync(path.join(ROOT, 'scripts/kit', `${subpath.slice(2)}.mts`)), `${specifier} resolves to its source`);
  }
});

test('a change of a source reaches a linked consumer at once, with no build', (t) => {
  const kit = mkdtempSync(path.join(tmpdir(), 'kit-linked-package-'));
  t.after(() => rmSync(kit, { recursive: true, force: true }));
  mkdirSync(path.join(kit, 'scripts/kit'), { recursive: true });
  writeFileSync(path.join(kit, 'package.json'), JSON.stringify({ name: '@polyspec/kit', type: 'module', exports: { './value': './scripts/kit/value.mts' } }));
  const source = path.join(kit, 'scripts/kit/value.mts');
  const root = consumer(t);
  symlinkSync(kit, path.join(root, 'node_modules/@polyspec/kit'), 'dir');
  const read = () => run(root, "import { value } from '@polyspec/kit/value'; process.stdout.write(value)");
  writeFileSync(source, "export const value: string = 'old';\n");
  assert.equal(read().stdout, 'old');
  writeFileSync(source, "export const value: string = 'new';\n");
  const changed = read();
  assert.equal(changed.status, 0, changed.stderr);
  assert.equal(changed.stdout, 'new', 'the consumer runs the changed source');
});

test('an installed copy of a .mts module is refused, since Node strips no types under node_modules', (t) => {
  const root = consumer(t);
  const copy = path.join(root, 'node_modules/@polyspec/kit');
  mkdirSync(path.join(copy, 'scripts/kit'), { recursive: true });
  writeFileSync(path.join(copy, 'package.json'), JSON.stringify({ name: '@polyspec/kit', type: 'module', exports: { './value': './scripts/kit/value.mts' } }));
  writeFileSync(path.join(copy, 'scripts/kit/value.mts'), "export const value: string = 'copy';\n");
  const refused = run(root, "import { value } from '@polyspec/kit/value'; process.stdout.write(value)");
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING/);
});

test('the Claude hook of a consumer runs the claude-hook source of its linked kit', () => {
  const settings = readFileSync(path.join(ROOT, 'claude/settings.json'), 'utf8');
  assert.match(settings, /node_modules\/@polyspec\/kit\/scripts\/kit\/claude-hook\.mts/);
  assert.doesNotMatch(settings, /dist\/claude-hook/);
});
