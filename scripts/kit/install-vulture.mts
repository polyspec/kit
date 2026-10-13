// Installs the vulture release that config/toolchain.json vulture declares into the virtual environment var/tools/vulture,
// with the wrapper vulture in var/tools/bin, by install-wheel-tool.mts. vulture finds dead Python code (make lint-python);
// its wheel is pure Python (py3-none-any), so the declaration holds the one sha256 of that wheel.
import type { Declared } from './bootstrap/toolchain-declared.mts';
import { installWheelTool } from './install-wheel-tool.mts';

/** Installs the declared vulture `{ version, sha256, source }` into var/tools/vulture of `root` and writes the wrapper. */
export function installVulture({ root, declared, print = () => {} }: { root: string; declared: Declared & { sha256: string }; print?: (text: string) => void }) {
  return installWheelTool({ root, tool: { name: 'vulture', folder: 'vulture', module: true }, declared: { version: declared.version, digests: [declared.sha256], source: declared.source }, print });
}
