// The real layout check: make layout-check runs the alint of mise.toml (make install-tools) on a repository whose
// config/layout.yml extends the config/layout.kit.yml of this checkout with its map. A repository that follows S5, S7 and S9
// passes; each violation planted into a copy of it fails with the rule that names it. Nothing is stubbed.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { installedBinary, sandboxShims } from './real-tools.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// The files of kit that the layout rules read: the rules and the schemas of their json_schema_passes rules.
const KIT_FILES = ['config/layout.kit.yml', 'config/pyproject.schema.json', 'config/composer.schema.json', 'config/cargo.schema.json'];
// The alint binary that mise installed for this checkout, which the shim of a sandbox runs.
const ALINT = installedBinary('alint');

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

// The autoload of a library (S2): PSR-4 for the package, autoload-dev PSR-4 for its tests, files for namespaced functions.
const PSR4 = { autoload: { 'psr-4': { 'Polyspec\\Demo\\': 'src/' }, files: ['src/functions.php'] }, 'autoload-dev': { 'psr-4': { 'Polyspec\\Demo\\Tests\\': 'tests/' } } };

// The lints of a Rust workspace (config/cargo.schema.json).
const WORKSPACE_LINTS = '[workspace.lints.rust]\nunsafe_code = "deny"\n\n[workspace.lints.clippy]\nallow_attributes_without_reason = "deny"\n';

