// Tests of scripts/kit/bootstrap/verify-idempotent.mts (K852, P17): a second install leaves the same result, so the snapshot judges
// the content of each installed file, not its timestamp or inode. CI runs the real second bootstrap
// (the job bootstrap of .github/workflows/ci.yml); these tests run offline on a fixture.
import assert from 'node:assert/strict';
import { mkdtempSync, renameSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { changedFiles, snapshotFiles } from '../../scripts/kit/bootstrap/verify-idempotent.mts';

function fixture(t: { after: (fn: () => void) => void }) {
  const root = mkdtempSync(path.join(tmpdir(), 'kit-install-idempotent-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(path.join(root, 'npm-cli.js'), 'npm command\n');
  return { root, files: { 'npm command': path.join(root, 'npm-cli.js') } };
}

test('a second install that writes a file again with the same bytes, a new inode and a new time, changes nothing (K852)', (t) => {
  const { root, files } = fixture(t);
  const before = snapshotFiles(files);
  // An archive extracted again: the same bytes through a new file and a rename, a later time.
  writeFileSync(path.join(root, 'npm-cli.js.next'), 'npm command\n');
  renameSync(path.join(root, 'npm-cli.js.next'), path.join(root, 'npm-cli.js'));
  utimesSync(path.join(root, 'npm-cli.js'), new Date(Date.now() + 60_000), new Date(Date.now() + 60_000));
  assert.deepEqual(changedFiles(before, snapshotFiles(files)), []);
});

test('a second install that changes the bytes of an installed file is a change (K852)', (t) => {
  const { root, files } = fixture(t);
  const before = snapshotFiles(files);
  writeFileSync(path.join(root, 'npm-cli.js'), 'another npm command\n');
  assert.deepEqual(changedFiles(before, snapshotFiles(files)), ['npm command']);
});
