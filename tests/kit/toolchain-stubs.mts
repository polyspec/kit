// Stub commands for the toolchain tests: `npm` and `curl` on PATH log their arguments to STUB_LOG and write what the real
// commands write (an npm tree, a downloaded file), so the bootstrap runs offline and a test reads the calls it made; miseStub
// writes the wrapper var/tools/bin/mise of a checkout as a stub that logs its arguments. The files the stubs write are Node
// scripts, so a wrapper of var/tools/bin can be run.
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { TestContext } from 'node:test';
import { TOOL_ANSWER, TOOL_RECORDS } from './registry.mts';

const HEADER = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.STUB_LOG, path.basename(process.argv[1]) + ' ' + args.join(' ') + '\\n');
const script = (file, source) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, '#!/usr/bin/env node\\n' + source, { mode: 0o755 }); };
`;

const NPM = `${HEADER}
if (process.env.STUB_PATH_LOG) fs.appendFileSync(process.env.STUB_PATH_LOG, process.env.PATH + '\\n');
const version = /^npm@(.+)$/.exec(args.at(-1))[1];
const prefix = args[args.indexOf('--prefix') + 1];
const shown = process.env.STUB_NPM_SHOWS ?? version;
fs.mkdirSync(path.join(prefix, 'node_modules/npm'), { recursive: true });
fs.writeFileSync(path.join(prefix, 'node_modules/npm/package.json'), JSON.stringify({ name: 'npm', version: shown }));
script(path.join(prefix, 'node_modules/npm/bin/npm-cli.js'), 'console.log(' + JSON.stringify(shown) + ');');
`;

const CURL = `${HEADER}
const url = args.at(-1);
const output = args[args.indexOf('--output') + 1];
const source = JSON.parse(process.env.STUB_DOWNLOADS ?? '{}')[url];
if (!source) { console.error('curl: 404 ' + url); process.exit(22); }
fs.copyFileSync(source, output);
`;


/**
 * The wrapper var/tools/bin/mise of the checkout `root` as a stub: it appends its arguments to STUB_LOG, and with
 * STUB_MISE_ENV_LOG its arguments, PATH and UV_PYTHON as a line of JSON; it prints `output` for `which`; with STUB_MISE_FAILS
 * it fails, as a `mise install --locked` that mise.lock does not allow.
 */
export function miseStub(root: string, output: Record<string, string> = {}) {
  const file = path.join(root, 'var/tools/bin/mise');
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${HEADER}
if (process.env.STUB_MISE_ENV_LOG) fs.appendFileSync(process.env.STUB_MISE_ENV_LOG, JSON.stringify({ args, PATH: process.env.PATH, UV_PYTHON: process.env.UV_PYTHON }) + '\\n');
if (process.env.STUB_MISE_FAILS) { console.error('mise ERROR ' + process.env.STUB_MISE_FAILS); process.exit(1); }
const shown = ${JSON.stringify(output)}[args.join(' ')];
if (shown !== undefined) console.log(shown);
`, { mode: 0o755 });
  return file;
}

/** The directory of stubs and the environment that puts them first on PATH; the directory is removed with \`t.after\`. */
export function toolchainStubs(t: Pick<TestContext, 'after'>, { downloads = {}, extra = {} }: { downloads?: Record<string, string>; extra?: Record<string, string> } = {}) {
  const directory = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-toolchain-stubs-')));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const bin = path.join(directory, 'bin');
  mkdirSync(bin);
  for (const [name, source] of [['npm', NPM], ['curl', CURL]] as const) {
    writeFileSync(path.join(bin, name), source);
    chmodSync(path.join(bin, name), 0o755);
  }
  const log = path.join(directory, 'calls.log');
  writeFileSync(log, '');
  const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, STUB_LOG: log, STUB_DOWNLOADS: JSON.stringify(downloads), ...extra };
  return { env, directory, calls: () => readFileSync(log, 'utf8').split('\n').filter(Boolean) };
}

/**
 * Stubs of version commands: each command of `outputs` ({ name: text }) prints its text for any arguments (a command whose text
 * is `null` exits with status 1, as a command that fails to run), and the log line
 * holds the arguments and the GOTOOLCHAIN and RUSTUP_AUTO_INSTALL it ran with. The environment has the stubs first on PATH,
 * followed by the directory of this Node.js and the system directories only, so a tool that is not stubbed is absent. The
 * reader of manifests `go mod edit` is no version command: it answers from the records of the real go (TOOL_ANSWER of
 * registry.mts). A stub never starts a process (stubs.test.mts).
 */
export function versionStubs(t: Pick<TestContext, 'after'>, outputs: Record<string, string | null>) {
  const directory = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-toolchain-versions-')));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const bin = path.join(directory, 'bin');
  mkdirSync(bin);
  const log = path.join(directory, 'calls.log');
  writeFileSync(log, '');
  for (const [name, text] of Object.entries(outputs)) {
    writeFileSync(path.join(bin, name), `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
${name === 'go' ? `${TOOL_ANSWER}
if (process.argv[2] === 'mod' && process.argv[3] === 'edit') {
  const args = process.argv.slice(2);
  answer('go', args.slice(0, -1), { 'go.mod': fs.readFileSync(args[args.length - 1], 'utf8') }, args);
}` : ''}
fs.appendFileSync(process.env.STUB_LOG, path.basename(process.argv[1]) + ' ' + process.argv.slice(2).join(' ') + ' [GOTOOLCHAIN=' + process.env.GOTOOLCHAIN + ' RUSTUP_AUTO_INSTALL=' + process.env.RUSTUP_AUTO_INSTALL + ']\\n');
${text === null ? 'console.error("stub: the command fails"); process.exit(1);' : `console.log(${JSON.stringify(text)});`}
`);
    chmodSync(path.join(bin, name), 0o755);
  }
  const env: NodeJS.ProcessEnv = { PATH: [bin, path.dirname(process.execPath), '/usr/bin', '/bin'].join(path.delimiter), STUB_LOG: log, HOME: directory, STUB_TOOL_RECORDS: TOOL_RECORDS };
  // make kit-tool-record collects the requests that no record answers.
  if (process.env.STUB_TOOL_MISSES) env.STUB_TOOL_MISSES = process.env.STUB_TOOL_MISSES;
  return { env, directory, calls: () => readFileSync(log, 'utf8').split('\n').filter(Boolean) };
}
