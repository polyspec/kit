// A repository whose root is a Go module holds the tools of mise under var/tools, the Go distribution among them with its test
// sources; the go.mod that the bootstrap writes into var/tools makes them a module of their own, so ./... of the repository
// does not walk them (K135). Runs the pinned go of this checkout.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { TOOLS_GO_MOD } from '../../scripts/kit/bootstrap/install-mise.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const go = spawnSync(path.join(ROOT, 'var/tools/bin/mise'), ['which', 'go'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim();

function repository(t: Pick<test.TestContext, 'after'>, withGoMod: boolean) {
  const root = mkdtempSync(path.join(tmpdir(), 'kit-tools-go-mod-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (file: string, text: string) => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  };
  put('go.mod', 'module example.com/repository\n\ngo 1.27.2\n');
  put('main.go', 'package main\n\nfunc main() {}\n');
  // Two packages in one directory, as the test sources of the Go distribution hold them.
  put('var/tools/mise/installs/go/1.27.2/test/a.go', 'package main\n');
  put('var/tools/mise/installs/go/1.27.2/test/b.go', 'package p\n');
  if (withGoMod) put('var/tools/go.mod', TOOLS_GO_MOD);
  return root;
}

const list = (root: string) => spawnSync(go, ['list', './...'], { cwd: root, encoding: 'utf8', env: { ...process.env, GOFLAGS: '-mod=mod', GOTOOLCHAIN: 'local', GOWORK: 'off' } });

test('./... of a Go module root walks the Go of var/tools without the go.mod of var/tools, and skips it with it (K135)', (t) => {
  assert.ok(go, 'the pinned go is installed; run make install-tools');
  const without = list(repository(t, false));
  assert.notEqual(without.status, 0, without.stdout);
  assert.match(without.stderr, /found packages main \(a\.go\) and p \(b\.go\) in \S*\/var\/tools\/mise\/installs\/go\/1\.27\.2\/test/);
  const withMod = list(repository(t, true));
  assert.equal(withMod.status, 0, withMod.stderr);
  assert.equal(withMod.stdout.trim(), 'example.com/repository');
});
