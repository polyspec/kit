<!-- doc-id: readme -->
# polyspec/kit

The tools that every polyspec repository shares. A repository installs them as the package `@polyspec/kit` and holds
byte-for-byte copies of the files that `kit.copies` of its `package.json` lists; it differs from another repository only in
`config/*.json`. kit depends on no repository.

## Tools

| Concern | Tools (`scripts/kit/`) | Make targets (`scripts/kit/kit.mk`) |
|---|---|---|
| Vendoring | `kit-sync.mts`, `kit-check.mts` | `kit-sync`, `kit-check` |
| Dependencies | `dependency-state.mts`, `dependency-review.mts`, `check-dependency-policy.mts`, `check-dependency-policy-mutation.mts`, `pin-python-dependency.mts` | `dependency-policy-check`, `dependency-policy-mutation-check`, `dependency-review RECORD=1 UPDATE=1` |
| Toolchains | the bootstrap (`bootstrap/bootstrap.mts`: the npm of packageManager and mise), `install-tools.mts` (`mise install --locked` of `mise.toml` and `mise.lock`, then the wheel backend, the Composer projects and the Rust channels of `install-rust.mts`), `toolchain-lock.mts`, `mise-tools.mts`, `toolchain-mise.mts`, `check-toolchain.mts`, `check-cargo-downloads.mts` | `install-tools TOOLS=npm`, `install-tools`, `toolchain-lock`, `toolchain-check`, `cargo-downloads-check`, `cargo-downloads-fetch` |
| Folder layout | the alint of `mise.toml` runs `config/layout.yml` over the common rules of `config/layout.kit.yml` | `layout-check` |
| Lint | `lint-python.mts`, `lint-php.mts`, `lint-rust.mts`, `lint-go.mts`, `lint-ts.mts`, with the copied configuration (docs/operations/tool-inventory.md, Lint configuration) and the ruff, vulture, golangci-lint and deadcode of `mise.toml` and the PHP lint of `install-php-lint.mts` | `lint-python`, `lint-php`, `lint-rust`, `lint-go`, `lint-ts` |
| Gates | `push-gate.mts`, `git-hooks.mts`, `generated-files.mts`, `holder-lock.mts`, `checklist.mts`, `ci-only.mts` (the full suite runs only in CI), `claude-hook.mts` (the vendored Claude Code hook) | `hooks`, `hooks-check`, `staged-generated-hook`, `push-gate-commit` |
| Documents and commits | `check-documents.mts`, `documents-stamp.mts`, `check-commits.mts`, `owner-check.mts` | `docs-check`, `documents-stamp`, `commits-check`, `owner-check`, `owner-validate` |
| Tests and CI | `run-tests.mts`, `ci-targets.mts`, `ci-passed.mts`, `target-report.mts` | `ci-targets`, `ci-summary`, `ci-passed` |
| Release | `release.mts`, `release-consumer.mts`, `release-proof.mts`, `release-assets.mts` | `release-assets-fetch`, `release-tools`, `release-verify`, `release-versions`, `release-assets`, `release-publish`, `release-undraft`, `release-coverage`, `release-go-tags`, `release-consumer`, `release-consumer-lock`, `release-proof` |

`docs/operations/tool-inventory.md` records which implementations each tool replaced and which behaviors it took or dropped.

## Layout

- `scripts/kit/` — the tools and `kit.mk`, which a repository includes in its Makefile; `scripts/kit/schema/` holds the JSON Schema
  of each `config/<name>.json`.
- `tests/kit/` — the tests of the tools; `tests/kit/fixture/` is the fixture monorepo that they run on.
- `config/layout.kit.yml` — the common layout rules (S5), a copy in every repository; `config/layout.yml` adds the map of kit.
- `package.json` — the version of kit and `kit.copies`, the files that a repository holds as copies.

## Use in a repository

```sh
make install-tools TOOLS=npm   # install the npm of packageManager and mise with the copied bootstrap (online)
make install-packages          # npm ci with that npm, @polyspec/kit included (online)
make kit-sync                  # write the copies of the installed package, the version of package-lock.json (offline)
make kit-check                 # compare the package with package-lock.json, the copies with the package and the configuration with the schemas (offline)
```

On the first adoption `scripts/kit/kit-bootstrap.mk`, itself a copy, does not exist yet, so `make` cannot run: after `npm install`
adds the pinned `@polyspec/kit`, run `node node_modules/@polyspec/kit/dist/kit-sync.mjs` once, and `make kit-sync` from then on.

`kit-sync` at the same tag changes nothing. A vendored file is changed in kit and copied again, never edited in a repository.
