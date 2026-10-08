<!-- doc-id: execution-checklist -->
<!-- source-sha256: ca0c537cd0463e3104af2e8013baca6f787c504f58ba207bd46208bf7add65a7 -->
# 실행 체크리스트

[English](execution-checklist.md)

작업 상태는 `[ ]` 대기, `[~]` 진행 중, `[o]` 완료, `[!]` 원인과 재시도 조건을 가진 우회입니다. 작업은 그것을 끝내는 commit에서, 소유 명령이 통과한 뒤에 `[o]`가 됩니다.

## 도구 통합

| ID | 작업 | 산출물 | 검증 | 상태 |
|---|---|---|---|---|
| K1 | 다섯 저장소의 공유 도구를 크기와 kit의 기반 구현과 함께 목록으로 만든다 | `docs/tool-inventory.md(.ko)` | `make kit-test` | [o] |
| K2.1 | crudui의 npm workspaces, tagged 패키지, npm 범위 판정, 중복 검사를 의존성 상태로 옮긴다 | `scripts/kit/dependency-state.mjs` | `make kit-test` | [o] |
| K2.2 | template의 Composer 플랫폼 규칙을 유지하고 crudui의 composer manifest도 그 규칙으로 읽는다 | `scripts/kit/check-dependency-policy.mjs` | `make kit-test` | [o] |
| K2.3 | 정책 형식(composerPlatforms, pythonManifests, exceptions)과 스키마를 확정한다 | `scripts/kit/schema/dependency-policy.schema.json` | `make kit-test` | [o] |
| K2.4 | npm workspaces 둘, tagged 패키지, Composer, PyPI 픽스처와 mutation 검사로 의존성 도구를 시험한다 | `tests/kit/` | `make kit-test` | [o] |
| K3.1 | 추적되는 모든 Cargo.lock을 sha256과 함께 검토 기록에 쓴다 | `scripts/kit/dependency-state.mjs` | `make kit-test` | [o] |
| K3.2 | config/toolchain.json의 cargo-audit을 var/tools에 설치하고 설치된 release는 건너뛴다 | `scripts/kit/install-cargo-audit.mjs` | `make kit-test` | [o] |
| K3.3 | 각 Cargo.lock의 advisory를 cargo-audit과 RustSec 데이터베이스에서 검토 때만 조회해 기록한다 | `scripts/kit/dependency-review.mjs` | `make kit-test` | [o] |
| K4.1 | 모든 go.mod의 직접 의존성을 최신 stable과 비교해 검토한다 | `scripts/kit/dependency-review.mjs` | `make kit-test` | [o] |
| K4.2 | var/tools에 설치한 govulncheck로 Go advisory를 기록한다 | `scripts/kit/install-tools.mjs` | `make kit-test` | [o] |
| K5.1 | template, crudui, hyper, ordered-json, orm의 release 도구를 config/release.json을 읽는 하나로 합친다 | `scripts/kit/release.mjs` | `make kit-test` | [o] |
| K5.2 | 아카이브를 <package>-<language>-<version>.<ext>로 이름 짓고 npm pack 결과의 이름을 바꾼다 | `scripts/kit/release.mjs` | `make kit-test` | [o] |
| K5.3 | release 검증에서 선언된 각 Go 모듈의 tag go/vX.Y.Z를 요구한다 | `scripts/kit/release.mjs` | `make kit-test` | [o] |
| K5.4 | tag의 모든 archive를 commit된 lock으로 깨끗한 npm과 Composer consumer project에 설치하고 package마다 smoke command를 실행한다 | `scripts/kit/release-consumer.mjs`, `scripts/kit/release-consumer-config.mjs` | `make kit-test` | [o] |
| K5.5 | release된 tag를 저장소 밖에서 증명한다: release asset, consumer 설치, git-tag 설치, Go module | `scripts/kit/release-proof.mjs` | `make kit-test` | [o] |
| K6.1 | push-gate, full-run, git-hooks, holder-lock을 config/checklist.json에서 체크리스트를 읽도록 합친다 | `scripts/kit/push-gate.mjs, full-run.mjs, git-hooks.mjs, holder-lock.mjs` | `make kit-test` | [o] |
| K6.1-1 | Table, list, 번역 체크리스트와 hook을 config/checklist.json에서 읽는다 | `scripts/kit/checklist.mjs, schema/checklist.schema.json` | `make kit-test` | [o] |
| K6.1-2 | holder-lock을 합친다: 재사용된 process ID에 대비한 시작 시각, 홀더가 끝난 lock의 안전한 제거 | `scripts/kit/holder-lock.mjs` | `make kit-test` | [o] |
| K6.1-3 | Git hook을 멱등하게 설치하고 검사한다 | `scripts/kit/git-hooks.mjs` | `make kit-test` | [o] |
| K6.1-4 | push-gate를 합친다: pre-push hook과 commit 검사가 active 상태의 항목을 거부한다 | `scripts/kit/push-gate.mjs` | `make kit-test` | [o] |
| K6.1-5 | full-run guard를 합친다: tree 기록, lock, 실패한 target의 재실행 | `scripts/kit/full-run.mjs, target-run.mjs` | `make kit-test` | [o] |
| K6.1-6 | gate의 make target을 추가하고 합친 내용을 도구 목록에 기록한다 | `scripts/kit/kit.mk, docs/tool-inventory.md(.ko)` | `make kit-test` | [o] |
| K7.1 | 문서 검사(번역 쌍, 개정, 코드 블록, 링크, 상태 필드)를 표형과 목록형 체크리스트에 대해 하나로 합친다 | `scripts/kit/check-documents.mjs` | `make kit-test` | [o] |
| K7.2 | 표형과 목록형 체크리스트를 config/checklist.json 하나에서 읽는 함수 하나로(관대한 수준과 엄격한 수준) 읽고, checklist-rows.mjs와 ci-targets의 자체 lock을 없앤다 | `scripts/kit/checklist.mjs, check-documents.mjs, ci-targets.mjs, schema/checklist.schema.json, schema/documents.schema.json` | `make kit-test` | [o] |
| K8.1 | owner-check, run-tests, target-report, ci-targets, ci-passed를 합친다 | `scripts/kit/` | `make kit-test` | [o] |
| K8.1-1 | template, crudui, hyper의 owner-check와 ordered-json의 owner map을 config/owner-checks.json을 읽는 도구 하나로 합친다 | `scripts/kit/owner-check.mjs` | `make kit-test` | [o] |
| K8.1-2 | 테스트 실행기를 진행 reporter, 테스트별 timeout, 테스트가 없는 실행의 실패와 함께 합친다 | `scripts/kit/run-tests.mjs` | `make kit-test` | [o] |
| K8.1-3 | template, crudui, hyper, ordered-json, orm의 target report, ci-targets, ci-passed를 합친다 | `scripts/kit/ci-targets.mjs, target-report.mjs, ci-passed.mjs` | `make kit-test` | [o] |
| K8.1-4 | orm의 commit subject 검사를 공유 git 위생 검사로 가져온다 | `scripts/kit/check-commits.mjs` | `make kit-test` | [o] |
| K8.2 | npm, Go, Python lint 환경, cargo-audit, govulncheck를 var/tools에 설치한다 | `scripts/kit/install-tools.mjs` | `make kit-test` | [o] |
| K8.2-1 | config/toolchain.json과 그 schema에 toolchain을 선언하고 선언한 파일에서 읽는다 | `scripts/kit/toolchain-declared.mjs`, `scripts/kit/schema/toolchain.schema.json` | `make kit-test` | [o] |
| K8.2-2 | npm, Go, ruff, Composer를 wrapper와 symbolic link 없이 var/tools에 설치한다 | `scripts/kit/install-tools.mjs` | `make kit-test` | [o] |
| K8.2-3 | cargo-audit와 govulncheck를 install-tools로 설치하고 make target을 추가한다 | `scripts/kit/install-tools.mjs`, `scripts/kit/kit.mk` | `make kit-test` | [o] |
| K8.2-4 | 실행 중인 Node.js, npm, Go, Rust, PHP, Python, Composer, ruff와 audit 도구를 선언과 대조한다 | `scripts/kit/check-toolchain.mjs` | `make kit-test` | [o] |
| K8.2-5 | 합친 toolchain 동작과 버린 동작을 도구 목록에 기록한다 | `docs/tool-inventory.md(.ko)` | `make kit-test` | [o] |
| K8.3 | 검사가 cargo를 오프라인으로 실행하기 전에 모든 Cargo.lock의 crate가 내려받아져 있는지 검사하고, --fetch로 내려받는다 | `scripts/kit/check-cargo-downloads.mjs` | `make kit-test` | [o] |
| K8.4 | config/toolchain.json이 가리키는 Python package를 var/tools의 ruff로 lint하고 format을 검사한다 | `scripts/kit/lint-python.mjs` | `make kit-test` | [o] |
| K9 | release, toolchain, checklist, owner-checks와 의존성 파일의 스키마를 쓴다 | `scripts/kit/schema/` | `make kit-test` | [o] |
| K10 | kit에 AGENTS.md, README, CI와 완료된 버전마다의 tag를 둔다 | `AGENTS.md(.ko), README.md(.ko), .github/workflows/ci.yml` | `make kit-test` | [o] |
| K11 | scripts/kit의 여러 module이 되풀이하는 함수와 상수를 공유 module 하나로 옮기고, 두 번째 사본은 test로 실패시킨다 | `scripts/kit/, tests/kit/duplication.test.mjs` | `make kit-test` | [o] |
| K11-1 | full-run의 runMakeTarget과 ci-targets의 runLogged를 log 형식 하나를 쓰는 runner 하나로 합친다 | `scripts/kit/target-report.mjs, full-run.mjs, ci-targets.mjs` | `make kit-test` | [o] |
