// Helpers of the tests: a copy of tests/kit/fixture as a Git repository of a temporary directory, in which
// the tools of kit run (kit-tools.mts) and read that checkout, and the shims of cargo-audit and govulncheck that the
// toolchain check runs.
import type { TestContext } from 'node:test';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { removeSandbox } from './sandbox-cleanup.mts';
import { initRepository } from './sandbox-repository.mts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(HERE, 'fixture');

// K491: the copy of the fixture has no mise.lock of the checkout, so MISE_LOCKED of make refuses its tools (ruff, python); the variable
// leaves the environment of the tests. The mise settings of the checkout stay, since its own composer shim needs them.
delete process.env.MISE_LOCKED;

/** A copy of the fixture, removed with `t.after`. */
export function fixtureCheckout(t: Pick<TestContext, 'after'>) {
  const directory = mkdtempSync(path.join(tmpdir(), 'kit-dependency-checkout-'));
  t.after(() => removeSandbox(directory));
  cpSync(FIXTURE, directory, { recursive: true });
  // The tools list the files of a checkout through Git, so the copy is a repository.
  initRepository(directory);
  return directory;
}

/** The JSON report of `cargo audit --json`, as far as the stub reads it. */
export type CargoAuditReport = { vulnerabilities: { found: boolean; count: number; list: unknown[] }; warnings: Record<string, unknown> };

/**
 * Installs a stub of cargo-audit as the shim of mise of `root`, var/tools/mise/shims/cargo-audit: it prints `cargo-audit 0.22.2` for --version and
 * the JSON `report` for an audit, and exits 1 when the report lists a vulnerability, as cargo-audit does.
 */
export function installCargoAuditStub(root: string, report: CargoAuditReport = { vulnerabilities: { found: false, count: 0, list: [] }, warnings: {} }) {
  const bin = path.join(root, 'var/tools/mise/shims');
  mkdirSync(bin, { recursive: true });
  const file = path.join(bin, 'cargo-audit');
  writeFileSync(file, `#!/usr/bin/env node
const report = ${JSON.stringify(report)};
if (process.argv.includes('--version')) console.log('cargo-audit 0.22.2');
else { console.log(JSON.stringify(report)); process.exit(report.vulnerabilities.found ? 1 : 0); }
`);
  chmodSync(file, 0o755);
}

/**
 * Installs a stub of govulncheck as the shim of mise of `root`, var/tools/mise/shims/govulncheck: it prints
 * `Scanner: govulncheck@v1.1.4` for -version and the SARIF `report` for a scan, and exits 0 as govulncheck -format sarif does.
 */
export function installGovulncheckStub(root: string, report: unknown = { version: '2.1.0', runs: [{ tool: { driver: { name: 'govulncheck', rules: [] } }, results: [] }] }) {
  const bin = path.join(root, 'var/tools/mise/shims');
  mkdirSync(bin, { recursive: true });
  const file = path.join(bin, 'govulncheck');
  writeFileSync(file, `#!/usr/bin/env node
const report = ${JSON.stringify(report)};
if (process.argv.includes('-version')) console.log('Go: go1.27.0\\nScanner: govulncheck@v1.1.4\\nDB: https://vuln.go.dev');
else console.log(JSON.stringify(report, null, 2));
`);
  chmodSync(file, 0o755);
}
