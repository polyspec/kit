<!-- doc-id: local-links -->
# Local links for 0.0.x development

[한국어](local-links.ko.md)

## Status and scope

The owner decided this on 2026-10-15 and it is in effect. It covers every development checkout of the polyspec repositories and of limepie, the folders `polyspec/` and `limepie/` beside each other in one workspace folder, while the polyspec versions are 0.0.x.

## Decision

Development is completed against the latest source of each polyspec repository, with no release in between.

- An installed polyspec package is linked to the source of the repository that provides it, and the link counts as the installed released version.
- Releases follow in one batch after development is complete, in dependency order: kit → ordered-json → orm, template → crudui → hyper → fsm, template-benchmark.
- Builds, CI and the batch release use released versions. A link exists only in a local checkout and is never committed.

Why: development stalled because each repository waited for another repository's release, which waited for a third. With every package linked to its source, a change is visible at once in every consumer.

## Mechanism

The simplest mechanism that each ecosystem allows is used.

| Ecosystem | Link |
|---|---|
| npm | The installed folder `node_modules/@polyspec/<pkg>` is replaced by a symbolic link to the provider's package folder. The provider's `dist` must be built. |
| Composer | The installed folder `<vendor-dir>/polyspec/<pkg>` is replaced by a symbolic link to the provider's package folder. `vendor-dir` is the one of the Composer project that owns the vendor. |
| Python | `uv pip install -e <provider package>` into the virtual environment that the repository's own install made. |
| Go | A `go.work` outside the repository, selected with `GOWORK`, uses the consumer's modules and the provider modules. |
| Rust | Each cargo command gets `--config` `[patch]` entries and a `resolver.lockfile-path` to a lock copy; nothing is written globally. |

- The name of each package and its provider folder are read from the provider manifests (`package.json` `name`, `composer.json` `name`, `pyproject.toml` `project.name`, `go.mod` `module`).
- Scripts: `polyspec/scratch/link/link.sh <dir>...`, `link.sh --check <dir>...`, `unlink.sh <dir>...`, `cargo-linked.sh <dir> <cargo args>`.
- `--check` lists every declared polyspec dependency of every tracked manifest as linked or not linked.
- `unlink.sh` restores each checkout with each tool's own install (`npm ci`, `composer install`, `uv sync`).

## Known effects

- Running `npm ci`, `composer install` or `uv sync` (including a make target that runs it) removes the links. Run `link.sh` again and confirm with `--check`.
- The package manager still records the released version (lock files, Composer's `installed.json`). A check that compares installed packages with their lock fails while linked; it is run after unlinking or after the batch release.
- A new third-party dependency of a provider must also be installed in the consumer.
- A PHP C extension is not linked; it needs a built shared library.
- A dependency pinned to a version the provider no longer has (ssr's ordered-json `=0.0.2`) is not linkable and is moved in the integration pass.

## Ownership

The session `link-owner` owns the links and keeps the registry `polyspec/scratch/link/REGISTRY.md`: each session, its folders and their link state. Other sessions run `link.sh` on their own folders and report `--check` to it.

## End

After development is complete, every checkout is unlinked, every repository takes its dependencies at the new releases once, and this document is closed.