// A repository that follows the layout: its path dependencies stay inside it, its Go modules resolve each other through
// go.work, and a Go module at v2 ends in /v2.
const GOOD: Record<string, string> = {
  'README.md': '# demo\n',
  'Makefile': 'KIT := scripts/kit\nKIT_EXT := mts\ninclude scripts/kit/kit.mk\n',
  '.gitignore': 'var/\n',
  'config/layout.yml': LAYOUT,
  'config/parity.json': JSON.stringify({ implementations: [{ name: 'go', roots: ['packages/go'] }] }),
  // The modules of the repository resolve each other through its go.work, never a replace (.golangci.yml, gomoddirectives).
  'go.work': 'go 1.27.2\n\nuse (\n\t./packages/codec/go\n\t./packages/go\n)\n',
  'packages/go/go.mod': 'module github.com/polyspec/demo/packages/go\n\ngo 1.27.2\n\nrequire github.com/polyspec/demo/packages/codec/go/v2 v2.0.0\n',
  'packages/codec/go/go.mod': 'module github.com/polyspec/demo/packages/codec/go/v2\n\ngo 1.27.2\n',
  'packages/codec/ts/package.json': JSON.stringify({ name: '@polyspec/demo-codec' }),
  'packages/ts/package.json': JSON.stringify({ name: '@polyspec/demo', dependencies: { '@polyspec/demo-codec': 'file:../codec/ts' } }),
  'packages/python/pyproject.toml': '[project]\nname = "polyspec-demo"\n\n[tool.uv.sources]\ndemo-codec = { path = "../codec/python" }\n',
  'packages/codec/python/pyproject.toml': '[project]\nname = "polyspec-demo-codec"\n',
  'Cargo.toml': `[workspace]\nmembers = ["packages/rust", "packages/codec/rust"]\n\n${WORKSPACE_LINTS}`,
  'packages/rust/Cargo.toml': '[package]\nname = "demo"\n\n[lints]\nworkspace = true\n\n[dependencies]\ncodec = { path = "../codec/rust" }\n',
  'packages/codec/rust/Cargo.toml': '[package]\nname = "demo-codec"\n\n[lints]\nworkspace = true\n',
  'packages/php/composer.json': JSON.stringify({ name: 'polyspec/demo', repositories: [{ type: 'path', url: '../codec/php' }], ...PSR4 }),
  'packages/codec/php/composer.json': JSON.stringify({ name: 'polyspec/demo-codec', ...PSR4 }),
  // An extension that PIE builds and a consumer project hold no classes of their own.
  'packages/php-ext/composer.json': JSON.stringify({ name: 'polyspec/demo-ext', type: 'php-ext' }),
  'tests/kit/consumer/composer.json': JSON.stringify({ name: 'polyspec/demo-consumer', type: 'project', require: { 'polyspec/demo': '0.0.1' } }),
  'scripts/build.mts': '#!/usr/bin/env node\nconsole.log("build");\n',
  'tests/parity/run.mts': 'console.log("parity");\n',
  'docs/spec/a.md': '# a\n',
  'docs/features.md': '# Features\n',
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
  { rule: 'layout-python-path', files: { 'packages/python/pyproject.toml': `[project]\nname = "polyspec-demo"\n\n[tool.uv.sources]\nx = { path = "${OUTSIDE}" }\n` } },
  { rule: 'layout-cargo-path', files: { 'packages/rust/Cargo.toml': `[package]\nname = "demo"\n\n[lints]\nworkspace = true\n\n[dependencies]\nx = { path = "${OUTSIDE}" }\n` } },
  { rule: 'layout-composer-path', files: { 'packages/php/composer.json': JSON.stringify({ name: 'polyspec/demo', repositories: [{ type: 'path', url: OUTSIDE }], ...PSR4 }) } },
  { rule: 'layout-infrastructure-typescript', files: { 'scripts/build.py': 'print("build")\n' } },
  { rule: 'layout-infrastructure-shebang', files: { 'scripts/run': '#!/bin/sh\necho run\n' } },
  // S2: no classmap or PSR-0, and a library loads its classes and tests by PSR-4.
  { rule: 'lint-composer-policy', files: { 'packages/php/composer.json': JSON.stringify({ name: 'polyspec/demo', autoload: { ...PSR4.autoload, classmap: ['src/'] }, 'autoload-dev': PSR4['autoload-dev'] }) } },
  { rule: 'lint-composer-policy', files: { 'packages/php/composer.json': JSON.stringify({ name: 'polyspec/demo', autoload: PSR4.autoload, 'autoload-dev': { 'psr-0': { 'Polyspec_Demo_Tests_': 'tests/' } } }) } },
  { rule: 'lint-composer-policy', files: { 'packages/php/composer.json': JSON.stringify({ name: 'polyspec/demo', type: 'library', autoload: PSR4.autoload }) } },
  { rule: 'lint-composer-policy', files: { 'packages/php/composer.json': JSON.stringify({ name: 'polyspec/demo', autoload: { files: ['src/functions.php'] }, 'autoload-dev': PSR4['autoload-dev'] }) } },
  { rule: 'lint-composer-policy', files: { 'packages/php-ext/composer.json': JSON.stringify({ name: 'polyspec/demo-ext', type: 'php-ext', autoload: { classmap: ['stubs/'] } }) } },
  // A workspace denies unsafe code and an allow without its reason, and every package takes the lints of its workspace.
  { rule: 'lint-cargo-lints', files: { 'Cargo.toml': '[workspace]\nmembers = ["packages/rust", "packages/codec/rust"]\n' } },
  { rule: 'lint-cargo-lints', files: { 'Cargo.toml': `[workspace]\nmembers = ["packages/rust", "packages/codec/rust"]\n\n${WORKSPACE_LINTS.replace('"deny"', '"warn"')}` } },
  { rule: 'lint-cargo-lints', files: { 'packages/codec/rust/Cargo.toml': '[package]\nname = "demo-codec"\n' } },
  { rule: 'lint-cargo-lints', files: { 'packages/codec/rust/Cargo.toml': '[package]\nname = "demo-codec"\n\n[lints.rust]\nunsafe_code = "allow"\n' } },
  // The Python lint runs ruff with the root ruff.toml, which a nested configuration would escape in an editor or a plain ruff run.
  { rule: 'lint-ruff-nested', files: { 'packages/python/pyproject.toml': '[project]\nname = "polyspec-demo"\n\n[tool.ruff.lint]\nselect = ["E"]\n' } },
  { rule: 'lint-ruff-files', files: { 'packages/python/ruff.toml': '[lint]\nselect = ["E"]\n' } },
  { rule: 'lint-ruff-files', files: { 'packages/python/.ruff.toml': '[lint]\nselect = ["E"]\n' } },
  // A package excludes generated code from vulture and nothing else: no ignored names or decorators, no confidence of its own.
  { rule: 'lint-vulture-config', files: { 'packages/python/pyproject.toml': '[project]\nname = "polyspec-demo"\n\n[tool.vulture]\nignore_names = ["triple"]\n' } },
  // An override of the paths of layout-root-files replaces the list of kit and drops every root file that kit adds later, even
  // while the files of the tree still pass (K145); a repository adds its root files through vars.root_files.
  { rule: 'layout-root-files-additive', files: { 'config/layout.yml': `${LAYOUT}  - id: layout-root-files\n    paths: ["*", "!README.md", "!Makefile", "!.gitignore", "!go.work", "!Cargo.toml"]\n` } },
  // K245: the docs layout, the management files at the root, the tests folder and the language of a runtime folder.
  { rule: 'docs-folders', files: { 'docs/guides/a.md': '# a\n' } },
  { rule: 'docs-files', files: { 'docs/a.md': '# a\n' } },
  { rule: 'management-files-at-root', files: { 'packages/go/CHANGELOG.md': '# Changelog\n' } },
  { rule: 'tests-folder', files: { 'packages/ts/test/a.test.ts': 'export {};\n' } },
  { rule: 'runtime-language', files: { 'packages/js/src/a.ts': 'export {};\n' } },
  // K244: an integration or conformance suite lives under tests/ of the root.
  { rule: 'suites-at-root', files: { 'packages/ts/integration/a.test.ts': 'export {};\n' } },
  // S10: the one stub of the PHP extension lies in packages/php-ext/src/.
  { rule: 'php-ext-stub-place', files: { 'packages/php-ext/stubs/polyspec_demo.stub.php': '<?php\n' } },
];

