<!-- doc-id: local-links -->
# Local links for 0.0.x development

[한국어](local-links.ko.md)

## Status and scope

The owner decided this on 2026-10-15 and it is in effect. It covers every development checkout of the polyspec repositories and of consumer, the folders `polyspec/` and `consumer/` beside each other in one workspace folder, while the polyspec versions are 0.0.x.

## Decision

Development is completed against the latest source of each polyspec repository, with no release in between.

- An installed polyspec package is linked to the source of the repository that provides it, and the link counts as the installed released version.
- Releases follow in one batch after development is complete, in dependency order: kit → ordered-json → orm, template → crudui → hyper → fsm, template-benchmark.
- Builds, CI and the batch release use released versions. A link exists only in a local checkout and is never committed.

Why: development stalled because each repository waited for another repository's release, which waited for a third. With every package linked to its source, a change is visible at once in every consumer.

## Mechanism

The links are the kit tool `scripts/kit/link.mts` (K201, K201-1), which uses the simplest mechanism that each ecosystem allows. Only a package pinned at 0.0.x is linked: the version comes from each tool's own record (npm query, Composer's `installed.json`, `uv pip list`, the requirement of `go mod edit -json`), and any other pin is reported `NOT linked (pinned <version>, not 0.0.x)` and fails.

| Ecosystem | Link |
|---|---|
| npm | Each copy that `npm query` lists below `node_modules` of an npm project of the consumer is replaced by a symbolic link to the provider's package folder; a copy that `npm query` does not list is linked only when it already is that link, else it is reported `NOT linked (not recorded by npm query: <folder>)`, never at a guessed version. |
| Composer | The vendor of each Composer project of the consumer is the one that `composer config vendor-dir` gives it (also one that `COMPOSER_VENDOR_DIR` places); each copy that its `composer/installed.json` lists at its `install-path` is replaced by a symbolic link to the provider's package folder, and `composer dump-autoload` runs once in each such project on every `link` run (not `check`), linked or not. A vendor without `installed.json` is reported `NOT linked (not installed in <vendor>)`; a record without `install-path` is `NOT linked`; each `polyspec/*` name of `require` or `require-dev` in the consumer's `composer.json` files without a linked record is reported `NOT linked` too. |
| Python | One `uv pip install` per environment, with dependencies: `-e` for each declared polyspec package and each polyspec package below it, and an `--overrides` file of `-e` lines, so a sibling that a provider requires by its release URL resolves to the editable provider too. The requirements are read as PEP 508 and PEP 735 define them; the state comes from `uv pip list --format json`; a provider that it does not list is reported `NOT linked (not installed in <venv>)` and is not installed. The environment is `VENV`, else uv's project environment (`UV_PROJECT_ENVIRONMENT`, else `.venv`) of the workspace root that `uv workspace dir` prints. |
| Go | `var/link/go.work` of the consumer uses every module of the consumer and the provider modules; `kit.mk` exports it as `GOWORK` while the root is declared, and `GOWORK=off` for the release targets and `dependency-review`, which use the released versions. make reads it when it starts, so `make link` and a Go target in one invocation run that target without it. |
| Rust | `link.mjs cargo <dir> <cargo args>` runs one cargo command with `--config` `[patch]` entries for the URL that each provider declares in `config/release.json` and a `resolver.lockfile-path` to a copy of the tracked lock under `var/link/cargo`, made afresh on every run; nothing is written globally. |

