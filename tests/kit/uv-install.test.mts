// uv owns locked installation and editable development sources (K657-3). The stub records the native commands;
// it never invokes a package manager, and only uv is responsible for package contents and distribution metadata.
import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { isStringList } from '../../scripts/kit/bootstrap/files.mts';
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
  writeFileSync(path.join(root, 'uv-list.json'), JSON.stringify(installed.map(name => ({ name: name.replaceAll('/', '-') }))));
  const script = path.join(root, 'uv.mjs');
  writeFileSync(script, `import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
appendFileSync(${JSON.stringify(log)}, process.argv.slice(2).join(' ') + '\\n');
if (process.argv[2] === 'pip' && process.argv[3] === 'list') process.stdout.write(readFileSync(${JSON.stringify(path.join(root, 'uv-list.json'))}, 'utf8'));
if (process.argv[2] === 'pip' && process.argv[3] === 'install') {
  const args = process.argv.slice(4);
  const targets = args.flatMap((arg, index) => arg === '--editable' ? [args[index + 1]] : []);
  writeFileSync(${JSON.stringify(path.join(root, 'editable-installs.json'))}, JSON.stringify(targets));
}

// The environment is the one of UV_PROJECT_ENVIRONMENT, else .venv, as uv takes it.
const site = path.join(process.env.UV_PROJECT_ENVIRONMENT ?? '.venv', ${JSON.stringify(SITE.replace('.venv/', ''))});
if (process.argv[2] === 'sync') for (const item of ${JSON.stringify(installed)}) {
  mkdirSync(path.join(site, item), { recursive: true });
  writeFileSync(path.join(site, item, '__init__.py'), '# release copy\\n');
  // The dist-info record of the distribution, which uv writes with each install (K545).
  mkdirSync(path.join(site, item.replaceAll('/', '_') + '-0.0.1.dist-info'), { recursive: true });
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

test('uv refuses legacy package-folder links before an installer can write into the provider source (K657-3)', (t) => {
  const { root, project, log, env } = fixture(t, ['polyspec/orm']);
  const source = provider(path.join(root, 'orm'), 'polyspec-orm', ['polyspec/orm']);
  const namespace = path.join(project, SITE, 'polyspec');
  mkdirSync(namespace, { recursive: true });
  symlinkSync(path.join(source, 'src/polyspec/orm'), path.join(namespace, 'orm'));
  const result = run([project, source], env);
  assert.equal(result.status, 1);
  assert.match(result.output, /legacy Python package links require migration/);
  assert.equal(existsSync(log), false, 'no uv command runs over a legacy linked environment');
  assert.equal(readFileSync(path.join(source, 'src/polyspec/orm/__init__.py'), 'utf8'), '# source\n');
});

test('uv install syncs the tracked lock, then links each provided package of site-packages to its checkout, whatever its name (K448)', (t) => {
  const { root, project, log, env } = fixture(t, ['polyspec/orm', 'polyspec/ordered_json', 'limepie_contracts', 'requests']);
  const orm = provider(path.join(root, 'orm/packages/python'), 'polyspec-orm', ['polyspec/orm']);
  const contracts = provider(path.join(root, 'contracts'), 'limepie-contracts', ['limepie_contracts']);
  const { status, output } = run([project, orm, contracts], env);
  assert.equal(status, 0, output);
  assert.match(readFileSync(log, 'utf8'), /pip install .*--editable/, 'uv owns editable source installation (K657-3)');
  const site = path.join(project, SITE);
  assert.deepEqual(JSON.parse(readFileSync(path.join(root, 'editable-installs.json'), 'utf8')), [orm, contracts], 'uv receives complete distribution roots, not individual namespace package paths');
  assert.equal(lstatSync(path.join(site, 'polyspec')).isSymbolicLink(), false, 'the namespace folder itself stays, so its other packages stay');
  assert.equal(lstatSync(path.join(site, 'polyspec/ordered_json')).isDirectory(), true, 'a package that no given checkout provides stays as installed');
  assert.doesNotMatch(readFileSync(log, 'utf8'), /--no-deps|--no-install-package|--inexact/, 'source requirements are handled by uv');
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
  const { root, project, log, env } = fixture(t, ['polyspec/orm']);
  const orm = provider(path.join(root, 'orm/packages/python'), 'polyspec-orm', ['polyspec/orm']);
  const { status, output } = run([project, orm], { ...env, UV_PROJECT_ENVIRONMENT: 'var/venv' });
  assert.equal(status, 0, output);
  const installed = path.join(project, 'var/venv/lib/python3.14/site-packages/polyspec/orm');
  assert.equal(lstatSync(installed).isDirectory(), true, 'kit does not replace the package folder itself');
  assert.ok(readFileSync(log, 'utf8').includes(`pip install --python ${path.join(project, 'var/venv/bin/python')} --editable ${orm}`));
  assert.match(output, /editable development sources: polyspec-orm/);
});

// K518: a uv workspace root that a checkout names provides its members too, from [tool.uv.workspace] members of its pyproject.toml:
// limepie's python root declares the member contracts, the package limepie-contracts, which the unit venvs install as a copy.
test('uv install links the installed member of a uv workspace root that a checkout names (K518)', (t) => {
  const { root, project, env } = fixture(t, ['limepie/contracts', 'polyspec/orm']);
  writeFileSync(path.join(root, 'uv-list.json'), JSON.stringify([{ name: 'limepie-contracts' }, { name: 'limepie-server' }]));
  const workspace = provider(path.join(root, 'limepie-python'), 'limepie-server', ['polyspec/orm']);
  writeFileSync(path.join(workspace, 'pyproject.toml'), '[project]\nname = "limepie-server"\nversion = "0"\n\n[tool.uv.workspace]\nmembers = ["contracts"]\n');
  const member = provider(path.join(workspace, 'contracts'), 'limepie-contracts', ['limepie/contracts']);
  const { status, output } = run([project, workspace], env);
  assert.equal(status, 0, output);
  const installed: unknown = JSON.parse(readFileSync(path.join(root, 'editable-installs.json'), 'utf8'));
  assert.ok(isStringList(installed), 'uv reports installed editable source paths');
  assert.deepEqual(installed.sort(), [workspace, member].sort(), 'uv installs each distribution of the declared workspace');
  writeFileSync(path.join(workspace, 'pyproject.toml'), '[project]\nname = "limepie-server"\nversion = "0"\n\n[tool.uv.workspace]\nmembers = ["missing"]\n');
  const broken = run([project, workspace], env);
  assert.notEqual(broken.status, 0);
  assert.match(broken.output, /member missing of the uv workspace .*limepie-python names no folder with a pyproject\.toml/);
});

// K657-3: repeated installation lets uv restore the lock and then install native editables without preserving hand-made links.
test('repeated uv install delegates release restoration and editable installation to uv without link-preservation overrides (K657-3)', (t) => {
  const { root, project, log, env } = fixture(t, ['polyspec/orm']);
  const orm = provider(path.join(root, 'orm/packages/python'), 'polyspec-orm', ['polyspec/orm']);
  assert.equal(run([project, orm], env).status, 0);
  const folder = path.join(project, SITE, 'polyspec/orm');
  assert.equal(lstatSync(folder).isDirectory(), true, 'kit leaves package contents to uv');
  writeFileSync(log, '');
  const again = run([project, orm], env);
  assert.equal(again.status, 0, again.output);
  const commands = readFileSync(log, 'utf8').split('\n').filter(Boolean);
  assert.equal(commands[0], 'sync --frozen');
  assert.ok(commands[1]?.startsWith('pip list --python '));
  assert.ok(commands[2]?.includes(`--editable ${orm}`));
  assert.doesNotMatch(commands.join('\n'), /--inexact|--no-install-package|--no-deps/);
  assert.equal(readFileSync(path.join(orm, 'src/polyspec/orm/__init__.py'), 'utf8'), '# source\n', 'the checkout stays');
  assert.doesNotMatch(again.output, /unlinked/);
});
