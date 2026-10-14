// The toolchain declarations and the manifest floors of a checkout, each compared with the pin of kit at the pin's precision
// (S4). The declarations are the node, the go and the python of mise.toml (the minor of python), the channel of
// rust-toolchain.toml and the php minors; the go line of every go.mod is compared below. The manifests are the files of checkedFiles, so
// the vendored fixture of kit and the installed directories are not read, nor the tool environments of mise in .mise:
//   package.json   engines.node is ">=<node pin>"
//   composer.json  require.php is ">=<php pin>"; beside a composer.lock, config.platform.php is "<php pin>"
//   pyproject.toml project.requires-python is ">=<python pin>", when it has a project table (read by toolchain-files.mts)
//   go.mod         go is "<go pin>" and no toolchain line, which the go command drops when it equals the go line
//   Cargo.toml     package.rust-version is "<rust pin>", also through rust-version.workspace = true
//   package.json   typescript of each dependency field is "<typescript pin>"; the typescript that a package-lock.json resolves
//                  at its top level or for a workspace that declares it is the pin, and one that npm hoists or nests for
//                  another package is that package's
// A floor may also equal the channel of a declared exception whose scope holds the file (toolchain-exceptions.mts). Each other
// floor, and a missing one, is a finding that names the file, the key, the pin and the expected value. Beside the floors,
// an .npmrc may not keep npm from linking (S1: our rules never block the links of npm): install-links=true and
// bin-links=false fail, read by npm in the directory of the file.
import path from 'node:path';
import { readComposerManifest, readNpmLock, readNpmManifest, type NpmLockEntry } from './manifests.mts';
import { readCargoPackages, readGoMod, readNpmConfig, readTomlFile } from './toolchain-files.mts';
import type { Pinning } from './toolchain-exceptions.mts';
import type { Tool } from './toolchain-pins.mts';
import { checkedFiles } from './tracked-files.mts';

/** The declarations that pinFindings compares, as declaredToolchain and toolchain-files.mts return them. */
export type PinnedDeclarations = {
  node?: { version: string; source: string } | undefined;
  rust?: { version: string; source: string } | undefined;
  php?: { minors: string[]; source: string } | undefined;
  python?: { version: string; source: string } | undefined;
  go?: { version: string; source: string } | undefined;
};

/** One line for each declaration of `declared` that differs from its pin; an undeclared tool is not required. */
export function pinFindings(declared: PinnedDeclarations, pinning: Pinning): string[] {
  const values: [Tool, string[], string][] = [];
  for (const tool of ['node', 'rust', 'go'] as const) {
    const entry = declared[tool];
    if (entry) values.push([tool, [entry.version], entry.source]);
  }
  if (declared.php) values.push(['php', declared.php.minors, declared.php.source]);
  // Python is pinned by minor release, and mise.toml declares the exact release, whose minor is compared.
  if (declared.python) values.push(['python', [declared.python.version.split('.').slice(0, 2).join('.')], `${declared.python.source} minor`]);
  // A source is the declaring file, then the key that holds the release when the file holds more than the release.
  return values.flatMap(([tool, versions, source]) => {
    const [file = source, ...key] = source.split(' ');
    return versions.flatMap(version => pinning.check(file, key.join(' ') || tool, version, tool));
  });
}

// The manifests of the repository named `name`. .mise holds the tool environments that mise writes for the pypi: tools of
// mise.lock (K127), which are mise's, not manifests of the repository.
const named = (root: string, name: string): string[] => checkedFiles(root).filter(file => path.posix.basename(file) === name && !file.startsWith('.mise/'));

/** One line for each package.json whose engines.node is not `>=` the Node.js pin. */
export const enginesFindings = (root: string, pinning: Pinning): string[] => named(root, 'package.json')
  .flatMap(file => pinning.check(file, 'engines.node', readNpmManifest(root, file).engines?.node, 'node', release => `>=${release}`));

/**
 * One line for each composer.json whose require.php is not `>=` the PHP pin, and for each one beside a composer.lock
 * whose config.platform.php is not the pin or a patch release of it: Composer resolves the lock of a root package for that
 * platform.
 */
export function composerFindings(root: string, pinning: Pinning): string[] {
  const locks = new Set(named(root, 'composer.lock'));
  return named(root, 'composer.json').flatMap((file) => {
    const manifest = readComposerManifest(root, file);
    const locked = locks.has(path.posix.join(path.posix.dirname(file), 'composer.lock'));
    return [
      ...pinning.check(file, 'require.php', manifest.require?.php, 'php', release => `>=${release}`),
      // dependency-policy writes the platform as <major>.<minor>.<patch>, which names the pin at its <major>.<minor> precision.
      ...(locked ? pinning.check(file, 'config.platform.php', manifest.config?.platform?.php, 'php', undefined, { patch: true }) : []),
    ];
  });
}

/** One line for each pyproject.toml with a project table whose requires-python is not `>=` the Python pin. */
export const pyprojectFindings = (root: string, pinning: Pinning): string[] => named(root, 'pyproject.toml').flatMap((file) => {
  // A TOML document is a table; project, when present, is read as a table.
  const project = (readTomlFile(root, file) as { project?: Record<string, unknown> }).project;
  return project ? pinning.check(file, 'project.requires-python', project['requires-python'], 'python', release => `>=${release}`) : [];
});

