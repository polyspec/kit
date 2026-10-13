<!-- doc-id: rebuild-toolchain -->
<!-- source-sha256: 65411d87d2d28cc87c2d9c3afb5b6191516b83aab8bfde8d4a4b4f7d673c9449 -->
# 재구현 기록: toolchain

[English](toolchain.md)

판정: release installer는 mise와 그 lock으로 **교체**합니다(등록할 item). npm bootstrap과, 저장소가 설치하지 않는
toolchain의 검증은 **맞는 도구 없음**입니다. 이 기록은 남는 부분을 다룹니다. 2026-10-13에 측정했습니다.

## 대상

- `scripts/kit/bootstrap/bootstrap-npm.mts`
- `scripts/kit/bootstrap/install-npm.mts`
- `scripts/kit/bootstrap/toolchain-declared.mts`
- `scripts/kit/check-toolchain.mts`

## 요구사항

| 항목 | 요구사항 |
|---|---|
| P1 | 내려받는 도구는 모두 정확한 release와 platform별 archive의 sha256으로 고정되며, 설치는 다른 archive를 거부합니다 |
| P2 | `packageManager`의 npm(sha512 포함)은 `npm ci` 전에 설치됩니다. 다른 npm은 lock을 다시 쓰거나 거부할 수 있기 때문입니다(S4) |
| P3 | 저장소가 검증만 하는 toolchain(Node.js, Rust, PHP)은 선언된 version으로 실행되며, 이를 offline으로 확인합니다 |
| P4 | `go.mod`의 go directive는 선언된 Go release와 일치합니다 |

## 평가한 도구

| 도구 | 상태 | 판정 |
|---|---|---|
| mise와 `mise.lock` | 2026.9.16 (2026-09-28). lock 문서는 더 이상 experimental로 표시하지 않습니다 | node, go, python, uv, ruff, alint, cargo-audit의 P1: `mise lock`이 platform별 archive의 sha256을 썼고, uv의 digest는 kit의 고정값과 같습니다. 빈틈: govulncheck(`go:` backend)와 `npm:npm`은 version만 기록합니다. `http:` Composer 항목은 선언하지 않으면 checksum이 없습니다. macos-arm64에서 cargo-audit의 aqua 항목은 x86_64 binary입니다. python build는 uv 0.12.24가 지정하는 build가 아니라 python-build-standalone의 최신 build(20261009)입니다. 이 빈틈을 선언하고 release installer를 **교체** |
| P2를 위한 mise | `npm:` backend는 npm으로 설치합니다 | 순환: 고정한 npm보다 먼저 npm이 있어야 합니다 |
| asdf | plugin, lock에 checksum 없음 | 제외 |
| proto | `.prototools`, 자체 plugin에만 checksum | 위 도구 중 mise보다 적게 다룹니다 |

## 맞는 도구가 없는 이유

P2는 bootstrap입니다. 고정한 npm은 어떤 package보다도, mise를 포함해, npm이 설치하기 전에 있어야 합니다. P3은 실행
중인 도구를 선언과 비교합니다. mise는 도구를 설치할 뿐, 자신이 관리하지 않는 도구는 검증하지 않습니다. P4는 Go를
설치하기 전에 `go.mod`를 읽으므로 `go mod edit -json`으로는 읽을 수 없습니다.

## 재시도 조건

P2는 npm이나 corepack이 `packageManager`의 release를 digest와 함께 설치하게 되면, P3은 mise가 관리하지 않는 도구를
선언에 비추어 검증하게 되면 다시 검토합니다.
