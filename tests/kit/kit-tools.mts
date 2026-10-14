// The tools of kit as the tests run them in a sandbox: from scripts/kit of this checkout, with the sandbox as the working
// directory, as a repository runs them from node_modules/@polyspec/kit/dist. A sandbox holds no copy of the tools, so a
// tool resolves the packages of kit's dependencies from this checkout.
import path from 'node:path';

/** The directory of the tools of kit in this checkout. */
export const KIT = path.resolve(import.meta.dirname, '../../scripts/kit');

/** The path of the tool `name` (scripts/kit/<name>.mts) of this checkout. */
export const tool = (name: string) => path.join(KIT, `${name}.mts`);

/**
 * The arguments of make that run a target of kit.mk with the tools of this checkout. A sandbox has no var/tools, so its
 * recipes start the tools with the node that runs the test as NODE, which kit.mk names by its absolute path (K171).
 */
export const KIT_MAKE = ['-f', path.join(KIT, 'kit.mk'), `KIT=${KIT}`, 'KIT_EXT=mts', `NODE=${process.execPath}`];

/** The Makefile of a sandbox that includes kit.mk with the tools of this checkout, as kit's Makefile does, and NODE as KIT_MAKE sets it. */
export const KIT_MAKEFILE = `KIT := ${KIT}\nKIT_EXT := mts\ninclude ${KIT}/kit.mk\nNODE := ${process.execPath}\n`;
