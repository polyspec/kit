# polyspec/kit

The tools that every polyspec repository shares. A repository installs them as the package `@polyspec/kit` and holds
byte-for-byte copies of the files that `kit.copies` of its `package.json` lists; it differs from another repository only in
`config/*.json`. kit depends on no repository.

## Tools

| Concern | Tools (`scripts/kit/`) | Make targets (`scripts/kit/kit.mk`) |
|---|---|---|
| Vendoring | `kit-sync.mts`, `kit-check.mts` | `kit-sync KIT_TAG=…`, `kit-check`, `kit-test` |
| Dependencies | `dependency-state.mts`, `dependency-review.mts`, `check-dependency-policy.mts`, `check-dependency-policy-mutation.mts`, `pin-python-dependency.mts` | `dependency-policy-check`, `dependency-policy-mutation-check`, `dependency-review RECORD=1 UPDATE=1` |
| Toolchains | `install-tools.mts`, `install-npm.mts`, `install-go.mts`, `install-ruff.mts`, `install-composer.mts`, `install-cargo-audit.mts`, `install-govulncheck.mts`, `check-toolchain.mts`, `check-cargo-downloads.mts` | `install-tools TOOLS=…`, `toolchain-check`, `cargo-downloads-check`, `cargo-downloads-fetch` |
| Folder layout | `install-alint.mts`; alint runs `config/layout.yml` over the common rules of `config/layout.kit.yml` | `layout-check` |
| Lint | `lint-python.mts`, `lint-php.mts`, `lint-rust.mts`, `lint-go.mts`, `lint-ts.mts`, with the copied configuration (docs/tool-inventory.md, Lint configuration) and the tools of `install-vulture.mts`, `install-php-lint.mts`, `install-golangci-lint.mts`, `install-deadcode.mts` | `lint-python`, `lint-php`, `lint-rust`, `lint-go`, `lint-ts` |
| Gates | `push-gate.mts`, `full-run.mts`, `git-hooks.mts`, `holder-lock.mts`, `checklist.mts` | `hooks`, `hooks-check`, `push-gate-commit`, `rerun-failed` |
| Documents and commits | `check-documents.mts`, `documents-stamp.mts`, `check-commits.mts`, `owner-check.mts` | `documents-check`, `documents-stamp`, `commits-check`, `owner-check`, `owner-validate` |
| Tests and CI | `run-tests.mts`, `ci-targets.mts`, `ci-passed.mts`, `target-report.mts` | `ci-targets`, `ci-summary`, `ci-passed` |
| Release | `release.mts`, `release-consumer.mts`, `release-proof.mts` | `release-tools`, `release-verify`, `release-versions`, `release-assets`, `release-publish`, `release-undraft`, `release-coverage`, `release-go-tags`, `release-consumer`, `release-consumer-lock`, `release-proof` |

`docs/tool-inventory.md` records which implementations each tool replaced and which behaviors it took or dropped.

## Layout

- `scripts/kit/` — the tools and `kit.mk`, which a repository includes in its Makefile; `scripts/kit/schema/` holds the JSON Schema
  of each `config/<name>.json`.
- `tests/kit/` — the tests of the tools; `tests/kit/fixture/` is the fixture monorepo that they run on.
- `config/layout.kit.yml` — the common layout rules (S5), a copy in every repository; `config/layout.yml` adds the map of kit.
- `package.json` — the version of kit and `kit.copies`, the files that a repository holds as copies.

## Use in a repository

```sh
make install-tools TOOLS=npm   # install the npm of packageManager with the copied bootstrap (online)
make install-packages          # npm ci with that npm, @polyspec/kit included (online)
make kit-sync                  # write the copies of the installed package, the version of package-lock.json (offline)
make kit-check                 # compare the package with package-lock.json, the copies with the package and the configuration with the schemas (offline)
```

`kit-sync` at the same tag changes nothing. A vendored file is changed in kit and copied again, never edited in a repository.
