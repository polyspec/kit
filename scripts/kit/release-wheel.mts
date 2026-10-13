// The Python wheel of a release (package kind `wheel`): the PEP 427 file name, the build of the tagged commit with the pinned
// build backend, and the checks of pyproject.toml and of the wheel metadata. The build backend is the wheel of the exact
// requirement that config/release.json buildBackend names, in var/tools/wheels, and its sha256 is checked before each build.
// A build runs with --no-index and that directory as its only source, so no build reads the network. release-backend.mts
// fetches the backend; the Python of a build is the python3 of mise.toml (its shim, mise-tools.mts).
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileDigest } from './bootstrap/digest.mts';
import { run, Stop } from './process.mts';
import { toolsPath } from './bootstrap/tool-wrappers.mts';
import { toolCommand } from './mise-tools.mts';
import { isTable, readToml } from './toml.mts';

/** buildBackend of config/release.json: the pinned requirement of the build backend and the sha256 of its wheel. */
export interface BuildBackend {
  requirement: string;
  sha256: string;
}

// The directory of var/tools that holds the build backend wheel.
export const BACKEND_DIRECTORY = 'wheels';
const PURE_PYTHON = 'py3-none-any';
// The pinned requirement of the build backend: a distribution name, `==` and a version of numbers and dots.
const REQUIREMENT = /^([A-Za-z0-9._-]+)==(\d+(?:\.\d+)*)$/;

/** The distribution name of a file name: each run of characters other than word characters and dots is `_` (PEP 427). */
export const distributionOf = (name: string): string => name.replace(/[^\w\d.]+/g, '_');

/** The PEP 427 file name of the pure Python wheel of `name` at `version`: kit-fixture 0.0.1 is kit_fixture-0.0.1-py3-none-any.whl. */
export const wheelName = (name: string, version: string): string => `${distributionOf(name)}-${version}-${PURE_PYTHON}.whl`;

/** The file name of the build backend wheel of a pinned `name==version` requirement. */
export function backendName(requirement: string): string {
  const found = REQUIREMENT.exec(requirement);
  if (!found) throw new Stop(`buildBackend.requirement is ${requirement}, the form is name==version`);
  // Both groups of REQUIREMENT take part in every match.
  return wheelName(found[1]!, found[2]!);
}

/** The problems of the pyproject.toml `file` of a wheel package: its project name and its build backend, which is only the pinned requirement. */
export function sourceProblems({ file, text, name, requirement }: { file: string; text: string; name: string; requirement: string }): string[] {
  const problems: string[] = [];
  const data = readToml(text, file);
  const project = data.project;
  const buildSystem = data['build-system'];
  const declared = isTable(project) && typeof project.name === 'string' ? project.name : null;
  if (declared !== name) problems.push(`${file}: name ${declared ?? 'none'}, config/release.json declares ${name}`);
  const requires = isTable(buildSystem) ? buildSystem.requires ?? [] : [];
  if (JSON.stringify(requires) !== JSON.stringify([requirement])) problems.push(`${file}: build-system.requires is ${JSON.stringify(requires)}, the buildBackend pins ${requirement}`);
  return problems;
}

/** The metadata of a wheel that the release reads: its name, its version and its Requires-Dist lines. */
export type WheelMetadata = { name: string; version: string; requiresDist: string[] };

/** The problems of the metadata of a wheel of `name` at `version`: its name and its version. Dependencies: wheel-dependencies.mts. */
export function metadataProblems(metadata: WheelMetadata, name: string, version: string): string[] {
  const problems: string[] = [];
  if (metadata.name !== name) problems.push(`Name ${metadata.name}, config/release.json declares ${name}`);
  if (metadata.version !== version) problems.push(`Version ${metadata.version}, the tag is ${version}`);
  return problems;
}

/** The sha256 of the build backend file in var/tools/wheels must be `sha256`; a missing or other file fails. Returns the file. */
export function verifyBackend(root: string, requirement: string, sha256: string): string {
  const file = toolsPath(root, BACKEND_DIRECTORY, backendName(requirement));
  const shown = path.relative(root, file);
  if (!existsSync(file)) throw new Stop(`${shown} is missing; make release-backend fetches it`);
  const actual = fileDigest(file);
  if (actual !== sha256) throw new Stop(`${shown} has the sha256 ${actual}, config/release.json buildBackend declares ${sha256}`);
  return file;
}

/**
 * Builds the wheel of the package at `directory` of `commit` into the directory `output`. The source is a copy of the directory
 * at the commit (`git archive`), so the build writes into no checkout; SOURCE_DATE_EPOCH is the time of the commit.
 */
export function buildWheel({ root, env, commit, directory, output, buildBackend }: { root: string; env: NodeJS.ProcessEnv; commit: string; directory: string; output: string; buildBackend: BuildBackend }): void {
  const python = toolCommand(root, 'python3');
  if (!existsSync(python)) throw new Stop(`${path.relative(root, python)} is missing; the wheel is built by the Python of mise.toml, declare python there and run make install-tools`);
  verifyBackend(root, buildBackend.requirement, buildBackend.sha256);
  const folder = mkdtempSync(path.join(tmpdir(), 'kit-release-wheel-'));
  try {
    const archive = path.join(folder, 'source.tar');
    run('git', ['archive', '--format=tar', `--output=${archive}`, `${commit}:${directory}`], { cwd: root, env });
    const source = path.join(folder, 'source');
    mkdirSync(source);
    run('tar', ['-xf', archive, '-C', source], { cwd: root, env });
    const epoch = run('git', ['show', '-s', '--format=%ct', commit], { cwd: root, env }).trim();
    run(python, ['-m', 'pip', 'wheel', '--no-deps', '--no-index', '--no-cache-dir', '--no-input', '--disable-pip-version-check', '--find-links', toolsPath(root, BACKEND_DIRECTORY), '-w', output, source], { cwd: folder, env: { ...env, SOURCE_DATE_EPOCH: epoch } });
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
  if (!existsSync(python)) throw new Stop(`${path.relative(root, python)} is missing; pip reads the metadata of a wheel with the Python of mise.toml, declare python there and run make install-tools`);
  const report = JSON.parse(run(python, ['-m', 'pip', 'install', '--dry-run', '--no-deps', '--no-index', '--ignore-installed', '--quiet', '--no-input', '--disable-pip-version-check', '--report', '-', file], { cwd: root, env }));
  const installs: { metadata: { name: string; version: string; requires_dist?: string[] } }[] = report.install ?? [];
  const [install] = installs;
  if (installs.length !== 1 || !install) throw new Stop(`pip reports ${installs.length} distributions for the wheel ${file}; expected the wheel alone`);
  return { name: install.metadata.name, version: install.metadata.version, requiresDist: install.metadata.requires_dist ?? [] };
}