/** Writes `files` below `root`. */
function write(root: string, files: Record<string, string>) {
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  }
}

/**
 * A repository in a temporary folder: GOOD with `files` over it, the layout files and kit.mk of this checkout, a script that
 * runs the alint of this checkout as its shim var/tools/mise/shims/alint, and a folder outside it that the planted paths
 * name, so a path leaves a repository whose target exists.
 */
function repository(t: { after: (fn: () => void) => void }, files: Record<string, string> = {}): string {
  const folder = mkdtempSync(path.join(tmpdir(), 'kit-layout-real-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  mkdirSync(path.join(folder, 'outside'));
  const root = path.join(folder, 'a', 'b', 'demo');
  write(root, { ...GOOD, ...files });
  for (const file of KIT_FILES) copyFileSync(path.join(ROOT, file), path.join(root, file));
  cpSync(path.join(ROOT, 'scripts/kit/kit.mk'), path.join(root, 'scripts/kit/kit.mk'));
  sandboxShims(root, ['alint']);
  const init = spawnSync('git', ['init', '--quiet'], { cwd: root, encoding: 'utf8' });
  assert.equal(init.status, 0, init.stderr);
  return root;
}

const layoutCheck = (root: string) => spawnSync('make', ['--no-print-directory', 'layout-check'], { cwd: root, encoding: 'utf8' });

test('make layout-check passes on a repository that follows the layout', (t) => {
  assert.ok(existsSync(ALINT), 'the alint of mise.toml is missing; make install-tools installs it');
  const result = layoutCheck(repository(t));
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  assert.match(result.stdout, /all rules passed/);
});

test('make layout-check fails on each planted violation with the rule that names it', (t) => {
  assert.ok(existsSync(ALINT), 'the alint of mise.toml is missing; make install-tools installs it');
  for (const { rule, files } of VIOLATIONS) {
    const result = layoutCheck(repository(t, files));
    const output = `${result.stdout}${result.stderr}`;
    assert.notEqual(result.status, 0, `${rule}: the violation passed:\n${output}`);
    assert.match(output, new RegExp(`: error: ${rule}: `), `${rule} is not named:\n${output}`);
  }
});

test('a repository declares only its own root files in vars.root_files, and the root files of kit stay declared (K145)', (t) => {
  assert.ok(existsSync(ALINT), 'the alint of mise.toml is missing; make install-tools installs it');
  const layout = `${LAYOUT}  - id: layout-root-files\n    vars: { root_files: "{notes.txt,tsconfig.build.json}" }\n`;
  const passed = layoutCheck(repository(t, { 'config/layout.yml': layout, 'notes.txt': 'x\n', 'tsconfig.build.json': '{}\n' }));
  assert.equal(passed.status, 0, `${passed.stdout}${passed.stderr}`);
  const undeclared = layoutCheck(repository(t, { 'config/layout.yml': layout, 'notes.txt': 'x\n', 'other.txt': 'x\n' }));
  assert.notEqual(undeclared.status, 0, `${undeclared.stdout}${undeclared.stderr}`);
  assert.match(undeclared.stdout, /other\.txt: error: layout-root-files: /);
  assert.doesNotMatch(undeclared.stdout, /(README\.md|Makefile|notes\.txt): error/);
});

// The root of a Composer monorepo holds its development composer.json, which requires the libraries through path
// repositories, and its one composer.lock, as an npm monorepo root holds package.json and package-lock.json (K167).
test('the root composer.json and composer.lock of a Composer monorepo are root files of kit (K167)', (t) => {
  assert.ok(existsSync(ALINT), 'the alint of mise.toml is missing; make install-tools installs it');
  const root = {
    'composer.json': JSON.stringify({ name: 'polyspec/demo-development', type: 'project', license: 'MIT', repositories: [{ type: 'path', url: 'packages/php' }], require: { 'polyspec/demo': '*@dev' } }, null, 4),
    'composer.lock': JSON.stringify({ packages: [], 'packages-dev': [] }, null, 4),
  };
  const result = layoutCheck(repository(t, root));
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
});

// K423: alint finds the exclude of Git in a main checkout only, so the files that kit link writes at the root are root files of kit.
test('the files that kit link writes at the root are root files of kit (K423)', (t) => {
  const root = repository(t, { 'composer.link.json': '{}\n', 'composer.link.lock': '{}\n' });
  const result = layoutCheck(root);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('make layout-check passes on this checkout', () => {
  const result = layoutCheck(ROOT);
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
});
