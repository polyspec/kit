// The toolchain declarations and the manifest floors of a checkout, each compared with the pin of kit at the pin's precision
// (S4). The declarations are .node-version, the channel of rust-toolchain.toml, the php minors and the python minor; the Go
// declaration is the go line of a go.mod, compared below in every go.mod. The manifests are the files of checkedFiles, so
// the vendored fixture of kit and the installed directories are not read:
//   package.json   engines.node is ">=<node pin>"
//   composer.json  require.php is ">=<php pin>"; beside a composer.lock, config.platform.php is "<php pin>"
//   pyproject.toml project.requires-python is ">=<python pin>", when it has a project table (read by toolchain-files.mts)
//   go.mod         go is "<go pin>" and no toolchain line, which the go command drops when it equals the go line
//   Cargo.toml     package.rust-version is "<rust pin>", also through rust-version.workspace = true
//   package.json   typescript of each dependency field is "<typescript pin>"; every typescript of a package-lock.json is the pin
// A floor may also equal the channel of a declared exception whose scope holds the file (toolchain-exceptions.mts). Each other
// floor, and a missing one, is a finding that names the file, the key, the pin and the expected value.
import path from 'node:path';
import { readJson } from './bootstrap/files.mts';
import { readCargoPackages, readGoMod, readToml } from './toolchain-files.mts';
import type { Pinning } from './toolchain-exceptions.mts';
import type { Tool } from './toolchain-pins.mts';
import { checkedFiles } from './tracked-files.mts';

/** The declarations that pinFindings compares, as declaredToolchain and toolchain-files.mts return them. */
export type PinnedDeclarations = {
  node?: { version: string; source: string } | undefined;
  rust?: { version: string; source: string } | undefined;
  php?: { minors: string[]; source: string } | undefined;
  python?: { minor: string; source: string } | undefined;
};

/** One line for each declaration of `declared` that differs from its pin; an undeclared tool is not required. */
export function pinFindings(declared: PinnedDeclarations, pinning: Pinning): string[] {
  const values: [Tool, string[], string][] = [];
  for (const tool of ['node', 'rust'] as const) {
    const entry = declared[tool];
    if (entry) values.push([tool, [entry.version], entry.source]);
  }
  if (declared.php) values.push(['php', declared.php.minors, declared.php.source]);
  if (declared.python) values.push(['python', [declared.python.minor], declared.python.source]);
  // A source is the declaring file, then the key that holds the release when the file holds more than the release.
  return values.flatMap(([tool, versions, source]) => {
    const [file = source, ...key] = source.split(' ');
    return versions.flatMap(version => pinning.check(file, key.join(' ') || tool, version, tool));
  });
}

const named = (root: string, name: string): string[] => checkedFiles(root).filter(file => path.posix.basename(file) === name);

/** One line for each package.json whose engines.node is not `>=` the Node.js pin. */
export const enginesFindings = (root: string, pinning: Pinning): string[] => named(root, 'package.json')
  .flatMap(file => pinning.check(file, 'engines.node', readJson(root, file).engines?.node, 'node', release => `>=${release}`));

/**
 * One line for each composer.json whose require.php is not `>=` the PHP pin, and for each one beside a composer.lock
 * whose config.platform.php is not the pin: Composer resolves the lock of a root package for that platform.
 */
export function composerFindings(root: string, pinning: Pinning): string[] {
  const locks = new Set(named(root, 'composer.lock'));
  return named(root, 'composer.json').flatMap((file) => {
    const manifest = readJson(root, file);
    const locked = locks.has(path.posix.join(path.posix.dirname(file), 'composer.lock'));
    return [
      ...pinning.check(file, 'require.php', manifest.require?.php, 'php', release => `>=${release}`),
      ...(locked ? pinning.check(file, 'config.platform.php', manifest.config?.platform?.php, 'php') : []),
    ];
  });
}

/** One line for each pyproject.toml with a project table whose requires-python is not `>=` the Python pin; `env` runs the reader. */
export const pyprojectFindings = (root: string, pinning: Pinning, env: NodeJS.ProcessEnv): string[] => named(root, 'pyproject.toml').flatMap((file) => {
  // tomllib returns a table for a TOML document; project, when present, is a table too.
  const project = (readToml(root, file, env) as { project?: Record<string, unknown> }).project;
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

const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];

/** One line for each package.json that names typescript other than the TypeScript pin, and each locked typescript of another release. */
export function typescriptFindings(root: string, pinning: Pinning): string[] {
  const files = checkedFiles(root);
  return files.flatMap((file) => {
    const name = path.posix.basename(file);
    if (name === 'package.json') {
      const manifest = readJson(root, file);
      return DEPENDENCY_FIELDS.filter(field => manifest[field]?.typescript !== undefined)
        .flatMap(field => pinning.check(file, `${field}.typescript`, manifest[field].typescript, 'typescript'));
    }
    if (name === 'package-lock.json') {
      const packages: Record<string, { version?: unknown }> = readJson(root, file).packages ?? {};
      return Object.entries(packages).filter(([key]) => key === 'node_modules/typescript' || key.endsWith('/node_modules/typescript'))
        .flatMap(([key, entry]) => pinning.check(file, `packages[${JSON.stringify(key)}].version`, entry.version, 'typescript'));
    }
    return [];
  });
}

/** The findings of every manifest floor of the checkout at `root`; `env` runs the readers of toolchain-files.mts. */
export const floorFindings = (root: string, pinning: Pinning, env: NodeJS.ProcessEnv): string[] => [
  ...enginesFindings(root, pinning),
  ...composerFindings(root, pinning),
  ...pyprojectFindings(root, pinning, env),
  ...goModFindings(root, pinning, env),
  ...cargoFindings(root, pinning, env),
  ...typescriptFindings(root, pinning),
];
