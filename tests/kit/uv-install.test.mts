// Native uv owns the lock, installation and dependency validation; kit links the installed package folders. The fixture uv records commands.
import assert from 'node:assert/strict';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { uvInstallCommand, uvLink } from '../../scripts/kit/uv-install.mts';

function fixture(t: { after: (fn: () => void) => void }) {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-uv-native-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const site = path.join(root, '.venv/lib/python3.14/site-packages');
  mkdirSync(path.join(site, 'polyspec_new_unreleased'), { recursive: true });
  writeFileSync(path.join(root, '.venv/pyvenv.cfg'), 'native fixture environment\n');
  const checkout = path.join(root, 'provider');
  mkdirSync(path.join(checkout, 'src/polyspec_new_unreleased'), { recursive: true });
  writeFileSync(path.join(checkout, 'pyproject.toml'), '[project]\nname = "polyspec-new-unreleased"\nversion = "0.0.2"\n');
  writeFileSync(path.join(checkout, 'src/polyspec_new_unreleased/__init__.py'), 'value = "checkout"\n');
  const log = path.join(root, 'commands');
  const uv = path.join(root, 'uv');
  writeFileSync(path.join(root, 'pyproject.toml'), '[project]\nname = "consumer"\nversion = "0.0.0"\ndependencies = ["polyspec-new-unreleased"]\n');
  // The fixture sync writes the release files into the package folder, as uv does, through a link that is still there.
  writeFileSync(uv, `#!/bin/sh\nprintf '%s\\n' "$*" >> '${log}'\nif [ "$1 $2" = "workspace dir" ]; then if [ "$3" = --project ]; then (cd "$4" && pwd -P); else pwd -P; fi; fi\nif [ "$1" = sync ] && [ -z "$UV_FIXTURE_KEEP" ]; then mkdir -p '${site}/polyspec_new_unreleased' && echo release > '${site}/polyspec_new_unreleased/RELEASE'; fi\nif [ "$1 $2" = "pip check" ] && [ "$UV_FIXTURE_CONFLICT" = yes ]; then echo 'incompatible native dependency requirement' >&2; exit 1; fi\n`);
  chmodSync(uv, 0o755);
  const provider = { ecosystem: 'python' as const, name: 'polyspec-new-unreleased', folder: checkout, repository: checkout, checkout };
  return { root, log, uv, site, checkout, provider, env: { ...process.env, UV: uv, UV_PROJECT_ENVIRONMENT: '.venv' } };
}

test('K765: the link makes the installed package folder one link to the checkout, with no uv install and the dependency check', { timeout: 30_000 }, (t) => {
  const { root, log, uv, site, checkout, provider, env } = fixture(t);
  assert.deepEqual(uvLink({ directory: root, uv, env, providers: [provider, { ...provider, name: 'unused-sibling', folder: '/unused-sibling' }] }), ['polyspec-new-unreleased']);
  const folder = path.join(site, 'polyspec_new_unreleased');
  assert.ok(lstatSync(folder).isSymbolicLink());
  assert.equal(realpathSync(folder), path.join(checkout, 'src/polyspec_new_unreleased'));
  assert.deepEqual(readFileSync(log, 'utf8').trim().split('\n').map(command => command.split(' --python')[0]), ['workspace dir', 'pip check']);
  assert.deepEqual(uvLink({ directory: root, uv, env }), [], 'no provider, no link');
});

test('K664-1: incompatible native dependency checks are failures with development declaration guidance', { timeout: 30_000 }, (t) => {
  const { root, uv, env } = fixture(t);
  assert.throws(() => uvLink({ directory: root, uv, env: { ...env, UV_FIXTURE_CONFLICT: 'yes' } }), /ensure each local provider is compatible.*incompatible native dependency requirement/s);
});

// K850: uv validates its own flags, so SYNC reaches uv sync as the repository wrote it, values included; the links go before the sync
// whatever the flags, so no flag lets uv write through a link into the development folder.
test('K850: the command passes SYNC to uv sync as written, with flag values, and the development folder stays unchanged', { timeout: 30_000 }, (t) => {
  const { root, log, uv, site, checkout, provider, env } = fixture(t);
  uvLink({ directory: root, uv, env, providers: [provider] });
  const before = readFileSync(path.join(checkout, 'src/polyspec_new_unreleased/__init__.py'), 'utf8');
  const lines: string[] = [];
  const sync = '--quiet --all-packages --no-editable --group dev --project . --no-install-project';
  assert.equal(uvInstallCommand([root, checkout], { ...env, UV_SYNC: sync }, line => lines.push(line)), 0, lines.join(''));
  assert.match(readFileSync(log, 'utf8'), new RegExp(`^sync --locked ${sync}$`, 'm'));
  assert.equal(existsSync(path.join(checkout, 'src/polyspec_new_unreleased/RELEASE')), false, 'the sync wrote no file into the checkout');
  assert.equal(readFileSync(path.join(checkout, 'src/polyspec_new_unreleased/__init__.py'), 'utf8'), before);
  assert.equal(realpathSync(path.join(site, 'polyspec_new_unreleased')), path.join(checkout, 'src/polyspec_new_unreleased'));
});

