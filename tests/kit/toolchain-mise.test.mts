// Tests of scripts/kit/toolchain-mise.mts (K127): the tools of mise.toml are read with their releases as declared and the key
// that declares them, and a key of a tool that kit does not check is refused. mise.lock is mise's record, which kit does not judge (K835).
import assert from 'node:assert/strict';
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

test('a tool that kit does not check is refused with the key, and a release is taken as declared (K835)', (t) => {
  assert.throws(() => declaredMiseTools(toolchainCheckout(t, { 'mise.toml': '[tools]\ndeno = "2.6.0"\n' })), /mise\.toml tools declares deno, which kit does not check; the tools are node, go, python, /);
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

test('a repository declares an http tool with a version and an https url (K327)', (t) => {
  const http = '"http:pie" = { version = "1.2.3", url = "https://example.invalid/pie-{{version}}.phar" }\n';
  const checkout = (extra: string) => toolchainCheckout(t, { 'mise.toml': `${MISE_TOML}${extra}` });
  assert.deepEqual(Object.keys(declaredMiseTools(checkout(http))), ['go', 'python', 'ruff', 'govulncheck', 'cargoAudit', 'cargoNextest', 'cargoDeny', 'vulture']);
  assert.throws(() => declaredMiseTools(checkout('"http:pie" = "1.2.3"\n')), /mise\.toml tools\.http:pie: must be a table with the version and the url of the download/);
  assert.throws(() => declaredMiseTools(checkout('"http:pie" = { version = "1.2.3", url = "http://example.invalid/pie" }\n')), /must declare the https url of the download/);
  assert.throws(() => declaredMiseTools(checkout('"http:pie" = { url = "https://example.invalid/pie" }\n')), /must declare the version of the download/);
});
