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
  a declared package that no tool uses: imports, runs a command of (the lint tools of `lint-ts.mts`), or needs as a peer of
  such a package. No tool or test, except the fixture and `tests/kit/isolation.test.mts`, names
  another repository. A value that differs between repositories is data in
  `config/<name>.json` with a schema in `scripts/kit/schema/`, which ajv validates (draft 2020-12, strict mode, every error).
- A vendored file is changed in kit and copied with `make kit-sync`, which writes the copies of the version that
  package-lock.json resolves, never edited in a repository: `make kit-check` fails on a changed or missing vendored file, and
  on a file of `scripts/kit/` that is no copy, since that directory holds the copies of kit only; `make kit-sync` removes it.
- The ecosystem principle of [PRINCIPLES.md](PRINCIPLES.md) applies to kit's tools: uv for Python interpreters,
  environments and locks, Composer for PHP dependencies, and their own behavior, such as the symbolic links that uv
  creates, is accepted; our rules govern what we create.
- This repository creates no symbolic link: not in its tracked files, configuration, scripts or generated output. A path
  that this repository writes is relative to a stated anchor (the repository root, or the anchor its format defines, such
  as PEP 751's lock directory), stays inside the repository, and never depends on the working directory; it is never
  absolute. The repository root is the top level of the Git work tree that holds the working directory (`git rev-parse
  --show-toplevel`, `repositoryRoot` of `scripts/kit/paths.mts`), so a tool started below it, as `npm -w` starts it in a
  package directory, reads and writes the paths of the repository; outside a work tree a tool that needs the root fails. A path is resolved declaratively (named in a tracked file) or by discovery (a stated discovery rule).
  The links that an outside tool creates are its behavior, which the rule above accepts, not what this repository creates.
  A test creates a link only when the link is its subject (a path named through a link, an archive that holds a link); a
  test runs the tools of this checkout in its sandbox (`tests/kit/kit-tools.mts`) instead of linking them there.
- A function or constant that two tools need lives in one module of `scripts/kit/` that both import.
  `make duplication-check` (jscpd) fails when a piece of 6 lines or more exists twice.
- Tests are in `tests/kit/`, run offline with stub commands and the fixture `tests/kit/fixture`, and each test fails when its
  behavior breaks. A defect is handled by a failing test that reproduces it, the fix, and keeping the test.
  A stub never runs a command that a stub or a mise shim provides (go, composer, npm, node, php, python, uv, mise), since a
  shim outside its checkout runs the next command of PATH; the archivers of the machine are allowed (`tests/kit/stubs.test.mts`).
- A repository declares the tools that it installs in `mise.toml` (Go, Python, uv, ruff, alint, golangci-lint, deadcode,
  govulncheck, cargo-audit, cargo-nextest, cargo-deny, Composer, vulture), writes their digests into `mise.lock` with
  `make toolchain-lock` and installs them with `make install-tools`, which runs `mise install --locked` with the mise of the bootstrap. The uv lock of a `pypi:` tool is the sidecar folder
  `.mise/locks/<tool>/<version>` that mise.lock names: kit-written lock data, tracked with mise.lock as mise's documentation
  says, which `make toolchain-check` fails when Git does not track it (K192). A consumer that publishes a
  wheel also declares `pythonBackend` in config/toolchain.json. A vendored test checks a consumer's declaration only against
  this rule. The vendored dependency tests read go and Composer through stubs that answer from records of the real tools,
  never by running them. The kit's own tests of its real tools are in `tests/source`: kit-sync does not vendor
  them, a source test that runs a pinned tool needs `make install-tools` first, `make source-test` runs them, and CI runs
  them after `make kit-test`.
- kit's own checks run the tools of its `mise.toml` at the pins of kit, which `make install-tools` installs into
  var/tools/mise, and the Rust of `rust-toolchain.toml`; the Node.js of `mise.toml` is installed by the bootstrap
  (`make install-tools TOOLS=npm`) before npm (K171). Every recipe of kit.mk runs with the environment of mise of the
  checkout and with var/tools/bin and the shims of mise first on PATH, and starts a tool of the checkout by its absolute
  path (`$(NODE)`, `$(NPM)`, `$(ALINT)`), never by its bare name: make 3.81 looks up a recipe line without shell syntax on
  the PATH that make started with; `make kit-check` fails a recipe that does. A machine or CI runner provides the two toolchains
  that mise does not install. `make install-tools` installs, with rustup, the toolchain of `rust-toolchain.toml` with its
  components (`rustup toolchain install` in the checkout, which reads the file; rustup 1.28 no longer installs it as cargo
  first runs) and each Rust channel that config/toolchain.json `exceptions` declares; a missing rustup fails with its
  install, and `make toolchain-check` names a toolchain that is not installed. PHP is the
  release of `.php-version` (in CI, the setup-php step before install-tools), which `make toolchain-check` verifies.
- A repository with several implementations of one spec declares them in `config/parity.json` and runs
  `parity-declarations-check` among its check targets and `parity-check` in its CI, both before a push lands
  (docs/tool-inventory.md, Language parity).
- Every check gives the same result for the same tree. A tool writes through a temporary file and a rename, prints a line
  for each step, and has no time limit; a test case has its own timeout. A network query is made only by
  the targets that kit.mk marks ONLINE (`dependency-review`, `python-lock`, `install-tools`, `release-tools`,
  `release-backend`, `release-consumer-lock`, `release-proof`, `cargo-downloads-fetch` and `release-assets-fetch`), and its
  result is a committed record, an installation in var/tools or an archive under var/ that config/release-assets.json pins.
- A dependency advisory is fixed by an update. One that no release fixes is accepted only by an entry of `advisoryExceptions`
  in `config/dependency-policy.json` with its reason and removal condition, which the review and the gate print as accepted;
  it is never hidden. kit reviews its own `package-lock.json` (docs/tool-inventory.md, Accepted advisories).
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

A release is cut in three steps. (1) A commit `chore(release): Release X.Y.Z` sets the version in `package.json` and
`package-lock.json` and turns the Unreleased section of `CHANGELOG.md(.ko)` into `## X.Y.Z`. The release commit also carries
the consumer locks: `make release-assets TAG=vX.Y.Z`, then `make release-consumer-lock TAG=vX.Y.Z` (ONLINE), and the manifests
and locks that it writes in `tests/release-consumer/*/` are committed with the version change, or in a following commit before
the tag (docs/tool-inventory.md, Consumer install of the release archives, steps 1 and 2). The version change rewrites
`package-lock.json`, so the release commit also carries `config/dependency-review.json` that `make dependency-review RECORD=1`
(ONLINE) writes for it; CI runs `make dependency-policy-check`, which fails a lock that differs from the review (K169). A version
change of a composer.json likewise re-locks it with `composer update --lock` in its directory, since the content-hash of
`composer.lock` covers `version`; the check fails the lock that the change outdated (`composerLock`, K180, K181). The proof of the draft installs the
archives from those locks, so a tag without them fails. The commit lands on `main` and its CI concludes success; the tag goes
only on a commit whose CI concluded success and that holds those locks. (2) The annotated tag `vX.Y.Z` of that commit is pushed. (3) The push runs `.github/workflows/release.yml`,
which is the vendored `workflows/release.yml` itself: it builds the npm archive of `@polyspec/kit` that `config/release.json`
declares, publishes it on the GitHub Release as a draft, proves it from a consumer project and makes it public. A repository
pins that asset's URL with its integrity.

A release tag is annotated: it is created with `git tag -a vX.Y.Z -m vX.Y.Z`. `release-verify` refuses a tag whose object
type (`git cat-file -t <tag>`) is not `tag`, with a line that names the tag and its kind (`commit` for a lightweight tag). A
published tag is not moved; the check runs only on the tag being released.

kit vendors the release workflow `workflows/release.yml` to `.github/workflows/release.yml` of every repository (`kit.copies` of
package.json). A repository never edits it, and `make kit-check` fails on a difference. The workflow sets up the PHP of `.php-version` when
the repository declares one, runs `make release-prepare` (the preparation that the repository's release declares with a
`release-prepare::` rule of its Makefile, none by default), `make release-tools` (the tools that config/release.json needs), `make release-tools-path` (which
puts `var/tools/bin` and the shims of mise on the PATH of the following steps and the environment of mise in theirs, so they run on the installed tools), `make release-publish` (the release as a draft, whose id it records in `var/release/<tag>.json`), `make release-proof TAG=<tag>` (the proof of the draft)
and `make release-undraft TAG=<tag>`, which makes the release public only after the proof passed. The proof and undraft read the
draft by that id, never by its tag in the list of releases, which shows a new draft only after a while. A failed step leaves the release a
draft and fails the run, so a release that cannot be installed is never public.

A package of kind `wheel` (a Python package with a `pyproject.toml`) is released as its PEP 427 wheel
`<distribution>-<version>-py3-none-any.whl`, the file name pip parses. `release-assets` builds it from the tagged commit with the
build backend that `pythonBackend` of config/toolchain.json, its one declaration, pins by its exact requirement and by the
sha256 of its wheel; `make install-tools` and `make release-backend` download that wheel into `var/tools/wheels` with the digest checked, and no build reads the network. A
wheel's `Requires-Dist` is a plain `name==version`, a direct reference to the release asset of a polyspec package with the sha256
fragment, or a direct reference without a hash to a sibling (another wheel package of the same config/release.json) of the same
release. The first two are held by the lock of the wheel (`consumers.wheel.lock`); a sibling never is. Any other form (a URL, a git
source, a range or a marker) is refused, as an npm or Composer manifest with the same form is (docs/tool-inventory.md, Sibling wheels). `release-consumer` installs the lock with hashes, the
wheels of the release together with `--no-deps`, runs `pip check` and then the smoke command in a clean virtual environment. A Python package is not released as a git tag.
