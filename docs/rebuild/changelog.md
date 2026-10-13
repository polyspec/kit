<!-- doc-id: rebuild-changelog -->
# Rebuild record: changelog

[한국어](changelog.ko.md)

Verdict: **none fits.** kit keeps its own check of the changelog. Measured on 2026-10-13.

## Covers

- `scripts/kit/changelog.mts`

## Requirement

The changelogs of polyspec are written by hand, in English and Korean, one entry per checklist item (`commit-changelog` of
check-commits requires the entry in the commit that finishes the item).

| Item | Requirement |
|---|---|
| C1 | `## Unreleased` is the first section and appears once |
| C2 | the released sections are `## X.Y.Z`, without brackets or dates, the newest first, each once |
| C3 | the English and the Korean file have the same sections in the same order |
| C4 | the file carries the document markers of check-documents (`doc-id`, `source-sha256`) |

## Tools evaluated

| Tool | State | Verdict |
|---|---|---|
| keep-a-changelog (npm) | 3.2.0, 2026-09-07 | parses the Keep a Changelog format only: it refused the changelogs of hyper and orm ("Syntax error in the release title" at `## 0.0.13`) and of crudui (the `doc-id` marker); C1–C4 are not its rules |
| git-cliff | 2.14.2 | generates a changelog from conventional commits; it does not check a written one, and polyspec's entries are written per item |
| release-please | 17.11.2 | generates the changelog and the version in a release pull request; polyspec releases from a tag of main without pull requests |

## Why none fits

The tools either generate a changelog from commits or read the Keep a Changelog format with bracketed versions and dates.
polyspec writes its changelog by hand per item and in two languages; the rules C1–C4 belong to that convention. The check is
53 lines on top of the Markdown reading of check-documents.

## Retry condition

Revisit when polyspec adopts the Keep a Changelog format (`## [X.Y.Z] - date`), which keep-a-changelog then reads, or
generates its changelog from commits.
