// Tests of scripts/kit/check-toolchain.mts: the running tools are compared with the declarations, offline. Version commands
// are stubs on PATH (the Node.js that runs the test is the real one), and a tool of mise.toml is its stub through its shim in
// var/tools/mise/shims, so a test sets the running version of each tool.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { toolchainMismatches, toolchainVersions } from '../../scripts/kit/check-toolchain.mts';
import { LOCK_PLATFORMS } from '../../scripts/kit/toolchain-mise.mts';
import { installCargoAuditStub, installGovulncheckStub } from './checkout.mts';
import { toolchainCheckout } from './toolchain-checkout.mts';
import { miseStub, versionStubs } from './toolchain-stubs.mts';
import { tool } from './kit-tools.mts';
import { PINS } from '../../scripts/kit/toolchain-pins.mts';
import { known } from './known.mts';

// The tools of this checkout run with the pins of kit, so the declarations are the pins. The node of mise.toml runs from its
// wrapper var/tools/bin/node (K171), which runs the Node.js of the test, the pin of the checkout.
const NODE = process.versions.node;
const GO = PINS.go;
const RUST = PINS.rust;
const PHP = PINS.php;
const PYTHON = `${PINS.python}.1`;
const SUM = `sha256:${'a'.repeat(64)}`;
// The tools of mise.toml of the checkout: kit's key of mise.toml and the release.
const MISE = { node: NODE, go: GO, python: PYTHON, 'http:composer': '2.10.3', ruff: '0.16.10', 'go:golang.org/x/vuln/cmd/govulncheck': '1.1.4', 'github:rustsec/rustsec': '0.22.2' };
const miseToml = (tools: Record<string, string>) => `[tools]\n${Object.entries(tools).map(([key, version]) => `${JSON.stringify(key)} = ${JSON.stringify(version)}`).join('\n')}\n`;
// The mise.lock that pins `tools`: each archive by its sha256 for every platform of LOCK_PLATFORMS, a go: tool by its release.
const miseLock = (tools: Record<string, string>) => Object.entries(tools).map(([key, version]) => `[[tools.${JSON.stringify(key)}]]\nversion = ${JSON.stringify(version)}\n${key.startsWith('go:') ? '' : LOCK_PLATFORMS.map(platform => `[tools.${JSON.stringify(key)}."platforms.${platform}"]\nchecksum = "${SUM}"\n`).join('')}`).join('\n');
const FILES = {
  'package.json': `{ "packageManager": "npm@12.2.0", "engines": { "node": ">=${NODE}" } }`,
  'rust-toolchain.toml': `[toolchain]\nchannel = "${RUST}"\n`,
  'go.mod': `module example.com/fixture\n\ngo ${GO}\n`,
  'config/toolchain.json': JSON.stringify({ schema: 1, php: [PHP] }),
  'mise.toml': miseToml(MISE),
  'mise.lock': miseLock(MISE),
};
const OUTPUTS = {
  npm: '12.2.0',
  go: `go${GO}`,
  rustc: `rustc ${RUST} (abcdef123 2026-01-01)`,
  php: `${PHP}.3`,
  python3: `Python ${PYTHON}`,
  composer: 'Composer version 2.10.3 2026-01-01 00:00:00',
  ruff: 'ruff 0.16.10',
};
// The commands of mise.toml, which the check runs from their shims in var/tools/mise/shims.
const MISE_COMMANDS = ['go', 'python3', 'uv', 'ruff', 'alint', 'golangci-lint', 'govulncheck', 'cargo-audit', 'cargo-nextest', 'cargo-deny', 'composer', 'vulture'];
const check = (root: string, env: NodeJS.ProcessEnv, ...tools: string[]) => spawnSync(process.execPath, [tool(import.meta.resolve('../../scripts/kit/check-toolchain.mts')), ...tools], { cwd: root, env, encoding: 'utf8' });
// The checkout and the version stubs of `outputs`; each stubbed command of mise.toml is also its shim, which runs the stub,
// and cargo-audit and govulncheck are the shims of checkout.mts. A null output makes the stub of the command fail.
const setup = (t: TestContext, outputs: Record<string, string | null> = OUTPUTS, files: Record<string, string> = FILES) => {
  const root = toolchainCheckout(t, files);
  mkdirSync(path.join(root, 'var/tools/bin'), { recursive: true });
  writeFileSync(path.join(root, 'var/tools/bin/node'), `#!/bin/sh\nexec '${process.execPath}' "$@"\n`, { mode: 0o755 });
  installCargoAuditStub(root);
  installGovulncheckStub(root);
  const stubs = versionStubs(t, outputs);
  for (const name of Object.keys(outputs).filter(command => MISE_COMMANDS.includes(command))) {
    writeFileSync(path.join(root, 'var/tools/mise/shims', name), `#!/bin/sh\nexec '${path.join(stubs.directory, 'bin', name)}' "$@"\n`, { mode: 0o755 });
  }
  return { root, stubs };
};

