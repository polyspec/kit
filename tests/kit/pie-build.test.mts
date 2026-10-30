// Tests of scripts/kit/pie-build.mts (`make pie-build`, K915) with a stub PIE: each run starts in an empty PIE working
// directory var/pie/<vendor/name>, adds the one repository, builds, and reports what PIE records in installed.json.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { main } from '../../scripts/kit/pie-build.mts';

const PACKAGE = 'polyspec/example-php-ext';
const PACKAGES = 'https://github.com/polyspec/example/releases/download/v0.0.2/packages.json';

// A checkout with a stub PIE that logs its working directory and arguments; its build writes the installed.json of PIE with
// the library under the build-path `ext` of the package, or what STUB_INSTALLED names.
function checkout(t: Pick<TestContext, 'after'>) {
  const root = mkdtempSync(path.join(tmpdir(), 'kit-pie-build-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const pie = path.join(root, 'stub-pie');
  const log = path.join(root, 'pie.log');
  writeFileSync(pie, `#!/bin/sh
echo "$PIE_WORKING_DIRECTORY $*" >> "${log}"
if [ "$1" = build ]; then
  dir="$PIE_WORKING_DIRECTORY/php8.4_new/vendor/composer"
  mkdir -p "$dir"
  if [ -n "$STUB_INSTALLED" ]; then printf '%s' "$STUB_INSTALLED" > "$dir/installed.json"; else
  printf '{"packages":[{"name":"${PACKAGE}","install-path":"../${PACKAGE}","extra":{"pie-built-binary":"%s"}}],"dev":true}' "$PIE_WORKING_DIRECTORY/php8.4_new/vendor/${PACKAGE}/ext/modules/example.so" > "$dir/installed.json"; fi
fi
`, { mode: 0o755 });
  const out: string[] = [];
  const err: string[] = [];
  const start = (args: string[], env: NodeJS.ProcessEnv = {}) => main(args, { root, env: { ...process.env, PIE: pie, ...env }, print: text => out.push(text), error: text => err.push(text) });
  const calls = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : []);
  return { root, start, out, err, calls };
}

test('pie-build adds the one repository and builds in an empty var/pie/<vendor/name>, and prints what PIE records (K915)', (t) => {
  const { root, start, out, calls } = checkout(t);
  const work = path.join(root, 'var', 'pie', PACKAGE);
  // A kept directory: the build of an earlier PHP and the repository of an earlier version.
  mkdirSync(path.join(work, 'php8.4_old', 'vendor', 'composer'), { recursive: true });
  writeFileSync(path.join(work, 'php8.4_old', 'vendor', 'composer', 'installed.json'), JSON.stringify({ packages: [{ name: PACKAGE, 'install-path': `../${PACKAGE}`, extra: { 'pie-built-binary': '/old/example.so' } }] }));
  writeFileSync(path.join(work, 'php8.4_old', 'pie.json'), JSON.stringify({ repositories: [{ type: 'composer', url: 'https://example.test/v0.0.1/packages.json' }] }));
  assert.equal(start([PACKAGES, PACKAGE, '0.0.2']), 0);
  assert.deepEqual(calls(), [`${work} repository:add composer ${PACKAGES} --no-interaction`, `${work} build ${PACKAGE}:0.0.2 --no-interaction`]);
  assert.equal(existsSync(path.join(work, 'php8.4_old')), false, 'the kept directory is gone');
  assert.deepEqual(out, [`binary ${work}/php8.4_new/vendor/${PACKAGE}/ext/modules/example.so`, `package ${work}/php8.4_new/vendor/${PACKAGE}`]);
});

test('pie-build fails unless PIE records exactly one build of the package, and refuses a name that is no vendor/name (K915)', (t) => {
  const { start, err, out } = checkout(t);
  assert.equal(start([PACKAGES, PACKAGE, '0.0.2'], { STUB_INSTALLED: JSON.stringify({ packages: [{ name: 'other/pkg', 'install-path': '../other/pkg', extra: { 'pie-built-binary': '/x.so' } }] }) }), 1);
  assert.match(err.at(-1) ?? '', /PIE recorded 0 builds of polyspec\/example-php-ext in .*installed\.json, not one/);
  assert.deepEqual(out, []);
  assert.equal(start([PACKAGES, '../escape', '0.0.2']), 1);
  assert.match(err.at(-1) ?? '', /PACKAGE "\.\.\/escape" is not a Composer package name vendor\/name/);
  assert.equal(start([PACKAGES, PACKAGE]), 2);
});
