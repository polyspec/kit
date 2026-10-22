// K448: `make uv-install` runs uv sync of the tracked uv.lock as it is, then replaces each installed package of site-packages that a checkout
// provides with a direct symlink to the package folder of the checkout. The packages of one namespace link apart, and no editable wheel or
// version is involved. The uv of these tests is a stub: its sync installs each package of SITE as a copy, as a release would be.
import assert from 'node:assert/strict';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { uvInstallCommand } from '../../scripts/kit/uv-install.mts';

const SITE = '.venv/lib/python3.14/site-packages';

/** A root with the project app and a stub uv whose sync logs its arguments and installs `installed` (package paths) as copies. */
function fixture(t: { after: (fn: () => void) => void }, installed: string[]) {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-uv-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const project = path.join(root, 'app');
  mkdirSync(project, { recursive: true });
  writeFileSync(path.join(project, 'pyproject.toml'), '[project]\nname = "app"\nversion = "0"\n');
  writeFileSync(path.join(project, 'uv.lock'), 'version = 1\n');
  const log = path.join(root, 'uv.log');
  const script = path.join(root, 'uv.mjs');
  writeFileSync(script, `import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
appendFileSync(${JSON.stringify(log)}, process.argv.slice(2).join(' ') + '\\n');
// The environment is the one of UV_PROJECT_ENVIRONMENT, else .venv, as uv takes it.
const site = path.join(process.env.UV_PROJECT_ENVIRONMENT ?? '.venv', ${JSON.stringify(SITE.replace('.venv/', ''))});
// K544: with STUB_DIST_INFO, a package counts as installed by its record, as real uv counts its dist-info: 1 reinstalls it only for
// --reinstall-package, and never reinstalls it at all.
const record = process.env.STUB_DIST_INFO;
const reinstall = process.argv.includes('--reinstall-package');
if (process.argv[2] === 'sync') for (const item of ${JSON.stringify(installed)}) {
  if (record === 'never' || (record === '1' && !reinstall)) continue;
  mkdirSync(path.join(site, item), { recursive: true });
  writeFileSync(path.join(site, item, '__init__.py'), '# release copy\\n');
}
`);
  const uv = path.join(root, 'uv');
  writeFileSync(uv, `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(script)} "$@"\n`, { mode: 0o755 });
  return { root, project, log, env: { ...process.env, UV: uv } };
}

/** A checkout at `folder` that provides the Python project `name` with the packages `packages` under src/. */
function provider(folder: string, name: string, packages: string[]) {
  mkdirSync(folder, { recursive: true });
  writeFileSync(path.join(folder, 'pyproject.toml'), `[project]\nname = "${name}"\nversion = "0.0.1"\n`);
  for (const item of packages) {
    mkdirSync(path.join(folder, 'src', item), { recursive: true });
    writeFileSync(path.join(folder, 'src', item, '__init__.py'), '# source\n');
  }
  return folder;
}

const run = (args: string[], env: NodeJS.ProcessEnv) => {
  let output = '';
  const status = uvInstallCommand(args, env, (text) => { output += text; });
  return { status, output };
};

test('uv install syncs the tracked lock, then links each provided package of site-packages to its checkout, whatever its name (K448)', (t) => {
  const { root, project, log, env } = fixture(t, ['polyspec/orm', 'polyspec/ordered_json', 'limepie_contracts', 'requests']);
  const orm = provider(path.join(root, 'orm/packages/python'), 'polyspec-orm', ['polyspec/orm']);
  const contracts = provider(path.join(root, 'contracts'), 'limepie-contracts', ['limepie_contracts']);
  const { status, output } = run([project, orm, contracts], env);
  assert.equal(status, 0, output);
  assert.equal(readFileSync(log, 'utf8'), 'sync --frozen\n', 'uv sync of the tracked lock is the only uv run');
  const site = path.join(project, SITE);
  assert.equal(realpathSync(path.join(site, 'polyspec/orm/__init__.py')), realpathSync(path.join(orm, 'src/polyspec/orm/__init__.py')), 'a namespace package links to the files of its own source folder (K541)');
  assert.equal(lstatSync(path.join(site, 'polyspec')).isSymbolicLink(), false, 'the namespace folder itself stays, so its other packages stay');
  assert.equal(lstatSync(path.join(site, 'polyspec/ordered_json')).isDirectory(), true, 'a package that no given checkout provides stays as installed');
  assert.equal(realpathSync(path.join(site, 'limepie_contracts/__init__.py')), realpathSync(path.join(contracts, 'src/limepie_contracts/__init__.py')), 'a checkout of any name links');
  assert.equal(lstatSync(path.join(site, 'requests')).isDirectory(), true, 'a third-party package stays as installed');
});

