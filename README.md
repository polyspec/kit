# polyspec/kit

The tools that every polyspec repository shares. A repository holds a byte-for-byte copy of `scripts/kit/` and `tests/kit/`
(listed in `kit.json`); it differs from another repository only in `config/*.json`. kit depends on no repository.

## Tools

| Concern | Tools (`scripts/kit/`) | Make targets (`scripts/kit/kit.mk`) |
|---|---|---|
| Vendoring | `kit-sync.mjs`, `kit-check.mjs` | `kit-sync KIT_TAG=…`, `kit-check`, `kit-test` |
| Dependencies | `dependency-state.mjs`, `dependency-review.mjs`, `check-dependency-policy.mjs`, `check-dependency-policy-mutation.mjs`, `pin-python-dependency.mjs` | `dependency-policy-check`, `dependency-policy-mutation-check`, `dependency-review RECORD=1 UPDATE=1` |
| Toolchains | `install-tools.mjs`, `install-npm.mjs`, `install-go.mjs`, `install-ruff.mjs`, `install-composer.mjs`, `install-cargo-audit.mjs`, `install-govulncheck.mjs`, `check-toolchain.mjs`, `check-cargo-downloads.mjs` | `install-tools TOOLS=…`, `toolchain-check`, `cargo-downloads-check`, `cargo-downloads-fetch` |
| Python | `lint-python.mjs` | `lint-python` |
| Gates | `push-gate.mjs`, `full-run.mjs`, `git-hooks.mjs`, `holder-lock.mjs`, `checklist.mjs` | `hooks`, `hooks-check`, `push-gate-commit`, `rerun-failed` |
| Documents and commits | `check-documents.mjs`, `documents-stamp.mjs`, `check-commits.mjs`, `owner-check.mjs` | `documents-check`, `documents-stamp`, `commits-check`, `owner-check`, `owner-validate` |
| Tests and CI | `run-tests.mjs`, `ci-targets.mjs`, `ci-passed.mjs`, `target-report.mjs` | `ci-targets`, `ci-summary`, `ci-passed` |
| Release | `release.mjs`, `release-consumer.mjs`, `release-proof.mjs` | `release-verify`, `release-versions`, `release-assets`, `release-publish`, `release-coverage`, `release-go-tags`, `release-consumer`, `release-consumer-lock`, `release-proof` |

`docs/tool-inventory.md` records which implementations each tool replaced and which behaviors it took or dropped.

## Layout

- `scripts/kit/` — the tools and `kit.mk`, which a repository includes in its Makefile; `scripts/kit/schema/` holds the JSON Schema
  of each `config/<name>.json`.
- `tests/kit/` — the tests of the tools; `tests/kit/fixture/` is the fixture monorepo that they run on.
- `kit.json` — the vendored directories and the version of this tree.

## Use in a repository

```sh
make kit-sync KIT_TAG=v0.0.4   # copy the vendored files at the tag and write .kit/kit.lock.json (online)
make kit-check                 # compare the files with the lock and the configuration with the schemas (offline)
make kit-test                  # run the vendored tests (offline)
```

`kit-sync` at the same tag changes nothing. A vendored file is changed in kit and copied again, never edited in a repository.
