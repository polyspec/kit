<!-- doc-id: agents -->
# Development

[한국어](AGENTS.ko.md)

## Purpose

kit holds the tools that every polyspec repository shares: the release, dependency, document and install
tools. A repository installs them as the package `@polyspec/kit` and holds byte-for-byte copies of the files that
`kit.copies` of its `package.json` lists, written by `make kit-sync`; a repository differs from another only in
`config/*.json`. kit depends on no repository. kit also carries the working principles of every polyspec repository, [PRINCIPLES.md](PRINCIPLES.md) and its Korean twin,
and vendors them at the same paths, so every repository holds the same principles; each repository's AGENTS.md links to them
and states only its own rules. The rules below are kit's own.

## Rules

- Own: Incoming Kit change requests are tracked in GitHub issues. Keep each issue updated with implementation progress,
  verification evidence and release status, and close it only after its stated acceptance conditions are met.
  Enforced by: none, issue updates require the judgement of the agent

- Own: English documents are canonical. Every document has a `.ko.md` file with the same information; edit both in the same
  change. The revision marker `source-sha256` of the Korean file is the sha256 of the English file. Korean documents write
  technical terms in English.
  Enforced by: `make docs-check`
- Own: A tool imports only Node built-ins (`node:`), files of `scripts/kit/` and the packages that `dependencies` of
  `package.json` declares, each pinned exactly, or an optional peer that `peerDependencies` declares and the repository that
  runs the tool installs, such as the `@vscode/test-electron` of `install-vscode.mts`. A module of `scripts/kit/bootstrap/` runs before npm installs the packages,
  so it imports only Node built-ins and files of its own directory. `tests/kit/isolation.test.mts` enforces both and fails on
  a declared package that no tool uses: imports, runs a command of (the lint tools of `lint-ts.mts`), or needs as a peer of
  such a package. No tool or test, except the fixture and `tests/kit/isolation.test.mts`, names
  another repository. A value that differs between repositories is data in
  `config/<name>.json` with a schema in `scripts/kit/schema/`, which ajv validates (draft 2020-12, strict mode, every error).
  Enforced by: `tests/kit/isolation.test.mts`
- Own: A vendored file is changed in kit and copied with `make kit-sync`, which writes the copies of the installed package (npm
  ci installs the version of package-lock.json by its integrity), never edited in a repository: `make kit-inject-check` fails on a changed or missing vendored file, and
  on a file of `scripts/kit/` that is no copy, since that directory holds the copies of kit only; `make kit-sync` removes it.
  Enforced by: `make kit-inject-check` (S13), `.claude/settings.json`
- Own: Use conventional package-manager installation, dependency locks and versioned releases. Before implementing a request that departs from those conventions, report the departure and its consequences and propose the conventional alternative, even when the request explicitly asks for the departure. Local source links remain a development mechanism.
  Enforced by: none, the choice and explanation require review.
- Refines P14: The ecosystem principle of [PRINCIPLES.md](PRINCIPLES.md) applies to the tools of `scripts/kit/`: uv for Python interpreters,
  environments and locks, Composer for PHP dependencies, and their own behavior, such as the symbolic links that uv
  creates, is accepted; our rules govern what we create. kit delegates dependency resolution, links, installed records
  and generated metadata to the native package manager; it does not replace dependency folders or synthesize installed metadata itself.
  Enforced by: `make rebuild-check`
- Own: A repository runs uv through `make uv-install`, which removes the package links of the environment that uv writes, the
  one that `--project`, `--directory` or `--active` of `SYNC` chooses included, before uv writes,
  since uv writes and deletes through a link (K539), and then runs the native locked install of its lock (`uv sync --locked`,
  or `uv pip install` of a pylock.toml) with the flags of `SYNC` as written; a symlinked development folder is never damaged.
  Enforced by: `tests/kit/uv-install.test.mts`, `tests/source/uv-link-real.test.mts`
