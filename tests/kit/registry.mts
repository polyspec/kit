// Stub tools for the tests: `npm`, `composer`, `curl` and `go` on PATH, so a test needs no network and starts no real tool.
// The stubs refuse every command that no test needs.
// The commands that read only files of the checkout, go mod edit and composer validate, are answered from the records of
// tests/kit/tool-records.json: what the pinned go and Composer printed for the same arguments and files (K127). A stub never
// runs the real tool, so a vendored test needs neither; a request without a record fails, names itself, and is added to
// STUB_TOOL_MISSES when that names a file, which record-tools.mts reads to write the records.
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { checkoutStubs } from './checkout-stubs.mts';

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
console.error('npm stub: unsupported ' + process.argv.slice(2).join(' '));
process.exit(2);
`;

// Commands such as composer validate read the composer.json and the composer.lock of the working directory: their record answers.
const COMPOSER_STUB = `#!/usr/bin/env node
const { existsSync, readFileSync } = require('node:fs');
${TOOL_ANSWER}
const args = process.argv.slice(2);
const read = file => (existsSync(file) ? readFileSync(file, 'utf8') : null);
answer('composer', args, { 'composer.json': read('composer.json'), 'composer.lock': read('composer.lock') }, args);
`;

const CURL_STUB = `#!/usr/bin/env node
console.error('curl stub: unsupported ' + process.argv.slice(2).join(' '));
process.exit(22);
`;

// go mod edit and go work edit read a file and query nothing: their records answer, as for composer validate. go env
// GOWORK answers by the rule of the go command, which the record of no file can hold: the go.work that GOWORK names, or the
// first go.work of the working directory and its parents.
const GO_STUB = `#!/usr/bin/env node
const { readFileSync } = require('node:fs');
${TOOL_ANSWER}
const args = process.argv.slice(2);
if ((args[0] === 'mod' || args[0] === 'work') && args[1] === 'edit') {
  // go mod edit and go work edit <flags> <file> read the file that they name: the record of their flags and its text answers.
  const file = args[args.length - 1];
  answer('go', args.slice(0, -1), { [args[0] === 'mod' ? 'go.mod' : 'go.work']: readFileSync(file, 'utf8') }, args);
}
if (args[0] === 'env' && args[1] === 'GOWORK' && args.length === 2) {
  const path = require('node:path');
  let found = process.env.GOWORK ?? '';
  for (let dir = process.cwd(); found === ''; dir = path.dirname(dir)) {
    if (require('node:fs').existsSync(path.join(dir, 'go.work'))) found = path.join(dir, 'go.work');
    if (path.dirname(dir) === dir) break;
  }
  console.log(found);
  process.exit(0);
}
console.error('go stub: unsupported ' + args.join(' '));
process.exit(2);
`;

/**
 * A directory with the stub commands on PATH. Returns { env } and removes the directory with `t.after`. With `checkout`, the stubs of npm, composer and go are also the wrappers of that checkout in
 * var/tools/bin, which kit starts before PATH (K393-1); PATH is unchanged.
 */
export function stubRegistries(t: { after: (cleanup: () => void) => unknown }, checkout?: string) {
  const directory = mkdtempSync(path.join(tmpdir(), 'kit-dependency-registry-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const bin = path.join(directory, 'bin');
  mkdirSync(bin);
  for (const [name, source] of [['npm', NPM_STUB], ['composer', COMPOSER_STUB], ['curl', CURL_STUB], ['go', GO_STUB]] as const) {
    writeFileSync(path.join(bin, name), source);
    chmodSync(path.join(bin, name), 0o755);
  }
  if (checkout !== undefined) checkoutStubs(checkout, bin, ['npm', 'composer', 'go']);
  const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, STUB_TOOL_RECORDS: TOOL_RECORDS };
  return { env };
}

// The stubs of a process that a test runs without its own stubs, such as the gate, removed when the process exits.
let processStubs: NodeJS.ProcessEnv | undefined;
const exitCleanups: (() => unknown)[] = [];
let exitHooked = false;
function atProcessExit(cleanup: () => unknown): void {
  if (!exitHooked) {
    exitHooked = true;
    process.on('exit', () => { for (const done of exitCleanups) done(); });
  }
  exitCleanups.push(cleanup);
}

/**
 * The environment of the stubs, made once for this process: the gate runs go mod edit and composer
 * validate, which the stubs answer from the records, so a gate of the fixture runs neither go nor Composer. With `checkout`,
 * the stubs are made for that checkout too (K393-1), and are not cached.
 */
export function toolStubs(checkout?: string): NodeJS.ProcessEnv {
  if (checkout !== undefined) return stubRegistries({ after: atProcessExit }, checkout).env;
  if (processStubs) return processStubs;
  processStubs = stubRegistries({ after: atProcessExit }).env;
  return processStubs;
}
