// A repository that consumes kit as the package @polyspec/kit (K71-2) and knows it only by its installation (S15). kit is built and
// packed with the prepack and postpack of the release, an npm cache is primed with the tarball, and a sandbox consumer, a Git
// repository whose package-lock pins the release asset of the tarball by its integrity, runs the bootstrap steps of its release
// workflow offline (npm ci, as the bootstrap action does first, then make install-tools TOOLS=npm and make install-packages), then
// the gate targets, which run the dist of the installed kit. The consumer holds the copies of kit.copies, which it takes from the tarball.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { builtCopy, commitSandbox, installedLockEntries, kitConsumer, NPM, packedKit, primeCache, run, runtimePackage } from './checkout.mts';
import { readFixture } from '../kit/json-fixture.mts';
import type { NpmManifest } from '../../scripts/kit/manifests.mts';
import { declaredMiseTools } from '../../scripts/kit/toolchain-mise.mts';
import { parse, stringify } from 'smol-toml';
import { known } from '../kit/known.mts';
import { BOOTSTRAP_USES, bootstrapActionCommands } from '../kit/workflow-package-bootstrap.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const KIT = readFixture<NpmManifest>(ROOT, 'package.json');
// The Node.js of mise.toml of kit, which the consumer declares too (K171).
const NODE = known(declaredMiseTools(ROOT).node, 'the node of mise.toml').version;
// The packages that kit depends on at run time that this machine installed, which the consumer installs from the primed
// cache. The lint tools (K77) are among them, since a consumer runs them through make lint-ts.
const DEPENDENCIES = installedLockEntries(runtimePackage);

