#!/usr/bin/env node
// The S10 library rule of `make layout-check` (K425, K783): a PHP library of the checkout is library code only, so its require
// names no application framework; an application on a userland framework is its own Composer package beside the library (K433),
// which libraryFolders leaves out.
//
//   node scripts/kit/library-frameworks.mts
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { readComposerManifest } from './manifests.mts';
import { isMain, repositoryRoot } from './paths.mts';
import { libraryFolders } from './php-extension.mts';
import { checkedFiles } from './tracked-files.mts';

// The Composer packages of an application framework, which a PHP library of S10 never requires.
const APPLICATION_FRAMEWORKS = ['symfony/console', 'symfony/framework-bundle', 'symfony/http-kernel', 'laravel/framework', 'laminas/laminas-mvc'];

/** The findings of the checkout `root`: one line for each application framework that the require of a PHP library names. */
export function libraryFrameworkFindings(root: string): string[] {
  const tracked = checkedFiles(root);
  return libraryFolders(tracked, file => (tracked.includes(file) ? readFileSync(path.join(root, file), 'utf8') : undefined)).flatMap((folder) => {
    const manifestPath = path.posix.join(folder, 'composer.json');
    const require = readComposerManifest(root, manifestPath).require ?? {};
    return APPLICATION_FRAMEWORKS.filter(name => require[name] !== undefined)
      .map(name => `${manifestPath}: requires ${name} in require; a PHP library of S10 requires no application framework, so move the application on ${name} into its own Composer package that requires ${folder}`);
  });
}

if (isMain(import.meta.url)) {
  const findings = libraryFrameworkFindings(repositoryRoot());
  for (const finding of findings) console.error(`[library-frameworks] ${finding}`);
  if (findings.length) process.exitCode = 1;
}
