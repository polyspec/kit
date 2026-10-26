<!-- doc-id: local-links -->
# Local links for 0.0.x development

[한국어](local-links.ko.md)

## Status and scope

The owner decided this on 2026-10-15 and it is in effect; the user ruled its link form on 2026-10-22 (K448). It covers every development checkout of the polyspec repositories and of consumer, the folders `polyspec/` and `consumer/` beside each other in one workspace folder, while the polyspec versions are 0.0.x.

## Decision

Local development uses the latest source of the required polyspec repositories through their native package managers. Releases proceed independently when their dependencies and release checks are ready; kit is released first when consumers need its changes. Local source connections remain available after a release. CI installs the exact released dependency versions recorded by each application's manifests and locks.

- The application owns its dependency declarations and locks. Its package manager resolves compatible requirements and owns installed records, links and generated metadata.
- kit orchestrates native commands and reports missing declarations or incompatible requirements. It does not bypass constraints, invent versions or reconcile installed metadata by hand.
- Local installation state and release installation state are distinct. A selected Composer development manifest has its own native lock; it must describe the actual local dependencies.

## Mechanism

The link tool orchestrates the native package-manager commands. For npm, it follows the selected providers' transitive local npm dependencies, runs `npm link` in each provider and then `npm link <name>...` in the consumer with workspace processing disabled, using a project-local npm prefix under `var/link/npm`. This prevents a workspace override from making npm resolve a local source dependency from its release URL. If every selected installed package already resolves to its source, consumer reification is skipped. `--no-save --package-lock=false` retains the release manifest and lock while npm manages the installed links and records. Source edits are visible immediately. npm retains its normal dependency and lifecycle behavior. Composer and Python use the native mechanisms below.

Composer local development uses the path repositories and compatible requirements declared by the application. Composer reads `composer.json`, or an explicitly selected `COMPOSER=composer.local.json`, and owns that manifest's lock, installed records, links and autoload. kit creates no temporary manifest, version alias or separate runtime metadata. `composer update <local packages> --with-dependencies` may change the selected development lock and transitive dependencies; the command reports that before it runs. Release manifests and locks remain inputs to release installation, not records that disguise local source metadata.

| Ecosystem | Native source connection |
|---|---|
| npm | `npm link` connects `node_modules/<name>` through the project-local npm prefix to its provider; npm owns the links and installed records |
| Composer | Composer creates source links from declared path repositories, respecting `COMPOSER` and `COMPOSER_VENDOR_DIR`, and owns the selected lock and autoload |
| Python | `uv sync --locked` installs the application's declared path/workspace sources; uv owns editable metadata and `uv pip check` checks installed distributions |
| Go | a git-ignored `go.work` at each Go module, with `use` lines for the module and the provider modules |
| Rust | `link.mjs cargo <dir> <cargo args>` runs one cargo command with `--config` `[patch]` entries and a copy of the lock under `var/link/cargo` |

- Every tracked project of the checkout is linked, a nested one below the root such as hyper's `examples/board` included (K447); the tests, the fixtures and the release consumer keep the install that they test.
- Providers: each tracked manifest of a package in a main checkout that the arguments name, else in the checkouts beside the repository (`--siblings`), and the forks in `forks/` of the workspace (K379). A checkout's own packages link to its own folders, never to the main checkout of the same repository.
- `make npm-install` runs `npm ci` followed by native links; `ADD` explicitly connects a new provider. `make composer-install` resolves declared local providers before installation, creating the selected development lock when it does not exist and updating selected providers when it does. `make uv-install` delegates once to `uv sync --locked` for the application's native source/workspace declarations. A missing or stale Python development lock needs native `uv lock` preparation. Legacy Python folder links require a fresh native environment instead of metadata repair.
- kit runs no build target during linking. Native package-manager lifecycle hooks retain their usual behavior. A separate provider build uses its own target.

## Verification

