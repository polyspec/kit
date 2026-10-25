// The gates of kit-gates: the make targets of the static checks that land runs for the paths that a change selects (K357-1).
import path from 'node:path';
import { makeDatabase } from './owner-check.mts';

/**
 * The gates of kit-gates in the make database of the Makefile of `root`, which includes the kit.mk of the kit that the repository
 * uses: scripts/kit/kit.mk in kit, the kit.mk of the installed kit in a consumer (K357-1). Throws when the Makefile declares none.
 */
export function kitGates(root: string): Set<string> {
  const gates = makeDatabase(root).targets.get('kit-gates')?.prerequisites;
  if (gates === undefined) throw new Error(`${path.join(root, 'Makefile')} declares no kit-gates; a repository includes the kit.mk of kit, which declares the gates`);
  return new Set(gates);
}
