// Tests of scripts/kit/toolchain-mise.mts (K127): the tools of mise.toml are read with their releases as declared and the key
// that declares them; a key of another tool passes through to mise, which judges its config (K839). mise.lock is mise's record, which kit does not judge (K835).
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { declaredMiseTools } from '../../scripts/kit/toolchain-mise.mts';
import { toolchainCheckout } from './toolchain-checkout.mts';

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

test('a key of another tool passes through to mise, and a release is taken as declared (K835, K839)', (t) => {
  assert.deepEqual(declaredMiseTools(toolchainCheckout(t, { 'mise.toml': '[tools]\ndeno = "2.6.0"\n"http:example" = "1.2.3"\n"http:x" = { url = "http://example.invalid/x" }\n' })), {});
  assert.deepEqual(declaredMiseTools(toolchainCheckout(t, { 'mise.toml': '[tools]\nnode = "26"\ngo = "1.27"\n"pypi:vulture" = "latest"\n' })), {
    node: { version: '26', source: 'mise.toml tools.node' },
    go: { version: '1.27', source: 'mise.toml tools.go' },
    vulture: { version: 'latest', source: 'mise.toml tools.pypi:vulture' },
  });
  // A list declares the tool at its first release, and a table without a version at the release that mise resolves.
  assert.deepEqual(declaredMiseTools(toolchainCheckout(t, { 'mise.toml': '[tools]\npython = ["3.14.8", "3.13.1"]\nruff = { backend = "aqua" }\n' })), {
    python: { version: '3.14.8', source: 'mise.toml tools.python' },
    ruff: { version: 'as mise resolves it', source: 'mise.toml tools.ruff' },
  });
});

test('a repository declares an http tool of its own, which mise installs and kit passes through (K327, K839)', (t) => {
  const http = '"http:example" = { version = "1.2.3", url = "https://example.invalid/example-{{version}}.phar" }\n';
  assert.deepEqual(Object.keys(declaredMiseTools(toolchainCheckout(t, { 'mise.toml': `${MISE_TOML}${http}` }))), ['go', 'python', 'ruff', 'govulncheck', 'cargoAudit', 'cargoNextest', 'cargoDeny', 'vulture']);
});

// K854: a missing tool fails the target that runs it, so kit keeps no check of the installed tools: toolchain-check is deleted, and
// the tool names that install-tools and ci-setup select from are the list of this module.
test('K854: toolchain-check is deleted, and the tool names are those of toolchain-mise', async () => {
  const kit = new URL('../../scripts/kit/', import.meta.url);
  assert.equal(existsSync(new URL('check-toolchain.mts', kit)), false);
  assert.doesNotMatch(readFileSync(new URL('kit.mk', kit), 'utf8'), /^toolchain-check:/m);
  const { TOOLS, MISE_TOOLS } = await import('../../scripts/kit/toolchain-mise.mts') as { TOOLS?: readonly string[]; MISE_TOOLS: Record<string, unknown> };
  assert.deepEqual(TOOLS?.slice(0, 8), ['node', 'npm', 'mise', 'rust', 'php', 'phpunit', 'phpcs', 'phpstan']);
  assert.deepEqual(TOOLS?.slice(8), Object.keys(MISE_TOOLS).filter(name => name !== 'node'), 'every tool of mise is a selectable name');
});
