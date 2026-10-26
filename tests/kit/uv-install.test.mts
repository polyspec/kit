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
  writeFileSync(uv, `#!/bin/sh\nprintf '%s\\n' "$*" >> '${log}'\nif [ "$1 $2" = "workspace dir" ]; then echo '${root}'; fi\nif [ "$1 $2" = "pip list" ]; then printf '[{"name":"new-unreleased","editable_project_location":"%s"}]\\n' "\${UV_FIXTURE_LOCATION:-${root}}"; fi\nif [ "$1 $2" = "pip check" ] && [ "$UV_FIXTURE_CONFLICT" = yes ]; then echo 'incompatible native dependency requirement' >&2; exit 1; fi\n`);
  chmodSync(uv, 0o755);
  return { root, log, uv, env: { ...process.env, UV: uv } };
}

test('K664-1: uv installs native declared sources without selecting from previously installed packages', { timeout: 30_000 }, (t) => {
  const { root, log, uv, env } = fixture(t);
  assert.deepEqual(uvEditable({ directory: root, uv, env }), ['new-unreleased']);
  const commands = readFileSync(log, 'utf8').trim().split('\n');
  assert.equal(commands[0], 'workspace dir');
  assert.equal(commands[1], 'sync --locked');
  assert.match(commands[2] ?? '', /^pip check --python /);
  assert.match(commands[3] ?? '', /^pip list --python .* --format json$/);
  assert.equal(commands.some(command => command.includes('pip install') || command.includes('--no-deps')), false);
  const provider = { ecosystem: 'python' as const, name: 'new-unreleased', folder: root, repository: root, checkout: root };
  assert.deepEqual(uvEditable({ directory: root, uv, env, providers: [provider, { ...provider, name: 'unused-sibling', folder: '/unused-sibling' }] }), ['new-unreleased']);
  assert.throws(() => uvEditable({ directory: root, uv, env: { ...env, UV_FIXTURE_LOCATION: path.dirname(root) }, providers: [provider] }), /not the expected development source.*declare that source/s);

});

test('K664-1: incompatible native dependency checks are failures with development declaration guidance', { timeout: 30_000 }, (t) => {
  const { root, uv, env } = fixture(t);
  assert.throws(() => uvEditable({ directory: root, uv, env: { ...env, UV_FIXTURE_CONFLICT: 'yes' } }), /declare compatible local paths.*incompatible native dependency requirement/s);
});

test('K664-1: the command forwards supported native sync flags and rejects bypass flags', { timeout: 30_000 }, (t) => {
  const { root, log, env } = fixture(t);
  const lines: string[] = [];
  assert.equal(uvInstallCommand([root, root], { ...env, UV_SYNC: '--all-groups --no-install-project' }, line => lines.push(line)), 0);
  assert.match(readFileSync(log, 'utf8'), /^sync --locked --all-groups --no-install-project/m);
  assert.match(lines.join(''), /native locked development sync passed/);
  assert.equal(uvInstallCommand([root, root], { ...env, UV_SYNC: '--no-deps' }, () => {}), 1);
});
