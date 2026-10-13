// Stub registries for the tests of the dependency tools: `npm`, `composer`, `curl` and `go` on PATH answer from a JSON file
// (`registry.json` of the directory), so a test or the record of a fixture needs no network. The stubs log their calls.
// The commands that read only files of the checkout, go mod edit and composer validate, are answered from the records of
// tests/kit/tool-records.json: what the pinned go and Composer printed for the same arguments and files (K127). A stub never
// runs the real tool, so a vendored test needs neither; a request without a record fails, names itself, and is added to
// STUB_TOOL_MISSES when that names a file, which record-tools.mts reads to write the records.
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** The records of the real go and Composer that the go and composer stubs answer from. */
export const TOOL_RECORDS = path.join(import.meta.dirname, 'tool-records.json');

/** The answer of a stub from the records of the real tools: a function `answer(tool, args, files, shown)` of the stub's script. */
export const TOOL_ANSWER = `// The record of the real tool for these arguments and files: its output and status, else a failure that names the request.
const answer = (tool, args, files, shown) => {
  const records = JSON.parse(require('node:fs').readFileSync(process.env.STUB_TOOL_RECORDS, 'utf8'))[tool] ?? [];
  const found = records.find(record => JSON.stringify(record.args) === JSON.stringify(args) && JSON.stringify(record.files) === JSON.stringify(files));
  if (!found) {
    if (process.env.STUB_TOOL_MISSES) require('node:fs').appendFileSync(process.env.STUB_TOOL_MISSES, JSON.stringify({ tool, args, files }) + '\\n');
    console.error(tool + ' stub: no record for ' + tool + ' ' + shown.join(' '));
    process.exit(1);
  }
  process.stdout.write(found.stdout);
  process.stderr.write(found.stderr);
  process.exit(found.status);
};
`;

const NPM_STUB = `#!/usr/bin/env node
const { appendFileSync, readFileSync } = require('node:fs');
const args = process.argv.slice(2);
appendFileSync(process.env.STUB_LOG, 'npm ' + args.join(' ') + '\\n');
const registry = JSON.parse(readFileSync(process.env.STUB_REGISTRY, 'utf8'));
if (args[0] === 'view' && args[2] === 'deprecated') {
  // npm view <name>@<version> deprecated prints the deprecation message, or nothing for a release in good standing.
  console.log((registry.deprecated ?? {})[args[1]] ?? '');
} else if (args[0] === 'view') {
  const versions = registry.npm[args[1]];
  if (!versions) { console.error('404 ' + args[1]); process.exit(1); }
  console.log(JSON.stringify([{ 'dist-tags': { latest: versions[versions.length - 1] }, versions }]));
} else if (args[0] === 'audit' && registry.npmAuditText !== undefined) {
  process.stdout.write(registry.npmAuditText);
} else if (args[0] === 'audit') {
  console.log(JSON.stringify(registry.npmAudit ?? { vulnerabilities: {} }));
  process.exit(Object.keys(registry.npmAudit?.vulnerabilities ?? {}).length ? 1 : 0);
} else if (args[0] === 'outdated') {
  const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
  const out = {};
  for (const [name, versions] of Object.entries(registry.npm)) {
    const current = lock.packages['node_modules/' + name]?.version;
    const latest = versions[versions.length - 1];
    if (current && current !== latest) out[name] = { current, wanted: current, latest };
  }
  console.log(JSON.stringify(out));
  process.exit(Object.keys(out).length ? 1 : 0);
} else {
  console.error('npm stub: unsupported ' + args.join(' '));
  process.exit(2);
}
`;

const COMPOSER_STUB = `#!/usr/bin/env node
const { appendFileSync, readFileSync } = require('node:fs');
${TOOL_ANSWER}
const path = require('node:path');
const args = process.argv.slice(2);
const directory = path.basename(process.cwd());
appendFileSync(process.env.STUB_LOG, 'composer ' + args.join(' ') + '\\n');
const registry = JSON.parse(readFileSync(process.env.STUB_REGISTRY, 'utf8'));
if (args[0] === 'outdated') {
  const manifest = JSON.parse(readFileSync('composer.json', 'utf8'));
  const lock = JSON.parse(readFileSync('composer.lock', 'utf8'));
  const locked = new Map([...lock.packages, ...(lock['packages-dev'] ?? [])].map(item => [item.name, item.version]));
  const list = [];
  for (const name of Object.keys({ ...manifest.require, ...(manifest['require-dev'] ?? {}) })) {
    if (!locked.has(name)) continue;
    const latest = registry.composer[directory]?.[name] ?? locked.get(name);
    // composer outdated reports up-to-date when the latest release is the locked one (ShowCommand::getUpdateStatus).
    list.push({ name, version: locked.get(name), latest, 'latest-status': latest === locked.get(name) ? 'up-to-date' : 'update-possible' });
  }
  console.log(JSON.stringify({ locked: list }));
} else if (args[0] === 'audit') {
  const report = registry.composerAudit?.[directory] ?? { advisories: [], abandoned: [] };
  console.log(JSON.stringify(report));
  process.exit(Array.isArray(report.advisories) ? 0 : 1);
} else {
  // Other commands (validate) read the composer.json and the composer.lock of the working directory: their record answers.
  const read = file => (require('node:fs').existsSync(file) ? readFileSync(file, 'utf8') : null);
  answer('composer', args, { 'composer.json': read('composer.json'), 'composer.lock': read('composer.lock') }, args);
}
`;

