# polyspec/kit

모든 polyspec 저장소가 공유하는 도구입니다. 저장소는 `scripts/kit/`와 `tests/kit/`(`kit.json`에 나열)의 사본을 byte 단위로 같게 두며,
저장소끼리 다른 것은 `config/*.json`뿐입니다. kit은 어느 저장소에도 의존하지 않습니다.

## 도구

| 관심사 | 도구(`scripts/kit/`) | make target(`scripts/kit/kit.mk`) |
|---|---|---|
| Vendoring | `kit-sync.mjs`, `kit-check.mjs` | `kit-sync KIT_TAG=…`, `kit-check`, `kit-test` |
| 의존성 | `dependency-state.mjs`, `dependency-review.mjs`, `check-dependency-policy.mjs`, `check-dependency-policy-mutation.mjs`, `pin-python-dependency.mjs` | `dependency-policy-check`, `dependency-policy-mutation-check`, `dependency-review RECORD=1 UPDATE=1` |
| Toolchain | `install-tools.mjs`, `install-npm.mjs`, `install-go.mjs`, `install-ruff.mjs`, `install-composer.mjs`, `install-cargo-audit.mjs`, `install-govulncheck.mjs`, `check-toolchain.mjs`, `check-cargo-downloads.mjs` | `install-tools`, `toolchain-check`, `cargo-downloads-check`, `cargo-downloads-fetch` |
| Python | `lint-python.mjs` | `lint-python` |
| Gate | `push-gate.mjs`, `full-run.mjs`, `git-hooks.mjs`, `holder-lock.mjs`, `checklist.mjs` | `hooks`, `hooks-check`, `push-gate-commit`, `rerun-failed` |
| 문서와 commit | `check-documents.mjs`, `check-commits.mjs`, `owner-check.mjs` | `documents-check`, `commits-check`, `owner-check`, `owner-validate` |
| 테스트와 CI | `run-tests.mjs`, `ci-targets.mjs`, `ci-passed.mjs`, `target-report.mjs` | `ci-targets`, `ci-summary`, `ci-passed` |
| Release | `release.mjs`, `release-consumer.mjs`, `release-proof.mjs` | `release-verify`, `release-versions`, `release-assets`, `release-publish`, `release-coverage`, `release-go-tags`, `release-consumer`, `release-consumer-lock`, `release-proof` |

`docs/tool-inventory.ko.md`는 각 도구가 어떤 구현들을 대체했고 어떤 동작을 가져오거나 버렸는지 기록합니다.

## 구조

- `scripts/kit/` — 도구와, 저장소가 Makefile에 include하는 `kit.mk`입니다. `scripts/kit/schema/`에 각 `config/<name>.json`의 JSON Schema가 있습니다.
- `tests/kit/` — 도구의 테스트입니다. `tests/kit/fixture/`는 테스트가 실행되는 fixture monorepo입니다.
- `kit.json` — vendored 디렉터리와 이 tree의 버전입니다.

## 저장소에서 사용

```sh
make kit-sync KIT_TAG=v0.0.4   # tag의 vendored 파일을 복사하고 .kit/kit.lock.json을 씁니다(온라인)
make kit-check                 # 파일을 lock과, 설정을 schema와 비교합니다(오프라인)
make kit-test                  # vendored 테스트를 실행합니다(오프라인)
```

같은 tag로 `kit-sync`를 다시 실행하면 바뀌는 것이 없습니다. vendored 파일은 kit에서 고쳐 다시 복사하며, 저장소에서 직접 고치지 않습니다.
