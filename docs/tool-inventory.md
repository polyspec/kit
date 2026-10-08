<!-- doc-id: tool-inventory -->
# Tool inventory

[한국어](tool-inventory.ko.md)

The shared tools exist in several implementations. This inventory records where each one lives, its size, and the
implementation that kit takes as its base. A tool is merged into kit by taking the wider behavior of the implementations,
fixing it with a kit test, and replacing every copy with the vendored file. Measured on the working trees of the five
repositories (lines).

| Tool | template | crudui | hyper | ordered-json | orm | Base of kit |
|---|---|---|---|---|---|---|
| release | `scripts/release.mjs` 388 | 357 | 317 | `scripts/release.py` 383 | `scripts/release/release.mjs` 302 | template, with the Go tag rule of ordered-json |
| push-gate | 125 | 149 | 121 | `push_gate.py` 192 | `scripts/check/push-gate.mjs` 121 | crudui |
| full-run | 199 | 240 | 246 | `full_run.py` 285 | `scripts/check/full-run.mjs` 328 | orm |
| git-hooks | 27 | none | 28 | none | none | hyper |
| holder-lock | 134 | 275 | 111 | none | none | crudui |
| check-documents | 151 | 95 | 70 | `docs_check.py` | none | template |
| owner-check | 219 | 254 | 178 | `owner_check.py` 171 | none | crudui |
| run-tests | 289 | 282 | 159 | `test.py` | none | template |
| target-report, ci-targets | 100, 52 | 73, 47 | none | `ci_run.py` | none | template |
| ci-passed | 36 | 39 | none | `ci_run.py` | `scripts/check/ci-passed.mjs` 32 | template |
| install-tools | 189 | none | none | `toolchains.py` | none | template |
| dependency state, review, gate | in kit since v0.0.2 | 317, 288, 185 | none | none | none | crudui, merged with kit |
| github-ruleset | 182 | none | 164 | none | none | removed (0.x has no ruleset) |

## Decisions

- Every tool is Node (`.mjs`). The Python tools of ordered-json are replaced and deleted.
- A repository differs from another only in `config/*.json`; a tool has no repository name or path in its code.
- `github-ruleset` is not vendored: the 0.x rule has no pull request and no ruleset, so the file and its Make targets are
  removed in template and hyper.

## Toolchains (K8.2)

`scripts/kit/install-tools.mjs` installs the declared toolchains into `var/tools`; `scripts/kit/check-toolchain.mjs`
compares the running tools with the declarations. `scripts/kit/toolchain-declared.mjs` reads the declarations, and each
installed tool has its own module (`install-npm.mjs`, `install-go.mjs`, `install-ruff.mjs`, `install-composer.mjs`;
cargo-audit and govulncheck keep `install-cargo-audit.mjs` and `install-govulncheck.mjs`). Every installer uses
`install-tool.mjs`: the release is built beside the target, checked there and renamed, so a second run changes nothing.
Make targets: `install-tools` (online through `ONLINE`) and `toolchain-check` (offline, `TOOLS` limits the tools).

### Declarations

| Tool | Declared in | Install or verify |
|---|---|---|
| Node.js | `.node-version` (exact) | verify |
| npm | `packageManager` of `package.json`: `npm@X.Y.Z` or `npm@X.Y.Z+sha512.<digest>` | install |
| Go | `config/toolchain.json` `go`: `versionFile`, else the `toolchain` line, else the `go` directive of `go.mod` | install |
| Rust | `channel` of `rust-toolchain.toml` (exact) | verify |
| PHP | `config/toolchain.json` `php` (minor releases), else `.php-version` | verify |
| Python | `config/toolchain.json` `python` (minor release), else `.python-version`; both must agree | verify, and the minor of the ruff environment |
| Composer | `config/toolchain.json` `composer` `{ version, sha256? }` | install with `sha256`, else verify |
| ruff | the `ruff==X.Y.Z` pin of the `pyproject.toml` named by `ruff.pyproject` | install |
| cargo-audit, govulncheck | `config/toolchain.json` `cargoAudit`, `govulncheck` | install |

The shape of `config/toolchain.json` is `scripts/kit/schema/toolchain.schema.json`: `schema` (1), `comment`, `php` (list of
minor releases), `python` (minor release), `composer` (`version`, `sha256`), `go` (`mod`, `versionFile`), `ruff`
(`pyproject`), `cargoAudit`, `govulncheck` and `node` (the SHA-256 of the Node.js archive of each platform). Rust and
Node.js stay in their own files, which `setup-node` and `rustup` read. A tool that is not declared is neither installed nor
checked.

### Merged behaviors

- npm: the install of template (the npm of the machine runs `npm install --prefix`) and the install of hyper and
  ordered-json (the registry tarball, refused unless its SHA-512 is the declared digest) are one install that takes the
  second path when `packageManager` carries a digest. The layout is `var/tools/npm/node_modules/npm`; the wrappers `npm` and
  `npx` start `npm-cli.js` and `npx-cli.js`. A changed digest of the same version reinstalls (hyper). A tarball with a link or a
  special file is refused (ordered-json). The bootstrap npm runs without `var/tools/bin` on `PATH` (template).
- Go: the download of the toolchain module `golang.org/toolchain@v0.0.1-go<version>.<os>-<arch>` (template) now reads the
  release from three places: the version file with the consistency check of the `go` directive of `go.mod` (the file of
  crudui and orm), the `toolchain` line (ordered-json) or the `go` directive (template). The downloaded zip in
  the module cache is removed after the install, because only the unpacked toolchain is used.
- Composer: hyper installs `composer.phar` verified by its SHA-256; template, crudui and orm only verify the running
  Composer. The merged tool installs when `sha256` is declared and verifies otherwise.
- Python: crudui declares the minor release in the configuration, template and ordered-json in `.python-version`. The
  merged tool takes the configuration, else the file, and fails when both exist and differ. PHP is handled the same way
  with `.php-version` (ordered-json, orm) and the list of crudui and template; a file that is not in the list fails.
- ruff: the virtual environment of template is made with `--copies`, so it holds no link to the interpreter.
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
- The Node.js archive checksums of `config/toolchain.json` `node` are data that a repository's own download reads; kit
  accepts them and reads none.
