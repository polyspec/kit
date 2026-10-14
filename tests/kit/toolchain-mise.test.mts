// Tests of scripts/kit/toolchain-mise.mts (K127): the tools of mise.toml are read with their exact releases and the key that
// declares them, a key of a tool that kit does not check is refused, and miseLockFindings names each tool that mise.lock does
// not pin by the sha256 of its archive of every platform, by the digest of its uv lock (pypi:), or at all; a go: tool is
// pinned by its release, and Go checks its modules.
import assert from 'node:assert/strict';
import test from 'node:test';
import { declaredMiseTools, miseLockFindings } from '../../scripts/kit/toolchain-mise.mts';
import { toolchainCheckout } from './toolchain-checkout.mts';

const SUM = `sha256:${'a'.repeat(64)}`;
const MISE_TOML = `[tools]
go = "1.27.2"
python = "3.14.8"
ruff = "0.17.0"
"go:golang.org/x/vuln/cmd/govulncheck" = "1.3.0"
"github:rustsec/rustsec" = { version = "0.22.2", version_prefix = "cargo-audit/v" }
"github:nextest-rs/nextest" = { version = "0.9.146", version_prefix = "cargo-nextest-" }
cargo-deny = "0.20.2"
"pypi:vulture" = "2.16"
`;

// The mise.lock entry of `key` at `version`, with the archives of `platforms` and the extra lines `more`.
const entry = (key: string, version: string, platforms: string[], more = '') => `[[tools."${key}"]]
version = "${version}"
backend = "${key}"
${more}
${platforms.map(platform => `[tools."${key}"."platforms.${platform}"]\nchecksum = "${SUM}"\nurl = "https://example.invalid/${platform}"\n`).join('\n')}`;

// The platforms on which the bootstrap installs mise: the archives of config/toolchain.json mise (K134).
const BOTH = ['linux-x64', 'linux-arm64', 'macos-arm64', 'macos-x64'];
const LOCK = [
  entry('go', '1.27.2', BOTH),
  entry('python', '3.14.8', BOTH),
  entry('ruff', '0.17.0', BOTH),
  entry('go:golang.org/x/vuln/cmd/govulncheck', '1.3.0', []),
  entry('github:rustsec/rustsec', '0.22.2', BOTH),
  entry('github:nextest-rs/nextest', '0.9.146', BOTH),
  entry('cargo-deny', '0.20.2', BOTH),
  entry('pypi:vulture', '2.16', [], `uv = { path = ".mise/locks/pypi-vulture/2.16", digest = "${SUM}" }`),
].join('\n');

test('the tools of mise.toml are read with their releases and the declaring key; no mise.toml declares none', (t) => {
  const root = toolchainCheckout(t, { 'mise.toml': MISE_TOML });
  assert.deepEqual(declaredMiseTools(root), {
    go: { version: '1.27.2', source: 'mise.toml tools.go' },
    python: { version: '3.14.8', source: 'mise.toml tools.python' },
    ruff: { version: '0.17.0', source: 'mise.toml tools.ruff' },
    govulncheck: { version: '1.3.0', source: 'mise.toml tools.go:golang.org/x/vuln/cmd/govulncheck' },
    cargoAudit: { version: '0.22.2', source: 'mise.toml tools.github:rustsec/rustsec' },
    cargoNextest: { version: '0.9.146', source: 'mise.toml tools.github:nextest-rs/nextest' },
    cargoDeny: { version: '0.20.2', source: 'mise.toml tools.cargo-deny' },
    vulture: { version: '2.16', source: 'mise.toml tools.pypi:vulture' },
  });
  assert.deepEqual(declaredMiseTools(toolchainCheckout(t)), {});
});

test('a tool that kit does not check, or a release that is not exact, is refused with the key and the value', (t) => {
  assert.throws(() => declaredMiseTools(toolchainCheckout(t, { 'mise.toml': '[tools]\nnode = "26.11.1"\n' })), /mise\.toml tools declares node, which kit does not check; the tools are go, python, /);
  assert.throws(() => declaredMiseTools(toolchainCheckout(t, { 'mise.toml': '[tools]\ngo = "1.27"\n' })), /mise\.toml tools\.go must declare an exact release, <major>\.<minor>\.<patch>; it declares "1\.27"/);
  assert.throws(() => declaredMiseTools(toolchainCheckout(t, { 'mise.toml': '[tools]\n"pypi:vulture" = "latest"\n' })), /mise\.toml tools\.pypi:vulture must declare an exact release as PyPI names it; it declares "latest"/);
  assert.throws(() => declaredMiseTools(toolchainCheckout(t, { 'mise.toml': '[tools]\nruff = { backend = "aqua" }\n' })), /tools\.ruff must declare an exact release, <major>\.<minor>\.<patch>; it declares undefined/);
});

