<!-- doc-id: readme -->
<!-- source-sha256: 634d93220b7e36d54d9c6e431f902540502835fbd44f9c6eb15483c2d245352a -->
# polyspec/kit

모든 polyspec 저장소가 공유하는 도구입니다. 저장소는 이를 package `@polyspec/kit`으로 설치합니다. package는 예시(`workflows/`의
workflow, `actions/`의 bootstrap action, `config/layout.kit.yml`, PRINCIPLES.md. docs/examples/shared-files.ko.md에 목록이 있음)도 담으며,
저장소는 원할 때 그것을 복사해 자기 것으로 가집니다. kit은 저장소의 파일을 쓰지 않습니다(K1052). kit은 어느 저장소에도 의존하지 않습니다.

## 도구

| 관심사 | 도구(`scripts/kit/`) | kit의 make target(`scripts/kit/kit.mk`) |
|---|---|---|
| 설정 | `kit-check.mts` | `kit-check` |
| Toolchain | bootstrap(`bootstrap/bootstrap.mts`: mise, 그리고 mise.toml의 node와 npm), `install-tools.mts`(`mise.toml`과 `mise.lock`의 `mise install --locked`, 이어서 wheel backend, Composer project, `install-rust.mts`의 Rust channel), `mise-tools.mts`, `toolchain-mise.mts` | `install-tools TOOLS=npm`, `install-tools`, `toolchain-lock` |
| 폴더 layout | `mise.toml`의 alint가 `config/layout.kit.yml`의 공통 rule 위에 `config/layout.yml`을 돌림 | `layout-check` |
| Lint | `lint-python.mts`, `lint-php.mts`, `lint-rust.mts`, `lint-go.mts`, `lint-ts.mts`, 복사된 설정(docs/operations/tool-inventory.md, Lint 설정)과 `mise.toml`의 ruff, vulture, golangci-lint, deadcode, `install-php-lint.mts`의 PHP lint | `lint-python`, `lint-php`, `lint-rust`, `lint-go`, `lint-ts` |
| Hook과 checklist | `git-hooks.mts` (저장소가 나열한 hook과 merge driver), `generated-files.mts`, `holder-lock.mts`, `checklist.mts` | `hooks`, `hooks-check` |
| 문서와 commit | `check-documents.mts`, `documents-stamp.mts`, `check-commits.mts`, `owner-check.mts` | `docs-check`, `documents-stamp`, `owner-check`, `owner-validate` |
| 테스트와 CI | `run-tests.mts`, `ci-targets.mts`, `ci-passed.mts`, `target-report.mts` | `ci-targets`, `ci-summary`, `ci-passed` |
| Release | `release.mts` | `release-tag`, `release-tools`, `release-assets`, `release-publish`, `release-undraft`, `release-coverage` |

`docs/operations/tool-inventory.ko.md`는 각 도구가 어떤 구현들을 대체했고 어떤 동작을 가져오거나 버렸는지 기록합니다.

## 구조

- `scripts/kit/` — 도구와, package가 싣지 않는 kit 자신의 Makefile recipe인 `kit.mk`입니다(K1054). `scripts/kit/schema/`에 각 `config/<name>.json`의 JSON Schema가 있습니다.
- `tests/kit/` — 도구의 테스트입니다. `tests/kit/fixture/`는 테스트가 실행되는 fixture monorepo입니다.
- `config/layout.kit.yml` — 저장소가 복사할 수 있는 예시인 공통 layout rule(S5)입니다. `config/layout.yml`이 kit의 map을 더합니다.
- `package.json` — kit의 버전과 package가 담는 파일입니다.

## 저장소에서 사용

```sh
make install-tools TOOLS=npm   # install mise, and the node and npm of mise.toml, with the copied bootstrap (online)
make install-packages          # npm ci with that npm, @polyspec/kit included (online)
make kit-check                 # check the configuration against the schemas (offline)
```

저장소는 설치된 package로 kit을 도입하고 위 recipe를 자기 Makefile에 둡니다. kit은 저장소에 recipe를 include시키지 않습니다(K1054).
한 가지 방법은 설치된 package의 도구를 실행하는 `docs/examples/bootstrap.mk`입니다. 원하는 예시는 복사하고, 그 사본은 자기 파일로 고칩니다.
