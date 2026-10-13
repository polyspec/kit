// The PHP lint that a checkout declares, read after the bootstrap: the Composer project of config/php-lint, which install-tools
// installs, and the releases of its tools. The other lint tools (ruff, vulture, golangci-lint, deadcode) are tools of mise.toml
// (toolchain-mise.mts). Each entry names its release and the declaring file, so that an install and a check name the file:
//   phpLint       config/php-lint/composer.lock: the PHP lint of kit, whose release is the sha256 of the lock
//   phpcs, phpstan config/php-lint/composer.lock: the releases of squizlabs/php_codesniffer and phpstan/phpstan that it locks
// The PHP lint is declared when its lock is present. A lock without a release of a tool throws an error with the file and
// the value.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileDigest } from './bootstrap/digest.mts';
import type { Declared } from './bootstrap/toolchain-declared.mts';

/** The declared PHP lint of a checkout; an undeclared one is absent. */
export type DeclaredLintTools = {
  phpLint?: { lock: string; manifest: string; source: string };
  phpcs?: Declared;
  phpstan?: Declared;
};

/** The declared PHP lint of the checkout at `root`. */
export function declaredLintTools(root: string): DeclaredLintTools {
  const declared: DeclaredLintTools = {};
  const lock = 'config/php-lint/composer.lock';
  if (existsSync(path.join(root, lock))) {
    declared.phpLint = { lock: fileDigest(path.join(root, lock)), manifest: 'config/php-lint/composer.json', source: lock };
    const packages = (JSON.parse(readFileSync(path.join(root, lock), 'utf8')).packages ?? []) as { name: string; version: string }[];
    for (const [tool, name] of [['phpcs', 'squizlabs/php_codesniffer'], ['phpstan', 'phpstan/phpstan']] as const) {
      const locked = packages.find(entry => entry.name === name)?.version;
      if (!locked || !/^v?\d+\.\d+\.\d+$/.test(locked)) throw new Error(`${lock} must lock ${name} at a release <major>.<minor>.<patch>; it locks ${JSON.stringify(locked)}`);
      declared[tool] = { version: locked.replace(/^v/, ''), source: lock };
    }
  }
  return declared;
}
