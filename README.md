# polyspec/kit

The tools that every polyspec repository shares. A repository holds a byte-for-byte copy of `scripts/kit/` and `tests/kit/`
(listed in `kit.json`); it differs from another repository only in `config/*.json`. kit depends on no repository.

## Tools

| Concern | Tools (`scripts/kit/`) | Make targets (`scripts/kit/kit.mk`) |
|---|---|---|
| Vendoring | `kit-sync.mts`, `kit-check.mts` | `kit-sync KIT_TAG=…`, `kit-check`, `kit-test` |
| Dependencies | `dependency-state.mts`, `dependency-review.mts`, `check-dependency-policy.mts`, `check-dependency-policy-mutation.mts`, `pin-python-dependency.mts` | `dependency-policy-check`, `dependency-policy-mutation-check`, `dependency-review RECORD=1 UPDATE=1` |
| Toolchains | `install-tools.mts`, `install-npm.mts`, `install-go.mts`, `install-ruff.mts`, `install-composer.mts`, `install-cargo-audit.mts`, `install-govulncheck.mts`, `check-toolchain.mts`, `check-cargo-downloads.mts` | `install-tools TOOLS=…`, `toolchain-check`, `cargo-downloads-check`, `cargo-downloads-fetch` |
| Folder layout | `install-alint.mts`; alint runs `config/layout.yml` over the common rules of `config/layout.kit.yml` | `layout-check` |
| Python | `lint-python.mts` | `lint-python` |
| Gates | `push-gate.mts`, `full-run.mts`, `git-hooks.mts`, `holder-lock.mts`, `checklist.mts` | `hooks`, `hooks-check`, `push-gate-commit`, `rerun-failed` |
| Documents and commits | `check-documents.mts`, `documents-stamp.mts`, `check-commits.mts`, `owner-check.mts` | `documents-check`, `documents-stamp`, `commits-check`, `owner-check`, `owner-validate` |
| Tests and CI | `run-tests.mts`, `ci-targets.mts`, `ci-passed.mts`, `target-report.mts` | `ci-targets`, `ci-summary`, `ci-passed` |
| Release | `release.mts`, `release-consumer.mts`, `release-proof.mts` | `release-tools`, `release-verify`, `release-versions`, `release-assets`, `release-publish`, `release-undraft`, `release-coverage`, `release-go-tags`, `release-consumer`, `release-consumer-lock`, `release-proof` |

`docs/tool-inventory.md` records which implementations each tool replaced and which behaviors it took or dropped.

## Layout

- `scripts/kit/` — the tools and `kit.mk`, which a repository includes in its Makefile; `scripts/kit/schema/` holds the JSON Schema
  of each `config/<name>.json`.
- `tests/kit/` — the tests of the tools; `tests/kit/fixture/` is the fixture monorepo that they run on.
- `config/layout.kit.yml` — the common layout rules (S5), vendored into every repository; `config/layout.yml` adds the map of kit.
- `kit.json` — the vendored directories and the version of this tree.

## Use in a repository

```sh
make kit-sync KIT_TAG=v0.0.4   # copy the vendored files at the tag and write .kit/kit.lock.json (online)
make kit-check                 # compare the files with the lock and the configuration with the schemas (offline)
make kit-test                  # run the vendored tests through run-tests.mts (offline)
```

`kit-sync` at the same tag changes nothing. A vendored file is changed in kit and copied again, never edited in a repository.
