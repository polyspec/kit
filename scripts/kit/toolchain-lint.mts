// The PHP lint that a checkout declares, read after the bootstrap: the Composer project of config/php-lint, which install-tools
// installs, and the releases of its tools. The other lint tools (ruff, vulture, golangci-lint, deadcode) are tools of mise.toml
// (toolchain-mise.mts). Each entry names its release and the declaring file, so that an install and a check name the file:
//   phpLint       config/php-lint/composer.lock, when the checkout declares PHP: the PHP lint of kit, whose release is the sha256 of the lock
//   phpcs, phpstan config/php-lint/composer.lock: the releases of squizlabs/php_codesniffer and phpstan/phpstan that it locks
// The PHP lint is declared when the checkout declares PHP and its lock is present; a tool is the release that the lock records, as it records it.
import path from 'node:path';
import { fileDigest } from './bootstrap/digest.mts';
import { declaredToolchain } from './bootstrap/toolchain-declared.mts';
import type { Declared } from './bootstrap/toolchain-declared.mts';
import { kitFile } from './kit-files.mts';
import { readComposerLock } from './manifests.mts';

/** The declared PHP lint of a checkout; an undeclared one is absent. */
export type DeclaredLintTools = {
  phpLint?: { lock: string; manifest: string; source: string };
  phpcs?: Declared;
  phpstan?: Declared;
};

/** The declared PHP lint of the checkout at `root`. */
export function declaredLintTools(root: string): DeclaredLintTools {
  const declared: DeclaredLintTools = {};
  // The PHP lint is the Composer project config/php-lint of the kit that runs, read through the link (K614), and a tool of a
  // repository that declares PHP (config/toolchain.json php or .php-version), not of every repository.
  const project = path.relative(root, kitFile('config/php-lint'));
  const lock = path.join(project, 'composer.lock');
  if (declaredToolchain(root).php) {
    declared.phpLint = { lock: fileDigest(path.join(root, lock)), manifest: path.join(project, 'composer.json'), source: lock };
    const packages = readComposerLock(root, lock).packages ?? [];
    for (const [tool, name] of [['phpcs', 'squizlabs/php_codesniffer'], ['phpstan', 'phpstan/phpstan']] as const) {
      const locked = packages.find(entry => entry.name === name)?.version;
      if (locked) declared[tool] = { version: locked.replace(/^v/, ''), source: lock };
    }
  }
  return declared;
}
