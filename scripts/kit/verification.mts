// The verification of the items of the checklists (K249-3): the Verification cell of an item names, in backticks, the
// commands that verify it. An open item, waiting or active, names at least one, and none that the Claude Code hook refuses
// (claude-hook.mts), so no item is verified by a suite or a run without a selection: each runs its own unit tests. A closed
// item is history and is not read. docs-check reports the findings, and `make item-test` runs the commands.
import { ACTIVE, CHECKLIST_COLUMNS, readChecklist, WAITING } from './checklist.mts';
import type { FileFinding, Tracker } from './checklist.mts';
import { refusal } from './claude-hook.mts';
import type { MakeDatabase } from './owner-check.mts';
import { lineBlocks } from './markdown.mts';
import path from 'node:path';

const VERIFICATION = CHECKLIST_COLUMNS.indexOf('Verification');

/** The commands of a Verification cell: its spans in backticks. */
export function commandsOf(cell: string): string[] {
  return [...cell.matchAll(/`([^`]+)`/g)].flatMap(match => (match[1] ? [match[1].trim()] : []));
}

/** The Verification cell of each item row of `text`, by its line (1-based). */
function verificationCells(text: string): Map<number, string> {
  const cells = new Map<number, string>();
  lineBlocks(text).forEach((block, index) => {
    if (block.kind === 'tableRow') {
      const cell = block.cells[VERIFICATION];
      if (cell) cells.set(index + 1, cell.text.replace(/\\\|/g, '|'));
    }
  });
  return cells;
}

/** The commands that verify the item `id` of the checklist `text` of `tracker`; throws when it holds no such item. */
export function itemCommands(text: string, tracker: Tracker, id: string): string[] {
  const item = readChecklist(text, tracker).items.find(entry => entry.id === id);
  if (!item) throw new Error(`${tracker.path} holds no item ${id}`);
  return commandsOf(verificationCells(text).get(item.line) ?? '');
}

/**
 * The findings of the Verification cells of the open items of the checklists of `trackers` and their translations that
 * `read` gives (undefined for a missing file); `make` gives the database of the Makefile, through which the hook follows a
 * make target. A command is read for its form: a test file that it names may not exist before the item is done, so a path
 * with an extension is a file, and a directory, such as tests/kit, is none.
 */
export function verificationFindings(trackers: readonly Tracker[], read: (file: string) => string | undefined, make: () => MakeDatabase | undefined): FileFinding[] {
  const found: FileFinding[] = [];
  for (const tracker of trackers) {
    for (const file of [tracker.path, tracker.translation]) {
      const text = read(file);
      if (text === undefined) continue;
      const cells = verificationCells(text);
      for (const item of readChecklist(text, tracker).items.filter(entry => entry.state === WAITING || entry.state === ACTIVE)) {
        const add = (message: string) => found.push({ file, finding: { line: item.line, column: 1, rule: 'checklist-verification', message } });
        const commands = commandsOf(cells.get(item.line) ?? '');
        if (commands.length === 0) add(`the open item ${item.id} names no command in backticks in its Verification cell; name the unit tests that verify it`);
        for (const command of commands) {
          const refused = refusal(command, word => /\.[A-Za-z0-9]+$/.test(path.basename(word)), make);
          if (refused) add(`the command \`${command}\` of the open item ${item.id} is refused by the Claude Code hook: ${refused}`);
        }
      }
    }
  }
  return found;
}
