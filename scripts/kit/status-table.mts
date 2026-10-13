// Reading a table of statuses, such as a feature status table: rows `| <ID> | ... |` whose cells have a fixed count, a
// closed set of values or a pattern. The rows of the English and the Korean file must agree on the ID and on every
// column that has a closed set of values (the other columns are translated text).
import { finding } from './findings.mts';
import type { Finding } from './findings.mts';
import { tableCells } from './markdown.mts';

/** A column of a status table that has a closed set of values or a pattern. */
export type StatusColumn = { index: number; enum?: readonly string[] | undefined; pattern?: string | undefined };

/** A status table: the pattern of the ID, the number of cells of a row and the checked columns. */
export type StatusTableSpec = { idPattern: string; cells: number; columns: readonly StatusColumn[] };

/** A row of a status table. */
export type StatusRow = { id: string; values: string[]; line: number };

/**
 * Reads the rows of `text` for the table `spec` ({ idPattern, cells, columns: [{ index, enum?, pattern? }] }).
 * Returns `{ findings, rows }`; each row is `{ id, values, line }` where `values` are the cells of the columns that have a
 * closed set of values.
 */
export function readStatusTable(text: string, spec: StatusTableSpec): { findings: Finding[]; rows: StatusRow[] } {
  const id = new RegExp(`^(?:${spec.idPattern})$`);
  const findings: Finding[] = [];
  const rows: StatusRow[] = [];
  const seen = new Map<string, number>();
  text.split('\n').forEach((line, index) => {
    if (!line.startsWith('|')) return;
    const cells = tableCells(line).map(cell => cell.text.trim());
    // A line whose first cell is no ID is not a row; a line that is only `|` has no first cell.
    const rowId = cells[0];
    if (rowId === undefined || !id.test(rowId)) return;
    const number = index + 1;
    if (cells.length !== spec.cells) findings.push(finding(number, 'status-table', `the row ${rowId} has ${cells.length} cells; expected ${spec.cells}`));
    if (seen.has(rowId)) findings.push(finding(number, 'status-table', `the row ${rowId} repeats the ID of line ${seen.get(rowId)}`));
    else seen.set(rowId, number);
    const values: string[] = [];
    for (const column of spec.columns) {
      const value = cells[column.index] ?? '';
      if (column.enum) {
        values.push(value);
        if (!column.enum.includes(value)) findings.push(finding(number, 'status-table', `the row ${rowId} has ${JSON.stringify(value)} in cell ${column.index + 1}; expected ${column.enum.join(', ')}`));
      }
      if (column.pattern && !new RegExp(column.pattern).test(value)) findings.push(finding(number, 'status-table', `the row ${rowId} has ${JSON.stringify(value)} in cell ${column.index + 1}; expected a match of ${column.pattern}`));
    }
    rows.push({ id: rowId, values, line: number });
  });
  if (!rows.length) findings.push(finding(1, 'status-table', `the table has no row whose first cell matches ${spec.idPattern}`));
  return { findings, rows };
}
