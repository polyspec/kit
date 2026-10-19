<!-- doc-id: agents -->
# Development

[한국어](AGENTS.ko.md)

## Purpose

kit holds the tools that every polyspec repository shares: the release, dependency, push-gate, document and install
tools. A repository installs them as the package `@polyspec/kit` and holds byte-for-byte copies of the files that
`kit.copies` of its `package.json` lists, written by `make kit-sync`; a repository differs from another only in
`config/*.json`. kit depends on no repository. kit also carries the working principles of every polyspec repository, [PRINCIPLES.md](PRINCIPLES.md) and its Korean twin,
and vendors them at the same paths, so every repository holds the same principles; each repository's AGENTS.md links to them
and states only its own rules. The rules below are kit's own.

## Rules

- English documents are canonical. Every document has a `.ko.md` file with the same information; edit both in the same
  change. The revision marker `source-sha256` of the Korean file is the sha256 of the English file. Korean documents write
  technical terms in English.
  Enforced by: `make documents-check`
- A tool imports only Node built-ins (`node:`), files of `scripts/kit/` and the packages that `dependencies` of
  `package.json` declares, each pinned exactly, or an optional peer that `peerDependencies` declares and the repository that
  runs the tool installs, such as the `@vscode/test-electron` of `install-vscode.mts`. A module of `scripts/kit/bootstrap/` runs before npm installs the packages,
  so it imports only Node built-ins and files of its own directory. `tests/kit/isolation.test.mts` enforces both and fails on
  a declared package that no tool uses: imports, runs a command of (the lint tools of `lint-ts.mts`), or needs as a peer of
  such a package. No tool or test, except the fixture and `tests/kit/isolation.test.mts`, names
  another repository. A value that differs between repositories is data in
  `config/<name>.json` with a schema in `scripts/kit/schema/`, which ajv validates (draft 2020-12, strict mode, every error).
  Enforced by: `tests/kit/isolation.test.mts`
- A vendored file is changed in kit and copied with `make kit-sync`, which writes the copies of the version that
  package-lock.json resolves, never edited in a repository: `make kit-check` fails on a changed or missing vendored file, and
  on a file of `scripts/kit/` that is no copy, since that directory holds the copies of kit only; `make kit-sync` removes it.
  Enforced by: `make kit-check`, `.claude/settings.json`
- The ecosystem principle of [PRINCIPLES.md](PRINCIPLES.md) applies to kit's tools: uv for Python interpreters,
  environments and locks, Composer for PHP dependencies, and their own behavior, such as the symbolic links that uv
  creates, is accepted; our rules govern what we create.
  Enforced by: `make rebuild-check`
