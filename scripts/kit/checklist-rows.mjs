// Reading an execution checklist. A checklist holds only tasks (and headings and the document markers), in one of two styles:
//
//   table  task rows `| <ID> | ... | [o] |` under a header row `| ID | ... |`; the state is the start of the last cell
//   list   items `- [o] <ID> text`, sub-items indented; the state is the bracket at the start of the item
//
// A task is in one of four states: `[ ]` waiting, `[~]` in progress, `[o]` done, `[!]` bypassed with its cause and its
// retry condition (a table row ends with `[!] cause: <cause>; retry: <condition>`; a list item holds `Cause:` and
// `Retry:`). A state marker stands only in the place of a state, so a reader of the checklist can trust every marker;
// the task list markers `[x]` and `[X]` count as markers. Every other line and marker is a finding with its line and
// column. Both languages of a checklist are read by the same rules; the Korean labels 원인: and 재시도: are accepted.

const MARKER = /\[[ ~o!xX]\]/g;
const SEPARATOR = /^\|(\s*:?-{3,}:?\s*\|)+\s*$/;
const TABLE_BYPASS = /^\[!\] (?:cause|원인): \S.*; (?:retry|재시도): \S.*$/;

/** The cells of a table row split on `|` that is not escaped, with the column (0-based) at which each begins. */
function cells(line) {
  const result = [];
  let start = 1;
  for (let index = 1; index < line.length; index += 1) {
    if (line[index] === '|' && line[index - 1] !== '\\') {
      result.push({ text: line.slice(start, index), start });
      start = index + 1;
    }
  }
  return line.trimEnd().endsWith('|') ? result : [...result, { text: line.slice(start), start }];
}

const finding = (line, column, rule, message) => ({ line, column, rule, message });

/**
 * Reads a checklist of `text`. `idPattern` is the source of the regular expression that a task ID matches as a whole.
 * Returns `{ findings, rows }`; each row is `{ id, state, line }` with `state` one of ` `, `~`, `o`, `!`.
 */
export function readChecklist(text, { style, idPattern }) {
  const id = new RegExp(`^(?:${idPattern})$`);
  const findings = [];
  const rows = [];
  const seen = new Map();
  const note = (line, task, state) => {
    if (seen.has(task)) findings.push(finding(line, 1, 'checklist-duplicate', `the task ${task} has a second row; the first is on line ${seen.get(task)}`));
    else seen.set(task, line);
    rows.push({ id: task, state, line });
  };
  const lines = text.replace(/\n$/, '').split('\n');
  let item = null;
  const items = [];
  lines.forEach((line, index) => {
    const number = index + 1;
    let place = -1;
    // The document markers <!-- doc-id: ... --> and <!-- source-sha256: ... --> stand in every document.
    let allowed = line.trim() === '' || /^#{1,6} \S/.test(line) || /^<!-- (?:doc-id|source-sha256): \S+ -->$/.test(line);
    if (style === 'table') {
      const end = line.trimEnd().length - 1;
      const row = line.startsWith('|') ? cells(line) : [];
      const first = row[0]?.text.trim().split(/\s+/)[0] ?? '';
      if (row.length && id.test(first)) {
        allowed = true;
        const last = row[row.length - 1];
        const state = last.text.trim();
        place = last.start + last.text.search(/\S/);
        if (line[end] !== '|' || !state) findings.push(finding(number, line.length + 1, 'checklist-state', `the row of ${first} does not end with a state cell; expected a closing | after [ ], [~], [o] or [!] cause: <cause>; retry: <condition>`));
        else if (/^\[( |~|o)\]$/.test(state)) note(number, first, state[1]);
        else if (TABLE_BYPASS.test(state)) note(number, first, '!');
        else {
          findings.push(finding(number, place + 1, 'checklist-state', `the state of ${first} is ${JSON.stringify(state)}; expected [ ], [~], [o] or [!] cause: <cause>; retry: <condition>`));
          note(number, first, '?');
        }
      } else if (/^\|\s*ID\s*\|/.test(line) || SEPARATOR.test(line)) allowed = true;
      if (!allowed) {
        const where = line.startsWith('|') ? `the first cell ${JSON.stringify(first)} is not a task ID matching ${idPattern}` : 'the line is not a heading or a task table row';
        findings.push(finding(number, Math.max(line.search(/\S/), 0) + 1, 'checklist-line', `${where}; a checklist holds only tasks, so its plan and notes belong in another document`));
      }
    } else {
      const entry = /^( *)- \[(.)\] (\S+)(.*)$/.exec(line);
      if (entry && id.test(entry[3])) {
        allowed = true;
        place = entry[1].length + 2;
        item = { task: entry[3], state: entry[2], line: number, text: line, indent: entry[1].length };
        items.push(item);
        if (!' ~o!'.includes(entry[2])) findings.push(finding(number, place + 1, 'checklist-state', `the state of ${entry[3]} is [${entry[2]}]; expected [ ], [~], [o] or [!]`));
        note(number, entry[3], ' ~o!'.includes(entry[2]) ? entry[2] : '?');
      } else if (item && /^ +\S/.test(line) && line.search(/\S/) > item.indent) {
        allowed = true;
        item.text += `\n${line}`;
      }
      if (/^#{1,6} \S/.test(line)) item = null;
      if (!allowed) findings.push(finding(number, Math.max(line.search(/\S/), 0) + 1, 'checklist-line', 'the line is not a heading, a task item "- [ ] <ID> text" or the continuation of one; a checklist holds only tasks'));
    }
    for (const marker of line.matchAll(MARKER)) {
      if (marker.index !== place) findings.push(finding(number, marker.index + 1, 'checklist-marker', `the state marker ${marker[0]} is not the state of a task; a state marker stands only at the start of ${style === 'table' ? 'the last cell of a task row' : 'a task item'}`));
    }
  });
  // A bypassed item names its cause and its retry condition on the item or its continuation lines.
  for (const entry of items.filter(candidate => candidate.state === '!')) {
    if (!/(?:cause|원인):\s*\S/i.test(entry.text)) findings.push(finding(entry.line, 1, 'checklist-state', `the bypassed task ${entry.task} names no cause; write "Cause: <cause>" on the item`));
    if (!/(?:retry|재시도):\s*\S/i.test(entry.text)) findings.push(finding(entry.line, 1, 'checklist-state', `the bypassed task ${entry.task} names no retry condition; write "Retry: <condition>" on the item`));
  }
  if (!rows.length) findings.push(finding(1, 1, 'checklist-empty', `the checklist has no task whose ID matches ${idPattern}`));
  return { findings, rows };
}
