<!-- doc-id: readme -->
<!-- source-sha256: 8a1d27f732148d3025b872be7eec8e704c1dd20a5ca6e37effc0e9ad5b511d76 -->
# polyspec/kit

모든 polyspec 저장소가 공유하는 도구입니다. 저장소는 이를 package `@polyspec/kit`으로 설치하고, 그 `package.json`의 `kit.copies`가 나열하는
파일의 사본을 byte 단위로 같게 둡니다. 저장소끼리 다른 것은 `config/*.json`뿐입니다. kit은 어느 저장소에도 의존하지 않습니다.

## 도구

| 관심사 | 도구(`scripts/kit/`) | make target(`scripts/kit/kit.mk`) |
|---|---|---|
| Vendoring | `kit-sync.mts`, `kit-check.mts` | `kit-sync`, `kit-check` |
| Toolchain | bootstrap(`bootstrap/bootstrap.mts`: packageManager의 npm과 mise), `install-tools.mts`(`mise.toml`과 `mise.lock`의 `mise install --locked`, 이어서 wheel backend, Composer project, `install-rust.mts`의 Rust channel), `toolchain-lock.mts`, `mise-tools.mts`, `toolchain-mise.mts`, `check-toolchain.mts`, `check-cargo-downloads.mts` | `install-tools TOOLS=npm`, `install-tools`, `toolchain-lock`, `toolchain-check`, `cargo-downloads-check`, `cargo-downloads-fetch` |
| 폴더 layout | `mise.toml`의 alint가 `config/layout.kit.yml`의 공통 rule 위에 `config/layout.yml`을 돌림 | `layout-check` |
| Lint | `lint-python.mts`, `lint-php.mts`, `lint-rust.mts`, `lint-go.mts`, `lint-ts.mts`, 복사된 설정(docs/operations/tool-inventory.md, Lint 설정)과 `mise.toml`의 ruff, vulture, golangci-lint, deadcode, `install-php-lint.mts`의 PHP lint | `lint-python`, `lint-php`, `lint-rust`, `lint-go`, `lint-ts` |
| Gate | `git-hooks.mts`, `generated-files.mts`, `holder-lock.mts`, `checklist.mts`, `ci-only.mts` (full suite는 CI에서만 실행), `claude-hook.mts` (vendor되는 Claude Code hook) | `hooks`, `hooks-check`, `staged-generated-hook`, `push-gate-commit` |
| 문서와 commit | `check-documents.mts`, `documents-stamp.mts`, `check-commits.mts`, `owner-check.mts` | `docs-check`, `documents-stamp`, `commits-check`, `owner-check`, `owner-validate` |
| 테스트와 CI | `run-tests.mts`, `ci-targets.mts`, `ci-passed.mts`, `target-report.mts` | `ci-targets`, `ci-summary`, `ci-passed` |
| Release | `release.mts`, `release-assets.mts` | `release-assets-fetch`, `release-tools`, `release-verify`, `release-versions`, `release-assets`, `release-publish`, `release-undraft`, `release-coverage`, `release-go-tags` |

`docs/operations/tool-inventory.ko.md`는 각 도구가 어떤 구현들을 대체했고 어떤 동작을 가져오거나 버렸는지 기록합니다.

## 구조

- `scripts/kit/` — 도구와, 저장소가 Makefile에 include하는 `kit.mk`입니다. `scripts/kit/schema/`에 각 `config/<name>.json`의 JSON Schema가 있습니다.
- `tests/kit/` — 도구의 테스트입니다. `tests/kit/fixture/`는 테스트가 실행되는 fixture monorepo입니다.
- `config/layout.kit.yml` — 모든 레포가 사본으로 두는 공통 layout rule(S5)입니다. `config/layout.yml`이 kit의 map을 더합니다.
- `package.json` — kit의 버전과, 저장소가 사본으로 두는 파일인 `kit.copies`입니다.

## 저장소에서 사용

```sh
make install-tools TOOLS=npm   # install the npm of packageManager and mise with the copied bootstrap (online)
make install-packages          # npm ci with that npm, @polyspec/kit included (online)
make kit-sync                  # write the copies of the installed package, the version of package-lock.json (offline)
make kit-check                 # check the configuration against the schemas (offline)
```

저장소는 옆의 kit checkout과 함께 kit을 도입합니다: 그 Makefile은 그 checkout의 source를 실행하는 `../kit/scripts/kit/kit-bootstrap.mk`를
include하고(K614, K613), `make kit-sync`가 사본을 씁니다.

같은 tag로 `kit-sync`를 다시 실행하면 바뀌는 것이 없습니다. vendored 파일은 kit에서 고쳐 다시 복사하며, 저장소에서 직접 고치지 않습니다.
