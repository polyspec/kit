// Tests of scripts/kit/check-toolchain.mts: the running tools are compared with the declarations, offline. Version commands
// are stubs on PATH (the Node.js that runs the test is the real one), so a test sets the running version of each tool.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { toolchainMismatches, toolchainVersions } from '../../scripts/kit/check-toolchain.mts';
import { installCargoAuditStub, installGovulncheckStub } from './checkout.mts';
import { toolchainCheckout } from './toolchain-checkout.mts';
import { versionStubs } from './toolchain-stubs.mts';
import { tool } from './kit-tools.mts';
import { PINS } from '../../scripts/kit/toolchain-pins.mts';

// The tools of this checkout run with the pins of kit, so the declarations are the pins. Node.js is the one that runs the
// test, which is the pin of the checkout.
const NODE = process.versions.node;
const GO = PINS.go;
const RUST = PINS.rust;
const FILES = {
  '.node-version': `${NODE}\n`,
  'package.json': `{ "packageManager": "npm@12.2.0", "engines": { "node": ">=${NODE}" } }`,
  'rust-toolchain.toml': `[toolchain]\nchannel = "${RUST}"\n`,
  'go.mod': `module example.com/fixture\n\ngo ${GO}\n`,
  'config/toolchain.json': JSON.stringify({ schema: 1, php: ['8.5'], python: '3.14', composer: { version: '2.10.3' }, go: { mod: 'go.mod' }, ruff: { version: '0.16.10', sha256: { 'linux-x64': 'f33f43a864a8483eebd160e713336c8bab02c934feaff0a33cf5ccb41546d09a' } }, cargoAudit: '0.22.2', govulncheck: '1.1.4' }),
};
const OUTPUTS = {
  npm: '12.2.0',
  go: `go${GO}`,
  rustc: `rustc ${RUST} (abcdef123 2026-01-01)`,
  php: '8.5.3',
  python3: 'Python 3.14.1',
  composer: 'Composer version 2.10.3 2026-01-01 00:00:00',
  ruff: 'ruff 0.16.10',
};
const check = (root: string, env: NodeJS.ProcessEnv, ...tools: string[]) => spawnSync(process.execPath, [tool('check-toolchain'), ...tools], { cwd: root, env, encoding: 'utf8' });
// The Python of the checkout is var/tools/bin/python3, the wrapper that install-python.mts writes; here it runs the stub.
// A null output makes the stub of the command fail.
const setup = (t: TestContext, outputs: Record<string, string | null> = OUTPUTS, files: Record<string, string> = FILES) => {
  const root = toolchainCheckout(t, files);
  installCargoAuditStub(root);
  installGovulncheckStub(root);
  const stubs = versionStubs(t, outputs);
  mkdirSync(path.join(root, 'var/tools/bin'), { recursive: true });
  writeFileSync(path.join(root, 'var/tools/bin/python3'), `#!/bin/sh\nexec '${path.join(stubs.directory, 'bin', 'python3')}' "$@"\n`);
  chmodSync(path.join(root, 'var/tools/bin/python3'), 0o755);
  return { root, stubs };
};

test('every declared tool at its declared version passes, offline, and the run prints the running releases', (t) => {
  const { root, stubs } = setup(t);
  const result = check(root, stubs.env);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, `[check-toolchain] node ${NODE}, npm 12.2.0, go ${GO}, rust ${RUST}, php 8.5.3, python 3.14.1, composer 2.10.3, ruff 0.16.10, cargoAudit 0.22.2, govulncheck 1.1.4\n[check-toolchain] 10 tools run at the declared versions\n`);
  assert.equal(result.stderr, '');
  assert.deepEqual(stubs.calls().map(line => line.split(' ')[0]).sort(), ['composer', 'go', 'npm', 'php', 'python3', 'ruff', 'rustc', 'composer', 'go', 'npm', 'php', 'python3', 'ruff', 'rustc'].sort(), 'only version commands run, each once for the check and once for the evidence');
});

