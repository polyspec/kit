// Whether the arguments of a test runner select tests: a test file, a name filter or a test id. A run without a selection
// runs a whole runtime, which is a suite and runs only in CI (ci-only.mts); run-tests.mts and claude-hook.mts both decide
// with this function, so a command that the hook allows is one that the runner runs.
import { statSync } from 'node:fs';

/** Whether `file` names a regular file; a directory or a missing path selects no test. */
export function isFile(file: string): boolean {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

// The options of each runner that take the next argument as their value, so the value is no positional argument.
const VALUED: Record<string, readonly string[]> = {
  node: ['--test-reporter', '--test-reporter-destination', '--test-concurrency', '--test-timeout', '--import', '--require', '--experimental-loader', '--loader'],
  vitest: ['--config', '-c', '--root', '-r', '--dir', '--reporter', '--project', '--environment', '--pool'],
  go: ['-timeout', '-count', '-p', '-parallel', '-tags', '-coverprofile', '-bench', '-benchtime', '-cpu', '-skip', '-json', '-exec', '-o', '-C'],
  cargo: ['-p', '--package', '--features', '-F', '--manifest-path', '--target', '--target-dir', '--profile', '-j', '--jobs', '--color', '--message-format', '--config', '-Z', '--exclude'],
  phpunit: ['-c', '--configuration', '--bootstrap', '--testsuite', '--group', '--exclude-group', '--log-junit', '--cache-directory', '--coverage-clover', '--colors', '-d'],
  python: ['-s', '--start-directory', '-p', '--pattern', '-t', '--top-level-directory'],
};

// The options that select tests by name or by target, each taking a value.
const FILTERS: Record<string, readonly string[]> = {
  node: ['--test-name-pattern'],
  vitest: ['-t', '--testNamePattern'],
  go: ['-run'],
  cargo: ['--test', '--bench', '--example', '--bin'],
  phpunit: ['--filter'],
  python: ['-k'],
};

/** The positional arguments of `args`: neither an option nor the value of a valued option or a filter. */
function positionals(tool: string, args: readonly string[]): string[] {
  const valued = new Set([...(VALUED[tool] ?? []), ...(FILTERS[tool] ?? [])]);
  const result: string[] = [];
  let value = false;
  for (const arg of args) {
    if (value) value = false;
    else if (arg.startsWith('-')) value = valued.has(arg);
    else result.push(arg);
  }
  return result;
}

/**
 * Whether the arguments `args` of the runner `tool` select tests. `isFileAt(path)` tells whether a path names a file.
 * node and phpunit select by a test file or a name filter; vitest by a file filter or a name filter; go by -run; cargo
 * by a test name filter or a test target; python unittest by a test id or -k. Arguments after `--` of cargo go to the
 * test harness and select nothing.
 */
export function selects(tool: string, args: readonly string[], isFileAt: (file: string) => boolean = isFile): boolean {
  const own = tool === 'cargo' && args.includes('--') ? args.slice(0, args.indexOf('--')) : args;
  const filters = FILTERS[tool] ?? [];
  if (own.some(arg => filters.includes(arg) || filters.some(filter => arg.startsWith(`${filter}=`)))) return true;
  const words = positionals(tool, own);
  switch (tool) {
    case 'node':
    case 'phpunit':
      return words.some(word => isFileAt(word));
    case 'vitest':
      return words.some(word => !['run', 'watch', 'dev', 'related'].includes(word));
    case 'go':
      return false;
    case 'cargo':
      return words.length > 0;
    case 'python':
      return words.some(word => word !== 'discover');
    default:
      return false;
  }
}
