// The Composer projects that kit writes resolve for the one PHP platform of K282: the minor of .php-version with the patch 1
// (K322). A project of another platform locks packages that the PHP of the repository does not run.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PLATFORM = `${readFileSync(path.join(ROOT, '.php-version'), 'utf8').trim().split('.').slice(0, 2).join('.')}.1`;

for (const project of ['config/php-lint', 'config/phpunit', 'scripts/kit/symbols/php']) {
  test(`${project} resolves for PHP ${PLATFORM}, in its composer.json and in its lock (K322)`, () => {
    const manifest = JSON.parse(readFileSync(path.join(ROOT, project, 'composer.json'), 'utf8')) as { config?: { platform?: { php?: string } } };
    const lock = JSON.parse(readFileSync(path.join(ROOT, project, 'composer.lock'), 'utf8')) as { 'platform-overrides'?: { php?: string } };
    assert.equal(manifest.config?.platform?.php, PLATFORM, `${project}/composer.json`);
    assert.equal(lock['platform-overrides']?.php, PLATFORM, `${project}/composer.lock`);
  });
}
