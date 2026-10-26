// Native uv owns declarations, lock validation, installation and dependency validation; these unit fixtures only record commands.
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { uvEditable, uvInstallCommand } from '../../scripts/kit/uv-install.mts';

function fixture(t: { after: (fn: () => void) => void }) {
  const root = mkdtempSync(path.join(tmpdir(), 'kit-uv-native-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, '.venv'), { recursive: true });
  writeFileSync(path.join(root, '.venv/pyvenv.cfg'), 'native fixture environment\n');
  const log = path.join(root, 'commands');
  const uv = path.join(root, 'uv');
  writeFileSync(path.join(root, 'pyproject.toml'), '[project]\nname = "consumer"\nversion = "0.0.0"\ndependencies = ["polyspec-new-unreleased"]\n');
  writeFileSync(uv, `#!/bin/sh\nprintf '%s\\n' "$*" >> '${log}'\nif [ "$1 $2" = "workspace dir" ]; then echo '${root}'; fi\nif [ "$1 $2" = "pip list" ]; then if [ -n "$UV_FIXTURE_LIST" ]; then printf '%s\\n' "$UV_FIXTURE_LIST"; exit 0; fi; printf '[{"name":"polyspec-new-unreleased","editable_project_location":"%s"}]\\n' "\${UV_FIXTURE_LOCATION:-${root}}"; fi\nif [ "$1 $2" = "pip check" ] && [ "$UV_FIXTURE_CONFLICT" = yes ]; then echo 'incompatible native dependency requirement' >&2; exit 1; fi\n`);
  chmodSync(uv, 0o755);
  return { root, log, uv, env: { ...process.env, UV: uv } };
}

test('K689: native source linking installs declared providers without syncing the release lock', { timeout: 30_000 }, (t) => {
  const { root, log, uv, env } = fixture(t);
  assert.deepEqual(uvEditable({ directory: root, uv, env }), ['polyspec-new-unreleased']);
  const commands = readFileSync(log, 'utf8').trim().split('\n');
  assert.equal(commands[0], 'workspace dir');
  assert.match(commands[1] ?? '', /^pip check --python /);
  assert.match(commands[2] ?? '', /^pip list --python .* --format json$/);
  const provider = { ecosystem: 'python' as const, name: 'polyspec-new-unreleased', folder: root, repository: root, checkout: root };
  assert.deepEqual(uvEditable({ directory: root, uv, env, providers: [provider, { ...provider, name: 'unused-sibling', folder: '/unused-sibling' }] }), ['polyspec-new-unreleased']);
  const linked = readFileSync(log, 'utf8').trim().split('\n').slice(3);
  assert.equal(linked[0], 'workspace dir');
  assert.match(linked[1] ?? '', /^pip install --offline --python .* --reinstall-package polyspec-new-unreleased --editable /);
  assert.match(linked[2] ?? '', /^pip check --python /);
  assert.match(linked[3] ?? '', /^pip list --python .* --format json$/);
  assert.equal(linked.some(command => command.includes('unused-sibling')), false);
  assert.throws(() => uvEditable({ directory: root, uv, env: { ...env, UV_FIXTURE_LOCATION: path.dirname(root) }, providers: [provider] }), /not the expected development source.*run uv-install again/s);

});

test('K664-1: incompatible native dependency checks are failures with development declaration guidance', { timeout: 30_000 }, (t) => {
  const { root, uv, env } = fixture(t);
  assert.throws(() => uvEditable({ directory: root, uv, env: { ...env, UV_FIXTURE_CONFLICT: 'yes' } }), /ensure each local provider is compatible.*incompatible native dependency requirement/s);
});

test('K664-1: the command forwards supported native sync flags and rejects bypass flags', { timeout: 30_000 }, (t) => {
  const { root, log, env } = fixture(t);
  const lines: string[] = [];
  assert.equal(uvInstallCommand([root, root], { ...env, UV_SYNC: '--all-groups --no-install-project' }, line => lines.push(line)), 0);
  assert.match(readFileSync(log, 'utf8'), /^sync --locked --all-groups --no-install-project/m);
  assert.match(lines.join(''), /native locked development sync passed/);
  assert.equal(uvInstallCommand([root, root], { ...env, UV_SYNC: '--no-deps' }, () => {}), 1);
});


test('K689-1: every selected local provider must be present in the native installed list', { timeout: 30_000 }, (t) => {
  const { root, uv, env } = fixture(t);
  const provider = { ecosystem: 'python' as const, name: 'polyspec-new-unreleased', folder: root, repository: root, checkout: root };
  const providers = [provider, { ...provider, name: 'unused-sibling', folder: '/unused-sibling' }];
  for (const list of ['[]', '[{"name":"unrelated-release","version":"1.0.0"}]']) {
    assert.throws(() => uvEditable({ directory: root, uv, env: { ...env, UV_FIXTURE_LIST: list }, providers }), /selected local Python provider polyspec-new-unreleased is missing from the installed distributions/);
  }
  assert.deepEqual(uvEditable({ directory: root, uv, env, providers }), ['polyspec-new-unreleased']);
  assert.throws(() => uvEditable({ directory: root, uv, env: { ...env, UV_FIXTURE_LOCATION: path.dirname(root) }, providers }), /not the expected development source/);
  assert.deepEqual(uvEditable({ directory: root, uv, env: { ...env, UV_FIXTURE_LIST: '[{"name":"unrelated-release","version":"1.0.0"}]' }, providers: [{ ...provider, name: 'unused-sibling' }] }), [], 'valid release-only installs require no unrelated provider');
});


test('K689-2: source runtime providers share one native dependency-resolution transaction', { timeout: 30_000 }, (t) => {
  const { root, uv, env, log } = fixture(t);
  writeFileSync(path.join(root, 'pyproject.toml'), '[project]\nname = "app"\nversion = "0"\ndependencies = ["polyspec-new-unreleased[fast]"]\n');
  const beta = path.join(root, 'beta');
  const child = path.join(root, 'child');
  mkdirSync(beta);
  mkdirSync(child);
  writeFileSync(path.join(beta, 'pyproject.toml'), '[project]\nname = "polyspec-new-unreleased"\nversion = "0.0.2"\ndependencies = ["polyspec-child>=0.0.1", "external>=1"]\n');
  writeFileSync(path.join(child, 'pyproject.toml'), '[project]\nname = "polyspec-child"\nversion = "0.0.1"\ndependencies = []\n');
  const providers = [
    { ecosystem: 'python' as const, name: 'polyspec-new-unreleased', folder: beta, repository: beta, checkout: beta },
    { ecosystem: 'python' as const, name: 'polyspec-child', folder: child, repository: child, checkout: child },
  ];
  const list = JSON.stringify(providers.map(provider => ({ name: provider.name, editable_project_location: provider.folder })));
  assert.deepEqual(uvEditable({ directory: root, providers, uv, env: { ...env, UV_FIXTURE_LIST: list } }), providers.map(provider => provider.name));
  const installs = readFileSync(log, 'utf8').split('\n').filter(line => line.startsWith('pip install '));
  assert.equal(installs.length, 1);
  assert.ok(installs[0]?.includes(`--editable ${beta}[fast]`));
  assert.ok(installs[0]?.includes(`--editable ${child}`));
  assert.doesNotMatch(installs[0] ?? '', /--no-deps/);
});


test('K689-3: source linking never reconciles a release lock, while the installer does so exactly once', { timeout: 30_000 }, (t) => {
  const { root, uv, env, log } = fixture(t);
  uvEditable({ directory: root, uv, env });
  assert.doesNotMatch(readFileSync(log, 'utf8'), /^sync /m);
  writeFileSync(log, '');
  assert.equal(uvInstallCommand([root, root], env, () => {}), 0);
  assert.equal(readFileSync(log, 'utf8').split('\n').filter(line => line.startsWith('sync ')).length, 1);
  rmSync(path.join(root, '.venv'), { recursive: true });
  assert.throws(() => uvEditable({ directory: root, uv, env }), /requires an existing native environment/);
});
