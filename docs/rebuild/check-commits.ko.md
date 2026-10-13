<!-- doc-id: rebuild-check-commits -->
<!-- source-sha256: 19102e4d75d70042d44f20e501512eea2507425b2b09d769a645dae252562877 -->
# 재구현 기록: check-commits

[English](check-commits.md)

판정: **맞는 도구 없음.** kit은 `check-commits.mts`를 유지합니다. K73을 위해 2026-10-13에 측정했습니다(scratchpad k73,
VERDICTS 6절).

## 대상

- `scripts/kit/check-commits.mts`

## 요구사항

| 항목 | 요구사항 |
|---|---|
| M1 | header는 config/commits.json의 type으로 된 `type(scope): Subject (#id)`입니다 |
| M2 | Subject는 ASCII 대문자로 시작하고, `(#id)` 앞에 마침표가 없으며, 최대 `subjectMax` 글자입니다 |
| M3 | 빈 줄 다음의 body는 줄마다 최대 `bodyMax` 글자이며, 긴 단어 하나는 예외입니다 |
| I1 | commit-items: commit은 checklist item 하나의 상태만 바꿉니다. commit이 추가한 행은 변경이 아닙니다 |
| I2 | commit-changelog: item을 끝내는 commit은 changelog와 그 번역도 바꿉니다 |

## 평가한 도구

| 도구 | 상태 | 판정 |
|---|---|---|
| @commitlint/lint | 21.2.3 | M1과 M3의 일부는 `type-enum`, `subject-max-length`, `body-leading-blank`과 header pattern으로 옮겨집니다. 기본 규칙으로는 3886개 message 중 10개가 다릅니다: `subject-full-stop`은 header 끝을 읽으므로 `(#id)` 앞의 마침표가 통과하고, `subject-case`는 숫자, backtick, `Ä`를 받아들이며, `body-max-line-length`는 URL만 예외로 두고, 끝의 공백은 header를 실패시킵니다. 같은 결과를 내려면 규칙 셋을 다시 쓰는 local plugin, adapter, package 다섯 개가 필요합니다. I1과 I2는 tracker와 diff를 읽으므로 commitlint의 범위 밖입니다 |

## 맞는 도구가 없는 이유

commitlint는 message 규칙의 절반을 다시 구현하는 plugin이 있어야만 kit과 일치하고, item 규칙은 어떤 경우에도 kit에
남으므로, kit은 자기 규칙을 그대로 두고 package 다섯 개만 더하게 됩니다.

## 재시도 조건

commitlint의 기본 규칙이 M2와 M3(접미사 앞의 마침표, ASCII 대문자, 긴 단어 예외)를 표현하게 되면 다시 검토합니다.