- Own: Tracked shared root files and workflows are regular copies of the installed kit package, managed by `make kit-sync`. Consumers include
  `node_modules/@polyspec/kit/scripts/kit/kit-bootstrap.mk`; they install the locked npm dependencies before the first Make invocation.
  Local development links the provider checkouts that the git-ignored `.links` of the main checkout names, one per line: `make link`
  makes each installed folder of their packages one plain directory symlink to its provider (`docs/operations/local-links.md`,
  K869). Such links are untracked and stay out of released output. With no `.links` nothing is linked and the installed release runs.
  kit itself runs its own sources and does not install a published copy of itself. A path
  that this repository writes is relative to a stated anchor (the repository root, or the anchor its format defines, such
  as PEP 751's lock directory), stays inside the repository, and never depends on the working directory; it is never
  absolute. The repository root is the top level of the Git work tree that holds the working directory (`git rev-parse
  --show-toplevel`, `repositoryRoot` of `scripts/kit/paths.mts`), so a tool started below it, as `npm -w` starts it in a
  package directory, reads and writes the paths of the repository; outside a work tree a tool that needs the root fails. A path is resolved declaratively (named in a tracked file) or by discovery (a stated discovery rule).
  The links that an outside tool creates are its behavior, which the rule above accepts, not what this repository creates.
  A test creates a link only when the link is its subject (a path named through a link, an archive that holds a link); a
  test runs the tools of this checkout in its sandbox (`tests/kit/kit-tools.mts`) instead of linking them there.
  Enforced by: `make kit-check`
- Own: `make install` ends with `install-link`, which links the installed polyspec packages to their development checkouts
  (`docs/operations/local-links.md`), and `make worktree-setup` makes the worktree of a row, runs `make install` in it and then
  checks its links, so a worktree is a checkout of its own (K858).
  Enforced by: `tests/kit/link.test.mts`, `tests/kit/worktree-setup.test.mts`
- Own: `config/owner-checks.json` names the checks that own each tracked path, so the changes of a branch are checked by the
  checks that own them: `make land` runs the gates that the owners of the changed paths select. `make owner-validate` fails a
  tracked path that no owner holds and an owner that names a check which does not exist.
  Enforced by: `make owner-validate`
- Refines P15: A function or constant that two tools need lives in one module of `scripts/kit/` that both import.
  `make duplication-check` (jscpd) fails when a piece of 6 lines or more exists twice.
  Enforced by: `make duplication-check`
- Refines P19: Tests are in `tests/kit/`, run offline with stub commands and the fixture `tests/kit/fixture`, and each test fails
  when its
  behavior breaks. A defect is handled by a failing test that reproduces it, the fix, and keeping the test.
  A stub never runs a command that a stub or a mise shim provides (go, composer, npm, node, php, python, uv, mise), since a
  shim outside its checkout runs the next command of PATH; the archivers of the machine are allowed (`tests/kit/stubs.test.mts`).
  Enforced by: `tests/kit/stubs.test.mts`
- Own: A repository declares the tools that it installs in `mise.toml` (Go, Python, uv, ruff, alint, golangci-lint, deadcode,
  govulncheck, cargo-audit, cargo-nextest, cargo-deny, Composer, vulture), writes their digests into `mise.lock` with
  `make toolchain-lock` and installs them with `make install-tools`, which runs `mise install --locked` with the mise of the bootstrap. The uv lock of a `pypi:` tool is the sidecar folder
  `.mise/locks/<tool>/<version>` that mise.lock names: kit-written lock data, tracked with mise.lock as mise's documentation
  says; `mise install --locked` itself fails without it (K192), so kit adds no check of mise.lock (K835). A wheel is built by uv build from the
  build-system.requires of its own pyproject.toml; kit pins no build backend (K788). A vendored test checks a consumer's declaration only against
  this rule. The vendored dependency tests read go and Composer through stubs that answer from records of the real tools,
  never by running them. The kit's own tests of its real tools are in `tests/source`: kit-sync does not vendor
  them, a source test that runs a pinned tool needs `make install-tools` first, `make source-test` runs them, and CI runs
  them after `make kit-test`.
  Enforced by: none, mise install --locked checks mise.lock and its sidecars itself (K835)
- Own: kit's own checks run the tools of its `mise.toml` at the pins of kit, which `make install-tools` installs into
  var/tools/mise, and the Rust of `rust-toolchain.toml`; the Node.js of `mise.toml` is installed by the bootstrap
  (`make install-tools TOOLS=npm`) before npm (K171). Every recipe of kit.mk runs with the environment of mise of the
  checkout and with var/tools/bin and the shims of mise first on PATH, and starts a tool of the checkout by its absolute
  path (`$(NODE)`, `$(NPM)`, `$(ALINT)`), never by its bare name: make 3.81 looks up a recipe line without shell syntax on
  the PATH that make started with; `make kit-check` fails a recipe that does. A machine or CI runner provides the two toolchains
  that mise does not install. `make install-tools` installs, with rustup, the toolchain of `rust-toolchain.toml` with its
  components (`rustup toolchain install` in the checkout, which reads the file; rustup 1.28 no longer installs it as cargo
  first runs) and each Rust channel that config/toolchain.json `exceptions` declares; a missing rustup fails with its
  install, and rustup names a toolchain that is not installed when cargo runs. PHP is wrapped, not
  installed (K283, K862): when `.php-version` or config/toolchain.json `php` declares PHP, `make install-tools` wraps the
  `php` of PATH as it is with php-config and phpize beside it in var/tools/bin and compares no release; it fails when php is
  not on PATH, or when `packages/php-ext` lacks php-config or phpize. A repository that needs PHP keeps `.php-version`,
  the input of CI's setup-php, which silently sets up another PHP without it (K193).
  Enforced by: `tests/kit/install-rust.test.mts`, `tests/kit/install-tools.test.mts`, `tests/kit/install-php.test.mts`, `make kit-check` (phpVersionFinding, K193)
- Own: A tool of var/tools/bin is a wrapper script that starts the installed file by its absolute path with the environment
  of this checkout's install, such as the mise data folder of the checkout, never a symbolic link, which carries no
  environment: a tool of one checkout never runs with the tools of another (`scripts/kit/bootstrap/tool-wrappers.mts`).
  Enforced by: `tests/kit/install-php.test.mts`
- Own: A repository with several implementations of one spec declares them in `config/parity.json` and runs
  `parity-declarations-check` among its check targets and `parity-check` in its CI, both before a push lands
  (docs/operations/tool-inventory.md, Language parity).
  Enforced by: `make parity-declarations-check`
- Own: Every check gives the same result for the same tree. A tool writes through a temporary file and a rename, prints a line
  for each step, and has no time limit; a test case has its own timeout. A network query is made only by a command that a
  make recipe runs through `$(ONLINE)`, such as those of `install-tools` and `release-assets`, and its result is a committed
  record, an installation or a release archive of the repository itself; kit downloads no package of another repository
  (K865).
  Enforced by: `make kit-test`
- Own: A dependency advisory is fixed by an update. npm audit, composer audit, cargo audit and govulncheck report
  outdated and vulnerable dependencies; kit compares no versions and keeps no record of them.
  Enforced by: none, the native audit tools report the advisories and the update is a judgement of review.
- Own: Write comments, documents and commit messages in direct language: name the action and its object.
  Enforced by: none, direct wording is a judgement of review.

## Generated files

- Own: Generated files are never tracked in Git. This covers dependency installs (`node_modules/`, `vendor/`, virtual
  environments), build output (`dist/`, `target/`, `*.tsbuildinfo`), caches (`.cache/`, `__pycache__/`,
  `.pytest_cache/`), test run artifacts (`test-results/`, `playwright-report/`, PHPUnit caches) and tool downloads
  (`var/`). The only exceptions are files the repository deliberately needs, and only these are tracked: lock files
  (`package-lock.json`, `composer.lock`, `Cargo.lock`, uv locks, `mise.lock`), committed generated documents that this
  file names, test fixtures, and generated sources that a consumer installs as the tagged tree itself (a Go module, a Rust crate), each declared
  with its reason in `config/generated.json` `tracked` (P34). Each `.gitignore` covers these paths; a new generator adds its ignore entry in the same
  commit.
  Enforced by: `.githooks/pre-commit`

## Release

kit is released by the annotated tag `vX.Y.Z` that the release workflow creates on the commit of a successful CI run of
`main`; the procedure is
[docs/operations/release.md](docs/operations/release.md).

- Own: A release tag is annotated, lies on a commit of `main` whose CI concluded success, and a published tag is never moved.
  Enforced by: `make release-tag`
- Own: A release is created as a draft with its archives and made public last; a failed step leaves it a draft.
  Enforced by: `make release-publish`, `make release-undraft`
- Own: A release takes the id of a successful CI run and nothing else (`gh workflow run release.yml -f run=<id>`) and runs
  no other test; `make release-tag` checks the format of RUN, the repository of config/release.json, that RUN is a
  completed successful push or dispatch run of ci.yml on `main` whose commit is on `origin/main`, reads the version from the
  newest section `## X.Y.Z` of the change log that `changelog` of config/release.json at that commit names, refusing a commit without one or
  with entries under `## Unreleased`, and then tags that commit and the modules of its `goModules`; it compares no version (S4, K911, K924).
  Enforced by: `tests/kit/release-run.test.mts`
- Own: Every repository releases through the vendored `workflows/release.yml`, which it never edits.
  Enforced by: `make kit-check`
