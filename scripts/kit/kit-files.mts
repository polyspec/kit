// The files of the kit package that runs (K514): the lint configurations that every repository uses are read here, from the
// package that the repository links or installs (node_modules/@polyspec/kit, or the kit checkout beside it), never from a copy
// in the repository. Built, a module runs from dist/ of the package; from source, from scripts/kit/ of the kit checkout.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** The root of the kit package that runs: the folder above dist/ when built, the checkout root when run from its source. */
export const kitPackageRoot = (): string => (path.basename(HERE) === 'dist' ? path.resolve(HERE, '..') : path.resolve(HERE, '../..'));

/** The path of `file` in the kit package that runs, such as its ruff.toml. */
export const kitFile = (file: string): string => path.join(kitPackageRoot(), file);
