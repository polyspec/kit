<!-- doc-id: local-links -->
# Local links for 0.0.x development

[한국어](local-links.ko.md)

## Status and scope

The owner decided this on 2026-10-15 and it is in effect; the user ruled its link form on 2026-10-22 (K448) and again on 2026-10-29 (K761). It covers every development checkout of the polyspec repositories and of consumer, the folders `polyspec/` and `consumer/` beside each other in one workspace folder, while the polyspec versions are 0.0.x.

## Decision

The user's rule (2026-10-29): during development the official install folder of a polyspec package and its development folder are connected, so the install folder is one plain directory symlink to the development checkout; an edit made through the install folder is an edit of the checkout and can be pushed from it. A release uses the official installed copy. Releases proceed independently when their dependencies and release checks are ready; kit is released first when consumers need its changes. Local source connections remain available after a release. CI installs the exact released dependency versions recorded by each application's manifests and locks.

- The application owns its dependency declarations and locks. Its package manager installs the locked release; kit then replaces each installed polyspec package folder with one plain directory symlink. No package manager re-resolves the consumer for a link (K761).
- Polyspec packages are links in every checkout; third-party packages come from each checkout's own lock. Every checkout runs its own install and then its own `make link`, so a provider's polyspec dependencies are links too.
- During development each polyspec package's install folder (node_modules, vendor, site-packages) is one plain directory symlink to its checkout. No package-manager link step (npm link, Composer path repository, pip/uv editable) (PRINCIPLES S11).
- kit reports missing installs and copies. It does not bypass constraints, invent versions or reconcile installed metadata by hand.

## Installation and validation boundaries

| Mode | Native contract and scope |
|---|---|
| Release installation | The installed-package bootstrap uses native locked installation such as npm ci; no sibling checkout is a prerequisite. Composer installs the selected release manifest and lock. |
| npm source helper | npm-install is a development-source helper: declared polyspec providers require checkouts. It runs `npm ci` of the tracked lock, then links each installed provider folder. It is distinct from release install-packages. |
| Composer source helper | composer-install runs `composer install` of the selected manifest's lock, then links each installed provider folder. No path repository and no `composer update` are needed. |
| Python source helper | uv-install runs `uv sync --locked` of the tracked lock, then links each installed provider package folder in site-packages to the same package of its checkout. The release's dist-info stays the installed record; no editable build and no build backend run (K765). `uv pip check` validates the installed distributions. |

link-check and link-state-check describe source connections; they are not a universal version or peer-dependency solver. npm ls --all is the native diagnostic when peer validation is required. No kit-written resolver or substituted installed version repairs such a mismatch. Composer and uv failures are preserved rather than hidden.


Providers install their own changed dependencies and build inputs with their package manager. Reusing an already-correct source link does not install new external provider dependencies or rerun its lifecycle. Source edits remain visible without a new release; compiled outputs still need their native build.

Independent runtime jobs run `make link RUNTIME=<runtime>` (`go`, `php`, `php-ext`, `python`, `rust` or `ts`). The selector limits provider discovery, linking and installed-source verification to that runtime. TypeScript links its npm folders, PHP and the PHP extension link their Composer vendor folders, Python links its site-packages package folders and Go uses its workspace; Rust keeps its existing Cargo source-patch path. The default `make link` and parity jobs retain all declared ecosystems.

## Mechanism

The link tool replaces each installed npm and Composer folder of a polyspec package that a provider gives with one relative directory symlink to the provider's package folder (K591, K761). It runs no package manager for this: no `npm link`, no npm prefix or cache under `var/link/npm`, no Composer path repository and no `composer update`. An override or a release URL in the consumer's manifest is therefore never resolved again. A link that already points at its provider stays; a copy or a link elsewhere is replaced. A declared polyspec package with no installed folder means the install did not run or failed: link reports it (K529) and creates nothing. A `file:` dependency of the consumer's own folders, such as `var/platforms/*`, is no polyspec provider and stays as it is.

Composer's generated autoload names `vendor/<vendor>/<package>/src`, which reads the checkout through the link. Source edits are visible immediately; a new class map entry of a provider still needs its owner's `composer dump-autoload` when the provider changes its autoload rules.

Dependency review updates also leave Composer metadata to native commands. The retired `composer-provider-entries` command fails with migration guidance; it does not repair a stale release lock using development source metadata. Prepare the application-owned development declarations and run native Composer instead.

| Ecosystem | Native source connection |
|---|---|
| npm | `node_modules/<name>` is one relative directory symlink to its provider, written after `npm ci` |
| Composer | `<vendor-dir>/<vendor>/<package>` is one relative directory symlink to its provider, written after `composer install`, respecting `COMPOSER` and `COMPOSER_VENDOR_DIR` |
| Python | `<site-packages>/<package path>` -> the same package path under the provider's source root, one link per package of a namespace; uv installs the lock first and removes these links before every uv write, since uv writes through a link (K539) |
| Go | a git-ignored `go.work` at each Go module, with `use` lines for the module and the provider modules |
| Rust | `link.mjs cargo <dir> <cargo args>` runs one cargo command with `--config` `[patch]` entries and a copy of the lock under `var/link/cargo` |

- Every tracked project of the checkout is linked, a nested one below the root such as hyper's `examples/board` included (K447); the tests, the fixtures and the release consumer keep the install that they test.
- Providers: each tracked manifest of a package in a main checkout that the arguments name, else in the checkouts beside the repository (`--siblings`), and the forks in `forks/` of the workspace (K379). A checkout's own packages link to its own folders, never to the main checkout of the same repository.
- `make npm-install` runs `npm ci` followed by the links; `ADD` explicitly connects a new provider. `make composer-install` runs `composer install` of the lock followed by the links. `make uv-install` runs `uv sync --locked` of the lock followed by the links. A missing or stale Python development lock needs native `uv lock` preparation.
- kit runs no build target during linking. Native package-manager lifecycle hooks retain their usual behavior. A separate provider build uses its own target.