test('a lock that pins every tool has no finding; a go: tool needs no digest', (t) => {
  assert.deepEqual(miseLockFindings(toolchainCheckout(t, { 'mise.toml': MISE_TOML, 'mise.lock': LOCK })), []);
  assert.deepEqual(miseLockFindings(toolchainCheckout(t)), [], 'no mise.toml locks nothing');
});

test('a missing lock, tool, release, platform digest or uv lock is a finding with the fix', (t) => {
  assert.deepEqual(miseLockFindings(toolchainCheckout(t, { 'mise.toml': MISE_TOML })), ['mise.lock is missing; run make toolchain-lock']);
  const lock = [
    entry('go', '1.27.1', BOTH),
    entry('python', '3.14.8', ['linux-x64']),
    entry('go:golang.org/x/vuln/cmd/govulncheck', '1.3.0', []),
    entry('github:rustsec/rustsec', '0.22.2', BOTH),
    entry('github:nextest-rs/nextest', '0.9.146', BOTH),
    entry('cargo-deny', '0.20.2', ['linux-x64', 'macos-arm64']),
    entry('pypi:vulture', '2.16', []),
  ].join('\n');
  const composer = `${MISE_TOML}"http:composer" = { version = "2.10.3", url = "https://getcomposer.org/download/{{ version }}/composer.phar" }\n`;
  assert.deepEqual(miseLockFindings(toolchainCheckout(t, { 'mise.toml': composer, 'mise.lock': `${lock}\n${entry('http:composer', '2.10.3', [])}` })), [
    'mise.lock does not pin go 1.27.2; run make toolchain-lock',
    'mise.lock pins python 3.14.8 for linux-arm64 without the sha256 of its archive; run make toolchain-lock',
    'mise.lock pins python 3.14.8 for macos-arm64 without the sha256 of its archive; run make toolchain-lock',
    'mise.lock pins python 3.14.8 for macos-x64 without the sha256 of its archive; run make toolchain-lock',
    'mise.lock does not pin ruff 0.17.0; run make toolchain-lock',
    'mise.lock pins cargo-deny 0.20.2 for linux-arm64 without the sha256 of its archive; run make toolchain-lock',
    'mise.lock pins cargo-deny 0.20.2 for macos-x64 without the sha256 of its archive; run make toolchain-lock',
    'mise.lock pins pypi:vulture 2.16 without the digest of its uv lock; install uv with mise and run make toolchain-lock',
    'mise.lock pins http:composer 2.10.3 for linux-x64 without the sha256 of its archive; run make toolchain-lock, after declaring the checksum of http:composer in mise.toml',
    'mise.lock pins http:composer 2.10.3 for linux-arm64 without the sha256 of its archive; run make toolchain-lock, after declaring the checksum of http:composer in mise.toml',
    'mise.lock pins http:composer 2.10.3 for macos-arm64 without the sha256 of its archive; run make toolchain-lock, after declaring the checksum of http:composer in mise.toml',
    'mise.lock pins http:composer 2.10.3 for macos-x64 without the sha256 of its archive; run make toolchain-lock, after declaring the checksum of http:composer in mise.toml',
  ]);
});

// An ARM Linux runner or an Intel Mac installs the tools of mise.lock only when the lock pins their archives (K134).
test('mise.lock pins the archive of every platform on which the bootstrap installs mise (K134)', (t) => {
  const two = LOCK.replaceAll(/\[tools\."[^"]+"\."platforms\.(linux-arm64|macos-x64)"\]\nchecksum = "[^"]+"\nurl = "[^"]+"\n/g, '');
  const root = toolchainCheckout(t, { 'mise.toml': MISE_TOML, 'mise.lock': two });
  const findings = miseLockFindings(root);
  assert.ok(findings.includes('mise.lock pins go 1.27.2 for linux-arm64 without the sha256 of its archive; run make toolchain-lock'), findings.join('\n'));
  assert.ok(findings.includes('mise.lock pins go 1.27.2 for macos-x64 without the sha256 of its archive; run make toolchain-lock'), findings.join('\n'));
});
