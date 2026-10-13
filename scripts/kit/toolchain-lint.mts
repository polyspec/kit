// The lint tools that a checkout declares, read after the bootstrap, which reads only what is needed before npm ci. Each
// entry names its release and the declaring file, so that an install and a check name the file in a message:
//   ruff          config/toolchain.json ruff: the exact version and the sha256 of the wheel of each platform
//   vulture       config/toolchain.json vulture: the release as PyPI names it and the sha256 of its one pure-Python wheel
//   golangciLint  config/toolchain.json golangciLint: the exact version and the sha256 of the release archive of each platform
//   deadcode      config/toolchain.json deadcode: the release of golang.org/x/tools whose deadcode go install builds
//   phpLint       config/php-lint/composer.lock: the PHP lint of kit, whose release is the sha256 of the lock
//   phpcs, phpstan config/php-lint/composer.lock: the releases of squizlabs/php_codesniffer and phpstan/phpstan that it locks
// A tool is declared when its config key or its file is present; an undeclared tool is absent from the result. A malformed
// declaration throws an error with the file, the expected form and the actual value.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileDigest } from './bootstrap/digest.mts';
import { platformRelease, recordedRelease, toolchainConfig } from './bootstrap/toolchain-declared.mts';
import type { Declared, PlatformRelease } from './bootstrap/toolchain-declared.mts';

/** The declared lint tools of a checkout; an undeclared tool is absent. */
export type DeclaredLintTools = {
  ruff?: PlatformRelease;
  vulture?: Declared & { sha256: string };
  golangciLint?: PlatformRelease;
  deadcode?: Declared;
  phpLint?: { lock: string; manifest: string; source: string };
  phpcs?: Declared;
  phpstan?: Declared;
};

// The vulture release: the release as PyPI names it (vulture names its releases <major>.<minor>) and the sha256 of its one
// wheel, which is pure Python (py3-none-any). A value that is not text is refused like a text of another form.
function vulture(value: Record<string, unknown>): Declared & { sha256: string } {
  const file = 'config/toolchain.json vulture';
  const { version, sha256 } = value;
  if (typeof version !== 'string' || !/^\d+(\.\d+)+$/.test(version)) throw new Error(`${file} must record version as the PyPI release, for example 2.16; it records ${JSON.stringify(version)}`);
  if (typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sha256)) throw new Error(`${file} must record sha256 as 64 lowercase hexadecimal digits; it records ${JSON.stringify(sha256)}`);
  return { version, sha256, source: file };
}

/** The declared lint tools of the checkout at `root`. */
export function declaredLintTools(root: string): DeclaredLintTools {
  const config = toolchainConfig(root);
  const declared: DeclaredLintTools = {};
  if (config.ruff) declared.ruff = platformRelease('ruff', 'wheel', config.ruff);
  if (config.vulture) declared.vulture = vulture(config.vulture as Record<string, unknown>);
  if (config.golangciLint) declared.golangciLint = platformRelease('golangciLint', 'archive', config.golangciLint);
  if (config.deadcode) declared.deadcode = { version: recordedRelease(root, 'deadcode'), source: 'config/toolchain.json deadcode' };
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