test('every tool that differs is named with the declaring file, the expected and the running version, and the fix', (t) => {
  const { root, stubs } = setup(t, {
    npm: '12.1.0', go: 'go1.26.0', rustc: 'rustc 1.97.0 (abcdef123 2026-01-01)', php: '8.4.9', python3: 'Python 3.13.2',
    composer: 'Composer version 2.9.0 2026-01-01 00:00:00', ruff: 'ruff 0.15.0',
  });
  const result = check(root, stubs.env);
  assert.equal(result.status, 1);
  assert.deepEqual(result.stderr.trim().split('\n'), [
    '[check-toolchain] npm: 12.1.0 runs here and packageManager of package.json declares 12.2.0; fix: make install-tools, and var/tools/bin first on PATH',
    `[check-toolchain] go: 1.26.0 runs here and go.mod go directive declares ${GO}; fix: make install-tools, and var/tools/bin first on PATH`,
    `[check-toolchain] rust: 1.97.0 runs here and rust-toolchain.toml channel declares ${RUST}; fix: rustup toolchain install --no-self-update, in the checkout`,
    '[check-toolchain] php: 8.4.9 runs here and config/toolchain.json php declares 8.5; fix: install PHP 8.5',
    '[check-toolchain] python: 3.13.2 runs here and config/toolchain.json python declares 3.14; fix: make install-tools, and var/tools/bin first on PATH',
    '[check-toolchain] composer: 2.9.0 runs here and config/toolchain.json composer declares 2.10.3; fix: install Composer 2.10.3, or declare its sha256 and run make install-tools, and var/tools/bin first on PATH',
    '[check-toolchain] ruff: 0.15.0 runs here and config/toolchain.json ruff declares 0.16.10; fix: make install-tools, and var/tools/bin first on PATH',
    '[check-toolchain] 7 of 10 tools differ from the declared versions',
  ]);
});

// The lint tools of K77: vulture, golangci-lint and deadcode of config/toolchain.json, and phpcs and PHPStan of the locked PHP
// lint project. deadcode prints no release, so its probe is go version -m of the installed binary, which the go stub answers.
const LINT_LOCK = JSON.stringify({ packages: [{ name: 'phpstan/phpstan', version: '2.3.1' }, { name: 'squizlabs/php_codesniffer', version: '4.0.4' }, { name: 'spaze/phpstan-disallowed-calls', version: 'v4.15.0' }] });
const LINT_FILES = { 'config/toolchain.json': JSON.stringify({ schema: 1, vulture: { version: '2.16', sha256: 'f'.repeat(64) }, golangciLint: { version: '2.14.0', sha256: { 'linux-x64': 'f'.repeat(64) } }, deadcode: '0.52.0' }), 'config/php-lint/composer.lock': LINT_LOCK };
const lintOutputs = ({ vulture = '2.16', golangci = '2.14.0', tools = '0.52.0', phpcs = '4.0.4', phpstan = '2.3.1' } = {}) => ({
  vulture: `vulture ${vulture}`,
  'golangci-lint': `golangci-lint has version ${golangci} built with go1.27.0 from 114493f9 on 2026-09-24T11:07:15Z`,
  go: `/checkout/var/tools/deadcode/bin/deadcode: go1.27.2\n\tpath\tgolang.org/x/tools/cmd/deadcode\n\tmod\tgolang.org/x/tools\tv${tools}\th1:x=`,
  phpcs: `PHP_CodeSniffer version ${phpcs} (stable) by Squiz and PHPCSStandards`,
  phpstan: `PHPStan - PHP Static Analysis Tool ${phpstan}`,
});
const LINT_TOOLS = ['vulture', 'golangciLint', 'deadcode', 'phpcs', 'phpstan'];

