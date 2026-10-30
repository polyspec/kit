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

link-check describes source connections; they are not a universal version or peer-dependency solver. npm ls --all is the native diagnostic when peer validation is required. No kit-written resolver or substituted installed version repairs such a mismatch. Composer and uv failures are preserved rather than hidden.


Providers install their own changed dependencies and build inputs with their package manager. Reusing an already-correct source link does not install new external provider dependencies or rerun its lifecycle. Source edits remain visible without a new release; compiled outputs still need their native build.

Independent runtime jobs run `make link RUNTIME=<runtime>` (`go`, `php`, `php-ext`, `python`, `rust` or `ts`). The selector limits provider discovery, linking and installed-source verification to that runtime. TypeScript links its npm folders, PHP and the PHP extension link their Composer vendor folders, Python links its site-packages package folders and Go uses its workspace; Rust keeps its existing Cargo source-patch path. The default `make link` and parity jobs retain all declared ecosystems.

## Mechanism

The link tool replaces each installed npm and Composer folder of a polyspec package that a provider gives with one relative directory symlink to the provider's package folder (K591, K761). It runs no package manager for this: no `npm link`, no npm prefix or cache under `var/link/npm`, no Composer path repository and no `composer update`. An override or a release URL in the consumer's manifest is therefore never resolved again. A link that already points at its provider stays; a copy or a link elsewhere is replaced. A declared polyspec package with no installed folder means the install did not run or failed: link reports it (K529) and creates nothing. A `file:` dependency of the consumer's own folders, such as `var/platforms/*`, is no polyspec provider and stays as it is.

Composer's generated autoload names `vendor/<vendor>/<package>/src`, which reads the checkout through the link. Source edits are visible immediately; a new class map entry of a provider still needs its owner's `composer dump-autoload` when the provider changes its autoload rules.

| Ecosystem | Native source connection |
|---|---|
| npm | `node_modules/<name>` is one relative directory symlink to its provider, written after `npm ci` |
| Composer | `<vendor-dir>/<vendor>/<package>` is one relative directory symlink to its provider, written after `composer install`, respecting `COMPOSER` and `COMPOSER_VENDOR_DIR` |
| Python | `<site-packages>/<package path>` -> the same package path under the provider's source root, one link per package of a namespace; uv installs the lock first and removes these links before every uv write, since uv writes through a link (K539); a project without its environment is not installed yet, so `make link` leaves it out and creates no environment (K689-3, K888) |
| Go | a git-ignored `go.work` at each Go module, with `use` lines for the module and the provider modules |
| Rust | `link.mjs cargo <dir> <cargo args>` runs one cargo command with `--config` `[patch]` entries and a copy of the lock under `var/link/cargo` |

- Every tracked project of the checkout is linked, a nested one below the root such as hyper's `examples/board` included (K447); the tests, the fixtures and the release consumer keep the install that they test.
- Link declaration (K869): the git-ignored file `.links` at the root of the main checkout names the provider checkouts, one path per line relative to that root; blank lines and lines that start with `#` are ignored. A worktree reads the file of its main checkout. With no file the checkout is in its release state: nothing is linked, and `make link` removes the links that an earlier declaration made, as `make unlink` does, after which `make install` restores the released packages. `make link` applies the file and is idempotent: each declared folder becomes its link, and a package folder that links outside the checkout and that the file does not name is removed. A link into the checkout stays, as the workspace links of npm and Composer do, since K773 keeps a tracked manifest from naming a path out of the repository; so do the bin links.
- Providers: each tracked manifest of a package in a declared checkout. A checkout's own packages link to its own folders, never to the main checkout of the same repository.
- `make npm-install` runs `npm ci` followed by the links. `make composer-install` runs `composer install` of the lock followed by the links. `make uv-install` runs `uv sync --locked` of the lock followed by the links. A missing or stale Python development lock needs native `uv lock` preparation.
- kit runs no build target during linking. Native package-manager lifecycle hooks retain their usual behavior. A separate provider build uses its own target.

## Verification

`make link-check` (K305-1, P30, K869) checks the links against the link declaration: each installed npm, Composer and Python package folder of a declared provider is a link to its checkout, no link to outside exists that the declaration does not name, each `go.work` uses exactly the module and the declared providers that it requires (none when nothing is declared), `.links` is git-ignored and, while `.links` exists, the Claude Code hook is installed. An npm, Composer or Python package that a tracked project declares and a declared checkout of another repository provides, with no installed folder that links it, is a finding: `make link` leaves out a project whose installer has not run yet (no node_modules, vendor folder or environment), so a project that the install never installed does not pass (K888). For each linked npm provider it also judges the polyspec packages that the provider needs at run time, one level through its real path: a copy there is a second instance of that package, and `instanceof` fails across consumer and provider (K761). Dependency compatibility belongs to each native package manager. Release CI uses the declared released dependencies rather than local provider discovery.

