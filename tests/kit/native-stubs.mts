// Stubs of the native build tools of the per-platform release tests (K1189): cargo, the php of a checkout and the napi CLI of
// a repository. They write files of the form that the real tools write, never a library, and append each call as a JSON line to
// STUB_NATIVE_LOG. cargo build -p NAME finds the Cargo.toml of NAME below packages/ of its directory, writes a file for each crate
// type of its [lib] into CARGO_TARGET_DIR/release and prints the compiler-artifact message of cargo for it. php prints the build
// that STUB_PHP_MINOR names and loads an extension file that exists. The napi CLI writes the addon of its package.json, the
// folder of each platform package with the package.json that napi create-npm-dirs writes, and copies the addon into its folder.
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const LOG = `
function logCall(tool, args) {
  if (process.env.STUB_NATIVE_LOG) fs.appendFileSync(process.env.STUB_NATIVE_LOG, JSON.stringify({ tool, args, cwd: process.cwd(), env: { CARGO_TARGET_DIR: process.env.CARGO_TARGET_DIR || null, PHP: process.env.PHP || null, PHP_CONFIG: process.env.PHP_CONFIG || null, MATURIN_PEP517_ARGS: process.env.MATURIN_PEP517_ARGS || null } }) + '\\n');
}
`;

const CARGO_STUB = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
${LOG}
const args = process.argv.slice(2);
logCall('cargo', args);
if (args[0] !== 'build' || !args.includes('--locked') || !args.includes('--release')) { console.error('cargo stub: unexpected arguments ' + JSON.stringify(args)); process.exit(1); }
const name = args[args.indexOf('-p') + 1];
const packages = path.join(process.cwd(), 'packages');
const manifest = fs.readdirSync(packages).map(entry => path.join(packages, entry, 'Cargo.toml')).find(file => fs.existsSync(file) && new RegExp('^name = "' + name + '"$', 'm').test(fs.readFileSync(file, 'utf8')));
if (!manifest) { console.error('error: package ID specification \`' + name + '\` did not match any packages'); process.exit(101); }
const types = JSON.parse((/^crate-type = (\\[.*\\])$/m.exec(fs.readFileSync(manifest, 'utf8')) || [null, '[]'])[1]);
const release = path.join(process.env.CARGO_TARGET_DIR, 'release');
fs.mkdirSync(release, { recursive: true });
const stem = 'lib' + name.replace(/-/g, '_');
const files = types.map(type => path.join(release, stem + (type === 'staticlib' ? '.a' : process.platform === 'darwin' ? '.dylib' : '.so')));
for (const file of files) fs.writeFileSync(file, 'stub library of ' + name + '\\n');
console.log(JSON.stringify({ reason: 'compiler-artifact', manifest_path: manifest, target: { kind: types }, filenames: files }));
console.log(JSON.stringify({ reason: 'build-finished', success: true }));
`;

const PHP_STUB = `#!/usr/bin/env node
const fs = require('node:fs');
${LOG}
const args = process.argv.slice(2);
logCall('php', args);
const code = args[args.indexOf('-r') + 1] || '';
if (args[0] === '-n' && args[1] === '-r' && code.includes('json_encode')) {
  console.log(JSON.stringify({ minor: process.env.STUB_PHP_MINOR, zts: false, debug: false }));
  process.exit(0);
}
if (args[0] === '-n' && args[1] === '-d' && args[2].startsWith('extension=')) process.exit(fs.existsSync(args[2].slice('extension='.length)) ? 0 : 1);
console.error('php stub: unexpected arguments ' + JSON.stringify(args));
process.exit(1);
`;

const NAPI_STUB = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
${LOG}
const args = process.argv.slice(2);
logCall('napi', args);
const option = name => args[args.indexOf(name) + 1];
const manifest = JSON.parse(fs.readFileSync(option('--package-json-path'), 'utf8'));
const platforms = { 'x86_64-unknown-linux-gnu': ['linux-x64-gnu', 'linux', 'x64'], 'aarch64-unknown-linux-gnu': ['linux-arm64-gnu', 'linux', 'arm64'], 'aarch64-apple-darwin': ['darwin-arm64', 'darwin', 'arm64'] };
const addon = platform => manifest.napi.binaryName + '.' + platform + '.node';
if (args[0] === 'build') {
  fs.mkdirSync(option('--output-dir'), { recursive: true });
  fs.writeFileSync(path.join(option('--output-dir'), addon(platforms[option('--target')][0])), 'stub addon\\n');
} else if (args[0] === 'create-npm-dirs') {
  for (const triple of manifest.napi.targets) {
    const [platform, os, cpu] = platforms[triple];
    fs.mkdirSync(path.join(option('--npm-dir'), platform), { recursive: true });
    fs.writeFileSync(path.join(option('--npm-dir'), platform, 'package.json'), JSON.stringify({ name: manifest.name + '-' + platform, version: process.env.STUB_NAPI_VERSION || manifest.version, os: [os], cpu: [cpu], main: addon(platform), files: [addon(platform)] }, null, 2) + '\\n');
  }
} else if (args[0] === 'artifacts') {
  for (const file of fs.readdirSync(option('--output-dir')).filter(file => file.endsWith('.node'))) {
    const platform = file.split('.')[1];
    fs.copyFileSync(path.join(option('--output-dir'), file), path.join(option('--npm-dir'), platform, file));
  }
} else {
  console.error('napi stub: unexpected arguments ' + JSON.stringify(args));
  process.exit(1);
}
`;

/** Writes the stubs into the checkout `root`: cargo and php as tools of the checkout (var/tools/bin), napi as the bin link of npm. */
export function writeNativeStubs(root: string): void {
  for (const [file, source] of [['var/tools/bin/cargo', CARGO_STUB], ['var/tools/bin/php', PHP_STUB], ['node_modules/.bin/napi', NAPI_STUB]] as const) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), source);
    chmodSync(path.join(root, file), 0o755);
  }
}
