// A repository that consumes kit as the package @polyspec/kit (K71-2) beside a kit checkout (K614). kit is built and packed with the
// prepack and postpack of the release, an npm cache is primed with the tarball, and a sandbox consumer, a Git repository beside the
// kit checkout ../kit whose package-lock pins the release asset of the tarball by its integrity, runs the bootstrap steps of its
// release workflow offline (make install-tools TOOLS=npm with the installer of ../kit, then make install-packages), then the gate
// targets, which run the sources of ../kit (K613). The consumer holds the copies of kit.copies, which it takes from the tarball.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { builtCopy, commitSandbox, installedLockEntries, kitConsumer, NPM, packedKit, primeCache, run, runtimePackage } from './checkout.mts';
import { readFixture } from '../kit/json-fixture.mts';
import type { NpmManifest } from '../../scripts/kit/manifests.mts';
import type { ReleaseConfig } from '../../scripts/kit/release.mts';
import { declaredMiseTools } from '../../scripts/kit/toolchain-mise.mts';
import { parse, stringify } from 'smol-toml';
import { known } from '../kit/known.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const KIT = readFixture<NpmManifest>(ROOT, 'package.json');
// The Node.js of mise.toml of kit, which the consumer declares too (K171).
const NODE = known(declaredMiseTools(ROOT).node, 'the node of mise.toml').version;
// The packages that kit depends on at run time that this machine installed, which the consumer installs from the primed
// cache. The lint tools (K77) are among them, since a consumer runs them through make lint-ts.
const DEPENDENCIES = installedLockEntries(runtimePackage);

