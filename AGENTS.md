<!-- doc-id: agents -->
# Development

[한국어](AGENTS.ko.md)

## Purpose

kit holds the tools that every polyspec repository shares: the release, dependency, push-gate, document and install
tools. A repository installs them as the package `@polyspec/kit` and holds byte-for-byte copies of the files that
`kit.copies` of its `package.json` lists, written by `make kit-sync`; a repository differs from another only in
`config/*.json`. kit depends on no repository.

kit also carries the working principles of every polyspec repository, [PRINCIPLES.md](PRINCIPLES.md) and its Korean twin,
and vendors them at the same paths, so every repository holds the same principles; each repository's AGENTS.md links to them
and states only its own rules. The rules below are kit's own.

## Rules

- English documents are canonical. Every document has a `.ko.md` file with the same information; edit both in the same
  change. The revision marker `source-sha256` of the Korean file is the sha256 of the English file. Korean documents write
  technical terms in English.
- A tool imports only Node built-ins (`node:`), files of `scripts/kit/` and the packages that `dependencies` of
  `package.json` declares, each pinned exactly, or an optional peer that `peerDependencies` declares and the repository that
  runs the tool installs, such as the `@vscode/test-electron` of `install-vscode.mts`. A module of `scripts/kit/bootstrap/` runs before npm installs the packages,
  so it imports only Node built-ins and files of its own directory. `tests/kit/isolation.test.mts` enforces both and fails on
  a declared package that no tool imports. No tool or test, except the fixture and `tests/kit/isolation.test.mts`, names
  another repository. A value that differs between repositories is data in
  `config/<name>.json` with a schema in `scripts/kit/schema/`, which ajv validates (draft 2020-12, strict mode, every error).
- A vendored file is changed in kit and copied with `make kit-sync KIT_TAG=<tag>`, never edited in a repository:
  `make kit-check` fails on a changed, missing or unexpected vendored file.
- The ecosystem principle of [PRINCIPLES.md](PRINCIPLES.md) applies to kit's tools: uv for Python interpreters,
  environments and locks, Composer for PHP dependencies, and their own behavior, such as the symbolic links that uv
  creates, is accepted; our rules govern what we create.
- This repository creates no symbolic link and no relative path: not in its tracked files, configuration, scripts or
  generated output. A path is resolved declaratively (named in a tracked file) or by discovery (a stated discovery rule).
  The links that an outside tool creates are its behavior, which the rule above accepts, not what this repository creates.
- A function or constant that two tools need lives in one module of `scripts/kit/` that both import.
  `make duplication-check` (jscpd) fails when a piece of 6 lines or more exists twice.
- Tests are in `tests/kit/`, run offline with stub commands and the fixture `tests/kit/fixture`, and each test fails when its
  behavior breaks. A defect is handled by a failing test that reproduces it, the fix, and keeping the test.
- A consumer that runs Python declares `pythonBuild` and `uv` in config/toolchain.json and installs its Python with `make install-tools`,
  which installs uv and then the Python with `uv python install`;
  a consumer that publishes a wheel also declares `pythonBackend`. A vendored test checks a consumer's declaration only against
  this rule. The kit's own tests of its real Python and wheel path are in `tests/source`: kit-sync does not vendor them, `make
  source-test` runs them, and CI runs them after `make kit-test`.
- kit's own checks run the Go of the kit pin, the uv and Python of config/toolchain.json, which `make install-tools` installs
  into var/tools, and the Rust of `rust-toolchain.toml`. rustup is the one tool that a machine or CI runner provides: it
  installs that channel (`rustup toolchain install`), and CI puts var/tools/bin first on PATH (`.github/workflows/ci.yml`).
- A repository with several implementations of one spec declares them in `config/parity.json` and runs
  `parity-declarations-check` among its check targets and `parity-check` in its CI, both before a push lands
  (docs/tool-inventory.md, Language parity).
- Every check gives the same result for the same tree. A tool writes through a temporary file and a rename, prints a line
  for each step, and has no time limit; a test case has its own timeout. A network query is made only by
  `dependency-review`, `kit-sync` and the install tools, and its result is a committed record.
- Do not keep backward compatibility: remove an old path instead of adding a compatibility layer, a fallback or a migration.
- Use the simplest implementation that fully meets the current requirements, with no abstraction, setting or indirection for
  an uncertain future.
- Build modular components, each concern clearly separated in its own module.
- Decide the architecture for the long term: a stopgap that works now and must be replaced later is not accepted.
- Write comments, documents and commit messages in direct language: name the action and its object.

## Checklist

`docs/plans/execution-checklist.md` is the only checklist. A task is `[ ]` waiting, `[~]` in progress, `[o]` done,
`[!] cause: <cause>; retry: <condition>` bypassed or `[-] cause: <cause>` impossible. A task becomes `[o]` in the commit
that completes it, after its owning command passes. A commit message is `type(scope): Subject (#task)`, with a subject of
at most 50 characters, a body wrapped at 72 characters, and the types `feat`, `fix`, `docs`, `style`, `refactor`, `test`,
`chore`.

## Release

kit is released by tag `vX.Y.Z` on a commit of `main` whose CI run concluded `ci` success. `package.json` holds the version of the
tree. A repository adopts a release by updating `@polyspec/kit` in its package-lock and running `make install-packages` and
`make kit-sync`.

A release tag is annotated: it is created with `git tag -a vX.Y.Z -m vX.Y.Z`. `release-verify` refuses a tag whose object
type (`git cat-file -t <tag>`) is not `tag`, with a line that names the tag and its kind (`commit` for a lightweight tag). A
published tag is not moved; the check runs only on the tag being released.

kit vendors the release workflow `workflows/release.yml` to `.github/workflows/release.yml` of every repository (`kit.copies` of
package.json). A repository never edits it, and `make kit-check` fails on a difference. The workflow sets up the PHP of `.php-version` when
the repository declares one, runs `make release-tools` (the tools that config/release.json needs), `make release-tools-path` (which
puts `var/tools/bin` on the PATH of the following steps, so they run on the installed tools), `make release-publish` (the release as a draft), `make release-proof TAG=<tag>` (the proof of the draft)
and `make release-undraft TAG=<tag>`, which makes the release public only after the proof passed. A failed step leaves the release a
draft and fails the run, so a release that cannot be installed is never public.

A package of kind `wheel` (a Python package with a `pyproject.toml`) is released as its PEP 427 wheel
`<distribution>-<version>-py3-none-any.whl`, the file name pip parses. `release-assets` builds it from the tagged commit with the
build backend that `buildBackend` of config/release.json pins by its exact requirement and by the sha256 of its wheel;
`make release-backend` downloads that wheel into `var/tools/wheels` with the digest checked, and no build reads the network. A
wheel's `Requires-Dist` is a plain `name==version`, a direct reference to the release asset of a polyspec package with the sha256
fragment, or a direct reference without a hash to a sibling (another wheel package of the same config/release.json) of the same
release. The first two are held by the lock of the wheel (`consumers.wheel.lock`); a sibling never is. Any other form (a URL, a git
source, a range or a marker) is refused, as an npm or Composer manifest with the same form is (docs/tool-inventory.md, Sibling wheels). `release-consumer` installs the lock with hashes, the
wheels of the release together with `--no-deps`, runs `pip check` and then the smoke command in a clean virtual environment. A Python package is not released as a git tag.
