// Cargo runner conditions use Rust cfg predicates over the target facts reported by rustc.
export function cargoCfgFacts(output: string): Set<string> {
  const facts = new Set<string>();
  for (const line of output.split(/\r?\n/).map(line => line.trim()).filter(Boolean)) {
    const match = /^([A-Za-z_][A-Za-z_0-9]*)(?:\s*=\s*("(?:[^"\\]|\\.)*"))?$/.exec(line);
    if (!match?.[1]) throw new Error(`invalid rustc cfg output: ${line}; inspect the declared compiler's --print=cfg output`);
    facts.add(match[2] === undefined ? match[1] : `${match[1]}=${JSON.stringify(JSON.parse(match[2]))}`);
  }
  if (!facts.size) throw new Error('rustc reported no target cfg facts; inspect the declared compiler and target');
  return facts;
}

export function cargoCfgMatches(source: string, facts: ReadonlySet<string>): boolean {
  let offset = 0;
  const space = () => { while (/\s/.test(source[offset] ?? '') && offset < source.length) offset++; };
  const fail = (): never => { throw new Error(`invalid Cargo cfg condition at ${offset}: ${source}; provide a valid target cfg predicate`); };
  const take = (character: string): boolean => {
    space();
    if (source[offset] !== character) return false;
    offset++;
    return true;
  };
  const predicate = (): boolean => {
    space();
    const name = /^[A-Za-z_][A-Za-z_0-9]*/.exec(source.slice(offset))?.[0];
    if (!name) return fail();
    offset += name.length;
    if (take('=')) {
      space();
      const quoted = /^"(?:[^"\\]|\\.)*"/.exec(source.slice(offset))?.[0];
      if (!quoted) return fail();
      offset += quoted.length;
      const value: unknown = JSON.parse(quoted);
      return facts.has(`${name}=${JSON.stringify(value)}`);
    }
    if (!take('(')) return facts.has(name);
    const values: boolean[] = [];
    if (!take(')')) {
      for (;;) {
        values.push(predicate());
        if (take(')')) break;
        if (!take(',')) return fail();
        if (take(')')) break;
      }
    }
    if (name === 'all') return values.every(Boolean);
    if (name === 'any') return values.some(Boolean);
    if ((name === 'not' || name === 'cfg') && values.length === 1)
      return name === 'not' ? !values[0] : Boolean(values[0]);
    return fail();
  };
  if (!source.trimStart().startsWith('cfg(')) return fail();
  const result = predicate();
  space();
  if (offset !== source.length) return fail();
  return result;
}
