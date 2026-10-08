// The dependency state of a checkout as its files record it, read without a network (T18.10). The gate
// scripts/check-dependency-policy.mjs compares it with the review record config/dependency-review.json; the developer
// command scripts/dependency-review.mjs compares it with the registries and writes that record.
//
// Scope: a registry dependency is a direct dependency that a registry resolves: an entry of `dependencies` or
// `devDependencies` of the root package.json, of `require` or `require-dev` of a Composer manifest of the policy, or a
// requirement of a Python manifest of the policy (`build-system.requires` and each extra of `project.optional-dependencies`).
// A Python requirement is pinned exactly (`name==version`), so its version is the pin itself.
// A `file:`, `link:` or `workspace:` npm dependency is a package of this repository; a Composer requirement `php`,
// `ext-*`, `lib-*` or `composer-*` is a platform requirement. "Latest stable" has no meaning for either, so they are
// not registry dependencies; the gate checks a local package against its lock entry and the platform against the policy.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const POLICY = 'config/dependency-policy.json';
export const RECORD = 'config/dependency-review.json';
export const NPM_MANIFEST = 'package.json';
export const NPM_LOCK = 'package-lock.json';

const LOCAL_SPEC = /^(file|link|workspace):/;
const EXACT_PYTHON_PIN = /^([A-Za-z0-9][A-Za-z0-9._-]*)==(\d+(?:\.\d+)*)$/;
const PLATFORM_REQUIREMENT = /^(php(-64bit|-ipv6|-zts|-debug)?|hhvm|ext-.+|lib-.+|composer(-plugin-api|-runtime-api)?)$/;

export const readJson = (root, file) => JSON.parse(readFileSync(join(root, file), 'utf8'));

/** The sha256 of a file of the checkout, in hexadecimal. */
export function digest(root, file) {
  return createHash('sha256').update(readFileSync(join(root, file))).digest('hex');
}

/** The numeric release of a version, without a leading `v`; null when the version is not `<major>.<minor>.<patch>`. */
export function versionParts(version) {
  const match = String(version).match(/^v?(\d+)\.(\d+)\.(\d+)/);
  return match ? match.slice(1).map(Number) : null;
}

/** Whether a version is a prerelease: a suffix after `-`, as in `10.0.0-rc.2` of npm and `2.0.0-beta1` of Composer. */
export function isPrerelease(version) {
  return /^v?\d+\.\d+\.\d+-/.test(String(version));
}

/** Whether `current` is an older release than `latest`; versions that are not numeric compare as strings. */
export function older(current, latest) {
  const left = versionParts(current);
  const right = versionParts(latest);
  if (!left || !right) return String(current).replace(/^v/, '') !== String(latest).replace(/^v/, '');
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] < right[index];
  }
  return false;
}

/** The highest stable release of a list of versions, or null. */
export function highestStable(versions) {
  let best = null;
  for (const version of versions) {
    if (isPrerelease(version) || !versionParts(version)) continue;
    if (best === null || older(best, version)) best = version;
  }
  return best;
}

/** The key of a dependency in the policy and the record. */
export const dependencyKey = ({ ecosystem, manifest, package: name }) => `${ecosystem}:${manifest}:${name}`;

/** The exact requirements of a pyproject.toml: build-system.requires and every extra, each `name==version`. */
export function pythonRequirements(text, manifest) {
  const sections = text.split(/^(?=\[)/m);
  const requirements = [];
  const add = (kind, list) => {
    for (const [, item] of list.matchAll(/"([^"]+)"/g)) {
      const pin = EXACT_PYTHON_PIN.exec(item);
      if (!pin) throw new Error(`${manifest}: ${JSON.stringify(item)} is not an exact pin name==version; pin it exactly`);
      requirements.push({ package: pin[1], kind, spec: `==${pin[2]}`, version: pin[2] });
    }
  };
  for (const section of sections) {
    if (section.startsWith('[build-system]')) {
      const requires = /^requires\s*=\s*\[([\s\S]*?)\]/m.exec(section);
      if (requires) add('build-system', requires[1]);
    } else if (section.startsWith('[project.optional-dependencies]')) {
      for (const [, extra, list] of section.matchAll(/^([A-Za-z0-9_-]+)\s*=\s*\[([\s\S]*?)\]/gm)) add(`optional:${extra}`, list);
    }
  }
  return requirements;
}

/**
 * The dependency state of the checkout at `root` for the Composer manifests and the Python manifests of `policy`: the
 * registry dependencies with their kind and locked version, the local npm packages with their lock entries, and the lock files.
 */
export function readState(root, policy) {
  const dependencies = [];
  const local = [];
  const locks = [NPM_LOCK];

  const manifest = readJson(root, NPM_MANIFEST);
  const lock = readJson(root, NPM_LOCK);
  for (const kind of ['dependencies', 'devDependencies']) {
    for (const [name, spec] of Object.entries(manifest[kind] ?? {})) {
      const entry = lock.packages?.[`node_modules/${name}`];
      if (LOCAL_SPEC.test(spec)) {
        const directory = spec.replace(LOCAL_SPEC, '');
        const packageFile = join(directory, 'package.json');
        local.push({
          manifest: NPM_MANIFEST, package: name, spec, kind, directory,
          lockResolved: entry?.resolved ?? null, lockVersion: entry?.version ?? null,
          version: existsSync(join(root, packageFile)) ? readJson(root, packageFile).version : null,
        });
        continue;
      }
      dependencies.push({ ecosystem: 'npm', manifest: NPM_MANIFEST, package: name, kind, spec, version: entry?.version ?? null, lock: NPM_LOCK });
    }
  }

  for (const platform of policy.composerPlatforms ?? []) {
    const manifestPath = platform.manifest;
    const lockPath = join(dirname(manifestPath), 'composer.lock');
    locks.push(lockPath);
    const composer = readJson(root, manifestPath);
    const composerLock = readJson(root, lockPath);
    const locked = new Map([...(composerLock.packages ?? []), ...(composerLock['packages-dev'] ?? [])].map(item => [item.name, item]));
    for (const kind of ['require', 'require-dev']) {
      for (const [name, spec] of Object.entries(composer[kind] ?? {})) {
        if (PLATFORM_REQUIREMENT.test(name)) continue;
        const entry = locked.get(name);
        if (entry?.dist?.type === 'path') {
          local.push({ manifest: manifestPath, package: name, spec, kind, directory: entry.dist.url, lockResolved: entry.dist.url, lockVersion: entry.version, version: entry.version });
          continue;
        }
        dependencies.push({ ecosystem: 'composer', manifest: manifestPath, package: name, kind, spec, version: entry?.version ?? null, lock: lockPath });
      }
    }
  }
  for (const manifestPath of policy.pythonManifests ?? []) {
    const text = readFileSync(join(root, manifestPath), 'utf8');
    for (const requirement of pythonRequirements(text, manifestPath)) {
      dependencies.push({ ecosystem: 'pypi', manifest: manifestPath, ...requirement, lock: null });
    }
  }
  return { dependencies, local, locks, npmManifest: manifest, npmLock: lock };
}
