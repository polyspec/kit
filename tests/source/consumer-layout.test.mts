// A repository that consumes kit as the package @polyspec/kit (K71-2). kit is built and packed, an npm cache is primed with
// the tarball, and a sandbox consumer, a Git repository whose package-lock pins the release asset of the tarball by its
// integrity, runs the bootstrap steps of its copied release workflow offline (make install-tools TOOLS=npm with the copied
// installer, then make install-packages), then the gate targets of the package. The consumer holds only the copies of kit.copies, which it takes from the tarball.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { builtCopy, commitSandbox, NPM, packedKit, run } from './checkout.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const KIT = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const NODE = process.versions.node;
// The packages that kit depends on at run time, as its package-lock resolves them: [node_modules/<name>, entry].
const DEPENDENCIES = Object.entries(JSON.parse(readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8')).packages as Record<string, { version: string; resolved: string; integrity: string; dev?: boolean }>)
  .filter(([entry, item]) => entry !== '' && !item.dev);

test('a consumer installs the packed kit offline and runs the bootstrap order and the gate targets', { timeout: 10 * 60_000 }, (t) => {
  assert.ok(existsSync(NPM), `${path.relative(ROOT, NPM)} is missing; make install-tools TOOLS=npm installs the npm of packageManager`);
  const copy = builtCopy(t);
  const work = mkdtempSync(path.join(tmpdir(), 'kit-consumer-'));
  t.after(() => rmSync(work, { recursive: true, force: true }));
  // The tarball of kit and an npm cache that holds it, so the install reads no registry and no release.
  const packed = packedKit(run(NPM, ['pack', '--json', '--ignore-scripts', '--pack-destination', work], copy));
  const tarball = path.join(work, packed.filename);
  const cache = path.join(work, 'npm-cache');
  run(NPM, ['cache', 'add', tarball, '--cache', cache], work);
  // The packages that kit depends on come from the npm cache of this checkout, which its npm ci filled: npm pack --offline
  // writes the registry tarball of each, whose integrity is the one of package-lock.
  for (const [entry, item] of DEPENDENCIES) {
    const name = entry.slice('node_modules/'.length);
    const dependency: { filename: string } | undefined = JSON.parse(run(NPM, ['pack', '--json', '--offline', '--allow-remote=all', '--pack-destination', work, item.resolved], work))[name];
    assert.ok(dependency, `npm pack printed no ${name}`);
    run(NPM, ['cache', 'add', path.join(work, dependency.filename), '--cache', cache], work);
  }
  const unpacked = path.join(work, 'unpacked');
  mkdirSync(unpacked);
  run('tar', ['-xzf', tarball, '-C', unpacked, '--strip-components=1'], work);

  // The consumer: the copies of kit.copies from the tarball, a Makefile that includes kit-bootstrap.mk, and a lock that pins
  // the release asset of kit by its integrity.
  const consumer = path.join(work, 'consumer');
  mkdirSync(consumer);
  for (const [file, from] of Object.entries(KIT.kit.copies as Record<string, string>)) {
    mkdirSync(path.dirname(path.join(consumer, file)), { recursive: true });
    cpSync(path.join(unpacked, from), path.join(consumer, file));
  }
  // The release asset of kit, as config/release.json names it (release.mts archiveName).
  const asset = `https://github.com/polyspec/kit/releases/download/v${packed.version}/polyspec-kit-npm-${packed.version}.tgz`;
  const manifest = { name: 'consumer', private: true, packageManager: KIT.packageManager, engines: { node: `>=${NODE}` }, devDependencies: { '@polyspec/kit': asset } };
  const lock = {
    name: 'consumer', lockfileVersion: 3, requires: true,
    packages: {
      '': { name: 'consumer', devDependencies: manifest.devDependencies, engines: manifest.engines },
      'node_modules/@polyspec/kit': { version: packed.version, resolved: asset, integrity: packed.integrity, dev: true, license: KIT.license, dependencies: KIT.dependencies, engines: KIT.engines },
      ...Object.fromEntries(DEPENDENCIES.map(([entry, item]) => [entry, { ...item, dev: true }])),
    },
  };
  writeFileSync(path.join(consumer, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(path.join(consumer, 'package-lock.json'), `${JSON.stringify(lock, null, 2)}\n`);
  writeFileSync(path.join(consumer, '.node-version'), `${NODE}\n`);
  writeFileSync(path.join(consumer, 'Makefile'), 'include scripts/kit/kit-bootstrap.mk\n');
  writeFileSync(path.join(consumer, '.gitignore'), '/node_modules/\n/var/\n');
  commitSandbox(consumer);
  // The npm of packageManager is the release that kit installed: install-tools keeps a release with the same digest, so the
  // first step runs offline and writes the wrappers of the consumer.
  cpSync(path.join(ROOT, 'var/tools/npm'), path.join(consumer, 'var/tools/npm'), { recursive: true });
  const env = { ...process.env, npm_config_cache: cache, npm_config_offline: 'true', npm_config_audit: 'false', npm_config_fund: 'false' };
  const make = (...args: string[]) => spawnSync('make', ['--no-print-directory', ...args], { cwd: consumer, env, encoding: 'utf8' });

  const early = make('kit-check');
  assert.equal(early.status, 2, early.stdout);
  assert.match(early.stderr, /node_modules\/@polyspec\/kit\/dist\/kit\.mk is missing; run make install-tools TOOLS=npm, then make install-packages/);
  // The bootstrap steps of the copied release workflow, the steps before release-tools, run in its order.
  const workflow = readFileSync(path.join(consumer, '.github/workflows/release.yml'), 'utf8');
  const steps = [...workflow.matchAll(/^\s+run: (.+)$/gm)].map(match => match[1] ?? '');
  const bootstrap = steps.slice(0, steps.indexOf('make release-tools'));
  assert.deepEqual(bootstrap, ['make install-tools TOOLS=npm', 'make install-packages'], 'the release workflow bootstraps the package before release-tools');
  for (const command of bootstrap) {
    const step = spawnSync('sh', ['-c', command], { cwd: consumer, env, encoding: 'utf8' });
    assert.equal(step.status, 0, `${command}: ${step.stdout}${step.stderr}`);
  }
  assert.ok(existsSync(path.join(consumer, 'node_modules/@polyspec/kit/dist/kit.mk')), 'make install-packages installed @polyspec/kit');
  // The packages that kit depends on are installed with it, at the versions of its package-lock.
  for (const [entry] of DEPENDENCIES) assert.ok(existsSync(path.join(consumer, entry, 'package.json')), `make install-packages did not install ${entry}`);
  for (const target of [['kit-sync'], ['kit-check'], ['toolchain-check', 'TOOLS=node npm']]) {
    const result = make(...target);
    assert.equal(result.status, 0, `make ${target.join(' ')}: ${result.stdout}${result.stderr}`);
    assert.doesNotMatch(result.stdout, /scripts\/kit\/[a-z-]+\.mts/, `make ${target.join(' ')} ran a source of kit`);
  }
  // The smoke command of the release of kit (consumers.npm of config/release.json) runs in the consumer.
  const release = JSON.parse(readFileSync(path.join(ROOT, 'config/release.json'), 'utf8'));
  const [command, ...args]: string[] = release.consumers.npm.smoke['@polyspec/kit'];
  assert.ok(command, 'config/release.json names no smoke command of @polyspec/kit');
  const smoked = spawnSync(command, args, { cwd: consumer, env, encoding: 'utf8' });
  assert.equal(smoked.status, 0, `the smoke command of @polyspec/kit: ${smoked.stdout}${smoked.stderr}`);
  assert.match(make('kit-sync').stdout, new RegExp(`\\[kit-sync\\] unchanged: @polyspec/kit ${packed.version.replaceAll('.', '\\.')}`));
  assert.equal(run('git', ['status', '--porcelain', '-uall'], consumer), '', 'the bootstrap and the gate targets changed the tracked files of the consumer');
});
