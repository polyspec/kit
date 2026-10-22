// Installs the uv environment of a consumer in place of its uv sync (K448-3, `make uv-install DIR=<project> CHECKOUTS="<checkout>..."`).
// Each polyspec package that a checkout provides is installed from the checkout's editable wheel from the start, and no release of it
// is installed, as uv-install of link.mts states; the third-party packages come from uv.lock. Without CHECKOUTS, the sibling checkouts
// of the repository are used. The tracked pyproject.toml and uv.lock are never written.
import path from 'node:path';
import { siblingCheckouts } from './link-providers.mts';
import { uvInstall } from './link.mts';
import { isMain } from './paths.mts';

/** Runs the install of the arguments `[directory, ...checkouts]`, printing to `write`; returns the exit code. */
export function uvInstallCommand(args: readonly string[], env: NodeJS.ProcessEnv, write: (text: string) => void): number {
  const [directory, ...given] = args;
  if (directory === undefined) {
    write('Usage: node scripts/kit/uv-install.mts <dir> [<checkout>...]\n');
    return 2;
  }
  const checkouts = given.length ? given.map(checkout => path.resolve(checkout)) : siblingCheckouts(path.resolve(directory)).checkouts;
  try {
    // UV_SYNC carries the sync flags of make uv-install SYNC (K487); each is checked by uvInstall.
    const sync = (env.UV_SYNC ?? '').split(/\s+/).filter(flag => flag !== '');
    // UV_STATE carries the link state folder of make uv-install STATE (K488); empty means the default of the consumer.
    const state = env.UV_STATE === undefined || env.UV_STATE === '' ? undefined : env.UV_STATE;
    uvInstall({ directory, checkouts, sync, state, env, print: text => write(`${text}\n`) });
    return 0;
  } catch (error) {
    write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

if (isMain(import.meta.url)) {
  process.exitCode = uvInstallCommand(process.argv.slice(2), process.env, text => process.stdout.write(text));
}