test('the lint tools pass at their declared releases and each other release fails with its declaration and the fix', (t) => {
  const good = setup(t, lintOutputs(), LINT_FILES);
  const passed = check(good.root, good.stubs.env, ...LINT_TOOLS);
  assert.equal(passed.status, 0, passed.stderr);
  assert.match(passed.stdout, /vulture 2\.16, golangciLint 2\.14\.0, deadcode 0\.52\.0, phpcs 4\.0\.4, phpstan 2\.3\.1\n\[check-toolchain\] 5 tools run at the declared versions/);
  const { root, stubs } = setup(t, lintOutputs({ vulture: '2.15', golangci: '2.13.0', tools: '0.51.0', phpcs: '4.0.3', phpstan: '2.3.0' }), LINT_FILES);
  const result = check(root, stubs.env, ...LINT_TOOLS);
  assert.equal(result.status, 1);
  assert.deepEqual(result.stderr.trim().split('\n'), [
    '[check-toolchain] vulture: 2.15 runs here and config/toolchain.json vulture declares 2.16; fix: make install-tools, and var/tools/bin first on PATH',
    '[check-toolchain] golangciLint: 2.13.0 runs here and config/toolchain.json golangciLint declares 2.14.0; fix: make install-tools, and var/tools/bin first on PATH',
    '[check-toolchain] deadcode: 0.51.0 runs here and config/toolchain.json deadcode declares 0.52.0; fix: make install-tools, and var/tools/bin first on PATH',
    '[check-toolchain] phpcs: 4.0.3 runs here and config/php-lint/composer.lock declares 4.0.4; fix: make install-tools, and var/tools/bin first on PATH',
    '[check-toolchain] phpstan: 2.3.0 runs here and config/php-lint/composer.lock declares 2.3.1; fix: make install-tools, and var/tools/bin first on PATH',
    '[check-toolchain] 5 of 5 tools differ from the declared versions',
  ]);
});

test('the Node.js, cargo-audit and govulncheck releases are compared exactly', (t) => {
  const { root, stubs } = setup(t, OUTPUTS, { ...FILES, '.node-version': '1.2.3\n', 'config/toolchain.json': JSON.stringify({ schema: 1, cargoAudit: '0.22.3', govulncheck: '1.1.5' }) });
  const result = check(root, stubs.env);
  assert.equal(result.status, 1);
  assert.match(result.stderr, new RegExp(`node: ${NODE.replaceAll('.', '\\.')} runs here and \\.node-version declares 1\\.2\\.3; fix: install Node\\.js 1\\.2\\.3`));
  assert.match(result.stderr, /cargoAudit: 0\.22\.2 runs here and config\/toolchain\.json cargoAudit declares 0\.22\.3; fix: make install-tools/);
  assert.match(result.stderr, /govulncheck: 1\.1\.4 runs here and config\/toolchain\.json govulncheck declares 1\.1\.5; fix: make install-tools/);
});

test('PHP and Python are compared by minor release: another patch passes, another minor fails', (t) => {
  const { root, stubs } = setup(t, { ...OUTPUTS, php: '8.5.99', python3: 'Python 3.14.0' });
  assert.deepEqual(toolchainMismatches(['php', 'python'], { root, env: { ...stubs.env, STUB_LOG: stubs.env.STUB_LOG } }), []);
  const other = setup(t, { ...OUTPUTS, php: '8.3.0', python3: 'Python 3.15.0' });
  assert.equal(toolchainMismatches(['php', 'python'], { root: other.root, env: other.stubs.env }).length, 2);
});

test('the commands of var/tools/bin run before those of PATH, and the toolchain selection is off', (t) => {
  const { root, stubs } = setup(t, { ...OUTPUTS, npm: '12.0.0', go: OUTPUTS.go, rustc: OUTPUTS.rustc });
  mkdirSync(path.join(root, 'var/tools/bin'), { recursive: true });
  writeFileSync(path.join(root, 'var/tools/bin/npm'), '#!/bin/sh\necho 12.2.0\n');
  chmodSync(path.join(root, 'var/tools/bin/npm'), 0o755);
  const result = check(root, stubs.env, 'npm', 'go', 'rust');
  assert.equal(result.status, 0, result.stderr);
  assert.ok(stubs.calls().every(line => !line.startsWith('npm ')), 'the npm of PATH did not run');
  assert.ok(stubs.calls().includes('go env GOVERSION [GOTOOLCHAIN=local RUSTUP_AUTO_INSTALL=0]'), stubs.calls().join('\n'));
  assert.ok(stubs.calls().includes('rustc --version [GOTOOLCHAIN=local RUSTUP_AUTO_INSTALL=0]'));
});

