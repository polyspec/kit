// Tests of the release tool (scripts/kit/release.mts): the configuration, the tag, verify, the manifest rules,
// assets, publish and coverage. Each case works in a committed copy of the fixture (release-sandbox.mts) with stubs of
// gh and npm on PATH; real git, tar and unzip run. No case reaches GitHub or a registry.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { checkConfig } from '../../scripts/kit/kit-check.mts';
import { Stop } from '../../scripts/kit/process.mts';
import * as release from '../../scripts/kit/release.mts';
import { git, readJson, releaseSandbox, writeJson } from './release-sandbox.mts';
import { KIT_MAKE, tool } from './kit-tools.mts';
import type { NpmManifest } from '../../scripts/kit/manifests.mts';
import { parseJson } from '../../scripts/kit/schema-validate.mts';
import { known } from './known.mts';

const REPOSITORY = 'example/kit-fixture';
type Box = ReturnType<typeof releaseSandbox>;
// config/release.json as the fixture holds it, which a test also edits into shapes that the schema refuses.
type ConfigJson = Omit<release.ReleaseConfig, 'schema'> & { schema: number };
// A manifest of the fixture, package.json or composer.json, which a test edits.
type ManifestJson = Record<string, unknown>;
const context = (box: Box, extra: { config?: release.ReleaseConfig; log?: (text: string) => void } = {}) => release.context(box.root, { env: { ...box.env, GITHUB_REPOSITORY: REPOSITORY }, ...extra });
const stop = (fn: () => unknown, pattern: RegExp) => assert.throws(fn, error => error instanceof Stop && pattern.test(error.message), String(pattern));
const edit = <Json = ManifestJson,>(root: string, file: string, change: (value: Json) => unknown) => writeJson(root, file, change(readJson<Json>(root, file)));

test('latest names the newest root release tag reachable from HEAD', (t) => {
  const box = releaseSandbox(t, { version: '0.0.3' });
  const ctx = context(box);
  git(ctx.root, 'tag', 'v0.0.1');
  git(ctx.root, 'tag', 'v0.0.2');
  git(ctx.root, 'tag', 'v0.0.10');
  git(ctx.root, 'tag', 'packages/fixture-go/v0.0.11');
  assert.equal(release.latestTag(ctx), 'v0.0.10');
});

test('latest compares only the tags of the form vX.Y.Z and fails when none is reachable', (t) => {
  const box = releaseSandbox(t, { version: '0.0.3' });
  const ctx = context(box);
  for (const tag of ['v1.2', 'v1.2.3-rc1', 'v2']) git(ctx.root, 'tag', tag);
  stop(() => release.latestTag(ctx), /no release tag is reachable from HEAD/);
  for (const tag of ['v0.0.1', 'v0.0.10', 'v0.0.2']) git(ctx.root, 'tag', tag);
  assert.equal(release.latestTag(ctx), 'v0.0.10');
});

test('latest fails when no release tag is reachable', (t) => {
  const ctx = context(releaseSandbox(t));
  stop(() => release.latestTag(ctx), /no release tag is reachable from HEAD/);
});

test('a release tag is a version or a Go module directory and a version', (t) => {
  const { config } = context(releaseSandbox(t));
  assert.deepEqual(release.parseTag(config, 'v1.2.3'), [null, '1.2.3']);
  assert.deepEqual(release.parseTag(config, 'packages/fixture-go/v1.2.3'), ['packages/fixture-go', '1.2.3']);
  for (const tag of ['1.2.3', 'v1.2', 'v01.2.3', 'v1.2.3-rc1', 'v1.2.3/', '']) stop(() => release.parseTag(config, tag), /a release tag is vX\.Y\.Z or <Go module directory>\/vX\.Y\.Z/);
  stop(() => release.parseTag(config, 'other/v1.2.3'), /other is not a Go module directory; the Go modules are \[packages\/fixture-go\]/);
});

test('the schema accepts the configuration of the fixture and names each error of another', (t) => {
  const box = releaseSandbox(t);
  assert.deepEqual(checkConfig(box.root).filter(line => line.startsWith('config/release.json')), []);
  const config = readJson<release.ReleaseConfig>(box.root, 'config/release.json');
  writeJson(box.root, 'config/release.json', { ...config, schema: 2, extra: 1, packages: [{ kind: 'pip', directory: '/abs', name: 'x' }] });
  const findings = checkConfig(box.root).filter(line => line.startsWith('config/release.json'));
  assert.ok(findings.some(line => line.includes('/schema must be equal to constant {"allowedValue":1}, value 2')), findings.join('\n'));
  assert.ok(findings.some(line => line.includes('/ must NOT have additional properties {"additionalProperty":"extra"}')), findings.join('\n'));
  assert.ok(findings.some(line => line.includes('/packages/0/kind must be equal to one of the allowed values {"allowedValues":["npm","composer","wheel"]}, value "pip"')), findings.join('\n'));
  assert.ok(findings.some(line => line.startsWith('config/release.json: /packages/0/directory must match pattern') && line.includes('value "/abs"')), findings.join('\n'));
  const { changelog, ...without } = config;
  writeJson(box.root, 'config/release.json', without);
  assert.ok(checkConfig(box.root).some(line => line.includes(`/ must have required property 'changelog' {"missingProperty":"changelog"}`)));
  assert.ok(changelog);
});

