// The lints refuse a catch without a statement (K537): lint-ts and lint-rust each hold a catch-check step, since oxlint
// no-empty and clippy pass a catch, or an Err(..) arm, that holds only a comment.
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { lintSteps as rustSteps } from '../../scripts/kit/lint-rust.mts';
import { lintSteps as tsSteps } from '../../scripts/kit/lint-ts.mts';
import { tree } from './tree.mts';

test('lint-rust runs the Rust catch check over the Rust files of the checkout (K537)', (t) => {
  const root = tree(t, { 'Cargo.toml': '[workspace]\nmembers = []\n', 'src/lib.rs': '//! A crate.\n' });
  const step = rustSteps(root).find(candidate => candidate.label === 'catch-check rust');
  assert.ok(step, 'lint-rust has no catch-check step');
  assert.ok(step.args.includes('src/lib.rs'), JSON.stringify(step.args));
});

test('lint-ts runs the TypeScript catch check (K537)', (t) => {
  const kit = { name: '@polyspec/kit', version: '1.2.3' };
  const root = tree(t, {
    'package.json': JSON.stringify({ name: 'consumer', devDependencies: { '@polyspec/kit': kit.version } }),
    'package-lock.json': JSON.stringify({ lockfileVersion: 3, packages: { 'node_modules/@polyspec/kit': { version: kit.version } } }),
    'src/index.ts': 'export const a = 1;\n',
  });
  mkdirSync(path.join(root, 'node_modules/@polyspec/kit'), { recursive: true });
  writeFileSync(path.join(root, 'node_modules/@polyspec/kit/package.json'), JSON.stringify(kit));
  mkdirSync(path.join(root, 'node_modules/.bin'), { recursive: true });
  for (const tool of ['oxlint', 'knip', 'api-extractor']) {
    // The knip stub answers the reporter of the first run of lint-ts with no hint.
    writeFileSync(path.join(root, 'node_modules/.bin', tool), tool === 'knip' ? '#!/bin/sh\ncase "$*" in *--reporter*) echo \'[]\';; esac\n' : '#!/bin/sh\n');
    chmodSync(path.join(root, 'node_modules/.bin', tool), 0o755);
  }
  assert.ok(tsSteps(root).some(step => step.label === 'catch-check'), 'lint-ts has no catch-check step');
});
