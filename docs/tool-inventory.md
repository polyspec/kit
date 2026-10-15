<!-- doc-id: tool-inventory -->
# Tool inventory

[한국어](tool-inventory.ko.md)

The shared tools exist in several implementations. This inventory records where each one lives, its size, and the
implementation that kit takes as its base. A tool is merged into kit by taking the wider behavior of the implementations,
fixing it with a kit test, and replacing every copy with the vendored file. Measured on the working trees of the five
repositories (lines).

| Tool | template | crudui | hyper | ordered-json | orm | Base of kit |
|---|---|---|---|---|---|---|
| release | `scripts/release.mts` 388 | 357 | 317 | `scripts/release.py` 383 | `scripts/release/release.mts` 302 | template, with the Go tag rule of ordered-json |
| push-gate | 125 | 149 | 121 | `push_gate.py` 192 | `scripts/check/push-gate.mts` 121 | crudui |
| full-run | 199 | 240 | 246 | `full_run.py` 285 | `scripts/check/full-run.mts` 328 | orm |
| git-hooks | 27 | none | 28 | none | none | hyper |
| holder-lock | 134 | 275 | 111 | none | none | crudui |
| check-documents | 151 | 95 | 70 | `docs_check.py` | none | template |
| owner-check | 219 | 254 | 178 | `owner_check.py` 171 | none | crudui |
| run-tests | 289 | 282 | 159 | `test.py` | none | template |
| target-report, ci-targets | 100, 52 | 73, 47 | none | `ci_run.py` | none | template |
| ci-passed | 36 | 39 | none | `ci_run.py` | `scripts/check/ci-passed.mts` 32 | template |
| install-tools | 189 | none | none | `toolchains.py` | none | template |
| dependency state, review, gate | in kit since v0.0.2 | 317, 288, 185 | none | none | none | crudui, merged with kit |
| github-ruleset | 182 | none | 164 | none | none | removed (0.x has no ruleset) |

## Decisions

- Every tool is Node: a TypeScript source (`.mts`) of scripts/kit, which the build writes as `.mjs` into dist. The Python tools of ordered-json are replaced and deleted.
- A repository differs from another only in `config/*.json`; a tool has no repository name or path in its code.
- `github-ruleset` is not vendored: the 0.x rule has no pull request and no ruleset, so the file and its Make targets are
  removed in template and hyper.

## Toolchains (K8.2)

mise with `mise.lock` installs the tools of a checkout (K127). `mise.toml` declares them and `mise.lock` pins each archive by
its sha256 for linux-x64, linux-arm64, macos-arm64 and macos-x64, the platforms of the bootstrap of mise; `make toolchain-lock` writes the lock (`scripts/kit/toolchain-lock.mts`, `mise lock`)
and `make install-tools` installs it (`scripts/kit/install-tools.mts`, `mise install --locked`), then installs what mise does
not: the wheel backend (`pythonBackend`), the Composer projects of `config/phpunit` and `config/php-lint`, with rustup
(`install-rust.mts`) the toolchain of `rust-toolchain.toml` with its components (`rustup toolchain install --no-self-update`
in the checkout, which reads the file; rustup 1.28 no longer installs it as cargo first runs) and the Rust channels of
`exceptions`, and the symbol extractors. The bootstrap (`make install-tools TOOLS=npm`, `scripts/kit/bootstrap/bootstrap.mts`) installs the npm of
`packageManager` and mise itself, by the sha256 of `config/toolchain.json` `mise`; `install-tool.mts` builds each of them beside
its target, checks it there and renames it, so a second run changes nothing. mise keeps its data, cache, state and config,
its installs and its shims in `var/tools/mise`, and the wrapper `var/tools/bin/mise` sets that environment; nothing outside the
checkout changes. A tool of `mise.toml` is reached through its shim in `var/tools/mise/shims` (`scripts/kit/mise-tools.mts`):
kit.mk exports the environment of mise of the checkout to every recipe and puts `var/tools/bin` and the shims first on PATH.
`var/tools/bin` holds only the wrappers that kit writes for the declarations of the checkout: mise, npm and npx of the
bootstrap, phpunit, phpcs and phpstan of the declared Composer projects. `make install-tools` removes every other file there
before it installs, such as a wrapper of an older kit for a tool that now comes from mise, which would shadow its shim (K149).
`scripts/kit/check-toolchain.mts` compares the running tools with the declarations: `scripts/kit/bootstrap/toolchain-declared.mts`
reads those of the bootstrap and of the tools that mise does not install, `scripts/kit/toolchain-mise.mts` the tools of
`mise.toml` and the digests of `mise.lock`, and `scripts/kit/toolchain-files.mts` Rust and the go.mod files with the tools of
their ecosystems. Make targets: `install-tools` and `toolchain-lock` (online through `ONLINE`) and `toolchain-check` (offline,
`TOOLS` limits the tools). Rust stays with rustup: `rust-toolchain.toml` with rustup is the Rust ecosystem's own toolchain
mechanism, and the rust backend of mise drives rustup itself, so a second layer would add nothing. The decision of each gap
of mise is in docs/rebuild/toolchain.md.

### Go advisories (K53)

`make dependency-review` asks govulncheck for the advisories of each Go lock (a `go.sum`, beside its `go.mod`), run in the
module directory of the lock. The query names the packages of that module instead of `./...`. The reason: `./...` walks every
directory below the module, and the Go that mise installs under `var/tools` is one of them; govulncheck refuses it
(`outside main module`), so every RECORD run failed. `./...` cannot exclude a directory, so a module that contains `var/`
would walk it whatever the working directory.

- `goPackagePatterns` (`dependency-state.mts`) names the directory of each tracked or new `.go` file of the module, under the
  rules of `./...`: a directory whose name begins with `.` or `_`, `testdata` and `vendor` are skipped, and so is a directory
  below a nested module (a `go.mod` of its own). `checkedFiles` excludes `var/`, `node_modules` and `.tools`, so no directory
  of an install or an output is named.
- `goPackages` (`dependency-review.mts`) runs `go list -e` on those patterns and keeps the import paths of the packages with a
  buildable file. `./...` skips a directory whose files a build constraint excludes (a `//go:build ignore` generator, for
  one), and govulncheck refuses such a pattern, so the query drops it the same way. A module with no buildable package has no
  advisory, since no code of it calls a vulnerable function.
- One advisory result is kept per lock, as before. A lock maps to its module by the directory of its `go.sum`.
- Limits: a package of a `replace` directive that points outside the module directory is not named, so it is not scanned from
  that module, as `./...` did not scan it. A Go package under a directory named `var`, `node_modules` or `.tools` is not
  scanned, as no kit check reads those directories.

### Declarations

| Tool | Declared in | Install or verify |
|---|---|---|
| Node.js | `node` of `mise.toml` (exact), at the kit pin; `mise.lock` holds the sha256 of each platform's archive of nodejs.org. The bootstrap installs it with mise before npm and writes `var/tools/bin/node`, which the wrappers of npm and every recipe of kit.mk (`$(NODE)`) run (K171) | install with mise, in the bootstrap |
| npm | `packageManager` of `package.json`: `npm@X.Y.Z` or `npm@X.Y.Z+sha512.<digest>` | install |
| Go | `go` of `mise.toml`, at the kit pin of `scripts/kit/toolchain-pins.json`; `mise.lock` holds the sha256 of each platform's archive; the `go` line of every `go.mod` must equal the pin, read by `go mod edit -json` (K78) | install with mise |
| Rust | `channel` of `rust-toolchain.toml` (exact), read by smol-toml (`readToml`, K78, K73) | verify |
| PHP | `config/toolchain.json` `php` (minor releases), else `.php-version` | verify |
| Python | `python` of `mise.toml` (exact), whose minor is the kit pin; `mise.lock` pins the python-build-standalone build of each platform by its URL and sha256 | install with mise |
| mise | `config/toolchain.json` `mise`: the exact `version` and the `sha256` of the archive `mise-v<version>-<os>-<arch>.tar.gz` of each platform | install in the bootstrap |
| uv, ruff, golangci-lint | `uv`, `ruff`, `golangci-lint` of `mise.toml` (the aqua backend; `mise.lock` holds the sha256 of each archive) | install with mise |
| alint | `"github:asamarts/alint"` of `mise.toml` (`mise.lock` holds the sha256 of each archive); `make layout-check` runs it (K76) | install with mise |
| Composer | `"http:composer"` of `mise.toml`, with the url of `composer.phar` and its `checksum` from getcomposer.org, which `mise.lock` records | install with mise |
| cargo-audit | `"github:rustsec/rustsec" = { version, version_prefix = "cargo-audit/v" }` of `mise.toml`: the native binary of each platform, its sha256 in `mise.lock` | install with mise |
| cargo-nextest | `"github:nextest-rs/nextest" = { version, version_prefix = "cargo-nextest-" }` of `mise.toml`: the native binary of each platform (the universal binary on macOS), its sha256 in `mise.lock`; check-toolchain reads `cargo-nextest --version` (K143) | install with mise |
| cargo-deny | `cargo-deny` of `mise.toml` (the aqua backend of the registry of mise, `aqua:EmbarkStudios/cargo-deny`): the native binary of each platform, its sha256 in `mise.lock`; check-toolchain reads `cargo-deny --version` (K143) | install with mise |
| govulncheck, deadcode | `"go:golang.org/x/vuln/cmd/govulncheck"`, `"go:golang.org/x/tools/cmd/deadcode"` of `mise.toml`, built by the `go:` backend; `mise.lock` records the release, and Go checks every module against `GOSUMDB` with `GOFLAGS=-mod=readonly` (the declared exception) | install with mise |
| vulture | `"pypi:vulture"` of `mise.toml`: `mise.lock` holds the digest of the uv lock that mise writes under `.mise/locks` | install with mise |
| PHPUnit | `config/toolchain.json` `phpunit` `{ version }`, with the Composer project of `config/phpunit` (`composer.json`, `composer.lock`); kit runs it for its own PHP tests only, and a consumer keeps its PHPUnit in its package `composer.json` | install with the Composer of `mise.toml` |

