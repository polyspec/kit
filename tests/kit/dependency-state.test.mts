// Tests of the behaviors that the dependency tools take from the implementations they replace: npm range satisfaction and
// duplicate detection, the packages of an npm workspace and a tagged package, the Composer platform and the exact pin of a
// Python requirement. Each runs on a copy of tests/kit/fixture, so no test uses the network.
import assert from 'node:assert/strict';
import test from 'node:test';
import { npmDuplicates, npmManifests, npmSatisfies, pythonRequirements } from '../../scripts/kit/dependency-state.mts';
import { tree } from './tree.mts';
import { fixtureCheckout as fixture, gate } from './checkout.mts';
import { editFixture } from './json-fixture.mts';
import { known } from './known.mts';

// Data names the fields of the fixture file that a test edits.
const edit = editFixture;
const findings = (result: { stderr: string }) => result.stderr.split('\n').filter(line => line.startsWith('[dependency-policy] ') && !line.includes(' finding'));

test('an npm version satisfies a range by the rules of npm', () => {
  assert.equal(npmSatisfies('1.2.3', '^1.0.0'), true);
  assert.equal(npmSatisfies('2.0.0', '^1.0.0'), false);
  assert.equal(npmSatisfies('1.2.9', '~1.2.3'), true);
  assert.equal(npmSatisfies('1.3.0', '~1.2.3'), false);
  assert.equal(npmSatisfies('1.5.0', '1.2.x || >=1.4.0 <2.0.0'), true);
  assert.equal(npmSatisfies('3.0.0-rc.1', '>=2.0.0'), false);
  assert.equal(npmSatisfies('3.0.0-rc.1', '>=3.0.0-rc.0'), true);
  assert.equal(npmSatisfies('not a version', '^1.0.0'), null);
  assert.equal(npmSatisfies('1.2.3', '>=01.2.3'), null, 'a leading zero makes no version, so npm reads no range');
  assert.equal(npmSatisfies('1.2.3', 'npm:other@^1.0.0'), true, 'an alias names the range of its package');
});

test('a package installed at two versions that one version satisfies is reported once', () => {
  const lock = { packages: {
    '': { dependencies: { left: '^1.0.0', right: '^1.0.0' } },
    'node_modules/left': { version: '1.1.0', dependencies: { shared: '^1.0.0' } },
    'node_modules/right': { version: '1.0.0', dependencies: { shared: '^1.0.0' } },
    'node_modules/shared': { version: '1.2.0' },
    'node_modules/right/node_modules/shared': { version: '1.0.5' },
  } };
  const lines = npmDuplicates(lock);
  assert.equal(lines.length, 1, lines.join('\n'));
  assert.match(known(lines[0], 'lines[0]'), /shared/); // The length is asserted above.
});

test('the gate fails when a workspace package has another version than its lock entry', (t) => {
  const root = fixture(t);
  edit(root, 'packages/fixture-lib/package.json', (manifest: { version: string }) => { manifest.version = '0.0.1'; });
  const result = gate(root);
  assert.equal(result.status, 1);
  assert.ok(findings(result).some(line => line.startsWith('[dependency-policy] packages/fixture-app/package.json fixture-lib: the manifest requires 0.0.0, packages/fixture-lib has version 0.0.1')), result.stderr);
});

test('the gate fails when a tagged package has another version than its tag, and prints the fix of the policy', (t) => {
  const root = fixture(t);
  edit(root, 'external/tagged/js/package.json', (manifest: { version: string }) => { manifest.version = '9.9.9'; });
  const result = gate(root);
  assert.equal(result.status, 1);
  const line = findings(result).find(item => item.includes('tagged-lib'));
  assert.ok(line, result.stderr);
  assert.match(line, /external\/tagged\/js has version 9\.9\.9, the tag v1\.2\.3 has version 1\.2\.3\. Rule: .+\. Fix: make install-tagged\.$/);
});

test('a package that npm installed as a copy (install-links) is no link, and the gate names the tag it must link to', (t) => {
  const root = fixture(t);
  edit(root, 'package-lock.json', (lock: { packages: Record<string, { version: string; resolved: string }> }) => {
    lock.packages['node_modules/tagged-lib'] = { version: '1.2.3', resolved: 'file:external/tagged/js' };
  });
  assert.deepEqual(findings(gate(root)).filter(line => line.includes('tagged-lib')).map(line => line.split('. Rule:')[0]), [
    '[dependency-policy] package.json tagged-lib: package-lock.json links it to no directory, the checkout of https://example.com/tagged-lib v1.2.3 is external/tagged/js',
  ]);
});

test('a package required as file:<directory> is the package of that directory, and another directory fails', (t) => {
  const root = fixture(t);
  const findingsOf = (spec: string) => {
    edit(root, 'packages/fixture-app/package.json', (manifest: { dependencies: Record<string, string> }) => { manifest.dependencies['fixture-lib'] = spec; });
    edit(root, 'package-lock.json', (lock: { packages: { 'packages/fixture-app': { dependencies: Record<string, string> } } }) => { lock.packages['packages/fixture-app'].dependencies['fixture-lib'] = spec; });
    return findings(gate(root)).filter(line => line.includes('fixture-lib'));
  };
  assert.deepEqual(findingsOf('file:packages/fixture-lib'), []);
  const other = findingsOf('file:packages/other');
  assert.ok(other.some(line => line.includes('requires file:packages/other')), other.join('\n'));
});

test('the gate fails when the Composer platform of a manifest is not the policy minimum', (t) => {
  const root = fixture(t);
  edit(root, 'packages/fixture-php/composer.json', (manifest: { config: { platform: { php: string } } }) => { manifest.config.platform.php = '8.1.0'; });
  const result = gate(root);
  assert.equal(result.status, 1);
  assert.ok(findings(result).some(line => line.startsWith('[dependency-policy] packages/fixture-php/composer.json: config.platform.php is 8.1.0, the policy declares 8.2.0')), result.stderr);
});