test('uv install passes --no-install-project and --all-groups to its sync, and refuses another sync flag before uv runs (K487)', (t) => {
  const { root, project, log, env } = fixture(t, []);
  // A checkout is given, so no sibling of the temporary folder is searched.
  const none = path.join(root, 'none');
  mkdirSync(none);
  assert.equal(run([project, none], { ...env, UV_SYNC: '--no-install-project --all-groups' }).status, 0);
  assert.equal(readFileSync(log, 'utf8'), 'sync --frozen --no-install-project --all-groups\n');
  const refused = run([project, none], { ...env, UV_SYNC: '--reinstall' });
  assert.equal(refused.status, 1);
  assert.match(refused.output, /SYNC takes --no-install-project and --all-groups, not --reinstall/);
  assert.equal(readFileSync(log, 'utf8'), 'sync --frozen --no-install-project --all-groups\n', 'no uv runs for a refused flag');
});

// K448-14: the environment of the project is the one that uv syncs, UV_PROJECT_ENVIRONMENT when it is set (limepie's python/var/venv),
// so its packages are linked; .venv is only uv's default.
test('uv install links the packages of the environment that UV_PROJECT_ENVIRONMENT names (K448-14)', (t) => {
  const { root, project, env } = fixture(t, ['polyspec/orm']);
  const orm = provider(path.join(root, 'orm/packages/python'), 'polyspec-orm', ['polyspec/orm']);
  const { status, output } = run([project, orm], { ...env, UV_PROJECT_ENVIRONMENT: 'var/venv' });
  assert.equal(status, 0, output);
  const installed = path.join(project, 'var/venv/lib/python3.14/site-packages/polyspec/orm');
  assert.equal(lstatSync(path.join(installed, '__init__.py')).isSymbolicLink(), true, output);
  assert.equal(realpathSync(path.join(installed, '__init__.py')), realpathSync(path.join(orm, 'src/polyspec/orm/__init__.py')));
  assert.match(output, /linked polyspec-orm polyspec\/orm/);
});

// K518: a uv workspace root that a checkout names provides its members too, from [tool.uv.workspace] members of its pyproject.toml:
// limepie's python root declares the member contracts, the package limepie-contracts, which the unit venvs install as a copy.
test('uv install links the installed member of a uv workspace root that a checkout names (K518)', (t) => {
  const { root, project, env } = fixture(t, ['limepie/contracts', 'polyspec/orm']);
  const workspace = provider(path.join(root, 'limepie-python'), 'limepie-server', ['polyspec/orm']);
  writeFileSync(path.join(workspace, 'pyproject.toml'), '[project]\nname = "limepie-server"\nversion = "0"\n\n[tool.uv.workspace]\nmembers = ["contracts"]\n');
  const member = provider(path.join(workspace, 'contracts'), 'limepie-contracts', ['limepie/contracts']);
  const { status, output } = run([project, workspace], env);
  assert.equal(status, 0, output);
  const site = path.join(project, SITE);
  assert.equal(lstatSync(path.join(site, 'limepie/contracts/__init__.py')).isSymbolicLink(), true, output);
  assert.equal(realpathSync(path.join(site, 'limepie/contracts/__init__.py')), realpathSync(path.join(member, 'src/limepie/contracts/__init__.py')));
  assert.equal(realpathSync(path.join(site, 'polyspec/orm/__init__.py')), realpathSync(path.join(workspace, 'src/polyspec/orm/__init__.py')), 'the root links its own packages as before');
  writeFileSync(path.join(workspace, 'pyproject.toml'), '[project]\nname = "limepie-server"\nversion = "0"\n\n[tool.uv.workspace]\nmembers = ["missing"]\n');
  const broken = run([project, workspace], env);
  assert.notEqual(broken.status, 0);
  assert.match(broken.output, /member missing of the uv workspace .*limepie-python names no folder with a pyproject\.toml/);
});

