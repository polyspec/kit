// Tests of polyspec-lock-check.mts, the gate that no tracked file names a polyspec package of 0.0.x (K468). A tracked
// manifest or lock names none; the declarations of such packages live in config/polyspec.json, which the link installs
// from the sibling checkouts. Each fixture is a git repository in a temporary folder, with only the files of the case tracked.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import nodeTest, { type TestContext } from 'node:test';
import { polyspecLockFindings } from '../../scripts/kit/polyspec-lock-check.mts';
import { providers } from '../../scripts/kit/link-providers.mts';
import { initRepository } from './sandbox-repository.mts';
import { put } from './tree.mts';
import { git } from '../../scripts/kit/git.mts';

/** Every case has its own timeout (K301): a case that hangs fails after a minute instead of holding the run. */
const test = (name: string, body: (t: TestContext) => void): void => { void nodeTest(name, { timeout: 60_000 }, body); };

/** A repository of one case: the files are written and tracked, so the gate reads them as the checkout does. */
function repository(t: TestContext, files: Record<string, string>, untracked: Record<string, string> = {}): string {
  const root = mkdtempSync(path.join(tmpdir(), 'polyspec-lock-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  initRepository(root);
  put(root, files);
  git(root, 'add', '-A');
  git(root, 'commit', '--quiet', '-m', 'files');
  put(root, untracked);
  return root;
}

const LOCKED_PHP = JSON.stringify({ packages: [{ name: 'polyspec/orm', version: '0.0.18' }, { name: 'psr/log', version: '3.0.0' }] });

test('K478: an own workspace package is allowed but a true sibling remains a finding', (t) => {
  const root = repository(t, {
    'package.json': JSON.stringify({ name: 'consumer/root', private: true, workspaces: ['packages/*'], dependencies: { '@polyspec/local': 'workspace:*', '@polyspec/sibling': '0.0.1' } }),
    'package-lock.json': JSON.stringify({ packages: {
      '': { name: 'consumer/root', dependencies: { '@polyspec/local': 'workspace:*', '@polyspec/sibling': '0.0.1' } },
      'packages/local': { name: '@polyspec/local', version: '0.0.1' },
      'node_modules/@polyspec/local': { resolved: 'packages/local', link: true },
      'node_modules/@polyspec/sibling': { version: '0.0.1', resolved: '../sibling' },
    } }),
    'packages/local/package.json': JSON.stringify({ name: '@polyspec/local', version: '0.0.1' }),
  });
  const sibling = mkdtempSync(path.join(tmpdir(), 'polyspec-sibling-'));
  t.after(() => rmSync(sibling, { recursive: true, force: true }));
  initRepository(sibling);
  put(sibling, { 'package.json': JSON.stringify({ name: '@polyspec/sibling', version: '0.0.1' }) });
  git(sibling, 'add', '-A');
  git(sibling, 'commit', '--quiet', '-m', 'sibling package');

  const findings = polyspecLockFindings(root);
  assert.equal(findings.length, 2, findings.join('\n'));
  assert.ok(findings.every(finding => finding.includes('@polyspec/sibling')), findings.join('\n'));
  assert.ok(findings.every(finding => !finding.includes('@polyspec/local')), findings.join('\n'));
});

test('K478: Python PEP 503 separator variants identify the same owned workspace package', (t) => {
  const root = repository(t, {
    'packages/python/pyproject.toml': '[project]\nname = "polyspec_local"\nversion = "0.0.1"\n',
    'packages/python/pylock.toml': 'lock-version = "1.0"\n[[packages]]\nname = "polyspec.local"\nversion = "0.0.1"\n[[packages]]\nname = "polyspec-sibling"\nversion = "0.0.2"\n',
  });
  const findings = polyspecLockFindings(root);
  assert.equal(findings.length, 1, findings.join('\n'));
  const [finding] = findings;
  assert.ok(finding);
  assert.ok(finding.includes('polyspec-sibling'), findings.join('\n'));
  assert.ok(!finding.includes('polyspec.local'), findings.join('\n'));
});

test('K478-1: a tracked manifest symlink outside this repository does not own an external release lock', (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'polyspec-lock-root-'));
  const outside = mkdtempSync(path.join(tmpdir(), 'polyspec-lock-outside-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  initRepository(root);
  initRepository(outside);
  put(outside, { 'package.json': JSON.stringify({ name: '@polyspec/outside', version: '0.0.1' }) });
  git(outside, 'add', '-A');
  git(outside, 'commit', '--quiet', '-m', 'outside package');
  put(root, {
    'package.json': JSON.stringify({ name: 'consumer/root', dependencies: { '@polyspec/outside': '0.0.1' } }),
    'package-lock.json': JSON.stringify({ packages: {
      '': { name: 'consumer/root', dependencies: { '@polyspec/outside': '0.0.1' } },
      'node_modules/@polyspec/outside': { version: '0.0.1' },
    } }),
  });
  const providerFolder = path.join(root, 'packages/external');
  mkdirSync(providerFolder, { recursive: true });
  symlinkSync(path.join(outside, 'package.json'), path.join(providerFolder, 'package.json'));
  git(root, 'add', '-A');
  git(root, 'commit', '--quiet', '-m', 'external manifest symlink');

  const owner = providers([], undefined, root, root).get('npm:@polyspec/outside');
  assert.ok(owner, 'the link provider scan sees the tracked symlinked manifest');
  assert.equal(owner.folder, path.join(realpathSync(root), 'packages/external'), 'the provider folder is derived lexically from the tracked manifest');
  assert.equal(realpathSync(path.join(owner.folder, 'package.json')), realpathSync(path.join(outside, 'package.json')));
  const findings = polyspecLockFindings(root);
  assert.equal(findings.length, 2, findings.join('\n'));
  assert.ok(findings.every(finding => finding.includes('@polyspec/outside')), findings.join('\n'));
});

test('K468: each tracked manifest or lock that names a polyspec package is a finding, by file and name', (t) => {
  const root = repository(t, {
    'packages/php/composer.json': JSON.stringify({ name: 'polyspec/fsm', require: { 'polyspec/orm': '0.0.18' } }),
    'packages/php/composer.lock': LOCKED_PHP,
    'package.json': JSON.stringify({ devDependencies: { '@polyspec/kit': 'https://github.com/polyspec/kit/releases/download/v0.0.54/x.tgz' } }),
    'package-lock.json': JSON.stringify({ packages: { '': {}, 'node_modules/@polyspec/kit': { version: '0.0.54' } } }),
    'packages/python/pyproject.toml': '[project]\nname = "polyspec-fsm-python"\ndependencies = ["polyspec-orm @ https://github.com/polyspec/orm/releases/download/v0.0.18/polyspec_orm-0.0.18-py3-none-any.whl"]\n',
    'packages/python/pylock.toml': 'lock-version = "1.0"\n[[packages]]\nname = "polyspec-orm"\nversion = "0.0.18"\n',
  });
  const findings = polyspecLockFindings(root);
  assert.equal(findings.length, 6, findings.join('\n'));
  for (const file of ['packages/php/composer.json', 'packages/php/composer.lock', 'package.json', 'package-lock.json', 'packages/python/pyproject.toml', 'packages/python/pylock.toml']) {
    assert.ok(findings.some(line => line.startsWith(`${file}:`)), `${file} is named: ${findings.join('\n')}`);
  }
  assert.ok(findings.some(line => line.includes('polyspec/orm')), 'the composer name is named');
  assert.ok(findings.some(line => line.includes('polyspec-orm')), 'the python name is named');
});

test('K468: a clean tracked tree has no finding, and the declarations of config/polyspec.json name the packages that the project consumes', (t) => {
  const root = repository(t, {
    'packages/php/composer.json': JSON.stringify({ name: 'polyspec/fsm', require: { php: '>=8.4', 'psr/log': '^3.0' } }),
    'packages/php/composer.lock': JSON.stringify({ packages: [{ name: 'psr/log', version: '3.0.0' }] }),
    'package.json': JSON.stringify({ devDependencies: { ajv: '8.20.0' } }),
    'config/polyspec.json': JSON.stringify({ packages: [
      { ecosystem: 'composer', project: 'packages/php', name: 'polyspec/orm', repository: 'polyspec/orm' },
      { ecosystem: 'npm', project: '.', name: '@polyspec/kit', repository: 'polyspec/kit' },
    ] }),
  });
  assert.deepEqual(polyspecLockFindings(root), []);
});

test('K473: a declaration names its repository as owner/name, which the gates workflow clones beside the project', (t) => {
  const root = repository(t, {
    'packages/php/composer.json': JSON.stringify({ name: 'polyspec/fsm', require: { php: '>=8.4' } }),
    'config/polyspec.json': JSON.stringify({ packages: [
      { ecosystem: 'composer', project: 'packages/php', name: 'polyspec/orm' },
      { ecosystem: 'composer', project: 'packages/php', name: 'polyspec/ordered-json', repository: 'https://github.com/polyspec/ordered-json' },
    ] }),
  });
  const findings = polyspecLockFindings(root);
  assert.ok(findings.length >= 2, findings.join('\n'));
  for (const finding of findings) assert.match(finding, /^config\/polyspec\.json:/);
  assert.ok(findings.some(finding => finding.includes('/packages/0')), 'the declaration without a repository is named');
  assert.ok(findings.some(finding => finding.includes('/packages/1/repository')), 'the URL is named as no owner/name');
});

test('K468: a declaration whose project folder lacks the manifest of its ecosystem is a finding', (t) => {
  const root = repository(t, {
    'package.json': JSON.stringify({}),
    'config/polyspec.json': JSON.stringify({ packages: [{ ecosystem: 'python', project: 'packages/python', name: 'polyspec-orm', repository: 'polyspec/orm' }] }),
  });
  const findings = polyspecLockFindings(root);
  assert.equal(findings.length, 1, findings.join('\n'));
  assert.match(findings[0] ?? '', /packages\/python\/pyproject\.toml/);
});

test('K468: a declaration of the wrong ecosystem, or a project that climbs out of the repository, fails the schema of config/polyspec.json', (t) => {
  const root = repository(t, {
    'config/polyspec.json': JSON.stringify({ packages: [{ ecosystem: 'npm', project: '../outside', name: 'polyspec/orm' }] }),
  });
  const findings = polyspecLockFindings(root);
  assert.ok(findings.length >= 2, findings.join('\n'));
  for (const finding of findings) assert.match(finding, /^config\/polyspec\.json:/);
  assert.ok(findings.some(finding => finding.includes('/packages/0/name')), 'the wrong-ecosystem name is named');
  assert.ok(findings.some(finding => finding.includes('/packages/0/project')), 'the climbing project is named');
});

test('K468: a file that is not tracked is not checked, so a local link file names a polyspec package without a finding', (t) => {
  const root = repository(t, { 'package.json': JSON.stringify({}) }, {
    'composer.link.json': JSON.stringify({ require: { 'polyspec/orm': '*' } }),
    'var/link/package.json': JSON.stringify({ dependencies: { '@polyspec/kit': '*' } }),
  });
  assert.deepEqual(polyspecLockFindings(root), []);
});
