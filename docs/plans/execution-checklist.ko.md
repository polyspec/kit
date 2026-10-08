<!-- doc-id: execution-checklist -->
<!-- source-sha256: 54787b18b20be9f701162608851ff8bbfb30a718dbd7047e75eae984753e3d78 -->
<!-- source-sha256: a1dcd91e706968b7e6fede335f561ff0ab78222d6ac3b327391ddfbbfcd00de6 -->
<!-- source-sha256: 5c660cd2d7b214a5a80fa2c106340693b25d9e952d9ca43aedbf64e3eee3d79a -->
<!-- source-sha256: d51d4135fe5d701fbfb7e55eda06ce9d198444b6b7a423690709ad90c635793d -->
<!-- source-sha256: 30146bf2a5958bd2448f605a3c672389dc271312c840f7680f940ec4f7ddeaf8 -->
<!-- source-sha256: 2d7978ff8b6a9c6f09749c39ecb1f58c4c9c775f4a2f0380436c9c735daf7023 -->
<!-- source-sha256: 77b703c92ebb2348c66d8cc615bff737bc5827f8fddbd770eb9169299d1a3b92 -->
<!-- source-sha256: ef8a2705a5651ab67a2218022c70b953b8af092105adc76bfac21652aafe766c -->
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
| K5.1 | template, crudui, hyper, ordered-json, orm의 release 도구를 config/release.json을 읽는 하나로 합친다 | `scripts/kit/release.mjs` | `make kit-test` | [ ] |
| K5.2 | 아카이브를 <package>-<language>-<version>.<ext>로 이름 짓고 npm pack 결과의 이름을 바꾼다 | `scripts/kit/release.mjs` | `make kit-test` | [ ] |
| K5.3 | release 검증에서 선언된 각 Go 모듈의 tag go/vX.Y.Z를 요구한다 | `scripts/kit/release.mjs` | `make kit-test` | [ ] |
| K6.1 | push-gate, full-run, git-hooks, holder-lock을 config/checklist.json에서 체크리스트를 읽도록 합친다 | `scripts/kit/push-gate.mjs, full-run.mjs, git-hooks.mjs, holder-lock.mjs` | `make kit-test` | [ ] |
| K6.1-1 | Table, list, 번역 체크리스트와 hook을 config/checklist.json에서 읽는다 | `scripts/kit/checklist.mjs, schema/checklist.schema.json` | `make kit-test` | [o] |
| K6.1-2 | holder-lock을 합친다: 재사용된 process ID에 대비한 시작 시각, 홀더가 끝난 lock의 안전한 제거 | `scripts/kit/holder-lock.mjs` | `make kit-test` | [o] |
| K6.1-3 | Git hook을 멱등하게 설치하고 검사한다 | `scripts/kit/git-hooks.mjs` | `make kit-test` | [ ] |
| K6.1-4 | push-gate를 합친다: pre-push hook과 commit 검사가 active 상태의 항목을 거부한다 | `scripts/kit/push-gate.mjs` | `make kit-test` | [ ] |
| K6.1-5 | full-run guard를 합친다: tree 기록, lock, 실패한 target의 재실행 | `scripts/kit/full-run.mjs, target-run.mjs` | `make kit-test` | [ ] |
| K6.1-6 | gate의 make target을 추가하고 합친 내용을 도구 목록에 기록한다 | `scripts/kit/kit.mk, docs/tool-inventory.md(.ko)` | `make kit-test` | [ ] |
| K7.1 | 문서 검사(번역 쌍, 개정, 코드 블록, 링크, 상태 필드)를 표형과 목록형 체크리스트에 대해 하나로 합친다 | `scripts/kit/check-documents.mjs` | `make kit-test` | [ ] |
| K8.1 | owner-check, run-tests, target-report, ci-targets, ci-passed를 합친다 | `scripts/kit/` | `make kit-test` | [ ] |
| K8.2 | npm, Go, Python lint 환경, cargo-audit, govulncheck를 var/tools에 설치한다 | `scripts/kit/install-tools.mjs` | `make kit-test` | [o] |
| K8.2-1 | config/toolchain.json과 그 schema에 toolchain을 선언하고 선언한 파일에서 읽는다 | `scripts/kit/toolchain-declared.mjs`, `scripts/kit/schema/toolchain.schema.json` | `make kit-test` | [o] |
| K8.2-2 | npm, Go, ruff, Composer를 wrapper와 symbolic link 없이 var/tools에 설치한다 | `scripts/kit/install-tools.mjs` | `make kit-test` | [o] |
| K8.2-3 | cargo-audit와 govulncheck를 install-tools로 설치하고 make target을 추가한다 | `scripts/kit/install-tools.mjs`, `scripts/kit/kit.mk` | `make kit-test` | [o] |
| K8.2-4 | 실행 중인 Node.js, npm, Go, Rust, PHP, Python, Composer, ruff와 audit 도구를 선언과 대조한다 | `scripts/kit/check-toolchain.mjs` | `make kit-test` | [o] |
| K8.2-5 | 합친 toolchain 동작과 버린 동작을 도구 목록에 기록한다 | `docs/tool-inventory.md(.ko)` | `make kit-test` | [o] |
| K8.3 | 검사가 cargo를 오프라인으로 실행하기 전에 모든 Cargo.lock의 crate가 내려받아져 있는지 검사하고, --fetch로 내려받는다 | `scripts/kit/check-cargo-downloads.mjs` | `make kit-test` | [o] |
| K9 | release, toolchain, checklist, owner-checks와 의존성 파일의 스키마를 쓴다 | `scripts/kit/schema/` | `make kit-test` | [ ] |
| K10 | kit에 AGENTS.md, README, CI와 완료된 버전마다의 tag를 둔다 | `AGENTS.md(.ko), README.md(.ko), .github/workflows/ci.yml` | `make kit-test` | [ ] |