test('a consumer installs the packed kit offline and runs the bootstrap order and the gate targets', { timeout: 10 * 60_000 }, (t) => {
  assert.ok(existsSync(NPM), `${path.relative(ROOT, NPM)} is missing; make install-tools TOOLS=npm installs the npm of mise.toml`);
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

  // The consumer: the copies of kit.copies from the tarball, the release workflow of kit as its own, a Makefile that includes the
  // kit-bootstrap.mk of its installed kit (S15), and a lock that pins the release asset of kit by its integrity.
  const consumer = path.join(work, 'consumer');
  mkdirSync(path.join(consumer, '.github/workflows'), { recursive: true });
  mkdirSync(path.join(consumer, '.github/actions/kit-bootstrap'), { recursive: true });
  cpSync(path.join(ROOT, 'workflows/release.yml'), path.join(consumer, '.github/workflows/release.yml'));
  cpSync(path.join(ROOT, 'actions/kit-bootstrap/action.yml'), path.join(consumer, '.github/actions/kit-bootstrap/action.yml'));
  // A repository's own ci.yml, named ci as release.yml waits for it (K987, K989).
  writeFileSync(path.join(consumer, '.github/workflows/ci.yml'), 'name: ci\non:\n  push:\n    branches: [main]\njobs:\n  kit:\n    uses: ./.github/workflows/ci-pipeline.yml\n  ci-passed:\n    needs: [kit]\n    runs-on: ubuntu-24.04\n    steps:\n      - run: test "${{ needs.kit.result }}" = success\n');
  const copies = KIT.kit?.copies;
  assert.ok(copies, 'package.json of kit declares no kit.copies');
  for (const [file, from] of Object.entries(copies)) {
    mkdirSync(path.dirname(path.join(consumer, file)), { recursive: true });
    cpSync(path.join(unpacked, from), path.join(consumer, file));
  }
  const { manifest, lock } = kitConsumer(packed, { devEngines: KIT.devEngines, engines: { node: `>=${NODE}` } });
  writeFileSync(path.join(consumer, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(path.join(consumer, 'package-lock.json'), `${JSON.stringify(lock, null, 2)}\n`);
  // The consumer declares the node of kit in mise.toml, and its mise.lock pins it as the mise.lock of kit does (K171).
  const NPM_VERSION = KIT.devEngines?.packageManager?.version;
  assert.ok(NPM_VERSION, 'package.json of kit declares no devEngines npm version');
  writeFileSync(path.join(consumer, 'mise.toml'), `[tools]\nnode = "${NODE}"\n"npm:npm" = "${NPM_VERSION}"\n`);
  const kitLock = parse(readFileSync(path.join(ROOT, 'mise.lock'), 'utf8'));
  const tools = kitLock.tools;
  assert.ok(typeof tools === 'object' && tools !== null && 'node' in tools && 'npm:npm' in tools, 'the mise.lock of kit pins no node or npm');
  writeFileSync(path.join(consumer, 'mise.lock'), stringify({ lockfile_version: kitLock.lockfile_version, tools: { node: tools.node, 'npm:npm': tools['npm:npm'] } }));
  cpSync(path.join(ROOT, '.mise/locks'), path.join(consumer, '.mise/locks'), { recursive: true });
  // The bootstrap installs the mise that config/toolchain.json declares, then the node of mise.toml with it; the consumer
  // declares the mise of kit.
  const toolchain = readFixture<{ exceptions?: { tool: string; channel: string }[]; mise: unknown }>(ROOT, 'config/toolchain.json');
  mkdirSync(path.join(consumer, 'config'), { recursive: true });
  writeFileSync(path.join(consumer, 'config/toolchain.json'), `${JSON.stringify({ schema: 1, mise: toolchain.mise }, null, 2)}\n`);
  // Its suite runs the gates of kit, as kit-check asks of every repository.
  writeFileSync(path.join(consumer, 'Makefile'), 'include node_modules/@polyspec/kit/scripts/kit/kit-bootstrap.mk\nCHECK_TARGETS := kit-gates\n');
  writeFileSync(path.join(consumer, '.gitignore'), '/node_modules/\n/var/\n');
  // The consumer pins kit by its release URL, so its own committed .npmrc allows a remote root dependency (K1045).
  writeFileSync(path.join(consumer, '.npmrc'), 'allow-remote=root\n');
  commitSandbox(consumer);
  // The npm of mise.toml, the mise of config/toolchain.json and the node of mise.toml are the releases that kit installed:
  // the bootstrap keeps a release that is installed, so the first step runs offline and writes the wrappers of the consumer.
  cpSync(path.join(ROOT, 'var/tools/mise/installs/npm-npm'), path.join(consumer, 'var/tools/mise/installs/npm-npm'), { recursive: true, verbatimSymlinks: true });
  cpSync(path.join(ROOT, 'var/tools/mise-release'), path.join(consumer, 'var/tools/mise-release'), { recursive: true });
  cpSync(path.join(ROOT, 'var/tools/mise/installs/node'), path.join(consumer, 'var/tools/mise/installs/node'), { recursive: true, verbatimSymlinks: true });
  const env = { ...process.env, npm_config_cache: cache, npm_config_offline: 'true', npm_config_audit: 'false', npm_config_fund: 'false' };
  const make = (...args: string[]) => spawnSync('make', ['--no-print-directory', ...args], { cwd: consumer, env, encoding: 'utf8' });

  // The steps of the release workflow before release-tools run in its order: the bootstrap, then release-prepare, which a
  // consumer without a preparation of its own runs as no work (K132); release-tag runs before it, and the packages of the tag are
  // installed again (K269, K911). The release runs no kit-check of its own: release-tag refuses a commit whose CI run did not pass (K755).
  const workflow = readFileSync(path.join(consumer, '.github/workflows/release.yml'), 'utf8');
  // The make steps of the workflow; a step that checks the runner, as for zip, runs no target.
  // The step that runs the bootstrap action of kit (K992) stands for the make commands of the action that kit-sync vendors.
  const action = readFileSync(path.join(consumer, '.github/actions/kit-bootstrap/action.yml'), 'utf8');
  const steps = workflow.split('\n').flatMap(line => BOOTSTRAP_USES.test(line) ? bootstrapActionCommands(action) : [...line.matchAll(/^\s+run: (make .+)$/g)].map(match => match[1] ?? ''));
  const bootstrap = steps.slice(0, steps.indexOf('make release-tools'));
  assert.deepEqual(bootstrap, ['make install-tools TOOLS=npm', 'make install-packages', "make release-tag ${{ github.event_name == 'workflow_run' && 'AUTO=1' || '' }}", 'make install-tools TOOLS=npm', 'make install-packages', 'make release-prepare'], 'the release workflow bootstraps the package, tags the commit of the CI run, installs it again and prepares the release before release-tools (K755, K911)');
  // release-tag reads a CI run with gh (K911); release-tag.test.mts runs it.
  // The bootstrap action installs the locked kit with npm ci before its make commands, so the Makefile can include it.
  run(NPM, ['ci', '--ignore-scripts'], consumer, env);
  for (const command of bootstrap.filter(command => !command.startsWith('make release-tag'))) {
    const step = spawnSync('sh', ['-c', command], { cwd: consumer, env, encoding: 'utf8' });
    assert.equal(step.status, 0, `${command}: ${step.stdout}${step.stderr}`);
  }
  assert.ok(existsSync(path.join(consumer, 'node_modules/@polyspec/kit/dist/kit.mk')), 'npm ci and make install-packages installed @polyspec/kit');
  // The packages that kit depends on are installed with it, at the versions of its package-lock.
  for (const [entry] of DEPENDENCIES) assert.ok(existsSync(path.join(consumer, entry, 'package.json')), `make install-packages did not install ${entry}`);
  // The lint tools of make lint-ts are dependencies of kit, installed with it and linked into node_modules/.bin.
  for (const tool of ['oxlint', 'tsgolint', 'knip', 'api-extractor']) assert.ok(existsSync(path.join(consumer, 'node_modules/.bin', tool)), `make install-packages did not install node_modules/.bin/${tool}`);
  for (const target of [['kit-sync'], ['kit-check']]) {
    const result = make(...target);
    assert.equal(result.status, 0, `make ${target.join(' ')}: ${result.stdout}${result.stderr}`);
    // KIT is the real dist folder of the installed packed kit.
    assert.ok(result.stdout.includes(`${realpathSync(path.join(consumer, 'node_modules/@polyspec/kit'))}/dist/`), `make ${target.join(' ')} runs the dist of the installed kit`);
  }
  assert.match(make('kit-sync').stdout, new RegExp(`\\[kit-sync\\] unchanged: @polyspec/kit ${packed.version.replaceAll('.', '\\.')}`));
  assert.equal(run('git', ['status', '--porcelain', '-uall'], consumer), '', 'the bootstrap and the gate targets changed the tracked files of the consumer');
});
