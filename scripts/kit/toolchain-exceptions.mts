// The declared exceptions of config/toolchain.json (S4, S8): one entry is read, a Rust nightly, as
//   { tool: "rust", channel: "nightly-<yyyy-mm-dd>", scope, reason, retry }
// where scope is the directory of the checkout that it covers ("." for all of it), reason why the stable release does not
// fit and retry the condition under which the stable release is tried again. Parity reads the nightly channel to extract
// the Rust symbols (rustdoc JSON), so kit judges no other toolchain's version here (K953). A malformed entry is a finding,
// and so is an entry for another tool: the schema accepts only the Rust nightly.
import { statSync } from 'node:fs';
import path from 'node:path';
import { toolchainConfig } from './bootstrap/toolchain-declared.mts';
import { isJsonList, isJsonObject } from './bootstrap/files.mts';

/** A declared exception to the stable Rust release: the nightly that its scope uses. */
export type Exception = { tool: 'rust'; channel: string; scope: string; reason: string; retry: string };

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
  if (tool !== 'rust') return { findings: [`${where} tool is ${JSON.stringify(tool)}, which kit does not declare; the one exception kit reads is a rust nightly (nightly-<yyyy-mm-dd>)`] };
  if (!NIGHTLY.test(channel)) findings.push(`${where} channel is ${JSON.stringify(channel)}, which is no rust nightly; write nightly-<yyyy-mm-dd>`);
  if (scope !== '.' && (path.posix.normalize(scope) !== scope || scope.startsWith('../') || scope.endsWith('/') || path.posix.isAbsolute(scope) || !isDirectory(root, scope))) {
    findings.push(`${where} scope is ${JSON.stringify(scope)}, which is no directory of the checkout; write "." or a path such as packages/<name>`);
  }
  return findings.length ? { findings } : { exception: { tool: 'rust', channel, scope, reason, retry }, findings };
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
