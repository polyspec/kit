<!-- doc-id: local-links -->
# Local links for 0.0.x development

[한국어](local-links.ko.md)

## Status and scope

The owner decided this on 2026-10-15 and it is in effect; the user ruled its link form on 2026-10-22 (K448). It covers every development checkout of the polyspec repositories and of consumer, the folders `polyspec/` and `consumer/` beside each other in one workspace folder, while the polyspec versions are 0.0.x.

## Decision

Development is completed against the latest source of each polyspec repository. Nothing is released until development of all of them is complete: no tag, no version bump and no release workflow run in any repository, kit included. A push is a backup and publishes nothing; a change to kit is seen in the other checkouts through the links after `make build`.

- A polyspec package counts as installed at its release: each tracked manifest and lock keeps the release record that its package manager wrote, and a repository's lock is the record of its one install.
- The installed folder of each polyspec package that a sibling checkout provides is a direct relative symbolic link to that checkout's package folder, never a copy. Installing from the release first and then replacing the folder with the link is the normal way.
- No link or install step judges a version, a constraint or a provider version; kit enforces no version or pin (S4). Each package manager and its lock decide the versions.
- Releases follow in one batch after development is complete, in dependency order: kit → ordered-json → orm, template → crudui → hyper → fsm, template-benchmark.

Why: development stalled because each repository waited for another repository's release, which waited for a third, and the link through each package manager re-resolved versions inside the link and refused them. A folder link reads no version, so a change is visible at once in every consumer.

## Mechanism

The link is the kit tool `scripts/kit/link.mts` with `scripts/kit/link-folders.mts` (K448). No package manager runs in the link step, and no file of a provider is written.

| Ecosystem | Installed folder that becomes the link |
|---|---|
| npm | `node_modules/<name>` of each tracked npm project, one symlink to the provider's package folder (K591) |
| Composer | `<vendor-dir>/<vendor>/<package>` of each tracked Composer project, the `config.vendor-dir` of its `composer.json` (else `vendor`) |
| Python | each package of the `site-packages` of a project's `.venv`, one symlink to the provider's package folder; the packages of one namespace (`polyspec/orm`, `polyspec/ordered_json`) link apart; the uv sync of uv-install skips each linked package with `--inexact --no-install-package <name>`, so uv never writes through a link; `--no-install-package` alone makes uv uninstall the package through the link (K592) |
| Go | a git-ignored `go.work` at each Go module, with `use` lines for the module and the provider modules |
| Rust | `link.mjs cargo <dir> <cargo args>` runs one cargo command with `--config` `[patch]` entries and a copy of the lock under `var/link/cargo` |

- Every tracked project of the checkout is linked, a nested one below the root such as hyper's `examples/board` included (K447); the tests, the fixtures and the release consumer keep the install that they test.
- Providers: each tracked manifest of a package in a main checkout that the arguments name, else in the checkouts beside the repository (`--siblings`), and the forks in `forks/` of the workspace (K379). A checkout's own packages link to its own folders, never to the main checkout of the same repository.
- The installs are the package managers' own, on the tracked lock as it is: `make npm-install` runs `npm ci`, `make composer-install` runs `composer install`, `make uv-install` runs `uv sync --frozen`, and each then links the folders. An install replaces the links with copies, so `make link` runs again after any install.
- No builds: `link` only links. A provider is built by `link.mjs rebuild <repository>...` or its own target.

## Verification

`make link-state-check` (K305-1, P30) is a gate of every repository. It fails on a provided package folder that is a copy or links elsewhere than to its provider, on a tracked lock that records a polyspec package that a sibling provides as a path or a link instead of its release record (K507; a `file:` entry that names the release tarball is the release record, and the repository's own packages are paths by right), and on a wrong workspace link, `go.work`, Claude Code hook, mise trust or merged worktree. It judges no version and no requirement. `make link-check` lists each provided folder that is a copy or links elsewhere.

## Worktrees

- The user ruled on 2026-10-22 that a worktree installs nothing: it links its tool and dependency folders (`var/tools`, `node_modules`) to the main checkout's. A worktree branch is `<type>/<name>-<id>` from `main` (P10) and reaches `main` by `make land`. The Composer vendor folder of a worktree is a real folder whose packages, `bin` and installed records link to the main checkout's, with an autoload of its own that `composer dump-autoload` writes offline, since the autoload names the sources of the checkout it was written in (K521).
- `make worktree-setup` makes the worktree, gives it a `node_modules` of links to the main checkout's packages with the repository's own workspace packages linked into the worktree (K530), the same to each other npm project that the main checkout installed and to each Python `.venv` of the main checkout, whose scripts, activate files and editable `.pth` files are written with the worktree's paths (K533), gives each Composer project its vendor folder of links and its own autoload (K521), and installs nothing (K519). Its tools need no link: kit.mk and the tools of kit run the `var/tools` of the main checkout in a worktree (the data dir, the installs and the shims of mise, and `var/tools/bin`), with the worktree's own `mise.toml`. `make install` and `make install-tools` refuse in a worktree.
- `main` is written by `make land` and by commits whose pre-commit hook passed (K495): a second land waits for the first's lock, a branch behind `main` is rebased in its worktree, and a manual merge, reset or update-ref of `main` is refused by the reference-transaction hook.
- A worktree and its branch are removed as soon as the branch is merged into `main`: `make land` removes the branch that it lands, and `make worktree-prune` removes every merged branch; `make link-state-check` fails while a merged branch is left (K381).

## Known effects

- The package manager still records the released version (lock files, Composer's `installed.json`), which is the release record above, not a fault.
- Node resolves the imports of a module file from its real path, so a linked npm package resolves its own dependencies from the provider checkout's `node_modules`.
- A PHP C extension is not linked; it needs a built shared library.

## Ownership

The session `link-owner` owns the links and keeps the registry `polyspec/scratch/link/REGISTRY.md`: each session, its folders and their link state. Other sessions run the link on their own folders and report `link.mjs check` to it.

## End

After development is complete, every checkout is unlinked, every repository takes its dependencies at the new releases once, and this document is closed.
