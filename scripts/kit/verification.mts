// The verification of the items of the checklists (K249-3): the Verification cell of an item names, in backticks, the
// commands that verify it. An open item, waiting or active, names at least one, and none of them is a pipeline. A closed item is
// history and is not read. docs-check reports the findings, and `make item-test` runs the commands.
import { columnOf, readChecklist, statesOf } from './checklist.mts';
import type { FileFinding, Tracker } from './checklist.mts';
import { lineBlocks } from './markdown.mts';

/** The commands of a Verification cell: its spans in backticks. */
export function commandsOf(cell: string): string[] {
  return [...cell.matchAll(/`([^`]+)`/g)].flatMap(match => (match[1] ? [match[1].trim()] : []));
}

/**
 * Whether a command holds an unquoted single pipe, not the operator `||` (K376): a pipeline hides the exit status of its first
 * command, so the pattern of `go test -run A|B` is quoted. A backslash escapes the next character outside single quotes.
 */
function hasPipe(command: string): boolean {
  let quote: '"' | "'" | undefined;
  for (let index = 0; index < command.length; index++) {
    const char = command[index];
    if (quote !== "'" && char === '\\') index++;
    else if (quote === "'" || quote === '"') {
      if (char === quote) quote = undefined;
    } else if (char === "'" || char === '"') quote = char;
    else if (char === '|') {
      if (command[index + 1] === '|') index++;
      else return true;
    }
  }
  return false;
}

/** The Verification cell of each item row of `text` of `tracker`, by its line (1-based); none when its columns hold no Verification. */
function verificationCells(text: string, tracker: Tracker): Map<number, string> {
  const cells = new Map<number, string>();
  const column = columnOf(tracker, 'Verification');
  lineBlocks(text).forEach((block, index) => {
    if (block.kind === 'tableRow' && column >= 0) {
      const cell = block.cells[column];
      if (cell) cells.set(index + 1, cell.text.replace(/\\\|/g, '|'));
    }
  });
  return cells;
}

/** The commands that verify the item `id` of the checklist `text` of `tracker`; throws when it holds no such item. */
export function itemCommands(text: string, tracker: Tracker, id: string): string[] {
  const item = readChecklist(text, tracker).items.find(entry => entry.id === id);
  if (!item) throw new Error(`${tracker.path} holds no item ${id}`);
  return commandsOf(verificationCells(text, tracker).get(item.line) ?? '');
}

/**
 * The findings of the Verification cells of the open items of the checklists of `trackers` and their translations that
 * `read` gives (undefined for a missing file). A command is read for its form only.
 */
export function verificationFindings(trackers: readonly Tracker[], read: (file: string) => string | undefined): FileFinding[] {
  const found: FileFinding[] = [];
  for (const tracker of trackers) {
    // A repository whose declared columns hold no Verification names no commands to read (K1110).
    if (columnOf(tracker, 'Verification') < 0) continue;
    const { waiting, active } = statesOf(tracker);
    for (const file of [tracker.path, tracker.translation]) {
      const text = read(file);
      if (text === undefined) continue;
      const cells = verificationCells(text, tracker);
      for (const item of readChecklist(text, tracker).items.filter(entry => entry.state === waiting || entry.state === active)) {
        const add = (message: string) => found.push({ file, finding: { line: item.line, column: 1, rule: 'checklist-verification', message } });
        const commands = commandsOf(cells.get(item.line) ?? '');
        if (commands.length === 0) add(`the open item ${item.id} names no command in backticks in its Verification cell; name the unit tests that verify it`);
        for (const command of commands) {
          if (hasPipe(command)) add(`the command \`${command}\` of the open item ${item.id} is a pipeline; quote the pattern (e.g. -run 'A|B'), since a pipeline hides the exit status of its first command`);
        }
      }
    }
  }
  return found;
}
