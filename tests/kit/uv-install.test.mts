// Native uv owns declarations, lock validation, installation and dependency validation; these unit fixtures only record commands.
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { uvEditable, uvInstallCommand } from '../../scripts/kit/uv-install.mts';

function fixture(t: { after: (fn: () => void) => void }) {
  const root = mkdtempSync(path.join(tmpdir(), 'kit-uv-native-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const log = path.join(root, 'commands');
  const uv = path.join(root, 'uv');
  writeFileSync(path.join(root, 'pyproject.toml'), '[project]\nname = "consumer"\nversion = "0.0.0"\ndependencies = ["polyspec-new-unreleased"]\n');
  writeFileSync(uv, `#!/bin/sh\nprintf '%s\\n' "$*" >> '${log}'\nif [ "$1 $2" = "workspace dir" ]; then echo '${root}'; fi\nif [ "$1 $2" = "pip list" ]; then if [ -n "$UV_FIXTURE_LIST" ]; then printf '%s\\n' "$UV_FIXTURE_LIST"; exit 0; fi; printf '[{"name":"polyspec-new-unreleased","editable_project_location":"%s"}]\\n' "\${UV_FIXTURE_LOCATION:-${root}}"; fi\nif [ "$1 $2" = "pip check" ] && [ "$UV_FIXTURE_CONFLICT" = yes ]; then echo 'incompatible native dependency requirement' >&2; exit 1; fi\n`);
  chmodSync(uv, 0o755);
  return { root, log, uv, env: { ...process.env, UV: uv } };
}

test('K689: uv sync excludes declared local providers and installs them as native editables', { timeout: 30_000 }, (t) => {
  const { root, log, uv, env } = fixture(t);
  assert.deepEqual(uvEditable({ directory: root, uv, env }), ['polyspec-new-unreleased']);
  const commands = readFileSync(log, 'utf8').trim().split('\n');
  assert.equal(commands[0], 'workspace dir');
  assert.equal(commands[1], 'sync --locked');
  assert.match(commands[2] ?? '', /^pip check --python /);
  assert.match(commands[3] ?? '', /^pip list --python .* --format json$/);
  const provider = { ecosystem: 'python' as const, name: 'polyspec-new-unreleased', folder: root, repository: root, checkout: root };
  assert.deepEqual(uvEditable({ directory: root, uv, env, providers: [provider, { ...provider, name: 'unused-sibling', folder: '/unused-sibling' }] }), ['polyspec-new-unreleased']);
  const linked = readFileSync(log, 'utf8').trim().split('\n').slice(4);
  assert.equal(linked[0], 'workspace dir');
  assert.equal(linked[1], 'sync --locked --no-install-package polyspec-new-unreleased');
  assert.match(linked[2] ?? '', /^pip install --offline --python .* --no-deps --reinstall-package polyspec-new-unreleased --editable /);
  assert.match(linked[3] ?? '', /^pip check --python /);
  assert.match(linked[4] ?? '', /^pip list --python .* --format json$/);
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
