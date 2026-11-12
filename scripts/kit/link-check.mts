#!/usr/bin/env node
// Compares the links of a checkout with its link declaration (`make link-check`, K869, P30): LINKS_FILE at the root of the
// checkout itself (K1118) names the provider checkouts, and make link applies it. The comparison:
//   - each installed npm, Composer and Python folder of a package that a declared checkout provides is a link to its provider, never
//     a copy (link's check, folderFindings), and a polyspec package that a linked npm provider loads is a link in it too (K761);
//   - no install folder holds a link out of the checkout that the declaration does not name; with no file, none holds one;
//   - the go.work that link writes at each Go module uses exactly the module, its tracked workspace and the declared providers that it
//     requires; with none, link wrote no go.work;
//   - a polyspec package that a tracked project declares and a declared checkout provides has an installed folder (K888);
//   - the autoload that Composer records for a linked package is its provider's (K1181), which its release, not make link, changes.
// make link fixes the findings of link's check; each finding beside it names its own fix, and the closing line says which (K1183).
// What a manifest names, a path or a version, and whether Git ignores the declaration are the repository's own and are not judged (K1108). A finding names the ecosystem and the package or the file.
//
//   node link-check.mts [--project <dir>]
import { autoloadRecordFindings, declaredUnlinked, link } from './link.mts';
import { declaredCheckouts, LINKS_FILE, providers, workTreeOf } from './link-providers.mts';
import { isMain } from './paths.mts';

/**
 * The findings of `root` beside link's check, sorted: the declared packages with no installed folder (K888), of the manifests that link
 * judges in `directory`, with `project` those of that project (K975). link writes no Claude Code settings, so the check judges none (K960).
 */
export function linkFindings(root: string, env: NodeJS.ProcessEnv = process.env, directory = root, project = false): string[] {
  const checkouts = declaredCheckouts(root);
  const provided = providers(checkouts ?? [], undefined, root, root);
  // Whether Git ignores the declaration is the repository's own .gitignore, which kit does not judge (K1108).
  return [...declaredUnlinked(directory, provided, env, project), ...autoloadRecordFindings(directory, provided, env, project)].sort();
}

/**
 * The link check of the checkout of `directory`, or with `project` of the consumer `directory`: link's check, then linkFindings, of the
 * whole checkout, or with `project` of that project alone (K975).
 */
export function linkCheck(directory: string, project: boolean, print: (text: string) => void, env: NodeJS.ProcessEnv = process.env): { ok: boolean; linkFixes: boolean } {
  // With no declaration, make link links nothing and leaves the release state (K869), which the check compares: no own link (K935).
  const checkouts = declaredCheckouts(directory);
  const linked = link({ checkouts: checkouts ?? [], directories: [directory], check: true, print, env, project, own: checkouts !== undefined });
  const root = workTreeOf(directory);
  const findings = linkFindings(root, env, project ? directory : root, project);
  for (const finding of findings) print(`[link-check] ${finding}`);
  // K1183: make link fixes the findings of link's check; each finding beside it names a fix of its own.
  return { ok: linked && findings.length === 0, linkFixes: !linked };
}

/** K1183: the closing line of a failed check, naming make link only when a finding of link's check is there to fix. */
export function closingLine({ linkFixes }: { linkFixes: boolean }): string {
  return linkFixes
    ? `[link-check] the links differ from the link declaration (${LINKS_FILE}). Fix: make link`
    : '[link-check] the links are the link declaration, but a finding remains. Fix: the fix that each [link-check] line above names';
}

if (isMain(import.meta.url)) {
  const args = process.argv.slice(2);
  const project = args[0] === '--project' ? args[1] : undefined;
  if (args.length !== (project === undefined ? 0 : 2)) {
    console.error('Usage: node link-check.mts [--project <dir>]');
    process.exitCode = 2;
  } else {
    const result = linkCheck(project ?? '.', project !== undefined, text => console.log(text));
    if (result.ok) console.log(`[link-check] the links are the link declaration (${LINKS_FILE})`);
    else {
      console.error(closingLine(result));
      process.exitCode = 1;
    }
  }
}
