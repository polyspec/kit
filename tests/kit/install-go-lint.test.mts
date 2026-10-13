// Tests of the Go lint tools of install-tools: golangci-lint is downloaded as the release archive of the platform with its
// sha256 checked, unpacked into var/tools/golangci-lint and wrapped (scripts/kit/install-golangci-lint.mts); deadcode is built
// by go install of the recorded golang.org/x/tools release into var/tools/deadcode, whose release go version -m reads
// (scripts/kit/install-deadcode.mts). A second run installs nothing, and a wrong digest or release fails with both. curl and
// go are PATH stubs, so no test reaches a network.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { toolchainCheckout } from './toolchain-checkout.mts';
import { golangciLintRelease, pinnedGo, toolchainStubs } from './toolchain-stubs.mts';
import { tool } from './kit-tools.mts';

const install = (root: string, env: NodeJS.ProcessEnv, ...tools: string[]) => spawnSync(process.execPath, [tool('install-tools'), ...tools], { cwd: root, env, encoding: 'utf8' });
const config = (value: object) => JSON.stringify({ schema: 1, ...value });

test('golangci-lint is downloaded with its sha256 checked, unpacked into var/tools/golangci-lint, wrapped, and kept by a second run', (t) => {
  const lint = golangciLintRelease(t);
  const root = toolchainCheckout(t, { 'config/toolchain.json': config({ golangciLint: lint.declared }) });
  const stubs = toolchainStubs(t, { downloads: { [lint.url]: lint.archive } });
  const first = install(root, stubs.env, 'golangciLint');
  assert.equal(first.status, 0, first.stderr);
  assert.equal(lint.url, `https://github.com/golangci/golangci-lint/releases/download/v2.14.0/golangci-lint-2.14.0-${lint.target}.tar.gz`);
  const version = spawnSync(path.join(root, 'var/tools/bin/golangci-lint'), ['version'], { encoding: 'utf8', env: stubs.env });
  assert.match(version.stdout, /^golangci-lint has version 2\.14\.0 /);
  const second = install(root, stubs.env, 'golangciLint');
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /golangci-lint: 2\.14\.0 is installed in var\/tools\/golangci-lint/);
  assert.equal(stubs.calls().filter(line => line.startsWith('curl')).length, 1, 'a second run downloads nothing');
});

test('a golangci-lint archive with another digest is refused, and nothing is installed', (t) => {
  const lint = golangciLintRelease(t);
  const root = toolchainCheckout(t, { 'config/toolchain.json': config({ golangciLint: { ...lint.declared, sha256: { [lint.key]: '0'.repeat(64) } } }) });
  const result = install(root, toolchainStubs(t, { downloads: { [lint.url]: lint.archive } }).env, 'golangciLint');
  assert.equal(result.status, 1);
  const actual = createHash('sha256').update(readFileSync(lint.archive)).digest('hex');
  assert.match(result.stderr, new RegExp(`has the sha256 ${actual}; config/toolchain\\.json golangciLint declares ${'0'.repeat(64)} for ${lint.key}`));
  assert.equal(existsSync(path.join(root, 'var/tools/golangci-lint')), false);
});

test('deadcode is built by go install of the recorded golang.org/x/tools release, wrapped, and kept by a second run', (t) => {
  const root = toolchainCheckout(t, { 'config/toolchain.json': config({ deadcode: '0.52.0' }) });
  const stubs = toolchainStubs(t);
  stubs.env = pinnedGo(t, stubs, root);
  const first = install(root, stubs.env, 'deadcode');
  assert.equal(first.status, 0, first.stderr);
  assert.deepEqual(stubs.calls().filter(line => line.startsWith('go install')), ['go install golang.org/x/tools/cmd/deadcode@v0.52.0']);
  assert.match(readFileSync(path.join(root, 'var/tools/bin/deadcode'), 'utf8'), /var\/tools\/deadcode\/bin\/deadcode' "\$@"\n$/);
  const second = install(root, stubs.env, 'deadcode');
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /deadcode: 0\.52\.0 is installed in var\/tools\/deadcode/);
  assert.equal(stubs.calls().filter(line => line.startsWith('go install')).length, 1, 'a second run builds nothing');
});

test('a deadcode of another golang.org/x/tools release fails with the expected and the actual release', (t) => {
  const root = toolchainCheckout(t, { 'config/toolchain.json': config({ deadcode: '0.52.0' }) });
  const shows = (release: string) => { const stubs = toolchainStubs(t, { extra: { STUB_DEADCODE_SHOWS: release } }); return pinnedGo(t, stubs, root); };
  const wrong = install(root, shows('0.51.0'), 'deadcode');
  assert.equal(wrong.status, 1);
  assert.match(wrong.stderr, /the installation of deadcode 0\.52\.0 into .* prints 0\.51\.0; expected 0\.52\.0/);
  const unread = install(root, shows('none'), 'deadcode');
  assert.equal(unread.status, 1);
  assert.match(unread.stderr, /go version -m .*deadcode printed no release of golang\.org\/x\/tools: /);
});

// The runner of CI has a Go of its own on PATH, older than the pin: a deadcode or govulncheck that it built reads no module of
// the pinned go line ("package requires newer Go version"). Both build with var/tools/bin/go, the Go of the kit pin.
test('deadcode and govulncheck are built and read with var/tools/bin/go, never with the go of PATH', (t) => {
  const root = toolchainCheckout(t, { 'config/toolchain.json': config({ deadcode: '0.52.0', govulncheck: '1.1.4' }) });
  const stubs = toolchainStubs(t);
  const env = pinnedGo(t, stubs, root);
  const result = install(root, env, 'deadcode', 'govulncheck');
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(stubs.calls().filter(line => line.startsWith('go install')), ['go install golang.org/x/vuln/cmd/govulncheck@v1.1.4', 'go install golang.org/x/tools/cmd/deadcode@v0.52.0']);
  assert.equal(install(root, env, 'deadcode', 'govulncheck').status, 0, 'the installed releases are read with the pinned go');
});
