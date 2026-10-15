// make toolchain-lock (scripts/kit/toolchain-lock.mts) installs the mise of config/toolchain.json, as the bootstrap does, and
// writes mise.lock with it (K174; its run before the node of the checkout is in install-mise.test.mts). The environment of mise
// of the checkout names its mise.toml as the global configuration (K127), and mise 2026.10.8 then reads no tool of the project
// (measured: "No tools configured to lock in this project, but global config declares tools. Run mise lock --global to lock
// those."), so the lock is written with `mise lock --global`, which writes mise.lock beside that mise.toml. The stub of mise
// answers as mise does.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { lockTools } from '../../scripts/kit/toolchain-lock.mts';
import { tree } from './tree.mts';
import { readStubLines, TEXTS } from './stub-json.mts';

const LOCK = `[[tools.golangci-lint]]
version = "2.14.0"
backend = "aqua:golangci/golangci-lint"

[tools.golangci-lint."platforms.linux-x64"]
checksum = "sha256:ab90aeb7b066f92a33415b638a50fe5344bbb75a0d32ad30cc248d88f81032ab"

[tools.golangci-lint."platforms.linux-arm64"]
checksum = "sha256:ee7ec5f3453d15ddf106fae5a4d6c71737712348a979d1fe9cd52ec7ea299bae"

[tools.golangci-lint."platforms.macos-arm64"]
checksum = "sha256:5ef5f36a7147e91dc58ef9ef4d11bb7bad5ead0c76eb6c01327a73c641d1dcc3"

[tools.golangci-lint."platforms.macos-x64"]
checksum = "sha256:a5667c1c3536be1740133213e1e822bfb8f0d98ea12903174d6d5f635e4ed68d"
`;

// The installed mise release (var/tools/mise-release) of the declared version, which installMise keeps: mise with the project's
// mise.toml as its global configuration: lock locks the global tools only with --global, and writes mise.lock beside that file.
const VERSION = '2026.10.8';
const MISE = `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args[0] === '--version') { console.log('${VERSION} linux-x64 (2026-10-11)'); process.exit(0); }
fs.appendFileSync(process.env.STUB_MISE_ARGS, JSON.stringify(args) + '\\n');
if (args[0] === 'lock' && !args.includes('--global')) {
  console.error('! No tools configured to lock in this project, but global config declares tools. Run mise lock --global to lock those.');
  process.exit(2);
}
if (args[0] === 'lock') fs.writeFileSync('mise.lock', ${JSON.stringify(LOCK)});
`;

test('toolchain-lock locks the tools of mise.toml, which the environment of mise names as the global configuration (K127)', (t) => {
  const declared = { schema: 1, mise: { version: VERSION, sha256: { [`${process.platform}-${process.arch}`]: '0'.repeat(64) } } };
  const root = tree(t, { 'mise.toml': '[tools]\ngolangci-lint = "2.14.0"\n', 'config/toolchain.json': JSON.stringify(declared) });
  const mise = path.join(root, 'var/tools/mise-release/mise/bin/mise');
  writeFileSync(path.join(root, 'args.jsonl'), '');
  const previous = process.env.STUB_MISE_ARGS;
  process.env.STUB_MISE_ARGS = path.join(root, 'args.jsonl');
  t.after(() => { if (previous === undefined) delete process.env.STUB_MISE_ARGS; else process.env.STUB_MISE_ARGS = previous; });
  writeStub(mise);
  const printed: string[] = [];
  lockTools({ root, print: text => printed.push(text) });
  assert.deepEqual(readStubLines(path.join(root, 'args.jsonl'), TEXTS), [['lock', '--global', '--platform', 'linux-x64,linux-arm64,macos-arm64,macos-x64']]);
  assert.equal(readFileSync(path.join(root, 'mise.lock'), 'utf8'), LOCK);
  assert.equal(printed[0], `mise: ${VERSION} is installed in var/tools/mise-release`);
  assert.deepEqual(printed.at(-1), 'mise.lock pins every tool of mise.toml');
});

function writeStub(file: string) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, MISE, { mode: 0o755 });
}