test('the configuration is checked for the rules that the schema cannot express', (t) => {
  const box = releaseSandbox(t);
  const load = (change: (value: ConfigJson) => unknown) => {
    writeJson(box.root, 'config/release.json', change(readJson<ConfigJson>(box.root, 'config/release.json')));
    return () => release.loadConfig(box.root);
  };
  assert.equal(release.loadConfig(box.root).checks.join(), 'push-gate,ci-passed');
  const original = readJson<ConfigJson>(box.root, 'config/release.json');
  writeJson(box.root, 'config/release.json', (({ checks: _checks, ...rest }) => rest)(original));
  assert.equal(release.loadConfig(box.root).checks.join(), 'ci-passed', 'the checks default to ci-passed');
  writeJson(box.root, 'config/release.json', original);
  stop(load(c => ({ ...c, manifests: { ...c.manifests, 'package.json': 'tarball' } })), /manifests\.package\.json is "tarball", the allowed values are archive, version, git-tag/);
  writeJson(box.root, 'config/release.json', original);
  stop(load(c => ({ ...c, manifests: { ...c.manifests, 'README.md': 'version' } })), /manifests\.README\.md is not a package\.json, composer\.json, Cargo\.toml, pyproject\.toml, VERSION file/);
  stop(load(() => ({ ...original, notReleased: { 'a/package.json': '' } })), /notReleased\.a\/package\.json needs a reason/);
  stop(load(() => ({ ...original, notReleased: { 'package.json': 'private root' } })), /package\.json is in both manifests and notReleased/);
  stop(load(() => ({ ...original, manifests: { ...original.manifests, 'packages/fixture-lib/package.json': 'version' } })), /the package fixture-lib needs manifests\.packages\/fixture-lib\/package\.json = "archive", found "version"/);
  stop(load(() => ({ ...original, packages: original.packages.slice(1) })), /manifests\.packages\/fixture-lib\/package\.json is "archive" but no package of packages has that manifest/);
  stop(load(() => ({ ...original, packages: [...original.packages, original.packages[0]] })), /the npm package fixture-lib is listed twice/);
  stop(load(() => ({ ...original, packages: original.packages.map(p => (p.kind === 'composer' ? { ...p, name: 'nodash' } : p)) })), /the composer package nodash is not a `vendor\/name`/);
  stop(load(() => ({ ...original, packages: original.packages.map(p => (p.name === 'fixture-lib' ? { ...p, name: 'polyspec/fixture-app' } : p)) })), /is not a `name` or `@scope\/name`/);
  stop(load(() => ({ ...original, goModules: { 'packages/fixture-go': '' } })), /goModules\.packages\/fixture-go needs the module path/);
  stop(load(() => ({ ...original, schema: 3 })), /\/schema must be equal to constant \{"allowedValue":1\}, value 3/);
  writeJson(box.root, 'config/release.json', original);
  stop(load(() => ({ ...original, packages: original.packages.map(p => (p.kind === 'composer' ? { ...p, generated: [{ kind: 'source-copy', source: '../outside.c', output: 'src/native/shared.c' }] } : p)) })), /source-copy source "\.\.\/outside\.c" is not a repository-relative path/);
  stop(load(() => ({ ...original, packages: original.packages.map(p => (p.kind === 'composer' ? { ...p, generated: [{ kind: 'source-copy', source: 'packages/fixture-lib/shared.c', output: 'src/../shared.c' }] } : p)) })), /source-copy output "src\/\.\.\/shared\.c" is not a package-relative path/);
  git(box.root, 'rm', '-q', '-f', 'config/release.json');
  stop(() => release.loadConfig(box.root), /config\/release\.json: the file is missing/);
});

test('a commit of main whose checks succeeded is verified, and the check runs are read for it', (t) => {
  const box = releaseSandbox(t);
  const tag = box.release('0.0.1');
  const lines: string[] = [];
  const result = release.verify(context(box, { log: line => lines.push(line) }), tag);
  assert.deepEqual(result, { commit: box.commit, checks: ['push-gate', 'ci-passed'] });
  assert.deepEqual(box.state().calls, [['api', '--paginate', `repos/${REPOSITORY}/commits/${box.commit}/check-runs?per_page=100`, '--jq', '.check_runs[] | [.id, .name, .status, .conclusion] | @json']]);
  assert.ok(lines.some(line => line.includes(`reading the check runs of ${box.commit}`)), lines.join('\n'));
});

test('a release tag is annotated: a lightweight tag fails and names the tag and its kind, an annotated tag passes', (t) => {
  const box = releaseSandbox(t);
  git(box.root, 'tag', 'v0.0.1', box.commit);
  stop(() => release.verify(context(box), 'v0.0.1'), /v0\.0\.1: the commit [0-9a-f]{40}: the tag v0\.0\.1 has the object type commit, not tag; a release tag is annotated, so create it with git tag -a v0\.0\.1 -m v0\.0\.1/);
  git(box.root, 'tag', '-d', 'v0.0.1');
  assert.equal(release.verify(context(box), box.release('0.0.1')).commit, box.commit);
});

test('a commit that is not an ancestor of origin/main fails and names the commit', (t) => {
  const box = releaseSandbox(t);
  writeFileSync(path.join(box.root, 'later.txt'), 'later');
  git(box.root, 'add', '-A');
  git(box.root, 'commit', '--quiet', '-m', 'later');
  const tag = box.tag('v0.0.1', git(box.root, 'rev-parse', 'HEAD'));
  stop(() => release.verify(context(box), tag), /v0\.0\.1: the commit [0-9a-f]{40}: the commit is not on origin\/main; a release tags a commit of main/);
});

test('a missing, running or failed check is named and the latest run of a check decides', (t) => {
  const box = releaseSandbox(t);
  const tag = box.release('0.0.1');
  box.checkRuns([['push-gate', 'success']]);
  stop(() => release.verify(context(box), tag), /the check ci-passed is missing/);
  box.checkRuns([['push-gate', 'failure'], ['ci-passed', null]]);
  stop(() => release.verify(context(box), tag), /the check push-gate is completed with the conclusion failure, not success; the check ci-passed is in_progress with the conclusion null, not success/);
  box.checkRuns([['push-gate', 'failure'], ['ci-passed', 'success'], ['push-gate', 'success']]);
  assert.equal(release.verify(context(box), tag).commit, box.commit, 'a rerun that succeeded replaces the failed run');
  box.checkRuns([['push-gate', 'success'], ['ci-passed', 'success'], ['push-gate', 'cancelled']]);
  stop(() => release.verify(context(box), tag), /the check push-gate is completed with the conclusion cancelled/);
});

test('the checks come from the configuration', (t) => {
  const box = releaseSandbox(t);
  const tag = box.release('0.0.1');
  edit<ConfigJson>(box.root, 'config/release.json', c => ({ ...c, checks: ['build'] }));
  box.checkRuns([['push-gate', 'success'], ['ci-passed', 'success']]);
  stop(() => release.verify(context(box), tag), /the check build is missing/);
  box.checkRuns([['build', 'success']]);
  assert.deepEqual(release.verify(context(box), tag).checks, ['build']);
});

test('verify without the repository, with an unknown tag or with a failing gh stops with the cause', (t) => {
  const box = releaseSandbox(t);
  const tag = box.release('0.0.1');
  stop(() => release.verify(release.context(box.root, { env: { ...box.env, GITHUB_REPOSITORY: '' } }), tag), /GITHUB_REPOSITORY is not set/);
  assert.deepEqual(box.state().calls, [], 'no request without the repository');
  stop(() => release.verify(context(box), 'v9.9.9'), /git rev-parse --verify refs\/tags\/v9\.9\.9\^\{commit\} exited with 128/);
  writeFileSync(path.join(box.root, '.stubs/bin/gh'), '#!/bin/sh\necho "HTTP 404" >&2\nexit 1\n');
  stop(() => release.verify(context(box), tag), /gh api --paginate repos\/example\/kit-fixture\/commits\/[0-9a-f]{40}\/check-runs\?per_page=100 .* exited with 1: HTTP 404/);
});

