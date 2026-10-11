// The rules of the language-parity check that read text: R9 (a list of implementation names in another file, such as the
// language constant of a tool, that differs from its profile) and R10 (a document that counts or lists the implementations
// unlike every profile).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { matchesAny } from './glob.mjs';
import { captured, difference, finding } from './parity-declaration.mjs';

/** The words of a list: each run of letters, digits, _ and - that starts with a letter. */
const words = text => [...text.matchAll(/[A-Za-z][A-Za-z0-9_-]*/g)].map(match => match[0].toLowerCase());

/** R9: the names of each declared list against its profile. */
export function languageLists(model, root) {
  return (model.config.languageLists ?? []).flatMap((list) => {
    const expected = model.profiles.get(list.profile);
    const matches = captured(readFileSync(path.join(root, list.file), 'utf8'), list.pattern);
    if (!matches.length) return [finding('R9', `the pattern ${list.pattern} matches nothing; the list moved or the declaration is stale`, { place: list.file })];
    return matches.flatMap((match) => {
      const found = [...new Set(words(match.text))];
      const differs = difference(expected, found, 'the profile');
      return differs ? [finding('R9', `the list differs from the profile ${list.profile}: ${differs}`, { place: `${list.file}:${match.line}` })] : [];
    });
  });
}

// The numbers that a count of implementations is written with: digits, the English words and the Korean native numerals.
const NUMBERS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, 한: 1, 두: 2, 세: 3, 네: 4, 다섯: 5, 여섯: 6, 일곱: 7, 여덟: 8, 아홉: 9, 열: 10 };
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// The text between two names of one list: a comma, and, or, /, 및, or a Korean particle 와 or 과 after the name.
const SEPARATOR = /^(?:\s*,\s*(?:(?:and|or)\s+)?|\s+(?:and|or|및)\s+|(?:와|과)\s+|\s*\/\s*)$/i;

// A count or a list of fewer than three names an item or a pair of the implementations (one client, a pair of two clients),
// not their set, so R10 reads a count from three and a list of three names or more.
const SET = 3;

/** The counts of `text` from three: each number followed by one of `nouns`, as `{ text, count, index }`. */
function countsOf(text, nouns) {
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])(\\d+|${Object.keys(NUMBERS).join('|')})\\s+(?:${nouns.map(escape).join('|')})(?![A-Za-z0-9])`, 'giu');
  return [...text.matchAll(pattern)].map(match => ({ text: match[0], count: /^\d+$/.test(match[1]) ? Number(match[1]) : NUMBERS[match[1].toLowerCase()], index: match.index }))
    .filter(count => count.count >= SET);
}

/** The implementation names of `text` in the order of the text, as `{ name, index, end }`. */
function namesOf(text, names) {
  const pattern = new RegExp(`(?<![A-Za-z0-9_-])(?:${[...names].sort((a, b) => b.length - a.length).map(escape).join('|')})(?![A-Za-z0-9_-])`, 'gi');
  return [...text.matchAll(pattern)].map(match => ({ name: match[0].toLowerCase(), index: match.index, end: match.index + match[0].length }));
}

/** The lists of `text`: each run of three or more of the names `found` joined by separators, as `{ names, index }`. */
function listsOf(text, found) {
  const lists = [];
  for (const match of found) {
    const last = lists.at(-1);
    if (last && SEPARATOR.test(text.slice(last.end, match.index))) Object.assign(last, { names: [...last.names, match.name], end: match.end });
    else lists.push({ names: [match.name], index: match.index, end: match.end });
  }
  return lists.map(list => ({ names: [...new Set(list.names)], index: list.index })).filter(list => list.names.length >= SET);
}

// A passage is what a statement about the implementations is written in: a paragraph or a list item with the lines that
// continue it, or one heading, table row or line of a fenced block.
const ALONE = /^\s*(?:#|\|)/;
const STARTS = /^\s*(?:[-*+]\s|>|\d+[.)]\s)/;
const FENCE = /^\s*(?:```|~~~)/;

/** The passages of `text`, each `{ text, line }` with the number of its first line. */
function passagesOf(text) {
  const passages = [];
  let current;
  let fenced = false;
  text.split('\n').forEach((line, index) => {
    const fence = FENCE.test(line);
    const alone = fenced || fence || ALONE.test(line);
    if (fence) fenced = !fenced;
    if (!line.trim()) current = undefined;
    else if (current && !alone && !STARTS.test(line)) current.text += `\n${line}`;
    else {
      current = { text: line, line: index + 1 };
      passages.push(current);
      if (alone) current = undefined;
    }
  });
  return passages;
}

/**
 * R10: the counts and lists of implementations in the declared documents, each equal to some profile. A count is a number
 * from three before a noun of `documents`. A list is three names or more, and it is judged with every implementation that its
 * passage names: a passage that states something of a part of the implementations names the others with what they do
 * instead, so a list that its passage does not complete to a profile was written for another set.
 */
export function documentCounts(model, root, files) {
  const documents = model.config.documents;
  if (!documents) return [];
  const profiles = [...model.profiles].map(([name, members]) => ({ name, members }));
  const known = profiles.map(profile => `${profile.name} ${profile.members.length}`).join(', ');
  const listed = profiles.map(profile => `${profile.name}: ${profile.members.join(', ')}`).join('; ');
  const sameSet = (names, members) => names.length === members.length && names.every(name => members.includes(name));
  const found = [];
  for (const file of [...files].filter(name => matchesAny(documents.globs, name)).sort()) {
    for (const passage of passagesOf(readFileSync(path.join(root, file), 'utf8'))) {
      const place = index => `${file}:${passage.line + passage.text.slice(0, index).split('\n').length - 1}`;
      for (const count of countsOf(passage.text, documents.nouns)) {
        if (!profiles.some(profile => profile.members.length === count.count)) found.push(finding('R10', `"${count.text}" counts ${count.count}, and no profile has ${count.count} implementations (${known})`, { place: place(count.index) }));
      }
      const names = namesOf(passage.text, model.implementations.keys());
      const named = [...new Set(names.map(match => match.name))];
      if (profiles.some(profile => sameSet(named, profile.members))) continue;
      for (const list of listsOf(passage.text, names)) {
        found.push(finding('R10', `the list ${list.names.join(', ')} names ${named.join(', ')} with the other implementations of its passage, which is no profile (${listed})`, { place: place(list.index) }));
      }
    }
  }
  return found;
}