test('a command that is missing or prints no release is a mismatch that names the command and the declared version', (t) => {
  const { root, stubs } = setup(t, { ...OUTPUTS, npm: 'twelve', composer: null });
  const result = check(root, stubs.env, 'npm', 'composer');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /npm: no release in the output of `npm --version`: "twelve"; packageManager of package\.json declares 12\.2\.0; fix: make install-tools/);
  assert.match(result.stderr, /composer: `composer --version --no-ansi` failed \(.*\).*; config\/toolchain\.json composer declares 2\.10\.3; fix: install Composer 2\.10\.3, or declare its sha256/);
});

test('a version command ended by a signal names the signal, not an exit status (K118)', (t) => {
  const { root, stubs } = setup(t);
  const killed = path.join(stubs.directory, 'bin', 'npm');
  writeFileSync(killed, '#!/usr/bin/env node\nprocess.kill(process.pid, "SIGKILL");\n');
  chmodSync(killed, 0o755);
  const [mismatch] = toolchainMismatches(['npm'], { root, env: stubs.env });
  assert.match(mismatch ?? '', /^npm: `npm --version` failed \(ended by signal SIGKILL\); packageManager of package\.json declares 12\.2\.0/);
  const stubbed = toolchainMismatches(['npm'], { root, run: () => ({ status: null, signal: 'SIGTERM', stdout: '', stderr: '' }) });
  assert.match(stubbed[0] ?? '', /`npm --version` failed \(ended by signal SIGTERM\)/);
});

test('a tool that cannot run names the declared release in its fix: the minors of PHP, the exact version of the others (K108)', (t) => {
  const twoMinors = { ...FILES, 'config/toolchain.json': JSON.stringify({ ...JSON.parse(FILES['config/toolchain.json']), php: ['8.2', '8.5'] }) };
  const { root, stubs } = setup(t, { ...OUTPUTS, php: null, composer: null }, twoMinors);
  const result = check(root, stubs.env, 'php', 'composer');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /php: `php -n -r .*` failed .*; config\/toolchain\.json php declares 8\.2 or 8\.5; fix: install PHP 8\.2 or 8\.5\n/);
  assert.match(result.stderr, /composer: `composer --version --no-ansi` failed .*; config\/toolchain\.json composer declares 2\.10\.3; fix: install Composer 2\.10\.3, or declare its sha256/);
});

test('the tools to check come from the arguments; an undeclared tool, an unknown tool or no declaration fails', (t) => {
  const { root, stubs } = setup(t);
  const named = check(root, stubs.env, 'npm');
  assert.equal(named.status, 0, named.stderr);
  assert.match(named.stdout, /^\[check-toolchain\] npm 12\.2\.0\n\[check-toolchain\] 1 tools run/);

  const bare = toolchainCheckout(t, { 'package.json': '{ "packageManager": "npm@12.2.0" }' });
  const undeclared = check(bare, stubs.env, 'go');
  assert.equal(undeclared.status, 1);
  assert.match(undeclared.stderr, /go is not declared; declare it in config\/toolchain\.json or in its file, or leave it out of the tools to check/);
  const unknown = check(bare, stubs.env, 'make');
  assert.match(unknown.stderr, /unknown tool make; the tools are node, npm, go, rust, php, python, composer, ruff, uv, phpunit, cargoAudit, govulncheck/);

  const nothing = check(toolchainCheckout(t), stubs.env);
  assert.equal(nothing.status, 1);
  assert.match(nothing.stderr, /no toolchain is declared, so nothing is checked/);
});

test('toolchainVersions reports an unreadable tool as unavailable', (t) => {
  const { root, stubs } = setup(t, { npm: '12.2.0', composer: null });
  const versions = toolchainVersions(['npm', 'composer'], { root, env: { ...stubs.env, PATH: stubs.env.PATH } });
  assert.equal(versions.npm, '12.2.0');
  assert.ok(versions.composer !== undefined);
  assert.match(versions.composer, /^unavailable: `composer --version --no-ansi` failed/);
});

test('the make target toolchain-check passes the tools to the check', () => {
  const dry = spawnSync('make', ['-n', '--no-print-directory', '-f', 'scripts/kit/kit.mk', 'KIT=scripts/kit', 'KIT_EXT=mts', 'toolchain-check', 'TOOLS=npm go'], { cwd: path.join(path.dirname(new URL(import.meta.url).pathname), '../..'), encoding: 'utf8' });
  assert.equal(dry.status, 0, dry.stderr);
  assert.equal(dry.stdout.trim(), 'node scripts/kit/check-toolchain.mts npm go');
});

