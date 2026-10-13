// The real layout check: make layout-check runs the alint of var/tools (make install-tools TOOLS=alint) on a repository whose
// config/layout.yml extends the config/layout.kit.yml of this checkout with its map. A repository that follows S5, S7 and S9
// passes; each violation planted into a copy of it fails with the rule that names it. Nothing is stubbed.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ALINT = path.join(ROOT, 'var/tools/bin/alint');

// The map of the repository demo: the component codec has ports, and the root tests/ holds the parity runner.
const LAYOUT = `version: 1
extends:
  - layout.kit.yml
rules:
  - extends_template: no-repository-prefix
    id: layout-no-repository-prefix
    vars: { repo: demo }
  - extends_template: go-module-path
    id: layout-go-module-path
    vars: { repo: demo }
  - extends_template: component-ports
    id: layout-codec-ports
    vars: { component: codec }
  - id: layout-packages
    paths: ["packages/*", "!packages/go", "!packages/php", "!packages/php-ext", "!packages/python", "!packages/rust", "!packages/ts", "!packages/js", "!packages/codec"]
  - id: layout-root-tests
    paths: ["tests/*", "!tests/kit", "!tests/parity"]
`;

// A repository that follows the layout: its path dependencies stay inside it, and a Go module at v2 ends in /v2.
const GOOD: Record<string, string> = {
  'README.md': '# demo\n',
  'Makefile': 'KIT := scripts/kit\nKIT_EXT := mts\ninclude scripts/kit/kit.mk\n',
  '.gitignore': 'var/\n',
  'config/layout.yml': LAYOUT,
  'config/parity.json': JSON.stringify({ implementations: [{ name: 'go', roots: ['packages/go'] }] }),
  'packages/go/go.mod': 'module github.com/polyspec/demo/packages/go\n\ngo 1.27.2\n\nreplace github.com/polyspec/demo/packages/codec/go/v2 => ../codec/go\n',
  'packages/codec/go/go.mod': 'module github.com/polyspec/demo/packages/codec/go/v2\n\ngo 1.27.2\n',
  'packages/codec/ts/package.json': JSON.stringify({ name: '@polyspec/demo-codec' }),
  'packages/ts/package.json': JSON.stringify({ name: '@polyspec/demo', dependencies: { '@polyspec/demo-codec': 'file:../codec/ts' } }),
  'packages/python/pyproject.toml': '[project]\nname = "polyspec-demo"\n\n[tool.uv.sources]\ndemo-codec = { path = "../codec/python" }\n',
  'packages/codec/python/pyproject.toml': '[project]\nname = "polyspec-demo-codec"\n',
  'packages/rust/Cargo.toml': '[package]\nname = "demo"\n\n[dependencies]\ncodec = { path = "../codec/rust" }\n',
  'packages/codec/rust/Cargo.toml': '[package]\nname = "demo-codec"\n',
  'packages/php/composer.json': JSON.stringify({ name: 'polyspec/demo', repositories: [{ type: 'path', url: '../codec/php' }] }),
  'packages/codec/php/composer.json': JSON.stringify({ name: 'polyspec/demo-codec' }),
  'scripts/build.mts': '#!/usr/bin/env node\nconsole.log("build");\n',
  'tests/parity/run.mts': 'console.log("parity");\n',
  'docs/a.md': '# a\n',
  'contracts/vectors.json': '{}\n',
};

