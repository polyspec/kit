// Installs the uv environment of a consumer in place of its uv sync (K448-3, `make uv-install DIR=<project> CHECKOUTS="<checkout>..."`).
// Each polyspec package that a checkout provides is installed from the checkout's editable wheel from the start, and no release of it
// is installed, as uv-install of link.mts states; the third-party packages come from uv.lock. Without CHECKOUTS, the sibling checkouts
// of the repository are used. The tracked pyproject.toml and uv.lock are never written.
import path from 'node:path';
import { siblingCheckouts } from './link-providers.mts';
import { uvInstall } from './link.mts';
import { isMain } from './paths.mts';

if (isMain(import.meta.url)) {
  const [directory, ...given] = process.argv.slice(2);
  if (directory === undefined) {
    process.stderr.write('Usage: node scripts/kit/uv-install.mts <dir> [<checkout>...]\n');
    process.exitCode = 2;
  } else {
    const checkouts = given.length ? given.map(checkout => path.resolve(checkout)) : siblingCheckouts(path.resolve(directory)).checkouts;
    try {
      uvInstall({ directory, checkouts, env: process.env, print: text => process.stdout.write(`${text}\n`) });
    } catch (error) {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    }
  }
}
