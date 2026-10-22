// K448: `make uv-install` runs uv sync of the tracked uv.lock as it is, then replaces each installed package of site-packages that a checkout
// provides with a direct symlink to the package folder of the checkout. The packages of one namespace link apart, and no editable wheel or
// version is involved. The uv of these tests is a stub: its sync installs each package of SITE as a copy, as a release would be.
import assert from 'node:assert/strict';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
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
if (process.argv[2] === 'sync') for (const item of ${JSON.stringify(installed)}) {
  mkdirSync(path.join(${JSON.stringify(SITE)}, item), { recursive: true });
  writeFileSync(path.join(${JSON.stringify(SITE)}, item, '__init__.py'), '# release copy\\n');
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
  assert.equal(realpathSync(path.join(site, 'polyspec/orm')), realpathSync(path.join(orm, 'src/polyspec/orm')), 'a namespace package links to its own source folder');
  assert.equal(lstatSync(path.join(site, 'polyspec')).isSymbolicLink(), false, 'the namespace folder itself stays, so its other packages stay');
  assert.equal(lstatSync(path.join(site, 'polyspec/ordered_json')).isDirectory(), true, 'a package that no given checkout provides stays as installed');
  assert.equal(realpathSync(path.join(site, 'limepie_contracts')), realpathSync(path.join(contracts, 'src/limepie_contracts')), 'a checkout of any name links');
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
