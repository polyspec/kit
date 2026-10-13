// The packages that the Go advisory query names (K53), with the real go of mise.toml: a checkout whose var/ holds a Go
// tree as mise installs it, a nested module, a build-constrained directory and the directories that `./...` skips. `go list ./...`
// names the toolchain package, which is why the query names packages instead; goPackages keeps the buildable packages of
// the module and the real go accepts them. Nothing is stubbed and no test reaches a network; a missing go fails the case.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { goPackages } from '../../scripts/kit/dependency-review.mts';
import { initRepository } from '../kit/sandbox-repository.mts';
import { sandboxShims } from './real-tools.mts';

test('the advisory query names the buildable packages of the module, and the real go accepts them (K53)', (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'kit-govulncheck-packages-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const files = {
    'go.mod': 'module example.com/kit-real\n\ngo 1.21\n',
    'main.go': 'package main\n\nfunc main() {}\n',
    'x/x.go': 'package x\n',
    'gen/gen.go': '//go:build ignore\n\npackage main\n\nfunc main() {}\n',
    'nested/go.mod': 'module example.com/kit-real/nested\n\ngo 1.21\n',
    'nested/n.go': 'package nested\n',
    '.hidden/h.go': 'package hidden\n',
    'testdata/t.go': 'package testdata\n',
    // The source tree of a Go release has no go.mod, so `./...` of the module walks into it.
    'var/tools/mise/installs/go/1.27.2/src/archive/tar/tar.go': 'package tar\n',
  };
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  }
  initRepository(root);
  // The go of PATH, as dependency-review runs it in a checkout whose shims come first on PATH: here the shim of the checkout
  // is a script that runs the go of mise.toml of this checkout.
  sandboxShims(root, ['go']);
  const saved = process.env.PATH;
  process.env.PATH = `${path.join(root, 'var/tools/mise/shims')}${path.delimiter}${saved}`;
  t.after(() => { process.env.PATH = saved; });
  assert.equal(spawnSync('go', ['version'], { encoding: 'utf8' }).status, 0, 'go is not on PATH');

  const { list, error } = goPackages(root, 'go.sum');
  if (error !== undefined) assert.fail(error);
  assert.deepEqual(list, ['example.com/kit-real', 'example.com/kit-real/x']);
  // The real go loads every named package without the -e of the query, so govulncheck receives no failing pattern.
  const loaded = spawnSync('go', ['list', ...list], { cwd: root, encoding: 'utf8' });
  assert.equal(loaded.status, 0, loaded.stderr);
});
