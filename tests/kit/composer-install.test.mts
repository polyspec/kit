// Composer owns local path installs and their lock, installed records and autoload (K657-2).
import assert from 'node:assert/strict';
import { chmodSync, existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { composerInstall, composerLink } from '../../scripts/kit/composer-install.mts';
import { tree, put } from './tree.mts';

test('Composer local links require an explicit path repository before the package manager runs (K657-2)', (t) => {
  const root = tree(t, { 'composer.json': '{"require":{"example/local":"*"}}', 'source/composer.json': '{"name":"example/local","version":"1.0.0"}', 'vendor/example/local/package.txt': 'release' });
  const folders = [{ ecosystem: 'composer' as const, name: 'example/local', folder: path.join(root, 'vendor/example/local'), target: path.join(root, 'source') }];
  assert.throws(() => composerLink(root, folders, { command: 'unused-composer', env: {} }, () => {}), /path repository/);
  assert.equal(readFileSync(path.join(root, 'vendor/example/local/package.txt'), 'utf8'), 'release');
  assert.equal(existsSync(path.join(root, 'var/link/composer')), false);
});

test('Composer receives the explicit development manifest and owns its native update (K657-2)', (t) => {
  const root = tree(t, {
    'composer.json': '{"require":{"example/local":"1.0.0"}}',
    'composer.local.json': '{"require":{"example/local":"*"},"repositories":[{"type":"path","url":"source","options":{"symlink":true}}]}',
    'source/composer.json': '{"name":"example/local","version":"2.0.0"}',
    'vendor/example/local/package.txt': 'release',
  });
  const script = path.join(root, 'composer.mjs');
  writeFileSync(script, `import { appendFileSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const args = process.argv.slice(2);
appendFileSync('commands.jsonl', JSON.stringify({ args, manifest: process.env.COMPOSER, vendor: process.env.COMPOSER_VENDOR_DIR }) + '\\n');
if (args[0] === 'config') { process.stdout.write('vendor'); }
if (args[0] === 'update') {
  const manifest = JSON.parse(readFileSync(process.env.COMPOSER, 'utf8'));
  const repository = manifest.repositories[0];
  rmSync('vendor/example/local', { recursive: true, force: true });
  mkdirSync('vendor/example', { recursive: true });
  symlinkSync(path.relative(path.resolve('vendor/example'), path.resolve(repository.url)), 'vendor/example/local');
  writeFileSync('composer.local.lock', '{"native":"updated"}');
  writeFileSync('vendor/autoload.php', '<?php // native autoload');
}
`);
  const command = path.join(root, 'composer');
  put(root, { composer: `#!/bin/sh\nexec '${process.execPath}' '${script}' "$@"\n` });
  chmodSync(command, 0o755);
  const release = readFileSync(path.join(root, 'composer.json'), 'utf8');
  const result = composerInstall({ directory: root, checkouts: [path.join(root, 'source')], env: { ...process.env, COMPOSER_BIN: command, COMPOSER: 'composer.local.json', COMPOSER_VENDOR_DIR: 'vendor' }, print: () => {} });
  assert.equal(result, 'linked');
  const commands = readFileSync(path.join(root, 'commands.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line) as { args: string[]; manifest: string });
  assert.ok(commands.every(entry => entry.manifest === 'composer.local.json'));
  assert.ok(commands.some(entry => entry.args[0] === 'update' && entry.args.includes('example/local') && entry.args.includes('--with-dependencies')));
  assert.equal(realpathSync(path.join(root, 'vendor/example/local')), realpathSync(path.join(root, 'source')));
  assert.equal(readFileSync(path.join(root, 'composer.local.lock'), 'utf8'), '{"native":"updated"}');
  assert.equal(readFileSync(path.join(root, 'composer.json'), 'utf8'), release);
  assert.equal(existsSync(path.join(root, 'var/link/composer')), false);
});

test('a native Composer resolution failure leaves the existing package in place and propagates (K657-2)', (t) => {
  const root = tree(t, { 'composer.json': '{"repositories":[{"type":"path","url":"source","options":{"symlink":true}}]}', 'source/composer.json': '{"name":"example/local"}', 'vendor/example/local/package.txt': 'release', composer: '#!/bin/sh\nexit 31\n' });
  const command = path.join(root, 'composer');
  chmodSync(command, 0o755);
  const folders = [{ ecosystem: 'composer' as const, name: 'example/local', folder: path.join(root, 'vendor/example/local'), target: path.join(root, 'source') }];
  assert.throws(() => composerLink(root, folders, { command, env: process.env }, () => {}), /exited with 31/);
  assert.equal(readFileSync(path.join(root, 'vendor/example/local/package.txt'), 'utf8'), 'release');
  assert.equal(existsSync(path.join(root, 'var/link/composer')), false);
});
