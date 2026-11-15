// Workflow environment records: POSIX keys are distinct; supported Windows ASCII names retain first spelling and last value.
import { LocalWorkflowRefusal } from './workflow-refusal.mts';

export type EnvironmentEntry<T> = { key: string; value: T };
const CASE_SENSITIVE = process.platform !== 'win32';

/** Environment capability refusals share the local job refusal boundary. */
export class EnvironmentRefusal extends LocalWorkflowRefusal { override name = 'EnvironmentRefusal'; }

export function environmentKey(key: string, caseSensitive = CASE_SENSITIVE): string {
  if (!caseSensitive && Array.from(key).some(character => character.charCodeAt(0) > 0x7f)) {
    throw new EnvironmentRefusal(`Windows environment name ${JSON.stringify(key)} is non-ASCII; native OrdinalIgnoreCase comparison is not provided by this local runner`);
  }
  return caseSensitive ? key : key.toLowerCase();
}

/** Refuse names that the native local context cannot faithfully compare or serialize. */
export function checkEnvironmentName(key: string, caseSensitive = CASE_SENSITIVE): void {
  environmentKey(key, caseSensitive);
  if (key === '__proto__') throw new EnvironmentRefusal('environment key __proto__ is unsupported by native JSON serialization');
}

/** A single entry update, shared by the native expression context and process-environment merges. */
export function setEnvironmentEntry<T>(entries: Map<string, EnvironmentEntry<T>>, key: string, value: T, caseSensitive = CASE_SENSITIVE): void {
  checkEnvironmentName(key, caseSensitive);
  const lookup = environmentKey(key, caseSensitive);
  entries.set(lookup, { key: entries.get(lookup)?.key ?? key, value });
}

/** Explicit comparison is for policy-unit tests; production callers use the actual platform default. */
export function mergeEnvironment<T>(sources: readonly Readonly<Record<string, T>>[], caseSensitive = CASE_SENSITIVE): Record<string, T> {
  const entries = new Map<string, EnvironmentEntry<T>>();
  for (const source of sources) for (const [key, value] of Object.entries(source)) setEnvironmentEntry(entries, key, value, caseSensitive);
  return Object.fromEntries([...entries.values()].map(({ key, value }) => [key, value]));
}

export function environmentValue<T>(environment: Readonly<Record<string, T>>, name: string, caseSensitive = CASE_SENSITIVE): T | undefined {
  const lookup = environmentKey(name, caseSensitive);
  return Object.entries(environment).find(([key]) => environmentKey(key, caseSensitive) === lookup)?.[1];
}
