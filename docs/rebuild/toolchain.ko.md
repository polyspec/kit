<!-- doc-id: rebuild-toolchain -->
<!-- source-sha256: 374a0553d2a0191967b36be13391954cfc4910b0d22fe5655b7c2f94fd8e562c -->
# 재구현 기록: toolchain

[English](toolchain.md)

판정: **교체됨** — kit이 자체 release installer로 설치하던 모든 도구를 `mise.lock`을 쓰는 mise가 설치합니다(K127). kit에 남는
세 부분, 즉 npm bootstrap, mise 자체의 설치, 저장소가 설치하지 않는 toolchain의 검증은 **맞는 도구 없음**입니다. 이 기록은
그 부분을 다룹니다. 2026-10-13(K74)과 2026-10-14(K127, mise 2026.10.8)에 측정했습니다.

## 대상

- `scripts/kit/bootstrap/bootstrap.mts`
- `scripts/kit/bootstrap/install-mise.mts`
- `scripts/kit/bootstrap/install-npm.mts`
- `scripts/kit/bootstrap/install-tool.mts`
- `scripts/kit/bootstrap/tool-wrappers.mts`
- `scripts/kit/bootstrap/toolchain-declared.mts`
- `scripts/kit/check-toolchain.mts`

## 요구사항

| 항목 | 요구사항 |
|---|---|
| P1 | 내려받는 도구는 모두 정확한 release와 platform별 archive의 sha256으로 고정되며, 설치는 다른 archive를 거부합니다 |
| P2 | `packageManager`의 npm(sha512 포함)은 `npm ci` 전에 설치됩니다. 다른 npm은 lock을 다시 쓰거나 거부할 수 있기 때문입니다(S4) |
| P3 | 저장소가 검증만 하는 toolchain(Node.js, Rust, PHP)은 선언된 version으로 실행되며, 이를 offline으로 확인합니다 |
| P4 | Go가 없는 checkout에도 고정한 release의 Go가 설치되고, 모든 `go.mod`의 go directive는 그 release와 일치합니다 |
| P5 | checkout 밖은 아무것도 바뀌지 않습니다. 도구와 그 cache, 설정은 `var/tools` 아래에 있습니다 |

## 평가한 도구

| 도구 | 상태 | 판정 |
|---|---|---|
| mise와 `mise.lock` | 2026.10.8. `mise.toml`이 도구를 선언하고, `make toolchain-lock`이 `mise lock --platform linux-x64,linux-arm64,macos-arm64,macos-x64`를, `make install-tools`가 `mise install --locked`를 실행합니다 | Go, Python, uv, ruff, alint, golangci-lint, deadcode, govulncheck, cargo-audit, cargo-nextest, cargo-deny, Composer, vulture의 release installer를 **교체**합니다(P1, P4, P5). 아래 빈틈은 각각 결정했습니다 |
| P2를 위한 mise | `npm:` backend는 npm으로 설치합니다 | 순환: 고정한 npm보다 먼저 npm이 있어야 합니다 |
| mise 자체를 위한 mise | npm package `@jdxcode/mise`는 binary가 없고, preinstall script에서 lock되지 않은 platform package를 가져옵니다 | 맞는 도구 없음: bootstrap이 `config/toolchain.json` `mise`의 sha256으로 release archive에서 mise를 설치합니다 |
| asdf | plugin, lock에 checksum 없음 | 제외 |
| proto | `.prototools`, 자체 plugin에만 checksum | 위 도구 중 mise보다 적게 다룹니다 |

측정에서 찾은 빈틈과 각각의 결정:

- npm은 `packageManager`의 sha512와 함께 bootstrap에 남습니다(P2).
- Composer는 파일 하나이므로 `mise.toml`이 `http:composer` 항목에 getcomposer.org의 `composer.phar.sha256sum`에서 가져온
  `checksum = "sha256:…"`을 선언하고, `mise.lock`이 이를 기록합니다.
- cargo-audit은 `"github:rustsec/rustsec" = { version, version_prefix = "cargo-audit/v" }`이며, aarch64-apple-darwin과
  x86_64-linux의 native binary를 checksum과 함께 lock합니다(aqua 항목은 macos-arm64에 x86_64 binary를 주었습니다).
- cargo-nextest는 `"github:nextest-rs/nextest" = { version, version_prefix = "cargo-nextest-" }`이고, cargo-deny는 mise
  registry의 `aqua:EmbarkStudios/cargo-deny`인 `cargo-deny`입니다(K143). `mise lock`은 네 platform의 archive를 각각 sha256으로
  pin했고, 모두 native binary입니다(nextest는 두 Mac에 universal binary 하나, cargo-deny는 Linux에 static musl binary). mise
  2026.10.8, nextest 0.9.146, cargo-deny 0.20.2로 측정했습니다.
- govulncheck와 deadcode는 `go:` backend가 build하며, `mise.lock`은 release만 기록합니다. 그 무결성은 Go의 것입니다. Go는
  `GOFLAGS=-mod=readonly`로 모든 module을 checksum database(`GOSUMDB`, 예외 module 없음)에 비추어 확인합니다. 이것이 lock
  검사(`toolchain-mise.mts`의 `miseLockFindings`)의 유일한 선언된 예외입니다.
- Python: `mise.lock`은 정확한 python-build-standalone build를 URL과 sha256으로 고정합니다. uv는 더 이상 Python을 설치하지
  않습니다. `UV_PYTHON_DOWNLOADS=never`이고, kit의 uv는 mise의 Python(`UV_PYTHON`)으로 실행됩니다. `pythonBuild`와 `uv`는
  `config/toolchain.json`에서 빠졌습니다.
- vulture는 `pypi:` 도구입니다. `mise.lock`은 mise가 `.mise/locks` 아래에 쓰는 uv lock의 digest를 담습니다. mise는 그
  환경을 제자리에서 build하므로 console script가 존재하는 interpreter를 가리킵니다(K77의 script를 깨뜨린 이동은 일어나지
  않습니다).
- Rust는 rustup에 남습니다. rustup과 `rust-toolchain.toml`은 Rust 생태계 자체의 toolchain 방식이고, mise의 rust backend도
  결국 rustup을 구동하므로, 층을 하나 더 두어도 얻는 것이 없습니다.

## 맞는 도구가 없는 이유

P2는 bootstrap입니다. 고정한 npm은 npm이 어떤 package를 설치하기 전에 있어야 하고, mise는 무엇이든 설치하기 전에 있어야
하므로, bootstrap이 둘 다 release 파일에서 digest로 설치합니다. P3은 실행 중인 도구를 선언과 비교합니다. mise는 도구를
설치할 뿐, 자신이 관리하지 않는 도구는 검증하지 않으므로 `check-toolchain.mts`가 남습니다. 이 도구는 `mise.toml`의 각
도구를 shim으로 실행하고, Node.js, Rust, PHP를 검증하고, `mise.lock`이 모든 도구를 고정하는지 요구하며, `mise.toml`의 go와
python을 kit의 pin과 비교합니다.

## 재시도 조건

P2는 npm이나 corepack이 `packageManager`의 release를 digest와 함께 설치하게 되면, mise의 설치는 mise가 lock된 package를
내놓으면, P3은 mise가 관리하지 않는 도구를 선언에 비추어 검증하게 되면, `go:` 도구의 예외는 `mise lock`이 그 checksum을
기록하게 되면 다시 검토합니다.
