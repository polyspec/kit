<!-- doc-id: changelog -->
# Changelog

[한국어](CHANGELOG.ko.md)

## Unreleased

- The copied `.oxlintrc.json` forbids the escape hatches from the types of TypeScript as errors: `typescript/ban-ts-comment` forbids `@ts-ignore` and `@ts-nocheck` and requires a description after `@ts-expect-error` (`// @ts-expect-error: <why>`), and `typescript/no-explicit-any` and `typescript/no-unnecessary-type-assertion` fail an explicit `any` and a type assertion that changes nothing. A repository had silenced tsc with `@ts-expect-error` on code that type-checks and with casts. `readJson` of the copy `scripts/kit/bootstrap/files.mts` returns `unknown` instead of `any` (K155).
- In a consumer, `make lint-ts` leaves the copies of kit out of oxlint: one `--ignore-pattern` for each file of `kit.copies` of the installed package, the record that make kit-sync writes and make kit-check compares byte for byte. kit lints its copies with its own tsconfig and the types of node; in a consumer oxlint-tsgolint checked them outside the project, where every `node:*` import is `any`. An installed kit that is not the version of package-lock.json fails make lint-ts with the finding of make kit-check. The copies `scripts/kit/bootstrap/files.mts` and `digest.mts` take bytes as `NodeJS.ArrayBufferView` again, which K150 had narrowed only for that lint (K157).
- `make dependency-policy-mutation-check` fails with one finding when a `go.work` uses a module whose go.mod Git does not track, such as an ignored clone of a sibling repository: it names go.work and the `use` path and states that a committed go.work may only use tracked modules. The copy of the check holds the tracked files only, so it had thrown ENOENT with a stack while reading that go.mod (K160).
- `config/knip-entries.json` declares a dependency of the root that no JavaScript imports and only make runs, such as the template compiler that hyper installs by its URL for its recipes, in `ignoreDependencies` (`{ "<package>": "<reason>" }`), and make lint-ts adds it after the `ignoreDependencies` of knip.json in `var/lint-ts/knip.json`: knip does not read a Makefile, so it reported the dependency unused (K159).
- The copied `.oxlintrc.json` turns `oxc/number-arg-out-of-range` off: it allows 0 to 20 fraction digits for `toFixed` and `toExponential` and a precision of 1 to 21, the limits before ES2018, which raised them to 100 (ECMA-262 `Number.prototype.toExponential`), so it failed valid code such as `toExponential(25)`. oxlint 1.88.0, the latest release, and oxc main keep the old limits, and no oxc issue reports it (K161).
- Every JSON that a tool of kit reads, a file or the output of a command, is validated against a schema file of `scripts/kit/schema` (JSON Schema 2020-12, the strict Ajv2020 of `schema-validate.mts`) and typed by ajv's type guard, never cast: `readConfig<T>(root, file, schema)`, `readJsonFile<T>` and `parseJson<T>(text, schema, source)` return T or throw a `SchemaError` that names the file or the command and the JSON Pointer of each error of ajv, and `readConfigFindings<T>` gives a check those lines as findings. `readConfig` now throws instead of returning `{ value, errors }`, and its caller names T. New schemas describe the parts of package.json, package-lock.json, composer.json, composer.lock, knip.json and of the output of gh, npm, composer, go, cargo, pip, vitest and rustdoc that kit reads, and the records that kit writes itself. A manifest of a repository that breaks them, such as `workspaces` that is not a list, now fails with the file and the JSON Pointer. The bootstrap, which runs before ajv is installed, reads a JSON object with `readJsonObject` of the copy `scripts/kit/bootstrap/files.mts` and checks each field. `scripts/kit/kit-check.mts` is the example caller (K158).
- `make lint-php` runs PHPStan on a Composer package with the autoloader that Composer gives its files: the `vendor/autoload.php` of the package, or of the nearest Composer project above it, such as the root development composer.json of a Composer monorepo that requires its libraries through path repositories; `COMPOSER_VENDOR_DIR` names another vendor directory, as for the PHPUnit of run-tests, and both resolve it with `scripts/kit/composer-vendor.mts`. It required `<package>/vendor/autoload.php`, which a library of such a monorepo, with no lock and no vendor/ of its own, never has. A package with PHP files and no autoloader in it or above it still fails, now naming the project that may install it (K163).
- `config/knip-entries.json` declares in `ignore` (`{ "<glob>": "<reason>" }`) the files that are unused by design, such as a sample source file that a site shows and nothing runs or imports, each glob relative to the root with its reason, and make lint-ts adds them after the `ignore` of knip.json in `var/lint-ts/knip.json`, knip's documented option for such files. An undeclared unused file still fails (K162).
- The copied `.golangci.yml` turns staticcheck `ST1005` ("error strings should not be capitalized") off: a polyspec error string is a cross-port message of the repository's spec, which every port returns byte for byte, so it keeps the spec's capitalization. The other checks are the default of golangci-lint 2. It also sets `issues.max-same-issues` and `issues.max-issues-per-linter` to 0, so every finding is reported: the default caps of 3 issues of the same text and 50 of one linter hid 118 of 121 findings in a repository (K164).
- `run-tests phpunit` takes `--php-extension` more than once and loads each extension with its own `-d extension=<path>`, PHP's own way, in the given order, so an extension loads after one that it depends on; each is checked as built before the tool starts. A repository can load two extensions, one depending on the other, in one PHPUnit run (K165).
- The copied `.oxlintrc.json` fails every unsafe flow of `any` as an error: `typescript/no-unsafe-argument`, `no-unsafe-assignment`, `no-unsafe-call`, `no-unsafe-member-access` and `no-unsafe-return` fail an any value as an argument, an assignment, a callee, the object of a member access or a return value, and `typescript/no-unsafe-type-assertion` fails a type assertion that narrows a type. kit reads its JSON through its schemas (K158), narrows an unknown value by a check, reads a value that it knows to be there with `present` of `scripts/kit/present.mts` and an errno code with `errorCode` of `process.mts` (K157).
- `make python-lock` runs the uv shim with the mise environment of the checkout, as `make python-venv` does, so `node scripts/kit/python-lock.mts` outside make no longer fails with `Config files in <checkout>/mise.toml are not trusted`; the real tests of the Python tools give their own calls of a shim the same environment (K157).
- The build backend of the Python wheels has one declaration, `pythonBackend` of `config/toolchain.json`, which is a tool pin: install-tools installs it, and `make release-backend`, `release-assets` and the wheel build read it there. `buildBackend` of `config/release.json` is gone from its schema. A repository that declared only `buildBackend` had no backend installed by install-tools, so its release failed in release-assets (`setuptools-84.0.0 wheel is missing`). A `config/release.json` with a `wheel` package or the wheel consumer and no `pythonBackend` now fails `make kit-check` and the release with the fix (K166).

