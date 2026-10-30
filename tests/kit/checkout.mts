// Helpers of the tests: a copy of tests/kit/fixture as a Git repository of a temporary directory, in which
// the tools of kit run (kit-tools.mts) and read that checkout.
import type { TestContext } from 'node:test';
import { cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { removeSandbox } from './sandbox-cleanup.mts';
import { initRepository } from './sandbox-repository.mts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(HERE, 'fixture');

// K491: the copy of the fixture has no mise.lock of the checkout, so MISE_LOCKED of make refuses its tools (ruff, python); the variable
// leaves the environment of the tests. The mise settings of the checkout stay, since its own composer shim needs them.
delete process.env.MISE_LOCKED;

/** A copy of the fixture, removed with `t.after`. */
export function fixtureCheckout(t: Pick<TestContext, 'after'>) {
  const directory = mkdtempSync(path.join(tmpdir(), 'kit-dependency-checkout-'));
  t.after(() => removeSandbox(directory));
  cpSync(FIXTURE, directory, { recursive: true });
  // The tools list the files of a checkout through Git, so the copy is a repository.
  initRepository(directory);
  return directory;
}
