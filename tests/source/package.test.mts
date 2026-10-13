// kit as the npm package @polyspec/kit (K71-2): make build emits the tools of scripts/kit as JavaScript into dist/ with
// kit.mk and the schemas, npm pack packs exactly the declared files, and a repository that installs the tarball imports
// the exported module and runs a tool from dist with the result of the source. The checks run on a copy of the checkout,
// so neither the build nor the pack writes into this checkout.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { builtCopy, run, walk } from './checkout.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('make build emits every tool of scripts/kit into dist as .mjs with .mjs imports, with kit.mk and the schemas', (t) => {
  const copy = builtCopy(t);
  const sources = walk(path.join(ROOT, 'scripts/kit')).filter(file => file.endsWith('.mts'));
  assert.ok(sources.length > 50, `scripts/kit holds ${sources.length} modules`);
  const built = walk(path.join(copy, 'dist'));
  for (const source of sources) assert.ok(built.includes(source.replace(/\.mts$/, '.mjs')), `dist lacks ${source.replace(/\.mts$/, '.mjs')}`);
  for (const file of built.filter(name => name.endsWith('.mjs'))) {
    assert.doesNotMatch(readFileSync(path.join(copy, 'dist', file), 'utf8'), /from '\.{1,2}\/[^']*\.mts'|import\('\.{1,2}\/[^']*\.mts'\)/, `${file} imports a .mts file`);
  }
  assert.equal(readFileSync(path.join(copy, 'dist/kit.mk'), 'utf8'), readFileSync(path.join(ROOT, 'scripts/kit/kit.mk'), 'utf8'));
  const schemas = walk(path.join(ROOT, 'scripts/kit/schema'));
  assert.ok(schemas.length > 0);
  for (const schema of schemas) assert.equal(readFileSync(path.join(copy, 'dist/schema', schema), 'utf8'), readFileSync(path.join(ROOT, 'scripts/kit/schema', schema), 'utf8'), `dist/schema/${schema}`);
});

test('npm pack packs exactly the files of package.json files and the files npm always packs', (t) => {
  const copy = builtCopy(t);
  const manifest = JSON.parse(readFileSync(path.join(copy, 'package.json'), 'utf8'));
  assert.ok(Array.isArray(manifest.files), 'package.json declares files');
  const declared = (manifest.files as string[]).flatMap(entry => {
    const target = path.join(copy, entry);
    return readdirSync(path.dirname(target)).includes(path.basename(target)) && !entry.endsWith('/') ? [entry] : walk(target).map(file => path.posix.join(entry, file));
  });
  // npm adds the manifest and every README* and LICENSE* file of the package root whatever files says.
  const expected = [...new Set([...declared, 'package.json', 'README.md', 'README.ko.md', 'LICENSE'])].sort();
  const [packed] = JSON.parse(run('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], copy));
  assert.deepEqual(packed.files.map((file: { path: string }) => file.path).sort(), expected);
});

test('a repository that installs the tarball imports @polyspec/kit/tracked-files and runs check-documents from dist as from the source', (t) => {
  const copy = builtCopy(t);
  const packs = mkdtempSync(path.join(tmpdir(), 'kit-pack-'));
  t.after(() => rmSync(packs, { recursive: true, force: true }));
  const [packed] = JSON.parse(run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', packs], copy));
  const consumer = path.join(packs, 'consumer');
  const installed = path.join(consumer, 'node_modules/@polyspec/kit');
  mkdirSync(installed, { recursive: true });
  run('tar', ['-xzf', path.join(packs, packed.filename), '-C', installed, '--strip-components=1'], packs);
  writeFileSync(path.join(consumer, 'package.json'), JSON.stringify({ name: 'consumer', private: true, type: 'module' }));
  const exported = run(process.execPath, ['--input-type=module', '-e', "const m = await import('@polyspec/kit/tracked-files'); process.stdout.write(JSON.stringify([import.meta.resolve('@polyspec/kit/tracked-files'), Object.keys(m).sort()]));"], consumer);
  const [resolved, names] = JSON.parse(exported);
  assert.equal(realpathSync(fileURLToPath(resolved)), realpathSync(path.join(installed, 'dist/tracked-files.mjs')));
  const source = run(process.execPath, ['--input-type=module', '-e', `const m = await import(${JSON.stringify(path.join(ROOT, 'scripts/kit/tracked-files.mts'))}); process.stdout.write(JSON.stringify(Object.keys(m).sort()));`], ROOT);
  assert.deepEqual(names, JSON.parse(source));
  const fromDist = spawnSync(process.execPath, [path.join(installed, 'dist/check-documents.mjs')], { cwd: ROOT, encoding: 'utf8' });
  const fromSource = spawnSync(process.execPath, [path.join(ROOT, 'scripts/kit/check-documents.mts')], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(fromSource.status, 0, fromSource.stderr);
  assert.deepEqual({ status: fromDist.status, stdout: fromDist.stdout, stderr: fromDist.stderr }, { status: fromSource.status, stdout: fromSource.stdout, stderr: fromSource.stderr });
});
