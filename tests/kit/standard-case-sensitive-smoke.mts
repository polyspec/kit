import assert from 'node:assert/strict';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

test('the standard Node runner receives a verified case-sensitive directory', () => {
  const directory = process.env.KIT_CASE_SENSITIVE_SMOKE_DIR;
  assert.ok(directory, 'the standard target must provision KIT_CASE_SENSITIVE_SMOKE_DIR');
  assert.ok(path.isAbsolute(directory));
  const upper = path.join(directory, 'KitRunnerSmoke');
  const lower = path.join(directory, 'kitrunnersmoke');
  try {
    writeFileSync(upper, 'upper');
    writeFileSync(lower, 'lower');
    assert.equal(readFileSync(upper, 'utf8'), 'upper');
    assert.equal(readFileSync(lower, 'utf8'), 'lower');
  } finally {
    rmSync(upper, { force: true });
    rmSync(lower, { force: true });
  }
});
