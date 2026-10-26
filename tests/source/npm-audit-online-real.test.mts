// Native audit transport evidence on a tiny locked graph; no package install or registry download is needed.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createServer } from 'node:net';
import { isJsonObject } from '../../scripts/kit/bootstrap/files.mts';
import { toolCommand } from '../../scripts/kit/mise-tools.mts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

test('K684 native npm audit distinguishes inherited offline success from failed online transport', { timeout: 30000 }, async t => {
  const root = mkdtempSync(path.join(tmpdir(), 'kit-audit-online-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const manifest = { name: 'native-audit-proof', version: '0.0.0', dependencies: { 'is-number': '7.0.0' } };
  writeFileSync(path.join(root, 'package.json'), JSON.stringify(manifest));
  writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({ name: manifest.name, version: manifest.version, lockfileVersion: 3, packages: { '': manifest, 'node_modules/is-number': { version: '7.0.0', resolved: 'https://registry.npmjs.org/is-number/-/is-number-7.0.0.tgz' } } }));
  const before = readFileSync(path.join(root, 'package-lock.json'), 'utf8');
  const server = createServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  const env = { ...process.env, npm_config_offline: 'true', npm_config_registry: `http://127.0.0.1:${address.port}`, npm_config_fetch_retries: '0', npm_config_cache: path.join(root, 'cache'), npm_config_userconfig: path.join(root, 'npmrc'), npm_config_globalconfig: path.join(root, 'global-npmrc') };
  const npm = toolCommand(ROOT, 'npm');
  for (const [online, options] of [[false, []], [true, ['--offline=false']]] as const) {
    const result = spawnSync(npm, ['audit', '--json', '--package-lock-only', ...options], { cwd: root, env, encoding: 'utf8' });
    const report: unknown = JSON.parse(result.stdout);
    assert.ok(isJsonObject(report));
    if (online) {
      assert.notEqual(result.status, 0, result.stderr);
      assert.ok(isJsonObject(report.error), result.stdout);
    } else {
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(report.vulnerabilities, {});
    }
  }
  assert.equal(readFileSync(path.join(root, 'package-lock.json'), 'utf8'), before);
});