The source-development contract covers a released dependency whose source is edited at the same version, a source checkout ahead of its release, and a new provider with no published release. Native package metadata must still be valid; lack of a release does not waive the package manager's metadata requirements. A provider without a published release follows its package manager's normal version metadata or inference rules; kit supplies no invented version. Applications declare compatible development requirements and local sources. Neither a tag nor a published archive is needed to use those sources. Cargo's exact-version requirements can prevent a patch from being selected; the wrapper checks native workspace metadata and refuses a selected release where the development source is expected. Metadata and the requested command use a copy of the tracked lock under `var/link/cargo`, which Cargo updates; the tracked manifest and lock remain unchanged. For Cargo a checkout ahead of its release is a limit of this contract: a patch whose version is above the consumer's requirement or git tag is not selected, and the refusal says that a provider ahead of the requirement is released first and then required, and a provider behind it is updated in its checkout. Cargo source checks cover the workspace resolution, not only the package selected by `-p`.

Two runs with the same declared inputs must leave the same source selections, manifests, locks and installed records; logs and timestamps are not this state. Editing provider code needs no relink, although compiled code still needs its native build. An explicit `unlink` only removes the links and the generated Go workspaces and runs no package manager; `make install` then restores the application's selected native lock state, reinstalling each Python distribution whose package folder a removed link left missing (uv keeps an installed distribution as it is), and application-owned local source declarations stay, so that state can itself contain linked package folders. A release installation uses release declarations and locks.

## Worktrees

- A worktree branch is `<type>/<name>-<id>` from `main` (P10) and reaches `main` by `make land`. A worktree is a checkout of its own: its `var/tools`, dependency trees and links are its own (K858).
- `make worktree-setup` creates the worktree and runs `make install` there, online, as in any checkout: the tools of its `mise.toml` and `mise.lock` into its own `var/tools`, the packages of its locks, the steps of the repository and the links. It then runs `make link-check`. A worktree without `node_modules` first gets `npm ci --ignore-scripts` of the npm that `packageManager` names, as the clean checkout of the gates workflow does, and the installed kit gets the link that `make install-link` gives it, to the kit checkout that the link declaration of the main checkout names, one step early, so a Makefile that includes kit from `node_modules` runs the live kit; with no declaration the installed release runs. The main checkout's `var/tools` and locks are unchanged. `make install` and `make install-tools` also run directly in a worktree. A worktree made before K858 runs `make install` once, so it has tools of its own.
- Before `make install` runs, worktree-setup links each release archive that `config/release-assets.json` declares and the main checkout holds, and each `unpack` directory of one, such as `var/composer-artifacts/<name>-<version>.zip` or `var/products/template-ext`, to that of the main checkout, one link per path; their parent directories are the worktree's own (K780, K887). `make release-assets-fetch` runs in a worktree as in any checkout: it keeps a linked archive that holds the declared sha256, and a download or an unpack replaces the worktree's own link, never the main checkout's file (K887). It does not link an installed vendor tree or synthesize metadata (K690). A Python environment cannot be a single directory link to the main environment, because its linked packages must run worktree sources. A make timestamp stamp cannot carry across a fresh checkout; a stamp that must remain valid there judges by content.
- `make land` merges a branch into `main` fast-forward (K495): a second land waits for the first's lock, and a branch behind `main` is rebased in its worktree.
- A worktree and its branch are removed as soon as the branch is merged into `main`: `make land` removes the branch that it lands, and every other clean worktree of a branch that `main` contains in which no process runs; a worktree in which a process still runs is kept until a later land (K626).

## Worktree storage and migration (K690)

Installed directories, `var/tools` among them (K858), are private to each worktree; shared download caches do not provide a shared installed tree. The measured kit npm and Composer installations total about 291 MiB per worktree, or roughly 2.85 GiB for ten, before the tools, products and build output; the tools of kit's own `var/tools` measure about 1.4 GiB per worktree. Remove merged worktrees rather than assuming parallel installs are free. No package-manager migration is required.

## Known effects

- Installed records describe the locked release that the package manager installed; the link replaces only the package folder. Release CI records describe released packages.
- Node resolves the imports of a module file from its real path, so a linked npm package resolves its own dependencies from the provider checkout's `node_modules`: the provider runs its own install and `make link`.
- A PHP C extension is not linked; it needs a built shared library.

## Ownership

Each application owns its dependency declarations and locks. Provider checkouts supply their source and their native build inputs. kit writes the links and verifies them.

## End

A consumer adopts a published dependency through its normal package manager and commits the resulting manifest and lock changes. Local source development can continue independently; release adoption does not require every checkout to unlink at once.
