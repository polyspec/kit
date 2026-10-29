<!-- doc-id: rebuild-check-commits -->
<!-- source-sha256: e787f3669f03be3ad4e177eb3625d157357559ccceda1a151accc039cf2bf634 -->
# 재구현 기록: check-commits

[English](check-commits.md)

판정: **맞는 도구 없음.** kit은 `check-commits.mts`를 유지합니다. K73을 위해 2026-10-13에 측정했습니다(scratchpad k73,
VERDICTS 6절). commitlint와 비교했던 message 형식 규칙은 K805가 지웠습니다.

## 대상

- `scripts/kit/check-commits.mts`

## 요구사항

| 항목 | 요구사항 |
|---|---|
| A1 | commit-ai-footer: message에 AI 도구의 co-author나 session trailer가 없습니다 |
| A2 | commit-ai-identity: author와 committer는 AI 도구가 아닙니다 |
| R1 | commit-red: checklist 행을 done으로 옮기는 commit은 Red 또는 No-Red 줄을 적습니다 |
| R2 | commit-fix-test: fix commit은 test 파일을 바꾸거나 그 red를 적습니다 |

## 평가한 도구

| 도구 | 상태 | 판정 |
|---|---|---|
| @commitlint/lint | 21.2.3 | A1은 local plugin의 header나 footer pattern으로 옮겨집니다. A2는 git이 commit에 주는 identity를, R1과 R2는 checklist와 staged diff를 읽으므로 commitlint의 범위 밖입니다 |

## 맞는 도구가 없는 이유

R1과 R2는 어떤 message linter도 읽지 않는 checklist와 diff를 읽으므로, kit은 그 규칙을 그대로 두고 A1을 위해 package 다섯 개만 더하게 됩니다.

## 재시도 조건

staged diff와 변경의 checklist 행을 읽는 commit-msg 도구가 나오면 다시 검토합니다.
