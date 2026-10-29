// Tests of scripts/kit/install-composer-project.mts (K885): Composer runs in the checkout root with --working-dir of the project, so
// the mise shim of Composer reads the mise.toml of the checkout, also when the project lies in a kit checkout that the consumer links.
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { installComposerProject } from '../../scripts/kit/install-composer-project.mts';
import { put } from './tree.mts';

test('composer install of a project in a linked kit runs in the checkout root with --working-dir of the project (K885)', (t) => {
  const parent = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-composer-project-')));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const root = path.join(parent, 'consumer');
  put(path.join(parent, 'kit'), { 'config/php-lint/composer.json': '{}\n', 'mise.toml': '[tools]\n' });
  mkdirSync(path.join(root, 'node_modules', '@polyspec'), { recursive: true });
  symlinkSync('../../../kit', path.join(root, 'node_modules', '@polyspec', 'kit'));
  // The Composer of the checkout records the folder that it starts in and its arguments.
  put(root, { 'var/tools/bin/composer': `#!/bin/sh\npwd -P > ${JSON.stringify(path.join(parent, 'cwd.txt'))}\necho "$@" > ${JSON.stringify(path.join(parent, 'args.txt'))}\n` });
  chmodSync(path.join(root, 'var/tools/bin/composer'), 0o755);
  installComposerProject({ root, label: 'php-lint', folder: 'php-lint', project: 'node_modules/@polyspec/kit/config/php-lint', plugins: true, wrappers: {}, comment: 'test' });
  assert.equal(readFileSync(path.join(parent, 'cwd.txt'), 'utf8').trim(), root, 'Composer starts in the checkout root, not in the kit checkout');
  assert.ok(readFileSync(path.join(parent, 'args.txt'), 'utf8').trim().split(' ').includes(`--working-dir=${path.join(root, 'node_modules/@polyspec/kit/config/php-lint')}`), 'Composer installs the project by its --working-dir');
});