// K850: --project of SYNC makes uv sync another project, so the links of that project's environment go before the sync.
test('K850: the links of the project that --project of SYNC names go before the sync, so uv writes no checkout through them', { timeout: 30_000 }, (t) => {
  const other = fixture(t);
  const { root, env } = fixture(t);
  uvLink({ directory: other.root, uv: other.uv, env: other.env, providers: [other.provider] });
  const lines: string[] = [];
  assert.equal(uvInstallCommand([root, other.checkout], { ...env, UV: other.uv, UV_SYNC: `--project ${other.root}` }, line => lines.push(line)), 0, lines.join(''));
  assert.equal(existsSync(path.join(other.checkout, 'src/polyspec_new_unreleased/RELEASE')), false, 'the sync wrote no file into the checkout');
  assert.equal(realpathSync(path.join(other.site, 'polyspec_new_unreleased')), path.join(other.checkout, 'src/polyspec_new_unreleased'));
});

test('K765, K539: the installer removes the links before uv syncs, so uv writes no checkout, and links the synced folder', { timeout: 30_000 }, (t) => {
  const { root, uv, site, checkout, provider, env } = fixture(t);
  uvLink({ directory: root, uv, env, providers: [provider] });
  const lines: string[] = [];
  assert.equal(uvInstallCommand([root, checkout], env, line => lines.push(line)), 0, lines.join(''));
  assert.equal(existsSync(path.join(checkout, 'src/polyspec_new_unreleased/RELEASE')), false, 'the sync wrote no file into the checkout');
  assert.equal(realpathSync(path.join(site, 'polyspec_new_unreleased')), path.join(checkout, 'src/polyspec_new_unreleased'));
  assert.match(lines.join(''), /linked sources: polyspec-new-unreleased/);
});

test('K689-3: the link never syncs the lock', { timeout: 30_000 }, (t) => {
  const { root, uv, env, log } = fixture(t);
  uvLink({ directory: root, uv, env });
  assert.doesNotMatch(readFileSync(log, 'utf8'), /^sync /m);
});

test('K888: the link leaves out a project without its environment, as a project that is not installed', { timeout: 30_000 }, (t) => {
  const { root, uv, env, log, provider } = fixture(t);
  rmSync(path.join(root, '.venv'), { recursive: true });
  const lines: string[] = [];
  assert.deepEqual(uvLink({ directory: root, uv, env, providers: [provider], print: line => lines.push(line) }), []);
  assert.match(lines.join('\n'), /no environment at .*\.venv; the project is not installed, so nothing is linked/);
  assert.equal(existsSync(path.join(root, '.venv')), false, 'the link creates no environment');
  assert.doesNotMatch(readFileSync(log, 'utf8'), /^(sync|pip) /m);
});

test('K772: the installer links a package folder that uv sync left missing, since the distribution is installed', { timeout: 30_000 }, (t) => {
  const { root, uv, site, checkout, provider, env } = fixture(t);
  uvLink({ directory: root, uv, env, providers: [provider] });
  mkdirSync(path.join(site, 'polyspec_new_unreleased-0.0.1.dist-info'));
  // uv sync keeps the installed distribution and writes no folder, as for python-server: the fixture uv writes nothing here.
  const lines: string[] = [];
  assert.equal(uvInstallCommand([root, checkout], { ...env, UV_FIXTURE_KEEP: 'yes' }, line => lines.push(line)), 0, lines.join(''));
  assert.equal(realpathSync(path.join(site, 'polyspec_new_unreleased')), path.join(checkout, 'src/polyspec_new_unreleased'));
});

// K856: unlink only removes the links, so a release consumer's package folder is missing while its dist-info stays; uv keeps an
// installed distribution as it is, so make install reinstalls each distribution that misses a file of its RECORD.
test('K856: the installer reinstalls a distribution whose package folder a removed link left missing', { timeout: 30_000 }, (t) => {
  const { root, log, site, env } = fixture(t);
  mkdirSync(path.join(site, 'polyspec_new_unreleased-0.0.1.dist-info'), { recursive: true });
  writeFileSync(path.join(site, 'polyspec_new_unreleased-0.0.1.dist-info/RECORD'), 'polyspec_new_unreleased/__init__.py,,\npolyspec_new_unreleased-0.0.1.dist-info/RECORD,,\n../../../bin/tool,,\n');
  rmSync(path.join(site, 'polyspec_new_unreleased'), { recursive: true });
  const lines: string[] = [];
  assert.equal(uvInstallCommand([root], { ...env, UV_FIXTURE_KEEP: 'yes' }, line => lines.push(line)), 0, lines.join(''));
  assert.match(readFileSync(log, 'utf8'), /^sync --locked --reinstall-package polyspec_new_unreleased$/m);
  mkdirSync(path.join(site, 'polyspec_new_unreleased'));
  writeFileSync(path.join(site, 'polyspec_new_unreleased/__init__.py'), '');
  rmSync(log);
  assert.equal(uvInstallCommand([root], { ...env, UV_FIXTURE_KEEP: 'yes' }, line => lines.push(line)), 0, lines.join(''));
  assert.match(readFileSync(log, 'utf8'), /^sync --locked$/m, 'a complete distribution is not reinstalled');
});
