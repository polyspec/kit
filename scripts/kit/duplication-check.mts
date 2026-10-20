#!/usr/bin/env node
// The duplication check of a repository (`make duplication-check`, K248-3): jscpd, a dependency of @polyspec/kit, reads the
// code of the checkout that .gitignore leaves, in the formats of the runtimes of kit, and fails on a piece of 6 lines or
// more that exists twice, the sign of a concern that two components hold. The folders that config/duplication.json
// excludes, each with its reason, are not read.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import path from 'node:path';
import { isJsonObject, readJson } from './bootstrap/files.mts';
import { isMain, repositoryRoot } from './paths.mts';
import { readConfig } from './schema-validate.mts';

export const CONFIG = 'config/duplication.json';
// The code formats of jscpd for the runtimes of kit (S5) and the C of the PHP extensions.
const FORMATS = ['typescript', 'javascript', 'go', 'php', 'python', 'rust', 'c'];
const MIN_LINES = '6';
const STUB_GLOB = 'packages/php-ext/src/polyspec_*.stub.php';
// The lines that carry no logic, the file header of each format (K287): jscpd's own ignore-pattern skips the tokens that overlap
// a match, so two files that share only their declarations and imports are no clone. (?m) lets ^ and $ match at a line, and a
// pattern holds no comma, which separates the patterns on the command line. Nothing else is skipped: no docblock, no signature.
const HEADER_PATTERNS = [
  // PHP: declare, namespace and use at the start of a line
  String.raw`(?m)^(declare\([^)]*\)|namespace [^;]+|use [^;]+);$`,
  // TypeScript and JavaScript: import, single-line or a block over lines, and a bare import of a module
  String.raw`(?m)^import\s[^;'"]*['"][^'"\n]*['"];?$`,
  // Go: package, and import, single or a block
  String.raw`(?m)^package \w+$`,
  String.raw`(?m)^import (\w+ )?"[^"\n]*"$`,
  String.raw`(?m)^import \([^)]*\)$`,
  // Python: import and from-import, single-line or parenthesized over lines
  String.raw`(?m)^import [^\n]+$`,
  String.raw`(?m)^from [\w.]+ import [^\n(]+$`,
  String.raw`(?m)^from [\w.]+ import \([^)]*\)$`,
  // Rust: use, single or braced over lines
  String.raw`(?m)^(pub )?use [^;]+;$`,
  // C: include
  String.raw`(?m)^#include [<"][^>"\n]*[>"]$`,
];
// The command of the package jscpd that the check runs.
const COMMAND = 'jscpd';

/** config/duplication.json as duplication.schema.json describes it. */
type DuplicationConfig = { schema: 1; exclude: { glob: string; reason: string }[] };

/** The command of jscpd that the package depends on, by the bin of its package.json. */
function jscpd(): string {
  const manifest = createRequire(import.meta.url).resolve('jscpd/package.json');
  const parsed = readJson(manifest);
  const bin = isJsonObject(parsed) ? parsed.bin : undefined;
  const relative = typeof bin === 'string' ? bin : isJsonObject(bin) ? bin[COMMAND] : undefined;
  if (typeof relative !== 'string') throw new Error(`${manifest} names no bin ${COMMAND}`);
  return path.join(path.dirname(manifest), relative);
}

/** Runs jscpd over `root` and returns its status and output, which `print` receives; throws when jscpd cannot start. */
export function duplicationCheck(root: string, print: (text: string) => void = text => process.stdout.write(text)): { status: number; output: string } {
  const excluded = existsSync(path.join(root, CONFIG)) ? readConfig<DuplicationConfig>(root, CONFIG, 'duplication.schema.json').exclude : [];
  // --ignore splits its value at each comma, so a brace glob {a,b} would exclude nothing (K310): the globs go whole in a configuration file.
  const folder = mkdtempSync(path.join(tmpdir(), 'kit-jscpd-'));
  const config = path.join(folder, 'jscpd.json');
  // The S10 stub of a PHP extension declares the library under the same names and signatures, so it is left out by its path (S10, K366).
  writeFileSync(config, JSON.stringify({ ignore: [...excluded.map(entry => entry.glob), STUB_GLOB] }));
  const args = ['--config', config, '--min-lines', MIN_LINES, '--format', FORMATS.join(','), '--exit-code', '1', '--reporters', 'console', '--ignore-pattern', HEADER_PATTERNS.join(','), root];
  const result = spawnSync(jscpd(), args, { cwd: root, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
  rmSync(folder, { recursive: true, force: true });
  if (result.error) throw new Error(`jscpd could not start: ${result.error.message}`);
  const output = `${result.stdout}${result.stderr}`;
  print(output);
  if (result.status !== 0 && result.status !== 1) throw new Error(`jscpd ended with exit status ${result.status}`);
  return { status: result.status, output };
}

if (isMain(import.meta.url)) {
  const { status } = duplicationCheck(repositoryRoot());
  console.log(status === 0 ? '[duplication-check] no piece of code exists twice' : '[duplication-check] a piece of code exists twice; move it into one module that both use');
  process.exit(status);
}
