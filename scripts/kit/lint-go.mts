#!/usr/bin/env node
// Lints the Go of the checkout with the golangci-lint and the deadcode of mise.toml, through their shims (`make lint-go`), in
// the folder of each Go module, a go.mod of the checkout:
//   - `golangci-lint run --config <kit>/.golangci.yml ./...`, the configuration of the kit package (K514): the standard linters and
//     gomoddirectives, which forbids a replace (the modules of a repository resolve each other through its go.work) and a
//     toolchain line.
//   - golangci-lint once more for each build tag that the Go files of the module name in their `//go:build` lines (K406), with
//     `--build-tags=<tag>`, so a file behind a tag is linted too. The tags that the go tool sets itself, such as the platforms
//     and go1.N, are left out (GO_SET_TAGS).
//   - deadcode-union.mts: `deadcode -test ./...` untagged and with each of those tags, judged together (K536): a function that
//     no main package and no test reaches in any run that compiles its file. deadcode exits 0 when it reports one, so a step
//     with any output fails.
// A missing tool or configuration is a failure with its fix, never a skip; lint-steps.mts runs the steps.
//
//   node scripts/kit/lint-go.mts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { foldersOf, lintCommands, lintMain, runLint } from './lint-steps.mts';
import type { LintStep } from './lint-steps.mts';
import { shimsPath } from './mise-tools.mts';
import { present } from './present.mts';
import { checkedFiles } from './tracked-files.mts';
import { kitFile } from './kit-files.mts';

/**
 * The tags that the go tool sets itself, which a `//go:build` line names without a build tag of the module (K406): the GOOS
 * and GOARCH values, unix, cgo, the compilers, ignore and every go1.N release tag.
 */
export const GO_SET_TAGS: ReadonlySet<string> = new Set([
  'aix', 'android', 'darwin', 'dragonfly', 'freebsd', 'hurd', 'illumos', 'ios', 'js', 'linux', 'nacl', 'netbsd', 'openbsd', 'plan9', 'solaris', 'wasip1', 'windows', 'zos',
  '386', 'amd64', 'arm', 'arm64', 'loong64', 'mips', 'mips64', 'mips64le', 'mipsle', 'ppc64', 'ppc64le', 'riscv64', 's390x', 'wasm',
  'unix', 'cgo', 'gc', 'gccgo', 'ignore',
]);

/** The build tags that the first `//go:build` line of `text` names, except those of GO_SET_TAGS; none without such a line. */
function buildTags(text: string): string[] {
  const line = text.split('\n').find(candidate => candidate.startsWith('//go:build '));
  if (line === undefined) return [];
  return line.slice('//go:build '.length).split(/[!&|()\s]+/)
    .filter(tag => tag !== '' && !GO_SET_TAGS.has(tag) && !/^go1\.\d+$/.test(tag));
}

/** The build tags, sorted, that the Go files of `files` under `folder` name in their `//go:build` lines (K406). */
function moduleTags(root: string, files: readonly string[], folder: string): string[] {
  const prefix = folder === '.' ? '' : `${folder}/`;
  const tags = new Set<string>();
  for (const file of files) {
    if (!file.startsWith(prefix) || !file.endsWith('.go')) continue;
    for (const tag of buildTags(readFileSync(path.join(root, file), 'utf8'))) tags.add(tag);
  }
  return [...tags].sort();
}

// The judgment of deadcode over the build tags of a module (K536), beside this module, built or from source.
const HERE = fileURLToPath(import.meta.url);
const DEADCODE_UNION = path.join(path.dirname(HERE), `deadcode-union${path.extname(HERE)}`);

/** The steps of the lint of `root`; throws when a tool or .golangci.yml is missing. */
export function lintSteps(root: string): LintStep[] {
  const modules = foldersOf(root, 'go.mod');
  if (modules.length === 0) return [];
  const tools = lintCommands(root, shimsPath(root), ['golangci-lint', 'deadcode', 'go'], 'declare go, golangci-lint and go:golang.org/x/tools/cmd/deadcode in mise.toml and run make install-tools');
  const files = checkedFiles(root);
  return modules.flatMap((folder) => {
    const golangci = present(tools['golangci-lint'], 'tools[\'golangci-lint\']');
    const tags = moduleTags(root, files, folder);
    return [
      { label: `golangci-lint ${folder}`, command: golangci, args: ['run', `--config=${kitFile('.golangci.yml')}`, './...'], cwd: folder },
      // K406: the files behind each build tag of the module, which the untagged run never reaches.
      ...tags.map(tag => ({ label: `golangci-lint ${folder} (tag ${tag})`, command: golangci, args: ['run', `--config=${kitFile('.golangci.yml')}`, `--build-tags=${tag}`, './...'], cwd: folder })),
      // K536: deadcode over the union of the tags; it exits 0 when it reports a function, so its output fails the step.
      { label: `deadcode ${folder}`, command: process.execPath, args: [DEADCODE_UNION, present(tools.deadcode, 'tools.deadcode'), present(tools.go, 'tools.go'), ...tags], cwd: folder, quiet: true },
    ];
  });
}

/** Runs the steps of `root` and returns the labels of those that failed; the output of each step goes through `print`. */
export function lint(root: string, print: (text: string) => unknown = text => process.stdout.write(text)): string[] {
  return runLint('lint-go', lintSteps(root), root, print);
}

lintMain(import.meta.url, 'lint-go', lintSteps);