The shape of `config/toolchain.json` is `scripts/kit/schema/toolchain.schema.json`: `schema` (1), `comment`, `php` (list of
minor releases), `mise` (`version`, `sha256` of each platform's archive), `pythonBackend`, `phpunit` (`version`),
`symbolExtractors` and `exceptions` (below). A tool of `mise.toml`, Node.js among them, has no key there. `mise.toml` declares only the tools that kit checks (`MISE_TOOLS` of `toolchain-mise.mts`), each
at an exact release, and `toolchain-check` fails while `mise.lock` does not pin one of them as above. Rust stays in its own
file, which `rustup` reads; CI's `setup-node` reads the node of `mise.toml` only to start the bootstrap. A tool that is not declared is neither installed nor checked.

### Pins, floors and exceptions (K78)

kit ships one pin for each toolchain in `scripts/kit/toolchain-pins.json` (S4), which the build copies into `dist` beside
`toolchain-pins.mts`: Node.js 26.12.0, Python 3.14, PHP 8.5, Go 1.27.2, Rust 1.99.0 and TypeScript 7.0.2. Whichever tools
`toolchain-check` runs, it fails on each declaration and each manifest floor that is not the pin at the pin's precision
(`toolchain-floors.mts`, over the files of `checkedFiles`, without the tool environments that mise writes in `.mise`). The
pins hold versions only; the digests are those of `mise.lock`. Each pin has one source: kit ships the pins, and the
`mise.toml` of every checkout, kit's included, must declare its Go and Python at them:

| Value | Required |
|---|---|
| the `node`, the `go` and the minor of the `python` of `mise.toml`, `channel` of `rust-toolchain.toml`, and `php` | the pin |
| `engines.node` of every `package.json` | `>=` the Node.js pin |
| `require.php` of every `composer.json`; `config.platform.php` of one beside a `composer.lock` | `>=` the PHP pin; the pin or a patch release of it (`8.5.0`), the form that dependency-policy requires |
| `project.requires-python` of every `pyproject.toml` with a project table (smol-toml) | `>=` the Python pin |
| `go` of every `go.mod` (`go mod edit -json`) | the Go pin, with no `toolchain` line, which the go command drops when it equals the `go` line |
| `rust-version` of every Cargo package (`cargo metadata --no-deps`, workspace inheritance included) | the Rust pin |
| `typescript` of each dependency field of a `package.json`, and the `typescript` that a `package-lock.json` resolves at its top level or for a workspace whose lock entry (`""` or the workspace) declares `typescript`; a typescript that npm hoists for another package or nests under it, such as the TypeScript of API Extractor, is that tool's (S1) | the TypeScript pin |

- `exceptions` of `config/toolchain.json` declares a deviation as `{ tool, channel, scope, reason, retry }` (S8): the scope is
  `.` or a directory of the checkout, and a value under it may equal the channel; a lock entry of a workspace is under the
  folder of that workspace, not of the lock. A deviation without an exception fails,
  and so do an exception that lacks a field or names an unpinned tool, a channel of the wrong precision or a missing
  directory, and one that nothing uses (stale). A Rust `nightly-<yyyy-mm-dd>` is never stale: parity reads it for rustdoc
  JSON.
- An `.npmrc` that sets `install-links=true` or `bin-links=false` fails (S1: our rules never block the links of npm). npm
  reads each `.npmrc` in its directory, without the configuration of the user or of the environment.
- TOML is read by smol-toml through `readToml` of `toml.mts`, the one TOML reader of kit (K73).
- A version command ended by a signal is reported with the signal, for example `ended by signal SIGKILL`, not
  `exit status null` (K118).

### Merged behaviors

- npm: the install of template (the npm of the machine runs `npm install --prefix`) and the install of hyper and
  ordered-json (the registry tarball, refused unless its SHA-512 is the declared digest) are one install that takes the
  second path when `packageManager` carries a digest. The layout is `var/tools/npm/node_modules/npm`; the wrappers `npm` and
  `npx` start `npm-cli.js` and `npx-cli.js`. A changed digest of the same version reinstalls (hyper). A tarball with a link or a
  special file is refused (ordered-json). The bootstrap npm runs without `var/tools/bin` on `PATH` (template).
- Go: the Go of `mise.toml`, at the kit pin, is installed by mise from the archive of the Go downloads at the sha256 of
  `mise.lock`. No Go of the machine takes part, so a checkout without Go installs one; toolchain-check compares the `go` line of
  each `go.mod` with the pin through `go mod edit -json` (K78). The archive install of kit and the `goArchives` digests of
  `toolchain-pins.json` are gone (K127).
- Composer: hyper installs `composer.phar` verified by its SHA-256; template, crudui and orm only verify the running
  Composer. mise installs it from the `http:composer` entry of `mise.toml` with its declared checksum (K127).
- Python and PHP: crudui declares the minor release in the configuration, template and ordered-json in `.python-version`.
  Python is a tool of `mise.toml` now, declared at its exact release (K127). PHP takes the configuration, else
  `.php-version` (ordered-json, orm) and the list of crudui and template, and fails when both exist and differ.
- Python (K64, K127): mise installs the exact python-build-standalone build that `mise.lock` pins by its URL and sha256 into
  `var/tools/mise/installs`, and the shim `var/tools/mise/shims/python3` runs it. uv installs no Python
  (`UV_PYTHON_DOWNLOADS=never`), and the uv of kit runs on the Python of mise (`UV_PYTHON`). The Python of mise is externally
  managed for pip as before, so pip installs only into a venv of it. `check-toolchain`, run-tests and release-proof run that
  shim, never the Python of PATH. A package whose tests import its own installed dependencies runs them with
  `run-tests python --venv <directory>` (K37): the runner starts `<directory>/bin/python` only when `<directory>/pyvenv.cfg`
  names as its `home` a directory under `var/tools/mise` (read through links); it refuses any other environment before the
  tool starts, with the fix `make python-venv DIR=<directory>` (K44) or `var/tools/mise/shims/uv venv --python
  var/tools/mise/shims/python3 <directory>`. The symbolic links of the environment are the behavior of the tool that made it and are accepted as it made them
  (K63): `uv venv` links `bin/python` to the interpreter and `bin/python3` and `bin/python3.14` to `bin/python`, and run-tests
  runs such an environment without copying, removing or rewriting a link.
- Wheel proof (K46): `release-consumer` makes the venv of a wheel with `makeVenv` (`uv venv`, no pip) and installs the wheel with
  the pip of the checkout, `var/tools/mise/shims/python3 -m pip --python <venv>/bin/python install`, which reads the version with
  `show`. The venv has no pip of its own, and no python3 of PATH runs.
- Python venv (K44, K64): `make python-venv DIR=<directory>` (`scripts/kit/python-venv.mts`) makes a virtual environment of the
  checkout Python with `var/tools/mise/shims/uv venv --python var/tools/mise/shims/python3 <directory>` and leaves it as uv makes it, its
  links included. The run is idempotent: an existing `<directory>` that is already a venv of the checkout Python (run-tests'
  rule and the same Python version) is accepted unchanged and reported as such; any other existing `<directory>` is an error
  with its reason and is neither removed nor repaired. A failed run removes the directory it made.
- ruff and vulture (K127): ruff is the archive of its GitHub release that mise installs at the sha256 of `mise.lock`, and
  vulture the `pypi:` tool whose environment mise builds in place from the uv lock of `.mise/locks`, so its console script
  names an interpreter that exists.
- Verification: crudui's list of tools and its message (the declaring file, the running and the expected version, the fix),
  PHP and Python by minor release (crudui, ordered-json, hyper), exact release for the other tools, `GOTOOLCHAIN=local` and
  `RUSTUP_AUTO_INSTALL=0` (ordered-json), the evidence function `toolchainVersions` (crudui). The check also covers ruff,
  cargo-audit and govulncheck, and a run that checks no tool fails.
- Configuration data: the shape accepts the data of every repository. `php` is a list (hyper writes `["8.5"]`), `composer` is
  an object (template and crudui write `{ "version": "2.10.3" }`), and every file has `schema: 1`.

### Dropped behaviors

- hyper checked that `npm` and `composer` on `PATH` are the files of `var/tools/bin`. The policy is the declared version, which
  the version check enforces for every tool; a machine whose own npm is the declared release passes.
- hyper kept npm in `var/tools/npm` without `node_modules`; the layout of template replaces it, so one wrapper text exists.
- ordered-json's `pin TOOL` command printed a pinned version for CI. The setup actions read the pin files, and
  `declaredToolchain` returns the same values to a script.
- orm required a newline at the end of `.node-version`, `.php-version` and `.go-version`. The files are read
  trimmed; an editor setting is not a toolchain version.
- The `.tools/npm` path of crudui is replaced by `var/tools/npm` (`checkout-npm.mjs` is not vendored).

### Stays in the repository

- Playwright and Puppeteer browser installs (crudui `install-browsers.mjs`): they depend on the browsers of one project.
- crudui `install-lock.mjs`, `tool-resolution.mjs` and `run-command.mjs`: the first derives the lock of one install project,
  the second resolves the absolute paths of cargo, rustc and rustdoc for one build, and neither installs a declared toolchain.
- ordered-json `make tools`: the Rust toolchain (`rustup toolchain install`, which changes the toolchains that rustup
  manages on the machine), the crates (`cargo fetch`), the PIE phar and the JSONTestSuite checkout. kit verifies Rust and
  never installs it.
- crudui's phpDocumentor install, orm's checks of CI workflow files (`node-version-file`, `go-version-file`,
  `php-version-file`, `tools: composer:`), the minimum releases of `engines.node` and `require.php` and the path of a
  `go.mod` module: they check files of one repository, not a tool of the machine.
- A recipe starts a tool of the checkout by its absolute path, never by its bare name (K171): make 3.81, the make of macOS,
  looks up a recipe line without shell syntax on the PATH that make started with, not on the PATH that kit.mk exports, so a
  bare `node` ran the node of the machine. kit.mk names them `$(NODE)`, `$(NPM)` and `$(ALINT)`; `BOOTSTRAP_NODE` is the
  node of the machine, which only starts the bootstrap and `make toolchain-lock` (K174): the bootstrap installs the node of
  the checkout from the `mise.lock` that toolchain-lock writes, so toolchain-lock runs before that node exists, and it
  installs the mise of `config/toolchain.json` itself, as the bootstrap does. A checkout whose `mise.lock` pins no node runs
  `make toolchain-lock`, then `make install-tools TOOLS=npm`. `make kit-check` fails a recipe of the Makefile that starts a tool
  of the checkout (`recipe-tools.mts`: the wrappers of var/tools/bin and the commands of `mise.toml`) by its bare name.
## Layout check (K76)

S5 (folders), the location part of S7 (test placement) and the TypeScript rule of S9 are checked by
[alint](https://github.com/asamarts/alint), a released tool, and not by a tool of kit: S1 forbids a rebuild when an
ecosystem tool expresses the requirement, and alint expresses every item below with configuration alone. kit therefore has
no rebuild record for it; this section records the choice.

- `make layout-check` runs `var/tools/mise/shims/alint check --config config/layout.yml .` (offline). `"github:asamarts/alint"`
  of `mise.toml` declares the release and `mise.lock` pins the sha256 of the archive of each platform (K127).
- `config/layout.kit.yml` holds the common rules and templates. It is a copy (`kit.copies` of package.json), so kit-sync
  writes it from the installed package and kit-check compares it byte for byte; a repository never edits it. It lies in `config/` because alint reads an `extends:`
  target only from the folder of the config that names it.
- `config/layout.yml` of a repository extends it and adds its map: the instances of the templates `no-repository-prefix` and
  `go-module-path` with its name, one `component-ports` instance for each component with ports, and overrides by rule id (its
  components in `layout-packages`, its runners in `layout-root-tests`, its S9 exceptions). An override of `paths` replaces
  the list, so it repeats the common entries. The root files are additive (K145): `layout-root-files` is an instance of the
  template `root-files`, whose list of kit ends in `!{{vars.root_files}}`, and a repository names only its own files with
  `vars: { root_files: "{a,b}" }`, a glob alternation (`"{}"` names none). alint substitutes a variable as text, so the
  alternation of one glob carries the list. The rule `layout-root-files-additive` fails on an override of the `paths` of
  `layout-root-files` in `config/layout.yml`, which would drop each root file that kit adds later without a finding. Each exception carries its reason in the comment right above
  it. alint has no field for a reason, so the owner's required review of `config/layout.yml` through `CODEOWNERS`, which
  the standards plan sets up with parity (S6), is what enforces S8; kit has no `CODEOWNERS` yet.
- `PYTHONPATH` is checked here across the checkout; the parity schema also rejects it, and every path that leaves the
  repository, in `config/parity.json` (K75). Feature ownership of a test stays in parity R5 and R6, and the layout places
  only the root `tests/`.
- `tests/source/layout-real.test.mts` runs the real alint: a repository that follows the layout passes, each planted
  violations fails with the rule that names it, a repository whose `vars.root_files` names its own root files passes with the
  root files of kit, and this checkout passes.

### Requirement and verdicts

Measured with alint 0.18.2 on fixture repositories, and read-only on fsm and orm, where the rules found the violations that the
standards plan lists (root `conformance/`, `machines/`, `schema/`, the `fsm-` prefixes, the module path of `fsm-go`,
`PYTHONPATH` and `../ordered-json/…` in `config/parity.json`, `.mjs` scripts).

| Item | Requirement | alint rule | Verdict |
|---|---|---|---|
| L1 | root allowlist of folders and files | `dir_absent`, `file_absent` with `root_only` and `!` entries | native |
| L2 | `packages/<runtime>/`, `packages/<component>/`, `packages/<component>/<runtime>/` | `dir_absent`, `file_absent`, template `component-ports` | native |
| L3 | no `<repo>-` prefix under `packages/` | template `no-repository-prefix` | native |
| L4 | go.mod module path = `github.com/polyspec/<repo>/<folder>`, with Go's `/vN` for v2+ | `for_each_file` with `file_content_matches` | native |
| L5 | no `PYTHONPATH` | `file_content_forbidden` | native |
| L6 | no path that leaves the repository: `config/*.json`, `go.mod` replace, pyproject path sources, `Cargo.toml` `path`, `composer.json` path repositories | `json_path_absent`; `for_each_file` with `cross_file` `relation: resolves`, which resolves inside the repository only (a missing target is reported too) | native |
| L7 | no infrastructure script that is not TypeScript under `scripts/` and `tests/`, except declared S9 exceptions | `file_absent` on script extensions, `file_content_forbidden` on other shebangs | native; reasons are comments |
| L8 | the root `tests/` holds the declared runners only | `dir_absent` | native for the location |
| L9 | pinned release and sha256 per platform, offline, config passed explicitly | release archives with `SHA256SUMS` and a cosign bundle | fits mise and `mise.lock` |

### Tools evaluated

| Tool | State (2026-10-13) | Verdict |
|---|---|---|
| alint | 0.18.2, first release 2026-04-19, Apache-2.0 OR MIT, one maintainer, about 1.4k crate downloads; binaries for darwin and linux, x64 and arm64 | chosen: covers L1–L9 |
| ls-lint | 2.3.1, MIT | names only (`.dir` applies recursively); no file content, so no L4–L6 |
| Repolinter | 0.12.0; the repository is archived | out |
| @rikalabs/repo-lint | 2.3.0, about 180 downloads a month | path layout only; no L4–L6 |
| eslint-plugin-project-structure | 3.14.5 | lints the files ESLint reads; no `go.mod` or manifests |
| fsm `scripts/check-layout.mjs` | our own code | fsm only (requires the `fsm-<kind>` prefix, reads `contracts/layout.json`, checks only `packages/`) |

### Maturity risk and the version procedure

alint is 0.x and releases often; 0.17 and 0.18 changed configuration keys that the layout rules do not use. The risk is held by
the pin: `mise.toml` names the exact release, `mise.lock` the sha256 of each platform archive, and the install refuses
another archive. To raise the version:

1. read the CHANGELOG of every release between the pinned one and the new one for changed configuration;
2. set the release in `mise.toml`, run `make toolchain-lock` and compare the digests of `mise.lock` with the release's
   `SHA256SUMS`;
3. run `make install-tools`, then the fixtures of `tests/source/layout-real.test.mts` and `make layout-check`;
4. change the layout rules only for a changed key, in `config/layout.kit.yml`.

## Gates: push-gate, full-run, git-hooks, holder-lock (K6.1)

Files: `scripts/kit/checklist.mts`, `push-gate.mts`, `git-hooks.mts`, `holder-lock.mts`, `full-run.mts`,
`schema/checklist.schema.json`, and the make targets `hooks`, `hooks-check`, `push-gate-commit` and `rerun-failed` at the end of
`kit.mk`. The base is crudui for the lock, template for the guard and the hook, and the union of all five for the trackers.

### Policy

A push is refused while an item of a tracker is in its active state (`[~]` for a checklist) in a pushed commit or in the working
tree. The states waiting `[ ]`, done `[o]` and bypassed `[!]` do not block, and the refusal says so. The pre-push hook runs the
gate. It also checks the message of each pushed commit with the rules of `make commits-check` (`check-commits.mts`, `config/commits.json`),
because a pushed commit cannot be rewritten. For each pushed ref, the commits are the range from the remote sha to the local sha, or, when
the remote sha is zero, the commits that no remote ref holds. A deleted ref pushes no commit and is skipped. A push with a finding is
refused, and each finding names its commit and line (`<commit>: <rule>: <message>`). The guard of the full run refuses while an item is in the active state, while tracked files have changes, and when the
record of a full run of the current tree exists. There is no pull request, merge queue or ruleset in this policy.

### `config/checklist.json`
```json
{
  "schema": 1,
  "hooks": ["pre-push"],
  "trackers": [
    {
      "path": "docs/plans/execution-checklist.md",
      "translation": "docs/plans/execution-checklist.ko.md",
      "format": "table",
      "states": ["[ ]", "[~]", "[o]", "[!]"],
      "active": "[~]"
    }
  ]
}
```

`hooks` lists the tracked hooks of `.githooks` and must include `pre-push`. A tracker has `path`, `format` (`table`: a row
`| ID | ... | state |`; `list`: an item `- [state] ID text`, indented for a sub-item) and `active`; it may have `translation`,
`idPattern` (the source of the regular expression that a task ID matches as a whole; a letter followed by letters, digits, `.` and `-` when absent), `states` (a state outside the list is an error) and `column` (the zero-based cell of a table row that holds the state; the last
cell when absent). A state is the leading `[x]` of its cell or item, or the whole cell when the cell does not start with `[`.

### Merged behaviors

| Behavior | Sources | Decision |
|---|---|---|
| Table rows with the state in the last cell | template, crudui, hyper, ordered-json | `format: table` |
| List items `- [state] ID text` with sub-items | orm | `format: list`; the title is the first sentence |
| A second tracker whose state is a word in a column (`partial` in the implementation column of the feature table) | ordered-json | `column` and `active` of a tracker; several trackers are allowed |
| A tracker without an item, a repeated ID, a state outside the declared states, or a row that is not an item is unreadable and refuses | ordered-json, orm (document checks); template ignored such rows | refuse in the gate and the guard: the wider reading never takes an unreadable document for an empty one |
| A pushed commit without the tracker file refuses | all | kept; the message names the file |
| A malformed line of the hook input refuses; a deleted ref pushes no commit; the working tree is always read | ordered-json (malformed), all (others) | kept |
| The Korean twin must hold the same IDs in the same order and the same states | orm, ordered-json (document checks) | the gate and the guard also refuse a pair that differs, because the pair is read with the same parser; the document checks of K7 keep the other rules (markers, bypass text) |
| The refusal names the file, the ID, the title and the place (pushed ref and commit, or working tree) | all | kept; it also states which states block and which do not; the commit is shown with 12 characters (ordered-json, orm; template and hyper used 7) |
| `commit <rev>` prints a GitHub annotation per line, escapes `%` and line breaks, appends to `$GITHUB_STEP_SUMMARY`, requires mode 100755 of the hook, and names a revision that is not a commit | template, crudui, hyper, ordered-json, orm | kept; it requires the mode of every hook in `hooks` (ordered-json required `pre-commit` too; the others only `pre-push`) |
| `hooks-check` fails when `core.hooksPath` differs, the hook is missing or not executable | all | `git-hooks.mts check`; it also fails when `pre-push` has other content than the hook of the tool |
| `make hooks` sets `core.hooksPath` and checks | template, hyper, ordered-json (`hooks-install`) | `git-hooks.mts install` also writes `pre-push` and makes the listed hooks executable; a second run changes nothing |
| Every make invocation sets `core.hooksPath` | template, orm | `kit.mk` sets it only in a checkout that tracks `.githooks/pre-push`, so a checkout without hooks is not changed |
| The content of `pre-push` | all differ in the `cd` to the top level and the comment | one content, written by `git-hooks install` and compared by `check` |
| Hooks other than `pre-push` (`pre-commit` of ordered-json, `commit-msg` of orm) | ordered-json, orm | named in `hooks` and checked for existence and mode; their content stays in the repository |
| Lock record: checkout, process ID, start time of the process, time taken, command, token; atomic link; start time tells a reused process ID from the holder | crudui | base of `holder-lock.mts`; template and hyper recorded no start time |
| A lock of an ended holder stays until `clear`; `clear` renames the lock aside and restores it when a new holder took it meanwhile | crudui (`remove-dead`), template and hyper (`clear`) | under the name `clear`, with the claim of flowmark's spec 40 (K28): `clear` links the lock to `<lock>.<first 32 hex digits of the SHA-256 of the record>.clearing` (an existing claim refuses), removes only a lock that still holds the record it checked, and never moves the lock of a running holder; the rename aside left two holders when two clears ran at once |
| The start time of a process: `/proc/<pid>/stat` field 22 with `btime` on Linux, `ps -o lstart=` elsewhere | crudui | K28: on Linux field 22 with the boot ID of `/proc/sys/kernel/random/boot_id`, because `btime` follows the wall clock; an unreadable `/proc/<pid>/stat` (`hidepid`) asks kill(pid, 0) again and counts as running unless ESRCH. On Windows `powershell.exe -NoProfile -NonInteractive -Command` with `(Get-Process -Id <pid>).StartTime.ToFileTimeUtc()`: Node reads no creation time without a native addon, .NET reads it with `GetProcessTimes`, Windows PowerShell 5.1 ships with every supported Windows, and `wmic` is deprecated. On macOS `ps` stays: sysctl `kern.proc.pid` and `proc_pidinfo` need a native addon, and macOS has no `/proc` |
| Release on process exit, and on SIGINT, SIGTERM and SIGHUP with the status 128 + n | template | kept, as the default of an in-process holder; `run` forwards the signals to the command instead |
| `run <lock> -- <command>` exits with the status of the command; 128 + n for a signal; 127 when it does not start | crudui (`hold`), template, hyper | kept under the name `run` |
| The release fails when the token differs | template, crudui; hyper printed a message | fail |
| The lock directory is created | crudui, hyper | kept |
| Guard conditions: active item, hooks not installed, dirty tree, another run going on, record of the current tree | template, crudui, hyper, ordered-json | kept |
| Untracked files that Git does not ignore refuse the run, because the record names the tree and the tree does not hold them | ordered-json; the others looked at tracked files only | the wider check |
| One run at a time: the guard holds `var/full-run.lock` from its first read to its last write | template (`var/full-run.json.lock`), crudui (`var/locks/full-run.lock`), hyper and ordered-json (`var/full-run.lock`) | `var/full-run.lock` through `holder-lock.mts` (ordered-json used `flock`) |
| Record `var/full-run.json`: tree, commit, result, targets with status, times and elapsed time, reruns | all but orm | kept; written to a file of the process and renamed |
| The incomplete record names its process; a running process refuses the run | template, crudui, hyper, ordered-json | the record also holds the start time of the process, so a reused process ID does not refuse a later run for good (a defect of all four) |
| `rerun-failed` reruns the targets that did not pass (failed, running, pending) of the current tree | template, crudui, hyper, ordered-json | kept |
| A further input of a run beside the tree: the commit of a dependency | hyper | `--key name=value`; the record holds `keys`, and a run and a rerun need equal keys |
| A failed target keeps its last 20 output lines in the record and prints them | hyper | kept |
| `make -k <target>` and a log per target in `var/report/full-run/targets/<target>.log`; a line after an output without a final newline starts at column 0 | template (`-k`, log), hyper (column 0, last lines) | kept |

### Dropped behaviors

| Behavior | Source | Reason |
|---|---|---|
| Texts that name pull requests, the merge queue, merge groups or the ruleset (`REASON`, the workflow `push-gate.yml` triggers, the required check `push-gate`) | template, crudui, hyper, ordered-json, orm | the 0.x policy has none of them; `commit <rev>` stays for a push from a checkout without the hook |
| The mode `hooks-check` of `push-gate.mts` and `hooks-install` of `push_gate.py` | template, crudui, hyper, ordered-json, orm | a hook belongs to `git-hooks.mts`; the make target keeps the name |
| Targets that are command lines (`sh -c <text>`) or argument groups after `--` | crudui, ordered-json | a record name and a log path must be stable words; a repository wraps a command in a make target |
| The run in a fresh clone of the committed tree with `make install` and a marker in the clone | crudui | it needs the repository's install command and a marker named after the repository; a repository that needs it makes a target that clones |
| The reset of the conformance evidence directory before a run | crudui | repository-specific |
| `environment` (versions of the toolchains) in the record and `summary.md` of the report | template, crudui | the toolchain commands are repository data; K8.1 merges the target report and the toolchain record |
| Selection of the targets of a rerun by the paths changed since the recorded commit, a rerun on a descendant commit, the statuses `not-run` and `crashed`, the preflight `decide`, the `claim` and `recorder` interface, and the record in `.runtime/` | orm | only orm has them, and they read the owner checks of K8; the other four agree on a rerun of the same tree |
| `flock` guard of `full_run.py` | ordered-json | replaced by `holder-lock.mts`; all tools are Node |
| `user-lock-file` and `checkoutLockFile` | crudui | the path of the lock holds a repository name; the caller passes an absolute path |
| Progress lines of `test-progress` | crudui | a module of crudui; the gates print one line per step |
| `scripts/git/check.mjs` (commit subject format, `commit-msg` hook) and the marker and bypass-text rules of `scripts/checklist/check.mjs` | orm | not a gate; the hook is named in `hooks`, the document rules belong to K7 |
## Document checks (K7.1)

`scripts/kit/check-documents.mts` replaces `check-documents.mts` of template, crudui and hyper and `docs_check.py` of
ordered-json. Which Markdown files are documents, its status tables and changelogs are declared in
`config/documents.json` (`scripts/kit/schema/documents.schema.json`); its checklists are declared in `config/checklist.json` (K7.2). Each finding is one line
`<file>:<line>:<column>: <rule>: <message>`.

Merged behaviors (the wider behavior is taken):

| Concern | Implementations | Behavior in kit |
|---|---|---|
| Selection of documents | template and crudui: fixed list and directories; hyper: tracked `*.md`; ordered-json: a manifest that registers every document | tracked and new unignored Markdown files selected by `include` and `exclude` globs; a `.ko.md` file maps to its English file |
| Pair | all: English needs Korean; hyper and ordered-json: Korean needs English | both directions (`pair-missing`) |
| `doc-id` | ordered-json only | both files hold the same `<!-- doc-id: id -->` once; an id names one document |
| Revision | ordered-json only | the Korean file holds `<!-- source-sha256: ... -->` once, equal to the sha256 of the English file |
| Section identifiers | ordered-json (`<a id>` anchors) | anchors are equal in both files and appear once |
| Fenced blocks | template, crudui, hyper: content only; ordered-json: info string and content, `~~~`, unclosed fence | ordered-json behavior: info string and content are compared, both fence characters are read, an unclosed fence fails |
| Links | all: inline links; ordered-json: reference links, autolinks, `href`, a query or an escape of the repository, explicit anchors; template: `.md`, `.ko.md` and `index.md` candidates and skips `/`; crudui: rejects `/` | all link forms; code is not read; an anchor is an explicit anchor or a heading anchor; the `/` and extension-less behavior of a static site is `siteLinks` |
| Private paths | ordered-json | a path into a home directory fails (`private-path`) |
| `{{` | template (VitePress) | `interpolation` globs name the documents in which `{{` outside a fenced block fails |
| Checklist, table | template, crudui, hyper | task rows, state in the last cell, markers only in the state, other lines fail; the header separators of crudui and hyper (`:---:`) are accepted; the ID pattern is `idPattern` of the checklist |
| Checklist, list | orm | `- [o] ID text` items with sub-items and continuation lines, `Cause:` and `Retry:` for `[!]`; the Korean labels are accepted in both styles |
| Checklist pair | template and hyper compare the whole last cell; orm compares IDs and states | task IDs and state markers are compared; a bypass names its cause and retry condition in each language, and the text is translated |
| Duplicate and empty | orm, ordered-json | a repeated task ID and a checklist without tasks fail |
| Status tables | template (two shapes), crudui (6 cells), ordered-json (7 cells) | `statusTables` in the configuration: cells, closed values and patterns per cell; the English and Korean rows agree on the ID and on the closed values |
| Changelog | orm | `## Unreleased` first and once, versions `X.Y.Z` newest first and once, the same sections in both languages |

Dropped behaviors:

- The fixed document list of template and crudui and the registry manifest of ordered-json: the include globs and the
  `doc-id` marker replace them.
- The second status table shape of template (5 cells): a table has one shape, and no compatibility layer keeps the old one.
- The checks of ordered-json that read repository facts stay in the repository: the relations between the implementation,
  verification and distribution states, the evidence record of a state, the record and benchmark files, the distribution
  observations, the layout rule of the tracker section and the recursion into child repositories.
- The comparison of the changelog section with `VERSION` (orm): the release check reads the manifests and compares it.
- The `trace` and `docs` scripts of orm (`scripts/docs`, `scripts/features`) are product-specific and stay in orm.

## Owner check (K8.1-1)

`scripts/kit/owner-check.mts` replaces `owner-check.mts` of template, crudui and hyper and `owner_check.py` of
ordered-json. The declaration is `config/owner-checks.json` (`scripts/kit/schema/owner-checks.schema.json`).

Merged behaviors:

- Globs (`*`, `**`, `{a,b}`), the `always` tests, `$path` for a changed test file, `--paths`, `--base`, `--dry-run` and
  `--validate` are the same in template, crudui and hyper and are kept. picomatch with `dot: true` matches the globs, so a
  path under a dot directory such as `.github` matches like any other.
- Check kinds: crudui selects make targets, scripts of the root `package.json`, workspaces and package directories;
  template and hyper select make targets; ordered-json selects implementations and two named checks. kit takes the crudui
  kinds. A workspace is a `package.json` with a `test` script in a directory that `workspaces` of the root `package.json`
  names, a package directory is one outside them (crudui assumed the directory `packages/`).
- `variable` (template, hyper) passes the matched paths to the targets of a rule as a make variable.
- Targets are ordered by `CHECK_TARGETS` (template, hyper); the other checks keep the order of the declaration (crudui).
- The full-suite targets are those whose recipe starts `full-run.mts` and those named in `fullSuite`; template's fixed names
  `check`, `rerun-failed` and the clean release check become entries of `fullSuite`.
- A rule that selects every target of `CHECK_TARGETS` fails (template). The `inputs` check is the crudui form; its
  declaration is a list of `{ check, paths }`.
- Targets of a file that the Makefile includes (`include scripts/kit/kit.mk`) are known targets (new).
- A node test file runs through `scripts/kit/run-tests.mts`, or through the make target `testTarget` with `TESTS=<files>`
  (hyper).
- Every selected check runs to its end and the failures are listed together (all implementations); no check has a time limit.

Dropped behaviors:

- `languages` and `checks` of ordered-json name that repository's builds; they become `targets` of the Makefile. Its `$module`
  becomes `$path`. Python test modules are not node tests and stay outside kit.
- `useCheckoutNpm` of crudui: the Makefile puts the npm of `var/tools` first on `PATH`; the tool starts `npm` from `PATH`.
- The bare target name as the key of `inputs` (template, hyper): the name is `make <target>` as in crudui.

## Test runner (K8.1-2)

`scripts/kit/run-tests.mts` replaces `run-tests.mts` of template, crudui and hyper and `test.py` of ordered-json. Its progress
reporters are `test-progress.mts`, `node-reporter.mts` and `vitest-reporter.mts`, and its parsers of the go, cargo, PHPUnit and
unittest output are in `test-output.mts`, which the language-parity check reads with the same functions (K47); `test-exit-deadline.mts` is preloaded into
each node test file and fails a file whose process outlives its last test by the test timeout, naming its open handles (K72), and `test-hooks.mts` is the `setup` and `teardown` helper of tests.

Merged behaviors:

- Tools: `node`, `vitest`, `go`, `cargo`, `phpunit` (template and crudui) and `python` (K17); hyper has the first, the last and `vitest`. Each test
  prints its start, a line while it runs, and its result with the elapsed time; each test has its own timeout
  (`--timeout`, 30 s by default), enforced by `node --test` and vitest and by the runner for the other tools. No whole run, package or
  file has a time limit (all implementations; crudui's `go test -timeout 10m` is dropped for `-timeout=0`).
- A run in which no test passed, failed or ran out of time fails. template counted a skipped test as a test; hyper and crudui did
  not, and kit takes theirs, because a run that only skipped verified nothing. The reporters write their counts to the file in
  `KIT_TEST_RESULT` (hyper's `HYPER_TEST_RESULT`) and the runner fails when no counts arrive.
- A node test file that registers no test fails (crudui), and so does a file whose process ends before its module registered
  every test (crudui `load-check`). A Go package that started no test case is reported as skipped (crudui).
- The summary of a failed run names the error lines of the tool, and the build errors of a Go package that does not build
  (template); the timeout line names the command that it stops (crudui).
- Every tool runs in its own process group (K141), so a stop reaches the processes that the tool started, such as the
  interpreter that the mise shim runs. The runner stops the group with SIGTERM and, when the tool has not closed after 5 s,
  with SIGKILL: at a test's timeout, and when the runner receives SIGINT, SIGTERM or SIGHUP, after which it ends on that
  signal. Only a SIGKILL of the runner itself leaves the group running.
- `phpunit` runs `<cwd>/vendor/bin/phpunit`, or the vendor directory of `COMPOSER_VENDOR_DIR` (crudui), with `--php-extension`
  for an extension (template, hyper's `--extension`); a missing extension fails before the tool starts. `--php-extension`
  repeats: each extension is loaded with its own `-d extension=<path>`, PHP's own way, in the given order, so one loads after
  an extension that it depends on, and each is checked as built before the tool starts (K165).
- A tool that cannot start fails with its command and the fix.
- `python` (K17) runs `python3 -m unittest <arguments> -v` and reads its standard error: a test prints `<description> ... `
  when it starts and its outcome when it ends, the same shape as the serial libtest output of cargo, so one parser of start
  and result lines reads both. `ok` passes, `expected failure` is a todo (no pass), `skipped` is skipped, `FAIL`, `ERROR` and `unexpected
  success` fail; a docstring line after the description keeps the id of the description. The runner applies the timeout.
- `--results <file>` (K18) writes the record of a run, passed or not, through a temporary file and a rename: the counts, every
  test as `{id, status, elapsedMs}` (`pass`, `fail`, `timeout` or `skip`), the tool, the elapsed time of the run and `inputs`,
  the `inputsDigest` of the `--inputs` paths (the `--cwd` directory by default) over the tracked and non-ignored files. The
  progress module records the tests, so the reporters of node and vitest and the parsers of the other tools need nothing
  more. A check compares `inputs` with the current files to tell a stale record.

Dropped behaviors:

- Python `unittest` runs with signal timeouts (`test.py`): the `python` tool runs `python3 -m unittest` with the timeout of
  the runner instead (K17).
- crudui's `recordSuiteRun` of a conformance record and its start of cargo through `run-rust-command.mjs`, template's
  `tools.mjs` entry of vitest, and hyper's `toolPath`: repository specific. The runner starts `cargo` and `go` from `PATH`
  (the Makefile puts `var/tools` first) and vitest from `node_modules/vitest/vitest.mjs`.

## CI report tools (K8.1-3)

`scripts/kit/ci-targets.mts`, `target-report.mts` and `ci-passed.mts` replace `ci-targets.mts`, `target-report.mts` and
`ci-passed.mts` of template and crudui, `ci-run.mjs` of hyper, `ci_run.py` of ordered-json, `scripts/check/ci-passed.mts` and
`scripts/check/report.mjs`, `summary.mjs` of orm.

Merged behaviors:

- Every target runs as `make -k <target>` to its end, past failures, with its output printed and written to
  `<report>/targets/<target>.log` (template, crudui, hyper, ordered-json); the run holds `<report>.lock` (template, crudui). The
  report of an earlier run is removed first. No target has a time limit.
- hyper: `make --no-print-directory`, no variable of a calling make (`MAKEFLAGS`, `MFLAGS`, `MAKELEVEL`, `MAKEOVERRIDES`), complete
  lines of standard output and standard error that never join, `record.json` written before and after each target
  (a run that stops leaves the target that was running), a report write that never throws and is recorded in `reportErrors`
  (orm has the same rule), and the `--summary` step with `CI_STEPS` that renders the page also for a run that recorded nothing
  or did not end (`summary` of hyper and ordered-json).
- Failure lines: the lines marked `✖` with their indented detail (hyper), else the lines that state a failure without the
  passing, start and make lines (hyper, template), plus the checker lines `file:line: message` and the words of ordered-json,
  else the last lines; then how make ended. The lines `WARNING ...` of a passing target are recorded and shown (hyper, orm).
- The toolchain versions and the runner image are in `record.json` and in the summary (template's `toolchains.json` and
  hyper's `environment`).
- A log above 1 MiB keeps its head and its last 256 KiB (orm).
- `ci-passed`: the input is `RESULTS`, the JSON of `needs` (template, hyper, ordered-json; orm named it `CI_NEEDS`); each job is
  printed with its result; any result other than `success` fails with status 1; an unset or unusable input fails with status 2
  (crudui, orm); `::error` annotations are written on GitHub Actions (crudui, orm).

Dropped behaviors:

- `toolchains.json` and `summary.json` (separate files for what `record.json` holds), the group directory `var/ci/<group>`
  and the `ci-check`, `ci-pins` targets of hyper (the report directory is an argument, the PHP pin is repository specific),
  the refusal outside GitHub Actions (hyper: a run of the targets is allowed anywhere; the full suite guard belongs to the full
  run), the copy of `var/records` (ordered-json) and the environment, disk and server-log files, the case-runner protocol
  (`RUN`, `STEP`, `PASS`, `FAIL`) and the run id of the full-run report (orm): they depend on one repository's checks and stay there.
- The private lock of `ci-targets.mts` (a file with the process id of the holder, removed as stale when the process ended) is
  replaced by `holder-lock.mts` (K7.2): a lock of an ended holder stays until `holder-lock.mts clear` removes it.

## Commit message check (K8.1-4)

`scripts/kit/check-commits.mts` takes `scripts/git/check.mjs` of orm as the shared git hygiene check; template, crudui, hyper
and ordered-json state the same message format in their rules but have no check. The format and the limits are data in
`config/commits.json` (`scripts/kit/schema/commits.schema.json`).

Merged behaviors:

- orm: the subject is `type(scope): Subject (#id)`, the Subject starts with a capital letter, does not end with a period and has
  at most `subjectMax` characters; a range `<base>..<head>` or the last commit is read, a merge commit is not checked, and
  `--message <file>` checks the message being committed (the commit-msg hook) without its comment lines.
- New, from the shared rule of the repositories: a blank line follows the subject, and a body line has at most `bodyMax`
  characters (a single longer word, such as a URL, is allowed).
- New (K19): a commit changes the state of at most one tracker item of config/checklist.json, which every repository
  declares (a row the commit adds is not a change), and a commit that moves an item to the `done` state of its tracker also changes the `changelog` of
  `config/commits.json` and its translation. A commit of a range is compared with its parent; the message being committed,
  with the index against HEAD.

Version consistency and the other area checks of orm:

- `scripts/checklist/check.mjs` of orm is covered by the checklist reader of the document check (list style). `scripts/version/check.mjs`
  keeps its list of version declarations (the Cargo, Composer and npm manifests, the lock files, the contract, README,
  SECURITY and AGENTS texts) and the comparison with the file `VERSION` in orm: the declarations are product specific. The
  shared part, that every manifest has the version of the release, is the release tool (K5), and the shared part of its
  changelog check, the sections of the changelog, is the document check (K7.1).
- `scripts/repo/*.mjs` of orm (`check`, `ci`, `scripts`, `target`, `testcases`, `toolchains`, `gosource`, `node`, `probes`,
  `messages`) check the layout, the Rust target paths, the toolchains, the test cases and the form of failure messages of orm
  and stay in orm.
- `scripts/check/ci-passed.mts` of orm is the CI report tool (K8.1-3).

Dropped behaviors:

- `ORM_GIT_RANGE`: the range is the argument `--range` (the make variable `RANGE`).
- The rule id `git.subject-format` and `contracts/rules.json`: the configuration is `config/commits.json`.

## Release tool (K5)

`scripts/kit/release.mts` merges the release tools of the five repositories (`verify`, `versions`, `assets`, `publish`, plus
`coverage`). The repository is data in `config/release.json` (schema `scripts/kit/schema/release.schema.json`):

```json
{
  "schema": 1,
  "repositoryUrl": "https://github.com/<owner>/<name>",
  "changelog": "CHANGELOG.md",
  "changelogTranslations": ["CHANGELOG.ko.md"],
  "checks": ["push-gate", "ci-passed"],
  "packages": [{ "kind": "npm", "directory": "packages/x", "name": "@scope/x" }],
  "manifests": { "package.json": "version", "packages/x/package.json": "archive", "crate/Cargo.toml": "git-tag" },
  "notReleased": { "tests/consumer/package.json": "the reason" },
  "goModules": { "packages/go": "example.com/module/packages/go" }
}
```

`changelogTranslations` and `checks` are optional (`checks` defaults to `push-gate` and `ci-passed`). The values of
`manifests` are `archive` (the manifest of a package in `packages`), `version` (carries the version without an archive) and
`git-tag` (consumed by git tag). `goModules` maps a directory (`.` for the repository root) to the module path of its go.mod.

### Merged behaviors (the wider behavior is kept)

- Data instead of constants: `PACKAGES`, `MANIFESTS`, `NOT_RELEASED`, `GO_MODULES`, `CHECKS`, `REPOSITORY_URL` and the change
  logs of template, hyper and ordered-json are `config/release.json`. The lists are explicit; coverage detects an omission.
- `verify`: ancestor of `origin/main` and the latest run of each check (template, hyper, ordered-json, crudui, orm). The
  not-on-main finding and the check findings are reported in one message (crudui). The latest run of a check is the run with the
  greatest id, so a rerun that succeeded replaces a failed run.
- `versions`: the manifest kinds package.json, composer.json, Cargo.toml, pyproject.toml (template) and VERSION (orm); the
  module path of every declared go.mod on a root tag, not only on a Go tag (orm, wider than template); a Go module at the
  repository root (orm); further change logs that must hold the section (orm, `changelogTranslations`). A composer.json may omit
  `version` unless it is an `archive` manifest (hyper accepts the omission everywhere, template and ordered-json require the
  version everywhere; an archive must declare it because an artifact repository reads it).
- Change log section: heading, entry required, the anchor lines of the next section removed (template, hyper, ordered-json);
  the link of a long section uses the `<a id>` line above the heading, else the version without its dots (hyper,
  ordered-json); the notes limit is 125000 characters (all).
- Manifest rules (`manifestProblems`), the union of the rules: every dependency field of npm (`dependencies`,
  `devDependencies`, `peerDependencies`, `optionalDependencies`) and of Composer (`require`, `require-dev`) (crudui,
  ordered-json); no path, URL, git source or development version for any dependency (ordered-json); a package of a scope of
  this repository is one exact version and a package of the repository is the version of the tag (template); no `overrides` in a
  package.json (ordered-json); a composer.json declares the version of the tag and no `repositories` (template, orm). The
  scopes are derived from the names in `packages`, so the tool names no scope.
- `assets`: the manifests of the tagged commit pass the rules before a package is packed (ordered-json), the manifest name
  equals the name in `config/release.json` (new), and each archive carries the manifest of the commit byte for byte
  (ordered-json, crudui, orm; template compared parsed JSON). The directory is built beside the target and renamed, so a failed
  run leaves no archive.
- `publish`: the draft release through the API (`gh api --method POST repos/O/R/releases` after the tag is found on the remote,
  as `--verify-tag` required), each archive uploaded to the upload URL of that release, and its id recorded in
  `var/release/<tag>.json` (K79); the five tools ran `gh release create TAG --verify-tag`. The archive names come
  from the configuration, not from a list file (orm wrote `assets.txt`).
- `coverage`: every tracked or new package.json, composer.json, Cargo.toml, pyproject.toml, go.mod and VERSION file is in
  `manifests`, `notReleased` or `goModules` (template test, orm `unlistedManifests`); a listed file that does not exist and a file
  in two lists are findings (orm, wider). A file that kit writes is not released and needs no entry (K167): a copy of
  `kit.copies` of the package that runs, found by Node's self-reference of `@polyspec/kit/package.json` (make kit-sync), the
  Composer project of PHPUnit, `config/phpunit/composer.json` (make install-tools), and the lock tree of mise under
  `.mise/locks/` (make toolchain-lock). A `file:` dependency of a package.json names a folder of the repository, except in the
  npm consumer project that `consumers.npm.directory` declares, whose `file:` dependencies are the archives of the packages of
  its `smoke`, `file:<name>-npm-<version>.tgz` (K129). The rule reads `config/release.json`, so it lives here and not in alint,
  which reads no declaration.

### Dropped behaviors

- crudui discovered the packages of `packages/` and skipped `private` ones: dropped for the explicit list; coverage reports
  a package file that the list omits.
- crudui failed when any run of a check was not successful, even an older failed run that was rerun: dropped, because it blocks
  a release after a successful rerun. orm ordered the runs by `started_at`: dropped for the id, which grows with creation.
- crudui and orm ran `make build`, `make typescript-build` or `scripts/package-dist.mjs` inside the release tool: dropped. The
  build of a package is a prerequisite that the repository adds to its own `release-assets` recipe, so the tool names no build.
- crudui `RELEASE_COMMIT` (assets before the tag exists) and the install of the archives as a consumer (template
  `release-consumer`, crudui `release-install`, hyper and orm `release-install`) is merged in "Consumer install of the release archives (K5.4)".
- orm output under `.runtime/release` and `assets.txt`: the output is `var/release/assets` in every repository.
- Not release steps and not merged: template `check-clean-release.mjs` (a full matrix in a clean worktree) and hyper
  `publish.mjs` (installed copies for development).
- ordered-json `release.py` is replaced by the Node tool.

### Archive names (K5.2)

- Name: `<package>-<language>-<version>.<ext>`; `@scope/name` is written `scope-name` and `vendor/name` `vendor-name`; the
  language is `npm` for an npm package and `php` for a Composer package. `@polyspec/x` is `polyspec-x-npm-0.0.5.tgz`,
  `polyspec/x` is `polyspec-x-php-0.0.5.zip` and `polyspec/x-extension` is `polyspec-x-extension-php-0.0.5.zip`. The five tools
  named archives `<package>-<version>.<ext>` (ordered-json already had the language); the language is kept because an npm
  package and a Composer package may share a name.
- `npm pack` names its output itself. The single new file in the destination is renamed to the archive name (ordered-json,
  template); zero or several new files fail with their names. crudui and orm took the name from the pack report or the
  package name; the rule for the single new file covers both and needs no npm output format.
- Zip: `git archive --format=zip -0` of the package directory at the tagged commit with `--mtime` set to the commit time and
  `TZ=UTC` (ordered-json used a fixed constant time, template the commit time, crudui, hyper and orm neither). `git archive`
  of a tree otherwise writes the current time, and a zip stores local time. A second run of the same tag writes the same
  bytes at any time and in any time zone.

### Go module tags (K5.3)

- A Go proxy resolves a module that lives below the repository root from the tag `<directory>/vX.Y.Z`, not from `vX.Y.Z`. A
  release once lacked these tags. `verify` of a tag `vX.Y.Z` now requires, for every module of `goModules` below the root, the
  tag `<directory>/vX.Y.Z` at the same commit as `vX.Y.Z`. A missing tag and a tag at another commit are findings that name
  the tag, the module path or both commits, and the command that creates the tag
  (`git tag -a <directory>/vX.Y.Z -m <directory>/vX.Y.Z <commit> && git push origin <directory>/vX.Y.Z`; a tag at another commit
  is deleted first with `git tag -d`). The findings are reported in the same message as the ancestry and the check runs.
- The step `go-tags TAG` (`make release-go-tags`) runs this check alone, offline, so the maintainer can run it after tagging.
  Before this row template and ordered-json named the tags in their release policy, and no tool of the five repositories
  checked them.
- A tag `<directory>/vX.Y.Z` releases that module alone: it needs no sibling tag and builds no archive. A module at the
  repository root (`.`) is released by `vX.Y.Z` itself and needs no further tag. The tags must exist in the checkout that runs
  `verify`, so a workflow that runs it fetches the tags.

## One checklist model (K7.2)

`scripts/kit/checklist.mts` held the reader of the push gate and the guard (K6.1), and `scripts/kit/checklist-rows.mjs` held
the reader of the document check (K7.1). Both read the same documents (table rows `| ID | ... | [o] |`, list items
`- [o] ID text`, the states `[ ]`, `[~]`, `[o]` and `[!]`) under two configurations, `trackers` of `config/checklist.json` and
`checklists` of `config/documents.json`. There is now one reader, one configuration and one set of findings.

- `readChecklist(text, tracker, { strict })` returns `{ items, findings }`; an item is `{ id, title, state, line }` with the
  state as the document writes it (`[o]`). The lenient reading (the gate and the guard) reports a malformed row or item, a
  state outside `states`, a repeated ID and a document without an item, and `activeItems` throws on any of them. The strict
  reading (the document check) reports the same findings and also a line that is not a heading or a task, a state marker that is
  not the state of a task, a state cell that holds more than its state, a bypass without cause and retry, each with line and
  column. The messages of each reading are the ones that their tests asserted before the merge.
- `twinFindings` compares the items of a document and of its translation for both readings.
- `config/checklist.json` declares every checklist: `path`, `translation`, `format` (`table` or `list`), `idPattern`, `states`,
  `active`, `column`. `check-documents.mts` reads its checklists from it. The key `checklists` of `config/documents.json`
  and its schema is removed, and the key `style` is `format`. A checklist without `translation` is read in English only.
- Wider behavior taken: a task ID may be followed by a code span, as `` T3.2 `parallel` ``, in both readings (the strict reader
  accepted any text after the ID; it now accepts a code span, so that a first cell such as `not an id` is a finding in both
  readings); a table row may be indented; `states` applies to the strict reading, so a checklist that declares no `states`
  accepts every state word there, where the strict reader accepted only the four states; the separators and the header are
  recognized by their position and by the cell `ID`.
- `ci-targets.mts` holds its report with `holder-lock.mts`; its own lock function is removed.

## Shared modules (K11)

Several tools of `scripts/kit` held their own copy of the same helper. Each helper now lives in one module that its users
import. `make duplication-check` fails when a piece of 6 lines or more exists twice: jscpd reads the tokens of scripts/kit, so
it also finds a repeated piece inside a function, which the test that it replaced (`tests/kit/duplication.test.mts`, whole
functions only) did not (K126). The base had no pair that long; the shortest pair was the 4 lines of `startReport`.

| Module | Holds | Replaces | Users |
|---|---|---|---|
| `paths.mts` | `repositoryRoot()`, the top level of the Git work tree of the working directory (K144), `isMain(import.meta.url)` | the root path that 22 modules computed and the `process.argv[1] === ...` test of 21 | every command and module with a default root |
| `process.mts` | `execute`, `run`, `Stop` | `run` of release, `run` of dependency-review, the `spawnSync` calls with `encoding` and `maxBuffer` | release, dependency-review, check-toolchain, check-cargo-downloads, check-dependency-policy, git |
| `git.mts` | `git`, `gitResult` | the `git` helper of full-run, push-gate, owner-check, kit-sync, tracked-files and target-report, and the direct `git` calls of git-hooks, check-commits, push-gate | those modules |
| `bootstrap/files.mts` | `readJson`, `writeAtomic`, `jsonText`, `writeJson` | `readJson` of dependency-state, about 25 `JSON.parse(readFileSync(...))`, the temporary-file-and-rename writes of full-run, kit-sync, target-report, tool-wrappers, git-hooks and pin-python-dependency | those modules |
| `bootstrap/digest.mts` | `digest`, `sha256`, `fileDigest` | `sha256` of check-documents and kit-check, `digest` of dependency-state and install-composer (gone in K127), the sha512 of install-npm | those modules |
| `time.mts` | `now`, `seconds`, `compactSeconds` | `now` of ci-targets and full-run, `seconds` of full-run and target-report (`1.2 s`), `seconds` of test-progress and test-hooks (`1.2s`) | those modules |
| `version.mts` | `isPrerelease`, `older`, `stableDescending` by ecosystem: semver for npm and Go, @renovatebot/pep440 for PyPI; a Composer release is outdated when it is not the latest, the rule of `latest-status` of composer outdated (K73) | `compare` of changelog, the version order of dependency-state, the sort of `highestStableRelease` of dependency-review; the unused `highestStable` is removed; changelog and the release tag order use semver directly | dependency-review, check-dependency-policy |
| `findings.mts` | `finding` | `finding` of status-table and changelog | status-table, changelog |
| `markdown.mts` | `lineBlocks`, `headings` | `cells` of checklist and `rowCells` of status-table, which read every line that starts with `|` (K130: the rows and list items of the tree), and the `## ` lines of `changelog.sections` and of the release notes (K130: the headings of the tree). Its fences, prose, links and anchors read the syntax tree of mdast-util-from-markdown with GFM and YAML front matter, and heading anchors are the slugs of github-slugger and of @mdit-vue/shared (VitePress) (K120) | checklist, status-table, changelog |
| `schema-validate.mts` | `SCHEMAS`, `readConfig`, `readJsonFile`, `parseJson`, `readConfigFindings`, `SchemaError`: the JSON boundary of kit (K158). Every JSON that a tool reads, a file or the output of a command, is validated by the strict Ajv2020 against a schema file of `scripts/kit/schema` and has the type `T` that its caller names only once ajv's type guard `ajv.compile<T>(schema)` accepts it; data that breaks the schema throws a `SchemaError` whose lines name the file or the command and the JSON Pointer of each error of ajv. A check that reports those lines as findings reads with `readConfigFindings`. `scripts/kit/kit-check.mts` is the example caller: `lockedVersion` and `installedKit` read package-lock.json and the installed package.json through `manifests.mts`, and `checkConfig` reports the errors of each config/<name>.json. The bootstrap, which runs before ajv is installed, reads a JSON object with `readJsonObject` of `bootstrap/files.mts` and checks each field itself | the read-and-validate code of `loadConfig` in checklist and in release, and every `JSON.parse(...) as T` and `readJson(...) as T` of scripts/kit (K158) | every tool that reads JSON |
| `manifests.mts` | `NpmManifest`, `NpmLock`, `ComposerManifest`, `ComposerLock` with their readers, each validated against its schema (`npm-manifest`, `npm-lock`, `composer-manifest`, `composer-lock`) | the local shapes of package.json, package-lock.json, composer.json and composer.lock in dependency-state, check-dependency-policy, toolchain-floors, release, release-consumer, kit-check and owner-check (K158) | those modules |
| `tracked-files.mts` | `checkedFiles`, `KIT_FIXTURE` | `reviewedFiles` of dependency-state and `EXCLUDED` of release | dependency-state, release |
| `target-report.mts` | `TARGET_NAME`, `FAILURE_LINES`, `logPath`, `startReport`, `treeId` | the same names in target-run, `LAST_LINES` of target-run, the target-name pattern of ci-targets, `git` of target-report | ci-targets, full-run |
| `tool-wrappers.mts` | `RELEASE_OUTPUT`, `printedRelease` | the version arguments and patterns of ruff, uv, alint, cargo-audit and govulncheck that the release installers and the probes of check-toolchain each held; since K127 mise installs those tools and only the probes and the bootstrap read them | check-toolchain, the bootstrap |
| `dependency-state.mts` | `UPDATE` | the same constant in check-dependency-policy and dependency-review | those modules |

Other duplicates removed:

- `toolchainVersions` existed twice (target-report and check-toolchain). The record of `ci-targets` now takes the releases
  of node, npm, go, rust, php and composer from `check-toolchain.toolchainVersions`, which prints `22.1.0` where target-report
  printed `v22.1.0`.
- The two `composer validate` calls of check-dependency-policy share one function.
- `cargoAuditCommand`, `govulncheckCommand` and the path of the probe in check-toolchain were three spellings of one path;
  since K127 each is the shim of mise that `toolCommand` of `mise-tools.mts` names.

Behaviors that differ between the copies and were merged (the wider or safer one is kept):

- A failed git command reports `git <arguments> exited with <status>: <standard error>` everywhere; `check-commits` names the
  git command in the message about a range that does not resolve.
- A failed command of `dependency-review` reports the whole standard error, where it reported the last three lines.
- A target name for `ci-targets` starts with a letter or a digit, as it did for `full-run`; `ci-targets` accepted `-x`, which
  make reads as an option.
- `dependency-review` and `release` coverage skip `node_modules`, `var` and `.tools` as well as the kit fixture.
- The fence scan of a changelog closes a fence by the rule of `scanFences` (the closing fence is as long as the opening one).
- install-cargo-audit and install-govulncheck ran their build through `tool-wrappers.run`, which prints the command before it
  runs and names the missing command; mise builds both since K127.

Left as it is, with the reason:

- The runner of `make -k <target>` is one: `runLogged` of target-report. `target-run.mjs` and its `runMakeTarget` are removed;
  full-run runs its targets through `runLogged` and reads a pass with `targetPassed`. The wider behavior is kept: the environment
  of a calling make is removed, only complete lines are passed on, a failed write of the log is recorded. The log of a target
  of the full run starts with the command and ends with `[report] make <target> exited with status N`, as the log of a CI report
  does (task K11-1).
- The message that a configuration file is missing, in the commands `check-commits`, `check-documents` and `owner-check`, names
  the purpose of the file; the three sentences differ.
- `kit-check` reads only the copies that `kit.copies` of the installed package names, from the disk; `trackedFiles` reads the
  Git view.
- The npm range functions stay in dependency-state: they implement npm's rules, not a general order of versions.

## Python lint (K8.4)

The Python lint was a target of one repository that ran `ruff check` and `ruff format --check` on its package. kit takes it as
`scripts/kit/lint-python.mts` and `make lint-python`: ruff runs on the checkout root with `var` excluded and with
`--config ruff.toml`, the configuration that kit copies (Lint configuration, K77), and ruff is the shim of mise at the version
that `ruff` of `mise.toml` declares (K127), so the result does not depend on the ruff configuration of a machine.
ruff keeps its cache in `var/ruff` by `cache-dir` of `ruff.toml`, ruff's own setting, which holds for every ruff run of the
repository; it wrote `.ruff_cache` at the root before, which layout S5 refuses (K147).
Every step runs after a failure of an earlier one. A missing tool fails with its fix.

The ruff pin is not in a pyproject.toml: a library that releases a wheel keeps its `Requires-Dist` free of ruff, and the
dependency review reads the `ruff` of `mise.toml` as a PyPI dependency; a newer ruff is set by hand in `mise.toml` and locked
with `make toolchain-lock`.

## Lint configuration (K77)

kit holds the lint configuration of every repository and a runner for each language (standards plan, §1 item 5). A
configuration that a tool reads from a fixed path is a file of kit that a repository holds as a copy; each runner passes it
explicitly. A rule that lives inside a manifest, which kit cannot copy, is a rule of `config/layout.kit.yml` that `make
layout-check` runs with alint, mostly a `json_schema_passes` rule with a JSON Schema of `config/`. The false greens of the
plan's verification are fixtures of the real tests `tests/source/lint-<language>-real.test.mts`, each of which fails on its
violation; every tool is the latest stable release, checked on the pins of S4.

| Language | Tools (pin) | Configuration | Runner |
|---|---|---|---|
| Python | ruff 0.17.0, vulture 2.16 (`mise.toml`) | `ruff.toml`; `lint-ruff-nested`, `lint-ruff-files`, `lint-vulture-config` (`config/pyproject.schema.json`) | `lint-python.mts`: ruff with `--config ruff.toml`; vulture at confidence 60 on the Python files of each package, from its folder |
| PHP | phpcs 4.0.4, PHPStan 2.3.1, spaze/phpstan-disallowed-calls 4.15.0, phpstan/extension-installer 1.4.3 (the Composer project `config/php-lint`) | `phpcs.xml.dist`, `phpstan.dist.neon`; `lint-composer-policy` (`config/composer.schema.json`) | `lint-php.mts`: phpcs on the PHP files of the checkout; PHPStan on each Composer package with the `vendor/autoload.php` of the package or of the nearest Composer project above it, such as the root development project of a Composer monorepo (`composer-vendor.mts`, shared with run-tests; `COMPOSER_VENDOR_DIR` names another vendor directory) |
| Rust | cargo clippy of `rust-toolchain.toml` | `lint-cargo-lints` (`config/cargo.schema.json`) | `lint-rust.mts`: `cargo clippy --workspace --all-targets --locked -- -D warnings` in each workspace |
| Go | golangci-lint 2.14.0, deadcode of golang.org/x/tools 0.52.0 (`mise.toml`) | `.golangci.yml`: staticcheck without ST1005, since an error string is a cross-port message of the spec that keeps its capitalization, and every finding reported (`max-same-issues` and `max-issues-per-linter` 0; K164) | `lint-go.mts`: golangci-lint and `deadcode -test ./...` in each module |
| TypeScript | oxlint 1.88.0 with oxlint-tsgolint 7.0.2004, knip 6.41.0, API Extractor 7.59.4 (dependencies of kit, installed with it) | `.oxlintrc.json`, `knip.json`, `config/api-extractor.kit.json` | `lint-ts.mts`: `oxlint --type-aware --deny-warnings`, knip, and API Extractor in each package with an `api-extractor.json` |
| All | — | `.editorconfig` | none: the formatters of each language enforce the same rules |

The make targets and the copies (`kit.copies`) are wired on the kit package. `toolchain-mise.mts` reads the lint tools of
`mise.toml` and `toolchain-lint.mts` the PHP lint, after the bootstrap, and `make toolchain-check` probes each installed release:
vulture, golangci-lint, deadcode (by `go version -m` of the binary that `mise which deadcode` names, since it prints no release
and its shim is mise), and phpcs and PHPStan at the releases that `config/php-lint/composer.lock` holds, in a repository that
declares PHP (`php` of config/toolchain.json or `.php-version`): every repository holds the copy, and a tool that a repository
does not declare is neither installed nor checked.

### Decisions

- **Composer policy and nested configurations by alint.** The plan named ajv for the composer.json policy schema. alint, which
  kit already pins, validates JSON, TOML and YAML against a JSON Schema (`json_schema_passes`) and queries TOML
  (`toml_path_absent`), so S1 forbids a validator of kit.
- **S2.** PSR-1 `MultipleClasses` of phpcs holds one class per file: `composer dump-autoload --optimize --strict-psr` passes a
  file whose first class matches its name and drops the others in silence (a fixture). The stubs of an extension
  (`*.stub.php`) are excluded, since gen_stub.php reads every class of an extension from one file. PHPStan runs only the
  disallowed calls (`customRulesetUsed`): `spl_autoload_register`, also through a string variable, and every method of
  `Composer\Autoload\ClassLoader`; extension-installer registers the extension, so the configuration names no path. The
  policy schema forbids `classmap` and PSR-0 and requires `autoload.psr-4` and `autoload-dev.psr-4` of a library; a php-ext
  and a project hold no classes of their own.
- **S3, Python.** TID251 bans `sys.path`, `importlib.import_module` and the loaders of a file path. ruff resolves qualified
  names statically, so `importlib.import_module("sys").path` escaped the `sys.path` ban (a fixture); an import statement
  names every module that a test needs. With `--config` ruff ignores a nested configuration, but an editor or a plain run
  applies the nearest one, so a nested `[tool.ruff]`, `ruff.toml` or `.ruff.toml` fails instead of having to extend the root.
- **Dead code.** vulture runs at its default confidence 60, which a package cannot raise. A package keeps code that only its
  consumers use by an entry of its `vulture_whitelist.py` (the format of `vulture --make-whitelist`) with its reason (S8);
  `[tool.vulture]` may only `exclude` generated code, each path with its reason. deadcode runs with `-test`, so the tests of a
  library are its roots and an exported function that no test reaches is a finding; deadcode exits 0 when it reports one, so
  its runner fails on any output. knip reads no Makefile and no path that a script passes to spawn, so the files that make
  runs are entries by the layout (K142): the node:test files of S3, the scripts of S9 under `scripts/` with the copies of
  kit, and the programs of `benchmarks/`; `@polyspec/kit`, which the Makefile includes, is an ignored dependency. A
  Makefile-run script passes and a file that nothing imports or runs still fails (a fixture). kit lints itself with the
  same configuration, in CI and as an owner check of `scripts/kit`, `tests` and the lint configurations (K142).
  knip names each ignore of its configuration that matched no issue in a configuration hint, and a consumer cannot edit
  the copy of knip.json, so the copy holds no ignore that a repository may not use (K176). It has no `ignoreBinaries`:
  no copy of kit runs a binary that knip reports, and node, git, python3 and cargo are among the global binaries that
  knip itself ignores. Each system tool that the scripts and tests of a repository run and no npm package provides, such
  as make, go, php or Apple `container`, is declared with its reason in `binaries` of `config/knip-entries.json`, as kit
  declares make, go, rustup, shasum and openssl; a declared binary passes and an undeclared one is still an unlisted
  binary (a fixture, K152). `ignoreDependencies` of knip.json names the packages that only make runs, `@polyspec/kit`,
  oxlint, oxlint-tsgolint and jscpd; lint-ts keeps each only when the package.json of the root or of a declared workspace
  declares it, which is when knip would report it unused, so a repository without them gets no hint and one that
  declares them still has them ignored (a fixture). make runs the fixture recorders of kit. knip.json is plain JSON, so
  lint-ts reads it, and knip always reads the configuration that lint-ts writes to `var/lint-ts/knip.json`. A file that make runs outside those
  patterns, such as a probe under `packages/js/test/`, is an entry that the repository declares with its reason in
  `config/knip-entries.json`, its own file with a schema of kit, never in the copy (K145): knip has no `extends`, so
  lint-ts writes knip.json with those entries after its own `node.entry` to `var/lint-ts/knip.json` and runs knip with
  `--config` on it. A declared file passes and an undeclared orphan still fails (a fixture). A nested npm project with a
  package.json of its own, such as the fixtures that the build tests of ssr compile, is a knip workspace that the
  repository declares in `workspaces` of the same file with its reason, its entries relative to its directory and each
  dependency that no JavaScript of it imports (`ignoreDependencies`, such as one that only Rust tests load) with its
  reason; lint-ts adds it to `workspaces` of the generated configuration, whose root stays knip.json (K154). knip's Svelte
  plugin compiles the `.svelte` files of a workspace that depends on svelte. Declared, its dependencies pass; as root
  entries, or undeclared, they are unlisted dependencies of the root (a fixture). A dependency of the root that no
  JavaScript imports and only a recipe of the Makefile runs, such as the template compiler that hyper installs by its URL,
  is declared with its reason in `ignoreDependencies` of the same file, which lint-ts adds after the `ignoreDependencies`
  of knip.json, since knip does not read a Makefile (K159). Declared, it passes; undeclared, it is still an unused
  dependency (a fixture). A file that is not code of this repository, such as a sample source file that a site shows and
  nothing runs or imports, or an input of the tests of a build tool that is broken on purpose, is declared by its glob,
  relative to the root, with its reason in `ignore` of the same file: neither knip nor oxlint reads it. lint-ts adds the
  glob after the `ignore` of knip.json, knip's documented option for such files (K162), and gives oxlint an
  `--ignore-pattern` for it, on the command line as for the copies of kit below (K172). Declared, it passes; an undeclared
  unused file still fails knip, and the same oxlint violation outside the declared glob still fails oxlint (fixtures).
  A test that imports the build output of its package, such as `../dist/values.js`, uses the source that tsc emits
  there: knip maps an `outDir` to its `rootDir` only through the `tsconfig.json` of the workspace or a project that it
  references, and its `paths` apply only to an import that does not resolve, so they miss a built dist. The package
  keeps the build in a tsconfig of its own (`outDir: dist`, `rootDir: src`, `composite: true`, which TypeScript project
  references require) and lists it in `references` of `tsconfig.json`, which still includes the tests; `rootDir: src`
  in `tsconfig.json` itself would fail tsc on the tests (TS6059). Referenced, the export passes and tsc checks the
  tests; without the reference it is an unused export (a fixture, K175).
- **Rust.** Lints live in each Cargo.toml. A workspace denies `unsafe_code`, which catches `transmute_copy` (a fixture), and
  `clippy::allow_attributes_without_reason`, so unsafe code is allowed only at an FFI site that names its reason; without it
  a crate-level `#![allow(unsafe_code)]` passes in silence. Cargo applies the lints only to a member that says
  `lints.workspace = true`, so every package must, and a package outside a workspace fails.
- **Go.** gomoddirectives forbids every `replace`: the modules of a repository resolve each other through its `go.work`, and
  a released go.mod never holds a replace that its consumers would not see. It also forbids a toolchain line, since `go mod
  tidy` removes one equal to the go directive. forbidigo is left out: no standard names a Go API to forbid, and its default
  bans `fmt.Print` of every CLI.
- **TypeScript.** typescript-eslint does not support TypeScript 7, so the type-aware rules are oxlint-tsgolint's. They
  apply to TypeScript files only, an `overrides` entry of `.oxlintrc.json` for `**/*.{ts,mts,cts,tsx}`, as
  typescript-eslint's `disableTypeChecked` turns them off for JavaScript: in a plain .js or .mjs file every untyped
  parameter is `any`, so they reported only that the file is JavaScript. An override cannot enable a category, so the base
  turns off the type-aware rules of correctness and the override enables them; the rules without types apply to every
  file. An untyped member access passes in a .mjs file and fails in a .mts file, and a `debugger` in the .mjs file still
  fails (a fixture, K170).
  `no-floating-promises` takes the option of typescript-eslint for node:test, `allowForKnownSafeCalls` with `test`,
  `describe`, `it`, `suite`, `skip`, `only` and `todo` of the package `node:test` (K138): a top-level registration returns a
  promise that the runner awaits, and the rule failed each one (516 in crudui), while an un-awaited `fetch` in a test file
  still fails (a fixture). The subtest `t.test` shares the name `test`; the runner of Node 26 waits for it. A consumer's
  tsconfig covers its own scripts, not the copies of kit in `scripts/kit`, so oxlint-tsgolint would check those copies
  outside the project, without the types of node, where every `node:*` import is `any` (K150). In a consumer lint-ts
  therefore gives oxlint one `--ignore-pattern` for each file of `kit.copies` of the installed package, the record that
  kit-sync writes and kit-check compares byte for byte: kit lints its copies with its own tsconfig. A pattern of a
  configuration file is rooted at the directory of that file, so the patterns go on the command line. A violation planted
  in a copy passes the lint of the fixture consumer, the same violation in its own script fails, and an installed kit that
  is not the locked version fails as kit-check does (K157). The escape
  hatches from the types fail (K155): `ban-ts-comment` forbids `@ts-ignore` and `@ts-nocheck` and requires a description of
  `@ts-expect-error`, which tsc itself fails once nothing errs, and `no-explicit-any` and `no-unnecessary-type-assertion`
  are on; a fixture plants each one. `oxc/number-arg-out-of-range` is off (K161): it allows 0 to 20 fraction digits
  for `toFixed` and `toExponential` and a precision of 1 to 21, the limits before ES2018, which raised them to 100
  (ECMA-262 `Number.prototype.toExponential`), so it failed `toExponential(25)`; oxlint 1.88.0, the latest, and oxc main
  keep the old limits, and no oxc issue reports it. A fixture with `toExponential(25)` passes. No any flows into a typed place (K157):
  `no-unsafe-argument`, `no-unsafe-assignment`, `no-unsafe-call`, `no-unsafe-member-access` and `no-unsafe-return` fail
  an any value as an argument, an assignment, a callee, the object of a member access or a return value, and
  `no-unsafe-type-assertion` fails a type assertion that narrows; a fixture plants each one. JSON is read through a schema
  (K158) and an unknown value is narrowed by a check. A file outside the TypeScript project has no types, so each call of an
  import there is an unsafe call of an error type: the tsconfig of a repository covers every TypeScript file that lint-ts
  lints, its scripts too, and leaves out the copies of kit. No non-null assertion (K156):
  `no-non-null-assertion` fails `!`; kit reads a value that it knows to be there with `present` of `scripts/kit/present.mts`,
  which throws with the expression that it expected, and its tests with `known` of `tests/kit/known.mts`, which asserts it. API
  Extractor reads the `.d.ts` that tsc 7 writes with its bundled TypeScript 5.9.3. `ae-undocumented` fires only through the
  API report, so the base configuration enables it, and an undocumented export with the report off passes (a fixture);
  `ae-undocumented` and `ae-forgotten-export` are errors, not lines of the report. A package commits its report
  (`etc/<package>.api.md`). `ae-missing-release-tag` is off (K139): release tags (`@public`, `@beta`, `@alpha`,
  `@internal`) choose what the trimmed `.d.ts` rollups keep, and polyspec writes no rollup and tags no export, so the
  message failed every export of every package (187 in crudui) for a tag that changes nothing.
- **Root files.** The layout allows `ruff.toml`, `phpcs.xml.dist`, `phpstan.dist.neon`, `.golangci.yml`, `.oxlintrc.json`,
  `knip.json`, `.editorconfig`, the Rust workspace (`Cargo.toml`, `Cargo.lock`), the Go workspace (`go.work`,
  `go.work.sum`) and the development project of a Composer monorepo (`composer.json`, `composer.lock`; K167) at the root.

### Limitations

- ruff cannot see `__import__("sys").path` or `getattr(sys, "path")`: the module and the attribute are chosen at run time. No
  ruff rule covers them.
- The reason of a vulture whitelist entry and of an `exclude` path is a comment that review checks; no tool reads it.
- The moderate advisory GHSA-hp3w-g68c-fv3c (npm advisory 1241202) of sprintf-js 1.0.3, which API Extractor pulls in through
  @rushstack/ts-command-line and argparse 1.0.10, covers every release of sprintf-js. kit's own dependency policy accepts it
  (Accepted advisories, K77).

## Accepted advisories (K77)

An advisory that no release fixes failed every dependency gate, and the only way past it was to hide it. An entry of
`advisoryExceptions` of `config/dependency-policy.json` accepts one advisory of one package of one lock, with its `reason` and
its `removalCondition`; `advisory` is the identifier that the review records (npm audit names an advisory by its number).

- `make dependency-review` and `make dependency-policy-check` no longer fail on an accepted advisory; each prints it as accepted,
  with its reason and removal condition, and the review record keeps it. An advisory without an entry fails both as before.
- An entry whose advisory the review of its lock did not find is stale and fails both, as a stale version exception does.
  An entry without its reason or removal condition fails the gate and accepts nothing.
- `make dependency-review UPDATE=1` updates no package for an accepted advisory.
- kit reviews its own `package-lock.json` (`config/dependency-policy.json`, `config/dependency-review.json`). Its one entry
  accepts sprintf-js: no release fixes the advisory, and sprintf-js formats only the help and error texts of the api-extractor
  command, which `make lint-ts` runs with fixed arguments. It is removed when a release of sprintf-js fixes the advisory or API
  Extractor no longer depends on argparse; the review then reports the entry as stale.

A Composer monorepo has one development composer.json at the root, which `composerPlatforms` names and which requires its
published packages through `path` repositories, and one root lock; a published package commits no lock and no vendor/ (K168).
The first-party requirements of the root are its `require` and `require-dev` and the `require` of each package that a path
repository provides, which the root lock records as a path dist entry; their versions are those of the root lock. The review
runs `composer outdated --locked --all --format=json` once in the directory of each root and keeps those packages:
`--direct` counted the requirements of the root alone, so a requirement of a published package, such as symfony/console,
dropped out of the review. A library that only a third-party package requires is not reviewed. The platform and lock checks
apply to the root, and a published manifest is validated with `--no-check-lock`. `UPDATE=1` raises a requirement of a
published package with `composer require --no-update` in its directory and `composer update --with-dependencies` at the root.

## Consumer install of the release archives (K5.4)

`scripts/kit/release-consumer.mts install TAG` installs all archives of a tag together in clean consumer projects outside the
repository and runs a smoke command for each package; `lock TAG` writes the manifests and locks of those projects. Files:
`scripts/kit/release-consumer.mts`, `scripts/kit/release-consumer-config.mts` (the rules of the configuration, called by
`release.mts` `loadConfig`), the section `consumers` of `schema/release.schema.json`, and the make targets `release-consumer` and
`release-consumer-lock`. The base is template for the install and the lock, with the archive rule of crudui, the manifest rule of
crudui and ordered-json and the smoke checks of all five.

### `consumers` of `config/release.json`

```json
"consumers": {
  "npm": {
    "directory": "tests/release-consumer/npm",
    "smoke": { "@scope/lib": ["node", "-e", "require('@scope/lib/package.json')"] }
  },
  "composer": {
    "directory": "tests/release-consumer/composer",
    "smoke": { "vendor/lib": ["php", "-r", "require 'vendor/autoload.php';"] }
  }
}
```

`directory` holds the committed manifest (`package.json`, `composer.json`) and lock (`package-lock.json`, `composer.lock`) of the
project. `smoke` maps each package that the project installs to its command, an array of strings that runs without a shell in
the installed project. Every package of `packages` of a kind needs the project of that kind when `consumers` exists; a smoke key
is a package of that kind. A package that is not a key is copied into the project and not installed (for example a Composer
package of the type `php-ext`, which Composer does not install). The manifest files are in `notReleased` of the repository.

`composer.polyspec` (optional, K140) names the polyspec dependencies of the Composer project, each by its entry of
`config/release-assets.json`: the release zip of each, which must hold its sha256 (`make release-assets-fetch` downloads it),
lies in the `artifacts` repository of the project beside the zips of the tag, so the project requires a polyspec dependency
at its version and installs it from its released archive, as a consumer does, instead of declaring it in an inline package
repository. It is the counterpart of `wheel.polyspec`. The lock keeps the shasum of such a zip, which no run builds again,
and `make release-tools` downloads the zips when the list is set.

### Procedure

1. `make release-assets TAG=vX.Y.Z` builds the archives. `make release-consumer-lock TAG=vX.Y.Z` (ONLINE) copies each project
   into a temporary directory outside the repository with all archives of its kind, sets each installed package in the manifest
   (`"file:<archive>"` for npm, the version for Composer), runs `npm install --package-lock-only` or `composer update
   --no-install`, removes the hashes of the archives from the lock and writes the manifest and the lock back atomically. The
   archives are built in the run that installs them, so an npm entry has no `integrity` and a Composer entry an empty `shasum`;
   a registry package keeps both. A second run writes the same bytes. Run it on the release commit before the tag is pushed
   (a local tag is enough for `release-assets`).
2. `make release-consumer TAG=vX.Y.Z` requires `var/release/assets` to hold exactly the archives of the version, requires the
   manifest and the lock to name them (`dependencies.<name>` is `file:<archive>`, the lock entry has the version and the same
   `resolved`; `require.<name>` is the version, the lock entry has the version and the url `artifacts/<archive>`, and the
   manifest has the `artifact` repository `artifacts`), copies the project into a new temporary directory outside the
   repository, runs `npm ci` or `composer install`, requires every installed package at the version of the tag and runs its
   smoke command in the project. A difference names the expected and the actual value and the command that fixes it.
3. The environment has empty `npm_config_cache`, `COMPOSER_HOME` and `COMPOSER_CACHE_DIR` in the temporary directory, no
   `npm_config_offline`, `COMPOSER_DISABLE_NETWORK`, `COMPOSER` or `COMPOSER_VENDOR_DIR`, and each npm scope of this repository
   points at the unreachable registry `http://127.0.0.1:9/`. A package that a lock pins from a registry is downloaded with its
   version and integrity: that is installation, not a registry query, so the install is no offline check. Only `lock` resolves
   ranges. A Go module tag has no archive and nothing to install.

### Merged behaviors

| Behavior | Source | Merged form |
|---|---|---|
| Install in a temporary directory outside the repository with empty npm and Composer caches | template, crudui, hyper, ordered-json, orm | kept; the directory must be outside the checkout, checked by real path |
| npm project: `file:<archive>` dependencies, committed lock, `npm ci` with the scope of the repository at an unreachable registry | all | kept; the scopes are read from the names of `packages` |
| Composer project: `artifact` repository, Packagist disabled, committed lock, `composer install` | all | kept; the directory of the zips is `artifacts` (template) |
| An archive of the repository is locked by name and version only: no `integrity`, an empty `shasum` | all | kept; found by the archive name in `resolved` and in the url |
| The offline settings of the recipes are removed for the install | crudui, hyper, ordered-json, orm (environment); template (`--offline=false`) | the environment variables are removed |
| `--ignore-scripts --no-audit --no-fund` and `--no-plugins --no-scripts` | template, crudui, orm | kept; `--fetch-retries=0` (crudui, hyper) too, so an unreachable registry fails at once |
| The installed version of every package equals the version of the tag | crudui, template | kept for every smoke key, npm from `node_modules` and Composer from `installed.json` |
| `lock` writes the manifests for the version of the tree | crudui, ordered-json | kept; the committed manifest keeps its other fields |
| A smoke command per package: a module load, a class load, a build | template, orm, ordered-json, hyper | the command comes from the configuration |
| A manifest or lock that names other archives fails and names the lock command | template, hyper, ordered-json | kept, with the expected and the actual value of each difference |
| A Go module tag installs nothing | crudui | kept |

### Dropped behaviors

| Behavior | Source | Reason |
|---|---|---|
| Building the archives inside the install (`packTree`, `buildAssets`, `git stash create` of the working tree) | template, crudui, hyper, ordered-json, orm | `release.mts assets` builds the archives of a tag; the install reads `var/release/assets`, so a check never installs an archive that no release builds |
| Downloading the release archives of other repositories into the project | orm, hyper | kit names no repository; a dependency of another repository is pinned in the lock by URL, integrity or shasum, and the install downloads it as any registry package |
| `--allow-remote` settings of npm for a URL dependency | hyper | a workaround of one npm release (npm/cli#9818); no repository setting is merged, so a lock with a remote tarball needs an npm that accepts it |
| `--workspaces=false` | crudui | the project is outside every workspace |
| The sample application that the project builds, and `composer show --available` of a `php-ext` package | hyper, template | a smoke command runs in the installed project and reads no file of the repository; a check of such a package belongs to the package |
| The Python test class `InstallFromAssets` and `install_fixtures.py` | ordered-json | replaced by the Node tool |

### Limitations

- `smoke` does not have to list every package: a package without a key is copied and not installed or checked.
- The locks hold the dependencies that the archives declared when `lock` ran; a changed dependency needs `lock` again.

## Release archives of other repositories (K140)

A repository that uses a release archive of another polyspec repository, such as the php and php-ext zips of a template
release or the Composer zips of orm and ordered-json, pins it in `config/release-assets.json` (schema
`scripts/kit/schema/release-assets.schema.json`, checked by `make kit-check`) instead of a downloader of its own:

```json
{
  "schema": 1,
  "assets": [
    { "name": "codec-php", "version": "0.0.14", "url": "https://github.com/polyspec/codec/releases/download/v{version}/polyspec-codec-php-{version}.zip",
      "sha256": "<64 hex digits>", "directory": "var/composer-artifacts", "unpack": "var/products/codec" }
  ]
}
```

- The version is declared once, in the entry; `{version}` of `url` stands for it, and no other placeholder is accepted. A
  Makefile that needs the tag reads it: `$(shell node $(KIT)/release-assets.$(KIT_EXT) version codec-php)`.
- The destination is `directory` and the last path segment of the URL. `directory` and `unpack` are directories under `var/`
  without `..`, and Git must ignore them (`git check-ignore`); a name or a destination that two entries share is refused.
- `make release-assets-fetch` (ONLINE, an install step) downloads with the fetch of Node each archive whose destination
  does not hold its sha256, refuses a download with another sha256 and writes nothing then, and writes through
  `<destination>.next-<pid>` and a rename. An entry with `unpack` is a zip that `unzip` extracts into a temporary directory
  beside `unpack`, which replaces it with a rename; the file `.release-asset.sha256` in it records the archive, so the same
  archive is not extracted again.
- `consumers.composer.polyspec` of `config/release.json` names entries whose zips the Composer consumer project holds (Consumer
  install of the release archives).
- `tests/kit/release-assets.test.mts` runs the tool with a stub of fetch and a zip of the machine's `zip`.

## Release proof (K5.5)

`scripts/kit/release-proof.mts TAG` (`make release-proof TAG=vX.Y.Z`, ONLINE) proves a released tag from outside the
repository. The release workflow (`workflows/release.yml`) runs it on the draft after `release-publish` in the same job; a failed proof
fails that run and the release stays a draft. A developer may run it for any released tag. It is no offline check.

### Release workflow, tools and draft (K38)

- `workflows/release.yml` is the source of the copy `.github/workflows/release.yml` (`kit.copies` of package.json): `make kit-sync`
  writes it from the installed package, and `make kit-check` fails on a difference.
- `make release-prepare` runs the preparation that a repository's release needs before release-tools, such as the checkout of a
  sibling release: kit.mk declares it as a double-colon target with no work, and a repository adds a `release-prepare::` rule
  to its Makefile (K132). The vendored release workflow runs it after install-packages.
- `make release-tools` (`scripts/kit/release-tools.mts`) derives the install-tools names from config/release.json: npm for an npm package or
  consumer, composer, python and pythonBackend for a wheel, go for a Go module. A git-tag proof needs Rust: release-tools runs
  `rustup toolchain install --no-self-update` in the checkout, which reads the channel of rust-toolchain.toml, and then
  `check-toolchain rust` checks rustc against that channel. A git-tag proof without rust-toolchain.toml fails with the file name.
- `release-publish` creates the release as a draft and records its id in `var/release/<tag>.json`. `release-proof` and
  `release-undraft` read the draft by that id (`repos/O/R/releases/<id>`), never by searching the list of releases for its tag: the
  list shows a new draft only after a while (the 0.0.38 run failed three seconds after the create), and the tag does not address
  a draft. A missing record fails with `var/release/<tag>.json is missing; make release-publish writes it`. `release-proof`
  downloads each asset by its id; `release-undraft` makes the release public by its id and changes nothing for a public release.
  The release of another repository that a wheel lock names is public and is still found by its tag. A draft of an
  earlier run is replaced; a public release is never replaced. No tool of the five
repositories had a counterpart; the install of the archives is `installConsumers` of K5.4. It stops at the first failed step and
prints `✔ <what>` for each step that passed. A failure names the command with its status and error, or the expected and the
actual value.

For a tag `vX.Y.Z`:

1. `gh release view TAG --repo HOST/OWNER/REPO --json assets` (from `repositoryUrl`) lists exactly the archives that
   `packages` declares for the version; the failure names the missing and the unexpected names.
2. `gh release download` writes the assets into a temporary directory; `installConsumers` installs them in clean npm and
   Composer projects with the committed manifests and locks of the checkout and runs the smoke commands of `consumers` (run it
   in a checkout of the tag, whose consumer projects name the archives of the version).
3. Each manifest with the mode `git-tag` installs from the tag in a temporary directory, with the command of
   `proof.gitTag`: a Rust crate as the git dependency `<name> = { git = "<repositoryUrl>", tag = "TAG" }` of a temporary crate
   with its own target directory and the smoke command (for example `cargo check`) in that crate. A Python package is not a
   git-tag manifest: it is a `wheel` package whose wheel is an archive of step 2 (K29).
4. Each Go module of `goModules` has the tag `<directory>/vX.Y.Z` (the module at the root `vX.Y.Z`) on the remote
   (`git ls-remote --tags <repositoryUrl>`) and `go list -m <module>@vX.Y.Z` with `GOFLAGS=-mod=mod`, `GOPROXY=direct` and an empty
   `GOPATH` prints `<module> vX.Y.Z`.

A tag `<directory>/vX.Y.Z` releases that Go module alone: the release must list no archive and only step 4 runs for that module.

### `proof` of `config/release.json`

```json
"proof": {
  "gitTag": {
    "rust/Cargo.toml": { "kind": "rust", "name": "name", "smoke": ["cargo", "check"] }
  }
}
```

Every manifest with the mode `git-tag` in `manifests` needs an entry when `proof` exists, and `release-proof` fails without one.
`kind` is `rust` for a `Cargo.toml`; a `pyproject.toml` with `kind` `python` is refused. `smoke` is an array of strings that runs without a
shell. The smoke commands of the archives are `consumers` of K5.4.

### Limitations

- The proof stops at the first failed step.
- The Rust step uses the `CARGO_HOME` of the machine for the registry crates that the crate needs; only the crate and its target
  directory are new. The Go step uses a new `GOPATH`, so it downloads the module.
- The install of the archives reads the manifests and locks of the checkout; a checkout of another version fails at the first
  difference, naming `make release-consumer-lock`.

## Wheel packages (K29)

A package of kind `wheel` is a Python package, declared in `packages` with its directory and its project name (`name`), and its
`pyproject.toml` is an `archive` manifest. Its archive is the PEP 427 wheel `<distribution>-<version>-py3-none-any.whl`; the
distribution escapes each run of characters other than word characters and dots as `_`, so `kit-fixture` at `0.0.1` is
`kit_fixture-0.0.1-py3-none-any.whl`, the name pip parses.

- `release-assets` builds the wheel from a copy of the directory at the tagged commit (`git archive`) with
  `var/tools/mise/shims/python3 -m pip wheel --no-deps --no-index --no-cache-dir --find-links var/tools/wheels -w <output> <source>`,
  with `SOURCE_DATE_EPOCH` set to the time of the commit. `--no-index` makes the directory the only source, so no build reads the network.
- The build backend is pinned in `pythonBackend` of `config/toolchain.json`, its one declaration, since it is a tool pin
  (K166; `buildBackend` of `config/release.json` is gone): `requirement` is the exact requirement of the backend
  (`setuptools==84.0.0`, which the `[build-system] requires` of the pyproject must equal) and `sha256` is the digest of its wheel
  from the PyPI release. A config/release.json with a wheel package or the wheel consumer and no `pythonBackend` fails
  `make kit-check` and the release with the fix. `make install-tools` and `make release-backend` (ONLINE) download it with
  `pip download --no-deps --only-binary :all: --require-hashes` into `var/tools/wheels` from a requirement file that holds the digest;
  `release-assets` checks the digest of the file before each build and refuses another. The download is the one network step of a
  wheel package, and it runs before a release.
- `release-assets` checks each `Requires-Dist` of a wheel against its lock (K49): a plain `name==version`, a polyspec release
  reference or a sibling of the release (K52); any other form fails with the line and its form. `release-versions` requires the `version` of
  `[project]` in the pyproject.toml, as for every archive manifest.
- `release-consumer` installs a wheel into a clean virtual environment of `var/tools/mise/shims/python3`: first its lock (K49), then the
  wheel with `pip install --no-input --disable-pip-version-check --no-index --require-hashes --no-deps -r <requirements>`, the
  requirement file naming the wheel of the run with the sha256 of its file. Then `pip check` must pass, the version that `pip show`
  prints is checked and the smoke command of `consumers.wheel` runs.

```json
"consumers": { "wheel": { "smoke": { "kit-fixture": ["python", "-c", "import kit_fixture"] }, "lock": { "kit-fixture": "packages/fixture-python/pylock.wheel.toml" }, "polyspec": {} } }
```

config/toolchain.json:

```json
"pythonBackend": { "requirement": "setuptools==84.0.0", "sha256": "<sha256 of setuptools-84.0.0-py3-none-any.whl>" }
```

## Wheel dependencies (K49)

A wheel's `Requires-Dist` takes one of three forms: a registry pin, a polyspec reference and a sibling (K52, below). A registry
package is pinned as `name==version`. A polyspec package is a PEP 508 direct reference to its release asset, with the sha256 of that
asset as the fragment:

    name @ https://github.com/polyspec/<repo>/releases/download/v<version>/<file>#sha256=<hex>

`<file>` is the PEP 427 name of the wheel of `name` at `<version>`, and the name and the version in the URL are the requirement's.
The repository comes from `consumers.wheel.polyspec` of config/release.json, a map from the distribution name to its repository URL,
never from the name. Every other form (another host, a git URL, a branch, an extra, a range or a marker) is refused, and the refusal
names the requirement. A name that `consumers.wheel.polyspec` does not declare is refused too.

Each wheel package declares one PEP 751 lock in `consumers.wheel.lock` (`pylock.toml` or `pylock.<name>.toml`). The lock is a superset:
it holds every dependency, transitive ones included. A registry package has the version and the sha256 of its files; a polyspec
package is an `archive` entry with the same URL and sha256 as its reference. `release-assets` checks these offline, from the tagged
commit: the lock is read by the K36 reader; a source other than registry or archive is refused; each `Requires-Dist` is in the lock with
the same version (registry) or the same URL and sha256 (polyspec); the fragment equals the sha256 of the lock; each archive is a release
asset of its declared repository at its version. Nothing here reads the network.

`release-consumer install` renders the lock with `lockRequirements` (`scripts/kit/wheel-dependencies.mts`) into a requirement file of
hashes: `name==version --hash=sha256:…` for each file of a registry package and `name @ <url> --hash=sha256:…` for each archive. The
pip of the checkout installs it into the venv of `makeVenv`:

    var/tools/mise/shims/python3 -m pip --python <venv>/bin/python install --no-input --disable-pip-version-check --require-hashes --no-deps --only-binary :all: -r <dependencies>

The wheel follows with `--no-index --require-hashes --no-deps`, then `pip --python <venv>/bin/python check` must exit 0 (an incomplete
lock fails there), then the smoke command runs. pip's own reading of `pylock.toml` is not used (see the findings). The install reaches
PyPI and the release assets, so it runs online only, in `release-proof`. `release-proof` step 2 downloads each polyspec archive from the
release of its version in its declared repository, and its sha256 must equal the sha256 that the lock holds.

Findings, measured with pip 26.2.1 and the pinned Python 3.14.8 (`tests/source/wheel-dependencies-real.test.mts` repeats the cases):

- `pip install -r pylock.toml` reads the lock as a requirement source and prints `WARNING: Using pylock.toml as a requirements source is
  an experimental feature. It may be removed/changed in a future release without prior warning.` The lock is therefore rendered.
- `pip --python <venv>/bin/python check` works in a venv that has no pip. A missing dependency prints `kit-app 0.0.1 requires six, which
  is not installed.` and exits 1; a version mismatch prints `kit-app 0.0.1 has requirement kit-reg==1.0.0, but you have kit-reg 0.0.1.`
  and exits 1; a complete install prints `No broken requirements found.` and exits 0.
- Local copy (the case of limepie, which installs dependency wheels from downloaded files): the dependency wheels installed from local
  files with the same bytes (`--require-hashes --no-deps`), then the wheel with `--no-deps`, then `pip check`, printed
  `No broken requirements found.` and exited 0. `pip check` compares versions only, so it does not reject a direct-URL requirement
  that a local file satisfies.
- The resolver is not used by the install (`--no-deps`). Resolving the wheel with its dependencies reads each direct-URL requirement
  before it accepts an installed copy. For a `file:` URL of the same version it printed `Processing .../kit_lib-0.0.1-py3-none-any.whl`
  and `kit-lib is already installed with the same version as the provided wheel. Use --force-reinstall to force an installation of
  the wheel.` and exited 0. For a remote URL it fetches first (`Collecting kit-lib @ https://...`); a URL that does not answer fails with
  `ERROR: HTTP error 404 while getting https://...`. A consumer that resolves dependencies therefore downloads each polyspec archive.

The tests: `tests/kit/wheel-dependencies.test.mts` (the forms, the refusals with their messages, the lock form, the rendered
requirements), `tests/kit/release-wheel.test.mts` (the same checks through `release-assets`, the consumer declaration),
`tests/kit/release-proof.test.mts` (the digest of each polyspec archive), and `tests/source/wheel-dependencies-real.test.mts` (the real
pip: the GREEN install of a wheel with a registry and a polyspec dependency, the incomplete lock, the local copy and the resolver).

## Sibling wheels (K52)

A sibling is another wheel package of the same config/release.json. A wheel's `Requires-Dist` may name a sibling by a direct
reference to the sibling's asset of the same release, without a hash fragment:

    name @ <repositoryUrl>/releases/download/v<version>/<file>

The reference is accepted only when every condition holds: `name` is a sibling; the URL is under `<repositoryUrl>/releases/download/v<version>/`
of config/release.json; `<version>` is the version of the release that is checked; and `<file>` is `wheelName(name, version)`, the PEP 427
name of the sibling's wheel. Each failure has its own message, and the refusals are: a sibling with a `#sha256` fragment, a sibling named
`name==version`, a sibling at another version, a sibling URL under another repository, a file that is not the wheel name of its version,
and a lock of the wheel that holds a sibling (the lock never holds one, whatever its form). Every other polyspec reference still needs its
sha256 fragment (K49).

The siblings are derived from `packages` (`siblingsOf`, scripts/kit/wheel-dependencies.mts): the other wheel packages of the configuration,
not a second declaration. Reason: the wheel packages of one config/release.json are released by one tag from one repository, so a second
list of them could only disagree with `packages`. `consumers.wheel.polyspec` names repositories of other repositories, so it refuses a
wheel package of this configuration (`consumers.wheel.polyspec.<name> names the wheel package <name> of this repository`).

A sibling's sha256 is known only after the release builds it: SOURCE_DATE_EPOCH is the time of the release commit, so the sha256 of a
wheel is not in the tree before the build. For this reason the lock of the wheel never holds a sibling, and the reference has no hash.

`release-proof` step 3 proves the sibling online, from the release that GitHub publishes (scripts/kit/release-proof.mts, `proveWheels`):
1. the file of each wheel of the release, downloaded, has the sha256 that GitHub lists for its asset (the `digest` of the release
   listing, `sha256:<hex>`); a release that lists no digest for a wheel fails the proof;
2. each sibling that a wheel's METADATA names is exactly the URL of the published asset of that sibling (`browser_download_url`),
   and the release lists that asset.

Then the wheels of the release install together in one `pip install --no-index --require-hashes --no-deps` command from their files
(`installWheelFiles` of release-consumer.mts, which already installs every wheel package of the configuration together). `pip check`
passes and each smoke command runs. The archives keep their own checks: the digest check is added for wheels, because a release that
was published before the listing carried a digest must still prove.

A consumer installs a sibling as it installs any polyspec wheel (K49): its own lock names the sibling as an `archive` entry with its URL and
its sha256, which is the hash of the published asset. The lock of the wheel that requires the sibling does not name it.

Findings for the sibling reference, measured with the pip of the checkout (`var/tools/python-build`, pip 26.2.1, Python 3.14.8) on two
hand-built wheels whose `kit-gen` requires `kit-val @ <URL>` (`tests/source/wheel-sibling-real.test.mts` repeats the file case):

- `pip install --no-deps` of both wheels from their local files, with the hashes, installs them and `pip check` prints
  `No broken requirements found.` and exits 0. pip never reads `Requires-Dist` with `--no-deps`.
- With dependencies resolved and `kit-val` also given as a local file in the same command, pip does not take the local file for the
  reference. It prints `Collecting kit-val @ <URL>` and fetches the URL; when the URL serves the same bytes, pip prints
  `ERROR: Cannot install kit-val 0.0.1 (from <local file>) and kit-gen==0.0.1 because these package versions have conflicting
  dependencies` and exits 1. The local file and the reference are two candidates, and the resolver reports a conflict, not a choice.
- With dependencies resolved and `kit-val` not given, pip fetches the URL and installs from what it downloads (exit 0 when the URL serves
  the file). When the URL does not answer, the fetch fails with `connection-failed` after its retries (exit 1). When the reference names a
  file that does not exist, pip prints `Processing <path> (from kit-gen==0.0.1)` and fails with `No such file or directory` (exit 1).
- An installed copy from a local file does not satisfy the reference: after `kit-val` was installed from its file, a resolution of `kit-gen`
  with dependencies fetched the URL again.

The consequence is the design above: the proof installs with `--no-deps` from the local files, and it proves that the reference equals the
published URL, so a consumer that resolves dependencies fetches the asset that the release publishes.

The tests: `tests/kit/wheel-sibling.test.mts` (the sibling forms and refusals, the lock, the consumer declaration, `siblingLinks`),
`tests/kit/release-wheel.test.mts` (the same refusals through `release-assets`), `tests/kit/release-proof.test.mts` (the wheel digest, the
sibling URL, one install of the wheels), and `tests/source/wheel-sibling-real.test.mts` (the real pip: the `--no-deps` install with pip
check, and the resolution that reads the reference and not the local wheel).

## Language parity (K33)

`scripts/kit/parity.mts` checks that every implementation of a repository holds the same units. `config/parity.json` declares
the implementations, which is the one source of the language set of the repository, the profiles that group them, and the
units. The declaration holds no state such as done or planned: the checker takes every fact from the tree.

- It runs the binding of each suite and feature in each implementation itself and keeps an in-memory ledger of the runs and
  of the cases and test ids that each run reported. It reads no saved report.
- It reads the public symbols of each implementation with the standard tool of its ecosystem (go/packages, API Extractor,
  nikic/php-parser, Python's ast, rustdoc JSON). It reads no committed snapshot.
- It reads the error codes from the generated artifact of each implementation.

A repository with several implementations of one spec declares `config/parity.json`, runs `parity-declarations-check` among its
check targets and `parity-check` in its CI, both before a push lands.

### Trust boundary

The checker trusts three inputs that it does not produce itself. Other checks close each one:

- **The tool of each symbol extractor** (go/packages, API Extractor, nikic/php-parser, ast, rustdoc). The checker runs it
  on the source and takes its public symbols as they are; the extractor programs of kit only list what the tool gives.
- **The generated error-code artifacts.** The repository's generator check regenerates them from the catalog and fails on a
  difference. That check must also run before `parity-check`. The parity check compares the committed artifacts with the
  catalog, and it does not regenerate them.
- **The output of each native tool** (node:test, vitest, go test, cargo test, unittest and PHPUnit). A binding's test prints
  nothing for the check: the outcome of each case is the tool's own report of that test. go, node and vitest frame their
  events: go writes the output of a test inside the `Output` field of its JSON events, which `test-output.mts` reads; node
  reports its events to `parity-node-reporter.mts`, a node:test reporter of kit; and vitest writes its JSON report to a file. cargo, unittest and PHPUnit do not frame theirs, so a test can print a line that
  reads as a result on the same stream: `test <name> ... ok` on the standard output of cargo, a `... ok` line on the standard
  error of unittest, or an echoed `##teamcity[` message of PHPUnit. For those three the checker trusts the tool to print only
  its own results, and review enforces it; no check of the output closes it.

Make targets: `parity-check` runs the bindings and the symbol extractors and checks every rule. `parity-declarations-check`
checks every rule except R1, R3 and R11 and runs nothing. Both are offline, print a line for each step and each finding, and exit with 1 when a finding exists.

| Module | Concern |
|---|---|
| `parity.mts` | the command, and the order of the rules |
| `parity-declaration.mts` | the schema, the references of the declaration, and the finding |
| `parity-units.mts` | R1, R2, R4, R5, R6, R8, R11 |
| `parity-ledger.mts` | R3: the runs of the bindings and the ledger |
| `parity-runners.mts` | the native command of each runner and the outcome of each case in its output |
| `parity-node-reporter.mts` | the node:test reporter of the node runner: each test with its enclosing suites, as JSON lines |
| `parity-symbols.mts` | the symbol extractors of R1 and R11, and the walk of rustdoc JSON |
| `install-symbols.mts` | the build of the go extractor and the install of the php extractor into var/tools |
| `symbols/` | the extractor programs: `go/` (go/packages), `php/` (nikic/php-parser), `python.py` (ast) |
| `test-output.mts` | the parsers of the output of go, cargo, unittest and PHPUnit, shared with run-tests; node:test reports through `parity-node-reporter.mts`, and the TAP reader of K125 is removed |
| `parity-errors.mts` | R7 |
| `parity-text.mts` | R9, R10 |

### Rules

Every finding fails the check. A finding names its rule, unit, implementation and place (a file, or file:line).

| Rule | Finding |
|---|---|
| `declaration` | The declaration has one of these defects. No other rule runs on such a declaration. <br>- It breaks `scripts/kit/schema/parity.schema.json`. <br>- It names a missing file, or an unknown implementation or profile. <br>- A profile narrower than every implementation has no `reason`, cites no `spec` anchor, or only one unit uses it, or a profile of every implementation cites one. <br>- A `spec` anchor of a profile or a `nativeOnly` entry does not resolve. <br>- An implementation is in no profile, or a root is the whole repository. <br>- A binding belongs to an implementation outside the unit's profile. <br>- A go or cargo suite binding has no `symbol`, or a go symbol does not match `^Test\w*$`. <br>- A feature binding has no `id` or has a `symbol`, a suite binding has an `id`, or a feature unit has a `file`, `cases` or `admit`. <br>- A case name repeats, holds whitespace, or holds `/` in a unit with a go binding. <br>- A `nativeOnly` entry names an implementation that does not exist or that declares no `symbols`. <br>- The `entry` of `symbols` does not exist. <br>- An exclusion names a pair that the unit binds. <br>- A pattern has no group. <br>- The catalog pattern does not read a line of the catalog, or a catalog or artifact pattern reads no code. <br>- A `support` glob selects no test file of its implementation (of its runner's convention, its `tests` or its runner's `testPatterns`) and no file named like a test, a support file lies outside the `roots` of its implementation, a Go support file declares a function that `go test` runs, a cargo support file holds a test attribute, or the test of a binding matches the `support` of its implementation. <br>- A `command`, `args` or `env` value holds a `${` form that is not `${NAME}`. <br>- An env sets `PYTHONPATH`, or a path field, or a word of an `args` or `env` value, is absolute, starts with `~` or holds a `..` segment (S3). <br>- An `admit` key is on no case object, a list is empty or names an implementation twice, or an implementation of the profile admits no case (K47). |
| R1 missing-implementation | An API unit declares no symbol of an implementation of its profile, or the declared symbol is no public symbol that the implementation's extractor gives. Or the extractor of an implementation gives no symbols: its program or nightly is missing, it fails, or it prints no list. |
| R2 missing-binding | A suite or feature unit has no binding of an implementation of its profile. |
| R3 not-executed | The binding cannot start (its program is missing, or an environment reference of its implementation is unset, empty or resolves to a path outside the checkout), exits with a status other than 0, or the cases that passed are not exactly the cases of the suite file. A feature binding fails when the run of its whole test file exits with an error or its `id` did not pass exactly once. Each binding runs twice, so a second run with another exit status, another case or another result is also R3. The finding lists the failed, skipped, missing and extra cases and the differences between the runs. A case that a run reports twice is named by a `reported twice in run <n>` part of the finding. A Go package that does not build adds its compiler output. |
| R4 undeclared-suite | A file of the `suites` globs is the file of no suite unit and lies in the case directory of none. |
| R5 undeclared-test | A test file of an implementation (a file in its roots that the convention or `testPatterns` of its runner selects, or a file of its `tests` globs), other than its `support` files, is the test of no binding of that implementation. Or a file in its roots is named like a test (`*_test.*`, `test_*.*`, `*Test.*`, `*.test.*`, `*.spec.*`), no convention selects it, and no binding runs it. Or a support file of a node, php or python implementation reports a case when `parity-check` runs it. |
| R6 misplaced-test | The test of a binding lies outside the `roots` of its implementation and outside the `comparators`. Or a file that the convention or `testPatterns` of one or more runners select, other than a `support` file of an implementation of those runners, lies outside the roots of every implementation of those runners, outside the `comparators` and outside the `tools` roots. The vendored `scripts/kit` and `tests/kit` are kit's own and are not checked. |
| R7 error-catalog | An implementation of the `errors` profile declares no codes, or its codes differ from the catalog (missing or extra codes). |
| R8 exclusion | An exclusion. It never counts as holding the unit, so the check fails until the item that it names removes it. |
| R9 language-set-drift | A list in another file that `languageLists` declares differs from its profile, or its pattern matches nothing. |
| R10 docs-count | A document of `documents` counts N implementations, and no profile of N implementations holds the implementations that its sentence names, unless its sentence names exactly N and the names of its passage together are a profile. Or it lists three or more implementation names in a sentence whose implementation names together are no profile. |
| R11 undeclared-public | A public symbol that the extractor of an implementation gives is declared neither by an API unit nor by a `nativeOnly` entry of its implementation. Or a `nativeOnly` entry names no public symbol. |

### Runners

| Runner | Command | Cases | Feature ids |
|---|---|---|---|
| `go` | `go test -json -count=1 -run ^<symbol>$ ./<directory>` in the nearest directory with `go.mod`; a feature runs without `-run` | the `pass`, `fail` and `skip` events of the direct subtests `<symbol>/<case>` | the test or subtest name, `TestX/case` |
| `cargo` | `cargo test --manifest-path <crate>/Cargo.toml --test <name>` for `<crate>/tests/<name>.rs`, else `--lib`, then `-- --test-threads=1 <symbol>::`; a feature runs without the filter | the tests `<symbol>::<case>`: `test <name> ... ok`, `FAILED` or `ignored` in the output, with any run of whitespace before `...`, as libtest-mimic (a `harness = false` test target) pads each name to the longest one | the libtest path, `module::test` |
| `node` | `node --test --test-reporter=<scripts/kit/parity-node-reporter.mts> <test>` | the top-level tests that the reporter names: node:test's own pass, fail, skip and todo; the test of the file itself is none | the names of the test and its enclosing suites joined by ` › ` |
| `vitest` | `node node_modules/vitest/vitest.mjs run <args> --reporter=json --outputFile.json=var/parity/vitest.json <test>` from the checkout root | the top-level tests of the JSON report: `passed`, `failed`, `skipped` or `pending`, and `todo` | the `ancestorTitles` and `title` joined by ` › ` |
| `php` | `php <args> <package>/vendor/bin/phpunit --teamcity <configuration> <test>` from the checkout root, where `<package>` is the nearest directory with `composer.json` above the test and `<configuration>` is `--configuration <package>/phpunit.xml`, or `--configuration <package>/phpunit.xml.dist` when only that exists, else `--no-configuration`; a suite binding with the symbol `<class>::<method>` adds `--filter /^<class>::<method>(?: with data set \|$)/`, so its method runs alone | with the symbol, the data sets `<method> with data set "<case>"` of the TeamCity messages; without it, the test methods `test_<case>` | the test method |
| `python` | `var/tools/mise/shims/python3 <args> -m unittest -v <test>` | the test methods `test_<case>` of the verbose output on standard error | the test method |

The go, cargo, php and python runners read their tool's output with the parsers of `test-output.mts`, the same parsers that
`run-tests` reads a run with (K47). node reports through its reporter API and vitest through its JSON report, so no text of
theirs is parsed. A todo is a test that the tool expects to fail, a node or vitest todo or a unittest `expected failure`: it
is no pass, so its case fails the check, while run-tests shows it as a pass line.

PHPUnit reads its configuration from the working directory, and the check keeps the checkout root as the working directory of
every runner, so that the `command`, `args` and paths of each runner share one base. A php binding therefore names the
configuration of its package: `--configuration` with the package's `phpunit.xml` (or `phpunit.xml.dist` when only that exists),
or `--no-configuration` when the package has neither, so that no configuration of another directory applies. A test whose name is no case of the binding is ignored: a go subtest nested below a case keeps its `/` and is a case that
the suite does not declare. A case name holds no whitespace, and in a unit with a go binding it holds no `/`, because Go nests
the names of subtests at `/`. A run of node:test starts without `NODE_TEST_CONTEXT`, so that it does not join the test run
that started the check.

An implementation can replace the program of its runner with `command`, which is not empty. A command that holds a `/` is a
path relative to the root of the checkout, such as the Python of a virtual environment; otherwise it is a name on PATH. No
path of the declaration leaves the checkout (S3): the schema rejects an absolute path, a path that starts with `~` and a `..`
segment, in a path field and in each word (between `=`, `:` and whitespace) of an `args` or `env` value, and an `env` named
`PYTHONPATH`, since a package is tested as installed. A value that a `${NAME}` reference resolves to such a path cannot start
its run (R3). `args` go after `test` for go and cargo, and before the test file for node, before the PHPUnit path for php and before `-m unittest` for python, such as
`-d extension=<library>` for one PHP implementation. `env` sets variables for the runs of that implementation only, over the
environment of the check.

A `command`, `args` or `env` value can reference the invoking environment as `${NAME}`, such as the checkout of a sibling
repository or a library that the Makefile builds. `parity-declarations-check` does not read the environment: it fails only on a
`${` form that is not `${NAME}`, so there is no default form, and `$NAME` without braces is plain text. `parity-check` replaces
each reference with the value of NAME when it runs the bindings. When NAME is unset or empty, every binding of that
implementation is an R3 finding that cannot start and names the value and NAME, while the other rules run. A step line prints
the command and arguments as declared, with the reference and never its value.

An implementation declares its test-support files with `support` globs: a file in its `roots` that the convention of its
runner, its `tests` or the `testPatterns` of its runner select, or that is named like a test, but that holds no test, such as a Go helper that must end in `_test.go`. A support file is no
test of a binding, so R5 skips it, and R6 skips it for the patterns of the runner of its implementation only. It must hold no
test that its runner would run:

- A Go support file declares no top-level function that `go test` runs: `Test`, `Benchmark` or `Fuzz` followed by no lower-case
  letter, or `Example`.
- A cargo support file holds no test attribute: `#[test]`, `#[bench]`, `#[test_case]`, `#[rstest]`, or one of these with a
  path such as `#[tokio::test]`.
- `parity-check` runs each node, php and python support file once with the runner of its implementation, and a case that its
  output reports is an R5 finding.

Each glob selects at least one such file, so a stale glob fails the declaration.

### Test-file conventions (K75)

kit fixes the test files of each runner (S3), `CONVENTIONS` of `parity-declaration.mts`: go `**/*_test.go`; cargo
`**/tests/**/*.rs` and every `.rs` file that holds a test attribute; node `**/*.test.{ts,mts,cts,mjs,cjs,js}`; vitest
`**/*.{test,spec}.{ts,mts,cts,js,mjs,cjs,tsx,jsx}`; php `**/*Test.php`; python `**/test_*.py`. The test files of an
implementation are the files in its roots that the convention of its runner selects, and the files of its `tests` globs. The
`tests` of an implementation and the `testPatterns` of a runner only add to the convention; nothing in the declaration
removes a file from it, and a support file is proven to hold no test. A file in the roots of an implementation that is named
like a test in a common convention (`*_test.*`, `test_*.*`, `*Test.*`, `*.test.*`, `*.spec.*`) and that no convention selects is
a test that its runner does not run, such as a PHP script named `*_test.php`: R5 fails it until a binding runs it, it is
renamed to the convention, or a support glob declares it. The node and vitest conventions overlap, so R6 accepts a file in a
root of any runner whose convention selects it.

### Feature units (K75)

A unit of kind `feature` names one native test of each implementation of its profile: `bindings` of `{ implementation, test,
id }`, where `id` is the native test id as the runner reports it (see Feature ids above). It has no vector file. `parity-check`
runs the whole test file of each feature binding, once for every feature that binds that file in that implementation, twice;
the binding holds when the run exits with 0 and its `id` passed once in each run. A missing, failed, skipped, repeated or
changing id is R3, and a feature without a binding of an implementation is R2.

### Symbol extractors (K75)

`symbols` of an implementation declares `{ extractor, entry }`. `parity-check` runs the extractor, which reads the public API of
`entry` with the standard tool of its ecosystem, and judges R1 and R11 on what it gives. Nothing is read from a committed
snapshot, and `parity-declarations-check` runs no extractor.

| Extractor | Tool | Entry | Ids |
|---|---|---|---|
| `go` | `var/tools/symbols-go/bin/kit-symbols-go`, kit's program on `golang.org/x/tools/go/packages` v0.52.0 | a module directory | `<import path>.<name>`, `<import path>.<type>.<method or field>` of the exported names of each non-internal, non-test package |
| `ts` | API Extractor 7.59.4 (`@microsoft/api-extractor`, a dependency of kit), its API model | a `.d.ts` entry point, such as the one that tsc 7 emits, in the package of the nearest `package.json`, compiled with that package's `tsconfig.json`, or without one with the library of ESNext and no `@types` | the canonical references, such as `@scope/name!Codec#encode:member(1)` |
| `php` | `scripts/kit/symbols/php/extract.php` on nikic/php-parser 5.9.0 | a source directory or file, such as the `*.stub.php` of a PHP extension | `Ns\Class`, `Ns\Class::method`, `Ns\Class::CONST`, `Ns\Class::$property`, `Ns\function`, `Ns\CONST` of the public declarations |
| `python` | `scripts/kit/symbols/python.py` on the standard library's `ast`, run by `var/tools/mise/shims/python3 -I` | a package directory or a module file | `<module>.<name>` of `__all__`, else of the names without `_`, and `<module>.<class>.<method>` |
| `rust` | `cargo +<nightly> rustdoc -- -Z unstable-options --output-format json` (format 61) | a `Cargo.toml`, its library | `<crate>::<path>` of each public item reachable from the root, re-exports included, with its public fields, variants, inherent items and trait items |

- A repository names `go` and `php` in `symbolExtractors` of `config/toolchain.json`; `make install-tools` then builds the go
  program into `var/tools/symbols-go` and installs the locked Composer project of the php extractor into
  `var/tools/symbols-php` with the declared Composer (`install-symbols.mts`). The release of each is the sha256 of its source
  files, so a kit release that changes it reinstalls it. `make build` copies `scripts/kit/symbols` into `dist/symbols`.
- rustdoc JSON is unstable (rust-lang/rust#76578), so the rust extractor runs the Rust nightly of the `config/toolchain.json`
  `exceptions` entry with tool `rust` whose scope holds the crate, with `RUSTUP_AUTO_INSTALL=0`; its retry condition is
  "rustdoc JSON is stable". This is the only use of a nightly. `make install-tools` installs each Rust channel of the exceptions with
  `rustup toolchain install <channel> --profile minimal` (`install-rust.mts`), and a missing rustup fails with its install.
- An extractor that is not installed, a missing or doubled nightly, a failing tool and an output that is no list of ids are R1
  findings that name the extractor and the entry.

### Spec anchors (K75)

A permanent difference cites the spec that makes it one (S6). A profile narrower than every implementation and every
`nativeOnly` entry declare `spec`, the anchors `<file>#<fragment>` of their reason, with the file under `contracts/` or
`docs/spec/`. Each one resolves: a Markdown file defines the fragment as an explicit anchor `<a id>` or a heading anchor, and
the fragment of a JSON file is a JSON Pointer (RFC 6901) to one of its values. A profile of every implementation cites none.

### Per-case admission

A suite unit may declare `admit`: the key of each case object, beside the case name at `cases`, that lists the implementations
which admit the case, such as `kinds`. A case object without the key is admitted by every implementation of the profile. Each
listed name must be an implementation of the profile, and the key must hold an array of such names; otherwise it is a
declaration finding. An implementation that a list omits does not run the case: the expected cases of its binding leave the
case out, so a native test of that case is an R3 finding (`not in the suite`), and every run prints
`unit <unit> does not run <case> for <implementations>: <key> lists <implementations>`. `admit` belongs to a suite unit only.

These are declaration findings: a key that no case object has, an empty list, a name listed twice, and an implementation of the
profile that admits no case (unless R8 excludes it, which is itself a finding). An implementation that admits nothing runs
nothing, so it leaves the profile or is excluded with its reason and item.

### Declaration

`config/parity.json`, validated against `scripts/kit/schema/parity.schema.json` (`make kit-check` validates it too):

| Key | Content |
|---|---|
| `implementations` | `name`, `runner` (`go`, `cargo`, `node`, `vitest`, `php`, `python`), `prose` (the names that documents write for it, which R10 reads), `roots` (its directories; never the whole repository), `tests` (at least one glob of its test files), `support` (globs of its test-support files), `command`, `args`, `env` (`name`, `value`), `symbols` (`extractor`, one of `go`, `php`, `python`, `rust`, `ts`, and `entry`, the path it reads; Symbol extractors), `errors` (`file`, `pattern`: the generated codes) |
| `profiles` | `name`, the `implementations` that it groups, and `reason`, which a profile narrower than every implementation needs |
| `suites` | globs of the shared vector files |
| `comparators` | the directories of the checks that compare the outputs of several implementations |
| `tools` | `root` and `reason` of each directory of single-language tooling tests that implement no contract, printed on every run; R6 accepts a test there and R3 and R5 do not judge it; a root that overlaps an implementation root or holds the test of a binding is a declaration finding |
| `testPatterns` | for each `runner`, the `globs` of its test files across the repository |
| `units` | `id`, `kind` (`suite`, `feature` or `api`) and `profile`. A suite has `file`, `cases` (for a vector file a path of `$` followed by `.<key>` and `[*]` steps and an optional last `.~` step, which selects the keys of an object as the case names; for a directory a glob relative to it whose `/` steps each match one directory level, each matched directory one case named by its path relative to the directory, such as `*/*` over `<group>/<case>/`, what lies inside a case not examined and a matched file a declaration finding; a go binding reports such a name as nested subtests) and `bindings` (`implementation`, `test`, `symbol`). An API unit has `symbols` (`implementation`, `symbol`). |
| `nativeOnly` | `implementation`, `symbol` and `reason` of an exported symbol that only one implementation has |
| `exclusions` | `unit`, `implementation`, `reason` and `item`, the checklist item that removes the exclusion |
| `errors` | `profile` and `catalog` (`file`, `pattern`) |
| `languageLists` | `file`, `pattern` (its first group holds the list; the words of the group are the names) and `profile` |
| `documents` | `globs` and `nouns`, the words that a count precedes (`languages`, `언어`) |

A pattern is a regular expression that is applied to each line (flags `gm`), and its first group is the value. A count is digits,
an English number word up to twelve or `both`, or a Korean native numeral up to 열, followed by one of the nouns after a space, a
hyphen (`four-client`) or a Korean counter (`6개 언어`, `여섯 개 언어`, `세 가지 언어`). A list is three or more implementation
names, joined by `,`, `and`, `or`, `/`, `및`, or the particles `와` and `과`. The extractor of an implementation gives the ids of
its public symbols (Symbol extractors).

R10 reads the prose of a document in passages, on the Markdown reader of `scripts/kit/markdown.mts`: a paragraph or a list item
with the lines that continue it, a block quote without its markers, an ATX heading (`#` to `######` and a space), or a table
row. A fenced block, an indented code block and a setext underline are no prose, and a setext underline ends its paragraph.
Inline code, link destinations, autolinks, bare URLs, link definitions and HTML tags and comments are blanked, so only prose
names an implementation; a code span after a name keeps the name in its list (``Go `x`, PHP `y`, Rust `z`, and TypeScript
`w` ``). A sentence ends at `.`, `!` or `?` before a space, and a table cell is a sentence of its own.

A count of N holds when a profile of N implementations holds every implementation that its sentence names ("five clients: Go,
PHP, Rust, TypeScript and Python"), or when its sentence names exactly N implementations and the names of its passage together
are a profile. A count of one or two of something else therefore fails as any other count does; a document writes such a
sentence without a numeral. A list holds when the implementation names of its own sentence together are a profile: a sentence
that states something of a part of the implementations names the others in the same sentence ("Go, Rust and TypeScript generate
the methods; PHP and Python resolve them at call time"). The items of one Markdown list, with the same marker and indent and
no other passage between them, are one list when each item names exactly one implementation; three or more such names hold when
they together are a profile. An implementation is named by its name or by a name of its `prose` (`"prose": ["PHP extension"]`
for `php-extension`), in any case; a prose name that is a name of another implementation, or a repeated prose name, is a
declaration finding.

The catalog pattern applies to each line of the catalog that is not blank and is not a comment (a line that starts with `#` or
`//`). It must match every such line, so no code escapes it. A line that the pattern matches without its group holds no code,
such as the other fields of an entry. An example is `^- code: (\w+)$|^  \w+: .*$`.

A profile narrower than every implementation removes the omitted implementations from its units. Every run prints such a
profile with what it omits and its reason. At least two units use it; a one-unit profile would be an exclusion that never fails.

### Wiring a repository

1. After `make kit-sync`, write `config/parity.json`. Declare every implementation, the profiles, a suite unit for each vector
   file, an API unit for each public concept, and an exclusion with its checklist item for each unit that an implementation does not
   hold yet.
2. Make each binding's native test report each case of a suite under the name of its runner (see Runners): a subtest
   `<symbol>/<case>` in Go, a test `<symbol>::<case>` in cargo, a top-level node:test test named `<case>`, a data set named
   `<case>` of the method `<class>::<method>` that the binding names as its symbol in PHPUnit (a `#[DataProvider]` with string
   keys; the class is fully qualified), or else a test method `test_<case>` in PHPUnit and unittest. A binding prints no line
   for the check.
3. Declare `symbols` (`extractor`, `entry`) of each implementation, and generate the error codes of each implementation from
   the catalog.
4. Add `parity-declarations-check` to the check targets of the repository and `parity-check` to its CI, so both run before a push
   lands. Run them after the checks that regenerate the error-code artifacts (the trust boundary). The kit.mk of the installed
   package already holds the targets.

```json
{
  "schema": 1,
  "implementations": [
    { "name": "go", "runner": "go", "roots": ["packages/go"], "tests": ["packages/go/**/*_test.go"],
      "symbols": { "extractor": "go", "entry": "packages/go" }, "errors": { "file": "packages/go/codes.go", "pattern": "^\\tCode\\w+ = \"(\\w+)\"$" } },
    { "name": "python", "runner": "python", "roots": ["packages/python"], "tests": ["packages/python/tests/*.py"],
      "symbols": { "extractor": "python", "entry": "packages/python/src/client" }, "errors": { "file": "packages/python/codes.py", "pattern": "^\\w+ = \"(\\w+)\"$" } }
  ],
  "profiles": [{ "name": "client", "implementations": ["go", "python"] }],
  "suites": ["tests/**/vectors.json"],
  "comparators": ["tests/conformance/check"],
  "testPatterns": [
    { "runner": "go", "globs": ["**/*_test.go"] },
    { "runner": "python", "globs": ["**/test_*.py"] }
  ],
  "units": [
    { "id": "codec", "kind": "suite", "profile": "client", "file": "tests/codec/vectors.json", "cases": "$.vectors[*].name",
      "bindings": [
        { "implementation": "go", "test": "packages/go/codec_test.go", "symbol": "TestCodecVectors" },
        { "implementation": "python", "test": "packages/python/tests/test_codec.py" }
      ] },
    { "id": "host-decode", "kind": "api", "profile": "client", "symbols": [
        { "implementation": "go", "symbol": "packages/go/hostcodec.go::HostDecode" },
        { "implementation": "python", "symbol": "packages/python/codec.py::host_decode" }
      ] }
  ],
  "exclusions": [],
  "errors": { "profile": "client", "catalog": { "file": "docs/errors.yaml", "pattern": "^\\s*- code: (\\w+)$" } }
}
```

## Python locks: PEP 751 pylock.toml (K36)

The dependency gate reads a Python lock only in the standard format of PEP 751 (status Final, resolution 31 March 2025),
`pylock.toml` or `pylock.<name>.toml`, named in `pythonLocks` of `config/dependency-policy.json`. uv.lock is not read: it is
uv's own format, and a repository that releases a wheel needs a lock that every installer reads.

Writers measured with uv 0.12.11 and pip 26.2.1: `uv export --format pylock.toml --frozen --no-emit-project -o <lock>` and
`pip lock`. uv installs from the file with hash checks; pip refuses a `vcs` entry in it. Both set `created-by`.

### Rules

- The file is read by `scripts/kit/pylock.mts` (`readPylock`) through smol-toml (`scripts/kit/toml.mts`), which reads all of
  TOML; a text that is not valid TOML fails with the file, the line and the column.
- `lock-version` is `"1.0"`; another version fails the gate.
- Each lock's sha256 is recorded in `config/dependency-review.json`, as a lock of any other ecosystem is.
- A registry package (`sdist` or `wheels`) is a dependency of the lock: its name and version are recorded, its latest stable
  release is queried from PyPI, and its advisories are read from the PyPI release JSON (`vulnerabilities`) of its locked
  version. Every `sdist`, `wheels` and `archive` file carries a `sha256`, and the gate fails when one does not.
- A `vcs` package (git) is pinned by its `commit-id`, which must be 40 hexadecimal digits. The record holds its URL,
  `requested-revision` and `commit-id`, and the gate fails when the lock and the record name another commit. A git package is
  not queried for advisories or releases.
- A package with no source table, or a `directory` package, fails the gate: a consumer exports the lock with
  `--no-emit-project`, so a local package has no release to review.
- `created-by` is required. The fix of an outdated release or an advisory names the tool that wrote the lock: for uv,
  `uv lock --upgrade-package <name>` then the export again; for pip, `pip lock`. A lock with another or no `created-by`
  gets a fix that names the missing tool. The review never rewrites a lock itself (`UPDATE=1` skips these packages).
- A consumer that adopts this release adds each lock to `pythonLocks` of `config/dependency-policy.json` as an object with its
  `source` (K54): `{ "lock": "<pylock.toml>", "source": { "requirements": "<file>", "constraints": "<file>" } }`. The field is
  required, with no compatibility path.

### Limitations

- The reader supports the lock writers' subset only; a lock that another writer produces with a construct outside it fails
  until the reader reads it.
- A `directory` package is refused, not reviewed.

## uv and the Python lock writer (K54)

`uv` is a tool of `mise.toml`: mise installs the exact release at the sha256 of `mise.lock`, and its shim
`var/tools/mise/shims/uv` runs it (K127). `make python-lock` (ONLINE) writes each Python lock of `pythonLocks` with that uv, and `make
python-lock-check` (offline) compares each lock with its sources. The reason for the pin is that a lock written by an undeclared
uv of PATH depends on the machine: `pip lock` (pip 26.2.1) is experimental and locked only the running platform (cryptography
got only the macOS arm64 wheel), while uv's universal resolution writes the files of every platform with their markers and hashes.

### uv: the install and its state

- **Release archive (K64, K127):** mise installs uv from its release archive `uv-<target>.tar.gz` (the aqua backend), with the
  sha256 of linux-x64, linux-arm64, macos-arm64 and macos-x64 in `mise.lock`. uv installs no Python since K127: the Python is a tool of `mise.toml`.
- **State under `var/tools`, never the home:** the environment of mise of the checkout (kit.mk, `miseEnvironment`) sets
  `UV_CACHE_DIR=var/tools/mise/cache/uv`, `UV_PYTHON_DOWNLOADS=never` (uv downloads no interpreter) and `UV_NO_CONFIG=1` (no
  `uv.toml` of the home or of the system is read), and `toolsEnvironment` adds `UV_PYTHON`, the python3 of mise.

### Measured uv behaviour (uv 0.12.11, aarch64-apple-darwin, the Python 3.14.8 virtual environment of install-tools)

| Case | Result |
|---|---|
| The output name | `-o` must be `pylock.toml` or `pylock.<name>.toml` with no dot in `<name>`; `-o lock.toml` exits 2 with that rule. |
| The header | The first comment names the whole command line, the `-o` path and the source paths included, so the writer runs in a temporary directory with the source names. |
| Files written | Online with a cold cache: the lock and nothing else in the working directory. |
| Cache | Under `UV_CACHE_DIR` only: `interpreter-v4`, `sdists-v9`, `simple-v24`, `wheels-v6`, `archive-v0` (with a URL constraint), `.lock`, `CACHEDIR.TAG`, `.gitignore`; 904K for the six-package set below. |
| Offline, cold cache (`--offline`) | Exit 1, "unsatisfiable"; no file is written. |
| Offline, warm cache (`--offline`, the cache of the online run) | Exit 0; the body of the lock is byte-identical to the online lock, only the header line that names `--offline` differs. |
| No Python on PATH (`env -i PATH=/bin`), cold cache | Exit 0: `--universal` needs no interpreter. |
| A marker requirement `colorama==0.4.6; sys_platform == "win32"` | The package carries `marker = "sys_platform == 'win32'"`. |
| A constraint `certifi @ <wheel URL>#sha256=<digest>` | The package is `archive = { url, hashes = { sha256 } }`, not a registry entry; the digest is the fragment's. |
| Platforms | `charset-normalizer==3.5.2` has 86 wheel files; every one of the 97 files of the set has a sha256 (`--generate-hashes`). |
| A `pyproject.toml` as the requirements, copied into the temporary directory under its name | uv reads `[project].dependencies` there; the project itself is not emitted, so the lock holds only its dependencies. In place was not measured under a lock name (the first attempt used `out-a.toml`, which uv refuses); the copy works, so the writer copies. |
| `--no-index --find-links <dir>`, a relative or an absolute `<dir>` | Each local wheel is `wheels = [{ url = "file:///<realpath>/<wheel>", hashes = { sha256 } }]`: uv writes the realpath, not the relative input. The header names `--no-index` and omits `--find-links`, so no checkout path is in the header. |
| `path = "<relative to the lock>"` (PEP 751) | `uv pip install --dry-run --no-index -r pylock.toml` and pip 26.2.1 `install --dry-run --no-index -r pylock.toml` read the path relative to the lock directory: uv from two working directories, pip from the lock directory (measured on the two wheels of the set). |
| The lower bound of `--universal` | Without `--python-version`, uv takes the lower Python bound of the universal resolution from an interpreter that it finds, not from `requires-python` (measured: with Python 3.11 on PATH it resolved for 3.11 and noted that a dependency requires 3.14). The writer therefore passes `--python-version` with the minor of the `python` of `mise.toml`, and a `mise.toml` without one is refused before uv runs. |
| A `dependencies` entry in `[project].dynamic` | Not measured with uv: the writer and the check refuse it before uv runs. |

The six-package set is `requests==2.34.2` with `certifi==2026.7.22`, `charset-normalizer==3.5.2`, `idna==3.20`,
`urllib3==2.8.0` and, for the marker, `colorama==0.4.6`; every package is pinned, so no run chooses a version.

### Declaration of a lock

`config/dependency-policy.json` names each lock in `pythonLocks`, and its `source` names the files that the lock is written from
(`scripts/kit/schema/dependency-policy.schema.json`):

```json
"pythonLocks": [
  {
    "lock": "packages/app-python/pylock.toml",
    "source": {
      "requirements": "packages/app-python/pyproject.toml",
      "constraints": "packages/app-python/constraints.txt",
      "findLinks": "packages/app-python/wheels"
    }
  }
]
```

- `requirements`: the direct requirements, in one of two forms.
  - A requirements file, one per line: `name`, `name==version`, a range such as `name>=2.30,<3` or `name~=2.34`, or `name @ url`.
    A marker after `;` is kept by uv and not read for the pin, and extras are not read for the pin. An option or any other form
    fails with its line.
  - A `pyproject.toml`: its static `[project].dependencies` are the direct requirements. A wheel package names its own pyproject,
    so its requirements have one copy. A pyproject that lists `dependencies` in `[project].dynamic` is refused, because the
    requirements are then not in the file. The reader of kit reads single-line strings only, so a pyproject with a multi-line
    string fails with its line.
- `constraints`: a constraints file that pins every package, transitive ones too, one per line: `name==version`, or
  `name @ https://...#sha256=<digest>` for a polyspec archive. Anything else (a range, a marker, an option, a hash) fails with its line.
- `findLinks` (optional): a directory of the checkout, relative to the root, with the local wheels. The writer then runs uv with
  `--no-index --find-links <directory>` and reads no index. A path outside the checkout, or a directory that does not exist, fails.
  The directory lies inside the package of the lock (the directory of the lock): the lock names each local wheel by a path
  relative to the lock, and that path may not leave the package. The writer refuses a findLinks outside it before uv runs, and
  `python-lock-check` refuses a local path that leaves it (`..`), naming the package and the file.

```text
# packages/app-python/pyproject.toml
[project]
name = "app"
version = "0.0.0"
dependencies = ["requests==2.34.2", "colorama==0.4.6; sys_platform == 'win32'"]

# packages/app-python/constraints.txt
requests==2.34.2
certifi==2026.7.22
charset-normalizer==3.5.2
colorama==0.4.6
idna==3.20
urllib3==2.8.0
```

### Writer (`make python-lock`, ONLINE unless findLinks is declared)

`scripts/kit/python-lock.mts write` runs `var/tools/mise/shims/uv pip compile <requirements> -c <constraints> --universal --python-version <python>
--generate-hashes --format pylock.toml -o pylock.toml` (`<python>` is the minor of the `python` of `mise.toml`) in a directory of `var/tools` (`python-lock-<random>`) that holds the two sources under their
own names. A `pyproject.toml` is copied under its name, and uv reads it there (measured below), so the pyproject does not have to
stay in the checkout for uv. With findLinks it appends `--no-index --find-links <directory>`. The source is read and parsed first,
so a malformed source stops before uv runs.

uv writes a local wheel as `url = "file:///<checkout path>/<wheel>"`. The writer replaces each such URL with a `path` relative to the
lock's directory (`path = "../links/<wheel>"`, PEP 751), and refuses any other file URL, so the lock holds no machine path. The
written lock is checked against the sources (the same check as `python-lock-check`), then renamed to its place; a refused run leaves
the lock it had and removes its directory. An unpinned transitive package is refused with its name: uv resolves it to a registry
release, the check finds it in the lock and not in the constraints.

### Check (`make python-lock-check`, offline)

It never resolves. It fails, naming the file and the package with its fix, when:

- a lock package has no pin in the constraints (a transitive one included), or a pin has no package in the lock;
- a lock package is at another version than its pin, or is a git or directory package (the lock holds registry files and archives);
- a constraint is not `name==version` or a direct reference with `#sha256`, or a line is an option or a hash (pip-requirements-js
  reads the requirement and constraint lines by PEP 508 and pip's file syntax);
- a requirement has no pin, or its specifier is not satisfied by the pinned version (`satisfies` of @renovatebot/pep440);
- a `pyproject.toml` source lists `dependencies` in `[project].dynamic`, or has no `[project]` table;
- a registry file has no sha256, a lock is not PEP 751 1.0 or does not read (`readPylock`);
- a local file of the lock (its `path`, relative to the lock) is missing, is an absolute path, or does not hold the sha256 of the lock:
  the check reads the file, so the wheels of a findLinks lock must be in the checkout;
- an archive's URL or sha256 differs from its constraint;
- a source or the lock is missing.

Each case has a test that fails for it (`tests/kit/python-lock-check.test.mts`), and the writer's cases are in
`tests/kit/python-lock-write.test.mts` (a stub uv). `tests/source/python-lock-real.test.mts` runs the real uv with no network: the
wheels are the pinned setuptools wheel of `var/tools/wheels` and a pure-Python wheel built with the pinned Python from a source tree,
both in a directory of the test under `var/`. The test writes a lock of a pyproject with findLinks, the offline check passes on it,
a version drift (`0.0.1` to `0.0.2`) fails with `tinylib`, and a constraint set without `setuptools` fails with `setuptools`. The
fixture policy of `tests/kit/fixture` declares sources that exist and agree with its lock, and a test runs the check on that fixture.

### Limitations

- The check reads the local files of a findLinks lock, so a checkout without its wheels fails the check until they are downloaded.
- The check reads only `[project].dependencies` of a pyproject. uv also reads `[tool.uv]` (indexes, sources) when it writes the
  lock; a source that uv resolves to git or a directory fails the check, and an extra index is not seen by the check.
- The reader of kit reads single-line strings only, so a pyproject with a multi-line string fails with its line (the reader names
  it; it is not silently skipped).
- The check cannot compare a registry file's sha256 with the registry without the network, so a drift of one hex digit of a
  registry hash passes it; the dependency review records the lock's sha256 and the gate fails on that change (K36).
- The writer needs the network (PyPI through uv) unless findLinks is declared.
- A requirement's extras and markers do not change which packages are pinned: every package of the lock must be in the constraints,
  whatever the marker.

## Editor tools (K80)

orm and template both have editor packages: a language service, a language server, a CodeMirror adapter and a VS Code
extension. The two tools that check and test them move from template (`scripts/check-editor-boundaries.mjs` 103,
`scripts/install-vscode.mjs` 75) into kit. Each repository runs them from its own make target, with its own configuration.

### Editor boundaries

`scripts/kit/check-editor-boundaries.mts` reads `config/editor-boundaries.json` (`scripts/kit/schema/editor-boundaries.schema.json`).
Each boundary has:
- `packages`, the package directories;
- `sources`, the source directory of each package;
- `forbiddenModules`, globs of the modules that the packages may neither import nor declare in a dependency field of package.json;
- `forbiddenGlobals`, the globals that the packages may not use;
- `exempt`, the sources that are not starting points, such as the command line of a language service.

The check starts at every source that no exempt glob matches. It follows the relative imports transitively, also out of
the package, and reports a finding with its import chain. A file under an exempt glob that a checked source reaches is
checked too. A bare specifier is judged by its name and never followed. A relative import names its file, with `.js` for
a `.ts` file. An import that the check cannot follow is a finding, never skipped: a computed `import()`, a subpath import,
a relative import of no file, or a `.tsx` or `.jsx` source.

The template tool had no configuration and followed no import. It found imports with one regular expression over each file
of `src`, and found DOM globals with a second one that listed the properties of `document`. kit parses instead:
- amaro, the TypeScript remover of Node.js, turns TypeScript into JavaScript in transform mode. The remover built into
  Node.js 26 only strips, and fails on parameter properties.
- acorn parses the JavaScript, and acorn-walk finds the `import`, `export … from`, `import()` and `require()` nodes.
- eslint-scope finds the references that no scope declares, so a local variable named `document` is not a use of the global.

These replaced the alternatives:
- TypeScript 7 has only an unstable compiler API.
- dependency-cruiser and madge need the API of TypeScript 6 (K111).
- es-module-lexer reads neither `require()` nor globals.

The runtime self-test of the template tool became `tests/kit/editor-boundaries.test.mts`.

### VS Code installer

`scripts/kit/install-vscode.mts <extension package directory> <tools directory>` installs the minimum of `engines.vscode`
(`^X.Y.Z`; any other form fails) in the layout of `@vscode/test-electron`, which does the download. The tool adds two
things that the library lacks:
- `installedExecutable`, the offline read of the integration run. It fails with `run make install-vscode` when the copy is
  missing.
- A download into `<tools>/.next-<pid>` that is renamed into place. The library unzips into the final directory, so two
  installs at once would destroy each other; with the rename, the copy of the first install stays.
- The download in a process of its own (K173). `@vscode/test-electron` 3.1.0 pipes a `.tar.gz` download into a
  `tar -xzf -` child and neither ends nor kills that child when the response fails ("aborted"); the child kept the event
  loop alive after a retry succeeded, so the install never exited. The command forks itself with `--download`, in a
  process group of its own, and kills that group once the download has settled; a failed download fails the install with
  its error. The download process ends when the install goes away first.

`@vscode/test-electron` is an optional peer dependency of kit: a repository that installs VS Code declares it.
`tests/kit/install-vscode.test.mts` replaces the download with a function, so no test reaches the network; its tests of
the command run `@vscode/test-electron` against a stub of update.code.visualstudio.com behind a local proxy (a
certificate that openssl makes, `NODE_EXTRA_CA_CERTS`), which aborts the archive response of chosen attempts.
