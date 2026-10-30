#!/usr/bin/env node
// The first step of the bootstrap of a repository (`make install-tools TOOLS=npm` of kit-bootstrap.mk, before the package
// @polyspec/kit is installed): installs the mise of config/toolchain.json, then with it the Node.js and the npm of mise.toml at
// the digests of mise.lock, with the wrappers node, npm and npx of var/tools/bin. The node of the machine only starts this
// script, whatever its release (K171); every later step, npm ci first, runs the npm of mise. npm installs the packages and mise
// installs the other tools. A repository holds this directory as a copy, so the module imports only Node.js built-ins and the
// modules of its directory. It runs in the root of the repository.
//
//   node scripts/kit/bootstrap/bootstrap.mts
import { installMise, installNode } from './install-mise.mts';
import { declaredToolchain } from './toolchain-declared.mts';

/** Installs the mise, the node and the npm that the checkout at `root` declares; throws an Error that names the cause. */
function bootstrap(root: string, print: (text: string) => void) {
  const declared = declaredToolchain(root);
  if (!declared.mise) throw new Error('config/toolchain.json declares no mise; declare its version and the sha256 of its archive of each platform');
  installMise({ root, declared: declared.mise, print });
  installNode({ root, print });
}

try {
  bootstrap(process.cwd(), text => console.log(`[bootstrap] ${text}`));
} catch (error) {
  if (!(error instanceof Error)) throw error;
  // declaredToolchain, the checks above and the installs fail with an Error.
  console.error(`[bootstrap] ${error.message}`);
  process.exit(1);
}
