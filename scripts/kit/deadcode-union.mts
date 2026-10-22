#!/usr/bin/env node
// The deadcode of a Go module over the union of its build tags (K536), which lint-go runs in the folder of the module:
//   node scripts/kit/deadcode-union.mts <deadcode> <go> [<tag>...]
// deadcode -test runs untagged and once per tag, and go list names the Go files that each run compiles. A function is unreachable
// when every run that compiles its file reports it, so a function that the files of one tag reach is live in the other runs; a run
// compiles the files that go list names and the files that it reports. The findings are printed with every line of deadcode that is
// no finding, such as an error; lint-go fails the step on any output, since deadcode exits 0 when it reports.
import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { isMain } from './paths.mts';

/** One run of deadcode: the Go files that it compiles, absolute and resolved, and the lines that it printed. */
export type DeadcodeRun = { compiled: ReadonlySet<string>; lines: readonly string[] };

// A finding of deadcode, with the path of its file relative to the folder of the run.
const FINDING = /^(.+?\.go):\d+:\d+: unreachable func: /;

// The Go files of each package that go list names: its folder, then each file, separated by tabs.
const FILES = '{{.Dir}}{{range .GoFiles}}{{"\\t"}}{{.}}{{end}}{{range .CgoFiles}}{{"\\t"}}{{.}}{{end}}{{range .TestGoFiles}}{{"\\t"}}{{.}}{{end}}{{range .XTestGoFiles}}{{"\\t"}}{{.}}{{end}}';

/**
 * The lines of `runs` that stand, sorted (K536): a finding that every run compiling its file reports, and every line that is no
 * finding. `folder` is the resolved folder of the runs, to which the paths of the findings are relative.
 */
export function unionFindings(runs: readonly DeadcodeRun[], folder: string): string[] {
  const fileOf = (line: string): string | undefined => {
    const file = FINDING.exec(line)?.[1];
    return file === undefined ? undefined : path.resolve(folder, file);
  };
  const compiles = runs.map(run => new Set([...run.compiled, ...run.lines.flatMap(line => fileOf(line) ?? [])]));
  const standing = new Set<string>();
  for (const line of runs.flatMap(run => run.lines)) {
    const file = fileOf(line);
    if (file === undefined || runs.every((run, index) => !compiles[index]?.has(file) || run.lines.includes(line))) standing.add(line);
  }
  return [...standing].sort();
}

/** Runs `command` with `args` in the current folder and returns its standard output; a failure throws with its output. */
function output(command: string, args: string[]): string {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (result.error) throw new Error(`${command} could not start: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${path.basename(command)} ${args.join(' ')} exited ${result.status === null ? `with the signal ${result.signal}` : result.status}: ${`${result.stdout}${result.stderr}`.trim()}`);
  return `${result.stdout}${result.stderr}`;
}

/** The run of deadcode with the build tag `tag`, or untagged: its lines and the files that go list names for it. */
function deadcodeRun(deadcode: string, go: string, tag: string | undefined): DeadcodeRun {
  const flags = tag === undefined ? [] : [`-tags=${tag}`];
  const lines = output(deadcode, ['-test', ...flags, './...']).split('\n').filter(line => line !== '');
  const compiled = output(go, ['list', ...flags, '-f', FILES, './...']).split('\n').filter(line => line !== '').flatMap((line) => {
    const [dir = '', ...files] = line.split('\t');
    const resolved = realpathSync(dir);
    return files.map(file => path.join(resolved, file));
  });
  return { compiled: new Set(compiled), lines };
}

if (isMain(import.meta.url)) {
  const [deadcode, go, ...tags] = process.argv.slice(2);
  if (deadcode === undefined || go === undefined) throw new Error('Usage: deadcode-union.mjs <deadcode> <go> [<tag>...]');
  const runs = [undefined, ...tags].map(tag => deadcodeRun(deadcode, go, tag));
  for (const line of unionFindings(runs, realpathSync(process.cwd()))) console.log(line);
}
