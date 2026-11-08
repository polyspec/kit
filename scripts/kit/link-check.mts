#!/usr/bin/env node
// Compares the links of a checkout with its link declaration (`make link-check`, K869, P30): LINKS_FILE at the root of the
// checkout itself (K1118) names the provider checkouts, and make link applies it. The comparison:
//   - each installed npm, Composer and Python folder of a package that a declared checkout provides is a link to its provider, never
//     a copy (link's check, folderFindings), and a polyspec package that a linked npm provider loads is a link in it too (K761);
//   - no install folder holds a link out of the checkout that the declaration does not name; with no file, none holds one;
//   - the go.work that link writes at each Go module uses exactly the module, its tracked workspace and the declared providers that it
//     requires; with none, link wrote no go.work;
//   - a polyspec package that a tracked project declares and a declared checkout provides has an installed folder (K888).
// What a manifest names, a path or a version, and whether Git ignores the declaration are the repository's own and are not judged (K1108). A finding names the ecosystem and the package or the file.
//
//   node link-check.mts [--project <dir>]
import { declaredUnlinked, link } from './link.mts';
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
  return declaredUnlinked(directory, provided, env, project).sort();
}

/**
 * The link check of the checkout of `directory`, or with `project` of the consumer `directory`: link's check, then linkFindings, of the
 * whole checkout, or with `project` of that project alone (K975).
 */
export function linkCheck(directory: string, project: boolean, print: (text: string) => void, env: NodeJS.ProcessEnv = process.env): boolean {
  // With no declaration, make link links nothing and leaves the release state (K869), which the check compares: no own link (K935).
  const checkouts = declaredCheckouts(directory);
  let ok = link({ checkouts: checkouts ?? [], directories: [directory], check: true, print, env, project, own: checkouts !== undefined });
  const root = workTreeOf(directory);
  for (const finding of linkFindings(root, env, project ? directory : root, project)) {
    print(`[link-check] ${finding}`);
    ok = false;
  }
  return ok;
}

if (isMain(import.meta.url)) {
  const args = process.argv.slice(2);
  const project = args[0] === '--project' ? args[1] : undefined;
  if (args.length !== (project === undefined ? 0 : 2)) {
    console.error('Usage: node link-check.mts [--project <dir>]');
    process.exitCode = 2;
  } else if (!linkCheck(project ?? '.', project !== undefined, text => console.log(text))) {
    console.error(`[link-check] the links differ from the link declaration (${LINKS_FILE}). Fix: make link`);
    process.exitCode = 1;
  } else console.log(`[link-check] the links are the link declaration (${LINKS_FILE})`);
}
