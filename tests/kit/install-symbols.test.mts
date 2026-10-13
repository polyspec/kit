// Tests of install-symbols.mts, the build of the symbol extractors of parity: the go extractor is built with the Go of
// the checkout, the shim var/tools/mise/shims/go of mise.toml, never with a go of PATH, and an installation whose
// RELEASE cannot be read fails with the file instead of counting as not installed. go is a stub that writes the output binary, so no test builds Go.
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { installExtractor } from '../../scripts/kit/install-symbols.mts';
import { toolchainCheckout } from './toolchain-checkout.mts';

// A go that logs its arguments and writes the file after -o, as go build writes the binary.
const GO = (log: string) => `#!/bin/sh\necho "go $*" >> ${JSON.stringify(log)}\nwhile [ $# -gt 0 ]; do if [ "$1" = "-o" ]; then mkdir -p "$(dirname "$2")"; : > "$2"; fi; shift; done\n`;

/** A checkout whose shim var/tools/mise/shims/go is the stub (unless `pinned` is false), and a PATH whose go fails. */
function checkout(t: TestContext, { pinned = true } = {}) {
  const root = toolchainCheckout(t);
  const log = path.join(root, 'go.log');
  writeFileSync(log, '');
  mkdirSync(path.join(root, 'var/tools/mise/shims'), { recursive: true });
  if (pinned) {
    writeFileSync(path.join(root, 'var/tools/mise/shims/go'), GO(log));
    chmodSync(path.join(root, 'var/tools/mise/shims/go'), 0o755);
  }
  const machine = path.join(root, 'machine');
  mkdirSync(machine);
  writeFileSync(path.join(machine, 'go'), '#!/bin/sh\necho "the go of PATH ran" >&2\nexit 1\n');
  chmodSync(path.join(machine, 'go'), 0o755);
  const saved = process.env.PATH;
  process.env.PATH = `${machine}${path.delimiter}${saved}`;
  t.after(() => { process.env.PATH = saved; });
  return { root, calls: () => readFileSync(log, 'utf8').split('\n').filter(Boolean) };
}

test('the go extractor is built with the go of mise.toml, not with the go of PATH', (t) => {
  const { root, calls } = checkout(t);
  const result = installExtractor({ root, extractor: 'go' });
  assert.ok(result.installed, 'the extractor was installed');
  assert.deepEqual(calls().map(line => line.split(' -o ')[0]), ['go build -trimpath']);
  assert.ok(existsSync(path.join(root, 'var/tools/symbols-go/bin/kit-symbols-go')));
});

test('without the go of mise.toml the go extractor fails with the install that provides it', (t) => {
  const { root } = checkout(t, { pinned: false });
  assert.throws(() => installExtractor({ root, extractor: 'go' }), /the go symbol extractor needs var\/tools\/mise\/shims\/go, the Go of mise\.toml; declare go in mise\.toml and run make install-tools/);
});

test('an installation whose RELEASE cannot be read fails with the file, and is not rebuilt as missing', (t) => {
  const { root, calls } = checkout(t);
  // A RELEASE that is a directory reads with EISDIR, which is no missing installation.
  mkdirSync(path.join(root, 'var/tools/symbols-go/RELEASE'), { recursive: true });
  assert.throws(() => installExtractor({ root, extractor: 'go' }), /var\/tools\/symbols-go\/RELEASE cannot be read: EISDIR/);
  assert.deepEqual(calls(), []);
});