test('every declared tool at its declared version passes, offline, and the run prints the running releases', (t) => {
  const { root, stubs } = setup(t);
  const result = check(root, stubs.env);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, `[check-toolchain] node ${NODE}, npm 12.2.0, rust ${RUST}, php ${PHP}.3, go ${GO}, python ${PYTHON}, ruff 0.16.10, govulncheck 1.1.4, cargoAudit 0.22.2, composer 2.10.3\n[check-toolchain] 10 tools run at the declared versions\n`);
  assert.equal(result.stderr, '');
  assert.deepEqual(stubs.calls().map(line => known(line.split(' ')[0], 'line.split(…)[0]')).sort(), ['composer', 'go', 'npm', 'php', 'python3', 'ruff', 'rustc', 'composer', 'go', 'npm', 'php', 'python3', 'ruff', 'rustc'].sort(), 'only version commands run, each once for the check and once for the evidence');
});

test('every tool that differs is named with the declaring file, the expected and the running version, and the fix', (t) => {
  const { root, stubs } = setup(t, {
    npm: '12.1.0', go: 'go1.26.0', rustc: 'rustc 1.97.0 (abcdef123 2026-01-01)', php: '8.3.9', python3: 'Python 3.13.2',
    composer: 'Composer version 2.9.0 2026-01-01 00:00:00', ruff: 'ruff 0.15.0',
  });
  const result = check(root, stubs.env);
  assert.equal(result.status, 1);
  assert.deepEqual(result.stderr.trim().split('\n'), [
    '[check-toolchain] npm: 12.1.0 runs here and packageManager of package.json declares 12.2.0; fix: make install-tools TOOLS=npm',
    `[check-toolchain] rust: 1.97.0 runs here and rust-toolchain.toml channel declares ${RUST}; fix: make install-tools`,
    `[check-toolchain] php: 8.3.9 runs here and config/toolchain.json php declares ${PHP}; fix: make install-tools finds the PHP of .php-version; install it first with brew install php@${PHP} or apt install php${PHP}-cli`,
    `[check-toolchain] go: 1.26.0 runs here and mise.toml tools.go declares ${GO}; fix: make install-tools`,
    `[check-toolchain] python: 3.13.2 runs here and mise.toml tools.python declares ${PYTHON}; fix: make install-tools`,
    '[check-toolchain] ruff: 0.15.0 runs here and mise.toml tools.ruff declares 0.16.10; fix: make install-tools',
    '[check-toolchain] composer: 2.9.0 runs here and mise.toml tools.http:composer declares 2.10.3; fix: make install-tools',
    '[check-toolchain] 7 of 10 tools differ from the declared versions',
  ]);
});

