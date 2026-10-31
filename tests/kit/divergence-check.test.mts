// Tests of scripts/kit/divergence-check.mts (K315): each way to let an implementation differ from the contract without a unit that
// says so is a finding, and the same code outside an implementation root, in a comment or in kit itself is not.
import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { checkedSources, divergenceFindings, reasonKind } from '../../scripts/kit/divergence-check.mts';

import { tree } from './tree.mts';

const run = (texts: Record<string, string>) => divergenceFindings(Object.keys(texts), file => texts[file]);
const PARITY = JSON.stringify({ implementations: [{ name: 'php', roots: ['packages/php'] }, { name: 'ts', roots: ['packages/ts'] }] });

test('a test that branches on the extension, the runtime or the platform is a finding, in each language (K315)', () => {
  assert.deepEqual(run({
    'config/parity.json': PARITY,
    'packages/php/tests/ModelTest.php': "<?php\nif (extension_loaded('x')) { self::assertTrue(true); }\n$v = PHP_VERSION;\n",
    'packages/ts/tests/a.test.ts': "const windows = process.platform === 'win32';\n",
  }), [
    "packages/php/tests/ModelTest.php:2: a test branches on the implementation, the runtime or the platform (extension_loaded), so it asserts something else in another implementation",
    "packages/php/tests/ModelTest.php:3: a test branches on the implementation, the runtime or the platform (PHP_VERSION), so it asserts something else in another implementation",
    "packages/ts/tests/a.test.ts:1: a test branches on the implementation, the runtime or the platform (process.platform), so it asserts something else in another implementation",
  ]);
  assert.deepEqual(run({ 'config/parity.json': PARITY, 'packages/php/tests/a_test.php': '<?php\n// extension_loaded is read here in a comment\n', 'docs/a.md': 'extension_loaded' }), [], 'a comment and a document are no branch');
});

test('the code of an implementation that reads whether another implementation is present is a finding (K315)', () => {
  assert.deepEqual(run({ 'config/parity.json': PARITY, 'packages/php/src/bootstrap.php': "<?php\nif (!extension_loaded('polyspec_x')) { require 'X.php'; }\n", 'scripts/tool.php': "<?php\nextension_loaded('x');\n" }), [
    'packages/php/src/bootstrap.php:2: the code of an implementation branches on the presence of another implementation (extension_loaded), so the library and its extension coexist through a guard of the run time',
  ]);
});

test('--exclude-group in a script or a Makefile, and a partial or unsupported feature, are findings (K315)', () => {
  assert.deepEqual(run({
    Makefile: 'test:\n\tphpunit --exclude-group php\n',
    'scripts/run.mts': "const args = ['--', '--exclude-group', 'slow'];\n",
    'contracts/features.json': '{\n  "createForm": {\n    "python": "partial",\n    "go": "supported",\n    "rust": "unsupported"\n  }\n}\n',
  }), [
    'Makefile:2: --exclude-group narrows the run of an implementation',
    'contracts/features.json:3: the feature file declares an implementation partial; every implementation holds every unit (S6)',
    'contracts/features.json:5: the feature file declares an implementation unsupported; every implementation holds every unit (S6)',
    'scripts/run.mts:1: --exclude-group narrows the run of an implementation',
  ]);
});

