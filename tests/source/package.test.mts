// kit as the npm package @polyspec/kit (K71-2): make build emits the tools of scripts/kit as JavaScript into dist/ with
// kit.mk, the schemas and the symbol extractors, npm pack packs exactly the declared files, and a repository that installs the tarball imports
// the exported module and runs a tool from dist with the result of the source. The checks run on a copy of the checkout,
// so neither the build nor the pack writes into this checkout.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { builtCopy, installedLockEntries, kitConsumer, NPM, packedKit, primeCache, run, runtimePackage, walk } from './checkout.mts';

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
  // The symbol extractors of parity are programs of their ecosystems, which dist/parity-symbols.mjs runs from dist/symbols.
  const extractors = walk(path.join(ROOT, 'scripts/kit/symbols'));
  assert.ok(extractors.length > 0);
  for (const extractor of extractors) assert.equal(readFileSync(path.join(copy, 'dist/symbols', extractor), 'utf8'), readFileSync(path.join(ROOT, 'scripts/kit/symbols', extractor), 'utf8'), `dist/symbols/${extractor}`);
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
  const packed = packedKit(run(NPM, ['pack', '--dry-run', '--json', '--ignore-scripts'], copy));
  assert.deepEqual(packed.files.map(file => file.path).sort(), expected);
});

// The tool APIs of kit that a repository imports; generic needs (globs, schemas, processes) come from their ecosystem
// libraries, not from kit's internals.
const EXPORTED = ['tracked-files', 'test-hooks', 'test-progress', 'run-tests', 'holder-lock'];
// install-vscode needs its optional peer @vscode/test-electron, which only a repository with VS Code integration tests
// installs: the export resolves, and without the peer the import fails naming it.
const PEER_EXPORTED = { 'install-vscode': '@vscode/test-electron' };

test('a repository that installs the tarball imports the tool APIs of @polyspec/kit and runs check-documents from dist as from the source', (t) => {
  const copy = builtCopy(t);
  const packs = mkdtempSync(path.join(tmpdir(), 'kit-pack-'));
  t.after(() => rmSync(packs, { recursive: true, force: true }));
  const packed = packedKit(run(NPM, ['pack', '--json', '--ignore-scripts', '--pack-destination', packs], copy));
  // The consumer installs the tarball and the packages that kit depends on at run time with npm ci, offline, from a cache
  // primed with the tarball and with those packages, as a repository installs them (consumer-layout.test runs the bootstrap).
  const cache = path.join(packs, 'npm-cache');
  run(NPM, ['cache', 'add', path.join(packs, packed.filename), '--cache', cache], packs);
  primeCache(cache, packs, installedLockEntries(runtimePackage));
  const consumer = path.join(packs, 'consumer');
  mkdirSync(consumer);
  const { manifest, lock } = kitConsumer(packed, { type: 'module' });
  writeFileSync(path.join(consumer, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(path.join(consumer, 'package-lock.json'), `${JSON.stringify(lock, null, 2)}\n`);
  run(NPM, ['ci', '--offline', '--cache', cache, '--allow-remote=root', '--ignore-scripts', '--no-audit', '--no-fund'], consumer);
  const installed = path.join(consumer, 'node_modules/@polyspec/kit');
  // The consumer installs the packages; it links none of kit's (AGENTS: this repository creates no symbolic link).
  for (const [entry] of installedLockEntries(runtimePackage)) assert.ok(!lstatSync(path.join(consumer, entry)).isSymbolicLink(), `${entry} of the consumer is a link`);
  // The modules that repositories import from kit (K79): each resolves to its dist file and exports what the source does.
  for (const module of EXPORTED) {
    const exported = run(process.execPath, ['--input-type=module', '-e', `const m = await import('@polyspec/kit/${module}'); process.stdout.write(JSON.stringify([import.meta.resolve('@polyspec/kit/${module}'), Object.keys(m).sort()]));`], consumer);
    const [resolved, names] = JSON.parse(exported);
    assert.equal(realpathSync(fileURLToPath(resolved)), realpathSync(path.join(installed, `dist/${module}.mjs`)), module);
    const source = run(process.execPath, ['--input-type=module', '-e', `const m = await import(${JSON.stringify(path.join(ROOT, `scripts/kit/${module}.mts`))}); process.stdout.write(JSON.stringify(Object.keys(m).sort()));`], ROOT);
    assert.deepEqual(names, JSON.parse(source), module);
  }
  for (const [module, peer] of Object.entries(PEER_EXPORTED)) {
    const resolved = run(process.execPath, ['--input-type=module', '-e', `process.stdout.write(import.meta.resolve('@polyspec/kit/${module}'))`], consumer);
    assert.equal(realpathSync(fileURLToPath(resolved)), realpathSync(path.join(installed, `dist/${module}.mjs`)), module);
    const imported = spawnSync(process.execPath, ['--input-type=module', '-e', `await import('@polyspec/kit/${module}')`], { cwd: consumer, encoding: 'utf8' });
    assert.notEqual(imported.status, 0, `${module} imports without its peer ${peer}`);
    assert.match(imported.stderr, new RegExp(peer.replace('/', '\\/')), module);
  }
  const fromDist = spawnSync(process.execPath, [path.join(installed, 'dist/check-documents.mjs')], { cwd: ROOT, encoding: 'utf8' });
  const fromSource = spawnSync(process.execPath, [path.join(ROOT, 'scripts/kit/check-documents.mts')], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(fromSource.status, 0, fromSource.stderr);
  assert.deepEqual({ status: fromDist.status, stdout: fromDist.stdout, stderr: fromDist.stderr }, { status: fromSource.status, stdout: fromSource.stdout, stderr: fromSource.stderr });
});
