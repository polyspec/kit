// TOML files (pylock.toml, pyproject.toml, Cargo.toml) read by smol-toml, which reads TOML 1.1. A datetime is a TomlDate.
import { parse, TomlDate, TomlError, type TomlTable, type TomlValue } from 'smol-toml';

export type { TomlTable, TomlValue };

/**
 * The table of the TOML text of `file`. A text that is no valid TOML throws `<file> line <L> column <C>: <reason>`, the
 * first line of the error of smol-toml; the code frame that follows it repeats the text of the file.
 */
export function readToml(text: string, file: string): TomlTable {
  try {
    return parse(text);
  } catch (error) {
    if (!(error instanceof TomlError)) throw error;
    throw new Error(`${file} line ${error.line} column ${error.column}: ${error.message.split('\n')[0]}`, { cause: error });
  }
}

/** Whether a TOML value is a table: an object that is neither an array nor a datetime. */
export const isTable = (value: unknown): value is TomlTable => value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof TomlDate);

/** Whether a TOML value is an array of strings. */
export const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string');