// The lint tools of K77: vulture, golangci-lint and deadcode of mise.toml, and phpcs and PHPStan of the locked PHP lint project.
// deadcode prints no release, so its probe is go version -m of the binary that `mise which deadcode` names, which the go stub
// answers.
const LINT_LOCK = JSON.stringify({ packages: [{ name: 'phpstan/phpstan', version: '2.3.1' }, { name: 'squizlabs/php_codesniffer', version: '4.0.4' }, { name: 'spaze/phpstan-disallowed-calls', version: 'v4.15.0' }] });
const LINT_MISE = { 'pypi:vulture': '2.16', 'golangci-lint': '2.14.0', 'go:golang.org/x/tools/cmd/deadcode': '0.52.0' };
const LINT_LOCKED = miseLock({ 'golangci-lint': '2.14.0', 'go:golang.org/x/tools/cmd/deadcode': '0.52.0' }) + `\n[[tools."pypi:vulture"]]\nversion = "2.16"\nuv = { path = ".mise/locks/pypi-vulture/2.16", digest = "${SUM}" }\n`;
// The PHP lint is a tool of a checkout that declares PHP.
// The uv lock of vulture that mise.lock names, a sidecar folder that the checkout tracks (K192).
const SIDECAR = '.mise/locks/pypi-vulture/2.16';
const SIDECAR_FILES = { [`${SIDECAR}/pyproject.toml`]: '[project]\nname = "mise-pypi-tool-environment"\n', [`${SIDECAR}/uv.lock`]: 'version = 1\n' };
const LINT_FILES = { 'config/toolchain.json': JSON.stringify({ schema: 1, php: [PHP] }), 'mise.toml': miseToml(LINT_MISE), 'mise.lock': LINT_LOCKED, 'config/php-lint/composer.lock': LINT_LOCK, ...SIDECAR_FILES };
const track = (root: string, ...paths: string[]) => spawnSync('git', ['-C', root, 'add', '--', ...paths], { encoding: 'utf8' });
// The lint setup: the version stubs, the tracked sidecar, and the stub of mise that names the deadcode binary.
const lintSetup = (t: TestContext, outputs: Record<string, string | null>) => {
  const made = setup(t, outputs, LINT_FILES);
  track(made.root, SIDECAR);
  miseStub(made.root, { 'which deadcode': '/checkout/var/tools/mise/installs/deadcode/bin/deadcode' });
  return made;
};
const lintOutputs = ({ vulture = '2.16', golangci = '2.14.0', tools = '0.52.0', phpcs = '4.0.4', phpstan = '2.3.1' } = {}) => ({
  vulture: `vulture ${vulture}`,
  'golangci-lint': `golangci-lint has version ${golangci} built with go1.27.0 from 114493f9 on 2026-09-24T11:07:15Z`,
  go: `/checkout/var/tools/mise/installs/deadcode/bin/deadcode: go1.27.2\n\tpath\tgolang.org/x/tools/cmd/deadcode\n\tmod\tgolang.org/x/tools\tv${tools}\th1:x=`,
  phpcs: `PHP_CodeSniffer version ${phpcs} (stable) by Squiz and PHPCSStandards`,
  phpstan: `PHPStan - PHP Static Analysis Tool ${phpstan}`,
});
const LINT_TOOLS = ['vulture', 'golangciLint', 'deadcode', 'phpcs', 'phpstan'];

test('the lint tools pass at their declared releases and each other release fails with its declaration and the fix', (t) => {
  const good = lintSetup(t, lintOutputs());
  const passed = check(good.root, good.stubs.env, ...LINT_TOOLS);
  assert.equal(passed.status, 0, passed.stderr);
  assert.match(passed.stdout, /vulture 2\.16, golangciLint 2\.14\.0, deadcode 0\.52\.0, phpcs 4\.0\.4, phpstan 2\.3\.1\n\[check-toolchain\] 5 tools run at the declared versions/);
  const { root, stubs } = lintSetup(t, lintOutputs({ vulture: '2.15', golangci: '2.13.0', tools: '0.51.0', phpcs: '4.0.3', phpstan: '2.3.0' }));
  const result = check(root, stubs.env, ...LINT_TOOLS);
  assert.equal(result.status, 1);
  assert.deepEqual(result.stderr.trim().split('\n'), [
    '[check-toolchain] vulture: 2.15 runs here and mise.toml tools.pypi:vulture declares 2.16; fix: make install-tools',
    '[check-toolchain] golangciLint: 2.13.0 runs here and mise.toml tools.golangci-lint declares 2.14.0; fix: make install-tools',
    '[check-toolchain] deadcode: 0.51.0 runs here and mise.toml tools.go:golang.org/x/tools/cmd/deadcode declares 0.52.0; fix: make install-tools',
    '[check-toolchain] phpcs: 4.0.3 runs here and config/php-lint/composer.lock declares 4.0.4; fix: make install-tools',
    '[check-toolchain] phpstan: 2.3.0 runs here and config/php-lint/composer.lock declares 2.3.1; fix: make install-tools',
    '[check-toolchain] 5 of 5 tools differ from the declared versions',
  ]);
});