test('uv is probed by its version line, and a uv of another release names the declaring file and the fix', (t) => {
  const root = toolchainCheckout(t, { 'config/toolchain.json': JSON.stringify({ schema: 1, uv: { version: '0.12.11', sha256: { 'linux-x64': 'a'.repeat(64) } } }) });
  const same = versionStubs(t, { uv: 'uv 0.12.11 (4b53f66b7 2026-09-08 aarch64-apple-darwin)' });
  assert.deepEqual(toolchainVersions(['uv'], { root, env: same.env, run: undefined }).uv, '0.12.11');
  assert.deepEqual(toolchainMismatches(['uv'], { root, env: same.env }), []);
  const older = versionStubs(t, { uv: 'uv 0.12.10 (4b53f66b7 2026-09-08 aarch64-apple-darwin)' });
  assert.deepEqual(toolchainMismatches(['uv'], { root, env: older.env }), ['uv: 0.12.10 runs here and config/toolchain.json uv declares 0.12.11; fix: make install-tools, and var/tools/bin first on PATH']);
});

test('the check fails on an engines.node that is not the floor of the pin, whichever tools run', (t) => {
  const { root, stubs } = setup(t, OUTPUTS, { ...FILES, 'package.json': '{ "packageManager": "npm@12.2.0", "engines": { "node": ">=20" } }' });
  const result = check(root, stubs.env, 'npm');
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stderr, new RegExp(`\\[check-toolchain\\] package\\.json: engines\\.node is ">=20"; kit pins node ${NODE.replaceAll('.', '\\.')}, so it must be ">=${NODE.replaceAll('.', '\\.')}"`));
});

test('a declaration that differs from the pin of kit fails the check, whichever tools run (S4)', (t) => {
  const { root, stubs } = setup(t, OUTPUTS, { ...FILES, 'rust-toolchain.toml': '[toolchain]\nchannel = "1.0.0"\n' });
  const result = check(root, stubs.env, 'npm');
  assert.equal(result.status, 1, result.stdout);
  assert.deepEqual(result.stderr.trim().split('\n'), [
    `[check-toolchain] rust-toolchain.toml: channel is "1.0.0"; kit pins rust ${RUST}, so it must be "${RUST}"`,
    '[check-toolchain] 1 declarations differ from the pins of kit',
  ]);
});

test('a malformed or stale exception fails the check, and a used one passes it', (t) => {
  const exception = { tool: 'node', channel: NODE, scope: '.', reason: 'a test of the exceptions', retry: 'never' };
  const config = (exceptions: unknown[]) => JSON.stringify({ ...JSON.parse(FILES['config/toolchain.json']), exceptions });
  const stale = setup(t, OUTPUTS, { ...FILES, 'config/toolchain.json': config([exception, { ...exception, retry: '' }]) });
  const failed = check(stale.root, stale.stubs.env, 'npm');
  assert.equal(failed.status, 1, failed.stdout);
  assert.deepEqual(failed.stderr.trim().split('\n'), [
    '[check-toolchain] config/toolchain.json exceptions[1] has no retry; an exception declares tool, channel, scope, reason, retry',
    `[check-toolchain] config/toolchain.json exceptions[0]: nothing under . uses node ${NODE}, so the exception is stale; remove it (its retry condition: never)`,
    '[check-toolchain] 2 findings of the exceptions of config/toolchain.json',
  ]);
  // The exception allows a Node.js other than the pin in .node-version and in engines.node.
  const other = { ...exception, channel: '99.0.0' };
  const used = setup(t, OUTPUTS, { ...FILES, '.node-version': '99.0.0\n', 'package.json': '{ "packageManager": "npm@12.2.0", "engines": { "node": ">=99.0.0" } }', 'config/toolchain.json': config([other]) });
  const passed = check(used.root, used.stubs.env, 'npm');
  assert.equal(passed.status, 0, passed.stderr);
});
