// Stub commands for the toolchain tests: `npm`, `go`, `cargo` and `curl` on PATH log their arguments to
// STUB_LOG and write what the real commands write (an npm tree, a Go toolchain module, a cargo-audit binary, a downloaded
// file), so an installer runs offline and a test reads the calls it made. The uv of a release archive (uvRelease) is a stub
// too: it installs a stub Python, makes a venv and installs the ruff wheel into it. The files the stubs write are Node
// scripts, so a wrapper of var/tools/bin can be run.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { TestContext } from 'node:test';
import { ALINT_TARGETS, alintArchive, alintArchiveUrl } from '../../scripts/kit/install-alint.mts';
import { UV_TARGETS, uvArchiveUrl } from '../../scripts/kit/install-uv.mts';

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

// go mod edit reads a go.mod for the declaration of Go: the real go of the test runs it, unlogged.
const GO_EDIT = `if (args[0] === 'mod' && args[1] === 'edit') {
  const real = ${JSON.stringify(realCommand('go'))};
  if (!real) { console.error('stub: no real go on the PATH of the test'); process.exit(1); }
  process.exit(require('node:child_process').spawnSync(real, args, { stdio: 'inherit' }).status ?? 1);
}
`;

const GO = `${HEADER.replace('fs.appendFileSync', `${GO_EDIT}fs.appendFileSync`)}
if (args[0] === 'mod') {
  // The module resolution of Go 1.24 with GOTOOLCHAIN=local: the go.mod of the working directory, or the first one
  // above it, names a newer Go and the call refuses, as the real machine Go refused on a release runner.
  let dir = process.cwd(), found = null;
  while (true) {
    if (fs.existsSync(path.join(dir, 'go.mod'))) { found = path.join(dir, 'go.mod'); break; }
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  if (found) {
    const want = /go (\\d+)\\.(\\d+)/.exec(fs.readFileSync(found, 'utf8'));
    if (want && Number(want[1]) * 1000 + Number(want[2]) > 1 * 1000 + 24) {
      console.error('go: ' + found + ' requires go >= ' + want[0].slice(3) + ' (running go 1.24.13; GOTOOLCHAIN=local)');
      process.exit(1);
    }
  }
  const module = args.at(-1);
  const version = /-go(\\d+\\.\\d+\\.\\d+)\\./.exec(module)[1];
  const cache = process.env.GOMODCACHE;
  const root = path.join(cache, module);
  fs.mkdirSync(path.join(root, 'pkg/tool/stub_arch'), { recursive: true });
  fs.writeFileSync(path.join(root, 'VERSION'), 'go' + (process.env.STUB_GO_SHOWS ?? version) + '\\ntime 2026-01-01\\n');
  for (const name of ['go', 'gofmt']) script(path.join(root, 'bin', name), 'console.log(' + JSON.stringify(name + ' ' + version + ' ' + process.env.GOTOOLCHAIN) + ');');
  // The module zip keeps no file modes.
  fs.writeFileSync(path.join(root, 'pkg/tool/stub_arch/compile'), 'binary', { mode: 0o644 });
  fs.mkdirSync(path.join(cache, 'cache/download'), { recursive: true });
  fs.writeFileSync(path.join(cache, 'cache/download/zip'), 'zip');
} else if (args[0] === 'install') {
  const release = /@v(.+)$/.exec(args[1])[1];
  script(path.join(process.env.GOBIN, 'govulncheck'), 'console.log("Scanner: govulncheck@v' + (process.env.STUB_GOVULNCHECK_SHOWS ?? release) + '");');
}
`;

// The bytes of the ruff wheel of a release: `pip download` writes them under the name of the wheel of the requirement.
export const ruffWheel = (version: string) => `ruff ${version} wheel stand-in\n`;

// The Python that the uv stub installs: it prints STUB_PYTHON_SHOWS (3.14.8) and downloads the ruff wheel of the requirement
// file of `pip download`.
const PYTHON = `${HEADER}
if (args[0] === '--version') console.log('Python ' + (process.env.STUB_PYTHON_SHOWS ?? '3.14.8'));
else if (args[1] === 'pip' && args[2] === 'download') {
  const [, name, version] = /^(ruff)==(\\d+\\.\\d+\\.\\d+)/.exec(fs.readFileSync(args[args.indexOf('-r') + 1], 'utf8'));
  fs.writeFileSync(path.join(args[args.indexOf('-d') + 1], name + '-' + version + '-py3-none-any.whl'), name + ' ' + version + ' wheel stand-in\\n');
}
`;

