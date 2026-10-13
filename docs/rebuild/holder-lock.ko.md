<!-- doc-id: rebuild-holder-lock -->
<!-- source-sha256: 91a82f276936c5fa7f9ef6384850e155bd7f4fe2ac7c74c56d81602b270f074a -->
# 재구현 기록: holder-lock

[English](holder-lock.md)

판정: **맞는 도구 없음.** kit은 `holder-lock.mts`를 유지합니다. 2026-10-13에 측정했습니다.

## 대상

- `scripts/kit/holder-lock.mts`

## 요구사항

| 항목 | 요구사항 |
|---|---|
| L1 | lock은 기록 전체와 함께 원자적으로 나타납니다: checkout, process, 그 시작 시각, 잡은 시각, command, token |
| L2 | 보유자는 process ID와 그 process의 시작 시각으로 식별되므로, 재사용된 ID는 보유자가 아닙니다 |
| L3 | 실행 중인 보유자의 lock은 보유자가 멈추거나 느린 동안에도 절대 빼앗기지 않습니다 |
| L4 | 끝난 보유자의 lock은 남아서 보고되며, 확인한 뒤 `clear`가 지울 때까지 있습니다 |
| L5 | 보유자만 lock을 놓으며, token으로 확인합니다 |

## 평가한 도구

| 도구 | 상태 | 판정 |
|---|---|---|
| proper-lockfile (npm) | 4.1.2, 마지막 release 2021 | 보유자가 timer로 새로 고치는 디렉터리 lock입니다. mtime이 `stale`보다 오래된 lock은 다른 process가 가져갑니다. 측정: SIGSTOP으로 멈춘 보유자가 아직 존재하는데도 2초 뒤(`stale: 2000`) 두 번째 process에 lock을 빼앗겼습니다. L3에 어긋나며, 기록(L1)과 시작 시각(L2)도 없습니다 |
| lockfile (npm) | 작성자가 deprecated 처리 | 제외 |
| `flock` | Node.js에 없음, native addon 필요 | 제외 |

## 맞는 도구가 없는 이유

Node.js의 lock library는 heartbeat로 살아 있는지를 판단하고 오래된 lock을 스스로 가져갑니다. kit의 보유자는 끝나지
않은 채 멈출 수 있는 긴 실행(전체 suite, 고정 port의 server)이므로, 살아 있는지는 process 자체에서 알아야 하며 끝난
보유자의 lock은 사람이 확인할 때까지 남아야 합니다.

## 재시도 조건

유지되는 lock library가 보유자를 process와 시작 시각으로 식별하거나, Node.js에 file lock이 생기면 다시 검토합니다.
