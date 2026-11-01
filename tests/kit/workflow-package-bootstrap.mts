// Executes the workflow's package-first bootstrap with a recording npm, without downloads or package installation.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { TestContext } from 'node:test';

/** The composite action of kit that every CI job runs for its bootstrap (K992), and the step of a workflow that runs it. */
export const BOOTSTRAP_ACTION = 'actions/kit-bootstrap/action.yml';
export const BOOTSTRAP_USES = /^\s+- uses: \.\/\.github\/actions\/kit-bootstrap$/m;

/** The `make` commands of the bootstrap action, in its order. */
export function bootstrapActionCommands(action = readFileSync(path.join(import.meta.dirname, '../..', BOOTSTRAP_ACTION), 'utf8')): string[] {
  return [...action.matchAll(/^\s+run: (make .+)$/gm)].map(match => match[1] ?? '');
}

/**
 * Verifies that `workflow` runs the bootstrap action before its first Make invocation (K992), and that the action holds the
 * consumer package bootstrap, exact npm selection and the kit source-checkout exception before its own Make invocations.
 */
export function assertWorkflowPackageBootstrap(workflow: string, t: TestContext): void {
  const uses = workflow.search(BOOTSTRAP_USES);
  assert.ok(uses >= 0, 'the workflow runs the bootstrap action of kit');
  const make = workflow.search(/^\s+run: make /m);
  assert.ok(make < 0 || uses < make, 'the bootstrap action precedes the first Make invocation');
  assert.doesNotMatch(workflow, /git clone|make -C \.\.\/kit|kit_tag|sibling checkouts|npm --prefix/);
  const action = readFileSync(path.join(import.meta.dirname, '../..', BOOTSTRAP_ACTION), 'utf8');
  const match = /^    - name: bootstrap the installed kit package\n      shell: bash\n      run: \|\n((?:        .*\n)+)/m.exec(action);
  assert.ok(match, 'the action installs the package before Make reads its bootstrap');
  assert.ok(action.indexOf(match[0]) < action.search(/^      run: make /m), 'package bootstrap precedes the first Make invocation of the action');
  const script = (match[1] ?? '').split('\n').map(line => line.replace(/^        /, '')).join('\n');
  // K938-1: the outer npm runs in RUNNER_TEMP, and an unset RUNNER_TEMP stops the step instead of running in the checkout.
  assert.match(script, /cd "\$\{RUNNER_TEMP:\?RUNNER_TEMP is not set\}" &&/, 'the bootstrap step runs npm in RUNNER_TEMP, and fails when it is not set');
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-workflow-bootstrap-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = path.join(root, 'bin');
  mkdirSync(bin);
  writeFileSync(path.join(bin, 'node'), `#!/bin/sh\nexec '${process.execPath}' "$@"\n`, { mode: 0o755 });
  // K938-1: the npm of the runner refuses to run in a folder whose devEngines names another npm (EBADDEVENGINES), as npm 11 does.
  writeFileSync(path.join(bin, 'npm'), '#!/bin/sh\nif [ -f "$PWD/package.json" ] && grep -q devEngines "$PWD/package.json"; then echo "EBADDEVENGINES" >&2; exit 1; fi\nprintf "%s\\n" "$*" >> "$BOOTSTRAP_LOG"\nprintf "%s" "$npm_config_cache" > "$BOOTSTRAP_CACHE_LOG"\n', { mode: 0o755 });
  mkdirSync(path.join(root, 'runner-temp'));
  for (const name of ['@example/consumer', '@polyspec/kit']) {
    const folder = path.join(root, name.endsWith('/kit') ? 'kit' : 'consumer');
    mkdirSync(folder);
    const log = path.join(folder, 'npm.log');
    const cache = path.join(folder, 'cache.log');
    writeFileSync(path.join(folder, 'package.json'), JSON.stringify({ name, devEngines: { packageManager: { name: 'npm', version: '11.14.0' } } }));
    const result = spawnSync('bash', ['-eu', '-c', script], { cwd: folder, env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`, RUNNER_TEMP: path.join(root, 'runner-temp'), BOOTSTRAP_LOG: log, BOOTSTRAP_CACHE_LOG: cache }, encoding: 'utf8' });
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    if (name === '@polyspec/kit') assert.equal(existsSync(log), false, 'kit uses its source Makefile without installing its own published package');
    else {
      assert.equal(readFileSync(log, 'utf8'), `exec --yes --package=npm@11.14.0 -- npm --prefix ${folder} ci --ignore-scripts --allow-remote=root\n`);
      assert.equal(readFileSync(cache, 'utf8'), path.join(folder, 'var/bootstrap/npm-cache'));
    }
  }
}
