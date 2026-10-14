#!/usr/bin/env node
// Writes tests/kit/tool-records.json, what the real go and Composer print for the requests that the go and composer stubs
// of registry.mts answer (`make kit-tool-record`). The stubs never run a tool: a request without a record fails and is noted
// in STUB_TOOL_MISSES. This command runs the tests that use the stubs with that variable, runs each noted request with the
// pinned go and Composer of this checkout (`mise which`, make install-tools first), and writes the records; it repeats until
// a run notes no request, since a test stops at its first missing record. The records are written afresh, so a request
// that no test makes any more leaves them. tests/source/tool-records-real.test.mts proves every record against the tools.
//
//   node tests/kit/record-tools.mts
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, realpathSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { TOOL_RECORDS } from './registry.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** A request of a stub: the tool, its arguments without the path of a file, and the files that it reads. */
export type ToolRequest = { tool: 'go' | 'composer'; args: string[]; files: Record<string, string | null> };

/** A record: a request with what the real tool printed and its exit status. */
export type ToolRecord = ToolRequest & { status: number; stdout: string; stderr: string };

// The test files whose stubs answer from the records (the registries of registry.mts, the version stubs of toolchain-stubs.mts).
const TESTS = ['check-toolchain', 'dependency-advisory', 'dependency-cargo', 'dependency-go', 'dependency-policy', 'dependency-review', 'dependency-state', 'python-lock', 'registry', 'release', 'release-consumer', 'release-go-tags', 'release-proof', 'release-wheel']
  .map(name => path.join(ROOT, 'tests/kit', `${name}.test.mts`));

/** The absolute path of the command `command` that mise installed for this checkout; throws while it is not installed. */
export function pinnedTool(command: string): string {
  const found = spawnSync(path.join(ROOT, 'var/tools/bin/mise'), ['which', command], { cwd: ROOT, encoding: 'utf8' });
  if (found.error || found.status !== 0) throw new Error(`mise which ${command} failed: ${found.error?.message ?? found.stderr.trim()}; run make install-tools`);
  return found.stdout.trim();
}

// The directories that hold the stubs of the tests (the temporary directory) and the shims and wrappers of this checkout: a
// shim outside a checkout that pins its tool runs the next command of the same name on PATH, so neither is on the PATH of a
// pinned tool.
const STUB_ROOTS = [...new Set([tmpdir(), realpathSync(tmpdir()), ROOT])];

/** The PATH of the pinned tool `tool`: its own directory, then the PATH of the caller without a directory of STUB_ROOTS. */
function toolPath(tool: string): string {
  const inside = (entry: string) => STUB_ROOTS.some(root => path.resolve(entry) === root || path.resolve(entry).startsWith(root + path.sep));
  return [path.dirname(tool), ...(process.env.PATH ?? '').split(path.delimiter).filter(entry => entry && !inside(entry))].join(path.delimiter);
}

/** What the real tool prints for `request`: its files are written into a directory of their own, in which it runs. */
export function runRequest(request: ToolRequest): ToolRecord {
  const directory = mkdtempSync(path.join(tmpdir(), 'kit-tool-record-'));
  try {
    for (const [file, text] of Object.entries(request.files)) if (text !== null) writeFileSync(path.join(directory, file), text);
    // go mod edit and go work edit name the one file of their request; composer validate reads the files of its working
    // directory, offline and with a home of its own.
    const args = request.tool === 'go' ? [...request.args, ...Object.keys(request.files).map(file => path.join(directory, file))] : request.args;
    const tool = pinnedTool(request.tool);
    const env = { ...process.env, PATH: toolPath(tool), COMPOSER_DISABLE_NETWORK: '1', COMPOSER_HOME: path.join(directory, '.composer-home'), COMPOSER_NO_INTERACTION: '1' };
    const result = spawnSync(tool, args, { cwd: directory, env, encoding: 'utf8' });
    if (result.error) throw new Error(`${request.tool} ${args.join(' ')} could not start: ${result.error.message}`);
    // A path of the temporary directory is no part of a record.
    const local = (text: string) => text.replaceAll(directory, '.');
    return { ...request, status: result.status ?? 1, stdout: local(result.stdout), stderr: local(result.stderr) };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

const key = (request: ToolRequest) => JSON.stringify([request.tool, request.args, request.files]);

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const records: ToolRecord[] = [];
  writeFileSync(TOOL_RECORDS, '{}\n');
  const work = mkdtempSync(path.join(tmpdir(), 'kit-tool-misses-'));
  try {
    for (let round = 1; ; round += 1) {
      const misses = path.join(work, `misses-${round}.jsonl`);
      const run = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...TESTS], { cwd: ROOT, env: { ...process.env, STUB_TOOL_MISSES: misses }, encoding: 'utf8' });
      const requests = existsSync(misses) ? readFileSync(misses, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line) as ToolRequest) : [];
      const fresh = [...new Map(requests.map(request => [key(request), request])).values()].filter(request => !records.some(record => key(record) === key(request)));
      console.log(`[record-tools] run ${round}: ${requests.length} requests without a record, ${fresh.length} new; the tests ended with ${run.status}`);
      if (fresh.length === 0) {
        if (run.status !== 0) throw new Error(`the tests fail with every request recorded:\n${run.stdout.slice(-4000)}`);
        break;
      }
      for (const request of fresh) records.push(runRequest(request));
      records.sort((a, b) => key(a).localeCompare(key(b)));
      const byTool = { composer: records.filter(record => record.tool === 'composer'), go: records.filter(record => record.tool === 'go') };
      writeFileSync(TOOL_RECORDS, `${JSON.stringify(byTool, null, 2)}\n`);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
