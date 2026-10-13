// Globs of repository paths, read by picomatch with `dot: true`: a path under a dot directory (.github, docs/.vitepress)
// matches like any other path. Owner rules and the document and parity configurations select tracked paths with them; the
// syntax is picomatch's (`*` within one segment, `**` across segments, `{a,b}` alternatives, `?`, ranges and extglobs).
import picomatch from 'picomatch';

const OPTIONS = { dot: true };

/** The regular expression of a glob. */
export function globExpression(glob: string): RegExp {
  return picomatch.makeRe(glob, OPTIONS);
}

/** Whether `file` matches one of `globs`. */
export function matchesAny(globs: readonly string[], file: string): boolean {
  return globs.some(glob => globExpression(glob).test(file));
}