test('the vendored PHP lint is no tool to check in a repository that declares no PHP', (t) => {
  const { root, stubs } = setup(t, OUTPUTS, { 'package.json': FILES['package.json'], 'config/php-lint/composer.lock': LINT_LOCK });
  const result = check(root, stubs.env);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^\[check-toolchain\] npm 12\.2\.0\n\[check-toolchain\] 1 tools run/);
});

test('the Node.js, cargo-audit and govulncheck releases are compared exactly', (t) => {
  const audit = { node: '1.2.3', 'github:rustsec/rustsec': '0.22.3', 'go:golang.org/x/vuln/cmd/govulncheck': '1.1.5' };
  const { root, stubs } = setup(t, OUTPUTS, { ...FILES, 'mise.toml': miseToml(audit), 'mise.lock': miseLock(audit) });
  const result = check(root, stubs.env);
  assert.equal(result.status, 1);
  assert.match(result.stderr, new RegExp(`node: ${NODE.replaceAll('.', '\\.')} runs here and mise\\.toml tools\\.node declares 1\\.2\\.3; fix: make install-tools TOOLS=npm`));
  assert.match(result.stderr, /cargoAudit: 0\.22\.2 runs here and mise\.toml tools\.github:rustsec\/rustsec declares 0\.22\.3; fix: make install-tools/);
  assert.match(result.stderr, /govulncheck: 1\.1\.4 runs here and mise\.toml tools\.go:golang\.org\/x\/vuln\/cmd\/govulncheck declares 1\.1\.5; fix: make install-tools/);
});

// The Cargo tools of K143: cargo-nextest and cargo-deny of mise.toml, run from their shims. The stubs print what
// cargo-nextest 0.9.146 and cargo-deny 0.20.2 print for --version (measured on macos-arm64).
const CARGO_MISE = { 'github:nextest-rs/nextest': '0.9.146', 'cargo-deny': '0.20.2' };
const CARGO_FILES = { 'mise.toml': miseToml(CARGO_MISE), 'mise.lock': miseLock(CARGO_MISE) };
const cargoOutputs = ({ nextest = '0.9.146', deny = '0.20.2' } = {}) => ({
  'cargo-nextest': `cargo-nextest ${nextest} (8af696ddc 2026-09-21)\nrelease: ${nextest}\ncommit-hash: 8af696ddcce8fff2962d6a5168b6d138b8616a35\ncommit-date: 2026-09-21\nhost: aarch64-apple-darwin`,
  'cargo-deny': `cargo-deny ${deny}`,
});

