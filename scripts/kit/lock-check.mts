#!/usr/bin/env node
// K1005: each lock of the checkout is judged by its own package manager, offline, so a lock that lags its manifest fails before CI
// installs it: npm ci --dry-run for a package-lock.json, composer validate for a composer.lock, uv lock --check for a uv.lock,
// go mod tidy -e -diff for a go.mod and cargo metadata --locked for a Cargo.lock. npm checks no integrity without the tarball, so the
// npm check also names a resolved URL that two package-lock.json files lock with two integrities. Kit judges no version.
//
//   node scripts/kit/lock-check.mts npm|composer|python|go|rust
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { isJsonObject } from './bootstrap/files.mts';
import { isMain, repositoryRoot } from './paths.mts';
import { execute } from './process.mts';
import { checkedFiles } from './tracked-files.mts';

/** The lock file of each ecosystem, the command that judges it in its folder, and the variable that names its tool. */
const CHECKS = {
  npm: { lock: 'package-lock.json', tool: 'NPM', command: 'npm', args: ['ci', '--dry-run', '--offline', '--ignore-scripts', '--no-audit', '--no-fund'] },
  composer: { lock: 'composer.lock', tool: 'COMPOSER_BIN', command: 'composer', args: ['validate', '--no-check-publish', '--no-check-all'] },
  python: { lock: 'uv.lock', tool: 'UV', command: 'uv', args: ['lock', '--check', '--offline'] },
  go: { lock: 'go.mod', tool: 'GO', command: 'go', args: ['mod', 'tidy', '-e', '-diff'] },
  rust: { lock: 'Cargo.lock', tool: 'CARGO', command: 'cargo', args: ['metadata', '--locked', '--offline', '--format-version', '1'] },
} as const;

export type LockEcosystem = keyof typeof CHECKS;

/** The tracked locks of `ecosystem` in `root`, as repository paths; the locks under .mise/ are those of the tools that mise installs, which mise judges. */
export function locksOf(root: string, ecosystem: LockEcosystem): string[] {
  return checkedFiles(root).filter(file => path.posix.basename(file) === CHECKS[ecosystem].lock && !file.startsWith('.mise/')).sort();
}

/** One finding per resolved URL that the package-lock.json files `locks` of `root` lock with more than one integrity. */
export function integrityFindings(root: string, locks: readonly string[]): string[] {
  const seen = new Map<string, Map<string, string[]>>();
  for (const lock of locks) {
    const text: unknown = JSON.parse(readFileSync(path.join(root, lock), 'utf8'));
    const packages = isJsonObject(text) && isJsonObject(text.packages) ? Object.values(text.packages) : [];
    for (const entry of packages) {
      if (!isJsonObject(entry) || typeof entry.resolved !== 'string' || typeof entry.integrity !== 'string') continue;
      const integrities = seen.get(entry.resolved) ?? new Map<string, string[]>();
      integrities.set(entry.integrity, [...(integrities.get(entry.integrity) ?? []), lock]);
      seen.set(entry.resolved, integrities);
    }
  }
  return [...seen].filter(([, integrities]) => integrities.size > 1).map(([resolved, integrities]) =>
    `${resolved} has ${integrities.size} integrities: ${[...integrities].map(([integrity, files]) => `${integrity} in ${[...new Set(files)].join(', ')}`).join('; ')}`);
}

/** The findings of the locks of `ecosystem` in `root`: each lock whose package manager fails it, with its first error line. */
export function lockFindings(root: string, ecosystem: LockEcosystem, env: NodeJS.ProcessEnv = process.env): string[] {
  const check = CHECKS[ecosystem];
  const locks = locksOf(root, ecosystem);
  const command = env[check.tool] ?? check.command;
  // npm 12 installs a URL dependency only where the project allows it, as make install-packages does (K189).
  // go reads only the module cache that go-downloads-fetch fills, with the toolchain that is installed, so the check stays offline.
  const runEnv = ecosystem === 'npm' ? { ...env, npm_config_allow_remote: 'root' }
    : ecosystem === 'go' ? { ...env, GOPROXY: 'off', GOFLAGS: '-mod=mod', GOTOOLCHAIN: 'local' } : env;
  const failures = locks.flatMap((lock) => {
    const result = execute(command, [...check.args], { cwd: path.join(root, path.posix.dirname(lock)), env: runEnv });
    if (!result.error && result.status === 0) return [];
    const output = [result.stderr, result.stdout].join('\n').split('\n').map(line => line.trim());
    // The first line that states the cause: a composer item, a uv or cargo error, or the diff header of go mod tidy; never a heading.
    // Otherwise the first line of the tool, such as a go error that names no error (K1011).
    const stated = output.filter(line => line !== '' && !line.startsWith('#'));
    const cause = result.error?.message ?? stated.find(line => /error|not up to date|^diff /i.test(line)) ?? stated[0] ?? `exit status ${result.status}`;
    return [`${lock}: ${[command, ...check.args].join(' ')} fails: ${cause}`];
  });
  return ecosystem === 'npm' ? [...failures, ...integrityFindings(root, locks)] : failures;
}

/** Whether `name` is an ecosystem of the lock checks. */
const isLockEcosystem = (name: string | undefined): name is LockEcosystem => name !== undefined && Object.hasOwn(CHECKS, name);

if (isMain(import.meta.url)) {
  const [ecosystem, ...extra] = process.argv.slice(2);
  if (!isLockEcosystem(ecosystem) || extra.length) {
    console.error(`Usage: node scripts/kit/lock-check.mts ${Object.keys(CHECKS).join('|')}`);
    process.exit(2);
  }
  const root = repositoryRoot();
  const findings = lockFindings(root, ecosystem);
  for (const finding of findings) console.error(`[lock-check] ${finding}`);
  if (findings.length) {
    console.error(`[lock-check] ${findings.length} ${ecosystem} lock findings; update the lock with its package manager`);
    process.exitCode = 1;
  } else {
    console.log(`[lock-check] every ${ecosystem} lock matches its manifest (${locksOf(root, ecosystem).length} locks)`);
  }
}