test('a consumer installs the packed kit offline and runs the bootstrap order and the gate targets', { timeout: 10 * 60_000 }, (t) => {
  assert.ok(existsSync(NPM), `${path.relative(ROOT, NPM)} is missing; make install-tools TOOLS=npm installs the npm of packageManager`);
  const copy = builtCopy(t);
  const work = mkdtempSync(path.join(tmpdir(), 'kit-consumer-'));
  t.after(() => rmSync(work, { recursive: true, force: true }));
  // The tarball of kit and an npm cache that holds it, so the install reads no registry and no release.
  const packed = packedKit(run(NPM, ['pack', '--json', '--foreground-scripts=false', '--pack-destination', work], copy));
  const tarball = path.join(work, packed.filename);
  const cache = path.join(work, 'npm-cache');
  run(NPM, ['cache', 'add', tarball, '--cache', cache], work);
  primeCache(cache, work, DEPENDENCIES);
  const unpacked = path.join(work, 'unpacked');
  mkdirSync(unpacked);
  run('tar', ['-xzf', tarball, '-C', unpacked, '--strip-components=1'], work);

  // The consumer beside the kit checkout ../kit: the copies of kit.copies from the tarball, the release workflow of kit as its own,
  // a Makefile that includes the kit-bootstrap.mk of ../kit, and a lock that pins the release asset of kit by its integrity.
  symlinkSync(copy, path.join(work, 'kit'));
  const consumer = path.join(work, 'consumer');
  mkdirSync(path.join(consumer, '.github/workflows'), { recursive: true });
  cpSync(path.join(ROOT, 'workflows/release.yml'), path.join(consumer, '.github/workflows/release.yml'));
  const copies = KIT.kit?.copies;
  assert.ok(copies, 'package.json of kit declares no kit.copies');
  for (const [file, from] of Object.entries(copies)) {
    mkdirSync(path.dirname(path.join(consumer, file)), { recursive: true });
    cpSync(path.join(unpacked, from), path.join(consumer, file));
  }
  const { manifest, lock } = kitConsumer(packed, { packageManager: KIT.packageManager, engines: { node: `>=${NODE}` } });
  writeFileSync(path.join(consumer, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(path.join(consumer, 'package-lock.json'), `${JSON.stringify(lock, null, 2)}\n`);
  // The consumer declares the node of kit in mise.toml, and its mise.lock pins it as the mise.lock of kit does (K171).
  writeFileSync(path.join(consumer, 'mise.toml'), `[tools]\nnode = "${NODE}"\n`);
  const kitLock = parse(readFileSync(path.join(ROOT, 'mise.lock'), 'utf8'));
  const tools = kitLock.tools;
  assert.ok(typeof tools === 'object' && tools !== null && 'node' in tools, 'the mise.lock of kit pins no node');
  writeFileSync(path.join(consumer, 'mise.lock'), stringify({ lockfile_version: kitLock.lockfile_version, tools: { node: tools.node } }));
  // The bootstrap installs the mise that config/toolchain.json declares, then the node of mise.toml with it; the consumer
  // declares the mise of kit.
  const toolchain = readFixture<{ pythonBackend: { requirement: string; sha256: string }; exceptions?: { tool: string; channel: string }[]; mise: unknown }>(ROOT, 'config/toolchain.json');
  mkdirSync(path.join(consumer, 'config'), { recursive: true });
  writeFileSync(path.join(consumer, 'config/toolchain.json'), `${JSON.stringify({ schema: 1, mise: toolchain.mise }, null, 2)}\n`);
  // Its suite runs the gates of kit, as kit-check asks of every repository.
  writeFileSync(path.join(consumer, 'Makefile'), 'include ../kit/scripts/kit/kit-bootstrap.mk\nCHECK_TARGETS := kit-gates\n');
  writeFileSync(path.join(consumer, '.gitignore'), '/node_modules/\n/var/\n');
  commitSandbox(consumer);
  // The npm of packageManager, the mise of config/toolchain.json and the node of mise.toml are the releases that kit installed:
  // the bootstrap keeps a release that is installed, so the first step runs offline and writes the wrappers of the consumer.
  cpSync(path.join(ROOT, 'var/tools/npm'), path.join(consumer, 'var/tools/npm'), { recursive: true });
  cpSync(path.join(ROOT, 'var/tools/mise-release'), path.join(consumer, 'var/tools/mise-release'), { recursive: true });
  cpSync(path.join(ROOT, 'var/tools/mise/installs/node'), path.join(consumer, 'var/tools/mise/installs/node'), { recursive: true, verbatimSymlinks: true });
  const env = { ...process.env, npm_config_cache: cache, npm_config_offline: 'true', npm_config_audit: 'false', npm_config_fund: 'false' };
  const make = (...args: string[]) => spawnSync('make', ['--no-print-directory', ...args], { cwd: consumer, env, encoding: 'utf8' });

  // The steps of the release workflow before release-tools run in its order: the bootstrap, kit-check, which fails a
  // checkout that needs PHP without .php-version before any release step (K193), then release-prepare, which a consumer
  // without a preparation of its own runs as no work (K132); release-tag runs before it on a dispatch (K269).
  const workflow = readFileSync(path.join(consumer, '.github/workflows/release.yml'), 'utf8');
  // The make steps of the workflow; a step that checks the runner, as for zip, runs no target.
  const steps = [...workflow.matchAll(/^\s+run: (make .+)$/gm)].map(match => match[1] ?? '');
  const bootstrap = steps.slice(0, steps.indexOf('make release-tools'));
  assert.deepEqual(bootstrap, ['make install-tools TOOLS=npm', 'make install-packages', 'make kit-check', 'make release-tag', 'make release-prepare'], 'the release workflow bootstraps the package, checks the checkout and prepares the release before release-tools');
  // release-tag runs only on a dispatch, with the tag of its input (K269); release-tag.test.mts runs it.
  for (const command of bootstrap.filter(command => command !== 'make release-tag')) {
    const step = spawnSync('sh', ['-c', command], { cwd: consumer, env, encoding: 'utf8' });
    assert.equal(step.status, 0, `${command}: ${step.stdout}${step.stderr}`);
  }
  assert.ok(existsSync(path.join(consumer, 'node_modules/@polyspec/kit/dist/kit.mk')), 'make install-packages installed @polyspec/kit');
  // The packages that kit depends on are installed with it, at the versions of its package-lock.
  for (const [entry] of DEPENDENCIES) assert.ok(existsSync(path.join(consumer, entry, 'package.json')), `make install-packages did not install ${entry}`);
  // The lint tools of make lint-ts are dependencies of kit, installed with it and linked into node_modules/.bin.
  for (const tool of ['oxlint', 'tsgolint', 'knip', 'api-extractor']) assert.ok(existsSync(path.join(consumer, 'node_modules/.bin', tool)), `make install-packages did not install node_modules/.bin/${tool}`);
  for (const target of [['kit-sync'], ['kit-check'], ['toolchain-check', 'TOOLS=node npm']]) {
    const result = make(...target);
    assert.equal(result.status, 0, `make ${target.join(' ')}: ${result.stdout}${result.stderr}`);
    assert.match(result.stdout, /\.\.\/kit\/scripts\/kit\/[a-z-]+\.mts/, `make ${target.join(' ')} runs the sources of the kit checkout beside the consumer`);
  }
  // The smoke command of the release of kit (consumers.npm of config/release.json) runs in the consumer.
  const release = readFixture<ReleaseConfig>(ROOT, 'config/release.json');
  const [command, ...args] = release.consumers?.npm?.smoke['@polyspec/kit'] ?? [];
  assert.ok(command, 'config/release.json names no smoke command of @polyspec/kit');
  const smoked = spawnSync(command, args, { cwd: consumer, env, encoding: 'utf8' });
  assert.equal(smoked.status, 0, `the smoke command of @polyspec/kit: ${smoked.stdout}${smoked.stderr}`);
  assert.match(make('kit-sync').stdout, new RegExp(`\\[kit-sync\\] unchanged: @polyspec/kit ${packed.version.replaceAll('.', '\\.')}`));
  assert.equal(run('git', ['status', '--porcelain', '-uall'], consumer), '', 'the bootstrap and the gate targets changed the tracked files of the consumer');
});