test('an exception of a configuration whose reason names no kind of kit is a finding, and each kind passes (K315)', () => {
  const duplication = JSON.stringify({ schema: 1, exclude: [{ glob: 'tests/**', reason: 'a test states its case in full' }, { glob: 'gen/**', reason: 'generated: the tables of a generator' }] }, null, 2);
  const parity = JSON.stringify({ implementations: [{ name: 'php', roots: ['packages/php'], internal: [{ glob: 'packages/php/tests/Internal*.php', reason: 'private helpers' }] }], tools: [{ root: 'packages/editor', reason: 'harness: the editor tests' }, { root: 'packages/other', reason: 'because' }] }, null, 2);
  assert.deepEqual(run({ 'config/duplication.json': duplication, 'config/parity.json': parity }), [
    'config/duplication.json:5: the exception tests/** gives a reason of no kind that kit defines; begin it with one of generated: fixture: test: harness: ecosystem: external:',
    'config/parity.json:10: the exception packages/php/tests/Internal*.php gives a reason of no kind that kit defines; begin it with one of generated: fixture: test: harness: ecosystem: external:',
    'config/parity.json:22: the exception packages/other gives a reason of no kind that kit defines; begin it with one of generated: fixture: test: harness: ecosystem: external:',
  ]);
  for (const kind of ['generated', 'fixture', 'test', 'harness', 'ecosystem', 'external']) assert.equal(reasonKind(`${kind}: why`), true);
  assert.equal(reasonKind('because'), false);
});

test('the tools and tests of kit itself are checked like any other (K315, K954)', () => {
  const same = "process.platform; extension_loaded('x')";
  const kit = run({ 'tests/kit/a.test.mts': same, 'config/parity.json': PARITY });
  assert.notDeepEqual(kit, []);
  assert.deepEqual(kit, run({ 'tests/other/a.test.mts': same, 'config/parity.json': PARITY }).map(line => line.replace('tests/other/', 'tests/kit/')));
});

// K883: the polyfill guard of K873, an if whose condition is only !function_exists or !defined of the name that its body alone declares,
// still only declares, so the library and its extension coexist by the declaration that runs first; AutoloadFiles.php defines that shape
// for both checks. A probe that chooses behaviour, one inside a function, and extension_loaded stay findings, also in a generated source.
test('the polyfill guard of a declaration is no finding, and a probe that chooses behaviour still is, also in a generated source (K329, K883)', (t) => {
  const finding = (file: string, line: number) => `${file}:${line}: the code of an implementation branches on the presence of another implementation (function_exists), so the library and its extension coexist through a guard of the run time`;
  assert.deepEqual(run({ 'config/parity.json': PARITY, 'packages/php/src/OrderedJson.php': "<?php\nnamespace Acme;\nif (!\\defined('Acme\\MAX')) {\n    \\define('Acme\\MAX', 1);\n}\nif (!\\function_exists('Acme\\initial')) {\n    function initial() {}\n}\n" }), []);
  assert.deepEqual(run({
    'config/parity.json': PARITY,
    'packages/php/src/Machine.php': "<?php\nnamespace Acme;\nfunction initial() {}\nfunction run() {\n    if (function_exists('Acme\\initial')) { return 1; }\n    return 2;\n}\nif (!function_exists('Acme\\initial')) {\n    echo 1;\n}\nfunction load() {\n    if (!function_exists('Acme\\later')) {\n        function later() {}\n    }\n}\nif (!function_exists('Acme\\initial')) { function initial() {} } if (function_exists('Acme\\initial')) { echo 1; }\n",
  }), [12, 16, 5, 8].map(line => finding('packages/php/src/Machine.php', line)));
  const root = tree(t, { 'config/parity.json': PARITY, '.gitignore': 'packages/php/src/generated/\n' });
  mkdirSync(path.join(root, 'packages/php/src/generated'), { recursive: true });
  writeFileSync(path.join(root, 'packages/php/src/generated/Gen.php'), "<?php\nnamespace Acme;\nfunction x() {}\nif (function_exists('Acme\\x')) {\n    x();\n}\nif (extension_loaded('acme')) {\n    x();\n}\n");
  const read = (file: string) => (existsSync(path.join(root, file)) ? readFileSync(path.join(root, file), 'utf8') : undefined);
  const files = checkedSources(root, ['config/parity.json'], read);
  assert.deepEqual(files, ['config/parity.json', 'packages/php/src/generated/Gen.php']);
  assert.deepEqual(divergenceFindings(files, read), [finding('packages/php/src/generated/Gen.php', 4), finding('packages/php/src/generated/Gen.php', 7).replace('(function_exists)', '(extension_loaded)')]);
});