### Consumer migration

Run:
- `make kit-sync`, which writes `.oxlintrc.json` and the copies of `scripts/kit/bootstrap` (K155, K157, K161, K166).
- `make kit-sync`, which writes `.golangci.yml`, then `make lint-go`: it now reports every finding that the caps had hidden, each fixed in the code (K164).

Add:
- `ignoreDependencies` in `config/knip-entries.json` for each root dependency that only make runs, such as `@polyspec/template-compiler` (hyper), with its reason (K159).
- `ignore` in `config/knip-entries.json` for each file that knip reports unused by design, such as a sample that a site shows, with its reason (K162).

Fix:
- Each new finding of `make lint-ts` in the code, never with a disable: a `@ts-ignore` or `@ts-nocheck` and a cast or `any` that silences tsc go, and the code is typed so that tsc passes; a `@ts-expect-error` that a test needs states the error it expects (K155).
- A `go.work` that `make dependency-policy-mutation-check` reports: commit the go.mod of the module that it uses, or remove the `use`; a local clone of a sibling repository goes into an uncommitted go.work or `GOWORK` (K160).
- Each manifest or configuration that a tool now refuses with a JSON Pointer of its schema, such as a package.json whose `workspaces` is an object or a composer.json whose `repositories` is an object: write it in the form of the schema (K158).
- A library of a Composer monorepo that held a lock or a vendor/ of its own only for `make lint-php`: drop them and run `composer install` in the root development project, whose vendor/ now serves the lint (K163).
- Each new finding of `make lint-ts` of the `no-unsafe-*` rules in the code, never with a disable or a cast: read JSON through a schema or narrow the unknown value of `JSON.parse` by a check, and catch an error as unknown and check it with `instanceof Error` (K157).
- The tsconfig of the repository: include every TypeScript file that `make lint-ts` lints, the scripts and benchmarks too, and exclude `scripts/kit`, the copies of kit. A file outside the project has no types, so each call of an import there fails `typescript/no-unsafe-call` (K157).
- `buildBackend` of `config/release.json`, which `make kit-check` now refuses: move it to `pythonBackend` of `config/toolchain.json` (`{ "requirement": "<name>==<version>", "sha256": "<sha256 of its wheel>" }`) and run `make install-tools` (K166).

