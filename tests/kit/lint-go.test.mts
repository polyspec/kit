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
import { kitFile, kitPackageRoot } from '../../scripts/kit/kit-files.mts';
import { initRepository } from './sandbox-repository.mts';

const FILES: Record<string, string> = {
  'go.work': 'go 1.27.2\n',
  'packages/go/go.mod': 'module example.com/demo\n',
  'packages/codec/go/go.mod': 'module example.com/codec\n',
  'tests/kit/fixture/packages/fixture-go/go.mod': 'module example.com/fixture\n',
};

// Each tool is a stub that logs its call; `stub` is "<tool> <shell line>", which that tool runs after it logs, and `stubs` gives such a
// shell line by tool.
function checkout(t: TestContext, { installed = ['golangci-lint', 'deadcode', 'go'], omit = '', stub = '', stubs = {}, extra = {} }: { installed?: string[]; omit?: string; stub?: string; stubs?: Record<string, string>; extra?: Record<string, string> } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'kit-lint-go-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [file, text] of Object.entries({ ...FILES, ...extra })) {
    if (file === omit) continue;
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  }
  writeFileSync(path.join(root, '.gitignore'), 'var/\n*.log\n');
  const log = path.join(root, 'calls.log');
  mkdirSync(path.join(root, 'var/tools/mise/shims'), { recursive: true });
  for (const tool of installed) {
    writeFileSync(path.join(root, 'var/tools/mise/shims', tool), `#!/bin/sh\necho "${tool} $* [$(basename "$(dirname "$PWD")")]" >> "${log}"\n${stubs[tool] ?? (stub.startsWith(`${tool} `) ? stub.slice(tool.length) : '')}\n`);
    chmodSync(path.join(root, 'var/tools/mise/shims', tool), 0o755);
  }
  initRepository(root);
  // The go list of each deadcode run names its files to the judgment of K536, which its own test reads; the calls are the lints.
  const calls = () => readFileSync(log, 'utf8').split('\n').filter(line => line !== '' && !line.startsWith('go list')).map(line => line.replaceAll(`${root}/`, ''));
  return { root, calls };
}

test('golangci-lint and deadcode -test run in each Go module folder, and not in the kit fixture', (t) => {
  const { root, calls } = checkout(t);
  assert.deepEqual(lint(root, () => {}), []);
  assert.deepEqual(calls(), [
    `golangci-lint run --config=${kitFile('.golangci.yml')} ./... [codec]`,
    'deadcode -test ./... [codec]',
    `golangci-lint run --config=${kitFile('.golangci.yml')} ./... [packages]`,
    'deadcode -test ./... [packages]',
  ]);
});

test('lint-go lints the files behind each build tag that the module declares (K406)', (t) => {
  const { root, calls } = checkout(t, {
    extra: {
      'packages/go/extra.go': '//go:build extra\n\npackage demo\n',
      'packages/go/linux.go': '//go:build linux && !cgo\n\npackage demo\n',
    },
  });
  assert.deepEqual(lint(root, () => {}), []);
  assert.deepEqual(calls(), [
    `golangci-lint run --config=${kitFile('.golangci.yml')} ./... [codec]`,
    'deadcode -test ./... [codec]',
    `golangci-lint run --config=${kitFile('.golangci.yml')} ./... [packages]`,
    `golangci-lint run --config=${kitFile('.golangci.yml')} --build-tags=extra ./... [packages]`,
    'deadcode -test ./... [packages]',
    'deadcode -test -tags=extra ./... [packages]',
  ]);
});

test('a deadcode finding fails its step although deadcode exits 0, and every step runs after it', (t) => {
  const { root, calls } = checkout(t, { stub: 'deadcode if test "$(basename "$(dirname "$PWD")")" = codec; then echo "codec.go:3:6: unreachable func: Triple"; fi' });
  assert.deepEqual(lint(root, () => {}), ['deadcode packages/codec/go']);
  assert.equal(calls().length, 4);
  const failing = checkout(t, { stub: 'golangci-lint exit 1' });
  assert.deepEqual(lint(failing.root, () => {}), ['golangci-lint packages/codec/go', 'golangci-lint packages/go']);
});

test('a missing tool fails with its fix', (t) => {
  assert.throws(() => lintSteps(checkout(t, { installed: ['golangci-lint'] }).root), /var\/tools\/mise\/shims\/deadcode is missing; declare go, golangci-lint and go:golang\.org\/x\/tools\/cmd\/deadcode in mise\.toml and run make install-tools/);
});

// K514: golangci-lint reads the .golangci.yml of the kit package that runs, never a copy of the repository.
test('golangci-lint reads the .golangci.yml of the kit package, and a checkout without one lints (K514)', (t) => {
  const steps = lintSteps(checkout(t).root).filter(step => step.label.startsWith('golangci-lint'));
  assert.ok(steps.length > 0);
  for (const step of steps) assert.ok(step.args.includes(`--config=${kitFile('.golangci.yml')}`), step.args.join(' '));
  assert.equal(kitPackageRoot(), path.dirname(kitFile('.golangci.yml')));
});

// K536: deadcode runs untagged and once per build tag of the module, and go list names the files of each run; a function is unreachable
// when every run that compiles its file reports it, so a function that the run of one tag reaches is live.
test('lint-go judges deadcode over the union of the build tags of a module (K536)', (t) => {
  const inPackages = 'test "$(basename "$(dirname "$PWD")")" = packages';
  const { root } = checkout(t, {
    installed: ['golangci-lint', 'deadcode', 'go'],
    extra: { 'packages/go/demo.go': 'package demo\n', 'packages/go/extra.go': '//go:build extra\n\npackage demo\n' },
    stubs: {
      deadcode: `if ${inPackages}; then case "$*" in *-tags=extra*) printf 'demo.go:9:6: unreachable func: Dead\\nextra.go:5:6: unreachable func: Lonely\\n' ;; *) printf 'demo.go:3:6: unreachable func: Live\\ndemo.go:9:6: unreachable func: Dead\\n' ;; esac; fi`,
      go: `if ${inPackages}; then case "$*" in *-tags=extra*) printf '%s\\tdemo.go\\textra.go\\n' "$PWD" ;; *) printf '%s\\tdemo.go\\n' "$PWD" ;; esac; fi`,
    },
  });
  const printed: string[] = [];
  assert.deepEqual(lint(root, text => printed.push(text)).filter(label => label.startsWith('deadcode')), ['deadcode packages/go']);
  const output = printed.join('');
  assert.match(output, /demo\.go:9:6: unreachable func: Dead/, 'a function that every run reports is unreachable');
  assert.match(output, /extra\.go:5:6: unreachable func: Lonely/, 'a function behind a tag that its run does not reach is unreachable');
  assert.doesNotMatch(output, /Live/, 'a function that the run of a tag reaches is live');
});

// K866: go.mod is the go tool's: a replace and a toolchain line are its directives, so the kit configuration bans neither.
test('the kit golangci-lint configuration does not ban the go.mod directives replace and toolchain (K866)', () => {
  assert.doesNotMatch(readFileSync(kitFile('.golangci.yml'), 'utf8'), /gomoddirectives|replace-local|toolchain-forbidden/);
});
