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

The links are the kit tool `scripts/kit/link.mts` (K201), which uses the simplest mechanism that each ecosystem allows.

| Ecosystem | Link |
|---|---|
| npm | Each copy that npm's own record, the hidden lockfile `node_modules/.package-lock.json` of an npm project, lists is replaced by a symbolic link to the provider's package folder. |
| Composer | Each copy that Composer's own record, `<vendor>/composer/installed.json` of each vendor below the consumer (also one that `COMPOSER_VENDOR_DIR` placed), lists at its `install-path` is replaced by a symbolic link to the provider's package folder; `composer dump-autoload` runs when the provider's autoload rules differ from the installed copy's. |
| Python | One `uv pip install` per environment, with dependencies: `-e` for each declared polyspec package and each polyspec package below it, and an `--overrides` file of `-e` lines, so a sibling that a provider requires by its release URL resolves to the editable provider too. The environment is `VENV`, else uv's project environment (`UV_PROJECT_ENVIRONMENT`, else `.venv`) of the workspace root that `uv workspace dir` prints. |
| Go | `var/link/go.work` of the consumer uses its modules and the provider modules; `kit.mk` exports it as `GOWORK` while the root is declared. |
| Rust | `link.mjs cargo <dir> <cargo args>` runs one cargo command with `--config` `[patch]` entries and a `resolver.lockfile-path` to a lock copy under `var/link/cargo`; nothing is written globally. |

- Declaration: the environment variable `POLYSPEC_CHECKOUTS` names the polyspec root, the folder that holds the main checkout of each polyspec repository. Without it every command does nothing and the installs stay the locked releases.
- Providers: each tracked manifest of a package in a main checkout under the root names what it provides (`package.json` `name` of a package that is not private, `composer.json` `name`, `pyproject.toml` `project.name`, `go.mod` `module`). A linked worktree is never a provider, and a package of the consumer's own repository, identified by its common Git directory, is never linked, also from a worktree of it.
- Build: a provider repository is built before it is linked, with the targets of its own Makefile that its release builds (the prerequisites of `release-assets`), else `build`. `link.mjs rebuild <repository>...` rebuilds in place without relinking. A linked npm provider is STALE while an output that its `package.json` names is missing, or an input is newer than the oldest output and the inputs differ from the digest recorded after its last build (`var/link/built/` of the provider).
- Commands, in a kit checkout: `make link`, `make link-check` and `make unlink` (`DIRS` names other consumer folders). `make install-packages` ends with the link while the root is declared, so a reinstall relinks itself.
- Commands elsewhere, such as consumer, which has no kit: `node $(POLYSPEC_CHECKOUTS)/kit/dist/link.mjs link|check|unlink <dir>...`, `rebuild <repository>...`, `packages <dir> python|npm` (the declared polyspec packages, one per line; nothing without the root) and `cargo <dir> <cargo args>`. The tools are `UV`, `GO`, `NPM` and `COMPOSER_BIN` when a recipe gives them, else the shims of mise or `var/tools/bin` of the consumer. The kit checkout under the root is built once (`make build` in it); after that the tool rebuilds kit as the provider of `@polyspec/kit`.
- A recipe that installs from its lock runs the link right after the install, in the same recipe: for example a `$(PYTHON)` rule whose `uv sync --frozen` runs on every make. A check of the environment against the lock, such as `uv sync --frozen --check`, takes the polyspec packages out while the root is declared and checks the third-party packages exactly: `uv sync --frozen --check --inexact` with `--no-install-package <name>` for each name that `link.mjs packages <dir> python` prints. The links are checked by `link.mjs check`.
- `check` lists every installed copy and every declared polyspec dependency as linked, NOT linked, STALE or own (this repository); NOT linked and STALE fail it.
- `unlink` restores each checkout with each tool's own install (`npm ci`, `composer install` after the links are removed, `uv sync --locked`) and removes `var/link`.

## Known effects

- `npm ci`, `composer install` and `uv sync` remove the links; a kit install target, or a recipe that runs the link after its install, relinks at once. Elsewhere run `link.mjs link` again and confirm with `link.mjs check`.
- The package manager still records the released version (lock files, Composer's `installed.json`). A check that compares installed packages with their lock fails while linked; it is run after unlinking or after the batch release.
- npm resolves a linked package's own dependencies from the provider checkout's `node_modules`; Composer resolves them from the consumer's vendor, so a provider's new Composer requirement must also be installed in the consumer.
- A PHP C extension is not linked; it needs a built shared library.
- A dependency pinned to a version the provider no longer has (ssr's ordered-json `=0.0.2`) is not linkable and is moved in the integration pass.

## Ownership

The session `link-owner` owns the links and keeps the registry `polyspec/scratch/link/REGISTRY.md`: each session, its folders and their link state. Other sessions run the link on their own folders and report `link.mjs check` to it.

## End

After development is complete, every checkout is unlinked, every repository takes its dependencies at the new releases once, and this document is closed.
