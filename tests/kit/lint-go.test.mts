// Tests of the Go lint: golangci-lint with the root .golangci.yml and deadcode -test run in the folder of each Go module; a
// deadcode finding fails the step although deadcode exits 0, every step runs after an earlier one failed, and a missing tool
// or configuration fails with the fix. golangci-lint and deadcode are stubs.
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { lint, lintSteps } from '../../scripts/kit/lint-go.mts';
import { initRepository } from './sandbox-repository.mts';

const FILES: Record<string, string> = {
  '.golangci.yml': 'version: "2"\n',
  'go.work': 'go 1.27.2\n',
  'packages/go/go.mod': 'module example.com/demo\n',
  'packages/codec/go/go.mod': 'module example.com/codec\n',
  'tests/kit/fixture/packages/fixture-go/go.mod': 'module example.com/fixture\n',
};

// Each tool is a stub that logs its call; `stub` is "<tool> <shell line>", which that tool runs after it logs.
function checkout(t: TestContext, { installed = ['golangci-lint', 'deadcode'], omit = '', stub = '' }: { installed?: string[]; omit?: string; stub?: string } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'kit-lint-go-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [file, text] of Object.entries(FILES)) {
    if (file === omit) continue;
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  }
  writeFileSync(path.join(root, '.gitignore'), 'var/\n*.log\n');
  const log = path.join(root, 'calls.log');
  mkdirSync(path.join(root, 'var/tools/bin'), { recursive: true });
  for (const tool of installed) {
    writeFileSync(path.join(root, 'var/tools/bin', tool), `#!/bin/sh\necho "${tool} $* [$(basename "$(dirname "$PWD")")]" >> "${log}"\n${stub.startsWith(tool) ? stub.slice(tool.length) : ''}\n`);
    chmodSync(path.join(root, 'var/tools/bin', tool), 0o755);
  }
  initRepository(root);
  return { root, calls: () => readFileSync(log, 'utf8').split('\n').filter(Boolean).map(line => line.replaceAll(`${root}/`, '')) };
}

test('golangci-lint and deadcode -test run in each Go module folder, and not in the kit fixture', (t) => {
  const { root, calls } = checkout(t);
  assert.deepEqual(lint(root, () => {}), []);
  assert.deepEqual(calls(), [
    'golangci-lint run --config=.golangci.yml ./... [codec]',
    'deadcode -test ./... [codec]',
    'golangci-lint run --config=.golangci.yml ./... [packages]',
    'deadcode -test ./... [packages]',
  ]);
});

test('a deadcode finding fails its step although deadcode exits 0, and every step runs after it', (t) => {
  const { root, calls } = checkout(t, { stub: 'deadcode if test "$(basename "$(dirname "$PWD")")" = codec; then echo "codec.go:3:6: unreachable func: Triple"; fi' });
  assert.deepEqual(lint(root, () => {}), ['deadcode packages/codec/go']);
  assert.equal(calls().length, 4);
  const failing = checkout(t, { stub: 'golangci-lint exit 1' });
  assert.deepEqual(lint(failing.root, () => {}), ['golangci-lint packages/codec/go', 'golangci-lint packages/go']);
});

test('a missing tool or .golangci.yml fails with its fix', (t) => {
  assert.throws(() => lintSteps(checkout(t, { installed: ['golangci-lint'] }).root), /var\/tools\/bin\/deadcode is missing; run make install-tools/);
  assert.throws(() => lintSteps(checkout(t, { omit: '.golangci.yml' }).root), /\.golangci\.yml is missing; it is the golangci-lint configuration that kit copies into every repository \(make kit-sync\)/);
});
