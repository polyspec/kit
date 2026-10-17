// The trust of a worktree's mise.toml with the real mise of this checkout (K208): the python shim of var/tools/mise/shims refuses
// a mise.toml that is untrusted, a worktree's mise.toml is untrusted until `mise trust` records it in the state dir of the
// checkout, and no environment variable trusts it. The shim runs the extractor of python.py, the Python of mise.toml, with
// nothing stubbed; make install-tools installs the mise and the python that this test runs.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { miseEnvironment, trustConfig } from '../../scripts/kit/bootstrap/install-mise.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MISE = path.join(ROOT, 'var/tools/mise-release/mise/bin/mise');
const DATA = path.join(ROOT, 'var/tools/mise');
const SHIM = path.join(DATA, 'shims/python3');
const EXTRACTOR = path.join(ROOT, 'scripts/kit/symbols/python.py');

test('the python shim of the checkout runs a worktree mise.toml only after `mise trust` records it, with no trust variable (K208)', { timeout: 120_000 }, (t) => {
  const worktree = mkdtempSync(path.join(tmpdir(), 'kit-k208-'));
  t.after(() => rmSync(worktree, { recursive: true, force: true }));
  writeFileSync(path.join(worktree, 'mise.toml'), '[env]\nK208_PROBE = "yes"\n\n[tools]\npython = "3.14.8"\n');
  copyFileSync(path.join(ROOT, 'mise.lock'), path.join(worktree, 'mise.lock'));
  mkdirSync(path.join(worktree, 'pkg'));
  writeFileSync(path.join(worktree, 'pkg/__init__.py'), 'def run():\n    pass\n');
  const environment = miseEnvironment(worktree);
  assert.equal(environment.MISE_TRUSTED_CONFIG_PATHS, undefined, 'the environment of mise trusts no path by variable');
  // The installs are those of the checkout; the state dir, where trust is recorded, is the worktree's own.
  const env: NodeJS.ProcessEnv = { ...process.env, ...environment, MISE_DATA_DIR: DATA };
  delete env.MISE_TRUSTED_CONFIG_PATHS;
  // The worktree's mise.toml is a project config, not the global one, as in a run of the extractor outside make.
  delete env.MISE_GLOBAL_CONFIG_FILE;
  const extract = () => spawnSync(SHIM, ['-I', EXTRACTOR, path.join(worktree, 'pkg')], { cwd: worktree, env, encoding: 'utf8' });
  const refused = extract();
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /not trusted/);
  trustConfig({ root: worktree, binary: MISE });
  const ran = extract();
  assert.equal(ran.status, 0, ran.stderr);
  assert.match(ran.stdout, /pkg\.run/);
});
