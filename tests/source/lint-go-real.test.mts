// The real Go lint: lint-go.mts runs the golangci-lint and the deadcode of mise.toml on a repository that holds the
// .golangci.yml of this checkout and whose modules resolve each other through its go.work. A module whose code is reached by
// its tests passes; each violation planted into a copy fails with the linter or the finding that names it. Nothing is stubbed.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { lint } from '../../scripts/kit/lint-go.mts';
import { installedBinary, sandboxShims } from './real-tools.mts';
import { known } from '../kit/known.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// deadcode and golangci-lint load the packages with the go of mise.toml, so the repository gets its shim too.
const TOOLS = ['golangci-lint', 'deadcode', 'go'];

const MOD = 'packages/go/go.mod';
const DEMO = 'packages/go/demo.go';
const CODEC = 'github.com/polyspec/demo/packages/codec/go';

// Two modules of one repository: demo uses codec, which go.work resolves from its folder, and each test reaches the code.
const GOOD: Record<string, string> = {
  '.gitignore': 'var/\n',
  'go.work': 'go 1.27.2\n\nuse (\n\t./packages/codec/go\n\t./packages/go\n)\n',
  'packages/codec/go/go.mod': `module ${CODEC}\n\ngo 1.27.2\n`,
  'packages/codec/go/codec.go': '// Package codec doubles values.\npackage codec\n\n// Double doubles a value.\nfunc Double(value int) int {\n\treturn value * 2\n}\n',
  'packages/codec/go/codec_test.go': 'package codec\n\nimport "testing"\n\nfunc TestDouble(t *testing.T) {\n\tif Double(2) != 4 {\n\t\tt.Fatal("Double(2) != 4")\n\t}\n}\n',
  [MOD]: `module github.com/polyspec/demo/packages/go\n\ngo 1.27.2\n\nrequire ${CODEC} v0.0.0\n`,
  [DEMO]: `// Package demo quadruples values.\npackage demo\n\nimport "${CODEC}"\n\n// Quadruple quadruples a value.\nfunc Quadruple(value int) int {\n\treturn codec.Double(codec.Double(value))\n}\n`,
  'packages/go/demo_test.go': 'package demo\n\nimport "testing"\n\nfunc TestQuadruple(t *testing.T) {\n\tif Quadruple(1) != 4 {\n\t\tt.Fatal("Quadruple(1) != 4")\n\t}\n}\n',
};

// One violation for each linter: the files it adds or replaces, and the text that the failing step prints for it.
const VIOLATIONS: { name: string; files: Record<string, string>; finding: RegExp }[] = [
  { name: 'an unused function', files: { [DEMO]: `${GOOD[DEMO]}\nfunc triple(value int) int {\n\treturn value * 3\n}\n` }, finding: /demo\.go:\d+:\d+: func triple is unused \(unused\)/ },
  { name: 'a wrong format verb', files: { [DEMO]: `${GOOD[DEMO]}\n// Name names a value.\nfunc Name(value int) string {\n\treturn fmt.Sprintf("%s", value)\n}\n`.replace(`import "${CODEC}"`, `import (\n\t"fmt"\n\n\t"${CODEC}"\n)`) }, finding: /\(govet\)/ },
  { name: 'an exported function that no test reaches', files: { [DEMO]: `${GOOD[DEMO]}\n// Octuple octuples a value.\nfunc Octuple(value int) int {\n\treturn Quadruple(Quadruple(value)) / value\n}\n` }, finding: /demo\.go:\d+:\d+: unreachable func: Octuple/ },
  // No swallowed error (K256): an unchecked error.
  { name: 'an unchecked error', files: { [DEMO]: `${GOOD[DEMO]}\n// Save writes an empty file.\nfunc Save(path string) {\n\tos.WriteFile(path, nil, 0o600)\n}\n`.replace(`import "${CODEC}"`, `import (\n\t"os"\n\n\t"${CODEC}"\n)`) }, finding: /\(errcheck\)/ },
  // P8 (K334): an error assigned to the blank identifier, an unchecked type assertion, a nil return in the branch of a non-nil
  // error, and a comparison and a wrap that lose the error chain.
  { name: 'an error assigned to the blank identifier', files: { [DEMO]: quadruple(['os'], '\t_ = os.Remove("demo.tmp")\n') }, finding: /\(errcheck\)/ },
  { name: 'an error dropped by a blank in a multiple assignment', files: { [DEMO]: quadruple(['strconv'], '\tcount, _ := strconv.Atoi("1")\n\t_ = count\n') }, finding: /\(errcheck\)/ },
  { name: 'an unchecked type assertion', files: { [DEMO]: quadruple([], '\tvar any interface{} = value\n\t_ = any.(int)\n') }, finding: /\(errcheck\)/ },
  { name: 'a nil return in the branch of a non-nil error', files: { [DEMO]: quadruple(['os'], '') + '\n// Remove removes a file.\nfunc Remove(path string) error {\n\tif err := os.Remove(path); err != nil {\n\t\treturn nil\n\t}\n\treturn nil\n}\n' }, finding: /\(nilerr\)/ },
  { name: 'a comparison with a sentinel error', files: { [DEMO]: quadruple(['io'], '\tif err := io.EOF; err == io.EOF {\n\t\treturn 0\n\t}\n') }, finding: /\(errorlint\)/ },
  { name: 'an error wrapped with %v', files: { [DEMO]: quadruple(['fmt', 'io'], '\tif err := fmt.Errorf("read: %v", io.EOF); err != nil {\n\t\treturn 0\n\t}\n') }, finding: /\(errorlint\)/ },
  { name: 'a nolint without its reason', files: { [DEMO]: quadruple(['os'], '\t_ = os.Remove("demo.tmp") //nolint:errcheck\n') }, finding: /\(nolintlint\)/ },
];

