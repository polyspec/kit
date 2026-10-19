// The rules of the language-parity check that read text: R9 (a list of implementation names in another file, such as the
// language constant of a tool, that differs from its profile) and R10 (a document that counts or lists the implementations
// unlike every profile).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { matchesAny } from './glob.mts';
import { prosePassages } from './markdown.mts';
import { captured, difference, finding } from './parity-declaration.mts';
import type { ParityModel } from './parity-declaration.mts';
import { present } from './present.mts';

/** The words of a list: each run of letters, digits, _ and - that starts with a letter. */
const words = (text: string) => [...text.matchAll(/[A-Za-z][A-Za-z0-9_-]*/g)].map(match => match[0].toLowerCase());

/** R9: the names of each declared list against its profile. */
export function languageLists(model: ParityModel, root: string) {
  return (model.config.languageLists ?? []).flatMap((list) => {
    // readDeclaration reports an unknown profile of a list, and the rules do not run on a declaration with findings.
    const expected = present(model.profiles.get(list.profile), 'model.profiles.get(list.profile)');
    const matches = captured(readFileSync(path.join(root, list.file), 'utf8'), list.pattern);
    if (!matches.length) return [finding('R9', `the pattern ${list.pattern} matches nothing; the list moved or the declaration is stale`, { place: list.file })];
    return matches.flatMap((match) => {
      const found = [...new Set(words(match.text))];
      const differs = difference(expected, found, 'the profile');
      return differs ? [finding('R9', `the list differs from the profile ${list.profile}: ${differs}`, { place: `${list.file}:${match.line}` })] : [];
    });
  });
}

// The numbers that a count of implementations is written with: digits, the English words with both, and the Korean native
// numerals.
const NUMBERS: Record<string, number> = { one: 1, two: 2, both: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, '한': 1, '두': 2, '세': 3, '네': 4, '다섯': 5, '여섯': 6, '일곱': 7, '여덟': 8, '아홉': 9, '열': 10 };
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// The text between two items of one list: a comma, and, or, /, the Korean conjunction for and, or a Korean particle for and
// after the item.
const JOIN = String.raw`\s*,\s*(?:(?:and|or)\s+)?|\s+(?:and|or|및)\s+|(?:와|과)\s+|\s*\/\s*`;
const SEPARATOR = new RegExp(`^(?:${JOIN})$`, 'iu');
// Another item before a run of names: an item, then a separator, up to the first name.
const ITEM_BEFORE = new RegExp(`\\S(?:${JOIN})$`, 'iu');
// Another item after a run of names: the words of the item of its last name, then a separator and an item.
const ITEM_AFTER = new RegExp(`^([^,/]*?)(?:${JOIN})\\S`, 'iu');
// A word that distributes the number after it over the items of its sentence: each, and its Korean word.
const DISTRIBUTIVE = ['each', '각각'];

/**
 * The counts of `text`: each number followed by one of `nouns` after a space, a hyphen (four-client) or a Korean counter
 * of NUMBERS and the Korean counters of the pattern, as `{ text, count, index }`. A number after a distributive word of
 * DISTRIBUTIVE counts per item ("are each one implementation"), so it is no count of the implementations of its sentence.
 */