## 0.0.45

- knip.json ignores the binaries of the runtimes that polyspec pins by mise or by its setup, php, composer, python3, cargo, node and git, besides make, go, rustup and shasum: a script that spawned php or composer was an unlisted binary. A system tool of one repository, such as Apple `container`, is declared with its reason in `binaries` of `config/knip-entries.json` (`{ "<name>": "<reason>" }`), which make lint-ts adds to `ignoreBinaries` as it adds `entries` to the entries; `entries` is now optional (K152).
- `make dependency-policy-mutation-check` copies `go.work` and `go.work.sum` with the dependency files: without them a module whose only requirement is another member of the workspace was asked for a go.sum that it cannot have, so the check failed on template (`tools/showcase/adapters/go`) while `make dependency-policy-check` passed (K153).
- `config/knip-entries.json` declares a nested npm project with a package.json of its own as a knip workspace: `workspaces` maps its directory to its reason, its `entries` relative to it and its `ignoreDependencies` (each dependency that no JavaScript of it imports, such as one that only Rust tests load), each with a reason, and make lint-ts adds it to `workspaces` of `var/lint-ts/knip.json`. As root entries its dependencies were unlisted at the root (ssr `packages/build/tests/fixtures`); knip's Svelte plugin compiles its `.svelte` files (K154).

### Consumer migration

Run:
- `make kit-sync`, which writes knip.json (K152).

Add:
- `binaries` in `config/knip-entries.json` for each system tool of the repository that a script spawns and knip reports as an unlisted binary, such as `container` (hyper) or `gmake` (template), with its reason (K152).
- `workspaces` in `config/knip-entries.json` for each nested npm project, such as ssr `packages/build/tests/fixtures`, with its reason, entries and ignored dependencies, instead of declaring its files as root entries (K154).

## 0.0.44

