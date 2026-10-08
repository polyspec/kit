// Helpers of the dependency tests: a copy of tests/kit/fixture with the tools, as a Git repository of a temporary
// directory, so that each tool reads its own checkout, and the commands that run the gate and the review in it.
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const FIXTURE = path.join(HERE, 'fixture');

/** A copy of the fixture with scripts/kit, removed with `t.after`. */
export function fixtureCheckout(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'kit-dependency-checkout-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  cpSync(FIXTURE, directory, { recursive: true });
  cpSync(path.join(ROOT, 'scripts/kit'), path.join(directory, 'scripts/kit'), { recursive: true });
  // The tools list the files of a checkout through Git, so the copy is a repository.
  spawnSync('git', ['init', '--quiet'], { cwd: directory });
  return directory;
}

export const gate = (root, env = process.env) => spawnSync(process.execPath, ['scripts/kit/check-dependency-policy.mjs'], { cwd: root, encoding: 'utf8', env });
export const review = (root, args, env) => spawnSync(process.execPath, ['scripts/kit/dependency-review.mjs', ...args], { cwd: root, encoding: 'utf8', env });
