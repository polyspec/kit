// Installs the Rust toolchains of the checkout with rustup, the one tool that a machine provides (AGENTS.md):
//   - the channel, profile, components and targets that rust-toolchain.toml declares, passed explicitly to `rustup toolchain
//     install --no-self-update`, which judges them; without a channel rustup installs the active toolchain (K840): rustup's active toolchain may already exist without a requested component such as clippy.
//     rustup 1.28 no longer installs a missing toolchain as cargo first runs, so a cargo of CI failed with
//     "toolchain '<channel>-<host>' is not installed" (K151). An installed toolchain is kept by rustup itself.
//   - the Rust channels that config/toolchain.json exceptions declare, such as the nightly whose rustdoc JSON the parity check
//     reads, with `rustup toolchain install <channel> --profile minimal`; rustup keeps an installed channel itself (K861).
// A missing rustup fails with its install and with what needs it; nothing else of the machine changes.
import { spawnSync } from 'node:child_process';
import { readTomlFile } from './toolchain-files.mts';
import { isStringArray, isTable } from './toml.mts';

// The failure of a missing rustup: `need` names what needs it.
const missing = (need: string) => new Error(`${need}, and rustup is missing; rustup is the one tool that the machine provides (AGENTS.md): install it from https://rustup.rs`);

/** Installs the channel and the requested components that rust-toolchain.toml declares, including when the channel is already installed. */
export function installRustToolchain({ root, print = () => {} }: { root: string; print?: (text: string) => void }) {
  const config = readTomlFile(root, 'rust-toolchain.toml');
  const { channel, profile, components, targets } = isTable(config.toolchain) ? config.toolchain : {};
  const args = ['toolchain', 'install', '--no-self-update'];
  if (typeof profile === 'string') args.push('--profile', profile);
  // rustup takes a component or a target as a comma-separated list, so a string is passed as declared too.
  for (const component of typeof components === 'string' ? [components] : isStringArray(components) ? components : []) args.push('--component', component);
  for (const target of typeof targets === 'string' ? [targets] : isStringArray(targets) ? targets : []) args.push('--target', target);
  if (typeof channel === 'string') args.push(channel);
  print(`rustup ${args.join(' ')}`);
  const result = spawnSync('rustup', args, { cwd: root, stdio: 'inherit' });
  const error: NodeJS.ErrnoException | undefined = result.error;
  if (error?.code === 'ENOENT') throw missing('rust-toolchain.toml declares the Rust toolchain');
  if (result.error || result.status !== 0) throw new Error(`rustup ${args.join(' ')} failed: ${result.error?.message ?? `exit status ${result.status}`}`);
}

/** Installs each channel of `channels` with rustup, which keeps an installed one (K861). */
export function installRustChannels({ root, channels, print = () => {} }: { root: string; channels: readonly string[]; print?: (text: string) => void }) {
  for (const channel of channels) {
    const args = ['toolchain', 'install', channel, '--profile', 'minimal'];
    print(`rustup ${args.join(' ')}`);
    const result = spawnSync('rustup', args, { cwd: root, stdio: 'inherit' });
    const error: NodeJS.ErrnoException | undefined = result.error;
    if (error?.code === 'ENOENT') throw missing(`config/toolchain.json exceptions declare the Rust channel ${channel}`);
    if (result.error || result.status !== 0) throw new Error(`rustup ${args.join(' ')} failed: ${result.error?.message ?? `exit status ${result.status}`}`);
  }
}
