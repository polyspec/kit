// The declared exceptions of config/toolchain.json (S4, S8) of one tool, as the caller that installs or runs that tool reads them:
//   { tool, channel, scope }
// where channel is what the tool installs or runs and scope the directory of the checkout that the entry covers ("." for all of
// it, the default). kit reads the entries of the tool its caller names and nothing else: an entry of another tool, a field that kit
// does not read and the form of a channel are the repository's own (K1072). install-tools reads the Rust channels when it installs
// rust.
import { toolchainConfig } from './bootstrap/toolchain-declared.mts';
import { isJsonList, isJsonObject } from './bootstrap/files.mts';

/** A declared exception of a tool: the channel that its scope uses. */
export type Exception = { tool: string; channel: string; scope: string };

/**
 * The exceptions of `tool` in config/toolchain.json of `root`, and the findings of those of its entries that name no channel,
 * which the caller cannot install or run; the entries of other tools are not read.
 */
export function readExceptions(root: string, tool: string): { exceptions: Exception[]; findings: string[] } {
  const value = toolchainConfig(root).exceptions;
  if (!isJsonList(value)) return { exceptions: [], findings: [] };
  const exceptions: Exception[] = [];
  const findings: string[] = [];
  value.forEach((entry, index) => {
    if (!isJsonObject(entry) || entry.tool !== tool) return;
    const { channel, scope } = entry;
    if (typeof channel !== 'string' || channel.trim() === '') findings.push(`config/toolchain.json exceptions[${index}] of ${tool} names no channel; declare the channel that ${tool} installs`);
    else exceptions.push({ tool, channel, scope: typeof scope === 'string' && scope !== '' ? scope : '.' });
  });
  return { exceptions, findings };
}
