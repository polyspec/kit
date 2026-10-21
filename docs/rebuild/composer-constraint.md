<!-- doc-id: rebuild-composer-constraint -->
# Rebuild record: composer-constraint

[한국어](composer-constraint.ko.md)

Verdict: **none fits.** kit keeps `composer-constraint.mts`, which `check-dependency-policy.mts` uses to judge the `php` and
`ext-*` requirements of a locked Composer package. Measured on 2026-10-21 (K455).

## Covers

- `scripts/kit/composer-constraint.mts`

## Requirement

| Item | Requirement |
|---|---|
| C1 | `||` separates alternatives; within an alternative, terms separated by spaces or commas must all hold |
| C2 | a term is a version with `^`, `~`, `>=`, `>`, `<=`, `<`, `=`, `==` or `!=`, a bare version (exact), or a wildcard such as `8.4.*` or `*` |
| C3 | a form that kit does not read (a hyphen range, `@dev`, a stability flag) throws with its text, so the caller reports it instead of judging it |
| C4 | a version of the platform (`php`, `ext-*`) is judged against the constraint of the locked package |

## Tools evaluated

| Tool | State | Verdict |
|---|---|---|
| npm `semver` | 7.8.5 (the pin of package.json) | Reads `||`, `^`, `~`, the operators and x-ranges as Composer does, but returns `null` for a comma-separated AND term such as `>=1.0,<2.0`, which Composer uses in its own constraints. The comma form needs a rewrite before semver, which is the parser that C1 and C3 describe, so semver adds the package without taking the rule |
| `@renovatebot/pep440` | the pin of kit | Reads PEP 440 specifiers for Python, not Composer constraints |
| npm search for "composer constraint parser" (20 results) | 2026-10-21 | No result reads Composer's constraint grammar: the results are general parsers, and @snyk/composer-lockfile-parser reads composer.lock, not constraints |
| `composer/semver` (PHP) | the Composer library | Reads Composer's grammar exactly, but it runs only in PHP. `check-dependency-policy` runs in every repository, and a repository without PHP would need the PHP runtime for its dependency gate |

## Why none fits

The one library that reads Composer's grammar is PHP. Calling it means a PHP process inside the Node dependency gate of
every repository, which adds a runtime to repositories that have none. npm `semver` misreads the comma form, which C1 requires,
so using it would need a rewrite that is the same parser. kit keeps the parser: about 85 lines, tested in
`tests/kit/dependency-policy.test.mts`.

## Retry condition

Revisit when a Node package reads Composer's constraint grammar, comma-separated AND terms included, or when every repository
that runs `dependency-policy-check` has PHP installed.
