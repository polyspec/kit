// Tests of cargo-downloads-fetch: it runs cargo fetch --locked for every tracked Cargo.lock and the lock of kit's catch-check,
// and names each failed lock with the first error line of cargo; kit judges no crate presence (K864). cargo is a stub.
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { cargoDownloads } from '../../scripts/kit/fetch-cargo-downloads.mts';
import { CATCH_CHECK_MANIFEST } from '../../scripts/kit/lint-rust.mts';
import { kitPackageRoot } from '../../scripts/kit/kit-files.mts';
import { fixtureCheckout as fixture } from './checkout.mts';

const PROVIDER_MANIFEST = path.resolve(kitPackageRoot(), CATCH_CHECK_MANIFEST);
const PROVIDER_LOCK = path.join(path.dirname(PROVIDER_MANIFEST), 'Cargo.lock');

// A cargo that logs its arguments and fails for a manifest named by MISSING with the error line of cargo.
function cargoStub(root: string) {
  const bin = path.join(root, 'stub-bin');
  mkdirSync(bin, { recursive: true });
  const log = path.join(root, 'cargo.log');
  writeFileSync(log, '');
  writeFileSync(path.join(bin, 'cargo'), `#!/bin/sh
echo "cargo $*" >> "${log}"
case "$*" in *"$MISSING"*) echo "error: failed to download crate itoa v1.0.15" >&2; echo "note: see the network" >&2; exit 101;; esac
`);
  chmodSync(path.join(bin, 'cargo'), 0o755);
  return { cargo: path.join(bin, 'cargo'), calls: () => readFileSync(log, 'utf8').split('\n').filter(Boolean) };
}

test('every Cargo.lock is fetched with cargo fetch --locked, online, as cargo-downloads-fetch runs it', (t) => {
  const root = fixture(t);
  const stub = cargoStub(root);
  const printed: string[] = [];
  const { locks, failures } = cargoDownloads({ root, cargo: stub.cargo, env: { ...process.env, MISSING: 'none' }, print: (line: string) => printed.push(line) });
  assert.deepEqual(locks, ['packages/fixture-rust/Cargo.lock', PROVIDER_LOCK]);
  assert.deepEqual(failures, []);
  assert.deepEqual(stub.calls(), [
    'cargo fetch --locked --manifest-path packages/fixture-rust/Cargo.toml',
    `cargo fetch --locked --manifest-path ${PROVIDER_MANIFEST}`,
  ]);
  assert.deepEqual(printed, ['packages/fixture-rust/Cargo.lock: fetched', `${PROVIDER_LOCK}: fetched`]);
});

test('a failed fetch names the lock and the first error line of cargo', (t) => {
  const root = fixture(t);
  const stub = cargoStub(root);
  const { failures } = cargoDownloads({ root, cargo: stub.cargo, env: { ...process.env, MISSING: 'fixture-rust' } });
  assert.deepEqual(failures, ['packages/fixture-rust/Cargo.lock: error: failed to download crate itoa v1.0.15']);
});

// K864: crate presence is the state of cargo; kit keeps no offline check of it, only the fetch that kit CI runs.
test('kit has no check of crate presence: no cargo-downloads-check target and no offline mode (K864)', () => {
  const kitMk = readFileSync(fileURLToPath(import.meta.resolve('../../scripts/kit/kit.mk')), 'utf8');
  assert.doesNotMatch(kitMk, /^cargo-downloads-check:/m);
  assert.match(kitMk, /^cargo-downloads-fetch:.*\n\t\$\(ONLINE\) \$\(NODE\) \$\(KIT\)\/fetch-cargo-downloads\.\$\(KIT_EXT\)$/m);
});

test('K710 fetch includes the Kit catch-check lock for a consumer without fetching the same lock twice', (t) => {
  const root = fixture(t);
  const providerRoot = path.join(root, 'node_modules/@polyspec/kit');
  const providerFolder = path.join(providerRoot, 'scripts/kit/catch-check-rust');
  mkdirSync(providerFolder, { recursive: true });
  writeFileSync(path.join(providerFolder, 'Cargo.toml'), '[package]\nname = "catch-check-rust"\nversion = "0.1.0"\n');
  writeFileSync(path.join(providerFolder, 'Cargo.lock'), 'version = 3\n');
  const stub = cargoStub(root);
  const { locks, failures } = cargoDownloads({ root, providerRoot, cargo: stub.cargo, env: { ...process.env, MISSING: 'none' } });
  assert.deepEqual(locks, ['packages/fixture-rust/Cargo.lock', path.join(providerRoot, 'scripts/kit/catch-check-rust/Cargo.lock')]);
  assert.deepEqual(failures, []);
  assert.deepEqual(stub.calls(), [
    'cargo fetch --locked --manifest-path packages/fixture-rust/Cargo.toml',
    `cargo fetch --locked --manifest-path ${path.join(providerFolder, 'Cargo.toml')}`,
  ]);

  const kitRoot = fixture(t);
  const kitFolder = path.join(kitRoot, 'scripts/kit/catch-check-rust');
  mkdirSync(kitFolder, { recursive: true });
  writeFileSync(path.join(kitFolder, 'Cargo.toml'), '[package]\nname = "catch-check-rust"\nversion = "0.1.0"\n');
  writeFileSync(path.join(kitFolder, 'Cargo.lock'), 'version = 3\n');
  const providerStub = cargoStub(kitRoot);
  const providerFetch = cargoDownloads({ root: kitRoot, providerRoot: kitRoot, cargo: providerStub.cargo, env: { ...process.env, MISSING: 'none' } });
  assert.deepEqual(providerFetch.locks, ['packages/fixture-rust/Cargo.lock', 'scripts/kit/catch-check-rust/Cargo.lock']);
  assert.deepEqual(providerFetch.failures, []);
  assert.deepEqual(providerStub.calls(), [
    'cargo fetch --locked --manifest-path packages/fixture-rust/Cargo.toml',
    'cargo fetch --locked --manifest-path scripts/kit/catch-check-rust/Cargo.toml',
  ]);
});