test('cargo-nextest and cargo-deny of mise.toml pass at their releases and each other release fails with its declaration (K143)', (t) => {
  const good = setup(t, cargoOutputs(), CARGO_FILES);
  const passed = check(good.root, good.stubs.env);
  assert.equal(passed.status, 0, passed.stderr);
  assert.equal(passed.stdout, '[check-toolchain] cargoNextest 0.9.146, cargoDeny 0.20.2\n[check-toolchain] 2 tools run at the declared versions\n');
  assert.deepEqual(good.stubs.calls().map(line => line.split(' ').slice(0, 2).join(' ')), ['cargo-nextest --version', 'cargo-deny --version', 'cargo-nextest --version', 'cargo-deny --version']);
  const { root, stubs } = setup(t, cargoOutputs({ nextest: '0.9.145', deny: '0.20.1' }), CARGO_FILES);
  const result = check(root, stubs.env);
  assert.equal(result.status, 1);
  assert.deepEqual(result.stderr.trim().split('\n'), [
    '[check-toolchain] cargoNextest: 0.9.145 runs here and mise.toml tools.github:nextest-rs/nextest declares 0.9.146; fix: make install-tools',
    '[check-toolchain] cargoDeny: 0.20.1 runs here and mise.toml tools.cargo-deny declares 0.20.2; fix: make install-tools',
    '[check-toolchain] 2 of 2 tools differ from the declared versions',
  ]);
});

test('PHP is compared by minor release, and the Python of mise.toml by its exact release', (t) => {
  const { root, stubs } = setup(t, { ...OUTPUTS, php: `${PHP}.99` });
  assert.deepEqual(toolchainMismatches(['php', 'python'], { root, env: stubs.env }), []);
  const other = setup(t, { ...OUTPUTS, php: '8.3.0', python3: 'Python 3.14.0' });
  assert.equal(toolchainMismatches(['php', 'python'], { root: other.root, env: other.stubs.env }).length, 2);
});

test('the commands of var/tools/bin and the shims of mise run before those of PATH, and the toolchain selection is off', (t) => {
  const { root, stubs } = setup(t, { ...OUTPUTS, npm: '12.0.0', go: OUTPUTS.go, rustc: OUTPUTS.rustc, ruff: 'ruff 0.1.0' });
  mkdirSync(path.join(root, 'var/tools/bin'), { recursive: true });
  writeFileSync(path.join(root, 'var/tools/bin/npm'), '#!/bin/sh\necho 12.2.0\n');
  chmodSync(path.join(root, 'var/tools/bin/npm'), 0o755);
  // The shim runs in the environment of mise of the checkout.
  writeFileSync(path.join(root, 'var/tools/mise/shims/ruff'), `#!/bin/sh\n[ "$MISE_DATA_DIR" = '${path.join(root, 'var/tools/mise')}' ] || exit 3\necho 'ruff 0.16.10'\n`);
  const result = check(root, stubs.env, 'npm', 'go', 'rust', 'ruff');
  assert.equal(result.status, 0, result.stderr);
  assert.ok(stubs.calls().every(line => !line.startsWith('npm ') && !line.startsWith('ruff ')), 'the npm and the ruff of PATH did not run');
  assert.ok(stubs.calls().includes('go env GOVERSION [GOTOOLCHAIN=local RUSTUP_AUTO_INSTALL=0]'), stubs.calls().join('\n'));
  assert.ok(stubs.calls().includes('rustc --version [GOTOOLCHAIN=local RUSTUP_AUTO_INSTALL=0]'));
});

test('a Rust toolchain that rustup has not installed is named with the declaring file and make install-tools (K151)', (t) => {
  const { root, stubs } = setup(t);
  // rustup's proxy of rustc, with RUSTUP_AUTO_INSTALL=0, as for a toolchain of rust-toolchain.toml that is not installed.
  writeFileSync(path.join(stubs.directory, 'bin', 'rustc'), `#!/bin/sh\necho "error: toolchain '${RUST}-x86_64-unknown-linux-gnu' is not installed" >&2\necho "help: run \\\`rustup toolchain install\\\` to install it" >&2\nexit 1\n`, { mode: 0o755 });
  const result = check(root, stubs.env, 'rust');
  assert.equal(result.status, 1);
  assert.match(result.stderr, new RegExp(`^\\[check-toolchain\\] rust: the toolchain ${RUST.replaceAll('.', '\\.')}-x86_64-unknown-linux-gnu is not installed; rust-toolchain\\.toml channel declares ${RUST.replaceAll('.', '\\.')}; fix: make install-tools$`, 'm'));
});

