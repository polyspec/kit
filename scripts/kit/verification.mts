// The verification of the items of the checklists (K249-3): the Verification cell of an item names, in backticks, the
// commands that verify it, and `make item-test` runs them. docs-check requires none (K1132).
import { columnOf, readChecklist } from './checklist.mts';
import type { Tracker } from './checklist.mts';
import { lineBlocks } from './markdown.mts';

/** The commands of a Verification cell: its spans in backticks. */
export function commandsOf(cell: string): string[] {
  return [...cell.matchAll(/`([^`]+)`/g)].flatMap(match => (match[1] ? [match[1].trim()] : []));
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
