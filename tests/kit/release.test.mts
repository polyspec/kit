// Tests of the release tool (scripts/kit/release.mts): the configuration, the tag, the manifest rules,
// assets, publish and coverage. Each case works in a committed copy of the fixture (release-sandbox.mts) with stubs of
// gh and npm on PATH; real git, tar and unzip run, and the K871 case runs the real Composer and PHP of the main checkout.
// No case reaches GitHub or a registry.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { pathToFileURL } from 'node:url';
import { checkConfig } from '../../scripts/kit/kit-check.mts';
import { toolCommand, toolsEnvironment } from '../../scripts/kit/mise-tools.mts';
import { Stop } from '../../scripts/kit/process.mts';
import * as release from '../../scripts/kit/release.mts';
import { git, readJson, releaseSandbox, writeJson } from './release-sandbox.mts';
import { KIT_MAKE, tool } from './kit-tools.mts';
import { readComposerLockFile, type NpmManifest } from '../../scripts/kit/manifests.mts';
import { parseJson } from '../../scripts/kit/schema-validate.mts';
import { known } from './known.mts';

const REPOSITORY = 'example/kit-fixture';
// This checkout, which installs its own tools, a worktree too (K858): the real Composer of the K871 consumer.
const CHECKOUT = path.join(import.meta.dirname, '..', '..');
type Box = ReturnType<typeof releaseSandbox>;
// The kit that npm installs under node_modules: its kit.mk and kit-bootstrap.mk, which a consumer's Makefile includes, and a parity
// tool that prints no implementation (the real parity read is covered by its own tests). Node strips no types under node_modules, so the
// bootstrap names mjs, as a packed package does.
function installedKit(root: string) {
  const from = path.join(CHECKOUT, 'scripts/kit');
  const to = path.join(root, 'node_modules/@polyspec/kit/scripts/kit');
  mkdirSync(to, { recursive: true });
  cpSync(path.join(from, 'kit.mk'), path.join(to, 'kit.mk'));
  writeFileSync(path.join(to, 'kit-bootstrap.mk'), readFileSync(path.join(from, 'kit-bootstrap.mk'), 'utf8').replace('KIT_EXT := mts', 'KIT_EXT := mjs'));
  writeFileSync(path.join(to, 'parity.mjs'), 'process.exit(0);\n');
}
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

test('latest takes git\'s version sort and skips a pre-release that git sorts above its release (K932)', (t) => {
  const box = releaseSandbox(t, { version: '0.0.3' });
  const ctx = context(box);
  for (const tag of ['v0.0.9', 'v0.0.10', 'v0.0.10-rc1']) git(ctx.root, 'tag', tag);
  assert.equal(release.latestTag(ctx), 'v0.0.10');
});

test('latest fails when no release tag is reachable', (t) => {
  const ctx = context(releaseSandbox(t));
  stop(() => release.latestTag(ctx), /no release tag is reachable from HEAD/);
});

