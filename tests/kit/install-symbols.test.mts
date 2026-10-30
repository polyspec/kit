// Tests of install-symbols.mts, the build of the symbol extractors of parity: the go extractor is built with the Go of
// the checkout, the go of the install that `mise where go` prints in the checkout, never with a go of PATH nor with the shim
// var/tools/mise/shims/go, which reads the mise.toml of the directory of the extractor sources (K199), and the extractor
// is built again on each install, with no RELEASE of kit (K861). go is a stub that writes the output
// binary, so no test builds Go.
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { installDeclared, installDeclaredExtractors, installExtractor, SYMBOLS } from '../../scripts/kit/install-symbols.mts';
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
  installExtractor({ root, extractor: 'go' });
  assert.deepEqual(calls().map(line => line.split(' -o ')[0]), ['go build -trimpath', `env GOWORK=off GOFLAGS=-mod=readonly -modcacherw GOPATH=${path.join(root, 'var/tools/mise/go')}`]);
  assert.ok(existsSync(path.join(root, 'var/tools/symbols-go/bin/kit-symbols-go')));
});

// A linked kit puts the extractor sources in the kit checkout, under its own mise.toml, which the consumer does not trust; the
// build runs the go of the consumer by its absolute path, so no mise.toml of the directory of the sources is read (K199).
test('the go extractor builds in sources under a mise.toml that the checkout does not trust, where the shim of go fails', (t) => {
  const { root, calls } = checkout(t);
  assert.ok(!SYMBOLS.startsWith(`${root}${path.sep}`), 'the extractor sources lie outside the checkout, as in a linked kit');
  installExtractor({ root, extractor: 'go' });
  assert.equal(calls().filter(line => line.startsWith('go build')).length, 1);
});

test('without the go of mise.toml the go extractor fails with the install that provides it', (t) => {
  const { root } = checkout(t, { pinned: false });
  assert.throws(() => installExtractor({ root, extractor: 'go' }), /the go symbol extractor needs the Go of mise\.toml; declare go in mise\.toml and run make install-tools: .*go is not a tool of mise\.toml/s);
});

test('the shared symbols installer installs only explicitly requested declared extractors', (t) => {
  const root = toolchainCheckout(t, {
    'mise.toml': '[tools]\ngo = "1.27.3"\n',
    'config/toolchain.json': JSON.stringify({ schema: 1, symbolExtractors: ['go', 'php'] }),
  });
  const calls: string[] = [];
  installDeclaredExtractors({
    root,
    extractors: ['go'],
    install: ({ extractor }) => { calls.push(extractor); },
  });
  assert.deepEqual(calls, ['go']);
});

// K861: make kit-install-declared runs install-symbols --declared, which installs what the repository declares and nothing else.
test('K861: --declared installs every declared extractor, and nothing without a declaration', (t) => {
  const declared = toolchainCheckout(t, {
    'mise.toml': '[tools]\ngo = "1.27.3"\n',
    'config/toolchain.json': JSON.stringify({ schema: 1, symbolExtractors: ['go'] }),
  });
  const calls: string[] = [];
  const install = ({ extractor }: Parameters<typeof installExtractor>[0]) => { calls.push(extractor); };
  assert.deepEqual(installDeclared({ root: declared, install }), ['go']);
  assert.deepEqual(calls, ['go']);
  const bare = toolchainCheckout(t, { 'config/toolchain.json': JSON.stringify({ schema: 1 }) });
  assert.deepEqual(installDeclared({ root: bare, install }), []);
  assert.deepEqual(calls, ['go'], 'nothing is installed without a declaration');
});

test('the shared symbols installer rejects unknown, undeclared and unpinned extractors before installing any', (t) => {
  const root = toolchainCheckout(t, {
    'mise.toml': '[tools]\ngo = "1.27.3"\n',
    'config/toolchain.json': JSON.stringify({ schema: 1, symbolExtractors: ['go', 'php'] }),
  });
  const calls: string[] = [];
  const install = ({ extractor }: Parameters<typeof installExtractor>[0]) => { calls.push(extractor); };
  assert.throws(() => installDeclaredExtractors({ root, extractors: ['python'], install }), /unknown symbol extractor python/);
  assert.throws(() => installDeclaredExtractors({ root, extractors: ['php'], install }), /needs http:composer in mise.toml/);
  assert.deepEqual(calls, []);
});

test('K861: each install builds the extractor again and records no RELEASE; the build tool keeps its own cache', (t) => {
  const { root, calls } = checkout(t);
  installExtractor({ root, extractor: 'go' });
  installExtractor({ root, extractor: 'go' });
  assert.equal(calls().filter(line => line.startsWith('go build')).length, 2, 'a second install builds again');
  assert.equal(existsSync(path.join(root, 'var/tools/symbols-go/RELEASE')), false, 'no RELEASE is recorded');
  assert.ok(existsSync(path.join(root, 'var/tools/symbols-go/bin/kit-symbols-go')));
});

