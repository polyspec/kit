// Helpers of the sibling tests (release-wheel.test.mts): a release whose wheel kit-fixture requires
// kit-fixture-validator, a wheel package of the same release. The second wheel package is added to the configuration of a
// temporary sandbox (releaseSandbox `mutate`); the committed fixture is not changed.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { readJson, writeJson } from './release-sandbox.mts';
import type { WheelRequires } from './wheel-stubs.mts';
import type { ReleaseConfig } from '../../scripts/kit/release.mts';

const REPOSITORY = 'https://example.com/polyspec/kit-fixture';
const GENERATOR = 'kit-fixture';
export const GENERATOR_WHEEL = 'kit_fixture-0.0.1-py3-none-any.whl';
const SIBLING = 'kit-fixture-validator';
export const SIBLING_WHEEL = 'kit_fixture_validator-0.0.1-py3-none-any.whl';
const SIBLING_URL = `${REPOSITORY}/releases/download/v0.0.1/${SIBLING_WHEEL}`;
// The Requires-Dist lines of the generator: its registry pin and the sibling line given by the test.
export const generatorRequires = (...lines: string[]): WheelRequires => ({ [GENERATOR]: ['ruff==0.16.10', ...lines], [SIBLING]: [] });

/** Adds the wheel package kit-fixture-validator (its manifest) to the configuration of the root. */
export function addSibling(root: string) {
  mkdirSync(path.join(root, 'packages/fixture-validator'), { recursive: true });
  writeFileSync(path.join(root, 'packages/fixture-validator/pyproject.toml'), `[build-system]\nrequires = ["setuptools==84.0.0"]\nbuild-backend = "setuptools.build_meta"\n\n[project]\nname = "${SIBLING}"\nversion = "0.0.1"\n`);
  const config = readJson<ReleaseConfig>(root, 'config/release.json');
  config.packages.push({ kind: 'wheel', directory: 'packages/fixture-validator', name: SIBLING });
  config.manifests['packages/fixture-validator/pyproject.toml'] = 'archive';
  writeJson(root, 'config/release.json', config);
}

/** The sibling line of a generator that names the sibling by `url` and an optional fragment. */
export const siblingLine = (url = SIBLING_URL) => `${SIBLING} @ ${url}`;