- A tool of kit resolves the repository root itself, the top level of the Git work tree of its working directory, so a tool started below the root, as `npm -w` starts it in a package directory, reads and writes the paths of the repository; `ROOT` of `paths.mts` is now `repositoryRoot()`, read on its first use, and a tool that needs the root fails outside a Git work tree (K144).
- `config/release-assets.json` pins the release archives of other polyspec repositories once, each with its version, URL (`{version}`), sha256 and directory under the ignored var/; `make release-assets-fetch` (ONLINE) downloads each one that var/ lacks with its sha256 checked and extracts a zip with `unpack`, `release-assets.mts version <name>` gives a Makefile the version, and `consumers.composer.polyspec` of config/release.json puts the release zips of polyspec dependencies into the artifact repository of the Composer consumer, which release-tools fetches (K140).
- A repository adds knip entries without editing the copy knip.json: `config/knip-entries.json` maps each file that make runs outside the layout entries to its reason, and make lint-ts runs knip with knip.json and those entries (`var/lint-ts/knip.json`); knip.json holds no comments any more, so lint-ts reads it as JSON (K145).
- `layout-root-files` adds the root files of a repository to the list of kit: config/layout.yml sets only `vars: { root_files: "{a,b}" }`, a glob alternation of its own files, and make layout-check fails on an override of the `paths` of that rule (`layout-root-files-additive`), which replaced the list of kit (K145).
- `make install-tools` installs the Rust toolchain of `rust-toolchain.toml` with its components by `rustup toolchain install --no-self-update` in the checkout, which reads the file: rustup 1.28 no longer installs it as cargo first runs, so every CI job that ran cargo failed with `toolchain '1.99.0-x86_64-unknown-linux-gnu' is not installed`. A missing rustup fails with its install, and `make toolchain-check` names a toolchain that is not installed with the fix `make install-tools` (K151).
- `make install-tools` removes every file of `var/tools/bin` that kit no longer writes, such as the `go`, `gofmt`, `python3` and `alint` wrappers of kit 0.0.38: those tools now come from mise, and the old wrappers, first on PATH, shadowed the shims of mise. It keeps mise, npm and npx of the bootstrap and the wrappers of the declared Composer projects (K149).
- The copies `scripts/kit/bootstrap/files.mts` and `digest.mts` take bytes as `Uint8Array` instead of `NodeJS.ArrayBufferView`: a consumer's tsconfig does not cover the copies of kit, so oxlint-tsgolint checked them without the types of node, and the unresolved type failed `typescript/no-redundant-type-constituents` in ordered-json on 0.0.43 while kit's own lint passed. Run make kit-sync (K150).
- ruff keeps its cache in `var/ruff` by `cache-dir` of the copied `ruff.toml`: `make lint-python` left `.ruff_cache` at the repository root, which layout S5 refuses unless ignored. Run make kit-sync and remove `.ruff_cache` (K147).

### Consumer migration

Run:
- `make kit-sync`, which writes `ruff.toml` and the copies of `scripts/kit/bootstrap` (K147, K150), then `make install-tools`, which installs the Rust toolchain of `rust-toolchain.toml` and removes the stale wrappers of `var/tools/bin` (K151, K149). A CI job that runs cargo runs `make install-tools` before it.

Remove:
- `.ruff_cache` at the root, and its entry in `.gitignore` if one was added for it (K147).

Add:
- `config/knip-entries.json`: declare each file that make runs outside the layout entries of knip.json, such as a test probe, with its reason (`{ "schema": 1, "entries": { "<glob>": "<reason>" } }`), instead of leaving it unused (K145).
- `config/release-assets.json` for each release archive of another polyspec repository that the repository downloads, and `make release-assets-fetch` in its install target; remove the own downloader (hyper `scripts/template-assets.mts` and `config/template-assets.json`, fsm the `composer-artifacts` recipe and `config/composer-artifacts.txt`). A Makefile that needs a tag reads it with `$(shell node $(KIT)/release-assets.$(KIT_EXT) version <name>)`; a destination lies under var/, so a Composer `artifact` repository names that directory (K140).
- `consumers.composer.polyspec` in config/release.json for a Composer consumer that installs a polyspec dependency, with `require` of its version in the consumer composer.json, instead of an inline package repository; run make release-consumer-lock again (K140).

Change:
- `config/layout.yml`: replace an override of the `paths` of `layout-root-files` by `vars: { root_files: "{a,b}" }` that names only the root files of the repository, such as `- id: layout-root-files` with `vars: { root_files: "{tsconfig.build.json}" }`; make layout-check fails on the override (K145).

## 0.0.43

- parity runs a cargo binding whose test is tests/<name>/main.rs as `--test <name>`, Cargo's layout of a test target with modules, and counts the other files of tests/<name>/ as modules of that binding rather than tests of no binding (K148).
- knip takes the files that make runs as entries by the layout: the scripts under `scripts/` with the copies of kit, the programs of `benchmarks/` and every node:test file, and `@polyspec/kit`, which the Makefile includes, is no unused dependency; kit lints itself with make lint-ts in CI and fixed what it found, among them the template literal of `scripts/kit/bootstrap/install-mise.mts` that failed the lint of every consumer. Run make kit-sync (K142).
- `make dependency-review` and `make dependency-policy-check` name a missing configuration file (`config/dependency-policy.json is missing; …`) and end with status 1 instead of failing with the stack trace of the read; every other error keeps its stack (K146).
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
