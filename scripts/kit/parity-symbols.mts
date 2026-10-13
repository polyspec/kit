// The symbol extractors of the language-parity check (R1 and R11). An implementation that declares `symbols: { extractor,
// entry }` has its public API read by the standard tool of its ecosystem, never by a parser of kit, in the full check; nothing
// is read from a saved snapshot. Each extractor gives the public symbol ids of `entry`:
//   python  scripts/kit/symbols/python.py, the standard library's ast, run by var/tools/bin/python3 -I on a package directory
//           or a module file; ids <module>.<name> and <module>.<class>.<method>
//   ts      the API model of API Extractor (@microsoft/api-extractor) of a .d.ts entry point, such as the one that tsc emits,
//           in the package of the nearest package.json; ids the canonical references, such as @scope/name!Codec#encode:member(1)
// An extractor that cannot run, fails or prints no list of ids is a finding that names the implementation and the command.
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Extractor as ApiExtractor, ExtractorConfig } from '@microsoft/api-extractor';
import { ApiModel } from '@microsoft/api-extractor-model';
import type { ApiItem } from '@microsoft/api-extractor-model';
import { toolsPath } from './bootstrap/tool-wrappers.mts';
import { finding } from './parity-declaration.mts';
import type { Environment, Extractor, Finding, ParityModel } from './parity-declaration.mts';
import { execute } from './process.mts';

/** The public symbol ids of an entry, or why they cannot be read. */
type Extracted = { symbols: string[]; error?: never } | { error: string };

// The extractor programs that kit ships beside its tools (the build copies scripts/kit/symbols into dist/symbols).
const SYMBOLS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'symbols');

/** The last lines of standard error, which explain a failed extractor. */
const tail = (text: string): string => text.trim().split('\n').slice(-3).join(' | ');

/** The ids that the command `command args` prints as a JSON array of strings, run in `root`, or the error of the run. */
function listed(root: string, command: string, args: string[], env: Environment): Extracted {
  const shown = [command, ...args].join(' ');
  const result = execute(command, args, { cwd: root, env });
  if (result.error) return { error: `${shown} could not start: ${result.error.message}` };
  if (result.status !== 0) return { error: `${shown} exited with ${result.status ?? result.signal}: ${tail(result.stderr)}` };
  let value: unknown;
  try {
    value = JSON.parse(result.stdout);
  } catch (error) {
    return { error: `${shown} printed no JSON: ${(error as Error).message}` };
  }
  if (!Array.isArray(value) || value.some(id => typeof id !== 'string')) return { error: `${shown} printed no array of symbol ids` };
  return { symbols: value };
}

/** The directory of the nearest package.json at or above the directory of `file`, or undefined. */
function packageOf(file: string): string | undefined {
  for (let directory = path.dirname(file); ; directory = path.dirname(directory)) {
    if (existsSync(path.join(directory, 'package.json'))) return directory;
    if (path.dirname(directory) === directory) return undefined;
  }
}

/** The canonical references of `item` and its members, depth first. */
const references = (item: ApiItem): string[] => item.members.flatMap(member => [member.canonicalReference.toString(), ...references(member)]);

/** The API model of the .d.ts entry point `entry` of the checkout `root`, read by API Extractor. */
function apiModel(root: string, entry: string): Extracted {
  const file = path.join(root, entry);
  if (!existsSync(file)) return { error: `${entry} does not exist` };
  const project = packageOf(file);
  if (project === undefined) return { error: `no package.json lies above ${entry}` };
  const output = mkdtempSync(path.join(tmpdir(), 'kit-parity-api-'));
  try {
    const config = ExtractorConfig.prepare({
      configObject: {
        projectFolder: project,
        mainEntryPointFilePath: file,
        compiler: { overrideTsconfig: { compilerOptions: { skipLibCheck: true } } },
        docModel: { enabled: true, apiJsonFilePath: path.join(output, 'api.json') },
        apiReport: { enabled: false },
        dtsRollup: { enabled: false },
        tsdocMetadata: { enabled: false },
      },
      configObjectFullPath: undefined,
      packageJsonFullPath: path.join(project, 'package.json'),
    });
    const errors: string[] = [];
    // An error of the analysis fails the extraction; warnings, such as a missing release tag, are the API report's concern.
    // API Extractor throws on a declaration that it cannot follow, such as a syntax error; that is its failure too.
    let result: ReturnType<typeof ApiExtractor.invoke>;
    try {
      result = ApiExtractor.invoke(config, { localBuild: true, messageCallback: (message) => { message.handled = true; if (message.logLevel === 'error') errors.push(message.text); } });
    } catch (error) {
      return { error: `API Extractor failed on ${entry}: ${(error as Error).message}` };
    }
    if (!result.succeeded || errors.length) return { error: `API Extractor failed on ${entry}: ${errors.join(' | ') || `${result.errorCount} errors`}` };
    const api = new ApiModel().loadPackage(path.join(output, 'api.json'));
    return { symbols: api.entryPoints.flatMap(references) };
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
}

// Each extractor: the public symbol ids of `entry` in the checkout `root`.
const EXTRACTORS: Record<Extractor, (root: string, entry: string, env: Environment) => Extracted> = {
  python: (root, entry, env) => listed(root, toolsPath(root, 'bin', 'python3'), ['-I', path.join(SYMBOLS, 'python.py'), entry], env),
  ts: (root, entry) => apiModel(root, entry),
};

/**
 * The public symbols of each implementation of `model` that declares symbols, by its name, and a finding for each extractor
 * that fails; `say` prints a line for each extraction.
 */
export function extractSymbols(model: ParityModel, root: string, { env, say }: { env: Environment; say: (line: string) => void }): { snapshots: Map<string, Set<string>>; findings: Finding[] } {
  const snapshots = new Map<string, Set<string>>();
  const findings: Finding[] = [];
  for (const implementation of model.config.implementations) {
    if (implementation.symbols === undefined) continue;
    const { extractor, entry } = implementation.symbols;
    say(`extract the symbols of ${implementation.name}: ${extractor} ${entry}`);
    const extracted = EXTRACTORS[extractor](root, entry, env);
    if (extracted.error !== undefined) findings.push(finding('R1', `the ${extractor} extractor of ${entry} gives no symbols: ${extracted.error}`, { implementation: implementation.name, place: entry }));
    else snapshots.set(implementation.name, new Set(extracted.symbols));
  }
  return { snapshots, findings };
}
