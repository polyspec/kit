<!-- doc-id: agents -->
# Development

[한국어](AGENTS.ko.md)

## Purpose

kit holds the tools that every polyspec repository shares: the release, dependency, push-gate, document and install
tools. A repository holds a byte-for-byte copy of `scripts/kit/` and `tests/kit/` (listed in `kit.json`), written by
`make kit-sync`; a repository differs from another only in `config/*.json`. kit depends on no repository.

## Rules

- English documents are canonical. Every document has a `.ko.md` file with the same information; edit both in the same
  change. The revision marker `source-sha256` of the Korean file is the sha256 of the English file. Korean documents write
  technical terms in English.
- A tool imports only Node built-ins (`node:`) and files of its own directory. No tool or test, except the fixture and
  `tests/kit/isolation.test.mjs`, names another repository. A value that differs between repositories is data in
  `config/<name>.json` with a schema in `scripts/kit/schema/`. The schema validator supports only the keywords it lists.
- A vendored file is changed in kit and copied with `make kit-sync KIT_TAG=<tag>`, never edited in a repository:
  `make kit-check` fails on a changed, missing or unexpected vendored file.
- Tests are in `tests/kit/`, run offline with stub commands and the fixture `tests/kit/fixture`, and each test fails when its
  behavior breaks. A defect is handled by a failing test that reproduces it, the fix, and keeping the test.
- Every check gives the same result for the same tree. A tool writes through a temporary file and a rename, prints a line
  for each step, and has no time limit; a test case has its own timeout. A network query is made only by
  `dependency-review`, `kit-sync` and the install tools, and its result is a committed record.
- Do not keep backward compatibility. Use the simplest implementation that meets the current requirement. Write comments,
  documents and commit messages in direct language: name the action and its object.

## Checklist

`docs/plans/execution-checklist.md` is the only checklist. A task is `[ ]` waiting, `[~]` in progress, `[o]` done or
`[!] cause: <cause>; retry: <condition>` bypassed. A task becomes `[o]` in the commit that completes it, after its owning
command passes. A commit message is `type(scope): Subject (#task)`, with a subject of at most 50 characters, a body wrapped
at 72 characters, and the types `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`.

## Release

kit is released by tag `vX.Y.Z` on a commit of `main` whose CI run concluded `ci` success. `kit.json` holds the version of the
tree. A repository adopts a release with `make kit-sync KIT_TAG=vX.Y.Z`.