// One violation for each rule: the files it adds or replaces, and the rule that must name it.
const OUTSIDE = '../../../outside';
const VIOLATIONS: { rule: string; files: Record<string, string> }[] = [
  { rule: 'layout-root-folders', files: { 'tools/gen.mts': 'x\n' } },
  { rule: 'layout-root-files', files: { 'notes.txt': 'x\n' } },
  { rule: 'layout-packages', files: { 'packages/widget/index.ts': 'x\n' } },
  { rule: 'layout-packages-files', files: { 'packages/README.md': '# packages\n' } },
  { rule: 'layout-codec-ports', files: { 'packages/codec/java/A.java': 'class A {}\n' } },
  { rule: 'layout-no-repository-prefix', files: { 'packages/codec/demo-go/go.mod': 'module github.com/polyspec/demo/packages/codec/demo-go\n' } },
  { rule: 'layout-go-module-path', files: { 'packages/go/go.mod': 'module github.com/polyspec/demo-go\n\ngo 1.27.2\n' } },
  { rule: 'layout-root-tests', files: { 'tests/unit/a.test.mts': 'x\n' } },
  { rule: 'layout-no-pythonpath', files: { 'config/parity.json': JSON.stringify({ implementations: [{ name: 'python', env: [{ name: 'PYTHONPATH', value: 'packages/python/src' }] }] }) } },
  { rule: 'layout-config-paths', files: { 'config/parity.json': JSON.stringify({ implementations: [{ name: 'go', roots: ['../other/packages/go'] }] }) } },
  { rule: 'layout-go-replace', files: { 'packages/go/go.mod': `module github.com/polyspec/demo/packages/go\n\nreplace example.com/x => ${OUTSIDE}\n` } },
  { rule: 'layout-npm-file', files: { 'packages/ts/package.json': JSON.stringify({ name: '@polyspec/demo', dependencies: { x: `file:${OUTSIDE}` } }) } },
  { rule: 'layout-python-path', files: { 'packages/python/pyproject.toml': `[project]\nname = "polyspec-demo"\n\n[tool.uv.sources]\nx = { path = "${OUTSIDE}" }\n` } },
  { rule: 'layout-cargo-path', files: { 'packages/rust/Cargo.toml': `[package]\nname = "demo"\n\n[dependencies]\nx = { path = "${OUTSIDE}" }\n` } },
  { rule: 'layout-composer-path', files: { 'packages/php/composer.json': JSON.stringify({ name: 'polyspec/demo', repositories: [{ type: 'path', url: OUTSIDE }] }) } },
  { rule: 'layout-infrastructure-typescript', files: { 'scripts/build.py': 'print("build")\n' } },
  { rule: 'layout-infrastructure-shebang', files: { 'scripts/run': '#!/bin/sh\necho run\n' } },
];

/** Writes `files` below `root`. */
function write(root: string, files: Record<string, string>) {
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  }
}

/**
 * A repository in a temporary folder: GOOD with `files` over it, the layout files and kit.mk of this checkout, the alint of
 * this checkout as its var/tools/bin/alint, and a folder outside it that the planted paths name, so a path leaves a
 * repository whose target exists.
 */
function repository(t: { after: (fn: () => void) => void }, files: Record<string, string> = {}): string {
  const folder = mkdtempSync(path.join(tmpdir(), 'kit-layout-real-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  mkdirSync(path.join(folder, 'outside'));
  const root = path.join(folder, 'a', 'b', 'demo');
  write(root, { ...GOOD, ...files });
  copyFileSync(path.join(ROOT, 'config/layout.kit.yml'), path.join(root, 'config/layout.kit.yml'));
  cpSync(path.join(ROOT, 'scripts/kit/kit.mk'), path.join(root, 'scripts/kit/kit.mk'));
  mkdirSync(path.join(root, 'var/tools/bin'), { recursive: true });
  symlinkSync(ALINT, path.join(root, 'var/tools/bin/alint'));
  const init = spawnSync('git', ['init', '--quiet'], { cwd: root, encoding: 'utf8' });
  assert.equal(init.status, 0, init.stderr);
  return root;
}

const layoutCheck = (root: string) => spawnSync('make', ['--no-print-directory', 'layout-check'], { cwd: root, encoding: 'utf8' });

test('make layout-check passes on a repository that follows the layout', (t) => {
  assert.ok(existsSync(ALINT), `${path.relative(ROOT, ALINT)} is missing; make install-tools TOOLS=alint installs the alint of config/toolchain.json`);
  const result = layoutCheck(repository(t));
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  assert.match(result.stdout, /all rules passed/);
});

test('make layout-check fails on each planted violation with the rule that names it', (t) => {
  assert.ok(existsSync(ALINT), `${path.relative(ROOT, ALINT)} is missing; make install-tools TOOLS=alint installs the alint of config/toolchain.json`);
  for (const { rule, files } of VIOLATIONS) {
    const result = layoutCheck(repository(t, files));
    const output = `${result.stdout}${result.stderr}`;
    assert.notEqual(result.status, 0, `${rule}: the violation passed:\n${output}`);
    assert.match(output, new RegExp(`: error: ${rule}: `), `${rule} is not named:\n${output}`);
  }
});

test('make layout-check passes on this checkout', () => {
  const result = layoutCheck(ROOT);
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
});