// K544: uv-install releases the package links before uv sync (K539), and uv sync reinstalls no package whose dist-info is still there, so
// a package that was a directory link is gone after it; uv-install reinstalls each provided package that was installed, and fails, naming
// it, when one ends without its folder.
test('uv install reinstalls each provided package whose link it releases, and fails on one that ends without its folder (K544)', (t) => {
  const { root, project, log, env } = fixture(t, ['polyspec/orm']);
  const orm = provider(path.join(root, 'orm/packages/python'), 'polyspec-orm', ['polyspec/orm']);
  assert.equal(run([project, orm], env).status, 0);
  // The layout before K541: the package folder is one directory link into the checkout.
  const folder = path.join(project, SITE, 'polyspec/orm');
  rmSync(folder, { recursive: true });
  symlinkSync(path.join(orm, 'src/polyspec/orm'), folder);
  writeFileSync(log, '');
  const again = run([project, orm], { ...env, STUB_DIST_INFO: '1' });
  assert.equal(again.status, 0, again.output);
  assert.match(readFileSync(log, 'utf8'), /^sync --frozen --reinstall-package polyspec-orm$/m, 'the released package is reinstalled');
  assert.equal(realpathSync(path.join(folder, '__init__.py')), realpathSync(path.join(orm, 'src/polyspec/orm/__init__.py')), 'and linked again');
  rmSync(folder, { recursive: true });
  symlinkSync(path.join(orm, 'src/polyspec/orm'), folder);
  const lost = run([project, orm], { ...env, STUB_DIST_INFO: 'never' });
  assert.equal(lost.status, 1, lost.output);
  assert.match(lost.output, /polyspec-orm .*has no folder in the environment after uv sync/);
});

// K545: uv counts a package as installed by its dist-info, so a provided package whose folder is gone while its dist-info stays, as after a
// run that released the links and reinstalled nothing, is held: uv-install reinstalls it and links it, and fails, naming it, when it ends
// without its folder. A provided package with no dist-info is not installed in the environment and is left alone.
test('uv install reinstalls a provided package whose dist-info stays without its folder (K545)', (t) => {
  const { root, project, log, env } = fixture(t, ['polyspec/orm']);
  const orm = provider(path.join(root, 'orm/packages/python'), 'polyspec-orm', ['polyspec/orm']);
  assert.equal(run([project, orm], env).status, 0);
  const folder = path.join(project, SITE, 'polyspec/orm');
  rmSync(folder, { recursive: true });
  mkdirSync(path.join(project, SITE, 'polyspec_orm-0.0.1.dist-info'), { recursive: true });
  writeFileSync(log, '');
  const again = run([project, orm], { ...env, STUB_DIST_INFO: '1' });
  assert.equal(again.status, 0, again.output);
  assert.match(readFileSync(log, 'utf8'), /^sync --frozen --reinstall-package polyspec-orm$/m, 'the held package is reinstalled');
  assert.equal(realpathSync(path.join(folder, '__init__.py')), realpathSync(path.join(orm, 'src/polyspec/orm/__init__.py')), 'and linked');
  rmSync(folder, { recursive: true });
  const lost = run([project, orm], { ...env, STUB_DIST_INFO: 'never' });
  assert.equal(lost.status, 1, lost.output);
  assert.match(lost.output, /polyspec-orm .*has no folder in the environment after uv sync/);
});
