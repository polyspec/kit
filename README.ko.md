# polyspec/kit

모든 polyspec 저장소가 공유하는 도구입니다. 저장소는 이를 package `@polyspec/kit`으로 설치하고, 그 `package.json`의 `kit.copies`가 나열하는
파일의 사본을 byte 단위로 같게 둡니다. 저장소끼리 다른 것은 `config/*.json`뿐입니다. kit은 어느 저장소에도 의존하지 않습니다.

## 도구

| 관심사 | 도구(`scripts/kit/`) | make target(`scripts/kit/kit.mk`) |
|---|---|---|
| Vendoring | `kit-sync.mts`, `kit-check.mts` | `kit-sync KIT_TAG=…`, `kit-check`, `kit-test` |
| 의존성 | `dependency-state.mts`, `dependency-review.mts`, `check-dependency-policy.mts`, `check-dependency-policy-mutation.mts`, `pin-python-dependency.mts` | `dependency-policy-check`, `dependency-policy-mutation-check`, `dependency-review RECORD=1 UPDATE=1` |
| Toolchain | `install-tools.mts`, `install-npm.mts`, `install-go.mts`, `install-ruff.mts`, `install-composer.mts`, `install-cargo-audit.mts`, `install-govulncheck.mts`, `install-rust.mts`, `check-toolchain.mts`, `check-cargo-downloads.mts` | `install-tools`, `toolchain-check`, `cargo-downloads-check`, `cargo-downloads-fetch` |
| 폴더 layout | `install-alint.mts`; alint가 `config/layout.kit.yml`의 공통 rule 위에 `config/layout.yml`을 돌림 | `layout-check` |
| Lint | `lint-python.mts`, `lint-php.mts`, `lint-rust.mts`, `lint-go.mts`, `lint-ts.mts`, 복사된 설정(docs/tool-inventory.md, Lint 설정)과 `install-vulture.mts`, `install-php-lint.mts`, `install-golangci-lint.mts`, `install-deadcode.mts`의 도구 | `lint-python`, `lint-php`, `lint-rust`, `lint-go`, `lint-ts` |
| Gate | `push-gate.mts`, `full-run.mts`, `git-hooks.mts`, `holder-lock.mts`, `checklist.mts` | `hooks`, `hooks-check`, `push-gate-commit`, `rerun-failed` |
| 문서와 commit | `check-documents.mts`, `documents-stamp.mts`, `check-commits.mts`, `owner-check.mts` | `documents-check`, `documents-stamp`, `commits-check`, `owner-check`, `owner-validate` |
| 테스트와 CI | `run-tests.mts`, `ci-targets.mts`, `ci-passed.mts`, `target-report.mts` | `ci-targets`, `ci-summary`, `ci-passed` |
| Release | `release.mts`, `release-consumer.mts`, `release-proof.mts` | `release-tools`, `release-verify`, `release-versions`, `release-assets`, `release-publish`, `release-undraft`, `release-coverage`, `release-go-tags`, `release-consumer`, `release-consumer-lock`, `release-proof` |

`docs/tool-inventory.ko.md`는 각 도구가 어떤 구현들을 대체했고 어떤 동작을 가져오거나 버렸는지 기록합니다.

## 구조

- `scripts/kit/` — 도구와, 저장소가 Makefile에 include하는 `kit.mk`입니다. `scripts/kit/schema/`에 각 `config/<name>.json`의 JSON Schema가 있습니다.
- `tests/kit/` — 도구의 테스트입니다. `tests/kit/fixture/`는 테스트가 실행되는 fixture monorepo입니다.
- `config/layout.kit.yml` — 모든 레포가 사본으로 두는 공통 layout rule(S5)입니다. `config/layout.yml`이 kit의 map을 더합니다.
- `package.json` — kit의 버전과, 저장소가 사본으로 두는 파일인 `kit.copies`입니다.

## 저장소에서 사용

```sh
make install-tools TOOLS=npm   # 복사된 bootstrap으로 packageManager의 npm을 설치합니다(온라인)
make install-packages          # 그 npm으로 npm ci를 실행하며 @polyspec/kit도 설치됩니다(온라인)
make kit-sync                  # 설치된 package의 사본을 package-lock.json의 버전으로 씁니다(오프라인)
make kit-check                 # package를 package-lock.json과, 사본을 package와, 설정을 schema와 비교합니다(오프라인)
```

같은 tag로 `kit-sync`를 다시 실행하면 바뀌는 것이 없습니다. vendored 파일은 kit에서 고쳐 다시 복사하며, 저장소에서 직접 고치지 않습니다.
