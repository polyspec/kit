// R7 of the language-parity check: every implementation of the profile of `errors` has the codes of the catalog, read from the
// generated artifact that each implementation declares, no code more and no code less.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { captured, difference, finding } from './parity-declaration.mjs';

/** The codes of the file `file` of `root`: the first group of each match of `pattern`. */
const codesOf = (root, { file, pattern }) => new Set(captured(readFileSync(path.join(root, file), 'utf8'), pattern).map(match => match.text));

/** R7: the codes of each implementation of the profile against the catalog. */
export function errorCatalog(model, root) {
  const errors = model.config.errors;
  if (!errors) return [];
  const catalog = codesOf(root, errors.catalog);
  return model.profiles.get(errors.profile).map(name => model.implementations.get(name)).flatMap((implementation) => {
    if (!implementation.errors) return [finding('R7', `${implementation.name} declares no error codes; name its generated codes in errors of the implementation`, { implementation: implementation.name, place: errors.catalog.file })];
    const differs = difference([...catalog], [...codesOf(root, implementation.errors)], 'the catalog');
    return differs ? [finding('R7', `the codes differ from ${errors.catalog.file}: ${differs}`, { implementation: implementation.name, place: implementation.errors.file })] : [];
  });
}
