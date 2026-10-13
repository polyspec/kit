// The toolchain pins that kit ships (S4), read from toolchain-pins.json beside this module, so the package carries them to
// every repository: Node.js, Go, Rust and TypeScript by release, Python and PHP by minor release. toolchain-floors.mts
// compares the declarations and the manifest floors of a checkout with them.
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
    if (!PINNED.includes(key as Tool)) throw new Error(`toolchain-pins.json records ${key}, which is no pin; the pins are ${PINNED.join(', ')}`);
  }
  for (const tool of PINNED) {
    const pin = value[tool];
    if (typeof pin !== 'string' || !PRECISION[tool].test(pin)) {
      throw new Error(`toolchain-pins.json must record ${tool} as ${PRECISION[tool] === EXACT ? '<major>.<minor>.<patch>' : '<major>.<minor>'}; it records ${JSON.stringify(pin)}`);
    }
  }
  return value as Pins;
}

/** The pins that kit ships. */
export const PINS: Pins = readPins(SHIPPED);