- This repository creates no symbolic link: not in its tracked files, configuration, scripts or generated output. The one
  exception is the local link of 0.0.x development (`docs/operations/local-links.md`): when a polyspec root is declared, a
  development checkout's installed polyspec package folder pinned at 0.0.x is replaced by a link to its provider's source;
  such a link is never tracked and never part of released output. A path
  that this repository writes is relative to a stated anchor (the repository root, or the anchor its format defines, such
  as PEP 751's lock directory), stays inside the repository, and never depends on the working directory; it is never
  absolute. The repository root is the top level of the Git work tree that holds the working directory (`git rev-parse
  --show-toplevel`, `repositoryRoot` of `scripts/kit/paths.mts`), so a tool started below it, as `npm -w` starts it in a
  package directory, reads and writes the paths of the repository; outside a work tree a tool that needs the root fails. A path is resolved declaratively (named in a tracked file) or by discovery (a stated discovery rule).
  The links that an outside tool creates are its behavior, which the rule above accepts, not what this repository creates.
  A test creates a link only when the link is its subject (a path named through a link, an archive that holds a link); a
  test runs the tools of this checkout in its sandbox (`tests/kit/kit-tools.mts`) instead of linking them there.
  Enforced by: `make kit-check`
- A function or constant that two tools need lives in one module of `scripts/kit/` that both import.
  `make duplication-check` (jscpd) fails when a piece of 6 lines or more exists twice.
  Enforced by: `make duplication-check`
- Tests are in `tests/kit/`, run offline with stub commands and the fixture `tests/kit/fixture`, and each test fails
  when its
  behavior breaks. A defect is handled by a failing test that reproduces it, the fix, and keeping the test.
  A stub never runs a command that a stub or a mise shim provides (go, composer, npm, node, php, python, uv, mise), since a
  shim outside its checkout runs the next command of PATH; the archivers of the machine are allowed (`tests/kit/stubs.test.mts`).
  Enforced by: `tests/kit/stubs.test.mts`
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
  Enforced by: `make toolchain-check`
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
  Enforced by: `make toolchain-check`, `make kit-check`
- A repository with several implementations of one spec declares them in `config/parity.json` and runs
  `parity-declarations-check` among its check targets and `parity-check` in its CI, both before a push lands
  (docs/operations/tool-inventory.md, Language parity).
  Enforced by: `make parity-declarations-check`
- Every check gives the same result for the same tree. A tool writes through a temporary file and a rename, prints a line
  for each step, and has no time limit; a test case has its own timeout. A network query is made only by
  the targets that kit.mk marks ONLINE (`dependency-review`, `python-lock`, `install-tools`, `release-tools`,
  `release-backend`, `release-consumer-lock`, `release-proof`, `cargo-downloads-fetch` and `release-assets-fetch`), and its
  result is a committed record, an installation in var/tools or an archive under var/ that config/release-assets.json pins.
  Enforced by: `make kit-test`
- A dependency advisory is fixed by an update. One that no release fixes is accepted only by an entry of
  `advisoryExceptions`
  in `config/dependency-policy.json` with its reason and removal condition, which the review and the gate print as accepted;
  it is never hidden. kit reviews its own `package-lock.json` (docs/operations/tool-inventory.md, Accepted advisories).
  Enforced by: `make dependency-policy-check`
- Do not keep backward compatibility: remove an old path instead of adding a compatibility layer, a fallback or a migration.
  Enforced by: none, a design judgement, which PRINCIPLES.md states; K243 removes this copy.
- Use the simplest implementation that fully meets the current requirements, with no abstraction, setting or indirection for
  an uncertain future.
  Enforced by: `make lint-ts`
- Build modular components, each concern clearly separated in its own module.
  Enforced by: `make duplication-check`
- Decide the architecture for the long term: a stopgap that works now and must be replaced later is not accepted.
  Enforced by: none, a design judgement, which PRINCIPLES.md states; K243 removes this copy.
- Write comments, documents and commit messages in direct language: name the action and its object.
  Enforced by: none, direct wording is a judgement of review.

## Generated files

- Generated files are never tracked in Git. This covers dependency installs (`node_modules/`, `vendor/`, virtual
  environments), build output (`dist/`, `target/`, `*.tsbuildinfo`), caches (`.cache/`, `__pycache__/`,
  `.pytest_cache/`), test run artifacts (`test-results/`, `playwright-report/`, PHPUnit caches) and tool downloads
  (`var/`). The only exceptions are files the repository deliberately needs, and only these are tracked: lock files
  (`package-lock.json`, `composer.lock`, `Cargo.lock`, uv locks, `mise.lock`), committed generated documents that this
  file names, and test fixtures. Each `.gitignore` covers these paths; a new generator adds its ignore entry in the same
  commit.
  Enforced by: `.githooks/pre-commit`

## Release

kit is released by the annotated tag `vX.Y.Z` of a commit of `main`; the procedure is
[docs/operations/release.md](docs/operations/release.md).

- A release tag is annotated, lies on a commit of `main` whose CI concluded success and that carries the consumer locks and
  the review of its lock, and a published tag is never moved.
  Enforced by: `make release-verify`, `make dependency-policy-check`
- A release is public only after its proof installs it from a consumer project; a failed step leaves it a draft.
  Enforced by: `make release-proof`, `make release-undraft`
- Every repository releases through the vendored `workflows/release.yml`, which it never edits.
  Enforced by: `make kit-check`