// K911: a release is the tag vX.Y.Z; release-tag creates the Go module tags with it, so no release starts from a module tag.
test('a release tag is vX.Y.Z', () => {
  assert.equal(release.parseTag('v1.2.3'), '1.2.3');
  for (const tag of ['1.2.3', 'v1.2', 'v01.2.3', 'v1.2.3-rc1', 'v1.2.3/', '', 'packages/fixture-go/v1.2.3']) stop(() => release.parseTag(tag), /a release tag is vX\.Y\.Z$/);
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
  const original = readJson<ConfigJson>(box.root, 'config/release.json');
  // K911: the CI run is the evidence of a release, so the configuration names no checks.
  stop(load(c => ({ ...c, checks: ['ci-passed'] })), /must NOT have additional properties/);
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
  stop(load(() => ({ ...original, packages: original.packages.map(p => (p.kind === 'composer' ? { ...p, generated: [{ kind: 'make', target: 'fixture-native', outputs: ['../shared.c'] }] } : p)) })), /generated make outputs of packages\/fixture-php must be one or more package-relative paths/);
  git(box.root, 'rm', '-q', '-f', 'config/release.json');
  stop(() => release.loadConfig(box.root), /config\/release\.json: the file is missing/);
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
  assert.match(release.releaseNotes(context(box), 'v0.0.1'), /blob\/v0\.0\.1\/CHANGELOG\.md#001\)\.\n$/, 'the anchor of a heading without an id is the version without dots');
});

// K785: the form of a dependency is the package manager's to resolve; the release keeps only the tag version of its own packages.
test('assets builds one archive per package of the configuration', (t) => {
  const box = releaseSandbox(t);
  const tag = box.tag('v0.0.1');
  const lines: string[] = [];
  const names = release.assets(context(box, { log: line => lines.push(line) }), tag);
  assert.deepEqual(names, ['fixture-lib-npm-0.0.1.tgz', 'fixture-app-npm-0.0.1.tgz', 'polyspec-kit-fixture-php-0.0.1.zip', 'kit_fixture-0.0.1-py3-none-any.whl', 'packages.json']);
  const target = path.join(box.root, 'var/release/assets');
  assert.deepEqual(readdirSync(target).sort(), [...names].sort());
  assert.equal(lines.filter(line => line.includes('packing')).length, 4, lines.join('\n'));
  assert.deepEqual(box.npmCalls().map(call => path.basename(call.cwd)), ['fixture-lib', 'fixture-app']);
});

test('K712 builds candidate archives from committed HEAD without a release tag', (t) => {
  const generatedSource = '#include <sqlite3ext.h>\nSQLITE_EXTENSION_INIT1\n';
  const box = releaseSandbox(t, { mutate(root) {
    writeFileSync(path.join(root, 'packages/fixture-lib/shared.c'), generatedSource);
    writeFileSync(path.join(root, 'Makefile'), `${existsSync(path.join(root, 'Makefile')) ? readFileSync(path.join(root, 'Makefile'), 'utf8') : ''}\nfixture-native:\n\tmkdir -p packages/fixture-php/src/native && cp packages/fixture-lib/shared.c packages/fixture-php/src/native/shared.c\n`);
    edit<ConfigJson>(root, 'config/release.json', config => ({
      ...config,
      packages: config.packages.map(item => item.directory === 'packages/fixture-php'
        ? { ...item, generated: [{ kind: 'make', target: 'fixture-native', outputs: ['src/native/shared.c'] }] }
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
    'fixture-app-npm-0.0.1.tgz', 'fixture-lib-npm-0.0.1.tgz', 'kit_fixture-0.0.1-py3-none-any.whl', 'packages.json', 'polyspec-kit-fixture-php-0.0.1.zip',
  ]);
  const composerArchive = path.join(box.root, 'var/release/assets', 'polyspec-kit-fixture-php-0.0.1.zip');
  assert.equal(spawnSync('unzip', ['-p', composerArchive, 'src/native/shared.c'], { encoding: 'utf8' }).stdout, generatedSource);
  assert.deepEqual(box.npmCalls().map(call => path.basename(call.cwd)), ['fixture-lib', 'fixture-app']);
  stop(() => release.candidateAssets(ctx, 'v0.0.1'), /candidate version .* is not X\.Y\.Z/);
  assert.equal(git(box.root, 'tag', '--list'), '', 'candidate generation does not create or require a tag');
});

// K929 and K930: a make entry of a package runs its target in a copy of the tagged commit, and the pack packs the declared outputs.
// The copy holds the tracked files of the commit and no link into the checkout; the make run gets the tools of the checkout on its PATH (K930).
test('K939 a make entry runs its target in the checkout and packs the declared output, then removes it', (t) => {
  const box = releaseSandbox(t, { mutate(root) {
    const makefile = path.join(root, 'Makefile');
    writeFileSync(makefile, `${existsSync(makefile) ? readFileSync(makefile, 'utf8') : ''}\nfixture-gen:\n\tmkdir -p packages/fixture-php/src/gen && printf 'generated by make' > packages/fixture-php/src/gen/out.txt\n`);
    edit<ConfigJson>(root, 'config/release.json', config => ({
      ...config,
      packages: config.packages.map(item => (item.directory === 'packages/fixture-php' ? { ...item, generated: [{ kind: 'make', target: 'fixture-gen', outputs: ['src/gen/out.txt'] }] } : item)),
    }));
  } });
  const output: string[] = [];
  assert.equal(release.main(['candidate-assets', '0.0.1'], { root: box.root, env: context(box).env, print: line => output.push(line), error: line => output.push(line) }), 0, output.join('\n'));
  const zip = path.join(box.root, 'var/release/assets', 'polyspec-kit-fixture-php-0.0.1.zip');
  assert.equal(spawnSync('unzip', ['-p', zip, 'src/gen/out.txt'], { encoding: 'utf8' }).stdout, 'generated by make');
  assert.equal(existsSync(path.join(box.root, 'packages/fixture-php/src/gen/out.txt')), false, 'the checkout receives no generated file');
});

test('K929 a make entry whose target does not write its declared output fails the pack', (t) => {
  const box = releaseSandbox(t, { mutate(root) {
    const makefile = path.join(root, 'Makefile');
    writeFileSync(makefile, `${existsSync(makefile) ? readFileSync(makefile, 'utf8') : ''}\nfixture-silent:\n\ttrue\n`);
    edit<ConfigJson>(root, 'config/release.json', config => ({
      ...config,
      packages: config.packages.map(item => (item.directory === 'packages/fixture-php' ? { ...item, generated: [{ kind: 'make', target: 'fixture-silent', outputs: ['src/gen/out.txt'] }] } : item)),
    }));
  } });
  stop(() => release.candidateAssets(context(box), '0.0.1'), /make fixture-silent did not write packages\/fixture-php\/src\/gen\/out\.txt/);
});

test('K930 a make output that the commit tracks fails the pack and names the path', (t) => {
  const box = releaseSandbox(t, { mutate(root) {
    const makefile = path.join(root, 'Makefile');
    writeFileSync(makefile, `${existsSync(makefile) ? readFileSync(makefile, 'utf8') : ''}\nfixture-tracked:\n\tprintf tracked > packages/fixture-php/composer.json\n`);
    edit<ConfigJson>(root, 'config/release.json', config => ({
      ...config,
      packages: config.packages.map(item => (item.directory === 'packages/fixture-php' ? { ...item, generated: [{ kind: 'make', target: 'fixture-tracked', outputs: ['composer.json'] }] } : item)),
    }));
  } });
  stop(() => release.candidateAssets(context(box), '0.0.1'), /packages\/fixture-php\/composer\.json is tracked at commit/);
});

test('K939 the make run of an entry sees the var and the node_modules of the checkout', (t) => {
  const box = releaseSandbox(t, { mutate(root) {
    const makefile = path.join(root, 'Makefile');
    writeFileSync(makefile, `${existsSync(makefile) ? readFileSync(makefile, 'utf8') : ''}\nfixture-clean:\n\ttest -e var/tools/bin/npm && test -e node_modules/fixture && mkdir -p packages/fixture-php/src/gen && printf clean > packages/fixture-php/src/gen/out.txt\n`);
    edit<ConfigJson>(root, 'config/release.json', config => ({
      ...config,
      packages: config.packages.map(item => (item.directory === 'packages/fixture-php' ? { ...item, generated: [{ kind: 'make', target: 'fixture-clean', outputs: ['src/gen/out.txt'] }] } : item)),
    }));
  } });
  // The checkout has its own node_modules, which the make run reaches.
  mkdirSync(path.join(box.root, 'node_modules/fixture'), { recursive: true });
  const output: string[] = [];
  assert.equal(release.main(['candidate-assets', '0.0.1'], { root: box.root, env: context(box).env, print: line => output.push(line), error: line => output.push(line) }), 0, output.join('\n'));
  const zip = path.join(box.root, 'var/release/assets', 'polyspec-kit-fixture-php-0.0.1.zip');
  assert.equal(spawnSync('unzip', ['-p', zip, 'src/gen/out.txt'], { encoding: 'utf8' }).stdout, 'clean');
});

test('K939 the pack runs exactly make -C <checkout> <target> with the tools of the checkout on PATH and no npm call other than npm pack', (t) => {
  const box = releaseSandbox(t, { mutate(root) {
    const makefile = path.join(root, 'Makefile');
    writeFileSync(makefile, `${existsSync(makefile) ? readFileSync(makefile, 'utf8') : ''}\nfixture-once:\n\tmkdir -p packages/fixture-php/src/gen && printf once > packages/fixture-php/src/gen/out.txt\n`);
    edit<ConfigJson>(root, 'config/release.json', config => ({
      ...config,
      packages: config.packages.map(item => (item.directory === 'packages/fixture-php' ? { ...item, generated: [{ kind: 'make', target: 'fixture-once', outputs: ['src/gen/out.txt'] }] } : item)),
    }));
  } });
  // A make on the PATH records its arguments and the PATH it gets, then runs the real make.
  const real = spawnSync('/bin/sh', ['-c', 'command -v make'], { encoding: 'utf8' }).stdout.trim();
  const bin = path.join(box.root, '.stubs/make-bin');
  const log = path.join(box.root, '.stubs/make.log');
  mkdirSync(bin, { recursive: true });
  writeFileSync(path.join(bin, 'make'), `#!/bin/sh\nprintf '%s\\tPATH=%s\\n' "$*" "$PATH" >> '${log}'\nexec '${real}' "$@"\n`);
  chmodSync(path.join(bin, 'make'), 0o755);
  const env = { ...context(box).env, PATH: `${bin}${path.delimiter}${box.env.PATH}` };
  const output: string[] = [];
  assert.equal(release.main(['candidate-assets', '0.0.1'], { root: box.root, env, print: line => output.push(line), error: line => output.push(line) }), 0, output.join('\n'));
  const calls = readFileSync(log, 'utf8').trim().split('\n');
  assert.equal(calls.length, 1, calls.join('\n'));
  const first = known(calls[0], 'the make call');
  const call = /^-C (\S+) fixture-once\tPATH=(.+)$/.exec(first);
  assert.ok(call, first);
  assert.equal(call[1], box.root, 'make runs in the checkout');
  const path0 = known(call[2], 'PATH').split(path.delimiter)[0];
  assert.equal(path0, path.join(box.root, 'var/tools/bin'), 'the tools of the checkout come first on PATH');
  assert.deepEqual(box.npmCalls().filter(entry => entry.args[0] !== 'pack'), [], 'the pack starts no package manager but npm pack');
});

// The test shows that kit itself requires no php-config; it does not prove that the make run avoids machine tools.
test('K930 a make entry whose target needs no PHP passes when no php-config is installed in the checkout', (t) => {
  const box = releaseSandbox(t, { mutate(root) {
    const makefile = path.join(root, 'Makefile');
    writeFileSync(makefile, `${existsSync(makefile) ? readFileSync(makefile, 'utf8') : ''}\nfixture-gen:\n\tmkdir -p packages/fixture-php/src/gen && printf 'generated by make' > packages/fixture-php/src/gen/out.txt\n`);
    edit<ConfigJson>(root, 'config/release.json', config => ({
      ...config,
      packages: config.packages.map(item => (item.directory === 'packages/fixture-php' ? { ...item, generated: [{ kind: 'make', target: 'fixture-gen', outputs: ['src/gen/out.txt'] }] } : item)),
    }));
  } });
  rmSync(path.join(box.root, 'var/tools/bin/php-config'));
  const output: string[] = [];
  assert.equal(release.main(['candidate-assets', '0.0.1'], { root: box.root, env: context(box).env, print: line => output.push(line), error: line => output.push(line) }), 0, output.join('\n'));
  const zip = path.join(box.root, 'var/release/assets', 'polyspec-kit-fixture-php-0.0.1.zip');
  assert.equal(spawnSync('unzip', ['-p', zip, 'src/gen/out.txt'], { encoding: 'utf8' }).stdout, 'generated by make');
});

// F1: npm builds its output in its own lifecycle (the prepack script), so a make entry on an npm package is refused.
test('K930 an npm package that declares a make entry is refused, pointing to its prepack script', (t) => {
  const box = releaseSandbox(t);
  edit<ConfigJson>(box.root, 'config/release.json', config => ({
    ...config,
    packages: config.packages.map(item => (item.directory === 'packages/fixture-app' ? { ...item, generated: [{ kind: 'make', target: 'fixture-gen', outputs: ['out.txt'] }] } : item)),
  }));
  stop(() => release.loadConfig(box.root), /npm package fixture-app declares generated make entries.*prepack/);
});

// K929: the zip that appends the generated files of a Composer archive is checked before the archives are built, and a failed
// append leaves the archives of the last successful run unchanged.
// K939 (design B): the make run is in the checkout, which the pack refuses unless it is the tagged commit with no changed,
// untracked or outside-linked path. The stale output of an earlier run is ignored by Git, as a generated directory is.
test('K939 a make entry whose Makefile includes kit-bootstrap.mk and whose checkout has config/parity.json packs the output', (t) => {
  const box = releaseSandbox(t, { mutate(root) {
    // The installed kit of the consumer: a copy of the kit sources in node_modules, as npm installs the package.
    installedKit(root);
    writeFileSync(path.join(root, 'config/parity.json'), '{"schema":1,"units":[],"implementations":[]}\n');
    const makefile = path.join(root, 'Makefile');
    writeFileSync(makefile, `${existsSync(makefile) ? readFileSync(makefile, 'utf8') : ''}\ninclude node_modules/@polyspec/kit/scripts/kit/kit-bootstrap.mk\n\nfixture-gen:\n\tmkdir -p packages/fixture-php/src/gen && printf 'generated by make' > packages/fixture-php/src/gen/out.txt\n`);
    edit<ConfigJson>(root, 'config/release.json', config => ({
      ...config,
      packages: config.packages.map(item => (item.directory === 'packages/fixture-php' ? { ...item, generated: [{ kind: 'make', target: 'fixture-gen', outputs: ['src/gen/out.txt'] }] } : item)),
    }));
  } });
  // The node of the checkout runs the parity read of kit.mk at parse time, as make install installs it.
  writeFileSync(path.join(box.root, 'var/tools/bin/node'), `#!/bin/sh\nexec '${process.execPath}' "$@"\n`);
  chmodSync(path.join(box.root, 'var/tools/bin/node'), 0o755);
  const output: string[] = [];
  assert.equal(release.main(['candidate-assets', '0.0.1'], { root: box.root, env: context(box).env, print: line => output.push(line), error: line => output.push(line) }), 0, output.join('\n'));
  const zip = path.join(box.root, 'var/release/assets', 'polyspec-kit-fixture-php-0.0.1.zip');
  assert.equal(spawnSync('unzip', ['-p', zip, 'src/gen/out.txt'], { encoding: 'utf8' }).stdout, 'generated by make');
});

test('K939 assets refuses a checkout whose tracked file differs from the tagged commit, or whose HEAD moved past it', (t) => {
  const box = releaseSandbox(t);
  const tag = box.tag('v0.0.1');
  edit(box.root, 'packages/fixture-lib/package.json', m => ({ ...m, description: 'changed' }));
  stop(() => release.assets(context(box), tag), /changed or untracked paths: packages\/fixture-lib\/package\.json/);
  git(box.root, 'checkout', '--', 'packages/fixture-lib/package.json');
  writeFileSync(path.join(box.root, 'CHANGELOG.md'), '# Changed after the tag\n');
  git(box.root, 'add', '-A');
  git(box.root, 'commit', '--quiet', '-m', 'after the tag');
  stop(() => release.assets(context(box), tag), /HEAD .* is not .*, the commit that is packed/);
  assert.equal(existsSync(path.join(box.root, 'var/release/assets')), false, 'nothing is packed');
});

test('K939 assets and candidate assets refuse a dependency linked from outside the checkout', (t) => {
  const box = releaseSandbox(t);
  const tag = box.tag('v0.0.1');
  const outside = mkdtempSync(path.join(tmpdir(), 'k939-outside-'));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  mkdirSync(path.join(box.root, 'packages/fixture-app/node_modules'), { recursive: true });
  symlinkSync(outside, path.join(box.root, 'packages/fixture-app/node_modules/fixture-lib'));
  stop(() => release.assets(context(box), tag), /dependency linked from outside the checkout: .*fixture-lib/);
  stop(() => release.candidateAssets(context(box), '0.0.1'), /dependency linked from outside the checkout: .*fixture-lib/);
});

test('K939 a stale declared output is deleted before the run, so a target that writes nothing fails', (t) => {
  const box = releaseSandbox(t, { mutate(root) {
    const makefile = path.join(root, 'Makefile');
    writeFileSync(makefile, `${existsSync(makefile) ? readFileSync(makefile, 'utf8') : ''}\nfixture-silent:\n\ttrue\n`);
    edit<ConfigJson>(root, 'config/release.json', config => ({
      ...config,
      packages: config.packages.map(item => (item.directory === 'packages/fixture-php' ? { ...item, generated: [{ kind: 'make', target: 'fixture-silent', outputs: ['src/gen/out.txt'] }] } : item)),
    }));
  } });
  // The generated directory is ignored by Git, so a stale file of an earlier run is not an untracked path.
  writeFileSync(path.join(box.root, '.gitignore'), '.stubs/\nvar/\nnode_modules/\npackages/fixture-php/src/gen/\n');
  git(box.root, 'add', '-A');
  git(box.root, 'commit', '--quiet', '-m', 'ignore the generated directory');
  const stale = path.join(box.root, 'packages/fixture-php/src/gen/out.txt');
  mkdirSync(path.dirname(stale), { recursive: true });
  writeFileSync(stale, 'stale');
  stop(() => release.candidateAssets(context(box), '0.0.1'), /make fixture-silent did not write packages\/fixture-php\/src\/gen\/out\.txt/);
  assert.equal(existsSync(stale), false, 'the stale output is deleted before the run');
});

const generatedFixture = (t: TestContext) => releaseSandbox(t, { mutate(root) {
  const makefile = path.join(root, 'Makefile');
  writeFileSync(makefile, `${existsSync(makefile) ? readFileSync(makefile, 'utf8') : ''}\nfixture-gen:\n\tmkdir -p packages/fixture-php/src/gen && printf 'generated by make' > packages/fixture-php/src/gen/out.txt\n`);
  edit<ConfigJson>(root, 'config/release.json', config => ({
    ...config,
    packages: config.packages.map(item => (item.directory === 'packages/fixture-php' ? { ...item, generated: [{ kind: 'make', target: 'fixture-gen', outputs: ['src/gen/out.txt'] }] } : item)),
  }));
} });

test('K929 a missing zip fails the pack that appends generated files, naming zip and the install', (t) => {
  const box = generatedFixture(t);
  // Only git on the PATH: the zip check runs before any archive is built, so no other tool is needed.
  const only = mkdtempSync(path.join(tmpdir(), 'no-zip-'));
  t.after(() => rmSync(only, { recursive: true, force: true }));
  const git = spawnSync('/bin/sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
  symlinkSync(git, path.join(only, 'git'));
  stop(() => release.candidateAssets(release.context(box.root, { env: { ...box.env, PATH: only } }), '0.0.1'), /zip is required to append generated files.*brew install zip/);
});

test('K929 a zip that fails its version check fails the pack with its status', (t) => {
  const box = generatedFixture(t);
  const bin = path.join(box.root, '.stubs/zip-bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(path.join(bin, 'zip'), '#!/bin/sh\nexit 3\n');
  chmodSync(path.join(bin, 'zip'), 0o755);
  stop(() => release.candidateAssets(release.context(box.root, { env: { ...box.env, PATH: `${bin}${path.delimiter}${box.env.PATH}` } }), '0.0.1'), /zip -v failed with exit status 3/);
});

test('K929 a failed append leaves the archives of the last run byte for byte and no staged directory', (t) => {
  const box = generatedFixture(t);
  release.candidateAssets(context(box), '0.0.1');
  const assets = path.join(box.root, 'var/release/assets');
  const archive = path.join(assets, 'polyspec-kit-fixture-php-0.0.1.zip');
  const before = readFileSync(archive);
  const names = readdirSync(assets).sort();
  // A zip whose version check passes and whose append fails.
  const bin = path.join(box.root, '.stubs/failing-zip-bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(path.join(bin, 'zip'), '#!/bin/sh\nif [ "$1" = -v ]; then exit 0; fi\nexit 5\n');
  chmodSync(path.join(bin, 'zip'), 0o755);
  stop(() => release.candidateAssets(release.context(box.root, { env: { ...box.env, PATH: `${bin}${path.delimiter}${box.env.PATH}` } }), '0.0.1'), /zip failed while adding src\/gen\/out\.txt/);
  assert.deepEqual(readFileSync(archive), before, 'the archive of the last run is unchanged');
  assert.deepEqual(readdirSync(assets).sort(), names, 'the assets directory holds the same archives');
  assert.deepEqual(readdirSync(path.join(box.root, 'var/release')).filter(name => name.startsWith('assets.')), [], 'the staged directory is removed');
});

// K871: the release publishes packages.json, one flat Composer repository of its Composer packages beside the archives, since
// GitHub release assets hold no folder. Each package is its composer.json of the commit at the release version, with a dist of
// its release asset URL and the sha1 of its zip, so a consumer names only the tag in the URL of the repository and Composer reads
// the metadata itself. A consumer with the real Composer of the checkout resolves the package through it.
test('K871: candidate assets hold packages.json, a flat Composer repository that Composer resolves the release through', (t) => {
  const box = releaseSandbox(t, { mutate(root) {
    // The consumer below resolves with no registry, so the package requires only the platform.
    edit(root, 'packages/fixture-php/composer.json', manifest => ({ ...manifest, require: { php: '>=8.2' } }));
  } });
  const output: string[] = [];
  assert.equal(release.main(['candidate-assets', '0.0.1'], { root: box.root, env: context(box).env, print: line => output.push(line), error: line => output.push(line) }), 0, output.join('\n'));
  const target = path.join(box.root, 'var/release/assets');
  const zip = 'polyspec-kit-fixture-php-0.0.1.zip';
  assert.ok(readdirSync(target).includes('packages.json'), readdirSync(target).join(', '));
  const dist = { type: 'zip', url: `https://example.com/polyspec/kit-fixture/releases/download/v0.0.1/${zip}`, shasum: createHash('sha1').update(readFileSync(path.join(target, zip))).digest('hex') };
  const manifest = readJson<ManifestJson>(box.root, 'packages/fixture-php/composer.json');
  // packages.json and composer.lock are the formats of Composer, which no schema of kit describes.
  assert.deepEqual(JSON.parse(readFileSync(path.join(target, 'packages.json'), 'utf8')), { packages: { 'polyspec/kit-fixture': { '0.0.1': { ...manifest, version: '0.0.1', dist } } } });
  const consumer = mkdtempSync(path.join(tmpdir(), 'kit-packages-json-'));
  t.after(() => rmSync(consumer, { recursive: true, force: true }));
  const download = path.join(consumer, 'releases/download/v0.0.1');
  mkdirSync(download, { recursive: true });
  writeFileSync(path.join(download, 'packages.json'), readFileSync(path.join(target, 'packages.json')));
  writeFileSync(path.join(consumer, 'composer.json'), JSON.stringify({
    name: 'example/consumer', type: 'project', license: 'proprietary',
    repositories: [{ type: 'composer', url: pathToFileURL(path.join(download, 'packages.json')).href }, { 'packagist.org': false }],
    require: { 'polyspec/kit-fixture': '0.0.1' },
    config: { platform: { php: '8.2.0' } },
  }));
  const env = { ...toolsEnvironment(CHECKOUT), COMPOSER: 'composer.json', COMPOSER_HOME: path.join(consumer, '.composer'), COMPOSER_DISABLE_NETWORK: '1' };
  const update = spawnSync(toolCommand(CHECKOUT, 'composer'), ['update', '--no-install', '--no-interaction', '--no-plugins', '--no-scripts', '--no-audit'], { cwd: consumer, env, encoding: 'utf8' });
  assert.equal(update.error, undefined, `the Composer of ${CHECKOUT} did not start: ${update.error?.message}; run make install-tools there`);
  assert.equal(update.status, 0, update.stdout + update.stderr);
  const locked = readComposerLockFile(path.join(consumer, 'composer.lock')).packages ?? [];
  assert.deepEqual(locked.map(({ name, version, dist: lockedDist }) => ({ name, version, dist: lockedDist })), [{ name: 'polyspec/kit-fixture', version: '0.0.1', dist }]);
});

test('K712 candidate archives refuse changed source inputs rather than packing worktree files', (t) => {
  const box = releaseSandbox(t, { mutate(root) {
    writeFileSync(path.join(root, 'Makefile'), 'release-assets: build\n');
  } });
  writeFileSync(path.join(box.root, 'packages/fixture-lib/package.json'), '{"name":"changed"}\n');
  stop(() => release.candidateAssets(context(box), '0.0.1'), /packs the committed tree .* changed or untracked paths: packages\/fixture-lib/);
  git(box.root, 'checkout', '--', 'packages/fixture-lib/package.json');
  writeFileSync(path.join(box.root, 'packages/fixture-lib/untracked.js'), 'module.exports = true;\n');
  stop(() => release.candidateAssets(context(box), '0.0.1'), /packs the committed tree .* changed or untracked paths: packages\/fixture-lib\/untracked\.js/);
  rmSync(path.join(box.root, 'packages/fixture-lib/untracked.js'));
  writeFileSync(path.join(box.root, 'Makefile'), 'release-assets: build candidate-build\n');
  stop(() => release.candidateAssets(context(box), '0.0.1'), /packs the committed tree .* changed or untracked paths: Makefile/);
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
    writeFileSync(path.join(root, 'Makefile'), `${existsSync(path.join(root, 'Makefile')) ? readFileSync(path.join(root, 'Makefile'), 'utf8') : ''}\nfixture-native:\n\tmkdir -p packages/fixture-php/src/native && cp packages/fixture-lib/shared.c packages/fixture-php/src/native/shared.c\n`);
    edit<ConfigJson>(root, 'config/release.json', config => ({
      ...config,
      packages: config.packages.map(item => item.directory === 'packages/fixture-php'
        ? { ...item, generated: [{ kind: 'make', target: 'fixture-native', outputs: ['src/native/shared.c'] }] }
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
  // The tarball carries the packed manifest that a prepack writes (STUB_NPM_PACKED); the commit keeps the source of the tag (K939).
  const packed = path.join(box.root, '.stubs/packed-package.json');
  const packedBy = (text: string) => {
    writeFileSync(packed, text);
    return { ...ctx, env: { ...ctx.env, STUB_NPM_PACKED: packed } };
  };
  assert.ok(release.assets(packedBy(expected), tag).includes('polyspec-kit-npm-0.0.1.tgz'));
  for (const [before, after] of [['./dist/run-tests.mjs', './dist/unexpected.mjs'], ['./dist/claude-hook.mjs', './dist/unexpected-hook.mjs'],
    ['"1.0.0"', '"2.0.0"'], ['node check.mjs', 'node other.mjs'], ['"version": "0.0.1"', '"version": "0.0.2"'],
    ['"name": "@polyspec/kit"', '"name": "@polyspec/unexpected"']] as const) {
    stop(() => release.assets(packedBy(expected.replace(before, after)), tag), /the packed package\.json differs/);
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

test('K939 assets refuses a changed working tree instead of packing it', (t) => {
  const box = releaseSandbox(t);
  const tag = box.tag('v0.0.1');
  edit(box.root, 'packages/fixture-lib/package.json', m => ({ ...m, dependencies: { x: '^1.0.0' } }));
  stop(() => release.assets(context(box), tag), /changed or untracked paths: packages\/fixture-lib\/package\.json/);
});

test('npm pack that writes none or several archives fails and names them', (t) => {
  const box = releaseSandbox(t);
  const tag = box.tag('v0.0.1');
  box.env.STUB_NPM_MODE = 'two';
  stop(() => release.assets(context(box), tag), /npm pack of packages\/fixture-lib wrote \[extra\.txt, fixture-lib-0\.0\.1\.tgz\], not one archive/);
  box.env.STUB_NPM_MODE = 'none';
  stop(() => release.assets(context(box), tag), /npm pack of packages\/fixture-lib wrote \[\], not one archive/);
});

test('publish creates the release with the notes and the archives', (t) => {
  const box = releaseSandbox(t);
  const tag = box.tag('v0.0.1');
  release.assets(context(box), tag);
  box.ghState();
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
  assert.ok(lines.some(line => line.includes('creating the draft GitHub Release with 5 assets')), lines.join('\n'));
});

test('publish with a missing archive fails before any request', (t) => {
  const box = releaseSandbox(t);
  const tag = box.tag('v0.0.1');
  box.ghState();
  stop(() => release.publish(context(box), tag), /var\/release\/assets lacks \[fixture-lib-npm-0\.0\.1\.tgz, fixture-app-npm-0\.0\.1\.tgz, polyspec-kit-fixture-php-0\.0\.1\.zip, kit_fixture-0\.0\.1-py3-none-any\.whl, packages\.json\]; make release-assets builds them/);
  assert.deepEqual(box.state().calls, []);
});

test('publish stops on a failing gh and on a tag that the remote lacks', (t) => {
  const box = releaseSandbox(t);
  const tag = box.tag('v0.0.1');
  release.assets(context(box), tag);
  box.ghState({ failRelease: true });
  stop(() => release.publish(context(box), tag), /gh api .*--method POST repos\/polyspec\/kit-fixture\/releases .* exited with 1: gh: release failed/);
  box.ghState({ missingTag: true });
  stop(() => release.publish(context(box), tag), /the tag v0\.0\.1 is not on https:\/\/[^ ]+; push it before the release is published/);
});

test('publish needs the section of the version', (t) => {
  const box = releaseSandbox(t);
  const tag = box.tag('v0.0.1');
  release.assets(context(box), tag);
  writeFileSync(path.join(box.root, 'CHANGELOG.md'), '# Changelog\n');
  box.ghState();
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
  let result = cli(box, ['assets', tag]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /\[release\] v0\.0\.1: built fixture-lib-npm-0\.0\.1\.tgz, fixture-app-npm-0\.0\.1\.tgz, polyspec-kit-fixture-php-0\.0\.1\.zip, kit_fixture-0\.0\.1-py3-none-any\.whl, packages\.json in var\/release\/assets/);
  box.ghState();
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
  for (const args of [[], ['verify', 'v0.0.1'], ['tag', 'v0.0.1'], ['go-tags', 'v0.0.1'], ['candidate-assets'], ['bogus', 'v0.0.1'], ['assets', 'v0.0.1', 'extra'], ['candidate-assets', '0.0.1', 'extra'], ['coverage', 'v0.0.1']]) {
    const result = cli(box, args);
    assert.equal(result.status, 2, args.join(' '));
    assert.match(result.stderr, /usage: node scripts\/kit\/release\.mts assets\|publish\|undraft TAG \| candidate-assets VERSION \| coverage/);
  }
});

test('make runs each release step with the tag of the environment and fails without it', (t) => {
  const box = releaseSandbox(t);
  box.release('0.0.1');
  const make = (...args: string[]) => spawnSync('make', [...KIT_MAKE, ...args], { cwd: box.root, env: { ...box.env, GITHUB_REPOSITORY: REPOSITORY }, encoding: 'utf8' });
  for (const target of ['release-assets', 'release-publish', 'release-undraft']) {
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
  assert.deepEqual(names, ['fixture-lib-npm-0.0.1.tgz', 'polyspec-fixture-app-npm-0.0.1.tgz', 'polyspec-kit-fixture-php-0.0.1.zip', 'kit_fixture-0.0.1-py3-none-any.whl', 'packages.json']);
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
  box.ghState();
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
  box.ghState({ byId: { 42: { id: 42, tag_name: tag, draft: true, assets: [] } } });
  box.releases([]);
  stop(() => release.undraft(context(box), tag), /var\/release\/v0\.0\.1\.json is missing; make release-publish writes it/);
  mkdirSync(path.join(box.root, 'var/release'), { recursive: true });
  writeFileSync(path.join(box.root, 'var/release/v0.0.1.json'), JSON.stringify({ id: 42 }));
  assert.equal(release.undraft(context(box), tag), true);
  assert.deepEqual(box.state().byId?.['42']?.draft, false);
  assert.equal(release.undraft(context(box), tag), false, 'a public release stays as it is');
  assert.equal(box.state().patched?.length, 1, 'a public release is not edited again');
});

