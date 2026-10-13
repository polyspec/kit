// The toolchain pins that kit ships (S4), read from toolchain-pins.json beside this module, so the package carries them to
// every repository: Node.js, Go, Rust and TypeScript by release, Python and PHP by minor release. toolchain-floors.mts
// compares the declarations and the manifest floors of a checkout with them. Whatever pins a version also pins its digests:
// goArchives holds the sha256 of the Go archive of the pinned release for each platform, which install-go.mts checks.
import SHIPPED from './toolchain-pins.json' with { type: 'json' };

const EXACT = /^\d+\.\d+\.\d+$/;
const MINOR = /^\d+\.\d+$/;
export const PRECISION = { node: EXACT, python: MINOR, php: MINOR, go: EXACT, rust: EXACT, typescript: EXACT };

/** A pinned toolchain. */
export type Tool = keyof typeof PRECISION;

/** The pin of each toolchain. */
export type Pins = Record<Tool, string>;

/** The tools that kit pins. */
export const PINNED = Object.keys(PRECISION) as Tool[];

/** The pins of `value`, the parsed toolchain-pins.json; an error names a key of the wrong form, a missing or an unknown key. */
export function readPins(value: Record<string, unknown>): Pins {
  for (const key of Object.keys(value)) {
    if (key !== 'goArchives' && !PINNED.includes(key as Tool)) throw new Error(`toolchain-pins.json records ${key}, which is no pin; the pins are ${PINNED.join(', ')}`);
  }
  for (const tool of PINNED) {
    const pin = value[tool];
    if (typeof pin !== 'string' || !PRECISION[tool].test(pin)) {
      throw new Error(`toolchain-pins.json must record ${tool} as ${PRECISION[tool] === EXACT ? '<major>.<minor>.<patch>' : '<major>.<minor>'}; it records ${JSON.stringify(pin)}`);
    }
  }
  return Object.fromEntries(PINNED.map(tool => [tool, value[tool]])) as Pins;
}

/** The platform keys (process.platform-process.arch) whose Go archive kit pins. */
export const GO_PLATFORMS = ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64'];

/** The sha256 of the Go archive of each platform, goArchives of the parsed toolchain-pins.json; an error names the platform. */
export function readGoArchives(value: Record<string, unknown>): Record<string, string> {
  const archives = value.goArchives;
  if (typeof archives !== 'object' || archives === null || Array.isArray(archives)) throw new Error(`toolchain-pins.json must record goArchives, the sha256 of the Go archive of each of ${GO_PLATFORMS.join(', ')}; it records ${JSON.stringify(archives)}`);
  const digests = archives as Record<string, unknown>;
  for (const key of Object.keys(digests)) if (!GO_PLATFORMS.includes(key)) throw new Error(`toolchain-pins.json goArchives records ${key}, which is no platform; the platforms are ${GO_PLATFORMS.join(', ')}`);
  for (const platform of GO_PLATFORMS) {
    const digest = digests[platform];
    if (typeof digest !== 'string' || !/^[0-9a-f]{64}$/.test(digest)) throw new Error(`toolchain-pins.json goArchives must record the sha256 of ${platform} as 64 lowercase hexadecimal digits; it records ${JSON.stringify(digest)}`);
  }
  return digests as Record<string, string>;
}

/** The pins that kit ships. */
export const PINS: Pins = readPins(SHIPPED);

/** The sha256 of the Go archive of the pinned release for each platform. */
export const GO_ARCHIVES: Record<string, string> = readGoArchives(SHIPPED);
