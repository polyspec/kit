#!/usr/bin/env node
// Installs the govulncheck release that `govulncheck` of config/toolchain.json records into var/tools/govulncheck, for the
// advisories of the Go modules in `make dependency-review`. The release is built with `go install` of var/tools/bin/go, the
// Go of the kit pin, into a temporary
// directory beside the target and renamed, and an installed recorded release is kept. Nothing is installed into the
// machine. The command prints a line for each step and has no time limit.
//
//   node scripts/kit/install-govulncheck.mts
import path from 'node:path';
import { installOnce } from './bootstrap/install-tool.mts';
import { isMain, ROOT } from './paths.mts';
import { printedRelease, run, toolsPath } from './bootstrap/tool-wrappers.mts';
import { recordedRelease } from './bootstrap/toolchain-declared.mts';
import { pinnedGo } from './install-go.mts';

/** The installation directory of govulncheck under `root`. */
export const govulncheckPrefix = (root: string = ROOT): string => toolsPath(root, 'govulncheck');

const commandIn = (prefix: string): string => path.join(prefix, 'bin', 'govulncheck');

/** The govulncheck command of the checkout under `root`. */
export const govulncheckCommand = (root: string = ROOT): string => commandIn(govulncheckPrefix(root));

/**
 * Installs govulncheck `recorded` into var/tools/govulncheck of `root`, unless that release is installed there. Returns
 * `{ installed, release }`; throws with the expected and the actual release when the result is not `recorded`.
 */
export function installGovulncheck({ root = ROOT, recorded = recordedRelease(root, 'govulncheck'), print = () => {} }: { root?: string; recorded?: string; print?: (text: string) => void } = {}) {
  return installOnce({
    root, label: 'govulncheck', prefix: govulncheckPrefix(root), recorded, print,
    installedRelease: (prefix: string) => printedRelease(commandIn(prefix), 'govulncheck'),
    install: (next: string) => {
      run(pinnedGo(root, 'govulncheck'), ['install', `golang.org/x/vuln/cmd/govulncheck@v${recorded}`], { cwd: root, env: { ...process.env, GOBIN: path.join(next, 'bin'), GOFLAGS: '-modcacherw' } }, print);
    },
  });
}

if (isMain(import.meta.url)) {
  try {
    installGovulncheck({ print: (text: string) => console.log(`[install-govulncheck] ${text}`) });
  } catch (error) {
    console.error(`[install-govulncheck] ${(error as Error).message}`);
    process.exitCode = 1;
  }
}
