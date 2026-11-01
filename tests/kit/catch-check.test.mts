// The catch check (K537): a catch clause or a .catch callback, that holds no
// statement is a finding; one that holds a statement is not.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { initRepository } from './sandbox-repository.mts';
import { catchFindings, emptyCatches } from '../../scripts/kit/catch-check.mts';
import { kitPackageRoot } from '../../scripts/kit/kit-files.mts';

test('a TypeScript catch or .catch callback without a statement is a finding (K537)', () => {
  const text = [
    'try { f(); } catch {',
    '  // ignored',
    '}',
    'try { f(); } catch (error) { if (!(error instanceof RangeError)) throw error; }',
    'p.catch(() => {',
    '  // ignored',
    '});',
    'p.catch((error: unknown) => { throw error; });',
    'const x: number = 1;',
  ].join('\n');
  assert.deepEqual(emptyCatches('a.ts', text), [1, 5]);
});

// K620: an Err arm with a guard, or whose inner pattern names an error variant, handles one named error and leaves every other
// error to a later arm, so it swallows nothing; only an empty arm of every error (a binding or `_`) is a finding.
// K561: a catch without a binding cannot inspect what it caught, so it accepts every failure as the outcome it names; it is a finding
// unless the line before it states the reason with `// catch-any -- <reason>`. A catch that binds its error can narrow it and passes.
test('a catch without a binding is a finding unless its reason is stated (K561)', (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'kit-catch-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  initRepository(root);
  writeFileSync(path.join(root, 'a.mts'), [
    'export const missing = () => { try { return f(); } catch { return undefined; } };',
    'export const narrowed = () => { try { return f(); } catch (error) { if (!(error instanceof RangeError)) throw error; return 0; } };',
    '// catch-any -- every failure of the probe means that the feature is absent',
    'export const probe = () => { try { return f(); } catch { return false; } };',
    'declare function f(): number;',
    '',
  ].join('\n'));
  assert.equal(spawnSync('git', ['add', '-A'], { cwd: root }).status, 0);
  assert.deepEqual(catchFindings(root), ['a.mts:1: a catch has no binding, so it cannot inspect what it caught and accepts every failure; bind the error and narrow it, or state the reason on the line before with // catch-any -- <reason> (K561)']);
});

// K559: the catches of kit inspect what they caught, narrowing to the class or errno that means their outcome (the audit of
// 2026-10-23), so catch-check finds none in the checkout of kit.
test('the sources of kit hold no catch that catch-check refuses (K559)', () => {
  assert.deepEqual(catchFindings(kitPackageRoot()), []);
});
