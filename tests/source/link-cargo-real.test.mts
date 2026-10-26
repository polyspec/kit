// Native Cargo source selection, without network access or compilation.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { isJsonObject } from '../../scripts/kit/bootstrap/files.mts';
import { initRepository } from '../kit/sandbox-repository.mts';
import { put } from '../kit/tree.mts';

test('K664-3 native Cargo selects an unreleased path source repeatedly without changing the tracked lock', { timeout: 30000 }, t => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-cargo-source-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const provider = path.join(root, 'provider');
  const consumer = path.join(root, 'consumer');
  for (const folder of [provider, consumer]) { mkdirSync(folder); initRepository(folder); }
  put(provider, { 'Cargo.toml': '[package]\nname="polyspec-native-source"\nversion="0.0.2"\nedition="2024"\n', 'src/lib.rs': 'pub fn value() -> u8 { 2 }\n', 'config/release.json': JSON.stringify({ repositoryUrl: 'https://example.invalid/native-source' }) });
  put(consumer, { '.gitignore': 'var/\ntarget/\n', 'Cargo.toml': '[package]\nname="native-consumer"\nversion="0.0.1"\nedition="2024"\n[dependencies]\npolyspec-native-source={path="../provider"}\n', 'src/lib.rs': 'pub fn value() -> u8 { polyspec_native_source::value() }\n' });
  const env = { ...process.env, CARGO_NET_OFFLINE: 'true' };
  const generated = spawnSync('cargo', ['+1.99.0', 'generate-lockfile', '--offline'], { cwd: consumer, env, encoding: 'utf8' });
  assert.equal(generated.status, 0, generated.stderr);
  for (const folder of [provider, consumer]) assert.equal(spawnSync('git', ['add', '-A'], { cwd: folder }).status, 0);
  const tracked = readFileSync(path.join(consumer, 'Cargo.lock'), 'utf8');
  const args = ['+1.99.0', 'metadata', '--offline', '--locked', '--format-version=1'];
  for (let repeat = 0; repeat < 2; repeat++) {
    const executed = spawnSync(process.execPath, [fileURLToPath(new URL('../../scripts/kit/link.mts', import.meta.url)), 'cargo', '--checkout', provider, consumer, ...args], { cwd: consumer, env, encoding: 'utf8' });
    assert.equal(executed.status, 0, executed.stderr);
    const metadata: unknown = JSON.parse(executed.stdout);
    assert.ok(isJsonObject(metadata) && Array.isArray(metadata.packages));
    const selected: unknown = metadata.packages.find(item => isJsonObject(item) && item.name === 'polyspec-native-source');
    assert.ok(isJsonObject(selected));
    assert.equal(selected.version, '0.0.2');
    assert.equal(selected.manifest_path, path.join(provider, 'Cargo.toml'));
    const linked = path.join(consumer, 'var/link/cargo/root/Cargo.lock');
    assert.equal(readFileSync(linked, 'utf8'), tracked);
    assert.equal(readFileSync(path.join(consumer, 'Cargo.lock'), 'utf8'), tracked);
    assert.equal(existsSync(path.join(consumer, 'var/link/cargo/root/execution.lock')), false);
  }
  assert.equal(existsSync(path.join(consumer, 'target')), false, 'metadata compiles nothing');
});

test('K676 native Cargo chooses each checkout workspace target without inheriting another checkout target', t => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-cargo-target-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const main = path.join(root, 'main');
  const worktree = path.join(root, 'worktree');
  mkdirSync(main);
  initRepository(main, '--initial-branch=main');
  put(main, { 'Cargo.toml': '[workspace]\nmembers=["crate"]\nresolver="3"\n', 'crate/Cargo.toml': '[package]\nname="target-proof"\nversion="0.0.1"\nedition="2024"\n', 'crate/src/lib.rs': 'pub fn value() -> u8 { 1 }\n' });
  const env = { ...process.env, CARGO_NET_OFFLINE: 'true', CARGO_TARGET_DIR: path.join(root, 'other-checkout/target') };
  assert.equal(spawnSync('cargo', ['+1.99.0', 'generate-lockfile', '--offline'], { cwd: main, env }).status, 0);
  for (const args of [['add', '-A'], ['commit', '--quiet', '-m', 'base'], ['worktree', 'add', '--quiet', '-b', 'proof', worktree]]) {
    const result = spawnSync('git', args, { cwd: main, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  }
  const lock = readFileSync(path.join(main, 'Cargo.lock'), 'utf8');
  for (const checkout of [main, worktree]) {
    const metadata = spawnSync(process.execPath, [fileURLToPath(new URL('../../scripts/kit/link.mts', import.meta.url)), 'cargo', path.join(checkout, 'crate'), '+1.99.0', 'metadata', '--offline', '--locked', '--no-deps', '--format-version=1'], { cwd: checkout, env, encoding: 'utf8' });
    assert.equal(metadata.status, 0, metadata.stderr);
    const parsed: unknown = JSON.parse(metadata.stdout);
    assert.ok(isJsonObject(parsed));
    assert.equal(parsed.target_directory, path.join(checkout, 'target'));
    assert.equal(readFileSync(path.join(checkout, 'Cargo.lock'), 'utf8'), lock);
    assert.equal(existsSync(path.join(checkout, 'target')), false, 'metadata compiles no crate');
  }
  assert.equal(existsSync(env.CARGO_TARGET_DIR), false);
});
