<!-- doc-id: readme -->
# polyspec/kit

The tools that every polyspec repository shares. A repository installs them as the package `@polyspec/kit`. The package also
ships examples (the workflows of `workflows/`, the bootstrap action of `actions/`, `claude/settings.json`,
`config/layout.kit.yml` and PRINCIPLES.md, listed in docs/examples/shared-files.md), which a repository copies when it wants
them and then owns; kit writes no file of a repository (K1052). kit depends on no repository.

## Tools

| Concern | Tools (`scripts/kit/`) | Make targets of kit (`scripts/kit/kit.mk`) |
|---|---|---|
| Configuration | `kit-check.mts` | `kit-check` |
| Toolchains | the bootstrap (`bootstrap/bootstrap.mts`: mise, and the node and npm of mise.toml), `install-tools.mts` (`mise install --locked` of `mise.toml` and `mise.lock`, then the wheel backend, the Composer projects and the Rust channels of `install-rust.mts`), `mise-tools.mts`, `toolchain-mise.mts` | `install-tools TOOLS=npm`, `install-tools`, `toolchain-lock` |
| Folder layout | the alint of `mise.toml` runs `config/layout.yml` over the common rules of `config/layout.kit.yml` | `layout-check` |
| Lint | `lint-python.mts`, `lint-php.mts`, `lint-rust.mts`, `lint-go.mts`, `lint-ts.mts`, with the copied configuration (docs/operations/tool-inventory.md, Lint configuration) and the ruff, vulture, golangci-lint and deadcode of `mise.toml` and the PHP lint of `install-php-lint.mts` | `lint-python`, `lint-php`, `lint-rust`, `lint-go`, `lint-ts` |
| Gates | `git-hooks.mts`, `generated-files.mts`, `holder-lock.mts`, `checklist.mts`, `ci-only.mts` (the full suite runs only in CI), `claude-hook.mts` (the Claude Code hook of the example settings) | `hooks`, `hooks-check`, `staged-generated-hook`, `push-gate-commit` |
| Documents and commits | `check-documents.mts`, `documents-stamp.mts`, `check-commits.mts`, `owner-check.mts` | `docs-check`, `documents-stamp`, `owner-check`, `owner-validate` |
| Tests and CI | `run-tests.mts`, `ci-targets.mts`, `ci-passed.mts`, `target-report.mts` | `ci-targets`, `ci-summary`, `ci-passed` |
| Release | `release.mts` | `release-tag`, `release-tools`, `release-assets`, `release-publish`, `release-undraft`, `release-coverage` |

`docs/operations/tool-inventory.md` records which implementations each tool replaced and which behaviors it took or dropped.

## Layout

- `scripts/kit/` — the tools and `kit.mk`, the recipes of kit's own Makefile, which the package does not ship (K1054); `scripts/kit/schema/` holds the JSON Schema
  of each `config/<name>.json`.
- `tests/kit/` — the tests of the tools; `tests/kit/fixture/` is the fixture monorepo that they run on.
- `config/layout.kit.yml` — the common layout rules (S5), an example that a repository may copy; `config/layout.yml` adds the map of kit.
- `package.json` — the version of kit and the files that the package ships.

## Use in a repository

```sh
make install-tools TOOLS=npm   # install mise, and the node and npm of mise.toml, with the copied bootstrap (online)
make install-packages          # npm ci with that npm, @polyspec/kit included (online)
make kit-check                 # check the configuration against the schemas (offline)
```

A repository adopts kit as its installed package and keeps the recipes above in its own Makefile: kit includes no recipe into a
repository (K1054). `docs/examples/bootstrap.mk` is one way, which runs the tools of the installed package. It copies the examples it
wants and changes its copies as its own files.