## Verification

`make link-state-check` (K305-1, P30) checks that each installed npm, Composer and Python package folder of a provided package is a link to its checkout, and validates workspace links, `go.work` and Claude Code hooks. For each linked npm provider it also judges the polyspec packages that the provider needs at run time, one level through its real path: a copy there is a second instance of that package, and `instanceof` fails across consumer and provider (K761). `make link-check` lists mismatches as a development aid. Dependency compatibility belongs to each native package manager. Release CI uses the declared released dependencies rather than local provider discovery.

The source-development contract covers a released dependency whose source is edited at the same version, a source checkout ahead of its release, and a new provider with no published release. Native package metadata must still be valid; lack of a release does not waive the package manager's metadata requirements. A provider without a published release follows its package manager's normal version metadata or inference rules; kit supplies no invented version. Applications declare compatible development requirements and local sources. Neither a tag nor a published archive is needed to use those sources. Cargo's exact-version requirements can prevent a patch from being selected; the wrapper checks native workspace metadata and refuses a selected release where the development source is expected. Before that check, it runs native `cargo update --offline` for only sibling crate names already present in the copied lock, with the declared path patches. Metadata and the requested command then use that generated lock under `var/link/cargo`; the tracked manifest and lock remain unchanged, and Cargo is not asked to update unrelated packages. Cargo source checks cover the workspace resolution, not only the package selected by `-p`.

Two runs with the same declared inputs must leave the same source selections, manifests, locks and installed records; logs and timestamps are not this state. Editing provider code needs no relink, although compiled code still needs its native build. An explicit `unlink` restores the application's selected native lock state and removes generated Go workspaces; it does not delete application-owned local source declarations, so that state can itself contain linked package folders. A release installation uses release declarations and locks.

## Worktrees

- A worktree branch is `<type>/<name>-<id>` from `main` (P10) and reaches `main` by `make land`. Tools are reused from the main checkout. Native offline npm ci and Composer install create each worktree's own dependency tree, workspace links, installed records, autoload and command proxies. npm uses the main project's configured download cache; Composer uses the main tool environment and cache. kit then links the provider folders as plain symlinks (K761) and copies no installed records (K690).
- Python environments are prepared from each project's tracked uv lock through Kit's native `uv-install` path. The worktree has its own `UV_PROJECT_ENVIRONMENT` and shares the main checkout's uv cache; `uv sync --locked --offline --no-install-project --all-groups` installs locked inputs, then each provided package folder is linked to its checkout. Tracked locks remain unchanged. Missing cached inputs fail with preparation guidance.
- `make worktree-setup` prepares these dependencies and checks the worktree. kit.mk and kit tools use the main checkout's `var/tools` with the worktree's own `mise.toml`. General `make install` and `make install-tools` remain refused in a worktree; native offline dependency preparation is part of worktree setup. A missing cache input fails normally; prepare the declared inputs in the main checkout before retrying.
- `make worktree-link-state` performs the same linking and runs `link-state-check` without rebuilding product packages. Use it when checking link state is the purpose of the worktree; it does not skip the check. `make worktree-setup` keeps its rebuild-before-check behavior.
- worktree-setup copies the main checkout's immutable `var/composer-artifacts` archive inputs before Composer runs, using filesystem cloning when supported. It does not link an installed vendor tree or synthesize metadata (K690). A Python environment cannot be a single directory link to the main environment, because its linked packages must run worktree sources. A make timestamp stamp cannot carry across a fresh checkout; a stamp that must remain valid there judges by content.
- `main` is written by `make land` and by commits whose pre-commit hook passed (K495): a second land waits for the first's lock, a branch behind `main` is rebased in its worktree, and a manual merge, reset or update-ref of `main` is refused by the reference-transaction hook.
- A worktree and its branch are removed as soon as the branch is merged into `main`: `make land` removes the branch that it lands, and every other clean worktree of a branch that `main` contains in which no process runs; a worktree in which a process still runs is kept until a later land (K626).

## Worktree storage and migration (K690)

Installed directories are private to each worktree; shared download caches do not provide a shared installed tree. The measured kit npm and Composer installations total about 291 MiB per worktree, or roughly 2.85 GiB for ten, before products and build output. Reuse the installed tools and remove merged worktrees rather than assuming parallel installs are free. No package-manager migration is required.

Native npm ci replaces legacy generated node_modules state without following its package links into main; the provider folders then become plain links again. Composer preparation removes a detected legacy projection into the main vendor before native installation, so matching copied records cannot leave that projection in place. Main installations and provider sources are not rewritten. Standard install and install-tools remain refused in a worktree; worktree-setup is the offline preparation entry point.

## Known effects

- Installed records describe the locked release that the package manager installed; the link replaces only the package folder. Release CI records describe released packages.
- Node resolves the imports of a module file from its real path, so a linked npm package resolves its own dependencies from the provider checkout's `node_modules`: the provider runs its own install and `make link`.
- A PHP C extension is not linked; it needs a built shared library.

## Ownership

Each application owns its dependency declarations and locks. Provider checkouts supply their source and their native build inputs. kit writes the links and verifies them.

## End

A consumer adopts a published dependency through its normal package manager and commits the resulting manifest and lock changes. Local source development can continue independently; release adoption does not require every checkout to unlink at once.
