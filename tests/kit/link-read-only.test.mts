// K960: link writes no Claude Code configuration. A checkout that link --project names may be mounted read-only, as in a
// container, so the link writes nothing into it and still completes, and link-check --project expects no hook there.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { initRepository } from './sandbox-repository.mts';

const KIT = fileURLToPath(new URL('../../', import.meta.url));

/** A git consumer checkout with a package.json and no link declaration, made read-only; removed when the test ends. */
function readOnlyConsumer(t: TestContext): string {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-link-read-only-')));
  const directory = path.join(root, 'cons');
  initRepository(directory);
  writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name: 'consumer', private: true }));
  chmodSync(directory, 0o555);
  t.after(() => {
    chmodSync(directory, 0o755);
    rmSync(root, { recursive: true, force: true });
  });
  return directory;
}

test('link --project completes on a read-only checkout and writes no Claude Code settings into it (K960)', (t) => {
  const project = readOnlyConsumer(t);
  const result = spawnSync(process.execPath, [path.join(KIT, 'scripts/kit/link.mts'), 'link', '--project', project], { encoding: 'utf8' });
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  assert.equal(existsSync(path.join(project, '.claude')), false);
});

test('link-check --project expects no Claude Code settings in the checkout (K960)', (t) => {
  const project = readOnlyConsumer(t);
  const result = spawnSync(process.execPath, [path.join(KIT, 'scripts/kit/link-check.mts'), '--project', project], { encoding: 'utf8' });
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /settings\.local\.json/);
});
