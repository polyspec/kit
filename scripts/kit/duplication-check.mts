#!/usr/bin/env node
// The duplication check of a repository (`make duplication-check`, K248-3): jscpd, a dependency of @polyspec/kit, reads the
// code of the checkout that .gitignore leaves and fails on a piece of code that exists twice, the sign of a concern that two
// components hold. The repository declares the rule in config/duplication.json (K1104): the jscpd formats it reads (`formats`),
// the minimum lines of a piece (`minLines`), the ignore-patterns of jscpd for lines that carry no logic, such as the file header
// of each format (`ignorePatterns`, K287; jscpd splits them at commas, so a pattern holds none), and the globs that are not read,
// each with its reason (`exclude`). What it does not declare is jscpd's own default. The files that config/generated.json
// declares generated (K640) are not read either.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import path from 'node:path';
import { isJsonObject, readJson } from './bootstrap/files.mts';
import { CONFIG as GENERATED, loadGeneratedConfig } from './generated-files.mts';
import { isMain, repositoryRoot } from './paths.mts';
import { readConfig } from './schema-validate.mts';

export const CONFIG = 'config/duplication.json';
// The command of the package jscpd that the check runs.
const COMMAND = 'jscpd';

/** config/duplication.json as duplication.schema.json describes it. */
type DuplicationConfig = { formats?: string[]; minLines?: number; ignorePatterns?: string[]; exclude?: { glob: string; reason?: string }[] };

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
  const { formats, minLines, ignorePatterns, exclude = [] }: Partial<DuplicationConfig> = existsSync(path.join(root, CONFIG)) ? readConfig<DuplicationConfig>(root, CONFIG, 'duplication.schema.json') : {};
  // A generated file repeats what its generator writes for each input; config/generated.json already declares it (K640), and a tracked
  // generated source is one too, since its single source is the generator (K956).
  const generated = existsSync(path.join(root, GENERATED)) ? (({ paths, exceptions, tracked = [] }) => [...paths, ...exceptions.map(item => item.path), ...tracked.map(item => item.path)])(loadGeneratedConfig(root)) : [];
  // --ignore splits its value at each comma, so a brace glob {a,b} would exclude nothing (K310): the globs go whole in a configuration file.
  const folder = mkdtempSync(path.join(tmpdir(), 'kit-jscpd-'));
  const config = path.join(folder, 'jscpd.json');
  // kit leaves out no path of its own (K1117): a repository excludes the S10 stub of its PHP extension in config/duplication.json.
  writeFileSync(config, JSON.stringify({ ignore: [...exclude.map(entry => entry.glob), ...generated] }));
  const declared = [
    ...(minLines === undefined ? [] : ['--min-lines', String(minLines)]),
    ...(formats === undefined ? [] : ['--format', formats.join(',')]),
    ...(ignorePatterns === undefined ? [] : ['--ignore-pattern', ignorePatterns.join(',')]),
  ];
  const args = ['--config', config, ...declared, '--exit-code', '1', '--reporters', 'console', root];
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