- Declaration: the environment variable `POLYSPEC_CHECKOUTS` names the polyspec root, the folder that holds the main checkout of each polyspec repository. Without it every command does nothing (cargo runs as given) and the installs stay the locked releases.
- Providers: each tracked manifest of a package in a main checkout under the root names what it provides (`package.json` `name` of a package that is not private, `composer.json` `name`, `pyproject.toml` `project.name`, `go.mod` `module`). A linked worktree is never a provider, and a package of the consumer's own repository, identified by its common Git directory, is never linked, also from a worktree of it. Two package folders that provide one name fail with both, and so do two repository roots of different checkouts; a repository root next to a package folder is the development project and yields. Tests, examples, benchmarks, documents, config/, .mise and fixtures provide nothing and are never linked; release-consumer projects are tests.
- No copies: a provider is never copied. Each polyspec folder of a `node_modules` or a vendor that the tool's record does not list is a plain copy and is reported `NOT linked` with its path; a package installed from a `file:` tarball is linked like any other install.
- No builds: `link` only links. A provider is built by `link.mjs rebuild <repository>...` or its own target, with the targets of its own Makefile that its release builds (the prerequisites of `release-assets`; a missing prerequisite fails with make's error), else `build`, and with `POLYSPEC_CHECKOUTS` unset. A linked npm provider is STALE while an output that its `package.json` names is missing, or an input is newer than the oldest output and the inputs differ from the digest recorded after its last rebuild (`var/link/built/` of the provider); `check` fails on it.
- Writes: each file that the tool writes into a repository (`var/link` of a consumer, `var/link/built` of a provider, the `go.work.sum` that go writes, the Cargo lock copy) and each link that replaces an installed folder is one that Git ignores there (`git check-ignore`). A consumer that ignores no `var/link`, such as one without kit, gets those files in `var/link/consumers/<the path segments of the consumer>` of the kit checkout under the root, which kit ignores (nested by segment, so two paths that differ only by an underscore never share a folder), and `link` prints the `GOWORK` to export, shell-quoted (K203); any other path fails with its name.
- Commands, in a kit checkout: `make link`, `make link-check` and `make unlink` (`DIRS` names other consumer folders). The vendored `kit-bootstrap.mk` of this release makes `make install-packages`, while the root is declared, build the kit checkout under the root (`make build` there, which renames a complete `dist.next` into `dist`) and run its `link.mjs link`, so a reinstall relinks itself; a repository gets it with its `make kit-sync` of this release.
- `--project` (S-426): `link`, `check` and `unlink` with `--project` handle only the manifests directly in each `<dir>` (package.json, composer.json, pyproject.toml, go.mod), never a nested project. Without it, the whole tree under `<dir>` is handled. The install recipe of `kit-bootstrap.mk` passes it, so an install links exactly the project it installed. A named project that is not installed still fails.
- Commands elsewhere, such as consumer, which has no kit: `node $(POLYSPEC_CHECKOUTS)/kit/dist/link.mjs link|check|unlink [--project] <dir>...`, `rebuild <repository>...`, `packages <dir> python|npm` (the declared polyspec packages, one per line; nothing without the root) and `cargo <dir> <cargo args>`. The tools are `NPM`, `COMPOSER_BIN`, `UV`, `GO` and `CARGO` when a recipe gives them, else the tools of the consumer (`var/tools/bin/npm`, the shims of mise, the Composer of `mise.toml`, the cargo of rustup); a missing tool fails with its cause. The kit checkout under the root is built once (`make build` in it).
- A recipe that installs from its lock runs the link right after the install, in the same recipe: for example a `$(PYTHON)` rule whose `uv sync --frozen` runs on every make. A check of the environment against the lock, such as `uv sync --frozen --check`, takes the polyspec packages out while the root is declared and checks the third-party packages exactly: `uv sync --frozen --check --inexact` with `--no-install-package <name>` for each name that `link.mjs packages <dir> python` prints. The links are checked by `link.mjs check`.
- `check` lists every installed copy and every declared polyspec dependency as linked, NOT linked, STALE or own (this repository); NOT linked and STALE fail it.
- `unlink` restores each checkout with each tool's own install (`npm ci`, `composer install` in the project after the links are removed, `uv sync --locked`), removes `var/link`, and reports each restore that it skips, which fails it.

## Known effects

- `npm ci`, `composer install` and `uv sync` remove the links; `make install-packages`, or a recipe that runs the link after its install, relinks at once. Elsewhere run `link.mjs link` again and confirm with `link.mjs check`.
- The package manager still records the released version (lock files, Composer's `installed.json`). A check that compares installed packages with their lock fails while linked; it is run after unlinking or after the batch release.
- npm resolves a linked package's own dependencies from the provider checkout's `node_modules`; Composer resolves them from the consumer's vendor, so a provider's new Composer requirement must also be installed in the consumer.
- A PHP C extension is not linked; it needs a built shared library.
- A dependency pinned to a version the provider no longer has (ssr's ordered-json `=0.0.2`) is not linkable and is moved in the integration pass.

## Ownership

The session `link-owner` owns the links and keeps the registry `polyspec/scratch/link/REGISTRY.md`: each session, its folders and their link state. Other sessions run the link on their own folders and report `link.mjs check` to it.

## End

After development is complete, every checkout is unlinked, every repository takes its dependencies at the new releases once, and this document is closed.
