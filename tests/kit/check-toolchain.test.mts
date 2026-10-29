// Tests of scripts/kit/check-toolchain.mts: the running tools are compared with the declarations, offline. Version commands
// are stubs on PATH (the Node.js that runs the test is the real one), and a tool of mise.toml is its stub through its shim in
// var/tools/mise/shims, so a test sets the running version of each tool.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { arginfoToolFindings, bareFpmFindings, toolchainMismatches, toolchainVersions } from '../../scripts/kit/check-toolchain.mts';
import { LOCK_PLATFORMS } from '../../scripts/kit/toolchain-mise.mts';
import { installCargoAuditStub, installGovulncheckStub } from './checkout.mts';
import { toolchainCheckout } from './toolchain-checkout.mts';
import { miseStub, versionStubs } from './toolchain-stubs.mts';
import { tool } from './kit-tools.mts';
import { PINS } from '../../scripts/kit/toolchain-pins.mts';
import { known } from './known.mts';
import { tree } from './tree.mts';

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
  // The PHP lint of kit, which every checkout that declares PHP declares (K614).
  phpcs: 'PHP_CodeSniffer version 4.0.4 (stable) by Squiz and PHPCSStandards',
  phpstan: 'PHPStan - PHP Static Analysis Tool 2.3.1',
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
  // npm and php are the tools of the checkout (K393-1): their wrappers in var/tools/bin run the stubs of PATH.
  for (const name of ['npm', 'php'].filter(command => command in outputs)) {
    writeFileSync(path.join(root, 'var/tools/bin', name), `#!/bin/sh\nexec '${path.join(stubs.directory, 'bin', name)}' "$@"\n`, { mode: 0o755 });
  }
  return { root, stubs };
};

test('every declared tool at its declared version passes, offline, and the run prints the running releases', (t) => {
  const { root, stubs } = setup(t);
  const result = check(root, stubs.env);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, `[check-toolchain] node ${NODE}, npm 12.2.0, rust ${RUST}, php ${PHP}.3, phpcs 4.0.4, phpstan 2.3.1, go ${GO}, python ${PYTHON}, ruff 0.16.10, govulncheck 1.1.4, cargoAudit 0.22.2, composer 2.10.3\n[check-toolchain] 12 tools run from the tools of the checkout\n`);
  assert.equal(result.stderr, '');
  assert.deepEqual(stubs.calls().map(line => known(line.split(' ')[0], 'line.split(…)[0]')).sort(), ['composer', 'go', 'npm', 'php', 'phpcs', 'phpstan', 'python3', 'ruff', 'rustc', 'composer', 'go', 'npm', 'php', 'phpcs', 'phpstan', 'python3', 'ruff', 'rustc'].sort(), 'only version commands run, each once for the check and once for the evidence');
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

test('the vendored PHP lint is no tool to check in a repository that declares no PHP', (t) => {
  const { root, stubs } = setup(t, OUTPUTS, { 'package.json': FILES['package.json'], 'config/php-lint/composer.lock': LINT_LOCK });
  const result = check(root, stubs.env);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^\[check-toolchain\] npm 12\.2\.0\n\[check-toolchain\] 1 tools run/);
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
  assert.match(result.stderr, /npm: no release in the output of `var\/tools\/bin\/npm --version`: "twelve"; packageManager of package\.json declares 12\.2\.0; fix: make install-tools/);
  assert.match(result.stderr, /composer: `var\/tools\/mise\/shims\/composer --version --no-ansi` failed \(.*\).*; mise\.toml tools\.http:composer declares 2\.10\.3; fix: make install-tools/);
});

test('a version command ended by a signal names the signal, not an exit status (K118)', (t) => {
  const { root, stubs } = setup(t);
  const killed = path.join(stubs.directory, 'bin', 'npm');
  writeFileSync(killed, '#!/usr/bin/env node\nprocess.kill(process.pid, "SIGKILL");\n');
  chmodSync(killed, 0o755);
  const [mismatch] = toolchainMismatches(['npm'], { root, env: stubs.env });
  assert.match(mismatch ?? '', /^npm: `var\/tools\/bin\/npm --version` failed \(ended by signal SIGKILL\); packageManager of package\.json declares 12\.2\.0/);
  const stubbed = toolchainMismatches(['npm'], { root, run: () => ({ status: null, signal: 'SIGTERM', stdout: '', stderr: '' }) });
  assert.match(stubbed[0] ?? '', /`var\/tools\/bin\/npm --version` failed \(ended by signal SIGTERM\)/);
});

