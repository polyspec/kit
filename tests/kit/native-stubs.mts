// Stubs of the native build tools of the per-platform release tests (K1189): cargo, the php of a checkout and the napi CLI of
// a repository. They write files of the form that the real tools write, never a library, and append each call as a JSON line to
// STUB_NATIVE_LOG. cargo build -p NAME finds the Cargo.toml of NAME below packages/ of its directory, writes a file for each crate
// type of its [lib] into CARGO_TARGET_DIR/release and prints the compiler-artifact message of cargo for it. php prints the build
// that STUB_PHP_MINOR names and loads an extension file that exists. The napi CLI writes the addon of its package.json, the
// folder of each platform package with the package.json that napi create-npm-dirs writes, and copies the addon into its folder;
// like the napi CLI, it refuses an npm folder outside the package of its package.json (K1198), and artifacts requires the addon of
// every configured target, where a file of --config-path overrides the napi field of package.json (K1199).
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
// STUB_PHP_EXTENSION is the extension that the binary registers; without it the binary registers the name that the check asks for.
const registered = process.env.STUB_PHP_EXTENSION;
if (code.includes('get_loaded_extensions')) {
  const binary = args[1] === '-d' && args[2].startsWith('extension=') && fs.existsSync(args[2].slice('extension='.length));
  console.log(['Core', 'standard', ...(binary && registered ? [registered] : [])].join('\\n'));
  process.exit(0);
}
if (args[0] === '-n' && args[1] === '-d' && args[2].startsWith('extension=')) process.exit(fs.existsSync(args[2].slice('extension='.length)) && (!registered || code.includes(JSON.stringify(registered))) ? 0 : 1);
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
// The napi CLI refuses an npm folder outside the package of its package.json, the project that it discovers there (K1198).
if (args[0] !== 'build') {
  const root = fs.realpathSync(path.dirname(option('--package-json-path')));
  const npmDir = path.resolve(option('--npm-dir'));
  // The real path of the nearest folder that exists, followed by the segments that do not exist yet, as napi canonicalizes it.
  let existing = npmDir;
  while (!fs.existsSync(existing)) existing = path.dirname(existing);
  const inside = path.relative(root, path.join(fs.realpathSync(existing), path.relative(existing, npmDir)));
  if (inside.startsWith('..') || path.isAbsolute(inside)) { console.error('Internal Error: Managed package paths must stay within the project or workspace boundary discovered from ' + process.cwd() + ': ' + root + ', ' + npmDir); process.exit(1); }
}
// A configuration file of --config-path overrides the napi field of package.json, as in the napi CLI.
const targets = args.includes('--config-path') ? (JSON.parse(fs.readFileSync(option('--config-path'), 'utf8')).targets ?? manifest.napi.targets) : manifest.napi.targets;
if (args[0] === 'build') {
  fs.mkdirSync(option('--output-dir'), { recursive: true });
  fs.writeFileSync(path.join(option('--output-dir'), addon(platforms[option('--target')][0])), 'stub addon\\n');
} else if (args[0] === 'create-npm-dirs') {
  for (const triple of targets) {
    const [platform, os, cpu] = platforms[triple];
    fs.mkdirSync(path.join(option('--npm-dir'), platform), { recursive: true });
    fs.writeFileSync(path.join(option('--npm-dir'), platform, 'package.json'), JSON.stringify({ name: manifest.name + '-' + platform, version: process.env.STUB_NAPI_VERSION || manifest.version, os: [os], cpu: [cpu], main: addon(platform), files: [addon(platform)] }, null, 2) + '\\n');
  }
} else if (args[0] === 'artifacts') {
  // Like the napi CLI, artifacts requires the addon of every configured target (K1199).
  const missing = targets.filter(triple => !fs.existsSync(path.join(option('--output-dir'), addon(platforms[triple][0]))));
  if (missing.length) { console.error('Internal Error: Missing artifacts for configured targets: ' + missing.join(', ')); process.exit(1); }
  for (const triple of targets) {
    const platform = platforms[triple][0];
    fs.copyFileSync(path.join(option('--output-dir'), addon(platform)), path.join(option('--npm-dir'), platform, addon(platform)));
  }
} else {
  console.error('napi stub: unexpected arguments ' + JSON.stringify(args));
  process.exit(1);
}
`;

// rustc names a sysroot of the stubs and the host stub-host, where llvm-strip of the component llvm-tools lies (K1208).
const RUSTC_STUB = `#!/usr/bin/env node
const path = require('node:path');
const args = process.argv.slice(2);
if (args[0] === '--print' && args[1] === 'sysroot') console.log(path.resolve(__dirname, '../../../.stubs/sysroot'));
else if (args[0] === '--print' && args[1] === 'host-tuple') console.log('stub-host');
else { console.error('rustc stub: unexpected arguments ' + JSON.stringify(args)); process.exit(1); }
`;

const LLVM_STRIP_STUB = `#!/usr/bin/env node
const fs = require('node:fs');
${LOG}
logCall('llvm-strip', process.argv.slice(2));
`;

/** Writes the stubs into the checkout `root`: cargo and php as tools of the checkout (var/tools/bin), napi as the bin link of npm. */
export function writeNativeStubs(root: string): void {
  for (const [file, source] of [['var/tools/bin/cargo', CARGO_STUB], ['var/tools/bin/php', PHP_STUB], ['node_modules/.bin/napi', NAPI_STUB], ['var/tools/bin/rustc', RUSTC_STUB], ['.stubs/sysroot/lib/rustlib/stub-host/bin/llvm-strip', LLVM_STRIP_STUB]] as const) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), source);
    chmodSync(path.join(root, file), 0o755);
  }
}