test('the section is the release notes without the anchor of the next section', (t) => {
  const box = releaseSandbox(t, { changelog: '# Changelog\n\n## 0.0.2\n\n- Two.\n\n<a id="001"></a>\n\n## 0.0.1\n\n- One.\n- Uno.\n\n<a id="000"></a>\n' });
  assert.equal(release.releaseNotes(context(box), 'v0.0.1'), '- One.\n- Uno.\n');
  assert.equal(release.releaseNotes(context(box), 'v0.0.2'), '- Two.\n');
  // A ## line in a fenced block is no heading, so the section runs on to the next heading of the document (K130).
  writeFileSync(path.join(box.root, 'CHANGELOG.md'), '# Changelog\n\n## 0.0.1 ##\n\n- One:\n\n```md\n## example\n```\n\n## 0.0.0\n\n- Old.\n');
  assert.equal(release.releaseNotes(context(box), 'v0.0.1'), '- One:\n\n```md\n## example\n```\n');
});

test('a section over the limit of GitHub becomes a link to the section, and a section at the limit stays whole', (t) => {
  const entry = (length: number) => `- ${'x'.repeat(length - 2)}`;
  const box = releaseSandbox(t, { changelog: `# Changelog\n\n<a id="release-001"></a>\n\n## 0.0.1\n\n${entry(release.NOTES_LIMIT - 1)}\n\n## 0.0.0\n\n- Old.\n` });
  const notes = release.releaseNotes(context(box), 'v0.0.1');
  assert.equal(notes.length, release.NOTES_LIMIT, 'the section and its newline are exactly at the limit');
  assert.ok(notes.startsWith('- xxx'));
  writeFileSync(path.join(box.root, 'CHANGELOG.md'), `# Changelog\n\n<a id="release-001"></a>\n\n## 0.0.1\n\n${entry(release.NOTES_LIMIT)}\n\n## 0.0.0\n\n- Old.\n`);
  assert.equal(release.releaseNotes(context(box), 'v0.0.1'),
    'The changes of 0.0.1 are listed in [CHANGELOG.md](https://example.com/polyspec/kit-fixture/blob/v0.0.1/CHANGELOG.md#release-001).\n');
  writeFileSync(path.join(box.root, 'CHANGELOG.md'), `# Changelog\n\n## 0.0.1\n\n${entry(release.NOTES_LIMIT + 5)}\n`);
  assert.match(release.releaseNotes(context(box), 'packages/fixture-go/v0.0.1'), /blob\/packages\/fixture-go\/v0\.0\.1\/CHANGELOG\.md#001\)\.\n$/, 'the anchor of a heading without an id is the version without dots');
});

// K785: the form of a dependency is the package manager's to resolve; the release keeps only the tag version of its own packages.
test('assets builds one archive per package of the configuration', (t) => {
  const box = releaseSandbox(t);
  const tag = box.tag('v0.0.1');
  const lines: string[] = [];
  const names = release.assets(context(box, { log: line => lines.push(line) }), tag);
  assert.deepEqual(names, ['fixture-lib-npm-0.0.1.tgz', 'fixture-app-npm-0.0.1.tgz', 'polyspec-kit-fixture-php-0.0.1.zip', 'kit_fixture-0.0.1-py3-none-any.whl']);
  const target = path.join(box.root, 'var/release/assets');
  assert.deepEqual(readdirSync(target).sort(), [...names].sort());
  assert.equal(lines.filter(line => line.includes('packing')).length, 4, lines.join('\n'));
  assert.deepEqual(box.npmCalls().map(call => path.basename(call.cwd)), ['fixture-lib', 'fixture-app']);
});

test('K712 builds candidate archives from committed HEAD without a release tag', (t) => {
  const generatedSource = '#include <sqlite3ext.h>\nSQLITE_EXTENSION_INIT1\n';
  const box = releaseSandbox(t, { mutate(root) {
    writeFileSync(path.join(root, 'packages/fixture-lib/shared.c'), generatedSource);
    edit<ConfigJson>(root, 'config/release.json', config => ({
      ...config,
      packages: config.packages.map(item => item.directory === 'packages/fixture-php'
        ? { ...item, generated: [{ kind: 'source-copy', source: 'packages/fixture-lib/shared.c', output: 'src/native/shared.c' }] }
        : item),
    }));
  } });
  const ctx = context(box);
  assert.equal(git(box.root, 'tag', '--list'), '', 'the fixture has no release tag');
  assert.throws(() => release.assets(ctx, 'v0.0.1'), error => error instanceof Stop, 'the official tag path still refuses a missing tag');
  const output: string[] = [];
  assert.equal(release.main(['candidate-assets', '0.0.1'], { root: box.root, env: ctx.env, print: line => output.push(line), error: line => output.push(line) }), 0, output.join('\n'));
  assert.ok(output.some(line => line.includes('built fixture-lib-npm-0.0.1.tgz')));
  assert.deepEqual(readdirSync(path.join(box.root, 'var/release/assets')).sort(), [
    'fixture-app-npm-0.0.1.tgz', 'fixture-lib-npm-0.0.1.tgz', 'kit_fixture-0.0.1-py3-none-any.whl', 'polyspec-kit-fixture-php-0.0.1.zip',
  ]);
  const composerArchive = path.join(box.root, 'var/release/assets', 'polyspec-kit-fixture-php-0.0.1.zip');
  assert.equal(spawnSync('unzip', ['-p', composerArchive, 'src/native/shared.c'], { encoding: 'utf8' }).stdout, generatedSource);
  assert.deepEqual(box.npmCalls().map(call => path.basename(call.cwd)), ['fixture-lib', 'fixture-app']);
  stop(() => release.candidateAssets(ctx, 'v0.0.1'), /candidate version .* is not X\.Y\.Z/);
  assert.equal(git(box.root, 'tag', '--list'), '', 'candidate generation does not create or require a tag');
});

test('K712 candidate archives refuse changed source inputs rather than packing worktree files', (t) => {
  const box = releaseSandbox(t, { mutate(root) {
    writeFileSync(path.join(root, 'Makefile'), 'release-assets: build\n');
  } });
  writeFileSync(path.join(box.root, 'packages/fixture-lib/package.json'), '{"name":"changed"}\n');
  stop(() => release.candidateAssets(context(box), '0.0.1'), /candidate assets require source inputs to match committed HEAD .* changed or untracked paths: packages\/fixture-lib/);
  git(box.root, 'checkout', '--', 'packages/fixture-lib/package.json');
  writeFileSync(path.join(box.root, 'packages/fixture-lib/untracked.js'), 'module.exports = true;\n');
  stop(() => release.candidateAssets(context(box), '0.0.1'), /candidate assets require source inputs to match committed HEAD .* changed or untracked paths: packages\/fixture-lib\/untracked\.js/);
  rmSync(path.join(box.root, 'packages/fixture-lib/untracked.js'));
  writeFileSync(path.join(box.root, 'Makefile'), 'release-assets: build candidate-build\n');
  stop(() => release.candidateAssets(context(box), '0.0.1'), /candidate assets require source inputs to match committed HEAD .* changed or untracked paths: Makefile/);
  assert.deepEqual(box.npmCalls(), [], 'the candidate refuses before invoking npm');
  assert.equal(existsSync(path.join(box.root, 'var/release/assets')), false);
});

test('each archive carries the manifest of its package unchanged', (t) => {
  const box = releaseSandbox(t);
  const ctx = context(box);
  const names = release.assets(ctx, box.tag('v0.0.1'));
  const target = path.join(box.root, 'var/release/assets');
  const sources = ['packages/fixture-lib/package.json', 'packages/fixture-app/package.json', 'packages/fixture-php/composer.json'];
  // sources holds the manifest of each of the first three archives, and names holds four archives.
  names.slice(0, 3).forEach((name, index) => assert.equal(release.packedManifest(ctx, path.join(target, name)), readFileSync(path.join(box.root, known(sources[index], 'sources[index]')), 'utf8'), name));
  // names holds four archives.
  const zip = spawnSync('unzip', ['-Z1', path.join(target, known(names[2], 'names[2]'))], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean).sort();
  assert.deepEqual(zip, ['composer.json', 'composer.lock', 'src/', 'src/Engine.php']);
});

test('a Composer archive carries the tracked native helper and its explicit build command', (t) => {
  const source = '#include <sqlite3ext.h>\nSQLITE_EXTENSION_INIT1\n';
  const builder = "<?php\n// Explicit consumer-side helper build command.\n";
  const box = releaseSandbox(t, { mutate(root) {
    edit(root, 'packages/fixture-php/composer.json', manifest => ({ ...manifest, bin: ['bin/build-sqlite-cancel.php'] }));
    mkdirSync(path.join(root, 'packages/fixture-php/src/native'), { recursive: true });
    mkdirSync(path.join(root, 'packages/fixture-php/bin'), { recursive: true });
    writeFileSync(path.join(root, 'packages/fixture-php/src/native/sqlite_cancel.c'), source);
    const command = path.join(root, 'packages/fixture-php/bin/build-sqlite-cancel.php');
    writeFileSync(command, builder);
    chmodSync(command, 0o755);
  } });
  const names = release.assets(context(box), box.tag('v0.0.1'));
  const archive = path.join(box.root, 'var/release/assets', known(names[2], 'names[2]'));
  const manifest: unknown = JSON.parse(release.packedManifest(context(box), archive));
  assert.ok(typeof manifest === 'object' && manifest !== null && 'bin' in manifest, 'the packed manifest names its bin');
  assert.deepEqual(manifest.bin, ['bin/build-sqlite-cancel.php']);
  const entries = spawnSync('unzip', ['-Z1', archive], { encoding: 'utf8' });
  assert.equal(entries.status, 0, entries.stderr);
  assert.ok(entries.stdout.split('\n').includes('src/native/sqlite_cancel.c'));
  assert.ok(entries.stdout.split('\n').includes('bin/build-sqlite-cancel.php'));
  assert.equal(spawnSync('unzip', ['-p', archive, 'src/native/sqlite_cancel.c'], { encoding: 'utf8' }).stdout, source);
  assert.equal(spawnSync('unzip', ['-p', archive, 'bin/build-sqlite-cancel.php'], { encoding: 'utf8' }).stdout, builder);
  assert.equal(entries.stdout.includes('src/native/bin/'), false, 'a consumer build output is not archived as tracked source');
  const metadata = spawnSync('unzip', ['-Z', '-v', archive], { encoding: 'utf8' });
  assert.equal(metadata.status, 0, metadata.stderr);
  assert.match(metadata.stdout, /bin\/build-sqlite-cancel\.php[\s\S]*?Unix file attributes \(100755 octal\):\s+-rwxr-xr-x/);
});

test('a Composer archive stages a declared tracked source from another package', (t) => {
  const source = '#include <sqlite3ext.h>\nSQLITE_EXTENSION_INIT1\n';
  const box = releaseSandbox(t, { mutate(root) {
    writeFileSync(path.join(root, 'packages/fixture-lib/shared.c'), source);
    edit<ConfigJson>(root, 'config/release.json', config => ({
      ...config,
      packages: config.packages.map(item => item.directory === 'packages/fixture-php'
        ? { ...item, generated: [{ kind: 'source-copy', source: 'packages/fixture-lib/shared.c', output: 'src/native/shared.c' }] }
        : item),
    }));
  } });
  const names = release.assets(context(box), box.tag('v0.0.1'));
  const archive = path.join(box.root, 'var/release/assets', known(names[2], 'Composer archive name'));
  const entries = spawnSync('unzip', ['-Z1', archive], { encoding: 'utf8' });
  assert.equal(entries.status, 0, entries.stderr);
  assert.ok(entries.stdout.split('\n').includes('src/native/shared.c'));
  assert.equal(spawnSync('unzip', ['-p', archive, 'src/native/shared.c'], { encoding: 'utf8' }).stdout, source);
});

test('K560 Composer archives generate arginfo from the tagged stub without changing the checkout', (t) => {
  const committedStub = "<?php\n// committed extension stub\n";
  const box = releaseSandbox(t, { mutate(root) {
    writeFileSync(path.join(root, 'packages/fixture-php/src/polyspec_orm.stub.php'), committedStub);
    edit<ConfigJson>(root, 'config/release.json', config => ({
      ...config,
      packages: config.packages.map(item => item.kind === 'composer' ? { ...item, generated: [{ kind: 'php-arginfo', stub: 'src/polyspec_orm.stub.php', output: 'src/polyspec_orm_arginfo.h' }] } : item),
    }));
  } });
  const prefix = path.join(box.root, 'php-prefix');
  const generatorSource = '<?php\n$version = "5.0.0";\n';
  const generator = path.join(box.root, 'var/tools/php-arginfo/gen_stub.php');
  const parser = path.join(box.root, 'var/tools/php-arginfo/PHP-Parser-5.0.0/lib/PhpParser');
  mkdirSync(path.join(prefix, 'lib/php/build'), { recursive: true });
  mkdirSync(parser, { recursive: true });
  writeFileSync(path.join(prefix, 'lib/php/build/gen_stub.php'), generatorSource);
  writeFileSync(generator, generatorSource);
  writeFileSync(path.join(parser, 'ParserFactory.php'), '<?php\n');
  const bin = path.join(box.root, 'var/tools/bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(path.join(bin, 'php-config'), `#!/bin/sh\nprintf '%s\\n' '${prefix}'\n`);
  chmodSync(path.join(bin, 'php-config'), 0o755);
  writeFileSync(path.join(bin, 'php'), "#!/bin/sh\nstub=\nfor arg do case \"$arg\" in *.stub.php) stub=\"$arg\" ;; esac; done\noutput=$(printf '%s' \"$stub\" | sed 's/\\.stub\\.php$/_arginfo.h/')\nprintf 'generated from committed stub: ' > \"$output\"\ncat \"$stub\" >> \"$output\"\nhead -c 356000 /dev/zero | tr '\\000' X >> \"$output\"\n");
  chmodSync(path.join(bin, 'php'), 0o755);

  const source = path.join(box.root, 'packages/fixture-php/src/polyspec_orm.stub.php');
  const mutableStub = '<?php\n// changed but not committed\n';
  writeFileSync(source, mutableStub);
  const ctx = context(box);
  const tag = box.tag('v0.0.1');
  const names = release.assets(ctx, tag);
  const zip = path.join(box.root, 'var/release/assets', known(names[2], 'Composer archive name'));
  const generated = spawnSync('unzip', ['-p', zip, 'src/polyspec_orm_arginfo.h']);
  assert.equal(generated.status, 0, generated.stderr?.toString());
  const expected = Buffer.concat([Buffer.from(`generated from committed stub: ${committedStub}`), Buffer.alloc(356000, 'X')]);
  assert.equal(generated.stdout.length, expected.length, 'the complete generated header is archived');
  assert.deepEqual(generated.stdout, expected, 'archive generation transports the header by file, not a size-limited argument');
  const metadata = spawnSync('unzip', ['-Z', '-v', zip], { encoding: 'utf8' });
  assert.equal(metadata.status, 0, metadata.stderr);
  assert.match(metadata.stdout, /Central directory entry #\d+:\n-+\n\n  src\/polyspec_orm_arginfo\.h/);
  assert.match(metadata.stdout, /compression method:\s+none \(stored\)/);
  assert.match(metadata.stdout, /Unix file attributes \(100644 octal\):\s+-rw-r--r--/);
  const zipless = path.join(box.root, 'zipless-path');
  mkdirSync(zipless);
  assert.throws(() => release.assets(release.context(box.root, { env: { ...box.env, PATH: zipless } }), tag), /zip is required to append generated files to Composer release archives; install Info-ZIP/);
  assert.equal(existsSync(path.join(box.root, 'var/release/assets')), true, 'missing zip is detected without deleting the prior release output');
  assert.equal(readFileSync(source, 'utf8'), mutableStub);
  assert.equal(existsSync(path.join(box.root, 'packages/fixture-php/src/polyspec_orm_arginfo.h')), false);
  const first = sha256(zip);
  release.assets(release.context(box.root, { env: { ...box.env, GITHUB_REPOSITORY: REPOSITORY, TZ: 'Pacific/Auckland' } }), tag);
  assert.equal(sha256(zip), first, 'the generated archive is deterministic across runs and time zones');
  const failingBin = path.join(box.root, 'var/tools/bin');
  mkdirSync(failingBin, { recursive: true });
  writeFileSync(path.join(failingBin, 'zip'), '#!/bin/sh\nif [ "$1" = "-v" ]; then exit 0; fi\nexit 9\n');
  chmodSync(path.join(failingBin, 'zip'), 0o755);
  assert.throws(() => release.assets(release.context(box.root, { env: { ...box.env, PATH: `${failingBin}${path.delimiter}${box.env.PATH}` } }), tag), /zip failed while adding src\/polyspec_orm_arginfo\.h .*exit status 9/);
  assert.equal(sha256(zip), first, 'a failed append leaves the previously published archive untouched');
  assert.deepEqual(readdirSync(path.join(box.root, 'var/release')), ['assets'], 'a failed append removes its staged asset directory');
});

test('K686-6: kit assets accept only the canonical packed manifest', (t) => {
  const box = releaseSandbox(t);
  const file = 'packages/fixture-lib/package.json';
  const source = JSON.stringify({ name: '@polyspec/kit', version: '0.0.1',
    bin: { 'polyspec-kit-hook': './scripts/kit/claude-hook.mts' },
    exports: { './run-tests': './scripts/kit/run-tests.mts' }, dependencies: { dep: '1.0.0' },
    scripts: { check: 'node check.mjs' } }, null, 2) + '\n';
  writeFileSync(path.join(box.root, file), source);
  git(box.root, 'commit', '--quiet', '-am', 'kit manifest');
  const tag = box.tag('v0.0.1', git(box.root, 'rev-parse', 'HEAD'));
  const config = context(box).config;
  const ctx = context(box, { config: { ...config, packages: config.packages.map(p => p.name === 'fixture-lib' ? { ...p, name: '@polyspec/kit' } : p) } });
  const expected = source.replace('"./scripts/kit/run-tests.mts"', '{ "types": "./dist/run-tests.d.mts", "default": "./dist/run-tests.mjs" }')
    .replace('"./scripts/kit/claude-hook.mts"', '"./dist/claude-hook.mjs"');
  writeFileSync(path.join(box.root, file), expected);
  assert.ok(release.assets(ctx, tag).includes('polyspec-kit-npm-0.0.1.tgz'));
  for (const [before, after] of [['./dist/run-tests.mjs', './dist/unexpected.mjs'], ['./dist/claude-hook.mjs', './dist/unexpected-hook.mjs'],
    ['"1.0.0"', '"2.0.0"'], ['node check.mjs', 'node other.mjs'], ['"version": "0.0.1"', '"version": "0.0.2"'],
    ['"name": "@polyspec/kit"', '"name": "@polyspec/unexpected"']] as const) {
    writeFileSync(path.join(box.root, file), expected.replace(before, after));
    stop(() => release.assets(ctx, tag), /the packed package\.json differs/);
  }
});

test('a packed manifest that differs from the manifest of the commit fails assets', (t) => {
  const box = releaseSandbox(t);
  const tag = box.tag('v0.0.1');
  box.env.STUB_NPM_MODE = 'rewrite';
  stop(() => release.assets(context(box), tag), /v0\.0\.1: the release assets do not install outside the repository: fixture-lib-npm-0\.0\.1\.tgz: the packed package\.json differs from packages\/fixture-lib\/package\.json of the commit [0-9a-f]{40}; fixture-app-npm-0\.0\.1\.tgz: the packed package\.json differs/);
  assert.equal(existsSync(path.join(box.root, 'var/release/assets')), false, 'a failed run leaves no archive');
  assert.deepEqual(readdirSync(path.join(box.root, 'var/release')), [], 'and no temporary directory');
});

test('assets refuses a package whose manifest name differs from the configuration', (t) => {
  const box = releaseSandbox(t);
  edit(box.root, 'packages/fixture-lib/package.json', m => ({ ...m, name: 'renamed' }));
  git(box.root, 'commit', '--quiet', '-am', 'rename');
  const tag = box.tag('v0.0.1', git(box.root, 'rev-parse', 'HEAD'));
  stop(() => release.assets(context(box), tag), /packages\/fixture-lib\/package\.json: name renamed, config\/release\.json declares fixture-lib/);
});

test('assets compares the archives with the commit of the tag, not with the working tree', (t) => {
  const box = releaseSandbox(t);
  const tag = box.tag('v0.0.1');
  edit(box.root, 'packages/fixture-lib/package.json', m => ({ ...m, dependencies: { x: '^1.0.0' } }));
  stop(() => release.assets(context(box), tag), /fixture-lib-npm-0\.0\.1\.tgz: the packed package\.json differs from packages\/fixture-lib\/package\.json of the commit/);
});

test('npm pack that writes none or several archives fails and names them', (t) => {
  const box = releaseSandbox(t);
  const tag = box.tag('v0.0.1');
  box.env.STUB_NPM_MODE = 'two';
  stop(() => release.assets(context(box), tag), /npm pack of packages\/fixture-lib wrote \[extra\.txt, fixture-lib-0\.0\.1\.tgz\], not one archive/);
  box.env.STUB_NPM_MODE = 'none';
  stop(() => release.assets(context(box), tag), /npm pack of packages\/fixture-lib wrote \[\], not one archive/);
});

test('a Go module tag builds no archive and clears the directory', (t) => {
  const box = releaseSandbox(t);
  const target = path.join(box.root, 'var/release/assets');
  mkdirSync(target, { recursive: true });
  writeFileSync(path.join(target, 'stale.tgz'), 'old');
  assert.deepEqual(release.assets(context(box), box.tag('packages/fixture-go/v0.0.1')), []);
  assert.deepEqual(readdirSync(target), []);
  assert.deepEqual(box.npmCalls(), []);
});

test('publish creates the release with the notes and the archives', (t) => {
  const box = releaseSandbox(t);
  const tag = box.tag('v0.0.1');
  release.assets(context(box), tag);
  box.checkRuns([]);
  const lines: string[] = [];
  const names = release.publish(context(box, { log: line => lines.push(line) }), tag);
  const target = path.join(box.root, 'var/release/assets');
  const state = box.state();
  assert.ok(state.calls.some((args: string[]) => args.at(-3) === `repos/polyspec/kit-fixture/git/ref/tags/${tag}`), 'the tag is verified on the remote first');
  assert.deepEqual(state.created, { tag, name: tag, draft: 'true' });
  assert.deepEqual(state.uploads, names.map(name => ({ name, input: path.join(target, name), type: 'Content-Type: application/octet-stream' })));
  assert.deepEqual(state.byId?.['42']?.assets.map(asset => asset.name), names, 'each archive is uploaded to the release of its id');
  assert.deepEqual(readJson(box.root, 'var/release/v0.0.1.json'), { id: 42 }, 'the id of the draft is recorded for undraft');
  assert.equal(state.notes, '- The first entry of 0.0.1.\n- The second entry of 0.0.1.\n');
  assert.ok(lines.some(line => line.includes('creating the draft GitHub Release with 4 archives')), lines.join('\n'));
});

test('publish with a missing archive fails before any request', (t) => {
  const box = releaseSandbox(t);
  const tag = box.tag('v0.0.1');
  box.checkRuns([]);
  stop(() => release.publish(context(box), tag), /var\/release\/assets lacks \[fixture-lib-npm-0\.0\.1\.tgz, fixture-app-npm-0\.0\.1\.tgz, polyspec-kit-fixture-php-0\.0\.1\.zip, kit_fixture-0\.0\.1-py3-none-any\.whl\]; make release-assets builds them/);
  assert.deepEqual(box.state().calls, []);
});

test('publish of a Go module tag creates a release without archives, and a failing gh stops', (t) => {
  const box = releaseSandbox(t);
  const tag = box.tag('packages/fixture-go/v0.0.1');
  box.checkRuns([]);
  assert.deepEqual(release.publish(context(box), tag), []);
  assert.deepEqual(box.state().created, { tag, name: tag, draft: 'true' });
  assert.equal(box.state().uploads, undefined, 'a Go module tag uploads no archive');
  assert.deepEqual(readJson(box.root, 'var/release/packages/fixture-go/v0.0.1.json'), { id: 42 });
  box.checkRuns([], { failRelease: true });
  stop(() => release.publish(context(box), tag), /gh api .*--method POST repos\/polyspec\/kit-fixture\/releases .* exited with 1: gh: release failed/);
  box.checkRuns([], { missingTag: true });
  stop(() => release.publish(context(box), tag), /the tag packages\/fixture-go\/v0\.0\.1 is not on https:\/\/[^ ]+; push it before the release is published/);
});

test('publish needs the section of the version', (t) => {
  const box = releaseSandbox(t);
  const tag = box.tag('v0.0.1');
  release.assets(context(box), tag);
  writeFileSync(path.join(box.root, 'CHANGELOG.md'), '# Changelog\n');
  box.checkRuns([]);
  stop(() => release.publish(context(box), tag), /CHANGELOG\.md: no section ## 0\.0\.1/);
  assert.deepEqual(box.state().calls, []);
});

test('coverage accepts a checkout whose package files are all classified', (t) => {
  const box = releaseSandbox(t);
  assert.deepEqual(release.coverage(context(box)), []);
});

test('coverage names each package file that no list classifies, each stale entry and each double entry', (t) => {
  const box = releaseSandbox(t);
  const extra = ['extra/package.json', 'extra/composer.json', 'extra/Cargo.toml', 'extra/pyproject.toml', 'extra/go.mod', 'extra/VERSION'];
  mkdirSync(path.join(box.root, 'extra'));
  for (const file of extra) writeFileSync(path.join(box.root, file), file.endsWith('.json') ? '{}\n' : '1\n');
  const problems = release.coverage(context(box));
  for (const file of extra) {
    assert.ok(problems.includes(`${file} is neither released nor listed as not released; add it to manifests, notReleased or goModules in config/release.json`), problems.join('\n'));
  }
  const config = readJson<release.ReleaseConfig>(box.root, 'config/release.json');
  const broken = { ...config, notReleased: { ...config.notReleased, 'gone/package.json': 'removed', 'package.json': 'also' } };
  const later = release.coverage(context(box, { config: broken }));
  assert.ok(later.includes('gone/package.json is listed in notReleased of config/release.json but is not a package file of the checkout; remove it from the list'), later.join('\n'));
  assert.ok(later.includes('package.json is in both manifests and notReleased of config/release.json; list it once'), later.join('\n'));
});

// K167: kit writes files of every repository: the copies of kit.copies of the package that runs (make kit-sync), the Composer
// project of PHPUnit that install-tools installs and the lock tree of mise under .mise/locks (make toolchain-lock). Coverage
// takes them as not released, so no repository lists them by hand; a package file of the repository is still reported.
test('coverage takes the files that kit writes as not released, and still names a package file of the repository (K167)', (t) => {
  const box = releaseSandbox(t);
  const written = ['.mise/locks/pypi-vulture/2.16/pyproject.toml', 'config/phpunit/composer.json'];
  const owned = ['config/php-lint/composer.json', 'tools/composer.json'];
  for (const file of [...written, ...owned]) {
    mkdirSync(path.dirname(path.join(box.root, file)), { recursive: true });
    writeFileSync(path.join(box.root, file), '{}\n');
  }
  assert.deepEqual(release.coverage(context(box)), owned.map(file => `${file} is neither released nor listed as not released; add it to manifests, notReleased or goModules in config/release.json`));
});

test('coverage skips node_modules, var, .tools and the vendored fixture, and reads new files that Git does not ignore', (t) => {
  const box = releaseSandbox(t);
  for (const directory of ['node_modules/x', 'sub/node_modules/y', 'var/z', '.tools/w', 'tests/kit/fixture/v']) {
    mkdirSync(path.join(box.root, directory), { recursive: true });
    writeFileSync(path.join(box.root, directory, 'package.json'), '{}');
  }
  assert.deepEqual(release.coverage(context(box)), [], 'the excluded directories are skipped');
  mkdirSync(path.join(box.root, 'fresh'));
  writeFileSync(path.join(box.root, 'fresh/package.json'), '{}');
  assert.deepEqual(release.coverage(context(box)), ['fresh/package.json is neither released nor listed as not released; add it to manifests, notReleased or goModules in config/release.json']);
});

const cli = (box: Box, args: string[]) => spawnSync(process.execPath, [tool(import.meta.resolve('../../scripts/kit/release.mts')), ...args], { cwd: box.root, env: { ...box.env, GITHUB_REPOSITORY: REPOSITORY }, encoding: 'utf8' });

test('the command line runs each step, prints a line per step and exits with 1 on a failure', (t) => {
  const box = releaseSandbox(t);
  const tag = box.release('0.0.1');
  let result = cli(box, ['verify', tag]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, new RegExp(`\\[release\\] v0\\.0\\.1: the commit ${box.commit} is on origin/main and passed push-gate, ci-passed`));
  result = cli(box, ['assets', tag]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /\[release\] v0\.0\.1: built fixture-lib-npm-0\.0\.1\.tgz, fixture-app-npm-0\.0\.1\.tgz, polyspec-kit-fixture-php-0\.0\.1\.zip, kit_fixture-0\.0\.1-py3-none-any\.whl in var\/release\/assets/);
  box.checkRuns([]);
  result = cli(box, ['publish', tag]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /created the GitHub Release with fixture-lib-npm-0\.0\.1\.tgz/);
  result = cli(box, ['coverage']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /every package file is classified in config\/release\.json/);
  mkdirSync(path.join(box.root, 'stray'));
  writeFileSync(path.join(box.root, 'stray/composer.json'), '{}');
  result = cli(box, ['coverage']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /\[release\] coverage: stray\/composer\.json is neither released/);
  assert.match(result.stderr, /\[release\] coverage failed: 1 package files are not classified/);
});

test('the command line refuses a missing mode, missing arguments and extra arguments with the usage', (t) => {
  const box = releaseSandbox(t);
  for (const args of [[], ['verify'], ['candidate-assets'], ['bogus', 'v0.0.1'], ['verify', 'v0.0.1', 'extra'], ['candidate-assets', '0.0.1', 'extra'], ['coverage', 'v0.0.1']]) {
    const result = cli(box, args);
    assert.equal(result.status, 2, args.join(' '));
    assert.match(result.stderr, /usage: node scripts\/kit\/release\.mts tag\|verify\|assets\|publish\|undraft\|go-tags TAG \| candidate-assets VERSION \| coverage/);
  }
});

test('make runs each release step with the tag of the environment and fails without it', (t) => {
  const box = releaseSandbox(t);
  box.release('0.0.1');
  const make = (...args: string[]) => spawnSync('make', [...KIT_MAKE, ...args], { cwd: box.root, env: { ...box.env, GITHUB_REPOSITORY: REPOSITORY }, encoding: 'utf8' });
  for (const target of ['release-verify', 'release-assets', 'release-publish', 'release-undraft']) {
    const result = make(target);
    assert.equal(result.status, 2, target);
    assert.match(result.stdout + result.stderr, new RegExp(`${target}: TAG is required, for example make ${target} TAG=v0\\.0\\.1`));
  }
  let result = make('release-candidate-assets');
  assert.equal(result.status, 2, 'the candidate target requires VERSION');
  assert.match(result.stdout + result.stderr, /release-candidate-assets: VERSION is required, for example make release-candidate-assets VERSION=0\.0\.1/);
  result = make('release-candidate-assets', 'VERSION=0.0.1');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /\[release\] HEAD candidate 0\.0\.1: built fixture-lib-npm-0\.0\.1\.tgz/);
  result = make('release-verify', 'TAG=v0.0.1');
  assert.equal(result.status, 0, result.stderr);
  result = make('release-coverage');
  assert.equal(result.status, 0, result.stderr);
});

test('an archive is named <package>-<language>-<version>.<ext>', () => {
  assert.equal(release.assetName('@polyspec/x', 'npm', '0.0.5', 'tgz'), 'polyspec-x-npm-0.0.5.tgz');
  assert.equal(release.assetName('polyspec/x', 'php', '0.0.5', 'zip'), 'polyspec-x-php-0.0.5.zip');
  assert.equal(release.assetName('polyspec/x-extension', 'php', '0.0.5', 'zip'), 'polyspec-x-extension-php-0.0.5.zip');
  assert.equal(release.assetName('plain', 'npm', '1.0.0', 'tgz'), 'plain-npm-1.0.0.tgz');
});

test('the archive names of a repository with scoped packages differ by language and cannot collide', (t) => {
  const box = releaseSandbox(t, { mutate: (root: string) => {
    edit(root, 'packages/fixture-app/package.json', m => ({ ...m, name: '@polyspec/fixture-app' }));
    edit(root, 'packages/fixture-php/composer.json', m => ({ ...m, name: 'polyspec/fixture-app' }));
    edit<ConfigJson>(root, 'config/release.json', c => ({
      ...c,
      packages: c.packages.map(p => (p.kind === 'npm' && p.name === 'fixture-app' ? { ...p, name: '@polyspec/fixture-app' } : p.kind === 'composer' ? { ...p, name: 'polyspec/fixture-app' } : p)),
    }));
  } });
  const { config } = context(box);
  assert.deepEqual(release.assetNames(config, '0.0.1'), ['fixture-lib-npm-0.0.1.tgz', 'polyspec-fixture-app-npm-0.0.1.tgz', 'polyspec-fixture-app-php-0.0.1.zip', 'kit_fixture-0.0.1-py3-none-any.whl']);
});

test('the output of npm pack is renamed to the archive name', (t) => {
  const box = releaseSandbox(t, { mutate: (root: string) => {
    edit(root, 'packages/fixture-app/package.json', m => ({ ...m, name: '@polyspec/fixture-app' }));
    edit<ConfigJson>(root, 'config/release.json', c => ({
      ...c,
      packages: c.packages.map(p => (p.name === 'fixture-app' ? { ...p, name: '@polyspec/fixture-app' } : p)),
    }));
  } });
  const ctx = context(box);
  const names = release.assets(ctx, box.tag('v0.0.1'));
  assert.deepEqual(names, ['fixture-lib-npm-0.0.1.tgz', 'polyspec-fixture-app-npm-0.0.1.tgz', 'polyspec-kit-fixture-php-0.0.1.zip', 'kit_fixture-0.0.1-py3-none-any.whl']);
  assert.deepEqual(readdirSync(path.join(box.root, 'var/release/assets')).sort(), [...names].sort(), 'no file keeps the name that npm pack gave');
  // names holds four archives.
  const [, app] = names;
  assert.ok(app);
  assert.equal(parseJson<NpmManifest>(release.packedManifest(ctx, path.join(box.root, 'var/release/assets', app)), 'npm-manifest.schema.json', app).name, '@polyspec/fixture-app');
});

const sha256 = (file: string) => spawnSync('shasum', ['-a', '256', file], { encoding: 'utf8' }).stdout.split(' ')[0];

test('a second assets run of the same tag writes the same bytes at another time zone', (t) => {
  const box = releaseSandbox(t);
  const tag = box.tag('v0.0.1');
  const zip = path.join(box.root, 'var/release/assets/polyspec-kit-fixture-php-0.0.1.zip');
  const at = (zone: string) => release.context(box.root, { env: { ...box.env, GITHUB_REPOSITORY: REPOSITORY, TZ: zone } });
  release.assets(at('Pacific/Auckland'), tag);
  const first = sha256(zip);
  release.assets(at('America/Los_Angeles'), tag);
  assert.equal(sha256(zip), first, 'the bytes do not depend on the time zone');
  const listing = spawnSync('unzip', ['-Z', '-T', zip], { encoding: 'utf8', env: { ...process.env, TZ: 'UTC' } }).stdout.split('\n').filter(line => /^[-d]r/.test(line));
  assert.equal(listing.length, 4, listing.join('\n'));
  for (const line of listing) {
    assert.match(line, / stor /, `the entry is stored: ${line}`);
    assert.match(line, /20010203\.040506/, `the entry has the time of the commit: ${line}`);
  }
});

test('the zip of a tree with other content has other bytes', (t) => {
  const zipOf = (content: string) => {
    const box = releaseSandbox(t, { mutate: (root: string) => writeFileSync(path.join(root, 'packages/fixture-php/src/Engine.php'), content) });
    release.assets(context(box), box.tag('v0.0.1'));
    return sha256(path.join(box.root, 'var/release/assets/polyspec-kit-fixture-php-0.0.1.zip'));
  };
  assert.notEqual(zipOf('<?php\n'), zipOf('<?php\n// changed\n'));
});

test('publish replaces the draft of an earlier run and never replaces a public release', (t) => {
  const box = releaseSandbox(t);
  const tag = box.tag('v0.0.1');
  release.assets(context(box), tag);
  box.checkRuns([]);
  box.releases([{ id: 5, tag_name: tag, draft: true, assets: [] }]);
  const lines: string[] = [];
  release.publish(context(box, { log: line => lines.push(line) }), tag);
  const calls = box.state().calls;
  assert.deepEqual(box.state().deleted, ['5'], 'the draft of the earlier run is deleted by its id');
  assert.ok(calls.some((args: string[]) => args.includes('--method') && args.includes('POST') && args.includes('draft=true')), 'the release is created as a draft');
  assert.ok(lines.some(line => line.includes('removing the draft release 5 of an earlier run')), lines.join('\n'));
  box.releases([{ id: 5, tag_name: tag, draft: false, assets: [] }]);
  stop(() => release.publish(context(box), tag), /the release v0\.0\.1 is already public; a public release is not replaced/);
});

test('undraft finds the draft by the id that publish recorded, also while the list of releases does not show it yet (K79)', (t) => {
  const box = releaseSandbox(t);
  const tag = box.tag('v0.0.1');
  box.checkRuns([], { byId: { 42: { id: 42, tag_name: tag, draft: true, assets: [] } } });
  box.releases([]);
  stop(() => release.undraft(context(box), tag), /var\/release\/v0\.0\.1\.json is missing; make release-publish writes it/);
  mkdirSync(path.join(box.root, 'var/release'), { recursive: true });
  writeFileSync(path.join(box.root, 'var/release/v0.0.1.json'), JSON.stringify({ id: 42 }));
  assert.equal(release.undraft(context(box), tag), true);
  assert.deepEqual(box.state().byId?.['42']?.draft, false);
  assert.equal(release.undraft(context(box), tag), false, 'a public release stays as it is');
  assert.equal(box.state().patched?.length, 1, 'a public release is not edited again');
});

