// The Node.js of a checkout is the node of its mise.toml, which the bootstrap installs into var/tools with mise (K171): a
// recipe of kit.mk that starts $(NODE), a command that node starts by its name, and the npm wrapper outside make all run it,
// never the node of the machine, so one checkout's Node.js never changes another's. make 3.81 looks up a recipe line without
// shell syntax on the PATH that it started with, so a recipe `node -p process.execPath` printed the node of the machine there.
// Runs the make, the mise and the node of this checkout, after make install-tools TOOLS=npm.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { declaredToolchain } from '../../scripts/kit/bootstrap/toolchain-declared.mts';
import { declaredMiseTools } from '../../scripts/kit/toolchain-mise.mts';
import { known } from '../kit/known.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// The output of a recipe of kit.mk: a target of a second makefile, read from standard input after the Makefile of the checkout.
function recipe(command: string): string {
  const result = spawnSync('make', ['-s', '-C', ROOT, '-f', 'Makefile', '-f', '-', 'kit-node-probe'], { input: `kit-node-probe:\n\t@${command}\n`, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

test('a recipe of kit.mk that starts $(NODE) runs the node of mise.toml from var/tools, not the node of the machine', () => {
  const node = known(declaredMiseTools(ROOT).node, 'the node of mise.toml');
  const [executable, version] = recipe(`$(NODE) -p "[process.execPath, process.version].join(' ')"`).split(' ');
  assert.ok(executable?.startsWith(path.join(ROOT, 'var/tools/mise/installs/node/')), `the recipe ran ${executable}`);
  assert.equal(version, `v${node.version}`);
});

test('a command npm that node starts by its name is the npm of packageManager, not the npm that Node.js bundles', () => {
  const declared = known(declaredToolchain(ROOT).npm, 'the npm of packageManager').version;
  assert.equal(recipe(`$(NODE) -e 'process.stdout.write(require("node:child_process").execSync("npm --version", { encoding: "utf8" }))'`), declared);
});

test('the npm wrapper runs with the node of the checkout when no node is on PATH', () => {
  const result = spawnSync(path.join(ROOT, 'var/tools/bin/npm'), ['exec', '--', 'node', '-p', 'process.execPath'], { cwd: ROOT, env: { HOME: process.env.HOME ?? '', PATH: '/usr/bin:/bin' }, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.trim().startsWith(path.join(ROOT, 'var/tools/mise/installs/node/')), `npm ran ${result.stdout.trim()}`);
});