`make link-state-check` (K305-1, P30) checks that provided sources resolve to the expected checkout through native npm, Composer and Python installations, and validates workspace links, `go.work` and Claude Code hooks. `make link-check` lists mismatches as a development aid. Dependency compatibility belongs to each native package manager. Release CI uses the declared released dependencies rather than local provider discovery.

The source-development contract covers a released dependency whose source is edited at the same version, a source checkout ahead of its release, and a new provider with no published release. Native package metadata must still be valid; lack of a release does not waive the package manager's metadata requirements. Applications declare compatible development requirements and local sources. Neither a tag nor a published archive is needed to use those sources. Cargo's exact-version requirements can prevent a patch from being selected; the wrapper checks native workspace metadata and refuses a selected release where the development source is expected. Before that check, it runs native `cargo update --offline` for only sibling crate names already present in the copied lock, with the declared path patches. Metadata and the requested command then use that generated lock under `var/link/cargo`; the tracked manifest and lock remain unchanged, and Cargo is not asked to update unrelated packages. Cargo source checks cover the workspace resolution, not only the package selected by `-p`.

Two runs with the same declared inputs must leave the same source selections, manifests, locks and installed records; logs and timestamps are not this state. Editing provider code needs no relink, although compiled code still needs its native build. An explicit `unlink` restores the application's selected native lock state and removes generated Go workspaces; it does not delete application-owned local source declarations, so that state can itself contain native editables. A release installation uses release declarations and locks.

## Worktrees

- A worktree branch is `<type>/<name>-<id>` from `main` (P10) and reaches `main` by `make land`. Tools are reused from the main checkout. npm dependencies are shared, with the repository's own workspace packages connected to worktree sources (K530). Each Composer project has a real vendor folder with links to the main installation and its own offline `composer dump-autoload` output (K521).
- Python environments are created by `uv venv` and populated by `uv pip install --offline` from the main checkout's cached inputs (K657-4). Native `uv pip freeze` supplies requirements under `var/worktree-python`; editable paths inside the main checkout are mapped to the corresponding worktree sources before uv installs them. uv creates the scripts, editable metadata and installed records. Missing cached inputs fail with guidance to prepare them in the main checkout; setup does not download them. Existing legacy environments are retained and rejected rather than rewritten.
- `make worktree-setup` prepares these dependencies and checks the worktree. kit.mk and kit tools use the main checkout's `var/tools` with the worktree's own `mise.toml`. General `make install` and `make install-tools` remain refused in a worktree; the native offline Python preparation is part of worktree setup.
- `make worktree-link-state` performs the same linking and runs `link-state-check` without rebuilding product packages. Use it when checking link state is the purpose of the worktree; it does not skip the check. `make worktree-setup` keeps its rebuild-before-check behavior.
- worktree-setup shares the main checkout's read-only `var/composer-artifacts` repository (K622). A Python environment cannot be a single directory link to the main environment, because its editable package must run worktree sources. A make timestamp stamp cannot carry across a fresh checkout; a stamp that must remain valid there judges by content.
- `main` is written by `make land` and by commits whose pre-commit hook passed (K495): a second land waits for the first's lock, a branch behind `main` is rebased in its worktree, and a manual merge, reset or update-ref of `main` is refused by the reference-transaction hook.
- A worktree and its branch are removed as soon as the branch is merged into `main`: `make land` removes the branch that it lands, and every other clean worktree of a branch that `main` contains in which no process runs; a worktree in which a process still runs is kept until a later land (K626).

## Known effects

- Local installed records describe the dependencies actually installed by the native package manager. Composer development records and autoload must agree with the selected local source; release CI records describe released packages.
- Node resolves the imports of a module file from its real path, so a linked npm package resolves its own dependencies from the provider checkout's `node_modules`.
- A PHP C extension is not linked; it needs a built shared library.

## Ownership

Each application owns its local dependency declarations and selected development locks. Provider checkouts supply their source and their native build inputs. kit invokes the package managers and verifies the resulting source connections.

## End

A consumer adopts a published dependency through its normal package manager and commits the resulting manifest and lock changes. Local source development can continue independently; release adoption does not require every checkout to unlink at once.
