#!/usr/bin/env node
// Installs the cargo-audit release that `cargoAudit` of config/toolchain.json records into var/tools/cargo-audit, for the
// advisories of the Cargo locks in `make dependency-review`. The release is built with `cargo install --locked` into a
// temporary directory beside the target, checked there and renamed, so a reader never sees a partly installed tool. An
// installed recorded release is kept, so a second run changes nothing. Nothing is installed into the machine: the cargo of
// the machine keeps its own binaries. The command prints a line for each step and has no time limit.
//
//   node scripts/kit/install-cargo-audit.mjs
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installOnce } from './install-tool.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** The installation directory of cargo-audit under `root`. */
export const cargoAuditPrefix = (root = ROOT) => path.join(root, 'var', 'tools', 'cargo-audit');

/** The cargo-audit command of the checkout under `root`. */
export const cargoAuditCommand = (root = ROOT) => path.join(cargoAuditPrefix(root), 'bin', 'cargo-audit');

/** The exact cargo-audit release of config/toolchain.json, or an error naming the expected form. */
export function recordedCargoAudit(root = ROOT) {
  const value = JSON.parse(readFileSync(path.join(root, 'config', 'toolchain.json'), 'utf8')).cargoAudit;
  if (!/^\d+\.\d+\.\d+$/.test(value ?? '')) {
    throw new Error(`config/toolchain.json must record cargoAudit as <major>.<minor>.<patch>; it records ${JSON.stringify(value)}`);
  }
  return value;
}

/** The release that the cargo-audit command under `prefix` prints, or undefined when none is installed. */
function installedRelease(prefix) {
  const command = path.join(prefix, 'bin', 'cargo-audit');
  if (!existsSync(command)) return undefined;
  return /^cargo-audit (\S+)$/m.exec(execFileSync(command, ['--version'], { encoding: 'utf8' }))?.[1];
}

/**
 * Installs cargo-audit `recorded` into var/tools/cargo-audit of `root`, unless that release is installed there. Returns
 * `{ installed, release }`; throws with the expected and the actual release when the result is not `recorded`.
 */
export function installCargoAudit({ root = ROOT, recorded = recordedCargoAudit(root), print = () => {} } = {}) {
  return installOnce({
    root, label: 'cargo-audit', prefix: cargoAuditPrefix(root), recorded, installedRelease, print,
    install: (next) => {
      const args = ['install', '--locked', '--root', next, '--target-dir', path.join(next, 'build'), `cargo-audit@${recorded}`];
      const result = spawnSync('cargo', args, { cwd: root, stdio: 'inherit' });
      if (result.error || result.status !== 0) throw new Error(`cargo ${args.join(' ')} ended with ${result.error?.message ?? `exit status ${result.status}`}`);
      rmSync(path.join(next, 'build'), { recursive: true, force: true });
    },
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    installCargoAudit({ print: text => console.log(`[install-cargo-audit] ${text}`) });
  } catch (error) {
    console.error(`[install-cargo-audit] ${error.message}`);
    process.exitCode = 1;
  }
}
