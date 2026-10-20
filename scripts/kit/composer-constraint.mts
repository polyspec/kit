// Whether a version satisfies a Composer constraint, for the requirements of a locked package on php and on ext-*. Composer's forms
// are read here: `||` alternatives; within an alternative, terms separated by spaces or commas, all of which must hold; a term is a
// version with the operator ^, ~, >=, >, <=, <, =, == or !=, or a bare version (exact), or a wildcard such as 8.4.* or *. Another form
// (a hyphen range, @dev, a stability flag) throws with the text, so the caller reports it instead of judging it.
type Test = (version: number[]) => boolean;

const isNumber = (part: number | null): part is number => part !== null;

// The parts of a version or of a constraint body, up to four, a null for a wildcard x or *; throws on another text.
function partsOf(text: string): (number | null)[] {
  const value = text.trim().replace(/^v/i, '');
  if (!/^(\d+|[xX*])(\.(\d+|[xX*])){0,3}$/.test(value)) throw new Error(`${JSON.stringify(text)} is not a version that kit reads`);
  return value.split('.').map(part => (/^\d+$/.test(part) ? Number(part) : null));
}

// The numbers of a concrete version, compared with zeros padded to four parts.
function numbersOf(text: string): number[] {
  const parts = partsOf(text);
  if (!parts.every(isNumber)) throw new Error(`${JSON.stringify(text)} is a wildcard, not a version`);
  return parts;
}

// -1, 0 or 1: the order of two numbers padded with zeros to four parts.
function compare(a: number[], b: number[]): number {
  for (let index = 0; index < 4; index++) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}

// The exclusive upper bound of a caret or tilde range: the part at `index` is raised by one and the parts after it are dropped.
function bound(numbers: number[], index: number): number[] {
  return [...numbers.slice(0, index), (numbers[index] ?? 0) + 1];
}

// The test of one term of an alternative.
function termTest(term: string): Test {
  const match = /^(\^|~|>=|<=|!=|==|>|<|=)?(.+)$/.exec(term);
  if (match === null) throw new Error(`${JSON.stringify(term)} is not a constraint that kit reads`);
  const [, operator = '', body = ''] = match;
  const parts = partsOf(body);
  if (!parts.every(isNumber)) {
    if (operator !== '') throw new Error(`${JSON.stringify(term)} is a wildcard after ${operator}, which kit does not read`);
    // A wildcard matches a version whose leading parts are those before the first wildcard: 8.4.* is >=8.4 <8.5.
    const prefix: number[] = [];
    for (const part of parts) {
      if (part === null) break;
      prefix.push(part);
    }
    return version => prefix.every((part, index) => version[index] === part);
  }
  switch (operator) {
    case '': case '=': case '==': return version => compare(version, parts) === 0;
    case '!=': return version => compare(version, parts) !== 0;
    case '>': return version => compare(version, parts) > 0;
    case '>=': return version => compare(version, parts) >= 0;
    case '<': return version => compare(version, parts) < 0;
    case '<=': return version => compare(version, parts) <= 0;
    case '^': {
      // ^8.2 is >=8.2 <9.0; ^0.3 is >=0.3 <0.4; ^0.0.3 is >=0.0.3 <0.0.4.
      const first = parts.findIndex(part => part !== 0);
      const upper = bound(parts, first === -1 ? parts.length - 1 : first);
      return version => compare(version, parts) >= 0 && compare(version, upper) < 0;
    }
    case '~': {
      // ~1.2.3 is >=1.2.3 <1.3.0; ~1.2 is >=1.2 <2.0; ~1 is >=1 <2.
      const upper = bound(parts, parts.length >= 3 ? parts.length - 2 : 0);
      return version => compare(version, parts) >= 0 && compare(version, upper) < 0;
    }
    default: throw new Error(`${JSON.stringify(term)} has an operator that kit does not read`);
  }
}

/** Whether `version`, a concrete version such as 8.4.1, satisfies `constraint` in Composer's forms (K415); throws on a form it does not read. */
export function satisfies(constraint: string, version: string): boolean {
  const numbers = numbersOf(version);
  return constraint.split(/\|\|?/).some((alternative) => {
    // An operator and its version may be separated by a space (">= 8.1"); the rejoin keeps each term one token.
    const terms = alternative.trim().replace(/(\^|~|>=|<=|!=|==|>|<|=)\s+/g, '$1').split(/[\s,]+/).filter(term => term !== '');
    // Every term is read before any is judged, so a form that kit does not read throws even after a term that fails.
    const tests = terms.map(termTest);
    return tests.every(test => test(numbers));
  });
}
