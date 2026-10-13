// Installs the Rust channels that config/toolchain.json exceptions declare, such as the nightly whose rustdoc JSON the parity
// check reads, with `rustup toolchain install <channel> --profile minimal`. rustup is the one tool that a machine provides
// (AGENTS.md): it installs the channel of rust-toolchain.toml as cargo first runs, and these channels here. A channel that
// `rustup toolchain list` names is kept. A missing rustup fails with its install; nothing else of the machine changes.
import { spawnSync } from 'node:child_process';
import { run } from './bootstrap/tool-wrappers.mts';

/** Installs each channel of `channels` that rustup does not list; returns `{ installed }`, the channels installed. */
export function installRustChannels({ root, channels, print = () => {} }: { root: string; channels: readonly string[]; print?: (text: string) => void }) {
  const listed = spawnSync('rustup', ['toolchain', 'list'], { cwd: root, encoding: 'utf8' });
  if ((listed.error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') {
    throw new Error(`config/toolchain.json exceptions declare the Rust channel ${channels.join(', ')}, and rustup is missing; rustup is the one tool that the machine provides (AGENTS.md): install it from https://rustup.rs`);
  }
  if (listed.error || listed.status !== 0) throw new Error(`rustup toolchain list failed: ${listed.error?.message ?? `exit status ${listed.status}`} ${listed.stderr}`.trim());
  // rustup lists a channel with its host, such as nightly-2026-10-01-aarch64-apple-darwin, and may mark the default.
  const present = listed.stdout.split('\n').map(line => line.trim().split(/\s+/)[0] ?? '').filter(Boolean);
  const installed = channels.filter(channel => !present.some(name => name === channel || name.startsWith(`${channel}-`)));
  for (const channel of installed) run('rustup', ['toolchain', 'install', channel, '--profile', 'minimal'], { cwd: root }, print);
  return { installed: installed.length > 0 ? installed : undefined };
}
