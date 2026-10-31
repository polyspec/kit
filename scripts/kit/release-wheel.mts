// The Python wheel of a release (package kind `wheel`): the PEP 427 file name, the build of the tagged commit, and the check
// of the wheel metadata. uv build builds the wheel in an isolated environment with the build-system.requires of the package's
// own pyproject.toml (PEP 517/518); kit pins and installs no build backend (K788). The Python of a build is the python3 of
// mise.toml and uv is the uv of mise.toml (their shims, mise-tools.mts).
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { run, Stop } from './process.mts';
import { toolCommand } from './mise-tools.mts';
import { parseJson } from './schema-validate.mts';

const PURE_PYTHON = 'py3-none-any';

/** The distribution name of a file name: each run of characters other than word characters and dots is `_` (PEP 427). */
export const distributionOf = (name: string): string => name.replace(/[^\w\d.]+/g, '_');

/** The PEP 427 file name of the pure Python wheel of `name` at `version`: kit-fixture 0.0.1 is kit_fixture-0.0.1-py3-none-any.whl. */
export const wheelName = (name: string, version: string): string => `${distributionOf(name)}-${version}-${PURE_PYTHON}.whl`;

/** The metadata of a wheel that the release reads: its name, its version and its Requires-Dist lines. */
export type WheelMetadata = { name: string; version: string; requiresDist: string[] };

/** The problems of the metadata of a wheel of `name` at `version`: its name and its version; its dependencies are uv's to resolve. */
export function metadataProblems(metadata: WheelMetadata, name: string, version: string): string[] {
  const problems: string[] = [];
  if (metadata.name !== name) problems.push(`Name ${metadata.name}, config/release.json declares ${name}`);
  if (metadata.version !== version) problems.push(`Version ${metadata.version}, the tag is ${version}`);
  return problems;
}

/**
 * Builds the wheel of the package at `directory` of `commit` into the directory `output`. The source is a copy of the directory
 * at the commit (`git archive`), so the build writes into no checkout; SOURCE_DATE_EPOCH is the time of the commit. uv build
 * installs the build-system.requires of its pyproject.toml into an isolated build environment. The generated files (K929) are
 * copied into the source at their package-relative paths before the build.
 */
export function buildWheel({ root, env, commit, directory, output, generated }: { root: string; env: NodeJS.ProcessEnv; commit: string; directory: string; output: string; generated: { output: string; file: string }[] }): void {
  const python = toolCommand(root, 'python3');
  const uv = toolCommand(root, 'uv');
  const folder = mkdtempSync(path.join(tmpdir(), 'kit-release-wheel-'));
  try {
    const archive = path.join(folder, 'source.tar');
    run('git', ['archive', '--format=tar', `--output=${archive}`, `${commit}:${directory}`], { cwd: root, env });
    const source = path.join(folder, 'source');
    mkdirSync(source);
    run('tar', ['-xf', archive, '-C', source], { cwd: root, env });
    for (const item of generated) {
      mkdirSync(path.dirname(path.join(source, item.output)), { recursive: true });
      copyFileSync(item.file, path.join(source, item.output));
    }
    const epoch = run('git', ['show', '-s', '--format=%ct', commit], { cwd: root, env }).trim();
    // uv build writes a .gitignore into its output folder, so the wheel is built apart and only the wheel is copied into `output`.
    const built = path.join(folder, 'dist');
    mkdirSync(built);
    run(uv, ['build', '--wheel', '--python', python, '--out-dir', built, source], { cwd: folder, env: { ...env, SOURCE_DATE_EPOCH: epoch } });
    for (const name of readdirSync(built).filter(entry => entry.endsWith('.whl'))) copyFileSync(path.join(built, name), path.join(output, name));
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

/**
 * The metadata of the wheel `file`, as pip reads it: the dry run of its install with no index and no dependencies writes the
 * report of the one distribution that it would install, from the .dist-info of that distribution, so the METADATA of a
 * distribution that the wheel vendors is never read. Offline; nothing is installed.
 */
export function wheelMetadata(root: string, file: string, env: NodeJS.ProcessEnv): WheelMetadata {
  const python = toolCommand(root, 'python3');
  const report = parseJson<{ install?: { metadata: { name: string; version: string; requires_dist?: string[] } }[] }>(run(python, ['-m', 'pip', 'install', '--dry-run', '--no-deps', '--no-index', '--ignore-installed', '--quiet', '--no-input', '--disable-pip-version-check', '--report', '-', file], { cwd: root, env }), 'pip-report.schema.json', `pip install --report of ${file}`);
  const installs = report.install ?? [];
  const [install] = installs;
  if (installs.length !== 1 || !install) throw new Stop(`pip reports ${installs.length} distributions for the wheel ${file}; expected the wheel alone`);
  return { name: install.metadata.name, version: install.metadata.version, requiresDist: install.metadata.requires_dist ?? [] };
}
