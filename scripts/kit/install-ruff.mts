// Installs the ruff release that config/toolchain.json ruff declares into the virtual environment var/tools/python, with the
// wrapper ruff in var/tools/bin, by install-wheel-tool.mts: the wheel of this platform is one of the declared sha256 of each
// platform's wheel.
import type { PlatformRelease } from './bootstrap/toolchain-declared.mts';
import { installWheelTool } from './install-wheel-tool.mts';

/** Installs the declared ruff `{ version, sha256, source }` into var/tools/python of `root` and writes the wrapper. */
export function installRuff({ root, declared, print = () => {} }: { root: string; declared: PlatformRelease; print?: (text: string) => void }) {
  return installWheelTool({ root, tool: { name: 'ruff', folder: 'python', module: false }, declared: { version: declared.version, digests: Object.values(declared.sha256), source: declared.source }, print });
}
