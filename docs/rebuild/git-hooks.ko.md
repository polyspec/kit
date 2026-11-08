<!-- doc-id: rebuild-git-hooks -->
<!-- source-sha256: 1b57d8c3c1cc934efa3c1bb9f8ffbfb45a018125598fbf65c5314b5343339c06 -->
# 재구현 기록: git-hooks

[English](git-hooks.md)

판정: **맞는 도구 없음.** kit은 `git-hooks.mts`를 유지합니다. 2026-10-13에 측정했습니다. K1053부터 kit은 자기 hook을 쓰지 않으므로 H2는 없어졌습니다.

## 대상

- `scripts/kit/git-hooks.mts`

## 요구사항

| 항목 | 요구사항 |
|---|---|
| H1 | Git은 호출자가 `--hooks-path`로 넘긴 폴더의 추적되는 hook을 실행합니다(`core.hooksPath`) |
| H3 | 호출자가 `--hook`으로 넘긴 hook은 실행할 수 있습니다 |
| H4 | 나열된 hook이 없거나 실행할 수 없을 때, 또는 `core.hooksPath`가 설정되지 않았을 때 `make hooks-check`가 실패합니다 |

## 평가한 도구

| 도구 | 상태 | 판정 |
|---|---|---|
| lefthook (npm) | 2.1.14 | H1: 추적되는 디렉터리가 아니라 `.git/hooks`에 설치하고, 자체 `prepare-commit-msg` hook을 더했습니다. H4: 설치된 `pre-push`를 지운 뒤에도 `lefthook check-install`이 0으로 끝났습니다 |
| husky (npm) | 9.1.7 | H1: npm `prepare` script에서 `core.hooksPath`를 `.husky/_`로 설정합니다. 검사(H4)는 없습니다 |

## 맞는 도구가 없는 이유

이 도구들이 더하는 것은 `git config core.hooksPath` 호출 하나인데, `make hooks`가 그 호출을 합니다. H4, 즉 나열된 hook이
제자리에 있는지의 검사는 이 도구들의 관심사가 아니므로, kit은 그것을 그대로 두고 의존성만 더하게 됩니다.

## 재시도 조건

hook 관리자가 자기 hook이 설치되어 있고 바뀌지 않았는지를 검사하고(H4) 추적되는 hook 디렉터리를 읽게 되면 다시
검토합니다.
