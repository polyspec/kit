<!-- doc-id: rebuild-changelog -->
<!-- source-sha256: 779ee53e384620b626b81c119a12b71700c924a8e58617732dce92285cdd91a6 -->
# 재구현 기록: changelog

[English](changelog.md)

판정: **맞는 도구 없음.** kit은 changelog 검사를 자체 구현으로 유지합니다. 2026-10-13에 측정했습니다.

## 대상

- `scripts/kit/changelog.mts`

## 요구사항

polyspec의 changelog는 영어와 한국어로 사람이 직접 쓰며, checklist 항목 하나에 항목 하나를 둡니다(check-commits의
`commit-changelog`는 항목을 끝내는 commit에 그 항목을 요구합니다).

| 항목 | 요구사항 |
|---|---|
| C1 | `## Unreleased`가 첫 절이고 한 번만 나옵니다 |
| C2 | release 절은 괄호와 날짜 없는 `## X.Y.Z`이며, 최신이 먼저 오고 각각 한 번만 나옵니다 |
| C3 | 영어 파일과 한국어 파일은 같은 절을 같은 순서로 가집니다 |
| C4 | 파일에 check-documents의 문서 표식(`doc-id`, `source-sha256`)이 있습니다 |

## 평가한 도구

| 도구 | 상태 | 판정 |
|---|---|---|
| keep-a-changelog (npm) | 3.2.0, 2026-09-07 | Keep a Changelog 형식만 읽습니다: hyper와 orm의 changelog를 거부했고(`## 0.0.13`에서 "Syntax error in the release title"), crudui의 것도 거부했습니다(`doc-id` 표식). C1–C4는 그 규칙이 아닙니다 |
| git-cliff | 2.14.2 | conventional commit에서 changelog를 생성합니다. 써 둔 changelog를 검사하지 않으며, polyspec의 항목은 item마다 직접 씁니다 |
| release-please | 17.11.2 | release pull request에서 changelog와 version을 생성합니다. polyspec은 pull request 없이 main의 tag에서 release합니다 |

## 맞는 도구가 없는 이유

이 도구들은 commit에서 changelog를 생성하거나, 괄호 친 version과 날짜를 쓰는 Keep a Changelog 형식을 읽습니다.
polyspec은 changelog를 item마다 두 언어로 직접 쓰며, C1–C4는 그 관례의 규칙입니다. 검사는 check-documents의
Markdown 읽기 위에 있는 53줄입니다.

## 재시도 조건

polyspec이 keep-a-changelog가 읽는 Keep a Changelog 형식(`## [X.Y.Z] - date`)을 채택하거나, changelog를 commit에서
생성하게 되면 다시 검토합니다.