function countsOf(text: string, nouns: string[]) {
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])(?<!(?<![\\p{L}\\p{N}])(?:${DISTRIBUTIVE.join('|')})\\s+)(\\d+|${Object.keys(NUMBERS).join('|')})(?:\\s*(?:개|가지)\\s*|\\s+|-)(?:${nouns.map(escape).join('|')})(?![A-Za-z0-9])`, 'giu');
  // The first group of the pattern is not optional, so every match holds it.
  return [...text.matchAll(pattern)].map(match => ({ text: match[0], count: /^\d+$/.test(present(match[1], 'match[1]')) ? Number(match[1]) : NUMBERS[present(match[1], 'match[1]').toLowerCase()], index: match.index }));
}

/**
 * The implementations that `text` names, in the order of the text, as `{ name, index, end }`: `written` maps each name and
 * prose name, in lower case, to its implementation.
 */
function namesOf(text: string, written: Map<string, string>) {
  const pattern = new RegExp(`(?<![A-Za-z0-9_-])(?:${[...written.keys()].sort((a, b) => b.length - a.length).map(escape).join('|')})(?![A-Za-z0-9_-])`, 'gi');
  return [...text.matchAll(pattern)].map(match => ({ name: present(written.get(match[0].toLowerCase()), 'written.get(match[0].toLowerCase())'), index: match.index, end: match.index + match[0].length }));
}

/**
 * The lists of `text`: each run of three or more of the names `found` joined by separators, as `{ names, index }`. A run with
 * another item of its enumeration on both sides, before its first name and after the item of its last name, lists those
 * items, such as toolchains ("Node.js, npm, Go, Rust, PHP minor version, Composer"), and is no list of implementations; the
 * words after the last name that are one of `nouns` name the implementations of the run ("Go, Rust and PHP implementations,
 * which"), so they are no item.
 */
function listsOf(text: string, found: { name: string; index: number; end: number }[], nouns: string[]) {
  const lists: { names: string[]; index: number; end: number }[] = [];
  for (const match of found) {
    const last = lists.at(-1);
    if (last && SEPARATOR.test(text.slice(last.end, match.index))) Object.assign(last, { names: [...last.names, match.name], end: match.end });
    else lists.push({ names: [match.name], index: match.index, end: match.end });
  }
  const nounWords = new Set(nouns.map(noun => noun.toLowerCase()));
  const amongItems = (list: { index: number; end: number }) => {
    const after = ITEM_AFTER.exec(text.slice(list.end));
    return ITEM_BEFORE.test(text.slice(0, list.index)) && after !== null && !nounWords.has(present(after[1], 'after[1]').trim().toLowerCase());
  };
  return lists.filter(list => !amongItems(list)).map(list => ({ names: [...new Set(list.names)], index: list.index })).filter(list => list.names.length >= 3);
}

/** The sentences of `text`, each `{ text, index }`: they end at ., ! or ? before a space or the end, and a table cell ends one. */
function sentencesOf(text: string, table: boolean) {
  const sentences: { text: string; index: number }[] = [];
  let start = 0;
  for (const match of text.matchAll(table ? /[.!?](?=\s|$)|(?<!\\)\|/g : /[.!?](?=\s|$)/g)) {
    sentences.push({ text: text.slice(start, match.index + 1), index: start });
    start = match.index + 1;
  }
  if (start < text.length) sentences.push({ text: text.slice(start), index: start });
  return sentences;
}

/**
 * R10: the counts and lists of implementations in the prose of the declared documents. A count N, a number before a noun of
 * `documents`, holds when a profile of N implementations holds every implementation that its sentence names, or when its
 * sentence names exactly N implementations and the names of its passage together are a profile. A list, three names or more,
 * holds when the names of its sentence together are a profile.
 */
export function documentCounts(model: ParityModel, root: string, files: Iterable<string>) {
  const documents = model.config.documents;
  if (!documents) return [];
  const profiles = [...model.profiles].map(([name, members]) => ({ name, members }));
  const known = profiles.map(profile => `${profile.name} ${profile.members.length}`).join(', ');
  const listed = profiles.map(profile => `${profile.name}: ${profile.members.join(', ')}`).join('; ');
  const sameSet = (names: string[], members: string[]) => names.length === members.length && names.every(name => members.includes(name));
  const written = new Map(model.config.implementations.flatMap(entry => [entry.name, ...entry.prose ?? []].map(name => [name.toLowerCase(), entry.name] as const)));
  const found: ReturnType<typeof finding>[] = [];
  for (const file of [...files].filter(name => matchesAny(documents.globs, name)).sort()) {
    // The passages of prose of the document, as the Markdown tree reads them (markdown.mts).
    const passages = prosePassages(readFileSync(path.join(root, file), 'utf8'));
    // A Markdown list whose every item names one implementation lists them, and three or more of them are a profile.
    for (const id of new Set(passages.map(passage => passage.list).filter(list => list !== undefined))) {
      const items = passages.filter(passage => passage.list === id);
      const each = items.map(item => [...new Set(namesOf(item.text, written).map(match => match.name))]);
      if (!each.every(names => names.length === 1)) continue;
      const names = [...new Set(each.flat())];
      if (names.length < 3 || profiles.some(profile => sameSet(names, profile.members))) continue;
      found.push(finding('R10', `the Markdown list ${names.join(', ')} names one implementation per item, which is no profile (${listed})`, { place: `${file}:${present(items[0], 'items[0]').line}` }));
    }
    for (const passage of passages) {
      const prose = passage.text;
      const place = (index: number) => `${file}:${passage.line + prose.slice(0, index).split('\n').length - 1}`;
      const named = (text: string) => [...new Set(namesOf(text, written).map(match => match.name))];
      const passageProfile = profiles.some(profile => sameSet(named(prose), profile.members));
      for (const sentence of sentencesOf(prose, passage.table)) {
        const names = namesOf(sentence.text, written);
        const sentenceNames = named(sentence.text);
        for (const count of countsOf(sentence.text, documents.nouns)) {
          const held = profiles.some(profile => profile.members.length === count.count && sentenceNames.every(name => profile.members.includes(name)));
          if (held || (sentenceNames.length === count.count && passageProfile)) continue;
          const holds = sentenceNames.length ? `no profile of ${count.count} implementations holds ${sentenceNames.join(', ')}, the implementations of its sentence` : `no profile has ${count.count} implementations`;
          found.push(finding('R10', `"${count.text}" counts ${count.count}, and ${holds} (${known})`, { place: place(sentence.index + count.index) }));
        }
        if (profiles.some(profile => sameSet(sentenceNames, profile.members))) continue;
        for (const list of listsOf(sentence.text, names, documents.nouns)) {
          found.push(finding('R10', `the list ${list.names.join(', ')} is in a sentence that names ${sentenceNames.join(', ')}, which is no profile (${listed})`, { place: place(sentence.index + list.index) }));
        }
      }
    }
  }
  return found;
}
