#!/usr/bin/env node
// The duplication check of a repository (`make duplication-check`, K248-3): jscpd, a dependency of @polyspec/kit, reads the
// code of the checkout that .gitignore leaves, in the formats of the runtimes of kit, and fails on a piece of 6 lines or
// more that exists twice, the sign of a concern that two components hold. The folders that config/duplication.json
// excludes, each with its reason, are not read.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { isJsonObject, readJson } from './bootstrap/files.mts';
import { isMain, repositoryRoot } from './paths.mts';
import { readConfig } from './schema-validate.mts';

export const CONFIG = 'config/duplication.json';
// The code formats of jscpd for the runtimes of kit (S5) and the C of the PHP extensions.
const FORMATS = ['typescript', 'javascript', 'go', 'php', 'python', 'rust', 'c'];
const MIN_LINES = '6';

/** config/duplication.json as duplication.schema.json describes it. */
type DuplicationConfig = { schema: 1; exclude: { glob: string; reason: string }[] };

/** The command of jscpd that the package depends on, by the bin of its package.json. */
function jscpd(): string {
  const manifest = createRequire(import.meta.url).resolve('jscpd/package.json');
  const parsed = readJson(manifest);
  const bin = isJsonObject(parsed) ? parsed.bin : undefined;
  const relative = typeof bin === 'string' ? bin : isJsonObject(bin) ? bin.jscpd : undefined;
  if (typeof relative !== 'string') throw new Error(`${manifest} names no bin jscpd`);
  return path.join(path.dirname(manifest), relative);
}

/** Runs jscpd over `root` and returns its status and output, which `print` receives; throws when jscpd cannot start. */
export function duplicationCheck(root: string, print: (text: string) => void = text => process.stdout.write(text)): { status: number; output: string } {
  const excluded = existsSync(path.join(root, CONFIG)) ? readConfig<DuplicationConfig>(root, CONFIG, 'duplication.schema.json').exclude : [];
  const args = ['--min-lines', MIN_LINES, '--format', FORMATS.join(','), '--exit-code', '1', '--reporters', 'console', ...(excluded.length ? ['--ignore', excluded.map(entry => entry.glob).join(',')] : []), root];
  const result = spawnSync(jscpd(), args, { cwd: root, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
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
