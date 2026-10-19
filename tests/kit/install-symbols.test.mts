// Tests of install-symbols.mts, the build of the symbol extractors of parity: the go extractor is built with the Go of
// the checkout, the go of the install that `mise where go` prints in the checkout, never with a go of PATH nor with the shim
// var/tools/mise/shims/go, which reads the mise.toml of the directory of the extractor sources (K199), and an installation
// whose RELEASE cannot be read fails with the file instead of counting as not installed. go is a stub that writes the output
// binary, so no test builds Go.
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { extractorRelease, installExtractor, SYMBOLS } from '../../scripts/kit/install-symbols.mts';
import { toolchainCheckout } from './toolchain-checkout.mts';

// A go that logs its arguments and writes the file after -o, as go build writes the binary.
const GO = (log: string) => `#!/bin/sh\necho "go $*" >> ${JSON.stringify(log)}\necho "env GOWORK=$GOWORK GOFLAGS=$GOFLAGS GOPATH=$GOPATH" >> ${JSON.stringify(log)}\nwhile [ $# -gt 0 ]; do if [ "$1" = "-o" ]; then mkdir -p "$(dirname "$2")"; : > "$2"; fi; shift; done\n`;

/** An executable file `file` with the text `text`. */
function executable(file: string, text: string) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
  chmodSync(file, 0o755);
}

/**
 * A checkout whose mise (var/tools/bin/mise) prints, for `where go` in the checkout, an install whose bin/go is the stub
 * (unless `pinned` is false, when it fails as mise fails for a tool that mise.toml does not declare); a shim of go that
 * fails as the shim of mise fails in a directory whose mise.toml is not trusted, the extractor sources of a linked kit; and
 * a PATH whose go fails.
 */
function checkout(t: TestContext, { pinned = true } = {}) {
  const root = toolchainCheckout(t);
  const log = path.join(root, 'go.log');
  writeFileSync(log, '');
  const install = path.join(root, 'var/tools/mise/installs/go/1.25.0');
  const where = pinned ? `echo ${JSON.stringify(install)}` : 'echo "mise ERROR go is not a tool of mise.toml" >&2; exit 1';
  executable(path.join(root, 'var/tools/bin/mise'), `#!/bin/sh\nif [ "$1 $2" = "where go" ] && [ "$PWD" = ${JSON.stringify(root)} ]; then ${where}; else echo "mise stub: unexpected $* in $PWD" >&2; exit 1; fi\n`);
  if (pinned) executable(path.join(install, 'bin/go'), GO(log));
  executable(path.join(root, 'var/tools/mise/shims/go'), `#!/bin/sh\necho "mise ERROR Config files in $PWD/mise.toml are not trusted." >&2\nexit 1\n`);
  const machine = path.join(root, 'machine');
  executable(path.join(machine, 'go'), '#!/bin/sh\necho "the go of PATH ran" >&2\nexit 1\n');
  const saved = process.env.PATH;
  process.env.PATH = `${machine}${path.delimiter}${saved}`;
  t.after(() => { process.env.PATH = saved; });
  return { root, calls: () => readFileSync(log, 'utf8').split('\n').filter(Boolean) };
}

// The extractor is a module of its own under node_modules of the consumer, so it builds outside the go.work of the consumer
// and in the Go environment of mise, which changes no go.mod and keeps its caches in var/tools (K196).
test('the go extractor is built with the go of mise.toml, not with the go of PATH, outside the workspace of the consumer', (t) => {
  const { root, calls } = checkout(t);
  const result = installExtractor({ root, extractor: 'go' });
  assert.ok(result.installed, 'the extractor was installed');
  assert.deepEqual(calls().map(line => line.split(' -o ')[0]), ['go build -trimpath', `env GOWORK=off GOFLAGS=-mod=readonly -modcacherw GOPATH=${path.join(root, 'var/tools/mise/go')}`]);
  assert.ok(existsSync(path.join(root, 'var/tools/symbols-go/bin/kit-symbols-go')));
});

// A linked kit puts the extractor sources in the kit checkout, under its own mise.toml, which the consumer does not trust; the
// build runs the go of the consumer by its absolute path, so no mise.toml of the directory of the sources is read (K199).
test('the go extractor builds in sources under a mise.toml that the checkout does not trust, where the shim of go fails', (t) => {
  const { root, calls } = checkout(t);
  assert.ok(!SYMBOLS.startsWith(`${root}${path.sep}`), 'the extractor sources lie outside the checkout, as in a linked kit');
  assert.ok(installExtractor({ root, extractor: 'go' }).installed);
  assert.equal(calls().filter(line => line.startsWith('go build')).length, 1);
});

test('without the go of mise.toml the go extractor fails with the install that provides it', (t) => {
  const { root } = checkout(t, { pinned: false });
  assert.throws(() => installExtractor({ root, extractor: 'go' }), /the go symbol extractor needs the Go of mise\.toml; declare go in mise\.toml and run make install-tools: .*go is not a tool of mise\.toml/s);
});

test('an installation whose RELEASE cannot be read fails with the file, and is not rebuilt as missing', (t) => {
  const { root, calls } = checkout(t);
  // A RELEASE that is a directory reads with EISDIR, which is no missing installation.
  mkdirSync(path.join(root, 'var/tools/symbols-go/RELEASE'), { recursive: true });
  assert.throws(() => installExtractor({ root, extractor: 'go' }), /var\/tools\/symbols-go\/RELEASE cannot be read: EISDIR/);
  assert.deepEqual(calls(), []);
});

test('the release of an extractor is that of its files: the vendor/ of kit\'s PHP lint is none, another folder fails (K248-4-1)', (t) => {
  const symbols = mkdtempSync(path.join(tmpdir(), 'kit-symbols-'));
  t.after(() => rmSync(symbols, { recursive: true, force: true }));
  mkdirSync(path.join(symbols, 'php'));
  writeFileSync(path.join(symbols, 'php', 'extract.php'), '<?php\n');
  const release = extractorRelease('php', symbols);
  mkdirSync(path.join(symbols, 'php', 'vendor'));
  writeFileSync(path.join(symbols, 'php', 'vendor', 'autoload.php'), '<?php\n');
  assert.equal(extractorRelease('php', symbols), release, 'vendor/ changes no release');
  writeFileSync(path.join(symbols, 'php', 'PublicSymbols.php'), '<?php\n');
  assert.notEqual(extractorRelease('php', symbols), release, 'a source file changes the release');
  mkdirSync(path.join(symbols, 'php', 'src'));
  assert.throws(() => extractorRelease('php', symbols), /holds src, which is no source file/);
});