// The variants that state their need or handle the error pass (P8), and the directives of go.mod, which are the go tool's (K866).
const STATED: { name: string; files: Record<string, string> }[] = [
  { name: 'a replace of a sibling module (K866)', files: { [MOD]: `${GOOD[MOD]}\nreplace ${CODEC} => ../codec/go\n` } },
  { name: 'a toolchain line (K866)', files: { [MOD]: known(GOOD[MOD], 'GOOD[MOD]').replace('go 1.27.2\n', 'go 1.27.2\n\ntoolchain go1.27.2\n') } },
  { name: 'a nolint with its linter and its reason', files: { [DEMO]: quadruple(['os'], '\t_ = os.Remove("demo.tmp") //nolint:errcheck // the temporary file may be gone already\n') } },
  { name: 'an error that is wrapped with %w and compared with errors.Is', files: { [DEMO]: quadruple(['errors', 'fmt', 'io'], '\tif err := fmt.Errorf("read: %w", io.EOF); errors.Is(err, io.EOF) {\n\t\treturn value * 4\n\t}\n') } },
];

/** The demo module whose function Quadruple runs `statements` first and imports `imports`. */
function quadruple(imports: string[], statements: string): string {
  const names = imports.map(name => `\t"${name}"\n`).join('');
  return `// Package demo quadruples values.\npackage demo\n\nimport (\n${names}\n\t"${CODEC}"\n)\n\n// Quadruple quadruples a value.\nfunc Quadruple(value int) int {\n${statements}\treturn codec.Double(codec.Double(value))\n}\n`;
}

/** Writes `files` below `root`. */
function write(root: string, files: Record<string, string>) {
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  }
}

/** A repository in a temporary folder: GOOD with `files` over it, the .golangci.yml of this checkout and its tools. */
function repository(t: TestContext, files: Record<string, string> = {}): string {
  const root = mkdtempSync(path.join(tmpdir(), 'kit-lint-go-real-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  write(root, { ...GOOD, ...files });
  copyFileSync(path.join(ROOT, '.golangci.yml'), path.join(root, '.golangci.yml'));
  sandboxShims(root, TOOLS);
  const init = spawnSync('git', ['init', '--quiet'], { cwd: root, encoding: 'utf8' });
  assert.equal(init.status, 0, init.stderr);
  return root;
}

/** The labels of the failed steps of the lint of `root` and everything the steps printed. */
function lintOf(root: string): { failed: string[]; output: string } {
  let output = '';
  const failed = lint(root, text => { output += text; });
  return { failed, output };
}

test('the Go lint passes on modules that resolve each other through go.work and whose tests reach their code', (t) => {
  for (const tool of TOOLS) assert.ok(existsSync(installedBinary(tool)), `the ${tool} of mise.toml is missing; make install-tools installs it`);
  const { failed, output } = lintOf(repository(t));
  assert.deepEqual(failed, [], output);
});

// One test for each planted violation: every case runs golangci-lint, which takes seconds, so a case has its own time limit.
for (const { name, files, finding } of VIOLATIONS) {
  test(`the Go lint fails on ${name} with the linter or the finding that names it`, (t) => {
    const { failed, output } = lintOf(repository(t, files));
    assert.notDeepEqual(failed, [], `${name}: the violation passed:\n${output}`);
    assert.match(output, finding, `${name} is not named:\n${output}`);
  });
}

// The error strings of polyspec are the cross-port messages of each repository's spec, which every port returns byte for
// byte, so they keep the spec's capitalization: staticcheck ST1005 is off (K164).
test('a capitalized error string of a spec passes the Go lint', (t) => {
  const { failed, output } = lintOf(repository(t, {
    [DEMO]: `${known(GOOD[DEMO], 'GOOD[DEMO]').replace(`import "${CODEC}"`, `import (\n\t"errors"\n\n\t"${CODEC}"\n)`)}\n// Check refuses a negative value.\nfunc Check(value int) error {\n\tif value < 0 {\n\t\treturn errors.New("Value must not be negative")\n\t}\n\treturn nil\n}\n`,
    'packages/go/check_test.go': 'package demo\n\nimport "testing"\n\nfunc TestCheck(t *testing.T) {\n\tif Check(-1) == nil {\n\t\tt.Fatal("Check(-1) == nil")\n\t}\n}\n',
  }));
  assert.deepEqual(failed, [], output);
});

// golangci-lint shows 3 issues of the same text by default and hides the rest; every finding is reported (K164).
test('the Go lint reports every finding of the same text', (t) => {
  const calls = Array.from({ length: 4 }, (_, index) => `\tfail(${index})\n`).join('');
  const { failed, output } = lintOf(repository(t, {
    [DEMO]: `${known(GOOD[DEMO], 'GOOD[DEMO]').replace(`import "${CODEC}"`, `import (\n\t"errors"\n\n\t"${CODEC}"\n)`).replace('\treturn codec.Double', `${calls}\treturn codec.Double`)}\nfunc fail(value int) error {\n\tif value > 2 {\n\t\treturn errors.New("too large")\n\t}\n\treturn nil\n}\n`,
  }));
  assert.notDeepEqual(failed, [], output);
  assert.equal(output.match(/demo\.go:\d+:\d+: Error return value is not checked \(errcheck\)/g)?.length, 4, output);
});

for (const { name, files } of STATED) {
  test(`the Go lint passes on ${name}`, (t) => {
    const { failed, output } = lintOf(repository(t, files));
    assert.deepEqual(failed, [], `${name}: ${output}`);
  });
}