test('K644: global and external PHP capability probes are allowed', () => {
  assert.deepEqual(run({
    'config/parity.json': PARITY,
    'packages/php/src/Orm.php': "<?php\nif (!function_exists('pg_connect')) { throw new RuntimeException(); }\n",
    'packages/php/src/Internal/Adapter.php': "<?php\nif (function_exists('pcntl_signal_dispatch')) { pcntl_signal_dispatch(); }\nif (function_exists('Vendor\\optional_capability')) { Vendor\\optional_capability(); }\n",
  }), []);
});

test('K645: function_exists finds a global function declared by an implementation', () => {
  assert.equal(run({
    'config/parity.json': PARITY,
    'packages/php/src/Orm.php': "<?php\nif (!function_exists('orm_connect')) { throw new RuntimeException(); }\n",
    'packages/php/src/orm_connect.php': "<?php\nfunction orm_connect() {}\n",
  }).length, 1, 'a global function probe naming a declared implementation function remains a coexistence guard');
});

// K543: a test declares its environment and asserts it, so a probe in an assertion that holds no branch is no finding; the same probe in
// the condition of an if, in a ternary within an assertion or before a skip still is.
test('an assertion of the environment of a test passes, and a probe in a branch is still a finding (K543)', () => {
  const texts: Record<string, string> = {
    'config/parity.json': JSON.stringify({ implementations: [{ language: 'php', roots: ['php'] }, { language: 'python', roots: ['py'] }, { language: 'rust', roots: ['rs'] }] }),
    'php/tests/LoadedTest.php': "<?php\n    $this->assertTrue(extension_loaded('polyspec_orm'));\n    self::assertSame('Darwin', PHP_OS_FAMILY);\n",
    'php/tests/BranchTest.php': "<?php\n    if (!extension_loaded('polyspec_orm')) {\n        $this->markTestSkipped();\n    }\n    $this->assertSame(PHP_OS === 'Linux' ? 1 : 2, $count);\n",
    'py/tests/test_platform.py': "    assert sys.platform == 'darwin'\n    self.assertEqual(sys.version_info[0], 3)\n    if sys.platform == 'linux':\n        pass\n",
    'rs/tests/env.rs': "    assert!(cfg!(target_os = \"macos\"));\n    #[cfg(target_os = \"linux\")]\n    fn linux() {}\n",
  };
  assert.deepEqual(run(texts).map(finding => finding.split(':').slice(0, 2).join(':')), [
    'php/tests/BranchTest.php:2',
    'php/tests/BranchTest.php:5',
    'py/tests/test_platform.py:3',
    'rs/tests/env.rs:2',
  ]);
});

test('a multiline environment assertion passes while real branches remain findings (K543-1)', () => {
  assert.deepEqual(run({
    'config/parity.json': JSON.stringify({ implementations: [{ name: 'php', roots: ['packages/php'] }] }),
    'packages/php/tests/LoadedTest.php': "<?php\n    self::assertTrue(\n        extension_loaded('polyspec_orm'),\n        'the extension is loaded'\n    );\n",
    'packages/php/tests/BranchTest.php': "<?php\n    if (extension_loaded('polyspec_orm')) { self::assertTrue(true); }\n    self::assertSame(\n        extension_loaded('polyspec_orm') ? 'loaded' : 'missing',\n        $state\n    );\n    if (!extension_loaded('polyspec_orm')) {\n        self::markTestSkipped('extension required');\n    }\n",
  }), [
    'packages/php/tests/BranchTest.php:2: a test branches on the implementation, the runtime or the platform (extension_loaded), so it asserts something else in another implementation',
    'packages/php/tests/BranchTest.php:4: a test branches on the implementation, the runtime or the platform (extension_loaded), so it asserts something else in another implementation',
    'packages/php/tests/BranchTest.php:7: a test branches on the implementation, the runtime or the platform (extension_loaded), so it asserts something else in another implementation',
  ]);
});

