// The npm package of kit (K55): every release tag vX.Y.Z publishes polyspec-kit-npm-<version>.tgz, the package @polyspec/kit at
// the root of the repository, through kit's own release form (config/release.json). A consumer imports a module of scripts/kit
// through the exports map: `import { makeVenv } from '@polyspec/kit/python-venv.mjs'`. The real npm packs the checkout, and the
// archive installs in the committed consumer project (tests/release-consumer/npm) with its smoke command, as release-proof
// installs the archive of the release. Nothing reaches a registry: the package has no dependency.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { archiveName, context, coverage, loadConfig } from '../../scripts/kit/release.mjs';
import { installConsumers } from '../../scripts/kit/release-consumer.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const KIT = path.join(ROOT, 'scripts/kit');
const json = file => JSON.parse(readFileSync(path.join(ROOT, file), 'utf8'));
const manifest = () => json('package.json');

test('config/release.json releases @polyspec/kit from the root and classifies every package file', () => {
  const config = loadConfig(ROOT);
  assert.deepEqual(config.packages, [{ kind: 'npm', directory: '.', name: '@polyspec/kit' }]);
  assert.deepEqual(config.manifests, { 'package.json': 'archive' });
  assert.deepEqual(config.checks, ['kit'], 'the check of the ci workflow, its job kit');
  assert.equal(archiveName('npm', '@polyspec/kit', '0.0.26'), 'polyspec-kit-npm-0.0.26.tgz');
  assert.deepEqual(coverage(context(ROOT, { config })), []);
});

test('package.json holds scripts/kit, maps ./*.mjs to its modules and has the version of kit.json', () => {
  const { name, version, files, exports, ...rest } = manifest();
  assert.equal(name, '@polyspec/kit');
  assert.equal(version, json('kit.json').version, 'package.json and kit.json hold one version');
  assert.deepEqual(files, ['scripts/kit/']);
  assert.deepEqual(exports, { './*.mjs': './scripts/kit/*.mjs', './package.json': './package.json' });
  assert.deepEqual(Object.keys(rest).sort(), ['description', 'packageManager', 'repository'], 'no dependency and no script');
});

test('the release workflow of kit is the workflow that kit vendors', () => {
  assert.equal(readFileSync(path.join(ROOT, '.github/workflows/release.yml'), 'utf8'), readFileSync(path.join(ROOT, 'workflows/release.yml'), 'utf8'));
});

// The import statements of a module: `import ... from '...'` (one line or several), `import '...'` and `export ... from '...'` at the
// start of a line, and every import() or require( of the text.
const STATEMENTS = /^(?:import\s*(['"])([^'"]+)\1|(?:import|export)\b[^;'"]*?\bfrom\s*(['"])([^'"]+)\3)/gm;
const DYNAMIC = /\bimport\s*\(|\brequire\s*\(/g;
// The one import() of the modules: the run-tests preload imports the test file that node --test runs, which is no module of the package.
const PRELOAD = { file: 'test-load-check.mjs', text: 'import(pathToFileURL(file).href)' };

test('every module of scripts/kit imports only Node built-ins and files of scripts/kit', () => {
  const found = [];
  for (const name of readdirSync(KIT).filter(file => file.endsWith('.mjs')).sort()) {
    const text = readFileSync(path.join(KIT, name), 'utf8');
    for (const [, , bare, , bound] of text.matchAll(STATEMENTS)) {
      const specifier = bare ?? bound;
      const local = /^\.\/[A-Za-z0-9._-]+\.mjs$/.test(specifier) && existsSync(path.join(KIT, specifier));
      if (!specifier.startsWith('node:') && !local) found.push(`${name}: ${specifier}`);
    }
    for (const match of text.matchAll(DYNAMIC)) {
      if (name === PRELOAD.file && text.startsWith(PRELOAD.text, match.index)) continue;
      found.push(`${name}: ${text.slice(match.index, text.indexOf('\n', match.index))}`);
    }
  }
  assert.deepEqual(found, [], 'imports that are neither node: built-ins nor files of scripts/kit');
});

test('npm packs the checkout, the archive installs in the consumer project and every module imports through the package', (t) => {
  const folder = mkdtempSync(path.join(tmpdir(), 'kit-npm-package-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const assets = path.join(folder, 'assets');
  const env = { ...process.env, npm_config_cache: path.join(folder, 'npm-cache'), npm_config_offline: 'true' };
  const packed = spawnSync('npm', ['pack', '--pack-destination', folder, '--json'], { cwd: ROOT, env, encoding: 'utf8' });
  assert.equal(packed.status, 0, packed.stderr);
  const [{ filename, files }] = JSON.parse(packed.stdout);
  const listed = files.map(({ path: file }) => file).sort();
  const modules = readdirSync(KIT, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile()).map(entry => path.relative(ROOT, path.join(entry.parentPath, entry.name)));
  assert.deepEqual(listed.filter(file => file.startsWith('scripts/kit/')), modules.sort(), 'the archive holds every file of scripts/kit');
  assert.deepEqual(listed.filter(file => !file.startsWith('scripts/kit/')), ['README.ko.md', 'README.md', 'package.json'], 'and nothing else but the manifest and the READMEs, which npm always packs');
  const { name: packageName, version } = manifest();
  const name = archiveName('npm', packageName, version);
  mkdirSync(assets);
  renameSync(path.join(folder, filename), path.join(assets, name));
  const steps = [];
  const count = installConsumers(context(ROOT, { env: process.env }), version, assets, text => steps.push(text));
  assert.equal(count, 1);
  assert.deepEqual(steps, ['npm ci of 1 packages from tests/release-consumer/npm', `npm @polyspec/kit ${version}: ${loadConfig(ROOT).consumers.npm.smoke['@polyspec/kit'].join(' ')}`]);
}, { timeout: 300000 });
