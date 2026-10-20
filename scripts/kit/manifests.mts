// The manifests and locks of npm and Composer as the tools of kit read them: each type is the part of the file that its
// schema of scripts/kit/schema describes, and each reader validates the file against that schema (readConfig, K158).
import { readConfig, readJsonFile } from './schema-validate.mts';

/** An entry of `packages` of an npm lock (lockfileVersion 3). */
export type NpmLockEntry = {
  version?: string;
  resolved?: string;
  integrity?: string;
  link?: boolean;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
};

/** An npm lock (lockfileVersion 3); npm-lock.schema.json. */
export type NpmLock = { packages?: Record<string, NpmLockEntry> };

/** An npm manifest; npm-manifest.schema.json. engines holds any JSON, which a tool checks itself. */
export type NpmManifest = {
  name?: string;
  version?: string;
  private?: boolean;
  license?: string;
  packageManager?: string;
  files?: string[];
  bin?: string | Record<string, string>;
  workspaces?: string[];
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  overrides?: Record<string, unknown>;
  engines?: Record<string, unknown>;
  kit?: { copies?: Record<string, string> };
};

/** A Composer manifest; composer-manifest.schema.json. A platform package of config.platform is false when Composer leaves it out. */
export type ComposerManifest = {
  name?: string;
  version?: string;
  require?: Record<string, string>;
  'require-dev'?: Record<string, string>;
  // K377: the autoload files that lint-php reads, each a file of the package.
  autoload?: { files?: string[] };
  repositories?: { type?: string; url?: string; package?: { name?: string; version?: string } }[];
  config?: { platform?: Record<string, string | boolean> };
};

/** A package of a Composer lock; its require holds the requirements that the platform checks (K415). */
export type ComposerPackage = { name: string; version: string; require?: Record<string, string>; dist?: { type: string; url: string; shasum?: string } };

/** A Composer lock; composer-lock.schema.json. */
export type ComposerLock = { packages?: ComposerPackage[]; 'packages-dev'?: ComposerPackage[]; 'platform-overrides'?: Record<string, string> };

/** The npm manifest `file` of `root`, a path of the repository. */
export const readNpmManifest = (root: string, file: string): NpmManifest => readConfig<NpmManifest>(root, file, 'npm-manifest.schema.json');

/** The npm lock `file` of `root`. */
export const readNpmLock = (root: string, file: string): NpmLock => readConfig<NpmLock>(root, file, 'npm-lock.schema.json');

/** The Composer manifest `file` of `root`. */
export const readComposerManifest = (root: string, file: string): ComposerManifest => readConfig<ComposerManifest>(root, file, 'composer-manifest.schema.json');

/** The Composer lock `file` of `root`. */
export const readComposerLock = (root: string, file: string): ComposerLock => readConfig<ComposerLock>(root, file, 'composer-lock.schema.json');

/** The npm manifest at the path `file`. */
export const readNpmManifestFile = (file: string): NpmManifest => readJsonFile<NpmManifest>(file, 'npm-manifest.schema.json');

/** The npm lock at the path `file`. */
export const readNpmLockFile = (file: string): NpmLock => readJsonFile<NpmLock>(file, 'npm-lock.schema.json');

/** The Composer manifest at the path `file`. */
export const readComposerManifestFile = (file: string): ComposerManifest => readJsonFile<ComposerManifest>(file, 'composer-manifest.schema.json');

/** The Composer lock, or vendor/composer/installed.json of Composer 2, at the path `file`. */
export const readComposerLockFile = (file: string): ComposerLock => readJsonFile<ComposerLock>(file, 'composer-lock.schema.json');