test('a Python requirement is pinned exactly, in the build system and in each extra', () => {
  const text = '[build-system]\nrequires = ["setuptools==84.0.0"]\n\n[project.optional-dependencies]\ndev = ["ruff==0.16.10"]\ndocs = ["mkdocs==1.6.1"]\n';
  assert.deepEqual(pythonRequirements(text, 'pyproject.toml').map(item => [item.package, item.kind, item.version]), [
    ['setuptools', 'build-system', '84.0.0'], ['ruff', 'optional:dev', '0.16.10'], ['mkdocs', 'optional:docs', '1.6.1'],
  ]);
  assert.throws(() => pythonRequirements('[build-system]\nrequires = ["setuptools>=80"]\n', 'pyproject.toml'), /"setuptools>=80" is not an exact pin name==version; pin it exactly/);
});

test('every valid pyproject form of a requirement is read, and a pin in a comment or a ] in a string changes nothing (K114)', () => {
  const read = (text: string) => pythonRequirements(text, 'pyproject.toml').map(item => [item.package, item.kind, item.version]);
  assert.deepEqual(read("[build-system]\nrequires = ['setuptools==84.0.0']\n"), [['setuptools', 'build-system', '84.0.0']], 'a single-quoted pin');
  assert.deepEqual(read('[project.optional-dependencies]\n"dev-x" = ["ruff==0.16.10"]\n'), [['ruff', 'optional:dev-x', '0.16.10']], 'a quoted extra key');
  assert.deepEqual(read('[project]\nname = "x"\noptional-dependencies = { dev = ["ruff==0.16.10"] }\n'), [['ruff', 'optional:dev', '0.16.10']], 'extras as an inline table');
  assert.deepEqual(read('build-system.requires = ["setuptools==84.0.0"]\n'), [['setuptools', 'build-system', '84.0.0']], 'a dotted build-system.requires');
  assert.deepEqual(read('[build-system]\nrequires = [\n  "setuptools==84.0.0", # not "wheel==1.0"\n]\n'), [['setuptools', 'build-system', '84.0.0']], 'a pin inside a comment');
  assert.throws(() => read('[build-system]\nrequires = ["pkg[extra]==1.0", "setuptools==84.0.0"]\n'), /"pkg\[extra\]==1\.0" is not an exact pin name==version; pin it exactly/);
  assert.throws(() => read('[build-system]\nrequires = "setuptools==84.0.0"\n'), /pyproject\.toml: build-system\.requires is not an array of strings/);
  assert.throws(() => read('[build-system\n'), /^Error: pyproject\.toml line 1 column \d+: Invalid TOML document/);
});

// The groups of [dependency-groups] are read with their includes resolved as PEP 735 specifies; a requirement that two
// groups reach is read once, and a group that includes an unknown group, includes itself, or holds another item fails (K177).
test('a Python requirement of a dependency group is read with the groups that include it resolved by PEP 735 (K177)', () => {
  const read = (text: string) => pythonRequirements(text, 'pyproject.toml').map(item => [item.package, item.kind, item.version]);
  assert.deepEqual(read('[dependency-groups]\ntest = ["pytest==8.0.0"]\nDev_Tools = ["ruff==0.16.10", { include-group = "Test" }]\nall = [{ include-group = "dev-tools" }, "mkdocs==1.6.1"]\n'), [
    ['pytest', 'group:test', '8.0.0'], ['ruff', 'group:Dev_Tools', '0.16.10'], ['mkdocs', 'group:all', '1.6.1'],
  ]);
  assert.throws(() => read('[dependency-groups]\ntest = ["pytest>=8"]\n'), /"pytest>=8" is not an exact pin name==version; pin it exactly/);
  assert.throws(() => read('[dependency-groups]\ndev = [{ include-group = "lint" }]\n'), /pyproject\.toml: dependency-groups\.dev includes lint, which is no dependency group/);
  assert.throws(() => read('[dependency-groups]\na = [{ include-group = "b" }]\nb = [{ include-group = "a" }]\n'), /pyproject\.toml: dependency-groups\.a includes itself through a -> b -> a/);
  assert.throws(() => read('[dependency-groups]\ndev = [{ include-group = "x", extra = 1 }]\nx = []\n'), /pyproject\.toml: dependency-groups\.dev\[0\] is neither a requirement nor an \{ include-group \} table/);
  assert.throws(() => read('[dependency-groups]\ntest = []\nTEST = []\n'), /pyproject\.toml: dependency-groups holds two groups whose names normalize to test/);
  assert.throws(() => read('[dependency-groups]\ntest = "pytest==8.0.0"\n'), /pyproject\.toml: dependency-groups\.test is not an array/);
});

test('npm workspaces are every pattern that npm reads: an explicit path, a glob and a negation, against the directories with a package.json', (t) => {
  const pkg = (name: string) => JSON.stringify({ name, version: '0.0.0' });
  const root = tree(t, {
    'package.json': JSON.stringify({ name: 'root', workspaces: ['tools/cli', 'packages/*', '!packages/skip', 'apps/**'] }),
    'tools/cli/package.json': pkg('cli'),
    'tools/other/package.json': pkg('other'),
    'packages/a/package.json': pkg('a'),
    'packages/skip/package.json': pkg('skip'),
    'packages/empty/README.md': 'no package\n',
    'apps/web/site/package.json': pkg('site'),
  });
  assert.deepEqual(npmManifests(root).map(entry => entry.directory), ['.', 'apps/web/site', 'packages/a', 'tools/cli']);
});
