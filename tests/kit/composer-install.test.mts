// composer-install runs composer install of the selected manifest's lock, then makes each installed provided package one plain
// directory symlink to its checkout (K761); no path repository and no composer update are needed.
import assert from 'node:assert/strict';
import { chmodSync, readFileSync, readlinkSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { composerInstall } from '../../scripts/kit/composer-install.mts';
import { tree } from './tree.mts';

test('composer install installs the lock, then links each installed provided package to its checkout with no path repository (K761)', (t) => {
  const release = '{"require":{"example/local":"1.0.0"}}';
  const root = tree(t, {
    'composer.json': release,
    'composer.lock': '{"packages":[{"name":"example/local","version":"1.0.0"}]}',
    'source/composer.json': '{"name":"example/local","version":"2.0.0"}',
    composer: '#!/bin/sh\necho "$*" >> commands.log\nif [ "$1" = config ]; then printf vendor; fi\nif [ "$1" = install ]; then mkdir -p vendor/example/local && echo release > vendor/example/local/package.txt; fi\n',
  });
  const command = path.join(root, 'composer');
  chmodSync(command, 0o755);
  const result = composerInstall({ directory: root, checkouts: [path.join(root, 'source')], env: { ...process.env, COMPOSER_BIN: command }, print: () => {} });
  assert.equal(result, 'linked');
  assert.equal(readlinkSync(path.join(root, 'vendor/example/local')), '../../source');
  assert.doesNotMatch(readFileSync(path.join(root, 'commands.log'), 'utf8'), /^update/m, 'no composer update re-resolves the project');
  assert.equal(readFileSync(path.join(root, 'composer.json'), 'utf8'), release, 'the release manifest is unchanged');
});
