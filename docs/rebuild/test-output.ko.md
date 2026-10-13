<!-- doc-id: rebuild-test-output -->
<!-- source-sha256: 6e3ac88738e34e5c93707feff08748c4200a2f9e49babbd9e49074e468c09282 -->
# 재구현 기록: test-output

[English](test-output.md)

판정: libtest, unittest, TeamCity 읽기는 **맞는 도구 없음**; TAP 읽기는 tap-parser로 **교체**합니다. 2026-10-13에
측정했습니다.

## 대상

- `scripts/kit/test-output.mts`

## 요구사항

run-tests는 각 test가 시작하고, 계속 실행되고, 끝나는 것을 출력하며, parity는 각 test의 결과를 읽습니다. 둘 다 S3의
표준 runner에서 실행 중의 event를 그때그때 받아야 합니다.

| 항목 | 형식 | 요구사항 |
|---|---|---|
| T1 | node:test TAP (parity) | 최상위 test마다 결과와 SKIP 또는 TODO directive |
| T2 | `go test -json` | 각 test와 package의 event |
| T3 | cargo test (libtest) text | 각 test의 시작과 결과를 그때그때 |
| T4 | unittest verbose text | 각 test의 시작과 결과를 그때그때 |
| T5 | PHPUnit TeamCity message | 각 test의 시작, 결과, 실패 내용 |

## 평가한 도구

| 도구 | 상태 | 판정 |
|---|---|---|
| tap-parser (npm) | 18.3.4 | T1: kit test 파일 8개와 경계 파일 하나의 TAP 결과 99개에서 kit과 같은 결과입니다. 차이는 하나로, 이름에 escape된 `\#`이 있을 때 tap-parser는 TAP 규칙대로 escape를 풀고 kit은 풀지 않습니다. **교체** |
| 줄마다 `JSON.parse` | Node.js | T2는 줄마다 JSON object 하나입니다. kit은 이미 그렇게 읽으며, event 처리는 run-tests의 진행 표시입니다 |
| teamcity-service-messages (npm) | 0.2.0 | TeamCity message를 쓰기만 하고 읽지 않습니다(T5). npm에서 TeamCity message를 읽는 도구를 찾지 못했습니다 |
| cargo test `--format json` | nightly 전용(`-Z unstable-options`) | 고정한 stable Rust에서는 T3 불가 |
| runner별 JUnit XML (gotestsum, nextest, unittest-xml-reporting, `--log-junit`) | 여러 가지 | 실행 중이 아니라 실행이 끝날 때 씁니다. T3–T5의 시작 event가 사라집니다 |

## 맞는 도구가 없는 이유

T3–T5에서는 runner가 실행 중에 기계 형식을 쓰지 않으며, 그 text나 TeamCity 출력을 읽는 library도 없습니다. kit은
표준 runner가 출력하는 줄을 읽습니다. T1에는 같은 결과를 읽고 TAP escape도 올바르게 처리하는 library가 있습니다.

## 재시도 조건

T3은 stable cargo test가 JSON을 쓰게 되면, T4는 unittest에 기계 형식이 생기면, T5는 유지되는 TeamCity message
reader가 생기면 다시 검토합니다. K125가 T1의 TAP reader를 tap-parser로 교체했습니다.