test('a tool that cannot run names the declared release in its fix: the minors of PHP (K108)', (t) => {
  const twoMinors = { ...FILES, 'config/toolchain.json': JSON.stringify({ ...JSON.parse(FILES['config/toolchain.json']), php: ['8.2', PHP] }) };
  const { root, stubs } = setup(t, { ...OUTPUTS, php: null }, twoMinors);
  const result = check(root, stubs.env, 'php');
  assert.equal(result.status, 1);
  const pin = PHP.replaceAll('.', '\\.');
  assert.match(result.stderr, new RegExp(`php: \`var/tools/bin/php -n -r .*\` failed .*; config/toolchain\\.json php declares 8\\.2 or ${pin}; fix: make install-tools finds the PHP of \\.php-version; install it first with brew install php@8\\.2 or apt install php8\\.2-cli or brew install php@${pin} or apt install php${pin}-cli\\n`));
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
  // A worktree runs the tools of the main checkout, so the node path is the one kit.mk resolves, not the root of this checkout (K792).
  assert.match(dry.stdout.trim(), /^\/\S+\/var\/tools\/bin\/node scripts\/kit\/check-toolchain\.mts npm go$/);
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

test('a repository with a PHP extension needs the installed pinned arginfo generator and parser, and toolchain-check names make install-tools (K303, K560)', (t) => {
  const root = tree(t, { 'packages/php-ext/src/config.m4': '', 'docs/a.md': '' });
  assert.deepEqual(arginfoToolFindings(root), ['PHP extension arginfo tools are missing or incomplete: var/tools/php-arginfo/gen_stub.php is missing; run make install-tools, which installs the pinned PHP arginfo generator and parser']);
  const none = tree(t, { 'docs/a.md': '' });
  assert.deepEqual(arginfoToolFindings(none), []);
});

test('explicit toolchain selections do not require PHP extension arginfo, but the full check still does', (t) => {
  const { root, stubs } = setup(t, OUTPUTS, { ...FILES, 'packages/php-ext/src/config.m4': '' });
  for (const selected of [['node', 'go', 'rust'], ['php']]) {
    const result = check(root, stubs.env, ...selected);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^\[check-toolchain\].*\n\[check-toolchain\] .* tools run/m);
  }
  const full = check(root, stubs.env);
  assert.equal(full.status, 1, full.stdout);
  assert.match(full.stderr, /PHP extension arginfo tools are missing or incomplete: var\/tools\/php-arginfo\/gen_stub\.php is missing/);
  assert.deepEqual(arginfoToolFindings(root), ['PHP extension arginfo tools are missing or incomplete: var/tools/php-arginfo/gen_stub.php is missing; run make install-tools, which installs the pinned PHP arginfo generator and parser']);
});

test('toolchain-check refuses php-fpm and php-cgi from PATH, and install-php wraps php-fpm of the same prefix (K341)', (t) => {
  const findings = (files: Record<string, string>) => bareFpmFindings(tree(t, files));
  const one = findings({ 'Makefile': 'all:\n\tphp-fpm -y fpm.conf\n' });
  assert.equal(one.length, 1, one.join('\n'));
  assert.match(one[0] ?? '', /^Makefile:2 starts php-fpm by its bare name/);
  assert.match(findings({ 'Makefile': 'all:\n\tphp-cgi -m\n' })[0] ?? '', /^Makefile:2 starts php-cgi by its bare name/);
  assert.match(findings({ 'build.mk': 'serve:\n\t@php-fpm -y fpm.conf\n' })[0] ?? '', /^build\.mk:2 starts php-fpm/);
  assert.match(findings({ 'run.sh': 'set -e\nphp-fpm -y fpm.conf\n' })[0] ?? '', /^run\.sh:2 starts php-fpm/);
  assert.deepEqual(findings({ 'Makefile': 'all:\n\t$(PHP_FPM) -y fpm.conf\n\tvar/tools/bin/php-fpm -y fpm.conf\n' }), []);
});

test('toolchain-check parses POSIX parameter expansion before finding a bare php-fpm (K563)', (t) => {
  const root = tree(t, {
    'build.sh': '#!/bin/sh\nset -eu\nout=${1:?usage: sh build.sh <published polyspec_orm.so>}\nphp-fpm -y fpm.conf\nvar/tools/bin/php-fpm -v\n',
  });
  let findings: string[] | undefined;
  assert.doesNotThrow(() => {
    findings = bareFpmFindings(root);
  }, 'the valid POSIX parameter expansion must not stop shell command analysis');
  assert.equal(findings?.length, 1);
  assert.match(findings?.[0] ?? '', /^build\.sh:4 starts php-fpm by its bare name/);
});

// K492: the kit Go pin is the release that fixes GO-2026-6809 (crypto/x509 distrusts compromised intermediate certificates); the copies
// that kit syncs to the repositories follow this pin, so a pin of go1.27.2 stays the advisory.
test('the kit Go pin is go1.27.3, the release without the advisory GO-2026-6809 (K492)', () => {
  assert.equal(PINS.go, '1.27.3');
});
