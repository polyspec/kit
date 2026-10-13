// A finding of a document check: `{ line, column, rule, message }` with the column 1.

/** A finding of a document check. */
export type Finding = { line: number; column: number; rule: string; message: string };

/** The finding of `rule` at `line` of a document. */
export const finding = (line: number, rule: string, message: string): Finding => ({ line, column: 1, rule, message });
