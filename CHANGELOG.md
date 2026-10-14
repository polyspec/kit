<!-- doc-id: changelog -->
# Changelog

[한국어](CHANGELOG.ko.md)

## Unreleased

- mise.toml may declare cargo-nextest (`"github:nextest-rs/nextest" = { version, version_prefix = "cargo-nextest-" }`) and cargo-deny (`cargo-deny`, the aqua backend of the registry of mise): mise.lock pins their native binaries for every platform and make toolchain-check reads their `--version`; kit refused both before (K143).
- run-tests stops the whole process group of the tool, with SIGKILL after a 5 s grace period, at a test's timeout and when the runner itself is interrupted (SIGINT, SIGTERM, SIGHUP); an interrupted runner left the tool and the processes it started, such as the interpreter behind the mise shim, running as orphans (K141).
- `no-floating-promises` allows the top-level registrations of node:test (`test`, `describe`, `it`, `suite`) with the option `allowForKnownSafeCalls` of typescript-eslint, since the runner awaits them; a real floating promise in a test still fails. Run make kit-sync (K138).
- API Extractor no longer reports `ae-missing-release-tag`: polyspec tags no export with `@public` or `@beta` and writes no trimmed rollup, so `make lint-ts` failed every package on it; run make kit-sync (K139).
- parity reads the cases of a cargo binding whose test target runs libtest-mimic (`harness = false`), which pads each test name to the longest one before `...`; it read none of them (K136).
- A php suite binding names its test method as `symbol`, `<class>::<method>` of a fully qualified class: parity runs that method alone with `--filter`, and each data set `<method> with data set "<case>"` of its data provider is the case `<case>`. Before, a data set mapped to no case and every other test of the file was an undeclared case of the unit (K137).

### Consumer migration

Change:
- A php suite binding whose cases are the data sets of one test method declares `"symbol": "<Namespace>\\<Class>::<method>"`; a binding whose cases are test methods `test_<case>` stays as it is.

## 0.0.42

- The bootstrap writes `var/tools/go.mod`, so the Go of mise and its test sources under `var/tools` are a module of their own that `./...` of a repository whose root is a Go module does not walk (K135).
## 0.0.41

- mise.lock pins the archives of linux-arm64 and macos-x64 too, every platform on which the bootstrap installs mise; 0.0.39 and 0.0.40 failed make install-tools on ARM Linux runners (K134).
## 0.0.40

- kit-sync removes a file of `scripts/kit/` that the package no longer declares, such as `scripts/kit/bootstrap/bootstrap-npm.mts` after 0.0.39, and kit-check names one (K133).
- make toolchain-lock locks the tools of mise.toml with `mise lock --global`, since the environment of mise names that file as the global configuration; 0.0.39 wrote no lock in a repository without one (K127).
- The release workflow runs `make release-prepare` before `make release-tools`: a repository declares the preparation that its release needs with a `release-prepare::` rule of its Makefile (K132).

### Consumer migration

Add:
- A repository whose release needs a preparation, such as the checkout of a sibling release, declares it with `release-prepare::` in its Makefile instead of a step of the workflow.

## 0.0.39

- A shim of mise runs the tool that the checkout pins from any working directory: the environment of mise names the checkout's mise.toml as the global configuration (K127).
- The principle review of 0.0.38 (K129): a Go module with no stable release, an npm advisory range and a tracker of a revision are reported or fail by name instead of reading as empty; every npm workspace pattern is read; a module that go.work resolves needs no go.sum; the PHP lint is a tool only of a repository that declares PHP; the ts extractor gets its standard library; go.mod and go.work are indented with tabs; a failed case of a nested test run is reported with its whole error.
- The status tables, changelog sections, release notes, checklists and parity prose are read from the mdast tree (K130).
- `@polyspec/kit` exports the tool APIs that repositories import: `tracked-files`, `test-hooks`, `test-progress`, `run-tests`, `holder-lock`, and `install-vscode`, which needs its optional peer `@vscode/test-electron` (K79).
- The tools that kit installed with release installers of its own are installed by mise from `mise.toml` at the digests of `mise.lock` (K127): Go, Python, uv, ruff, alint, golangci-lint, deadcode, govulncheck, cargo-audit, Composer and vulture. The bootstrap installs mise after the npm of `packageManager`, by the sha256 of `config/toolchain.json` `mise`; `make toolchain-lock` writes `mise.lock`; `make install-tools` runs `mise install --locked` and then installs the wheel backend, the Composer projects and the Rust channels of `exceptions`. Every recipe of kit.mk runs with the environment of mise of the checkout and its shims first on PATH, and nothing outside the checkout changes.
- check-toolchain runs the tools of `mise.toml` from their shims, requires `mise.lock` to pin every archive by its sha256 for linux-x64 and macos-arm64 (a `go:` tool, govulncheck and deadcode, by the checksum database of Go), and compares the go and the python minor of `mise.toml` with the pins of kit (K127).

### Consumer migration

First adoption: `scripts/kit/kit-bootstrap.mk` is itself a copy, so `make` fails until it exists. After `npm install` adds the pinned `@polyspec/kit`, run `node node_modules/@polyspec/kit/dist/kit-sync.mjs` once in the root of the repository; it writes every copy, the Makefile's include among them. From then on use `make kit-sync`.

