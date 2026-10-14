// The declared exceptions to the pins of kit (S4, S8): config/toolchain.json exceptions lists each as
//   { tool, channel, scope, reason, retry }
// where tool is a pinned tool, channel the release that the scope uses instead of the pin (at the pin's precision; for Rust
// also a nightly-<yyyy-mm-dd>), scope the directory of the checkout that it covers ("." for all of it), reason why the pin
// does not fit and retry the condition under which the pin is tried again. A declaration or floor under the scope may equal
// the channel. A malformed exception is a finding, and so is an exception that no declaration or floor uses: it is stale.
// A Rust nightly is not stale when unused, because parity reads its channel to extract the Rust symbols (rustdoc JSON).
import { statSync } from 'node:fs';
import path from 'node:path';
import { toolchainConfig } from './bootstrap/toolchain-declared.mts';
import { isTool, PINNED, PRECISION } from './toolchain-pins.mts';
import { isJsonList, isJsonObject } from './bootstrap/files.mts';
import type { Pins, Tool } from './toolchain-pins.mts';

/** A declared exception to a pin. */
export type Exception = { tool: Tool; channel: string; scope: string; reason: string; retry: string };

const FIELDS = ['tool', 'channel', 'scope', 'reason', 'retry'] as const;
const NIGHTLY = /^nightly-\d{4}-\d{2}-\d{2}$/;

// Whether `directory` is a directory of `root`.
const isDirectory = (root: string, directory: string): boolean => statSync(path.join(root, directory), { throwIfNoEntry: false })?.isDirectory() ?? false;

// The exception `value` at `where` and its findings; the exception only when it is well formed.
function readException(root: string, where: string, value: unknown): { exception?: Exception; findings: string[] } {
  if (!isJsonObject(value)) return { findings: [`${where} is ${JSON.stringify(value)}, not an object of ${FIELDS.join(', ')}`] };
  const findings: string[] = [];
  for (const key of Object.keys(value)) if (!FIELDS.some(field => field === key)) findings.push(`${where} has ${key}, which is no field; the fields are ${FIELDS.join(', ')}`);
  const text = (field: (typeof FIELDS)[number]): string => {
    const entry = value[field];
    if (typeof entry === 'string' && entry.trim() !== '') return entry;
    findings.push(`${where} has no ${field}; an exception declares ${FIELDS.join(', ')}`);
    return '';
  };
  const [tool, channel, scope, reason, retry] = [text('tool'), text('channel'), text('scope'), text('reason'), text('retry')];
  if (findings.length > 0) return { findings };
  if (!isTool(tool)) return { findings: [`${where} tool is ${JSON.stringify(tool)}, which kit does not pin; the tools are ${PINNED.join(', ')}`] };
  if (!PRECISION[tool].test(channel) && !(tool === 'rust' && NIGHTLY.test(channel))) {
    findings.push(`${where} channel is ${JSON.stringify(channel)}, which is no ${tool} release at the precision of the pin${tool === 'rust' ? ' and no nightly-<yyyy-mm-dd>' : ''}`);
  }
  if (scope !== '.' && (path.posix.normalize(scope) !== scope || scope.startsWith('../') || scope.endsWith('/') || path.posix.isAbsolute(scope) || !isDirectory(root, scope))) {
    findings.push(`${where} scope is ${JSON.stringify(scope)}, which is no directory of the checkout; write "." or a path such as packages/<name>`);
  }
  return findings.length ? { findings } : { exception: { tool, channel, scope, reason, retry }, findings };
}

/** The exceptions of config/toolchain.json of `root`, and the findings of the malformed ones, which are left out. */
export function readExceptions(root: string): { exceptions: Exception[]; findings: string[] } {
  const value = toolchainConfig(root).exceptions;
  if (value === undefined) return { exceptions: [], findings: [] };
  if (!isJsonList(value)) return { exceptions: [], findings: [`config/toolchain.json exceptions is ${JSON.stringify(value)}, not a list`] };
  const exceptions: Exception[] = [];
  const findings: string[] = [];
  value.forEach((entry, index) => {
    const read = readException(root, `config/toolchain.json exceptions[${index}]`, entry);
    if (read.exception) exceptions.push(read.exception);
    findings.push(...read.findings);
  });
  return { exceptions, findings };
}

/**
 * The pins of kit with the declared exceptions: which releases of a tool a file may declare, and which exceptions a run
 * used, so that an unused one is reported as stale.
 */
export class Pinning {
  readonly pins: Pins;
  readonly exceptions: Exception[];
  private readonly used = new Set<Exception>();

  constructor(pins: Pins, exceptions: Exception[] = []) {
    this.pins = pins;
    this.exceptions = exceptions;
  }

  // The exceptions of `tool` whose scope holds `file`.
  private covering(tool: Tool, file: string): Exception[] {
    return this.exceptions.filter(entry => entry.tool === tool && (entry.scope === '.' || file === entry.scope || file.startsWith(`${entry.scope}/`)));
  }

  /**
   * The finding of the value `key` of `file`, which holds `actual` where `form` writes a release of `tool` as its value; none
   * when it is the form of the pin or of the channel of an exception that covers the file, which counts as used. With
   * `patch`, a value that names a patch release of the pin's <major>.<minor> (8.5.0 of the pin 8.5) is that release too. The
   * exceptions are those whose scope holds `scope`, the file unless the value belongs to another path, such as the workspace
   * of a lock entry.
   */
  check(file: string, key: string, actual: unknown, tool: Tool, form: (release: string) => string = release => release, { patch = false, scope = file }: { patch?: boolean; scope?: string } = {}): string[] {
    const exceptions = this.covering(tool, scope);
    const names = (release: string) => actual === form(release) || (patch && typeof actual === 'string' && new RegExp(`^${form(release).replaceAll('.', '\\.')}\\.\\d+$`).test(actual));
    if (names(this.pins[tool])) return [];
    const exception = exceptions.find(entry => names(entry.channel));
    if (exception) {
      this.used.add(exception);
      return [];
    }
    const allowed = exceptions.map(entry => ` and the exception of ${entry.scope} allows ${entry.channel}`).join('');
    const expected = [this.pins[tool], ...exceptions.map(entry => entry.channel)].flatMap(release => [JSON.stringify(form(release)), ...(patch ? [JSON.stringify(`${form(release)}.<patch>`)] : [])]).join(' or ');
    return [`${file}: ${key} is ${actual === undefined ? 'missing' : JSON.stringify(actual)}; kit pins ${tool} ${this.pins[tool]}${allowed}, so it must be ${expected}`];
  }

  /** One line for each exception that no checked value used; a Rust nightly is read by parity, so it is never stale. */
  stale(): string[] {
    return this.exceptions.flatMap((entry, index) => this.used.has(entry) || (entry.tool === 'rust' && NIGHTLY.test(entry.channel)) ? [] : [
      `config/toolchain.json exceptions[${index}]: nothing under ${entry.scope} uses ${entry.tool} ${entry.channel}, so the exception is stale; remove it (its retry condition: ${entry.retry})`,
    ]);
  }
}
