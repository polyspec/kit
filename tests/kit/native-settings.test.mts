// Tests of the clippy settings that kit offers as examples (K1191, docs/examples/native-settings.md): clippy.toml disallows the
// Option and Result methods that turn a failure or an absence into a value, and the [workspace.lints] example of the page denies
// the lints that hide an error or a lossy cast. A repository copies them and owns its copies; kit writes no file of a repository.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { isTable, readToml } from '../../scripts/kit/toml.mts';

const ROOT = path.join(import.meta.dirname, '..', '..');
const read = (file: string) => readFileSync(path.join(ROOT, file), 'utf8');

test('K1191: clippy.toml disallows the Option and Result methods that turn a failure or an absence into a value, each with its reason', () => {
  const config = readToml(read('clippy.toml'), 'clippy.toml');
  const methods = Array.isArray(config['disallowed-methods']) ? config['disallowed-methods'] : [];
  const entries = methods.filter(isTable).map(entry => ({ path: entry.path, reason: entry.reason }));
  const paths = entries.map(entry => entry.path);
  const expected = [
    ...['ok', 'unwrap_or', 'unwrap_or_default', 'unwrap_or_else', 'map_or', 'map_or_else'].map(name => `core::result::Result::${name}`),
    ...['unwrap_or', 'unwrap_or_default', 'unwrap_or_else', 'map_or', 'map_or_else'].map(name => `core::option::Option::${name}`),
  ];
  for (const name of expected) assert.ok(paths.includes(name), `clippy.toml disallows ${name}`);
  assert.equal(new Set(paths).size, paths.length, 'each method is listed once');
  for (const entry of entries) assert.ok(typeof entry.reason === 'string' && entry.reason.startsWith('P8: '), `${String(entry.path)} names its reason`);
});

test('K1191: the [workspace.lints] example denies warnings, the lints that hide an error, unwrap, expect and the lossy casts', () => {
  const page = read('docs/examples/native-settings.md');
  const fence = /```toml\n(\[workspace\.lints\.rust\][\s\S]*?)```/.exec(page)?.[1];
  assert.ok(fence !== undefined, 'the page holds the [workspace.lints] example');
  const lints = readToml(fence, 'docs/examples/native-settings.md');
  const workspace = isTable(lints.workspace) && isTable(lints.workspace.lints) ? lints.workspace.lints : {};
  const rust = isTable(workspace.rust) ? workspace.rust : {};
  const clippy = isTable(workspace.clippy) ? workspace.clippy : {};
  assert.equal(rust.warnings, 'deny');
  for (const lint of ['allow_attributes_without_reason', 'unwrap_used', 'expect_used', 'let_underscore_must_use', 'let_underscore_untyped', 'cast_possible_truncation', 'cast_possible_wrap', 'cast_sign_loss', 'map_err_ignore']) {
    assert.equal(clippy[lint], 'deny', `[workspace.lints.clippy] denies ${lint}`);
  }
  // The Korean twin shows the same example.
  assert.ok(read('docs/examples/native-settings.ko.md').includes(fence), 'native-settings.ko.md holds the same example');
});