test('a command that is missing or prints no release is a mismatch that names the command and the declared version', (t) => {
  const { root, stubs } = setup(t, { ...OUTPUTS, npm: 'twelve', composer: null });
  const result = check(root, stubs.env, 'npm', 'composer');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /npm: no release in the output of `npm --version`: "twelve"; packageManager of package\.json declares 12\.2\.0; fix: make install-tools/);
  assert.match(result.stderr, /composer: `var\/tools\/mise\/shims\/composer --version --no-ansi` failed \(.*\).*; mise\.toml tools\.http:composer declares 2\.10\.3; fix: make install-tools/);
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

test('a tool that cannot run names the declared release in its fix: the minors of PHP (K108)', (t) => {
  const twoMinors = { ...FILES, 'config/toolchain.json': JSON.stringify({ ...JSON.parse(FILES['config/toolchain.json']), php: ['8.2', PHP] }) };
  const { root, stubs } = setup(t, { ...OUTPUTS, php: null }, twoMinors);
  const result = check(root, stubs.env, 'php');
  assert.equal(result.status, 1);
  const pin = PHP.replaceAll('.', '\\.');
  assert.match(result.stderr, new RegExp(`php: \`php -n -r .*\` failed .*; config/toolchain\\.json php declares 8\\.2 or ${pin}; fix: make install-tools finds the PHP of \\.php-version; install it first with brew install php@8\\.2 or apt install php8\\.2-cli or brew install php@${pin} or apt install php${pin}-cli\\n`));
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
  assert.match(unknown.stderr, /unknown tool make; the tools are node, npm, mise, rust, php, phpunit, phpcs, phpstan, go, python, uv, ruff, alint, golangciLint, deadcode, govulncheck, cargoAudit, cargoNextest, cargoDeny, composer, vulture/);

  const nothing = check(toolchainCheckout(t), stubs.env);
  assert.equal(nothing.status, 1);
  assert.match(nothing.stderr, /no toolchain is declared, so nothing is checked/);
});

test('toolchainVersions reports an unreadable tool as unavailable', (t) => {
  const { root, stubs } = setup(t, { npm: '12.2.0', composer: null });
  const versions = toolchainVersions(['npm', 'composer'], { root, env: { ...stubs.env, PATH: stubs.env.PATH } });
  assert.equal(versions.npm, '12.2.0');
  assert.ok(versions.composer !== undefined);
  assert.match(versions.composer, /^unavailable: `var\/tools\/mise\/shims\/composer --version --no-ansi` failed/);
});

test('the make target toolchain-check passes the tools to the check', () => {
  const root = path.join(path.dirname(new URL(import.meta.url).pathname), '../..');
  const dry = spawnSync('make', ['-n', '--no-print-directory', '-f', 'scripts/kit/kit.mk', 'KIT=scripts/kit', 'KIT_EXT=mts', 'toolchain-check', 'TOOLS=npm go'], { cwd: root, encoding: 'utf8' });
  assert.equal(dry.status, 0, dry.stderr);
  assert.equal(dry.stdout.trim(), `${path.join(root, 'var/tools/bin/node')} scripts/kit/check-toolchain.mts npm go`);
});

test('uv is probed by its version line from its shim, and a uv of another release names mise.toml and the fix', (t) => {
  const files = { ...FILES, 'mise.toml': miseToml({ uv: '0.12.11' }), 'mise.lock': miseLock({ uv: '0.12.11' }) };
  const same = setup(t, { uv: 'uv 0.12.11 (4b53f66b7 2026-09-08 aarch64-apple-darwin)' }, files);
  assert.deepEqual(toolchainVersions(['uv'], { root: same.root, env: same.stubs.env, run: undefined }).uv, '0.12.11');
  assert.deepEqual(toolchainMismatches(['uv'], { root: same.root, env: same.stubs.env }), []);
  const older = setup(t, { uv: 'uv 0.12.10 (4b53f66b7 2026-09-08 aarch64-apple-darwin)' }, files);
  assert.deepEqual(toolchainMismatches(['uv'], { root: older.root, env: older.stubs.env }), ['uv: 0.12.10 runs here and mise.toml tools.uv declares 0.12.11; fix: make install-tools']);
});

test('mise.lock must pin every tool of mise.toml, whichever tools run (K127)', (t) => {
  const { root, stubs } = setup(t, OUTPUTS, { ...FILES, 'mise.lock': miseLock({ ...MISE, ruff: '0.16.9' }) });
  const result = check(root, stubs.env, 'npm');
  assert.equal(result.status, 1, result.stdout);
  assert.deepEqual(result.stderr.trim().split('\n'), [
    '[check-toolchain] mise.lock does not pin ruff 0.16.10; run make toolchain-lock',
    '[check-toolchain] 1 findings of the pins of mise.lock',
  ]);
  rmSync(path.join(root, 'mise.lock'));
  assert.match(check(root, stubs.env, 'npm').stderr, /mise\.lock is missing; run make toolchain-lock/);
});

// mise's documentation says to commit the sidecar folder of mise.lock: mise install --locked of a fresh checkout replays the uv
// lock in it, so an untracked or deleted sidecar fails there; a repository that deleted it to pass its layout check lost it (K192).
test('the uv lock sidecar that mise.lock names is a tracked folder of the checkout, its tracked files present (K192)', (t) => {
  const { root, stubs } = lintSetup(t, lintOutputs());
  assert.equal(check(root, stubs.env, 'vulture').status, 0);
  spawnSync('git', ['-C', root, 'rm', '-r', '--cached', '--quiet', '--', SIDECAR]);
  const untracked = check(root, stubs.env, 'vulture');
  assert.equal(untracked.status, 1, untracked.stdout);
  assert.deepEqual(untracked.stderr.trim().split('\n'), [
    `[check-toolchain] mise.lock pins pypi:vulture 2.16 by the uv lock in ${SIDECAR}, which Git does not track; mise install --locked of a checkout needs it, so commit ${SIDECAR} with mise.lock (make toolchain-lock writes it)`,
    '[check-toolchain] 1 findings of the pins of mise.lock',
  ]);
  track(root, SIDECAR);
  rmSync(path.join(root, SIDECAR, 'uv.lock'));
  assert.match(check(root, stubs.env, 'vulture').stderr, new RegExp(`whose tracked file ${SIDECAR.replaceAll('.', '\\.')}/uv\\.lock is missing; restore it with git checkout -- `));
});

test('the go and the python of mise.toml are checked against the pins of kit (S4)', (t) => {
  const other = { ...MISE, go: '1.0.0', python: '3.0.1' };
  const { root, stubs } = setup(t, OUTPUTS, { ...FILES, 'mise.toml': miseToml(other), 'mise.lock': miseLock(other) });
  const result = check(root, stubs.env, 'npm');
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stderr, new RegExp(`mise\\.toml: tools\\.go is "1\\.0\\.0"; kit pins go ${GO.replaceAll('.', '\\.')}, so it must be "${GO.replaceAll('.', '\\.')}"`));
  assert.match(result.stderr, new RegExp(`mise\\.toml: tools\\.python minor is "3\\.0"; kit pins python ${PINS.python.replaceAll('.', '\\.')}, so it must be "${PINS.python.replaceAll('.', '\\.')}"`));
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
  // The exception allows a Node.js other than the pin in mise.toml and in engines.node.
  const other = { ...exception, channel: '99.0.0' };
  const used = setup(t, OUTPUTS, { ...FILES, 'mise.toml': miseToml({ ...MISE, node: '99.0.0' }), 'mise.lock': miseLock({ ...MISE, node: '99.0.0' }), 'package.json': '{ "packageManager": "npm@12.2.0", "engines": { "node": ">=99.0.0" } }', 'config/toolchain.json': config([other]) });
  const passed = check(used.root, used.stubs.env, 'npm');
  assert.equal(passed.status, 0, passed.stderr);
});
