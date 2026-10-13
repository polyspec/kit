// The toolchain pins that kit ships (S4), read from toolchain-pins.json beside this module, so the package carries them to
// every repository: Node.js, Go, Rust and TypeScript by release, Python and PHP by minor release. Every declaration of a
// checkout equals its pin at the pin's precision: .node-version, the channel of rust-toolchain.toml, the php minors and the
// python minor. The Go declaration is the go line of a go.mod, which toolchain-floors.mts compares in every go.mod.
import SHIPPED from './toolchain-pins.json' with { type: 'json' };

const EXACT = /^\d+\.\d+\.\d+$/;
const MINOR = /^\d+\.\d+$/;
const PRECISION = { node: EXACT, python: MINOR, php: MINOR, go: EXACT, rust: EXACT, typescript: EXACT };

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

/** The declarations that pinFindings compares, as declaredToolchain of bootstrap/toolchain-declared.mts returns them. */
export type PinnedDeclarations = {
  node?: { version: string; source: string } | undefined;
  rust?: { version: string; source: string } | undefined;
  php?: { minors: string[]; source: string } | undefined;
  python?: { minor: string; source: string } | undefined;
};

/** One line for each declaration of `declared` that differs from its pin; an undeclared tool is not required. */
export function pinFindings(declared: PinnedDeclarations, pins: Pins): string[] {
  const values: [Tool, string[], string][] = [];
  for (const tool of ['node', 'rust'] as const) {
    const entry = declared[tool];
    if (entry) values.push([tool, [entry.version], entry.source]);
  }
  if (declared.php) values.push(['php', declared.php.minors, declared.php.source]);
  if (declared.python) values.push(['python', [declared.python.minor], declared.python.source]);
  return values.flatMap(([tool, versions, source]) => versions
    .filter(version => version !== pins[tool])
    .map(version => `${source} declares ${tool} ${version}; kit pins ${tool} ${pins[tool]}, so declare ${pins[tool]}`));
}
