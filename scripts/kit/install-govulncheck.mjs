#!/usr/bin/env node
// Installs the govulncheck release that `govulncheck` of config/toolchain.json records into var/tools/govulncheck, for the
// advisories of the Go modules in `make dependency-review`. The release is built with `go install` into a temporary
// directory beside the target and renamed, and an installed recorded release is kept. Nothing is installed into the
// machine. The command prints a line for each step and has no time limit.
//
//   node scripts/kit/install-govulncheck.mjs
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installOnce } from './install-tool.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** The installation directory of govulncheck under `root`. */
export const govulncheckPrefix = (root = ROOT) => path.join(root, 'var', 'tools', 'govulncheck');

/** The govulncheck command of the checkout under `root`. */
export const govulncheckCommand = (root = ROOT) => path.join(govulncheckPrefix(root), 'bin', 'govulncheck');

/** The exact govulncheck release of config/toolchain.json, or an error naming the expected form. */
export function recordedGovulncheck(root = ROOT) {
  const value = JSON.parse(readFileSync(path.join(root, 'config', 'toolchain.json'), 'utf8')).govulncheck;
  if (!/^\d+\.\d+\.\d+$/.test(value ?? '')) {
    throw new Error(`config/toolchain.json must record govulncheck as <major>.<minor>.<patch>; it records ${JSON.stringify(value)}`);
  }
  return value;
}

/** The release that the govulncheck command under `prefix` prints, or undefined when none is installed. */
function installedRelease(prefix) {
  const command = path.join(prefix, 'bin', 'govulncheck');
  if (!existsSync(command)) return undefined;
  return /^Scanner: govulncheck@v(\S+)$/m.exec(execFileSync(command, ['-version'], { encoding: 'utf8' }))?.[1];
}

/**
 * Installs govulncheck `recorded` into var/tools/govulncheck of `root`, unless that release is installed there. Returns
 * `{ installed, release }`; throws with the expected and the actual release when the result is not `recorded`.
 */
export function installGovulncheck({ root = ROOT, recorded = recordedGovulncheck(root), print = () => {} } = {}) {
  return installOnce({
    root, label: 'govulncheck', prefix: govulncheckPrefix(root), recorded, installedRelease, print,
    install: (next) => {
      const args = ['install', `golang.org/x/vuln/cmd/govulncheck@v${recorded}`];
      const result = spawnSync('go', args, { cwd: root, stdio: 'inherit', env: { ...process.env, GOBIN: path.join(next, 'bin'), GOFLAGS: '-modcacherw' } });
      if (result.error || result.status !== 0) throw new Error(`go ${args.join(' ')} ended with ${result.error?.message ?? `exit status ${result.status}`}`);
    },
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    installGovulncheck({ print: text => console.log(`[install-govulncheck] ${text}`) });
  } catch (error) {
    console.error(`[install-govulncheck] ${error.message}`);
    process.exitCode = 1;
  }
}