test('Go machine metadata is not a platform-dependent test branch, but a real branch remains a finding (K636)', () => {
  const parity = JSON.stringify({ implementations: [{ name: 'go', roots: ['packages/go'] }] });
  const report = [
    'machine := fmt.Sprintf("%s %s", runtime.GOOS, runtime.GOARCH)',
    'fmt.Fprintf(os.Stderr, "PERF hot_path_gate go %s %s: native p50=%.1fµs client p50=%.1fµs ratio=%.2f samples=%d cpu=%.1fms wall=%.1fms machine=%s reference=not-recorded\\n", driver, workload.name, float64(na.Microseconds()), float64(cl.Microseconds()), ratio, gatePairs, cpu*1000, float64(wall.Microseconds())/1000, machine)',
  ].join('\n');
  assert.deepEqual(run({
    'config/parity.json': parity,
    'packages/go/bench/performance_test.go': report,
  }), [], 'runtime values used only for a machine diagnostic field do not change test behavior');

  const branch = `${report}\nif runtime.GOOS == "windows" { t.Log("windows") }`;
  assert.deepEqual(run({
    'config/parity.json': parity,
    'packages/go/bench/performance_test.go': branch,
  }), [
    'packages/go/bench/performance_test.go:3: a test branches on the implementation, the runtime or the platform (runtime.GOOS), so it asserts something else in another implementation',
  ], 'platform selection still fails even when the same test reports its machine');
});

test('JavaScript platform values used only in a warning are diagnostic metadata (K688)', () => {
  const parity = JSON.stringify({ implementations: [{ name: 'ts', roots: ['packages/ts'] }] });
  const report = "if (elapsed >= 10) warning(`wait took ${elapsed}ms on ${process.platform}/${process.arch}`);";
  assert.deepEqual(run({
    'config/parity.json': parity,
    'packages/ts/tests/physical.mjs': report,
  }), [], 'platform values in diagnostic text do not select test behavior');

  assert.deepEqual(run({
    'config/parity.json': parity,
    'packages/ts/tests/physical.mjs': `${report}\nif (process.platform === 'win32') warning('windows');`,
  }), [
    'packages/ts/tests/physical.mjs:2: a test branches on the implementation, the runtime or the platform (process.platform), so it asserts something else in another implementation',
  ], 'a real platform branch remains a finding when the test also reports machine metadata');

  assert.deepEqual(run({
    'config/parity.json': parity,
    'packages/ts/tests/physical.mjs': "if (process.platform === 'win32') warning(`machine ${process.platform}/${process.arch}`);",
  }), [
    'packages/ts/tests/physical.mjs:1: a test branches on the implementation, the runtime or the platform (process.platform), so it asserts something else in another implementation',
  ], 'diagnostic metadata does not exempt a branch on the same line');

  assert.deepEqual(run({
    'config/parity.json': parity,
    'packages/ts/tests/physical.mjs': "if (process.arch === 'arm64') warning('arm64');",
  }), [
    'packages/ts/tests/physical.mjs:1: a test branches on the implementation, the runtime or the platform (process.arch), so it asserts something else in another implementation',
  ], 'architecture branches are findings too');
});

for (const [use, source] of [
  ['condition', 'if (warning(`${process.platform}/${process.arch}`)) throw Error("platform outcome");'],
  ['assigned result', 'const predicate = warning(`${process.platform}/${process.arch}`); if (predicate) throw Error("platform outcome");'],
  ['returned predicate', 'function predicate() { return warning(`${process.platform}/${process.arch}`); } if (predicate()) throw Error("platform outcome");'],
] as const) {
  test(`K688-1: warning metadata consumed as ${use} remains a platform finding`, () => {
    const findings = run({
      'config/parity.json': JSON.stringify({ implementations: [{ name: 'ts', roots: ['packages/ts'] }] }),
      'packages/ts/tests/physical.mjs': source,
    });
    assert.equal(findings.length, 1, `${use}: consumed warning results are not diagnostic-only`);
    assert.match(findings[0] ?? '', /a test branches.*process.platform/);
  });
}
