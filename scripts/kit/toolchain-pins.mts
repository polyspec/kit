// The toolchain pins that kit ships (S4), read from toolchain-pins.json beside this module, so the package carries them to
// every repository: Node.js, Go, Rust and TypeScript by release, Python and PHP by minor release. The pins are versions only: a checkout declares
// the Go and Python that mise installs in its mise.toml, which must equal the pins, and mise.lock holds their digests.
import SHIPPED from './toolchain-pins.json' with { type: 'json' };

const EXACT = /^\d+\.\d+\.\d+$/;
const MINOR = /^\d+\.\d+$/;
export const PRECISION = { node: EXACT, python: MINOR, php: MINOR, go: EXACT, rust: EXACT, typescript: EXACT };

/** A pinned toolchain. */
export type Tool = keyof typeof PRECISION;

/** The pin of each toolchain. */
export type Pins = Record<Tool, string>;

/** Whether `name` is a tool that kit pins. */
export const isTool = (name: string): name is Tool => Object.hasOwn(PRECISION, name);

/** The tools that kit pins. */
export const PINNED: Tool[] = Object.keys(PRECISION).filter(isTool);

/** The pins of `value`, the parsed toolchain-pins.json; an error names a key of the wrong form, a missing or an unknown key. */
export function readPins(value: Record<string, unknown>): Pins {
  for (const key of Object.keys(value)) {
    if (!isTool(key)) throw new Error(`toolchain-pins.json records ${key}, which is no pin; the pins are ${PINNED.join(', ')}`);
  }
  const pin = (tool: Tool): string => {
    const recorded = value[tool];
    if (typeof recorded !== 'string' || !PRECISION[tool].test(recorded)) {
      throw new Error(`toolchain-pins.json must record ${tool} as ${PRECISION[tool] === EXACT ? '<major>.<minor>.<patch>' : '<major>.<minor>'}; it records ${JSON.stringify(recorded)}`);
    }
    return recorded;
  };
  return { node: pin('node'), python: pin('python'), php: pin('php'), go: pin('go'), rust: pin('rust'), typescript: pin('typescript') };
}

/** The pins that kit ships. */
export const PINS: Pins = readPins(SHIPPED);
