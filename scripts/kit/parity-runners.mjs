// The runners of the language-parity check: the native command that runs the test of a binding, and the cases that its output
// reports. go runs `go test -json` in the module of the test with the binding symbol as the test function, and a case is a
// direct subtest `<symbol>/<case>`. cargo runs the exact test path of the symbol in the crate of the test (`--test <name>`
// for tests/<name>.rs, else `--lib`), and node, php and python (var/tools/bin/python3) run the test file; these four read the
// harness lines `PASS <unit>/<case>` and `FAIL <unit>/<case>` that the shared test harness of each language prints.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { toolsPath } from './tool-wrappers.mjs';

/** The directory of the nearest `marker` file above `file` (repository-relative), or undefined when the repository has none. */
function nearest(root, file, marker) {
  for (let directory = path.posix.dirname(file); ; directory = path.posix.dirname(directory)) {
    if (existsSync(path.join(root, directory, marker))) return directory;
    if (directory === '.') return undefined;
  }
}

/** The outcome of each case that the harness lines of `output` report for `unit`, in the order of the output; a FAIL wins. */
function harnessCases(output, unit) {
  const cases = new Map();
  for (const line of output.split('\n')) {
    const match = /^(PASS|FAIL) (\S+)/.exec(line.trim());
    if (!match || !match[2].startsWith(`${unit}/`)) continue;
    const name = match[2].slice(unit.length + 1);
    if (cases.get(name) !== 'fail') cases.set(name, match[1] === 'PASS' ? 'pass' : 'fail');
  }
  return cases;
}

/** The outcome of each direct subtest of `symbol` in the events of `go test -json`. */
function goCases(output, symbol) {
  const cases = new Map();
  for (const line of output.split('\n')) {
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    const name = typeof event.Test === 'string' && event.Test.startsWith(`${symbol}/`) ? event.Test.slice(symbol.length + 1) : '';
    if (name && !name.includes('/') && ['pass', 'fail', 'skip'].includes(event.Action)) cases.set(name, event.Action);
  }
  return cases;
}

const RUNNERS = {
  go(root, binding) {
    const module = nearest(root, binding.test, 'go.mod');
    if (module === undefined) return { error: `no go.mod lies above ${binding.test}` };
    const directory = path.posix.relative(module, path.posix.dirname(binding.test));
    return { command: 'go', args: ['test', '-json', '-count=1', '-run', `^${binding.symbol}$`, `./${directory}`], cwd: module, cases: output => goCases(output, binding.symbol) };
  },
  cargo(root, binding, unit) {
    const crate = nearest(root, binding.test, 'Cargo.toml');
    if (crate === undefined) return { error: `no Cargo.toml lies above ${binding.test}` };
    const relative = path.posix.relative(crate, binding.test);
    const target = /^tests\/[^/]+\.rs$/.test(relative) ? ['--test', path.posix.basename(relative, '.rs')] : ['--lib'];
    return { command: 'cargo', args: ['test', '--manifest-path', path.posix.join(crate, 'Cargo.toml'), ...target, '--', '--exact', binding.symbol, '--nocapture', '--test-threads=1'], cwd: '.', cases: output => harnessCases(output, unit) };
  },
  node: (root, binding, unit) => ({ command: process.execPath, args: [binding.test], cwd: '.', cases: output => harnessCases(output, unit) }),
  php: (root, binding, unit) => ({ command: 'php', args: [binding.test], cwd: '.', cases: output => harnessCases(output, unit) }),
  python: (root, binding, unit) => ({ command: toolsPath(root, 'bin', 'python3'), args: [binding.test], cwd: '.', cases: output => harnessCases(output, unit) }),
};

/**
 * The run of the binding `binding` of the unit `unit` (its id) by the runner `runner`: `{ command, args, cwd, cases }` with
 * `cwd` relative to `root` and `cases(output)` the outcome of each case that the output reports, or `{ error }`.
 */
export const runOf = (runner, root, binding, unit) => RUNNERS[runner](root, binding, unit);