Add:
- `advisoryExceptions` in `config/dependency-policy.json` for the advisory 1241202 of sprintf-js, which `@polyspec/kit` brings through `@microsoft/api-extractor` and which no release fixes, with the reason and removal condition that kit declares for itself.
- `config/toolchain.json` `mise`: the version and the sha256 of the archive of each platform, as kit declares them; `make install-tools TOOLS=npm` installs it.
- `mise.toml` with the tools that the repository installs, each at an exact release and Go and Python at the pins of kit; then `mise.lock` and, for a `pypi:` tool, `.mise/locks/`, written by `make toolchain-lock`. Declare the `checksum` of an `http:` tool, such as Composer, in `mise.toml`.
- `mise.toml`, `mise.lock` and `.mise` to the root of `config/layout.yml` where it overrides the root lists.

Change:
- CI steps that run make need no PATH of their own: kit.mk puts `var/tools/bin` and the shims first; `make release-tools-path` also writes the environment of mise to `GITHUB_ENV`.

Delete:
- From `config/toolchain.json`: `python`, `pythonBuild`, `uv`, `ruff`, `vulture`, `alint`, `golangciLint`, `deadcode`, `composer`, `cargoAudit`, `govulncheck` and `go`; `.python-version`.
- Tool names after `make install-tools`: it installs every tool of `mise.lock`.

Proof: `make install-tools TOOLS=npm`, `make install-packages`, `make toolchain-lock`, `make install-tools`, then `make toolchain-check` pass.

## 0.0.38

- kit is the npm package `@polyspec/kit`: a repository installs it with `make install-tools TOOLS=npm` and `make install-packages`, includes `scripts/kit/kit-bootstrap.mk`, and holds as copies only the files of `kit.copies`; `make kit-sync` writes them from the installed package and `make kit-check` ties them to the version of package-lock.json (K71-2).
- kit's tools and tests are TypeScript (`.mts`), checked by tsc 7.0.2 (K71-1); `make kit-test` fails when a run changes the checkout (K71-2-1).
- kit's tools use ecosystem libraries in place of rebuilds: ajv for schemas, picomatch for globs, smol-toml for TOML, pip-requirements-js for PEP 508, semver and @renovatebot/pep440 for versions; Composer versions come from composer's own `latest-status`; npm install-links copies are no longer read (K73, K100, K112–K116).
- Every kit tool is classified in `config/rebuild.json`, and the tools kit keeps carry a rebuild record in `docs/rebuild/` (K74).
- parity: feature units on runner test ids, fixed per-runner test conventions, files named like tests must be bound, spec anchors for profile reasons, a vitest runner, symbol extraction (Go, TypeScript, PHP, Python, Rust on a declared nightly), case directories and `.~` steps, Markdown lists and prose names (K75, K42, K43).
- Lint configuration for every ecosystem (phpcs PSR-12, phpstan disallowed calls, Composer policy, Rust workspace lints, golangci-lint with gomoddirectives, deadcode, ruff with TID251, vulture, oxlint with tsgolint, knip, API Extractor, `.editorconfig`); an advisory without a fixed release is accepted only by a recorded exception with its reason and removal condition (K77).
- check-toolchain checks the pins kit ships, floors equal to the pins, declared exceptions with scope, reason and retry, the TypeScript pin and `.npmrc` link keys, and names the signal that ended a tool (K78, K118).
- The editor boundary checker and the VS Code installer of the integration tests (K80).
- Markdown is read with mdast and micromark, owner-check reads make's database, pyproject pins are edited with toml-patch, wheel metadata comes from pip's report, govulncheck is read as SARIF, duplication is found by jscpd, and the unused TAP reader is removed (K120–K126).
- release coverage refuses a `file:` dependency that names no folder of the repository; only the npm release consumer project names the archives of its smoke (K129).
- Node 26.11.1.

### Consumer migration

Add:
- `@polyspec/kit` as a devDependency pinned to this release's asset URL with its integrity, in package.json and package-lock.json.
- `include scripts/kit/kit-bootstrap.mk` in the Makefile, in place of `include scripts/kit/kit.mk`.
- The copies that `make kit-sync` writes: `scripts/kit/kit-bootstrap.mk`, `scripts/kit/bootstrap/`, `workflows/release.yml`, `PRINCIPLES.md(.ko)`, `config/layout.kit.yml`, `ruff.toml`, `phpcs.xml.dist`, `phpstan.dist.neon`, `.golangci.yml`, `.oxlintrc.json`, `knip.json`, `config/api-extractor.kit.json`, `.editorconfig`.
- `config/checklist.json` for the repository's checklist, where missing; `rust-toolchain.toml` at the Rust pin, where the repository has Rust.

Change:
- `.node-version` 26.11.1 and `engines.node` `>=26.11.1`; Composer `require.php` `>=8.5` and `config.platform.php` `8.5`; `requires-python` `>=3.14`; go.mod `go 1.27.2` with no toolchain line; Cargo `rust-version` `1.99.0`; `typescript` `7.0.2`, with any other version declared as an exception.
- `config/parity.json`: `symbols` is `{ extractor, entry }`; narrow profiles and `nativeOnly` entries carry `spec` anchors; `config/toolchain.json` names `symbolExtractors` where Go or PHP symbols are extracted.

Delete:
- The vendored `scripts/kit/*`, `tests/kit/*`, `.kit/kit.lock.json` and every `kit.json` reference.
- The `.npmrc` keys `install-links` and `bin-links`; `replace` in go.mod (siblings use go.work); nested ruff configurations.

Proof: `make install-tools TOOLS=npm`, `make install-packages`, then `make kit-check toolchain-check layout-check documents-check owner-validate` pass; the checks that still fail are recorded in the repository's checklist.