// The uv of a release archive: \`python install\` writes the stub Python under UV_PYTHON_INSTALL_DIR and \`python find\` names it,
// \`venv\` makes a venv whose home is that Python, and \`pip install\` puts the command of the ruff wheel beside the venv's python.
const uvSource = (version: string) => `${HEADER}
const installed = (release) => path.join(process.env.UV_PYTHON_INSTALL_DIR, 'cpython-' + release + '-stub', 'bin', 'python' + release.split('.').slice(0, 2).join('.'));
if (args[0] === '--version') console.log('uv ' + (process.env.STUB_UV_SHOWS ?? ${JSON.stringify(version)}) + ' (stub 2026-01-01)');
else if (args[0] === 'python' && args[1] === 'find') {
  if (!fs.existsSync(installed(args.at(-1)))) process.exit(2);
  console.log(installed(args.at(-1)));
} else if (args[0] === 'python' && args[1] === 'install') script(installed(args.at(-1)), ${JSON.stringify(PYTHON.slice(PYTHON.indexOf('\n') + 1))});
else if (args[0] === 'venv') {
  const directory = args.at(-1);
  // As uv does, the home is the directory of the interpreter that the --python wrapper runs.
  const python = args[args.indexOf('--python') + 1];
  const interpreter = /exec '([^']+)'/.exec(fs.readFileSync(python, 'utf8'))?.[1] ?? python;
  script(path.join(directory, 'bin/python'), '');
  fs.writeFileSync(path.join(directory, 'pyvenv.cfg'), 'home = ' + path.dirname(interpreter) + '\\n');
} else if (args[0] === 'pip' && args[1] === 'install') {
  const [, name, release] = /\\/(ruff)-(\\d+\\.\\d+\\.\\d+)-/.exec(args.at(-1));
  script(path.join(path.dirname(args[args.indexOf('--python') + 1]), name), 'console.log(' + JSON.stringify(name + ' ') + ' + (process.env.STUB_RUFF_SHOWS ?? ' + JSON.stringify(release) + '));');
}
`;

// The alint of a release archive: it prints its release as alint does, and checks nothing.
const alintSource = (version: string) => `${HEADER}
if (args[0] === '--version') console.log('alint ' + (process.env.STUB_ALINT_SHOWS ?? ${JSON.stringify(version)}) + ' (stub, built 2026-01-01)');
`;

const CARGO = `${HEADER}
const root = args[args.indexOf('--root') + 1];
const release = /cargo-audit@(.+)$/.exec(args.at(-1))[1];
script(path.join(root, 'bin/cargo-audit'), 'console.log("cargo-audit ' + (process.env.STUB_CARGO_AUDIT_SHOWS ?? release) + '");');
`;

const CURL = `${HEADER}
const url = args.at(-1);
const output = args[args.indexOf('--output') + 1];
const source = JSON.parse(process.env.STUB_DOWNLOADS ?? '{}')[url];
if (!source) { console.error('curl: 404 ' + url); process.exit(22); }
fs.copyFileSync(source, output);
`;

export const PYTHON_VERSION = '3.14.8';
export const UV_VERSION = '0.12.24';

/**
 * The uv declaration of this platform and the release archive of the stub uv that it names: the archive is written into a
 * temporary directory that is removed with `t.after`, and its digest is the declared one. `url` is the download.
 */
export function uvRelease(t: Pick<TestContext, 'after'>, version = UV_VERSION) {
  const directory = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-uv-release-')));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const key = `${process.platform}-${process.arch}`;
  const targets: Record<string, string> = UV_TARGETS;
  const target = targets[key];
  if (target === undefined) throw new Error(`uvRelease: UV_TARGETS has no uv target for ${key}`);
  mkdirSync(path.join(directory, `uv-${target}`));
  writeFileSync(path.join(directory, `uv-${target}`, 'uv'), uvSource(version), { mode: 0o755 });
  const archive = path.join(directory, 'archive.tar.gz');
  execFileSync('tar', ['-czf', archive, '-C', directory, `uv-${target}`]);
  const declared = { version, sha256: { [key]: createHash('sha256').update(readFileSync(archive)).digest('hex') } };
  return { declared, url: uvArchiveUrl(version, target), archive, key, target };
}

export const ALINT_VERSION = '0.18.2';

/**
 * The alint declaration of this platform and the release archive of the stub alint that it names, as uvRelease does for uv:
 * the archive holds the folder alint-v<version>-<target> with the binary alint.
 */
