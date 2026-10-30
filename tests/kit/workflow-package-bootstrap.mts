// Executes the workflow's package-first bootstrap with a recording npm, without downloads or package installation.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { TestContext } from 'node:test';

/** Verifies consumer package bootstrap, exact npm selection and the kit source-checkout exception. */
export function assertWorkflowPackageBootstrap(workflow: string, t: TestContext): void {
  const match = /^      - name: bootstrap the installed kit package\n        run: \|\n((?:          .*\n)+)/m.exec(workflow);
  assert.ok(match, 'the workflow installs the package before Make reads its bootstrap');
  const position = workflow.indexOf(match[0]);
  assert.ok(position < workflow.search(/^        run: make /m), 'package bootstrap precedes the first Make invocation');
  assert.doesNotMatch(workflow, /git clone|make -C \.\.\/kit|kit_tag|sibling checkouts/);
  const script = (match[1] ?? '').split('\n').map(line => line.replace(/^          /, '')).join('\n');
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-workflow-bootstrap-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = path.join(root, 'bin');
  mkdirSync(bin);
  writeFileSync(path.join(bin, 'node'), `#!/bin/sh\nexec '${process.execPath}' "$@"\n`, { mode: 0o755 });
  writeFileSync(path.join(bin, 'npm'), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$BOOTSTRAP_LOG"\nprintf "%s" "$npm_config_cache" > "$BOOTSTRAP_CACHE_LOG"\n', { mode: 0o755 });
  for (const name of ['@example/consumer', '@polyspec/kit']) {
    const folder = path.join(root, name.endsWith('/kit') ? 'kit' : 'consumer');
    mkdirSync(folder);
    const log = path.join(folder, 'npm.log');
    const cache = path.join(folder, 'cache.log');
    writeFileSync(path.join(folder, 'package.json'), JSON.stringify({ name, devEngines: { packageManager: { name: 'npm', version: '11.14.0' } } }));
    const result = spawnSync('bash', ['-eu', '-c', script], { cwd: folder, env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`, BOOTSTRAP_LOG: log, BOOTSTRAP_CACHE_LOG: cache }, encoding: 'utf8' });
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    if (name === '@polyspec/kit') assert.equal(existsSync(log), false, 'kit uses its source Makefile without installing its own published package');
    else {
      assert.equal(readFileSync(log, 'utf8'), 'exec --yes --package=npm@11.14.0 -- npm ci --ignore-scripts --allow-remote=root\n');
      assert.equal(readFileSync(cache, 'utf8'), path.join(folder, 'var/bootstrap/npm-cache'));
    }
  }
}