const CURL_STUB = `#!/usr/bin/env node
const { appendFileSync, readFileSync } = require('node:fs');
const url = process.argv.slice(2).at(-1);
appendFileSync(process.env.STUB_LOG, 'curl ' + process.argv.slice(2).join(' ') + '\\n');
const registry = JSON.parse(readFileSync(process.env.STUB_REGISTRY, 'utf8'));
const match = /^https:\\/\\/pypi\\.org\\/pypi\\/([^/]+)(?:\\/([^/]+))?\\/json$/.exec(url);
const [, name, version] = match ?? [];
const releases = registry.pypi?.[name];
if (!releases || (version !== undefined && !releases[version])) { console.error('404 ' + url); process.exit(22); }
if (version === undefined) console.log(JSON.stringify({ info: { version: Object.keys(releases).at(-1) }, releases }));
else console.log(JSON.stringify({ info: { version }, vulnerabilities: registry.pypiVulnerabilities?.[name]?.[version] ?? [] }));
`;

// go mod edit reads a go.mod and queries nothing: its record answers, unlogged, as for composer validate.
const GO_STUB = `#!/usr/bin/env node
const { appendFileSync, readFileSync } = require('node:fs');
${TOOL_ANSWER}
const args = process.argv.slice(2);
if (args[0] === 'mod' && args[1] === 'edit') {
  // go mod edit <flags> <go.mod> reads the go.mod that it names: the record of its flags and its text answers.
  answer('go', args.slice(0, -1), { 'go.mod': readFileSync(args[args.length - 1], 'utf8') }, args);
}
appendFileSync(process.env.STUB_LOG, 'go ' + args.join(' ') + '\\n');
const registry = JSON.parse(readFileSync(process.env.STUB_REGISTRY, 'utf8'));
if (args[0] === 'list' && args[1] === '-m' && args[2] === '-versions') {
  const module = args[args.length - 1];
  const versions = registry.go?.[module];
  if (!versions) { console.error('go: module ' + module + ' not found'); process.exit(1); }
  console.log(JSON.stringify({ Path: module, Versions: versions }));
} else if (args[0] === 'list' && args[1] === '-e') {
  // go list -e -f <format> <pattern>...: every pattern names a buildable package, printed as the pattern.
  console.log(args.slice(4).join('\\n'));
} else {
  console.error('go stub: unsupported ' + args.join(' '));
  process.exit(2);
}
`;

/**
 * A directory with the stub commands on PATH and a registry file. Returns { env, calls, registry(data) } and removes
 * the directory with `t.after`.
 */
export function stubRegistries(t: { after: (cleanup: () => void) => unknown }) {
  const directory = mkdtempSync(path.join(tmpdir(), 'kit-dependency-registry-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const bin = path.join(directory, 'bin');
  mkdirSync(bin);
  for (const [name, source] of [['npm', NPM_STUB], ['composer', COMPOSER_STUB], ['curl', CURL_STUB], ['go', GO_STUB]] as const) {
    writeFileSync(path.join(bin, name), source);
    chmodSync(path.join(bin, name), 0o755);
  }
  const log = path.join(directory, 'calls.log');
  writeFileSync(log, '');
  const registryFile = path.join(directory, 'registry.json');
  writeFileSync(registryFile, JSON.stringify({ npm: {}, composer: {}, pypi: {} }));
  const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, STUB_LOG: log, STUB_REGISTRY: registryFile, STUB_TOOL_RECORDS: TOOL_RECORDS };
  return {
    env,
    calls: () => readFileSync(log, 'utf8').split('\n').filter(Boolean),
    registry: (data: unknown) => writeFileSync(registryFile, JSON.stringify(data)),
  };
}

// The stubs of a process that a test runs without its own registries, such as the gate: an empty registry, removed when the
// process exits.
let processStubs: NodeJS.ProcessEnv | undefined;

/**
 * The environment of the stubs with an empty registry, made once for this process: the gate runs go mod edit and composer
 * validate, which the stubs answer from the records, so a gate of the fixture runs neither go nor Composer.
 */
export function toolStubs(): NodeJS.ProcessEnv {
  if (processStubs) return processStubs;
  const cleanups: (() => unknown)[] = [];
  process.on('exit', () => { for (const cleanup of cleanups) cleanup(); });
  processStubs = stubRegistries({ after: cleanup => cleanups.push(cleanup) }).env;
  return processStubs;
}

/** What the stub registries answer for the fixture of tests/kit/fixture: every dependency is at its latest stable release. */
export const FIXTURE_REGISTRY = {
  npm: { 'is-number': ['7.0.0'], semver: ['7.6.0'] },
  composer: { 'fixture-php': { 'psr/log': '3.0.2' } },
  composerAudit: { 'fixture-php': { advisories: [], abandoned: [] } },
  pypi: { setuptools: { '84.0.0': [{}] }, ruff: { '0.16.10': [{}] }, click: { '8.1.7': [{}] } },
  go: { 'github.com/google/uuid': ['v1.5.0', 'v1.6.0'] },
};
