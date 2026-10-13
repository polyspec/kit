<!-- doc-id: rebuild-check-commits -->
# Rebuild record: check-commits

[한국어](check-commits.ko.md)

Verdict: **none fits.** kit keeps `check-commits.mts`. Measured for K73 (scratchpad k73, VERDICTS section 6) on 2026-10-13.

## Covers

- `scripts/kit/check-commits.mts`

## Requirement

| Item | Requirement |
|---|---|
| M1 | the header is `type(scope): Subject (#id)` with a type of config/commits.json |
| M2 | the Subject starts with an ASCII capital, has no period before `(#id)` and at most `subjectMax` characters |
| M3 | a blank line, then a body whose lines have at most `bodyMax` characters, except a single long word |
| I1 | commit-items: a commit changes the checklist rows of the items it names |
| I2 | commit-changelog: a commit that finishes an item also changes the changelog and its translation |

## Tools evaluated

| Tool | State | Verdict |
|---|---|---|
| @commitlint/lint | 21.2.3 | M1 and part of M3 map onto `type-enum`, `subject-max-length`, `body-leading-blank` and a header pattern. With stock rules, 10 of 3886 messages differ: `subject-full-stop` reads the end of the header, so a period before `(#id)` passes; `subject-case` accepts a digit, a backtick or `Ä`; `body-max-line-length` exempts URLs only; trailing whitespace fails the header. The same result needs a local plugin that restates three rules, an adapter, and five packages. I1 and I2 read the trackers and the diff and are outside commitlint |

## Why none fits

commitlint matches kit only with a plugin that re-implements half of the message rules, and the item rules stay in kit in
every case, so kit would keep its rules and add five packages.

## Retry condition

Revisit when commitlint's stock rules express M2 and M3 (a period before a suffix, an ASCII capital, a long-word exception).