/** One line for each go.mod whose go line is not the Go pin, and for each with a toolchain line; `env` runs the go command. */
export const goModFindings = (root: string, pinning: Pinning, env: NodeJS.ProcessEnv): string[] => named(root, 'go.mod').flatMap((file) => {
  const mod = readGoMod(root, file, env);
  return [
    ...pinning.check(file, 'go', mod.Go, 'go'),
    ...(mod.Toolchain ? [`${file}: toolchain is ${JSON.stringify(mod.Toolchain)}; kit pins go ${pinning.pins.go} in the go line, so remove the toolchain line`] : []),
  ];
});

/**
 * One line for each Cargo package whose rust-version is not the Rust pin. `cargo metadata` of each Cargo.toml lists the
 * packages of its workspace, so a package is read once; `env` runs cargo.
 */
export function cargoFindings(root: string, pinning: Pinning, env: NodeJS.ProcessEnv): string[] {
  const manifests = named(root, 'Cargo.toml');
  // cargo prints each manifest path below the path that it was given.
  const base = path.resolve(root);
  const versions = new Map<string, string | null>();
  for (const file of manifests) {
    if (versions.has(file)) continue;
    for (const entry of readCargoPackages(root, file, env)) versions.set(path.relative(base, entry.manifest_path).split(path.sep).join('/'), entry.rust_version);
  }
  // A virtual workspace manifest is no package, so only the manifests of packages have a floor.
  return manifests.filter(file => versions.has(file)).flatMap(file => pinning.check(file, 'package.rust-version', versions.get(file) ?? undefined, 'rust'));
}

const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'] as const;

// Whether the package-lock.json entry `key` is the typescript that a package of the repository declares: the
// node_modules/typescript of the lock's root or of a workspace (<workspace>/node_modules/typescript), when the lock's entry
// of that package ('' or <workspace>) names typescript in a dependency field. A typescript that npm hoists for another
// package, such as the TypeScript 5.9.3 of API Extractor, and a copy nested under another package are that tool's own, and
// our pin is never forced onto them (S1).
function declaredTypescript(key: string, packages: Record<string, NpmLockEntry>): boolean {
  if (!key.endsWith('node_modules/typescript')) return false;
  const owner = key.slice(0, -'node_modules/typescript'.length);
  if (owner !== '' && (!owner.endsWith('/') || owner.split('/').includes('node_modules'))) return false;
  const declared = packages[owner.replace(/\/$/, '')] ?? {};
  return DEPENDENCY_FIELDS.some(field => declared[field]?.typescript !== undefined);
}

/** One line for each package.json that names typescript other than the TypeScript pin, and each locked typescript of another release. */
export function typescriptFindings(root: string, pinning: Pinning): string[] {
  const files = checkedFiles(root);
  return files.flatMap((file) => {
    const name = path.posix.basename(file);
    if (name === 'package.json') {
      const manifest = readNpmManifest(root, file);
      return DEPENDENCY_FIELDS.flatMap((field) => {
        const typescript = manifest[field]?.typescript;
        return typescript === undefined ? [] : pinning.check(file, `${field}.typescript`, typescript, 'typescript');
      });
    }
    if (name === 'package-lock.json') {
      const packages = readNpmLock(root, file).packages ?? {};
      // An entry belongs to the folder of its workspace (packages/w/node_modules/typescript to packages/w), and an exception
      // scoped to that workspace covers it; a top-level entry belongs to the folder of the lock.
      return Object.entries(packages).filter(([key]) => declaredTypescript(key, packages))
        .flatMap(([key, entry]) => pinning.check(file, `packages[${JSON.stringify(key)}].version`, entry.version, 'typescript', undefined, {
          scope: path.posix.join(path.posix.dirname(file), key.slice(0, -'node_modules/typescript'.length)).replace(/\/$/, ''),
        }));
    }
    return [];
  });
}

/** The findings of every manifest floor of the checkout at `root`; `env` runs the readers of toolchain-files.mts. */
export const floorFindings = (root: string, pinning: Pinning, env: NodeJS.ProcessEnv): string[] => [
  ...enginesFindings(root, pinning),
  ...composerFindings(root, pinning),
  ...pyprojectFindings(root, pinning),
  ...goModFindings(root, pinning, env),
  ...cargoFindings(root, pinning, env),
  ...typescriptFindings(root, pinning),
];

// The npm keys that keep npm from linking, the value that does, and what npm then does instead.
const LINK_BLOCKERS: Record<string, [string, string]> = {
  'install-links': ['true', 'npm packs each file: dependency instead of linking it'],
  'bin-links': ['false', 'npm does not link the bins of the packages'],
};

/** One line for each key of a tracked .npmrc that keeps npm from linking; `env` runs npm. */
export const npmrcFindings = (root: string, env: NodeJS.ProcessEnv): string[] => named(root, '.npmrc').flatMap((file) => {
  const values = readNpmConfig(root, file, Object.keys(LINK_BLOCKERS), env);
  return Object.entries(LINK_BLOCKERS).filter(([key, [blocking]]) => values[key] === blocking)
    .map(([key, [blocking, effect]]) => `${file}: ${key} is ${blocking}, so ${effect}; remove the key`);
});