export function alintRelease(t: Pick<TestContext, 'after'>, version = ALINT_VERSION) {
  const directory = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-alint-release-')));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const key = `${process.platform}-${process.arch}`;
  const target = ALINT_TARGETS[key];
  if (target === undefined) throw new Error(`alintRelease: ALINT_TARGETS has no alint target for ${key}`);
  const folder = alintArchive(version, target);
  mkdirSync(path.join(directory, folder));
  writeFileSync(path.join(directory, folder, 'alint'), alintSource(version), { mode: 0o755 });
  const archive = path.join(directory, 'archive.tar.gz');
  execFileSync('tar', ['-czf', archive, '-C', directory, folder]);
  const declared = { version, sha256: { [key]: createHash('sha256').update(readFileSync(archive)).digest('hex') } };
  return { declared, url: alintArchiveUrl(version, target), archive, key, target, folder };
}

/** The directory of stubs and the environment that puts them first on PATH; the directory is removed with \`t.after\`. */
export function toolchainStubs(t: Pick<TestContext, 'after'>, { downloads = {}, extra = {} }: { downloads?: Record<string, string>; extra?: Record<string, string> } = {}) {
  const directory = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-toolchain-stubs-')));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const bin = path.join(directory, 'bin');
  mkdirSync(bin);
  for (const [name, source] of [['npm', NPM], ['go', GO], ['cargo', CARGO], ['curl', CURL]] as const) {
    writeFileSync(path.join(bin, name), source);
    chmodSync(path.join(bin, name), 0o755);
  }
  const log = path.join(directory, 'calls.log');
  writeFileSync(log, '');
  const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, STUB_LOG: log, STUB_DOWNLOADS: JSON.stringify(downloads), ...extra };
  return { env, directory, calls: () => readFileSync(log, 'utf8').split('\n').filter(Boolean) };
}

// The first argument of each reader of manifests that a version stub passes to the real command.
const READERS: Record<string, string> = { go: 'mod', python3: '-I', npm: 'config' };

// The real command `name` on the PATH of the test, or null.
function realCommand(name: string): string | null {
  return (process.env.PATH ?? '').split(path.delimiter).filter(Boolean).map(directory => path.join(directory, name)).find(file => existsSync(file)) ?? null;
}

/**
 * Stubs of version commands: each command of `outputs` ({ name: text }) prints its text for any arguments (a command whose text
 * is `null` exits with status 1, as a command that fails to run), and the log line
 * holds the arguments and the GOTOOLCHAIN and RUSTUP_AUTO_INSTALL it ran with. The environment has the stubs first on PATH,
 * followed by the directory of this Node.js and the system directories only, so a tool that is not stubbed is absent. The
 * readers of manifests (READERS: `go mod`, `python3 -I`, `npm config`) are no version commands: a stub runs the real command
 * of the PATH of the test for them, unlogged, and fails when the test has none.
 */
export function versionStubs(t: Pick<TestContext, 'after'>, outputs: Record<string, string | null>) {
  const directory = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-toolchain-versions-')));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const bin = path.join(directory, 'bin');
  mkdirSync(bin);
  const log = path.join(directory, 'calls.log');
  writeFileSync(log, '');
  for (const [name, text] of Object.entries(outputs)) {
    const reader = READERS[name];
    writeFileSync(path.join(bin, name), `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
${reader ? `if (process.argv[2] === ${JSON.stringify(reader)}) {
  const real = ${JSON.stringify(realCommand(name))};
  if (!real) { console.error('stub: no real ${name} on the PATH of the test'); process.exit(1); }
  process.exit(require('node:child_process').spawnSync(real, process.argv.slice(2), { stdio: 'inherit' }).status ?? 1);
}` : ''}
fs.appendFileSync(process.env.STUB_LOG, path.basename(process.argv[1]) + ' ' + process.argv.slice(2).join(' ') + ' [GOTOOLCHAIN=' + process.env.GOTOOLCHAIN + ' RUSTUP_AUTO_INSTALL=' + process.env.RUSTUP_AUTO_INSTALL + ']\\n');
${text === null ? 'console.error("stub: the command fails"); process.exit(1);' : `console.log(${JSON.stringify(text)});`}
`);
    chmodSync(path.join(bin, name), 0o755);
  }
  const env = { PATH: [bin, path.dirname(process.execPath), '/usr/bin', '/bin'].join(path.delimiter), STUB_LOG: log, HOME: directory };
  return { env, directory, calls: () => readFileSync(log, 'utf8').split('\n').filter(Boolean) };
}
