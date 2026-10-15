<!-- doc-id: tool-inventory -->
<!-- source-sha256: 55363ca4136751a5af0a8287cf94b9e56d86df8d1a4c7d0fe56b632ecadc9e68 -->

# 도구 목록

[English](tool-inventory.md)

공유 도구는 여러 구현으로 존재합니다. 이 목록은 각 도구가 어디에 있는지, 크기가 얼마인지, kit이 기반으로 삼는 구현이
무엇인지 기록합니다. 도구를 kit으로 합칠 때는 구현들 중 더 넓은 동작을 택하고, kit 테스트로 고정하고, 모든 사본을 vendored
파일로 바꿉니다. 5개 저장소의 작업 트리에서 잰 줄 수입니다.

| 도구 | template | crudui | hyper | ordered-json | orm | kit의 기반 |
|---|---|---|---|---|---|---|
| release | `scripts/release.mts` 388 | 357 | 317 | `scripts/release.py` 383 | `scripts/release/release.mts` 302 | template, ordered-json의 Go tag 규칙 포함 |
| push-gate | 125 | 149 | 121 | `push_gate.py` 192 | `scripts/check/push-gate.mts` 121 | crudui |
| full-run | 199 | 240 | 246 | `full_run.py` 285 | `scripts/check/full-run.mts` 328 | orm |
| git-hooks | 27 | 없음 | 28 | 없음 | 없음 | hyper |
| holder-lock | 134 | 275 | 111 | 없음 | 없음 | crudui |
| check-documents | 151 | 95 | 70 | `docs_check.py` | 없음 | template |
| owner-check | 219 | 254 | 178 | `owner_check.py` 171 | 없음 | crudui |
| run-tests | 289 | 282 | 159 | `test.py` | 없음 | template |
| target-report, ci-targets | 100, 52 | 73, 47 | 없음 | `ci_run.py` | 없음 | template |
| ci-passed | 36 | 39 | 없음 | `ci_run.py` | `scripts/check/ci-passed.mts` 32 | template |
| install-tools | 189 | 없음 | 없음 | `toolchains.py` | 없음 | template |
| 의존성 상태, 검토, 게이트 | v0.0.2부터 kit에 있음 | 317, 288, 185 | 없음 | 없음 | 없음 | crudui, kit과 병합 |
| github-ruleset | 182 | 없음 | 164 | 없음 | 없음 | 제거(0.x에는 ruleset이 없음) |

## 결정

- 모든 도구는 Node입니다: scripts/kit의 TypeScript source(`.mts`)이고, build가 dist에 `.mjs`로 씁니다. ordered-json의 Python 도구는 대체하고 삭제합니다.
- 저장소끼리 다른 것은 `config/*.json`뿐입니다. 도구의 코드에는 저장소 이름이나 경로를 넣지 않습니다.
- `github-ruleset`은 vendored하지 않습니다. 0.x 규칙에는 pull request도 ruleset도 없으므로 template과 hyper에서 파일과 Make
  target을 제거합니다.

## Toolchain (K8.2)

checkout의 도구는 `mise.lock`을 쓰는 mise가 설치합니다(K127). `mise.toml`이 도구를 선언하고 `mise.lock`이 각 archive를
mise bootstrap의 플랫폼인 linux-x64, linux-arm64, macos-arm64, macos-x64의 sha256으로 고정합니다. `make toolchain-lock`이 lock을 쓰고(`scripts/kit/toolchain-lock.mts`, `mise
lock`), `make install-tools`가 그것을 설치한 뒤(`scripts/kit/install-tools.mts`, `mise install --locked`) mise가 설치하지 않는
것을 설치합니다. wheel backend(`pythonBackend`), `config/phpunit`과 `config/php-lint`의 Composer project, rustup으로
설치하는(`install-rust.mts`) `rust-toolchain.toml`의 toolchain과 그 component(checkout에서 파일을 읽는
`rustup toolchain install --no-self-update`; rustup 1.28은 cargo가 처음 실행될 때 더는 설치하지 않습니다)와 `exceptions`의
Rust channel, symbol extractor입니다.
bootstrap(`make install-tools TOOLS=npm`, `scripts/kit/bootstrap/bootstrap.mts`)은 `packageManager`의 npm과, `config/toolchain.json`
`mise`의 sha256으로 mise 자체를 설치합니다. `install-tool.mts`가 각각을 대상 옆에서 만들고 거기서 확인한 뒤 rename하므로, 두
번째 실행은 아무것도 바꾸지 않습니다. mise는 data, cache, state, config와 설치물, shim을 `var/tools/mise`에 두며, wrapper
`var/tools/bin/mise`가 그 환경을 정합니다. checkout 밖은 아무것도 바뀌지 않습니다. `mise.toml`의 도구는 `var/tools/mise/shims`의
shim으로 실행합니다(`scripts/kit/mise-tools.mts`). kit.mk는 checkout의 mise 환경을 모든 recipe에 export하고 `var/tools/bin`과 shim을
PATH 맨 앞에 둡니다. `var/tools/bin`에는 kit이 checkout의 선언에 따라 쓰는 wrapper만 있습니다: bootstrap의 mise, npm, npx와
선언된 Composer project의 phpunit, phpcs, phpstan입니다. `make install-tools`는 설치 전에 그 밖의 file을 모두 지웁니다. 예를
들어 이제 mise에서 오는 도구에 대해 이전 kit이 쓴 wrapper는 그 shim을 가립니다(K149). `scripts/kit/check-toolchain.mts`는 실행 중인 도구를 선언과 대조합니다. bootstrap과 mise가 설치하지 않는
도구의 선언은 `scripts/kit/bootstrap/toolchain-declared.mts`가, `mise.toml`의 도구와 `mise.lock`의 digest는
`scripts/kit/toolchain-mise.mts`가, Rust와 go.mod 파일은 `scripts/kit/toolchain-files.mts`가 각 ecosystem의 도구로 읽습니다. Make
target은 `install-tools`와 `toolchain-lock`(`ONLINE`을 통한 online), `toolchain-check`(offline, `TOOLS`가 도구를 제한)입니다.
Rust는 rustup에 남습니다. rustup과 `rust-toolchain.toml`은 Rust 생태계 자체의 toolchain 방식이고, mise의 rust backend도 결국
rustup을 구동하므로, 층을 하나 더 두어도 얻는 것이 없습니다. mise의 빈틈마다 내린 결정은 docs/rebuild/toolchain.md에 있습니다.

### Go 취약점 (K53)

`make dependency-review`는 Go lock(`go.mod` 옆의 `go.sum`)마다 govulncheck에 취약점을 묻고, 그 module 디렉터리에서 실행합니다.
조회는 `./...` 대신 module의 package를 명시합니다. 이유: `./...`은 module 아래의 모든 디렉터리를 걸으며, mise가
`var/tools` 아래에 설치하는 Go도 그중 하나입니다. govulncheck는 이를 거부하므로(`outside main module`) 모든 RECORD 실행이
실패했습니다. `./...`은 디렉터리를 제외할 수 없으므로, `var/`를 포함한 module은 작업 디렉터리와 상관없이 그것을 걷습니다.

- `goPackagePatterns`(`dependency-state.mts`)는 module의 추적되거나 새로운 `.go` 파일마다 디렉터리를 `./...`의 규칙으로 고릅니다.
  이름이 `.` 또는 `_`로 시작하는 디렉터리, `testdata`, `vendor`는 건너뛰며, 하위 nested module(자체 `go.mod`)의 디렉터리도
  건너뜁니다. `checkedFiles`가 `var/`, `node_modules`, `.tools`를 제외하므로, 설치나 출력의 디렉터리는 명시되지 않습니다.
- `goPackages`(`dependency-review.mts`)는 그 패턴에 `go list -e`를 실행하고, 빌드 가능한 파일이 있는 package의 import path만
  남깁니다. `./...`은 파일이 모두 build 제약으로 제외되는 디렉터리(예: `//go:build ignore` 생성기)를 건너뛰고, govulncheck는 그
  패턴을 거부하므로 조회도 같은 방식으로 뺍니다. 빌드 가능한 package가 없는 module에는 취약점이 없습니다. 그 안의 코드가 취약한
  함수를 호출하지 않기 때문입니다.
- 이전과 같이 lock마다 취약점 결과 하나를 유지합니다. lock은 `go.sum`의 디렉터리로 module에 대응합니다.
- 한계: module 디렉터리 밖을 가리키는 `replace` 지시문의 package는 명시되지 않으므로, 그 module에서는 스캔되지 않습니다(이전
  `./...`도 스캔하지 않았습니다). `var`, `node_modules`, `.tools`라는 이름의 디렉터리 아래 Go package도 스캔되지 않습니다. kit의
  어떤 검사도 그 디렉터리를 읽지 않기 때문입니다.

### 선언

| 도구 | 선언 위치 | 설치 또는 검증 |
|---|---|---|
| Node.js | `mise.toml`의 `node`(정확한 version), kit pin; `mise.lock`이 nodejs.org의 platform별 archive sha256을 가집니다. bootstrap이 npm보다 먼저 mise로 설치하고 `var/tools/bin/node`를 쓰며, npm의 wrapper와 kit.mk의 모든 recipe(`$(NODE)`)가 이를 실행합니다(K171) | bootstrap에서 mise로 설치 |
| npm | `package.json`의 `packageManager`: `npm@X.Y.Z` 또는 `npm@X.Y.Z+sha512.<digest>` | 설치 |
| Go | `mise.toml`의 `go`, `scripts/kit/toolchain-pins.json`의 kit pin과 같음; `mise.lock`이 platform별 archive의 sha256을 가짐; 모든 `go.mod`의 `go` 줄은 pin과 같아야 하며 `go mod edit -json`으로 읽음(K78) | mise로 설치 |
| Rust | `rust-toolchain.toml`의 `channel`(정확한 version), smol-toml(`readToml`)로 읽음(K78, K73) | 검증 |
| PHP | `config/toolchain.json`의 `php`(minor release 목록), 없으면 `.php-version` | 검증 |
| Python | `mise.toml`의 `python`(정확한 version), 그 minor는 kit pin; `mise.lock`이 platform별 python-build-standalone build를 URL과 sha256으로 고정 | mise로 설치 |
| mise | `config/toolchain.json`의 `mise`: 정확한 `version`과 platform별 archive `mise-v<version>-<os>-<arch>.tar.gz`의 `sha256` | bootstrap에서 설치 |
| uv, ruff, golangci-lint | `mise.toml`의 `uv`, `ruff`, `golangci-lint`(aqua backend; `mise.lock`이 archive별 sha256을 가짐) | mise로 설치 |
| alint | `mise.toml`의 `"github:asamarts/alint"`(`mise.lock`이 archive별 sha256을 가짐); `make layout-check`가 실행함(K76) | mise로 설치 |
| Composer | `mise.toml`의 `"http:composer"`: `composer.phar`의 url과 getcomposer.org에서 가져온 `checksum`, `mise.lock`이 이를 기록 | mise로 설치 |
| cargo-audit | `mise.toml`의 `"github:rustsec/rustsec" = { version, version_prefix = "cargo-audit/v" }`: platform별 native binary, 그 sha256은 `mise.lock`에 | mise로 설치 |
| cargo-nextest | `mise.toml`의 `"github:nextest-rs/nextest" = { version, version_prefix = "cargo-nextest-" }`: platform별 native binary(macOS는 universal binary), 그 sha256은 `mise.lock`에. check-toolchain이 `cargo-nextest --version`을 읽음(K143) | mise로 설치 |
| cargo-deny | `mise.toml`의 `cargo-deny`(mise registry의 aqua backend, `aqua:EmbarkStudios/cargo-deny`): platform별 native binary, 그 sha256은 `mise.lock`에. check-toolchain이 `cargo-deny --version`을 읽음(K143) | mise로 설치 |
| govulncheck, deadcode | `mise.toml`의 `"go:golang.org/x/vuln/cmd/govulncheck"`, `"go:golang.org/x/tools/cmd/deadcode"`, `go:` backend가 build; `mise.lock`은 release를 기록하고, Go가 `GOFLAGS=-mod=readonly`로 모든 module을 `GOSUMDB`에 비추어 확인함(선언된 예외) | mise로 설치 |
| vulture | `mise.toml`의 `"pypi:vulture"`: `mise.lock`이 mise가 `.mise/locks` 아래에 쓰는 uv lock의 digest를 가짐 | mise로 설치 |
| PHPUnit | `config/toolchain.json`의 `phpunit` `{ version }`; `config/phpunit`의 Composer project(`composer.json`, `composer.lock`)로 설치. kit은 자신의 PHP 테스트에만 쓰며, consumer는 PHPUnit을 패키지의 `composer.json`에 둠 | `mise.toml`의 Composer로 설치 |

`config/toolchain.json`의 형태는 `scripts/kit/schema/toolchain.schema.json`입니다. `schema`(1), `comment`, `php`(minor release
목록), `mise`(`version`, platform별 archive의 `sha256`), `pythonBackend`, `phpunit`(`version`), `symbolExtractors`,
`exceptions`(아래)입니다. Node.js를 포함한 `mise.toml`의 도구는 여기에 key가 없습니다.
`mise.toml`은 kit이 검사하는 도구만 선언하며(`toolchain-mise.mts`의 `MISE_TOOLS`), 각각 정확한 release로 선언합니다.
`mise.lock`이 그중 하나라도 위와 같이 고정하지 않으면 `toolchain-check`가 실패합니다. Rust는 `rustup`이 읽는
자기 파일에 두고, CI의 `setup-node`는 bootstrap을 시작하기 위해서만 `mise.toml`의 node를 읽습니다. 선언하지 않은 도구는 설치도 검증도 하지 않습니다.

### Pin, 하한, 예외(K78)

kit은 toolchain마다 pin 하나를 `scripts/kit/toolchain-pins.json`에 담아 배포하며(S4), build가 이를 `dist`의
`toolchain-pins.mts` 옆에 복사합니다. Node.js 26.12.0, Python 3.14, PHP 8.5, Go 1.27.2, Rust 1.99.0, TypeScript 7.0.2입니다.
`toolchain-check`는 어떤 도구를 실행하든, pin 정밀도에서 pin과 다른 선언과 manifest 하한마다 실패합니다
(`toolchain-floors.mts`, `checkedFiles`의 파일 대상, mise가 `.mise`에 쓰는 도구 환경은 제외). pin은 version만 담고,
digest는 `mise.lock`의 것입니다. pin마다 출처는 하나입니다. kit이 pin을 배포하고, kit을 포함한 모든 checkout의 `mise.toml`은
Go와 Python을 그 pin으로 선언해야 합니다:

| 값 | 요구 |
|---|---|
| `mise.toml`의 `node`, `go`와 `python`의 minor, `rust-toolchain.toml`의 `channel`, `php` | pin |
| 모든 `package.json`의 `engines.node` | Node.js pin 이상(`>=`) |
| 모든 `composer.json`의 `require.php`; `composer.lock` 옆에 있는 것의 `config.platform.php` | PHP pin 이상(`>=`); pin 또는 그 patch release(`8.5.0`), dependency-policy가 요구하는 형식 |
| project table이 있는 모든 `pyproject.toml`의 `project.requires-python`(smol-toml) | Python pin 이상(`>=`) |
| 모든 `go.mod`의 `go`(`go mod edit -json`) | Go pin, `toolchain` 줄 없음(go 명령은 `go` 줄과 같은 `toolchain` 줄을 지움) |
| 모든 Cargo package의 `rust-version`(`cargo metadata --no-deps`, workspace 상속 포함) | Rust pin |
| `package.json` 각 dependency 필드의 `typescript`, `package-lock.json`이 top level이나 workspace에서 resolve하는 `typescript` 중 그 lock 항목(`""` 또는 workspace)이 `typescript`를 선언한 것. npm이 다른 package를 위해 hoist하거나 그 아래에 중첩한 typescript(API Extractor의 TypeScript 등)는 그 도구의 것입니다(S1) | TypeScript pin |

- `config/toolchain.json`의 `exceptions`는 편차를 `{ tool, channel, scope, reason, retry }`로 선언합니다(S8). scope는 `.`
  또는 checkout의 directory이며, 그 아래의 값은 channel과 같아도 됩니다. workspace의 lock 항목은 lock이 아니라 그 workspace의
  folder 아래에 있습니다. 예외 없는 편차는 실패하고, 필드가 빠졌거나 pin되지
  않은 도구, 정밀도가 틀린 channel, 없는 directory를 가리키는 예외와 아무것도 쓰지 않는 예외(stale)도 실패합니다. Rust
  `nightly-<yyyy-mm-dd>`는 parity가 rustdoc JSON에 읽으므로 stale이 되지 않습니다.
- `install-links=true` 또는 `bin-links=false`를 설정한 `.npmrc`는 실패합니다(S1: 우리 규칙은 npm의 link를 막지 않습니다).
  npm이 각 `.npmrc`를 그 directory에서 사용자와 환경의 설정 없이 읽습니다.
- TOML은 kit의 유일한 TOML reader인 `toml.mts`의 `readToml`로, smol-toml이 읽습니다(K73).
- signal로 끝난 version 명령은 `exit status null`이 아니라 `ended by signal SIGKILL`처럼 signal로 보고합니다(K118).

### 합친 동작

- npm: template의 설치(machine의 npm이 `npm install --prefix`를 실행)와 hyper, ordered-json의 설치(registry tarball을 받아
  SHA-512가 선언한 digest와 같을 때만 사용)는 하나의 설치입니다. `packageManager`에 digest가 있으면 두 번째 경로를 씁니다.
  배치는 `var/tools/npm/node_modules/npm`이고, wrapper `npm`과 `npx`가 `npm-cli.js`와 `npx-cli.js`를 실행합니다. 같은
  version에서 digest가 바뀌면 다시 설치합니다(hyper). link나 특수 파일이 든 tarball은 거부합니다(ordered-json). bootstrap npm은
  `PATH`에서 `var/tools/bin`을 뺀 채 실행합니다(template).
- Go: kit pin인 `mise.toml`의 Go를 mise가 Go 내려받기의 archive에서 `mise.lock`의 sha256으로 설치합니다. 기계의 Go는
  관여하지 않으므로 Go가 없는 checkout에도 설치됩니다. toolchain-check가 `go mod edit -json`으로 각 `go.mod`의 `go` 줄을
  pin과 비교합니다(K78). kit의 archive 설치와 `toolchain-pins.json`의 `goArchives` digest는 없어졌습니다(K127).
- Composer: hyper는 SHA-256을 확인한 `composer.phar`를 설치하고, template, crudui, orm은 실행 중인 Composer만 검증합니다.
  mise가 `mise.toml`의 `http:composer` 항목과 선언된 checksum으로 설치합니다(K127).
- Python과 PHP: crudui는 minor release를 설정에, template과 ordered-json은 `.python-version`에 선언합니다. Python은 이제
  `mise.toml`의 도구로 정확한 release로 선언합니다(K127). PHP는 설정을 먼저 읽고 없으면 `.php-version`(ordered-json, orm)과
  crudui, template의 목록을 읽으며, 둘 다 있고 다르면 실패합니다.
- Python (K64, K127): mise가 `mise.lock`이 URL과 sha256으로 고정한 정확한 python-build-standalone build를 `var/tools/mise/installs`에 설치하고, shim `var/tools/mise/shims/python3`이 그것을 실행합니다. uv는 Python을 설치하지 않으며(`UV_PYTHON_DOWNLOADS=never`), kit의 uv는 mise의 Python(`UV_PYTHON`)으로 실행됩니다. mise의 Python도 pip에게는 externally managed이므로 pip는 그 Python의 venv에만 설치합니다. `check-toolchain`, run-tests, release-proof는 PATH의 Python이 아니라 그 shim을 실행합니다. 테스트가 자기에게 설치된 의존성을 import하는 package는 `run-tests python --venv <directory>`로 실행합니다(K37): runner는 `<directory>/pyvenv.cfg`의 `home`이 `var/tools/mise` 아래의 directory일 때만(link를 따라 읽음) `<directory>/bin/python`을 시작하며, 다른 환경은 tool을 시작하기 전에 `make python-venv DIR=<directory>`(K44) 또는 `var/tools/mise/shims/uv venv --python var/tools/mise/shims/python3 <directory>`라는 고침과 함께 거부합니다. 환경의 symbolic link는 그 환경을 만든 tool의 동작이므로 만들어진 그대로 받아들입니다(K63): `uv venv`는 `bin/python`을 interpreter로, `bin/python3`과 `bin/python3.14`를 `bin/python`으로 link하며, run-tests는 link를 복사하거나 지우거나 고쳐 쓰지 않고 그 환경을 실행합니다.
- Wheel proof (K46): `release-consumer`는 wheel의 venv를 `makeVenv`로 만듭니다(`uv venv`, pip 없음). wheel은 checkout의 pip로 설치합니다: `var/tools/mise/shims/python3 -m pip --python <venv>/bin/python install`, version은 `show`로 읽습니다. venv에는 자기 pip이 없고, PATH의 python3은 실행되지 않습니다.
- Python venv (K44, K64): `make python-venv DIR=<directory>`(`scripts/kit/python-venv.mts`)는 `var/tools/mise/shims/uv venv --python var/tools/mise/shims/python3 <directory>`로 checkout Python의 virtual environment를 만들고, uv가 만든 그대로 link까지 둡니다. 실행은 멱등입니다: 이미 checkout Python의 venv인 기존 `<directory>`(run-tests의 규칙, 같은 Python 버전)는 바꾸지 않고 그렇다고 보고하며, 그 밖의 기존 `<directory>`는 이유와 함께 오류이고 지우거나 고치지 않습니다. 실패한 실행은 그것이 만든 directory를 지웁니다.
- ruff와 vulture(K127): ruff는 mise가 `mise.lock`의 sha256으로 설치하는 GitHub release archive이고, vulture는 mise가 `.mise/locks`의 uv lock으로 환경을 제자리에서 build하는 `pypi:` 도구이므로, 그 console script는 존재하는 interpreter를 가리킵니다.
- 검증: crudui의 도구 목록과 메시지(선언한 파일, 실행 중인 version, 기대 version, 해결 방법), minor release로 비교하는 PHP와
  Python(crudui, ordered-json, hyper), 나머지 도구의 정확한 release 비교, `GOTOOLCHAIN=local`과 `RUSTUP_AUTO_INSTALL=0`
  (ordered-json), 증거 함수 `toolchainVersions`(crudui)입니다. 검증은 ruff, cargo-audit, govulncheck도 포함하고, 도구를 하나도
  검사하지 않은 실행은 실패합니다.
- 설정 data: 형태는 모든 저장소의 data를 받습니다. `php`는 목록(hyper는 `["8.5"]`로 씀), `composer`는 객체(template과 crudui는
  `{ "version": "2.10.3" }`로 씀), 모든 파일에 `schema: 1`이 있습니다.

### 버린 동작

- hyper는 `PATH`의 `npm`과 `composer`가 `var/tools/bin`의 파일인지 검사했습니다. 정책은 선언한 version이고 version 검사가 모든
  도구에 그것을 강제하므로, machine의 npm이 선언한 release이면 통과합니다.
- hyper는 `node_modules` 없이 npm을 `var/tools/npm`에 두었습니다. template의 배치로 바꾸므로 wrapper 문구가 하나입니다.
- ordered-json의 `pin TOOL` 명령은 CI에 pin된 version을 출력했습니다. setup action이 pin 파일을 읽고, script는
  `declaredToolchain`에서 같은 값을 받습니다.
- orm은 `.node-version`, `.php-version`, `.go-version` 끝의 newline을 요구했습니다. 파일을 trim해서 읽습니다.
  편집기 설정은 toolchain version이 아닙니다.
- crudui의 `.tools/npm` 경로는 `var/tools/npm`으로 대체합니다(`checkout-npm.mjs`는 vendored하지 않음).

### 저장소에 남는 것

- Playwright와 Puppeteer 브라우저 설치(crudui `install-browsers.mjs`): 한 project의 브라우저에 의존합니다.
- crudui의 `install-lock.mjs`, `tool-resolution.mjs`, `run-command.mjs`: 첫째는 한 install project의 lock을 만들고, 둘째는 한
  build의 cargo, rustc, rustdoc 절대 경로를 찾으며, 어느 것도 선언된 toolchain을 설치하지 않습니다.
- ordered-json의 `make tools`: Rust toolchain(`rustup toolchain install`은 machine에서 rustup이 관리하는 toolchain을 바꿈),
  crate(`cargo fetch`), PIE phar, JSONTestSuite checkout. kit는 Rust를 검증만 하고 설치하지 않습니다.
- crudui의 phpDocumentor 설치, orm의 CI workflow 파일 검사(`node-version-file`, `go-version-file`, `php-version-file`,
  `tools: composer:`), `engines.node`와 `require.php`의 최소 release, `go.mod` module 경로: 한 저장소의 파일을 검사하며
  machine의 도구가 아닙니다.
- recipe는 checkout의 도구를 이름만으로가 아니라 절대 경로로 실행합니다(K171): macOS의 make인 make 3.81은 shell 문법이 없는
  recipe 줄을 kit.mk가 export한 PATH가 아니라 make가 시작할 때의 PATH에서 찾으므로, 이름만 쓴 `node`는 machine의 node를
  실행했습니다. kit.mk는 이를 `$(NODE)`, `$(NPM)`, `$(ALINT)`로 부르며, `BOOTSTRAP_NODE`는 bootstrap과
  `make toolchain-lock`만 시작하는 machine의 node입니다(K174): bootstrap은 toolchain-lock이 쓰는 `mise.lock`에서 checkout의 node를
  설치하므로 toolchain-lock은 그 node가 생기기 전에 돌며, bootstrap처럼 `config/toolchain.json`의 mise를 스스로 설치합니다.
  `mise.lock`이 node를 고정하지 않은 checkout은 `make toolchain-lock`, 그다음 `make install-tools TOOLS=npm`을 실행합니다. `make kit-check`는 checkout의 도구(`recipe-tools.mts`: var/tools/bin의 wrapper와 `mise.toml`의
  command)를 이름만으로 실행하는 Makefile의 recipe를 실패시킵니다.
## Layout 검사 (K76)

S5(폴더), S7(test 위치)의 위치 부분, S9의 TypeScript 규칙은 kit의 도구가 아니라 release된 도구
[alint](https://github.com/asamarts/alint)가 검사합니다. 생태계 도구가 요구사항을 표현하면 S1은 재구현을 금하고, alint는 아래
모든 항목을 설정만으로 표현합니다. 그래서 kit에는 이에 대한 rebuild record가 없고, 이 절이 선택을 기록합니다.

- `make layout-check`는 `var/tools/mise/shims/alint check --config config/layout.yml .`을 실행합니다(offline). `mise.toml`의
  `"github:asamarts/alint"`가 release를 선언하고 `mise.lock`이 platform별 archive의 sha256을 고정합니다(K127).
- `config/layout.kit.yml`은 공통 rule과 template을 담습니다. 사본(package.json의 `kit.copies`)이므로 kit-sync가 설치된 package에서 쓰고
  kit-check가 byte 단위로 비교하며, 레포는 이 파일을 고치지 않습니다. alint는 `extends:` 대상을 그것을 적은 설정의 폴더에서만 읽기
  때문에 이 파일은 `config/`에 있습니다.
- 레포의 `config/layout.yml`은 이 파일을 extends하고 자기 map을 더합니다. 자기 이름으로 template `no-repository-prefix`와
  `go-module-path`의 instance를 두고, port가 있는 component마다 `component-ports` instance를 하나 두며, rule id로 override합니다
  (`layout-packages`의 component, `layout-root-tests`의 runner, S9 예외). `paths` override는 목록을 통째로 바꾸므로
  공통 항목을 되풀이합니다. root 파일은 더하는 방식입니다(K145): `layout-root-files`는 template `root-files`의 instance이고, 그 kit 목록은
  `!{{vars.root_files}}`로 끝나며, 레포는 glob alternation인 `vars: { root_files: "{a,b}" }`로 자기 파일만 적습니다(`"{}"`는 아무것도
  적지 않습니다). alint는 변수를 text로 치환하므로 glob 하나의 alternation이 목록을 담습니다. rule `layout-root-files-additive`는
  `config/layout.yml`이 `layout-root-files`의 `paths`를 override하면 실패합니다. 그 override는 kit가 나중에 더하는 root 파일을 finding
  없이 빠뜨리기 때문입니다. 예외마다 바로 위 주석에 이유를 적습니다. alint에는 이유를 담을 field가 없으므로, 표준 계획서가
  parity(S6)와 함께 두는 `CODEOWNERS`의 `config/layout.yml` owner 필수 review가 S8을 강제합니다. kit에는 아직 `CODEOWNERS`가
  없습니다.
- `PYTHONPATH`는 여기서 checkout 전체에 걸쳐 검사하고, parity schema도 `config/parity.json`에서 그것과 repository를 벗어나는
  모든 경로를 거부합니다(K75). test의 기능 소유는 parity R5와 R6에 두고, layout은 root `tests/`의 위치만 정합니다.
- `tests/source/layout-real.test.mts`는 실제 alint를 돌립니다. layout을 따르는 레포는 통과하고, 심은 위반은 각각 그것을
  가리키는 rule로 실패하며, `vars.root_files`로 자기 root 파일을 적은 레포는 kit의 root 파일과 함께 통과하고, 이 checkout은 통과합니다.

### 요구사항과 판정

alint 0.18.2로 fixture 레포에서 측정했고, fsm과 orm에서는 읽기만 하며 돌렸습니다. 거기서 rule은 표준 계획서가 적은 위반을
찾았습니다(root `conformance/`, `machines/`, `schema/`, `fsm-` 접두사, `fsm-go`의 module path, `config/parity.json`의
`PYTHONPATH`와 `../ordered-json/…`, `.mjs` script).

| 항목 | 요구사항 | alint rule | 판정 |
|---|---|---|---|
| L1 | root 폴더와 파일의 allowlist | `root_only`와 `!` 항목을 쓰는 `dir_absent`, `file_absent` | native |
| L2 | `packages/<runtime>/`, `packages/<component>/`, `packages/<component>/<runtime>/` | `dir_absent`, `file_absent`, template `component-ports` | native |
| L3 | `packages/` 아래 `<repo>-` 접두사 금지 | template `no-repository-prefix` | native |
| L4 | go.mod module path = `github.com/polyspec/<repo>/<folder>`, v2 이상은 Go의 `/vN` | `file_content_matches`를 쓰는 `for_each_file` | native |
| L5 | `PYTHONPATH` 금지 | `file_content_forbidden` | native |
| L6 | 레포를 벗어나는 경로 금지: `config/*.json`, `go.mod` replace, pyproject path source, `Cargo.toml` `path`, `composer.json` path repository | `json_path_absent`, 그리고 `cross_file` `relation: resolves`를 쓰는 `for_each_file`. `resolves`는 레포 안에서만 해석한다(없는 대상도 보고) | native |
| L7 | `scripts/`와 `tests/` 아래 TypeScript가 아닌 인프라 script 금지, 선언된 S9 예외는 허용 | script 확장자에 `file_absent`, 다른 shebang에 `file_content_forbidden` | native. 이유는 주석 |
| L8 | root `tests/`에는 선언된 runner만 | `dir_absent` | 위치는 native |
| L9 | release와 platform별 sha256 고정, offline, 설정을 명시적으로 넘김 | `SHA256SUMS`와 cosign bundle이 있는 release archive | mise와 `mise.lock`에 맞음 |

### 평가한 도구

| 도구 | 상태 (2026-10-13) | 판정 |
|---|---|---|
| alint | 0.18.2, 첫 release 2026-04-19, Apache-2.0 OR MIT, maintainer 한 명, crate download 약 1.4k, darwin과 linux의 x64, arm64 binary | 채택: L1–L9를 다룸 |
| ls-lint | 2.3.1, MIT | 이름만(`.dir`이 재귀로 적용). 파일 내용을 읽지 못해 L4–L6 불가 |
| Repolinter | 0.12.0, repository가 archived | 제외 |
| @rikalabs/repo-lint | 2.3.0, 월 약 180 download | 경로 배치만. L4–L6 불가 |
| eslint-plugin-project-structure | 3.14.5 | ESLint가 읽는 파일만 lint. `go.mod`와 manifest 불가 |
| fsm `scripts/check-layout.mjs` | 우리 code | fsm 전용(`fsm-<kind>` 접두사 요구, `contracts/layout.json`을 읽고 `packages/`만 검사) |

### 성숙도 위험과 버전 절차

alint는 0.x이고 release가 잦습니다. 0.17과 0.18은 설정 key를 바꿨지만 layout rule이 쓰는 key는 아닙니다. 위험은 고정으로
관리합니다. `mise.toml`이 정확한 release를, `mise.lock`이 platform archive별 sha256을 적고, 설치는 다른 archive를 거부합니다.
버전을 올릴 때는 다음 순서를 따릅니다.

1. 고정된 release와 새 release 사이의 모든 CHANGELOG에서 바뀐 설정을 읽습니다.
2. `mise.toml`에 release를 적고 `make toolchain-lock`을 돌린 뒤, `mise.lock`의 digest를 release의 `SHA256SUMS`와 비교합니다.
3. `make install-tools`를 돌린 뒤 `tests/source/layout-real.test.mts`의 fixture와 `make layout-check`를 돌립니다.
4. 바뀐 key가 있을 때만 `config/layout.kit.yml`의 layout rule을 고칩니다.

## Gate: push-gate, full-run, git-hooks, holder-lock (K6.1)

파일: `scripts/kit/checklist.mts`, `push-gate.mts`, `git-hooks.mts`, `holder-lock.mts`, `full-run.mts`,
`schema/checklist.schema.json`, 그리고 `kit.mk` 끝의 make target `hooks`, `hooks-check`, `push-gate-commit`, `rerun-failed`입니다.
lock은 crudui, guard와 hook은 template, tracker는 다섯 구현의 합집합을 기반으로 삼았습니다.

### 정책

tracker의 항목이 active 상태(checklist는 `[~]`)이면 push한 commit이나 working tree에 있을 때 push를 거부합니다. 대기 `[ ]`, 완료
`[o]`, 우회 `[!]` 상태는 막지 않으며 거부 메시지가 이를 밝힙니다. pre-push hook이 gate를 실행합니다. 또한 push하는 각 commit의 message를 `make commits-check`(`check-commits.mts`, `config/commits.json`)의
규칙으로 검사합니다. push된 commit은 고칠 수 없기 때문입니다. push하는 ref마다 commit은 원격 sha부터 로컬 sha까지의 range이며, 원격 sha가
0이면 어떤 원격 ref에도 없는 commit입니다. 삭제하는 ref는 commit을 push하지 않으므로 건너뜁니다. 검사 결과가 있는 push는 거부하며,
각 결과는 commit과 줄을 `<commit>: <rule>: <message>`로 적습니다. 전체 실행의 guard는
항목이 active 상태인 동안, 추적하는 파일에 변경이 있는 동안, 현재 tree의 전체 실행 기록이 있을 때 거부합니다. 이 정책에는 pull
request, merge queue, ruleset이 없습니다.

### `config/checklist.json`
```json
{
  "schema": 1,
  "hooks": ["pre-push"],
  "trackers": [
    {
      "path": "docs/plans/execution-checklist.md",
      "translation": "docs/plans/execution-checklist.ko.md",
      "format": "table",
      "states": ["[ ]", "[~]", "[o]", "[!]"],
      "active": "[~]"
    }
  ]
}
```

`hooks`는 `.githooks`에서 추적하는 hook의 목록이며 `pre-push`를 포함해야 합니다. tracker는 `path`, `format`(`table`: `| ID | ... | state |`
행, `list`: `- [state] ID text` 항목이며 하위 항목은 들여 씁니다), `active`를 가지고, `translation`, `states`(목록 밖의 state는 오류),
`column`(state가 있는 table 행의 0부터 센 cell, 없으면 마지막 cell)을 가질 수 있습니다. state는 cell이나 항목 앞의 `[x]`이고,
cell이 `[`로 시작하지 않으면 cell 전체입니다.

### 합친 동작

| 동작 | 출처 | 결정 |
|---|---|---|
| 마지막 cell에 state가 있는 table 행 | template, crudui, hyper, ordered-json | `format: table` |
| 하위 항목이 있는 list 항목 `- [state] ID text` | orm | `format: list`, 제목은 첫 문장 |
| state가 column의 단어인 두 번째 tracker(feature table의 implementation column의 `partial`) | ordered-json | tracker의 `column`과 `active`, tracker는 여러 개 허용 |
| 항목이 없는 tracker, 중복 ID, 선언한 state 밖의 state, 항목이 아닌 행은 읽을 수 없는 문서로 거부 | ordered-json, orm(문서 검사), template은 그런 행을 무시 | gate와 guard에서 거부: 더 넓게 읽어 읽을 수 없는 문서를 빈 문서로 보지 않음 |
| tracker 파일이 없는 push된 commit은 거부 | 전체 | 유지, 메시지가 파일을 적음 |
| hook 입력의 잘못된 줄은 거부, 삭제하는 ref는 commit을 push하지 않음, working tree는 항상 읽음 | ordered-json(잘못된 줄), 전체(나머지) | 유지 |
| 한국어 짝은 같은 ID를 같은 순서로, 같은 state로 가져야 함 | orm, ordered-json(문서 검사) | 짝을 같은 parser로 읽으므로 gate와 guard도 다른 짝을 거부, 나머지 규칙(marker, 우회 문구)은 K7의 문서 검사가 유지 |
| 거부 메시지가 파일, ID, 제목, 위치(push하는 ref와 commit 또는 working tree)를 적음 | 전체 | 유지, 어떤 state가 막고 어떤 state가 막지 않는지도 적음, commit은 12자로 표시(ordered-json, orm, template과 hyper는 7자) |
| `commit <rev>`는 줄마다 GitHub annotation을 출력하고 `%`와 줄바꿈을 escape하며 `$GITHUB_STEP_SUMMARY`에 덧붙이고 hook의 mode 100755를 요구하고 commit이 아닌 revision을 알림 | template, crudui, hyper, ordered-json, orm | 유지, `hooks`의 모든 hook의 mode를 요구(ordered-json은 `pre-commit`도 요구, 나머지는 `pre-push`만) |
| `hooks-check`는 `core.hooksPath`가 다르거나 hook이 없거나 실행할 수 없으면 실패 | 전체 | `git-hooks.mts check`, `pre-push`의 내용이 도구의 hook과 다를 때도 실패 |
| `make hooks`가 `core.hooksPath`를 설정하고 검사 | template, hyper, ordered-json(`hooks-install`) | `git-hooks.mts install`이 `pre-push`도 쓰고 나열한 hook을 실행 가능하게 함, 두 번째 실행은 아무것도 바꾸지 않음 |
| make를 호출할 때마다 `core.hooksPath`를 설정 | template, orm | `kit.mk`는 `.githooks/pre-push`를 추적하는 checkout에서만 설정, hook이 없는 checkout은 바꾸지 않음 |
| `pre-push`의 내용 | 전체가 최상위 directory로의 `cd`와 주석에서 다름 | 내용 하나, `git-hooks install`이 쓰고 `check`가 비교 |
| `pre-push`가 아닌 hook(ordered-json의 `pre-commit`, orm의 `commit-msg`) | ordered-json, orm | `hooks`에 적고 존재와 mode를 검사, 내용은 저장소에 둠 |
| lock 기록: checkout, process ID, process 시작 시각, 잡은 시각, command, token, 원자적 link, 시작 시각으로 재사용된 process ID와 holder를 구별 | crudui | `holder-lock.mts`의 기반, template과 hyper는 시작 시각을 기록하지 않았음 |
| 끝난 holder의 lock은 `clear`까지 남음, `clear`는 lock을 옆으로 rename하고 그 사이 새 holder가 잡았으면 되돌림 | crudui(`remove-dead`), template과 hyper(`clear`) | crudui의 제거 방식을 `clear`라는 이름으로 |
| process 종료와 SIGINT, SIGTERM, SIGHUP(종료 상태 128 + n)에서 release | template | 유지, process 안의 holder의 기본값, `run`은 신호를 command에 전달 |
| `run <lock> -- <command>`는 command의 상태로 종료, 신호는 128 + n, 시작하지 못하면 127 | crudui(`hold`), template, hyper | `run`이라는 이름으로 유지 |
| token이 다르면 release 실패 | template, crudui, hyper는 메시지만 출력 | 실패 |
| lock directory를 만듦 | crudui, hyper | 유지 |
| guard 조건: active 항목, hook 미설치, 변경된 tree, 다른 실행 진행 중, 현재 tree의 기록 | template, crudui, hyper, ordered-json | 유지 |
| Git이 무시하지 않는 untracked 파일이 있으면 거부: 기록은 tree를 가리키는데 tree에는 그 파일이 없음 | ordered-json, 나머지는 추적하는 파일만 봄 | 더 넓은 검사 |
| 한 번에 한 실행: guard가 첫 읽기부터 마지막 쓰기까지 `var/full-run.lock`을 잡음 | template(`var/full-run.json.lock`), crudui(`var/locks/full-run.lock`), hyper와 ordered-json(`var/full-run.lock`) | `holder-lock.mts`를 통한 `var/full-run.lock`(ordered-json은 `flock` 사용) |
| 기록 `var/full-run.json`: tree, commit, result, target별 status·시각·경과 시간, reruns | orm 제외 전체 | 유지, process 전용 파일에 쓰고 rename |
| 끝나지 않은 기록이 process를 적음, 실행 중인 process가 있으면 거부 | template, crudui, hyper, ordered-json | 기록에 process 시작 시각도 적어 재사용된 process ID가 이후 실행을 영구히 막지 않음(네 구현의 결함) |
| `rerun-failed`는 현재 tree에서 통과하지 못한 target(failed, running, pending)을 다시 실행 | template, crudui, hyper, ordered-json | 유지 |
| tree 말고 실행의 또 다른 입력: dependency의 commit | hyper | `--key name=value`, 기록에 `keys`를 두고 run과 rerun은 같은 keys를 요구 |
| 실패한 target은 마지막 출력 20줄을 기록에 두고 출력 | hyper | 유지 |
| `make -k <target>`과 target별 log `var/report/full-run/targets/<target>.log`, 마지막 줄바꿈이 없는 출력 다음 줄은 column 0에서 시작 | template(`-k`, log), hyper(column 0, 마지막 줄) | 유지 |

### 버린 동작

| 동작 | 출처 | 이유 |
|---|---|---|
| pull request, merge queue, merge group, ruleset을 말하는 문구(`REASON`, workflow `push-gate.yml`의 trigger, 필수 check `push-gate`) | template, crudui, hyper, ordered-json, orm | 0.x 정책에는 그것들이 없음, `commit <rev>`는 hook이 없는 checkout의 push를 위해 남김 |
| `push-gate.mts`의 `hooks-check` mode와 `push_gate.py`의 `hooks-install` | template, crudui, hyper, ordered-json, orm | hook은 `git-hooks.mts`의 몫, make target은 이름을 유지 |
| command line(`sh -c <text>`)이나 `--` 뒤의 인자 묶음인 target | crudui, ordered-json | 기록 이름과 log 경로는 안정된 단어여야 함, 저장소는 command를 make target으로 감쌈 |
| committed tree의 새 clone에서 `make install`과 clone 안의 marker로 실행 | crudui | 저장소의 install command와 저장소 이름이 붙은 marker가 필요, 필요한 저장소는 clone하는 target을 만듦 |
| 실행 전 conformance evidence directory 초기화 | crudui | 저장소 전용 |
| 기록의 `environment`(toolchain 버전)와 보고서의 `summary.md` | template, crudui | toolchain command는 저장소 data, K8.1이 target report와 toolchain 기록을 합침 |
| 기록된 commit 이후 바뀐 path로 rerun target 선택, 후손 commit에서의 rerun, status `not-run`과 `crashed`, preflight `decide`, `claim`과 `recorder` 인터페이스, `.runtime/`의 기록 | orm | orm만 가지며 K8의 owner check를 읽음, 나머지 넷은 같은 tree의 rerun에 합의 |
| `full_run.py`의 `flock` guard | ordered-json | `holder-lock.mts`로 대체, 모든 도구는 Node |
| `user-lock-file`과 `checkoutLockFile` | crudui | lock 경로에 저장소 이름이 있음, 호출자가 절대 경로를 넘김 |
| `test-progress`의 진행 줄 | crudui | crudui의 module, gate는 단계마다 한 줄을 출력 |
| `scripts/git/check.mjs`(commit subject 형식, `commit-msg` hook)와 `scripts/checklist/check.mjs`의 marker·우회 문구 규칙 | orm | gate가 아님, hook은 `hooks`에 적고 문서 규칙은 K7의 몫 |
## 문서 검사 (K7.1)

`scripts/kit/check-documents.mts`는 template, crudui, hyper의 `check-documents.mts`와 ordered-json의 `docs_check.py`를 대체합니다.
어느 Markdown 파일이 문서인지, status table, changelog는 `config/documents.json`
(`scripts/kit/schema/documents.schema.json`)에 선언하고, 체크리스트는 `config/checklist.json`(K7.2)에 선언합니다. finding은 한 줄 `<file>:<line>:<column>: <rule>: <message>`입니다.

합친 동작(더 넓은 동작을 채택):

| 관심사 | 구현 | kit의 동작 |
|---|---|---|
| 문서 선택 | template, crudui: 고정 목록과 directory; hyper: tracked `*.md`; ordered-json: 모든 문서를 등록하는 manifest | `include`와 `exclude` glob이 고르는 tracked 및 ignore되지 않은 새 Markdown 파일; `.ko.md`는 영어 파일에 대응 |
| 쌍 | 모두: 영어에는 한국어 필요; hyper, ordered-json: 한국어에는 영어 필요 | 양방향 (`pair-missing`) |
| `doc-id` | ordered-json만 | 두 파일이 같은 `<!-- doc-id: id -->`를 한 번씩 가지고, id는 문서 하나를 가리킴 |
| revision | ordered-json만 | 한국어 파일은 `<!-- source-sha256: ... -->`를 한 번 가지고 영어 파일의 sha256과 같음 |
| section identifier | ordered-json (`<a id>` anchor) | anchor가 두 파일에서 같고 한 번씩만 나옴 |
| fenced block | template, crudui, hyper: 내용만; ordered-json: info string과 내용, `~~~`, 닫히지 않은 fence | ordered-json 동작: info string과 내용 비교, 두 fence 문자 지원, 닫히지 않은 fence는 실패 |
| link | 모두: inline link; ordered-json: reference link, autolink, `href`, query, 저장소 밖으로 나가는 link, explicit anchor; template: `.md`, `.ko.md`, `index.md` 후보와 `/` 건너뜀; crudui: `/` 거부 | 모든 link 형식; code는 읽지 않음; anchor는 explicit anchor 또는 heading anchor; static site의 `/`와 확장자 없는 link 동작은 `siteLinks` |
| private path | ordered-json | home directory 경로는 실패 (`private-path`) |
| `{{` | template (VitePress) | `interpolation` glob이 정한 문서에서 fenced block 밖의 `{{`는 실패 |
| checklist, table | template, crudui, hyper | task row, 마지막 cell의 state, marker는 state에만, 그 밖의 줄은 실패; crudui와 hyper의 구분 줄(`:---:`) 허용; ID pattern은 checklist의 `idPattern` |
| checklist, list | orm | `- [o] ID text` 항목, 하위 항목, 이어지는 줄, `[!]`의 `Cause:`와 `Retry:`; 두 형식 모두 한국어 label 허용 |
| checklist 쌍 | template, hyper: 마지막 cell 전체 비교; orm: ID와 state 비교 | task ID와 state marker를 비교; bypass는 각 언어에서 cause와 retry 조건을 적고, 그 글은 번역함 |
| 중복과 빈 checklist | orm, ordered-json | 반복된 task ID와 task가 없는 checklist는 실패 |
| status table | template (두 형식), crudui (6 cell), ordered-json (7 cell) | 설정의 `statusTables`: cell 수, cell별 닫힌 값과 pattern; 영어와 한국어 row는 ID와 닫힌 값이 같음 |
| changelog | orm | `## Unreleased`가 맨 처음에 한 번, 버전 `X.Y.Z`는 최신이 위에 한 번씩, 두 언어의 section이 같음 |

버린 동작:

- template과 crudui의 고정 문서 목록과 ordered-json의 등록 manifest: include glob과 `doc-id` marker가 대체합니다.
- template의 두 번째 status table 형식(5 cell): table의 형식은 하나이고, 호환 계층으로 옛 형식을 유지하지 않습니다.
- 저장소 사실을 읽는 ordered-json의 검사는 그 저장소에 남습니다: implementation, verification, distribution 상태 사이의 관계,
  상태의 근거 record, record와 benchmark 파일, distribution 관찰, tracker 절의 배치 규칙, 하위 저장소로의 재귀.
- changelog section과 `VERSION`의 비교(orm): release 검사가 manifest를 읽어 비교합니다.
- orm의 `scripts/docs`, `scripts/features`는 제품 전용이므로 orm에 남습니다.

## Owner check (K8.1-1)

`scripts/kit/owner-check.mts`는 template, crudui, hyper의 `owner-check.mts`와 ordered-json의 `owner_check.py`를 대체합니다.
선언은 `config/owner-checks.json`(`scripts/kit/schema/owner-checks.schema.json`)입니다.

합친 동작:

- glob(`*`, `**`, `{a,b}`), `always` test, 변경된 test 파일을 뜻하는 `$path`, `--paths`, `--base`, `--dry-run`, `--validate`는
  template, crudui, hyper가 같고 그대로 유지합니다. glob은 `dot: true`인 picomatch가 맞추므로 `.github` 같은 dot 디렉터리 아래의
  경로도 다른 경로처럼 맞습니다.
- check 종류: crudui는 make target, root `package.json`의 script, workspace, package directory를 고릅니다. template과 hyper는
  make target을, ordered-json은 implementation과 이름 붙은 check 둘을 고릅니다. kit은 crudui의 종류를 따릅니다. workspace는 root
  `package.json`의 `workspaces`가 가리키는 directory에서 `test` script가 있는 `package.json`이고, package directory는 그 밖의
  것입니다(crudui는 directory `packages/`를 가정했습니다).
- `variable`(template, hyper)은 rule의 target에 일치한 경로를 make 변수로 넘깁니다.
- target은 `CHECK_TARGETS` 순서(template, hyper)로 정렬하고, 다른 check는 선언 순서(crudui)를 유지합니다.
- full suite target은 recipe가 `full-run.mts`를 시작하는 target과 `fullSuite`에 적은 target입니다. template의 고정 이름 `check`,
  `rerun-failed`, clean release check는 `fullSuite`의 항목이 됩니다.
- `CHECK_TARGETS`의 모든 target을 고르는 rule은 실패합니다(template). `inputs` 검사는 crudui 형식이고, 선언은
  `{ check, paths }`의 목록입니다.
- Makefile이 include하는 파일(`include scripts/kit/kit.mk`)의 target도 알려진 target입니다(새 동작).
- node test 파일은 `scripts/kit/run-tests.mts`로 실행하거나, make target `testTarget`에 `TESTS=<files>`를 넘겨 실행합니다(hyper).
- 고른 check는 모두 끝까지 실행하고 실패를 함께 나열합니다(모든 구현). check에는 시간 제한이 없습니다.

버린 동작:

- ordered-json의 `languages`와 `checks`는 그 저장소의 build를 가리키므로 Makefile의 `targets`가 됩니다. `$module`은 `$path`가
  됩니다. Python test module은 node test가 아니므로 kit 밖에 남습니다.
- crudui의 `useCheckoutNpm`: Makefile이 `var/tools`의 npm을 `PATH` 맨 앞에 두고, 도구는 `PATH`의 `npm`을 시작합니다.
- `inputs`의 key로 쓰던 target 이름(template, hyper): 이름은 crudui처럼 `make <target>`입니다.

## 테스트 실행기 (K8.1-2)

`scripts/kit/run-tests.mts`는 template, crudui, hyper의 `run-tests.mts`와 ordered-json의 `test.py`를 대체합니다. 진행 reporter는
`test-progress.mts`, `node-reporter.mts`, `vitest-reporter.mts`이며, go, cargo, PHPUnit, unittest 출력의 parser는 `test-output.mts`에 있고 언어 패리티 검사도 같은 함수로 읽습니다(K47). `test-exit-deadline.mts`는 각 node test 파일에 preload되어, 마지막 test 뒤 test timeout이 지나도 살아 있는 파일을 열린 handle 이름과 함께 실패시키며(K72),
`test-hooks.mts`는 test의 `setup`과 `teardown` helper입니다.

합친 동작:

- tool: `node`, `vitest`, `go`, `cargo`, `phpunit`(template, crudui), `python`(K17); hyper는 첫째, 마지막, `vitest`를 가집니다. 각 test는 시작,
  실행 중 한 줄, 경과 시간과 함께 결과를 출력하고, test마다 자기 timeout(`--timeout`, 기본 30 s)을 가집니다. `node --test`와
  vitest가, 다른 tool은 실행기가 timeout을 적용합니다. 전체 실행, package, 파일에는 시간 제한이 없습니다(모든 구현; crudui의
  `go test -timeout 10m`은 `-timeout=0`으로 바꿉니다).
- pass, fail, timeout인 test가 하나도 없는 실행은 실패합니다. template은 skip한 test도 test로 셌고 hyper와 crudui는 세지 않았으며,
  skip만 한 실행은 아무것도 검증하지 않았으므로 kit은 후자를 따릅니다. reporter는 count를 `KIT_TEST_RESULT`(hyper의
  `HYPER_TEST_RESULT`) 파일에 쓰고, count가 오지 않으면 실행기가 실패합니다.
- test를 하나도 등록하지 않은 node test 파일(crudui)과, module이 모든 test를 등록하기 전에 process가 끝난 파일(crudui
  `load-check`)은 실패합니다. test case를 시작하지 않은 Go package는 skip으로 보고합니다(crudui).
- 실패한 실행의 요약은 tool의 error 줄과 build되지 않은 Go package의 build error를 적습니다(template). timeout 줄은 멈추는
  command를 적습니다(crudui).
- 모든 tool은 자기 process group에서 실행되므로(K141), 멈춤은 mise shim이 실행하는 interpreter처럼 tool이 시작한 process에도
  닿습니다. 실행기는 test가 timeout을 넘었을 때와 실행기 자신이 SIGINT, SIGTERM, SIGHUP을 받았을 때 group을 SIGTERM으로 멈추고,
  5 s 뒤에도 tool이 닫히지 않으면 SIGKILL로 멈추며, signal을 받은 경우 그 signal로 끝납니다. 실행기 자신의 SIGKILL만 group을
  남깁니다.
- `phpunit`은 `<cwd>/vendor/bin/phpunit` 또는 `COMPOSER_VENDOR_DIR`의 vendor directory(crudui)를 실행하고, extension은
  `--php-extension`(template, hyper의 `--extension`)으로 넘깁니다. 없는 extension은 tool을 시작하기 전에 실패합니다.
  `--php-extension`은 반복할 수 있습니다: 각 extension은 PHP 자체의 방식인 자기 `-d extension=<path>`로 주어진 순서대로
  load되므로 의존하는 extension 뒤에 load되며, 각각이 build되었는지 tool이 시작하기 전에 확인합니다(K165).
- 시작할 수 없는 tool은 command와 고치는 방법과 함께 실패합니다.
- `python`(K17)은 `python3 -m unittest <arguments> -v`를 실행하고 표준 오류를 읽습니다. test는 시작할 때 `<description> ... `을,
  끝날 때 결과를 쓰며, 이는 cargo의 직렬 libtest 출력과 같은 모양이므로 시작·결과 줄 parser 하나가 둘을 읽습니다. `ok`는
  pass, `expected failure`는 todo(통과가 아님), `skipped`는 skip, `FAIL`, `ERROR`, `unexpected success`는 fail입니다. description 뒤의 docstring 줄은
  description의 id를 유지합니다. timeout은 실행기가 적용합니다.
- `--results <file>`(K18)은 성공 여부와 관계없이 실행 기록을 임시 파일과 rename으로 씁니다. 기록은 count, 각 test의
  `{id, status, elapsedMs}`(`pass`, `fail`, `timeout`, `skip`), tool, 실행 경과 시간, 그리고 `--inputs` 경로(기본은 `--cwd`
  directory)의 추적 파일과 무시되지 않은 파일에 대한 `inputsDigest`인 `inputs`입니다. test 기록은 progress module이 하므로
  node·vitest reporter와 다른 tool의 parser는 더 할 일이 없습니다. 검사는 `inputs`를 현재 파일과 비교해 오래된 기록을 가려냅니다.

버린 동작:

- signal timeout을 쓰는 Python `unittest` 실행(`test.py`): 대신 `python` tool이 실행기의 timeout으로 `python3 -m unittest`를
  실행합니다(K17).
- crudui의 conformance record를 쓰는 `recordSuiteRun`과 `run-rust-command.mjs`를 통한 cargo 시작, template의 `tools.mjs`
  vitest 진입점, hyper의 `toolPath`는 저장소 전용입니다. 실행기는 `cargo`와 `go`를 `PATH`에서 시작하고(Makefile이 `var/tools`를
  앞에 둠) vitest는 `node_modules/vitest/vitest.mjs`로 시작합니다.

## CI report 도구 (K8.1-3)

`scripts/kit/ci-targets.mts`, `target-report.mts`, `ci-passed.mts`는 template, crudui의 `ci-targets.mts`, `target-report.mts`,
`ci-passed.mts`, hyper의 `ci-run.mjs`, ordered-json의 `ci_run.py`, orm의 `scripts/check/ci-passed.mts`,
`scripts/check/report.mjs`, `summary.mjs`를 대체합니다.

합친 동작:

- 모든 target은 `make -k <target>`으로 실패 이후에도 끝까지 실행하고, 출력은 화면에 쓰면서 `<report>/targets/<target>.log`에
  기록합니다(template, crudui, hyper, ordered-json). 실행은 `<report>.lock`을 잡습니다(template, crudui). 이전 실행의 report는
  먼저 지웁니다. target에는 시간 제한이 없습니다.
- hyper: `make --no-print-directory`, 호출한 make의 변수(`MAKEFLAGS`, `MFLAGS`, `MAKELEVEL`, `MAKEOVERRIDES`)를 넘기지 않음,
  표준 출력과 표준 오류가 한 줄로 섞이지 않는 완전한 줄, target 전후에 쓰는 `record.json`(중단된 실행은 실행 중이던 target을
  남김), 던지지 않고 `reportErrors`에 기록하는 report 쓰기(orm도 같은 규칙), 아무것도 기록하지 못했거나 끝나지 않은 실행에서도
  page를 만드는 `CI_STEPS`를 쓰는 `--summary` 단계(hyper와 ordered-json의 `summary`).
- 실패 줄: `✖`로 표시된 줄과 들여 쓴 상세(hyper), 없으면 통과, 시작, make 줄을 제외한 실패를 말하는 줄(hyper, template)과 검사기의
  `file:line: message` 줄 및 ordered-json의 낱말, 없으면 마지막 줄들; 그 뒤에 make가 끝난 방식. 통과한 target의 `WARNING ...`
  줄은 기록하고 보여 줍니다(hyper, orm).
- toolchain version과 runner image는 `record.json`과 summary에 들어갑니다(template의 `toolchains.json`, hyper의 `environment`).
- 1 MiB를 넘는 log는 처음 부분과 마지막 256 KiB를 남깁니다(orm).
- `ci-passed`: 입력은 `needs`의 JSON인 `RESULTS`(template, hyper, ordered-json; orm은 `CI_NEEDS`)이고, job마다 결과를 출력하며,
  `success`가 아닌 결과는 status 1로 실패하고, 설정되지 않았거나 쓸 수 없는 입력은 status 2로 실패합니다(crudui, orm). GitHub
  Actions에서는 `::error` annotation을 씁니다(crudui, orm).

버린 동작:

- `toolchains.json`과 `summary.json`(`record.json`이 담는 내용의 별도 파일), group directory `var/ci/<group>`와 hyper의
  `ci-check`, `ci-pins` target(report directory는 인자이고 PHP pin은 저장소 전용), GitHub Actions 밖에서의 거부(hyper: target
  실행은 어디서나 허용하며 전체 suite 가드는 full run의 몫), `var/records` 복사(ordered-json), 환경, disk, server log 파일,
  case runner protocol(`RUN`, `STEP`, `PASS`, `FAIL`)과 full-run report의 run id(orm)는 한 저장소의 검사에 의존하므로 그 저장소에
  남습니다.
- `ci-targets.mts`의 자체 lock(holder의 process id를 담은 파일이며, process가 끝나면 낡은 lock으로 보고 지움)은
  `holder-lock.mts`(K7.2)로 대체합니다. 끝난 holder의 lock은 `holder-lock.mts clear`가 지울 때까지 남습니다.

## 커밋 메시지 검사 (K8.1-4)

`scripts/kit/check-commits.mts`는 orm의 `scripts/git/check.mjs`를 공유 git 위생 검사로 가져옵니다. template, crudui, hyper,
ordered-json은 규칙에 같은 메시지 형식을 적었지만 검사는 없습니다. 형식과 한도는 `config/commits.json`
(`scripts/kit/schema/commits.schema.json`)의 data입니다.

합친 동작:

- orm: subject는 `type(scope): Subject (#id)`이고, Subject는 대문자로 시작하고 마침표로 끝나지 않으며 `subjectMax`자 이하입니다.
  범위 `<base>..<head>` 또는 마지막 commit을 읽고, merge commit은 검사하지 않으며, `--message <file>`은 commit하려는 메시지를
  (commit-msg hook) 주석 줄을 빼고 검사합니다.
- 새로 추가, 저장소의 공통 규칙에서: subject 다음에 빈 줄이 오고, 본문 한 줄은 `bodyMax`자 이하입니다(그보다 긴 단어 하나, 예를
  들어 URL은 허용).
- 새로 추가(K19): commit 하나는 모든 저장소가 선언하는 config/checklist.json의 tracker 항목 하나의 상태만 바꾸고(그 commit이
  추가한 행은 변경이 아님), 항목을 tracker의 `done` 상태로 옮기는 commit은 `config/commits.json`의 `changelog`와 그 번역도 바꿉니다. 범위의 commit은
  부모와 비교하고, commit하려는 메시지는 index를 HEAD와 비교합니다.

version 일관성과 orm의 다른 영역 검사:

- orm의 `scripts/checklist/check.mjs`는 문서 검사의 checklist reader(list 형식)가 대신합니다. `scripts/version/check.mjs`는 version
  선언 목록(Cargo, Composer, npm manifest, lock 파일, contract, README, SECURITY, AGENTS 문구)과 `VERSION` 파일과의 비교를 orm에
  둡니다. 선언은 제품 전용이기 때문입니다. 모든 manifest가 release의 version을 가진다는 공통 부분은 release 도구(K5)이고, changelog
  검사의 공통 부분인 changelog section은 문서 검사(K7.1)입니다.
- orm의 `scripts/repo/*.mjs`(`check`, `ci`, `scripts`, `target`, `testcases`, `toolchains`, `gosource`, `node`, `probes`,
  `messages`)는 orm의 배치, Rust target 경로, toolchain, test case, 실패 메시지의 형식을 검사하므로 orm에 남습니다.
- orm의 `scripts/check/ci-passed.mts`는 CI report 도구(K8.1-3)입니다.

버린 동작:

- `ORM_GIT_RANGE`: 범위는 인자 `--range`(make 변수 `RANGE`)입니다.
- rule id `git.subject-format`과 `contracts/rules.json`: 설정은 `config/commits.json`입니다.

## Release 도구 (K5)

`scripts/kit/release.mts`는 다섯 저장소의 release 도구를 하나로 합칩니다(`verify`, `versions`, `assets`, `publish`, 그리고
`coverage`). 저장소는 `config/release.json`의 데이터입니다(schema `scripts/kit/schema/release.schema.json`):

```json
{
  "schema": 1,
  "repositoryUrl": "https://github.com/<owner>/<name>",
  "changelog": "CHANGELOG.md",
  "changelogTranslations": ["CHANGELOG.ko.md"],
  "checks": ["push-gate", "ci-passed"],
  "packages": [{ "kind": "npm", "directory": "packages/x", "name": "@scope/x" }],
  "manifests": { "package.json": "version", "packages/x/package.json": "archive", "crate/Cargo.toml": "git-tag" },
  "notReleased": { "tests/consumer/package.json": "the reason" },
  "goModules": { "packages/go": "example.com/module/packages/go" }
}
```

`changelogTranslations`와 `checks`는 선택입니다(`checks`의 기본값은 `push-gate`와 `ci-passed`). `manifests`의 값은 `archive`(`packages`에 있는
package의 manifest), `version`(archive 없이 version만 가짐), `git-tag`(git tag로 소비됨)입니다. `goModules`는 directory(저장소 root는 `.`)를 그
go.mod의 module path에 연결합니다.

### 합친 동작 (더 넓은 동작을 유지)

- 상수 대신 데이터: template, hyper, ordered-json의 `PACKAGES`, `MANIFESTS`, `NOT_RELEASED`, `GO_MODULES`, `CHECKS`, `REPOSITORY_URL`과
  changelog는 `config/release.json`입니다. 목록은 명시적이며 빠진 항목은 coverage가 찾습니다.
- `verify`: `origin/main`의 조상인지와 각 check의 가장 최근 run(다섯 저장소 모두). main에 없다는 결과와 check 결과는 한 메시지로
  보고합니다(crudui). check의 가장 최근 run은 id가 가장 큰 run이므로, 성공한 재실행이 실패한 run을 대체합니다.
- `versions`: manifest 종류 package.json, composer.json, Cargo.toml, pyproject.toml(template)과 VERSION(orm); Go tag뿐 아니라 root tag에서도
  선언된 모든 go.mod의 module path(orm, template보다 넓음); 저장소 root의 Go module(orm); section이 있어야 하는 추가 changelog(orm,
  `changelogTranslations`). composer.json은 `archive` manifest가 아니면 `version`을 생략할 수 있습니다(hyper는 어디서나 생략을 허용하고
  template과 ordered-json은 어디서나 version을 요구합니다. artifact repository가 version을 읽으므로 archive는 선언해야 합니다).
- changelog section: heading, entry 필수, 다음 section의 anchor 줄 제거(template, hyper, ordered-json); 긴 section의 link는 heading 위의
  `<a id>` 줄을 쓰고 없으면 점을 뺀 version을 씁니다(hyper, ordered-json); notes 한도는 125000자입니다(모두).
- manifest 규칙(`manifestProblems`)은 규칙의 합집합입니다: npm의 모든 dependency field(`dependencies`, `devDependencies`,
  `peerDependencies`, `optionalDependencies`)와 Composer의 `require`, `require-dev`(crudui, ordered-json); 어떤 dependency도 path, URL, git source,
  development version이 아님(ordered-json); 이 저장소 scope의 package는 정확한 version 하나이고 저장소의 package는 tag의 version임(template);
  package.json에 `overrides` 없음(ordered-json); composer.json은 tag의 version을 선언하고 `repositories`가 없음(template, orm). scope는 `packages`의
  이름에서 얻으므로 도구는 scope 이름을 갖지 않습니다.
- `assets`: tag한 commit의 manifest가 package를 묶기 전에 규칙을 통과하고(ordered-json), manifest의 name이 `config/release.json`의 name과 같고(신규),
  각 archive가 commit의 manifest를 바이트 단위로 그대로 담습니다(ordered-json, crudui, orm; template은 파싱한 JSON을 비교했음). directory는
  대상 옆에 만들어 이름을 바꾸므로 실패한 실행은 archive를 남기지 않습니다.
- `publish`: API로 만든 draft release(원격에서 tag를 찾은 뒤 `gh api --method POST repos/O/R/releases`, `--verify-tag`가 요구하던 대로), 각 archive를 그 release의 upload URL로 올리고 id를 `var/release/<tag>.json`에 기록(K79); 다섯 도구는 `gh release create TAG --verify-tag`를 실행했음; archive 이름은 목록 file이 아니라
  설정에서 옵니다(orm은 `assets.txt`를 썼음).
- `coverage`: 추적되거나 새로운 모든 package.json, composer.json, Cargo.toml, pyproject.toml, go.mod, VERSION file은 `manifests`, `notReleased`,
  `goModules` 중 하나에 있습니다(template test, orm `unlistedManifests`); 목록에 있지만 없는 file과 두 목록에 있는 file은 결과로 보고합니다(orm, 더 넓음).
  kit이 쓰는 file은 릴리스되지 않으며 항목이 필요 없습니다(K167): Node의 `@polyspec/kit/package.json` self-reference로 찾은 실행 중인
  package의 `kit.copies` 사본(make kit-sync), PHPUnit의 Composer project `config/phpunit/composer.json`(make install-tools),
  `.mise/locks/` 아래 mise의 lock tree(make toolchain-lock)입니다.
  package.json의 `file:` dependency는 레포의 folder를 가리킵니다. 단 `consumers.npm.directory`가 선언한 npm consumer project의 `file:`
  dependency는 그 `smoke` package의 archive, `file:<name>-npm-<version>.tgz`입니다(K129). 이 규칙은 `config/release.json`을 읽으므로
  선언을 읽지 않는 alint가 아니라 여기에 있습니다.

### 버린 동작

- crudui는 `packages/`의 package를 찾고 `private`을 건너뛰었습니다. 명시적 목록으로 대체하여 버렸고, 목록에 빠진 package file은
  coverage가 보고합니다.
- crudui는 check의 어떤 run이라도 성공이 아니면 실패했습니다(재실행된 이전 실패 run 포함). 성공한 재실행 뒤에도 release를 막으므로 버렸습니다.
  orm은 run을 `started_at`으로 정렬했습니다. 생성 순서대로 커지는 id로 대체하여 버렸습니다.
- crudui와 orm은 release 도구 안에서 `make build`, `make typescript-build`, `scripts/package-dist.mjs`를 실행했습니다. 버렸습니다. package의 build는
  저장소가 자기 `release-assets` recipe에 붙이는 선행 단계이므로 도구는 build를 알지 못합니다.
- crudui `RELEASE_COMMIT`(tag가 생기기 전의 assets)은 합치지 않습니다. archive를 소비자처럼 설치하는 일(template `release-consumer`, crudui
  `release-install`, hyper와 orm `release-install`)은 "Release archive의 consumer 설치 (K5.4)"에서 합쳤습니다.
- orm의 `.runtime/release` 출력과 `assets.txt`: 출력은 모든 저장소에서 `var/release/assets`입니다.
- release 단계가 아니어서 합치지 않음: template `check-clean-release.mjs`(clean worktree에서 전체 matrix)와 hyper `publish.mjs`(개발용 설치본).
- ordered-json `release.py`는 Node 도구로 대체합니다.

### Archive 이름 (K5.2)

- 이름: `<package>-<language>-<version>.<ext>`; `@scope/name`은 `scope-name`, `vendor/name`은 `vendor-name`으로 쓰고, language는 npm package는 `npm`,
  Composer package는 `php`입니다. `@polyspec/x`는 `polyspec-x-npm-0.0.5.tgz`, `polyspec/x`는 `polyspec-x-php-0.0.5.zip`,
  `polyspec/x-extension`은 `polyspec-x-extension-php-0.0.5.zip`입니다. 다섯 도구는 archive를 `<package>-<version>.<ext>`로 불렀습니다(ordered-json은 이미
  language를 가졌음). npm package와 Composer package가 이름을 공유할 수 있으므로 language를 유지합니다.
- `npm pack`은 출력 이름을 스스로 정합니다. 대상 directory에 새로 생긴 file 하나의 이름을 archive 이름으로 바꿉니다(ordered-json, template). 새 file이 없거나
  여럿이면 그 이름과 함께 실패합니다. crudui와 orm은 pack report나 package 이름에서 이름을 얻었습니다. 새 file 하나 규칙이 둘을 모두 덮고 npm 출력 형식을 요구하지 않습니다.
- Zip: tag한 commit의 package directory를 `git archive --format=zip -0`으로 만들고 `--mtime`을 commit 시각으로, `TZ=UTC`로 둡니다(ordered-json은 고정 상수 시각,
  template은 commit 시각, crudui, hyper, orm은 둘 다 쓰지 않았음). tree에 대한 `git archive`는 `--mtime` 없이는 현재 시각을 쓰고 zip은 local time을 저장합니다.
  같은 tag의 두 번째 실행은 언제 어느 time zone에서든 같은 바이트를 씁니다.

### Go module tag (K5.3)

- Go proxy는 저장소 root 아래에 있는 module을 `vX.Y.Z`가 아니라 tag `<directory>/vX.Y.Z`에서 얻습니다. 한 release에서 이 tag가 빠진 적이 있습니다.
  이제 tag `vX.Y.Z`의 `verify`는 root 아래 `goModules`의 모든 module에 대해 `vX.Y.Z`와 같은 commit의 tag `<directory>/vX.Y.Z`를 요구합니다.
  tag가 없는 경우와 다른 commit에 있는 경우는 결과로 보고하며, tag 이름, module path 또는 두 commit, 그리고 tag를 만드는 명령을 적습니다
  (`git tag -a <directory>/vX.Y.Z -m <directory>/vX.Y.Z <commit> && git push origin <directory>/vX.Y.Z`; 다른 commit에 있는 tag는 먼저 `git tag -d`로 지움).
  결과는 ancestry와 check run 결과와 같은 메시지에 보고합니다.
- 단계 `go-tags TAG`(`make release-go-tags`)는 이 검사만 offline으로 실행하므로, maintainer가 tag를 붙인 뒤 실행할 수 있습니다. 이 row 이전에
  template과 ordered-json은 release 정책에 이 tag를 적었지만, 다섯 저장소의 어떤 도구도 검사하지 않았습니다.
- tag `<directory>/vX.Y.Z`는 그 module만 release합니다. sibling tag가 필요 없고 archive도 만들지 않습니다. 저장소 root(`.`)의 module은 `vX.Y.Z` 자체로 release되며 다른
  tag가 필요 없습니다. tag는 `verify`를 실행하는 checkout에 있어야 하므로, 이를 실행하는 workflow는 tag를 fetch합니다.

## 체크리스트 모델 하나 (K7.2)

`scripts/kit/checklist.mts`는 push gate와 guard의 reader(K6.1)를, `scripts/kit/checklist-rows.mjs`는 문서 검사의 reader(K7.1)를
담았습니다. 둘은 같은 문서(표의 행 `| ID | ... | [o] |`, 목록 항목 `- [o] ID text`, 상태 `[ ]`, `[~]`, `[o]`, `[!]`)를 두 설정,
곧 `config/checklist.json`의 `trackers`와 `config/documents.json`의 `checklists`로 읽었습니다. 이제 reader 하나, 설정 하나,
finding 하나입니다.

- `readChecklist(text, tracker, { strict })`는 `{ items, findings }`를 반환합니다. item은 `{ id, title, state, line }`이며 state는
  문서에 적힌 그대로(`[o]`)입니다. 관대한 읽기(gate와 guard)는 형식이 틀린 행이나 항목, `states` 밖의 state, 반복된 ID, 항목이 없는
  문서를 보고하고, `activeItems`는 그 어느 것에서든 예외를 던집니다. 엄격한 읽기(문서 검사)는 같은 finding에 더해 제목이나 task가
  아닌 줄, task의 state가 아닌 state marker, state 말고 다른 것을 담은 state cell, cause와 retry가 없는 bypass를 줄과 열과 함께
  보고합니다. 각 읽기의 메시지는 합치기 전에 test가 단언하던 메시지입니다.
- `twinFindings`는 두 읽기에서 문서와 번역의 item을 비교합니다.
- `config/checklist.json`은 모든 체크리스트를 선언합니다: `path`, `translation`, `format`(`table` 또는 `list`), `idPattern`, `states`,
  `active`, `column`. `check-documents.mts`는 체크리스트를 여기서 읽습니다. `config/documents.json`의 `checklists` key와 그 schema는
  없어지고, key `style`은 `format`입니다. `translation`이 없는 체크리스트는 영어만 읽습니다.
- 더 넓은 동작을 채택: task ID 뒤에 `` T3.2 `parallel` ``처럼 code span이 올 수 있습니다(두 읽기 모두). 엄격한 reader는 ID 뒤의 아무
  글이나 받았으나, 이제 code span만 받으므로 `not an id` 같은 첫 cell은 두 읽기 모두에서 finding입니다. 표의 행은 들여 쓸 수
  있습니다. `states`는 엄격한 읽기에도 적용되므로 `states`를 선언하지 않은 체크리스트는 엄격한 읽기에서 모든 state 단어를 받습니다(엄격한
  reader는 네 state만 받았음). 구분 줄과 header는 위치와 cell `ID`로 알아봅니다.
- `ci-targets.mts`는 `holder-lock.mts`로 report를 잡고, 자체 lock 함수는 없앴습니다.

## 공유 module (K11)

`scripts/kit`의 여러 도구가 같은 helper를 각자 가지고 있었습니다. 이제 각 helper는 module 하나에 있고 사용하는 쪽이 import하며,
`make duplication-check`는 6줄 이상의 같은 부분이 두 번 있으면 실패합니다. jscpd가 scripts/kit의 token을 읽으므로 함수 안에서
되풀이된 부분도 찾는데, 이것이 대신한 test(`tests/kit/duplication.test.mts`, 함수 전체만 비교)는 찾지 못했습니다(K126). 기준 코드에는
그만큼 긴 쌍이 없었고, 가장 짧은 쌍은 `startReport`의 4줄이었습니다.

| Module | 담는 것 | 대체한 것 | 사용처 |
|---|---|---|---|
| `paths.mts` | working directory가 속한 Git work tree의 top level인 `repositoryRoot()`(K144), `isMain(import.meta.url)` | 22개 module이 계산하던 root 경로와 21곳의 `process.argv[1] === ...` 검사 | 기본 root를 쓰는 모든 command와 module |
| `process.mts` | `execute`, `run`, `Stop` | release의 `run`, dependency-review의 `run`, `encoding`과 `maxBuffer`를 적은 `spawnSync` 호출 | release, dependency-review, check-toolchain, check-cargo-downloads, check-dependency-policy, git |
| `git.mts` | `git`, `gitResult` | full-run, push-gate, owner-check, kit-sync, tracked-files, target-report의 `git` helper와 git-hooks, check-commits, push-gate의 직접 `git` 호출 | 위 module들 |
| `bootstrap/files.mts` | `readJson`, `writeAtomic`, `jsonText`, `writeJson` | dependency-state의 `readJson`, 약 25곳의 `JSON.parse(readFileSync(...))`, full-run, kit-sync, target-report, tool-wrappers, git-hooks, pin-python-dependency의 임시 파일과 rename 쓰기 | 위 module들 |
| `bootstrap/digest.mts` | `digest`, `sha256`, `fileDigest` | check-documents와 kit-check의 `sha256`, dependency-state와 install-composer(K127에서 사라짐)의 `digest`, install-npm의 sha512 | 위 module들 |
| `time.mts` | `now`, `seconds`, `compactSeconds` | ci-targets와 full-run의 `now`, full-run과 target-report의 `seconds`(`1.2 s`), test-progress와 test-hooks의 `seconds`(`1.2s`) | 위 module들 |
| `version.mts` | 생태계별 `isPrerelease`, `older`, `stableDescending`: npm과 Go는 semver, PyPI는 @renovatebot/pep440; Composer release는 최신이 아니면 오래된 것이며, 이는 composer outdated의 `latest-status` 규칙입니다(K73) | changelog의 `compare`, dependency-state의 version 순서, dependency-review의 `highestStableRelease` 정렬; 쓰이지 않던 `highestStable`은 없앰; changelog와 release tag 순서는 semver를 직접 씀 | dependency-review, check-dependency-policy |
| `findings.mts` | `finding` | status-table과 changelog의 `finding` | status-table, changelog |
| `markdown.mts` | `lineBlocks`, `headings` | `|`로 시작하는 모든 줄을 읽던 checklist의 `cells`와 status-table의 `rowCells`(K130: tree의 행과 list item), `changelog.sections`와 release notes의 `## ` 줄(K130: tree의 heading). fence, 산문, link, anchor는 GFM과 YAML front matter를 켠 mdast-util-from-markdown의 syntax tree에서 읽고, heading anchor는 github-slugger와 @mdit-vue/shared(VitePress)의 slug임(K120) | checklist, status-table, changelog |
| `schema-validate.mts` | `SCHEMAS`, `readConfig`, `readJsonFile`, `parseJson`, `readConfigFindings`, `SchemaError`: kit의 JSON 경계(K158). 도구가 읽는 모든 JSON(파일이나 command의 출력)은 strict Ajv2020이 `scripts/kit/schema`의 schema 파일로 검증하며, ajv의 type guard `ajv.compile<T>(schema)`가 받아들인 뒤에야 호출자가 정한 type `T`를 가집니다. schema를 어기는 data는 `SchemaError`를 던지고, 그 각 줄은 파일이나 command와 ajv error의 JSON Pointer를 밝힙니다. 그 줄을 finding으로 보고하는 check는 `readConfigFindings`로 읽습니다. 예시 호출자는 `scripts/kit/kit-check.mts`입니다: `lockedVersion`과 `installedKit`는 `manifests.mts`로 package-lock.json과 설치된 package.json을 읽고, `checkConfig`는 각 config/<name>.json의 error를 보고합니다. ajv가 설치되기 전에 도는 bootstrap은 `bootstrap/files.mts`의 `readJsonObject`로 JSON object를 읽고 각 field를 스스로 검사합니다 | checklist와 release의 `loadConfig`에 있던 읽기와 검증 코드, scripts/kit의 모든 `JSON.parse(...) as T`와 `readJson(...) as T`(K158) | JSON을 읽는 모든 도구 |
| `manifests.mts` | 각자의 schema(`npm-manifest`, `npm-lock`, `composer-manifest`, `composer-lock`)로 검증하는 reader와 함께 `NpmManifest`, `NpmLock`, `ComposerManifest`, `ComposerLock` | dependency-state, check-dependency-policy, toolchain-floors, release, release-consumer, kit-check, owner-check에 있던 package.json, package-lock.json, composer.json, composer.lock의 지역 shape(K158) | 위 module들 |
| `tracked-files.mts` | `checkedFiles`, `KIT_FIXTURE` | dependency-state의 `reviewedFiles`와 release의 `EXCLUDED` | dependency-state, release |
| `target-report.mts` | `TARGET_NAME`, `FAILURE_LINES`, `logPath`, `startReport`, `treeId` | target-run의 같은 이름들, target-run의 `LAST_LINES`, ci-targets의 target 이름 pattern, target-report의 `git` | ci-targets, full-run |
| `tool-wrappers.mts` | `RELEASE_OUTPUT`, `printedRelease` | release installer와 check-toolchain의 probe가 각자 가진 ruff, uv, alint, cargo-audit, govulncheck의 version 인자와 pattern. K127 이후 그 도구는 mise가 설치하고, probe와 bootstrap만 읽음 | check-toolchain, bootstrap |
| `dependency-state.mts` | `UPDATE` | check-dependency-policy와 dependency-review의 같은 상수 | 위 module들 |

그 밖에 없앤 중복:

- `toolchainVersions`가 둘(target-report, check-toolchain) 있었습니다. 이제 `ci-targets`의 record는 node, npm, go, rust, php,
  composer의 release를 `check-toolchain.toolchainVersions`에서 가져오며, target-report가 `v22.1.0`으로 출력하던 것이 `22.1.0`으로
  출력됩니다.
- check-dependency-policy의 `composer validate` 호출 두 곳이 함수 하나를 공유합니다.
- `cargoAuditCommand`, `govulncheckCommand`, check-toolchain probe의 경로는 같은 경로의 세 가지 표기였습니다. K127 이후
  각각은 `mise-tools.mts`의 `toolCommand`가 가리키는 mise의 shim입니다.

사본마다 달랐고 합친 동작(더 넓거나 안전한 쪽을 유지):

- 실패한 git 명령은 어디서나 `git <인자> exited with <status>: <standard error>`로 보고하고, `check-commits`는 풀리지 않는 range의
  메시지에 git 명령을 적습니다.
- `dependency-review`의 실패한 명령은 마지막 세 줄 대신 standard error 전체를 보고합니다.
- `ci-targets`의 target 이름은 `full-run`처럼 글자나 숫자로 시작합니다. `ci-targets`는 make가 option으로 읽는 `-x`도 받았습니다.
- `dependency-review`와 `release` coverage는 kit fixture뿐 아니라 `node_modules`, `var`, `.tools`도 건너뜁니다.
- changelog의 fence 탐색은 `scanFences`의 규칙(닫는 fence는 여는 fence만큼 김)으로 fence를 닫습니다.
- install-cargo-audit와 install-govulncheck는 build를 `tool-wrappers.run`으로 실행했으며, 이는 실행 전에 명령을 출력하고 없는
  명령을 이름으로 알립니다. K127 이후 둘 다 mise가 build합니다.

그대로 둔 것과 이유:

- `make -k <target>`을 실행하는 runner는 하나입니다. target-report의 `runLogged`입니다. `target-run.mjs`와 그 `runMakeTarget`은 제거했고,
  full-run은 target을 `runLogged`로 실행하며 통과 여부는 `targetPassed`로 읽습니다. 더 넓은 동작을 유지합니다. 호출한 make의 환경을
  지우고, 완전한 줄만 넘기고, log 쓰기 실패를 기록합니다. full run의 target log는 명령으로 시작하고 CI report의 log처럼
  `[report] make <target> exited with status N`으로 끝납니다(task K11-1).
- 설정 파일이 없다는 메시지는 `check-commits`, `check-documents`, `owner-check`에서 파일의 용도를 적으며, 세 문장이 다릅니다.
- `kit-check`는 설치된 package의 `kit.copies`가 이름을 대는 사본만 disk에서 읽고, `trackedFiles`는 Git이 보는 파일을 읽습니다.
- npm range 함수는 dependency-state에 남습니다: version의 일반 순서가 아니라 npm의 규칙을 구현합니다.

## Python lint (K8.4)

Python lint는 한 저장소의 target으로, package에 `ruff check`와 `ruff format --check`를 실행했습니다. kit은 이것을
`scripts/kit/lint-python.mts`와 `make lint-python`으로 가져옵니다. ruff는 checkout root에서 `var` 제외 옵션과
`--config ruff.toml`로 실행하며, ruff.toml은 kit이 복사하는 설정입니다(Lint 설정, K77). ruff는 mise의 shim이고 버전은
`mise.toml`의 `ruff`가 선언한 것이므로(K127) 결과가 머신의 ruff 설정에 의존하지 않습니다. ruff는 ruff 자신의 설정인
`ruff.toml`의 `cache-dir`로 cache를 `var/ruff`에 두며, 이 설정은 repository의 모든 ruff 실행에 적용됩니다. 전에는 root에
`.ruff_cache`를 썼고 layout S5가 이를 거부합니다(K147). 앞 단계가 실패해도 모든 단계를
실행합니다. 설치되지 않은 도구는 고치는 방법과 함께 실패합니다.

ruff pin은 pyproject.toml에 두지 않습니다. wheel을 배포하는 라이브러리는 `Requires-Dist`에 ruff를 두지 않으며, dependency review는
`mise.toml`의 `ruff`를 PyPI dependency로 읽습니다. 새 ruff는 `mise.toml`에 손으로 설정하고 `make toolchain-lock`으로 lock합니다.

## Lint 설정 (K77)

kit은 모든 저장소의 lint 설정과 언어마다 runner 하나를 가집니다(standards plan, §1 항목 5). 도구가 고정 경로에서 읽는 설정은
kit의 파일이고, 저장소는 그 사본을 가집니다. 각 runner는 그 설정을 명시적으로 넘깁니다. kit이 복사할 수 없는 manifest 안에 사는
규칙은 `config/layout.kit.yml`의 규칙이며, `make layout-check`가 alint로 실행합니다. 대부분 `config/`의 JSON Schema를 쓰는
`json_schema_passes` 규칙입니다. plan의 검증에서 나온 false green은 real test `tests/source/lint-<language>-real.test.mts`의
fixture이며, 각 fixture는 자기 위반에서 실패합니다. 모든 도구는 최신 stable release이고 S4의 pin에서 확인했습니다.

| 언어 | 도구 (pin) | 설정 | Runner |
|---|---|---|---|
| Python | ruff 0.17.0, vulture 2.16 (`mise.toml`) | `ruff.toml`; `lint-ruff-nested`, `lint-ruff-files`, `lint-vulture-config` (`config/pyproject.schema.json`) | `lint-python.mts`: `--config ruff.toml`로 ruff; 각 package의 Python 파일에 그 폴더에서 confidence 60으로 vulture |
| PHP | phpcs 4.0.4, PHPStan 2.3.1, spaze/phpstan-disallowed-calls 4.15.0, phpstan/extension-installer 1.4.3 (Composer project `config/php-lint`) | `phpcs.xml.dist`, `phpstan.dist.neon`; `lint-composer-policy` (`config/composer.schema.json`) | `lint-php.mts`: checkout의 PHP 파일에 phpcs; 각 Composer package에 그 package 또는 그 위의 가장 가까운 Composer project(Composer monorepo의 root development project 등)의 `vendor/autoload.php`로 PHPStan(`composer-vendor.mts`, run-tests와 공유; `COMPOSER_VENDOR_DIR`는 다른 vendor directory를 지정) |
| Rust | `rust-toolchain.toml`의 cargo clippy | `lint-cargo-lints` (`config/cargo.schema.json`) | `lint-rust.mts`: 각 workspace에서 `cargo clippy --workspace --all-targets --locked -- -D warnings` |
| Go | golangci-lint 2.14.0, golang.org/x/tools 0.52.0의 deadcode (`mise.toml`) | `.golangci.yml`: error string은 spec의 대소문자를 유지하는 cross-port message이므로 ST1005 없는 staticcheck, 모든 finding 보고(`max-same-issues`와 `max-issues-per-linter` 0; K164) | `lint-go.mts`: 각 module에서 golangci-lint와 `deadcode -test ./...` |
| TypeScript | oxlint 1.88.0과 oxlint-tsgolint 7.0.2004, knip 6.41.0, API Extractor 7.59.4 (kit의 dependencies, kit과 함께 설치) | `.oxlintrc.json`, `knip.json`, `config/api-extractor.kit.json` | `lint-ts.mts`: `oxlint --type-aware --deny-warnings`, knip, `api-extractor.json`이 있는 각 package에서 API Extractor |
| 전체 | — | `.editorconfig` | 없음: 각 언어의 formatter가 같은 규칙을 강제합니다 |

make target과 사본(`kit.copies`)은 kit package 위에서 연결합니다. bootstrap 이후에 `toolchain-mise.mts`가 `mise.toml`의 lint 도구를,
`toolchain-lint.mts`가 PHP lint를 읽고, `make toolchain-check`는 설치된 각 release를 확인합니다: vulture, golangci-lint,
deadcode(release를 출력하지 않고 shim은 mise이므로 `mise which deadcode`가 가리키는 binary의 `go version -m`으로), 그리고
PHP를 선언한 저장소(config/toolchain.json의 `php` 또는 `.php-version`)에서 `config/php-lint/composer.lock`이 고정한 release의
phpcs와 PHPStan입니다. 모든 저장소가 그 사본을 가지며, 저장소가 선언하지 않은 도구는 설치하지도 검사하지도 않습니다.

### 결정

- **Composer policy와 중첩 설정은 alint로.** plan은 composer.json policy schema에 ajv를 지정했습니다. kit이 이미 pin한
  alint는 JSON, TOML, YAML을 JSON Schema로 검증하고(`json_schema_passes`) TOML을 조회하므로(`toml_path_absent`), S1에 따라 kit의
  validator를 만들지 않습니다.
- **S2.** phpcs의 PSR-1 `MultipleClasses`가 파일당 class 하나를 지킵니다. `composer dump-autoload --optimize --strict-psr`는 첫
  class가 파일 이름과 맞으면 통과시키고 나머지를 조용히 버립니다(fixture). extension의 stub(`*.stub.php`)은 제외합니다.
  gen_stub.php는 extension의 모든 class를 한 파일에서 읽기 때문입니다. PHPStan은 금지된 호출만 실행합니다
  (`customRulesetUsed`): 문자열 변수를 거친 것을 포함한 `spl_autoload_register`와 `Composer\Autoload\ClassLoader`의 모든
  method입니다. extension-installer가 extension을 등록하므로 설정은 경로를 적지 않습니다. policy schema는 `classmap`과 PSR-0을
  금지하고, library에는 `autoload.psr-4`와 `autoload-dev.psr-4`를 요구합니다. php-ext와 project는 자기 class가 없습니다.
- **S3, Python.** TID251은 `sys.path`, `importlib.import_module`, 파일 경로 loader를 금지합니다. ruff는 qualified name을 정적으로
  풀기 때문에 `importlib.import_module("sys").path`가 `sys.path` 금지를 빠져나갔습니다(fixture). 테스트에 필요한 module은 import
  문이 모두 적습니다. `--config`를 주면 ruff는 중첩 설정을 무시하지만 editor나 그냥 실행한 ruff는 가장 가까운 설정을 적용하므로,
  중첩 `[tool.ruff]`, `ruff.toml`, `.ruff.toml`은 root를 extend하게 하는 대신 실패합니다.
- **Dead code.** vulture는 기본 confidence 60으로 실행하며 package가 올릴 수 없습니다. consumer만 쓰는 code는 package의
  `vulture_whitelist.py`(`vulture --make-whitelist` 형식) 항목과 그 이유로 유지합니다(S8). `[tool.vulture]`는 생성된 code만
  `exclude`할 수 있으며 각 경로에 이유를 답니다. deadcode는 `-test`로 실행하므로 library의 테스트가 root이고, 어떤 테스트도
  닿지 않는 exported function은 finding입니다. deadcode는 finding을 보고해도 0으로 끝나므로 runner는 출력이 있으면 실패합니다.
  knip은 Makefile도, script가 spawn에 넘기는 경로도 읽지 않으므로 make가 실행하는 파일은 layout에 따라 entry입니다(K142):
  S3의 node:test 파일, kit의 사본을 포함한 `scripts/` 아래 S9의 script, `benchmarks/`의 프로그램입니다. Makefile이 include하는
  `@polyspec/kit`은 무시하는 dependency입니다. Makefile이 실행하는 script는 통과하고, 아무도 import하거나 실행하지 않는 파일은
  여전히 실패합니다(fixture). kit은 같은 설정으로 자신을 lint하며, CI와 `scripts/kit`, `tests`, lint 설정의 owner check에서
  실행합니다(K142). knip.json의 `ignoreBinaries`는 script와 test가 실행하지만 어떤 npm package도 제공하지 않는 system 도구를
  적습니다: make, shasum, 그리고 polyspec이 mise나 setup으로 고정하는 runtime(go, rustup, php, composer, python3, cargo,
  node, git; K152)입니다. 한 레포만의 도구(Apple `container` 등)는 `config/knip-entries.json`의 `binaries`에 이유와 함께
  선언하고, lint-ts가 그 목록 뒤에 더합니다. 선언한 binary는 통과하고 선언하지 않은 binary는 여전히 unlisted binary입니다
  (fixture). knip.json의 나머지는 kit 자신을 위한 것입니다: make가 kit의 fixture recorder를 실행하고, kit의 script가
  `node_modules/.bin`의 oxlint, oxlint-tsgolint, jscpd를 실행합니다. knip.json은 평범한 JSON이므로 lint-ts가 읽습니다. 그
  pattern 밖에서 make가 실행하는 파일(`packages/js/test/` 아래의 probe 등)은 레포가 사본이 아닌 자기 파일
  `config/knip-entries.json`(kit의 schema가 있습니다)에 이유와 함께 선언하는 entry입니다(K145): knip에는 `extends`가 없으므로
  lint-ts가 knip.json의 `node.entry` 뒤에 그 entry를 더한 설정을 `var/lint-ts/knip.json`에 쓰고 knip을 그 파일의 `--config`로
  실행합니다. 선언한 파일은 통과하고 선언하지 않은 고아 파일은 여전히 실패합니다(fixture). 자기 package.json을 가진 중첩 npm
  project(ssr의 build test가 compile하는 fixture 등)는 레포가 같은 파일의 `workspaces`에 이유, 그 directory 기준의 entry,
  그 JavaScript가 import하지 않는 dependency(`ignoreDependencies`, Rust test만 읽는 것 등)를 각각 이유와 함께 선언하는 knip
  workspace입니다. lint-ts는 root가 여전히 knip.json인 생성 설정의 `workspaces`에 그것을 더합니다(K154). svelte에 의존하는
  workspace의 `.svelte` 파일은 knip의 Svelte plugin이 compile합니다. 선언하면 그 dependency는 통과하고, root entry로 두거나
  선언하지 않으면 root의 unlisted dependency입니다(fixture). 어떤 JavaScript도 import하지 않고 Makefile의 recipe만 실행하는
  root의 dependency(hyper가 URL로 설치하는 template compiler 등)는 같은 파일의 `ignoreDependencies`에 이유와 함께 선언하고,
  knip은 Makefile을 읽지 않으므로 lint-ts가 knip.json의 `ignoreDependencies` 뒤에 그것을 더합니다(K159). 선언하면 통과하고,
  선언하지 않으면 여전히 unused dependency입니다(fixture). 이 저장소의 code가 아닌 파일(site가 보여 주고 아무것도 실행하거나
  import하지 않는 sample source 파일, 일부러 깨뜨린 build 도구 test의 입력 등)은 같은 파일의 `ignore`에 root 기준 glob과
  이유로 선언하며, knip도 oxlint도 그것을 읽지 않습니다. lint-ts는 그 glob을 그런 파일을 위한 knip의 문서화된 option인
  knip.json의 `ignore` 뒤에 더하고(K162), 아래 kit 사본처럼 명령줄에서 oxlint에 `--ignore-pattern`으로 줍니다(K172).
  선언하면 통과하고, 선언하지 않은 unused 파일은 여전히 knip에서 실패하며, 선언한 glob 밖의 같은 oxlint 위반은 여전히
  oxlint에서 실패합니다(fixture).
  자기 package의 build 출력(`../dist/values.js` 등)을 import하는 test는 tsc가 그곳에 내보내는 source를 씁니다. knip은
  workspace의 `tsconfig.json`이나 그것이 참조하는 project를 통해서만 `outDir`을 그 `rootDir`로 옮기고, knip의 `paths`는
  풀리지 않는 import에만 적용되므로 build된 dist에는 닿지 않습니다. package는 build를 자기 tsconfig(`outDir: dist`,
  `rootDir: src`, TypeScript project reference가 요구하는 `composite: true`)에 두고, 여전히 test를 포함하는
  `tsconfig.json`의 `references`에 그것을 적습니다. `tsconfig.json` 자체에 `rootDir: src`를 두면 tsc가 test에서
  실패합니다(TS6059). 참조하면 그 export는 통과하고 tsc는 test를 검사하며, 참조하지 않으면 unused export입니다(fixture,
  K175).
- **Rust.** lint는 각 Cargo.toml에 있습니다. workspace는 `unsafe_code`를 deny하여 `transmute_copy`를 잡고(fixture),
  `clippy::allow_attributes_without_reason`을 deny하여 unsafe code는 이유를 적은 FFI 위치에서만 허용합니다. 이것이 없으면
  crate 수준 `#![allow(unsafe_code)]`가 조용히 통과합니다. Cargo는 `lints.workspace = true`라고 적은 member에만 lint를 적용하므로
  모든 package가 그렇게 적어야 하며, workspace 밖의 package는 실패합니다.
- **Go.** gomoddirectives는 모든 `replace`를 금지합니다. 저장소의 module은 `go.work`로 서로를 찾으며, 배포한 go.mod는 consumer가
  보지 못하는 replace를 가지지 않습니다. `go mod tidy`가 go directive와 같은 toolchain 줄을 지우므로 toolchain 줄도 금지합니다.
  forbidigo는 넣지 않습니다. 금지할 Go API를 정한 standard가 없고, 기본값은 모든 CLI의 `fmt.Print`를 금지합니다.
- **TypeScript.** typescript-eslint는 TypeScript 7을 지원하지 않으므로 type-aware 규칙은 oxlint-tsgolint의 것입니다. 이 규칙은
  typescript-eslint의 `disableTypeChecked`가 JavaScript에서 끄는 것처럼 `.oxlintrc.json`의 `**/*.{ts,mts,cts,tsx}`에 대한
  `overrides` 항목으로 TypeScript 파일에만 적용됩니다: 일반 .js나 .mjs 파일에서는 type이 없는 parameter가 모두 `any`이므로
  그 파일이 JavaScript라는 것만 보고했습니다. override는 category를 켤 수 없으므로 base가 correctness의 type-aware 규칙을 끄고
  override가 켭니다. type이 필요 없는 규칙은 모든 파일에 적용됩니다. type 없는 member access는 .mjs 파일에서 통과하고 .mts
  파일에서 실패하며, .mjs 파일의 `debugger`는 여전히 실패합니다(fixture, K170).
  `no-floating-promises`는 typescript-eslint가 node:test를 위해 둔 option, package `node:test`의 `test`, `describe`, `it`,
  `suite`, `skip`, `only`, `todo`를 담은 `allowForKnownSafeCalls`를 받습니다(K138): 최상위 등록은 runner가 기다리는 promise를
  돌려주는데 이 규칙이 그 하나하나를 실패시켰고(crudui에서 516개), test 파일에서 await하지 않은 `fetch`는 여전히 실패합니다
  (fixture). subtest `t.test`도 이름이 `test`이며, Node 26의 runner는 그것을 기다립니다. consumer의 tsconfig는 자기 script를
  담고 `scripts/kit`의 kit 사본은 담지 않으므로, oxlint-tsgolint는 그 사본을 project 밖에서 node의 type 없이 검사하게 되고
  거기서는 모든 `node:*` import가 `any`입니다(K150). 그래서 consumer에서 lint-ts는 설치된 package의 `kit.copies`, 곧 kit-sync가
  쓰고 kit-check가 byte 단위로 비교하는 기록의 각 파일마다 oxlint에 `--ignore-pattern`을 하나씩 줍니다: kit은 자기 사본을 자기
  tsconfig로 lint합니다. 설정 파일의 pattern은 그 파일의 directory를 기준으로 하므로 pattern은 명령줄로 갑니다. fixture
  consumer에서 사본에 심은 위반은 통과하고 자기 script의 같은 위반은 실패하며, 설치된 kit이 lock된 version이 아니면
  kit-check처럼 실패합니다(K157). type의 비상구는 실패합니다(K155): `ban-ts-comment`는 `@ts-ignore`와
  `@ts-nocheck`를 금지하고 `@ts-expect-error`에 설명을 요구하며(아무 error도 없으면 tsc 자신이 실패시킵니다),
  `no-explicit-any`와 `no-unnecessary-type-assertion`이 켜져 있습니다. fixture가 각각을 심습니다. `oxc/number-arg-out-of-range`는 꺼져
  있습니다(K161): 이 rule은 `toFixed`와 `toExponential`의 소수 자릿수 0에서 20, precision 1에서 21만 허용하는데, 이는 ES2018이
  100으로 올리기 전의 한계입니다(ECMA-262 `Number.prototype.toExponential`). 그래서 `toExponential(25)`를 실패시켰습니다.
  최신인 oxlint 1.88.0과 oxc main도 옛 한계를 유지하며, 이를 보고한 oxc issue는 없습니다. `toExponential(25)`를 담은
  fixture는 통과합니다. any는 type이 있는 자리로 흐르지 않습니다(K157):
  `no-unsafe-argument`, `no-unsafe-assignment`, `no-unsafe-call`, `no-unsafe-member-access`, `no-unsafe-return`은 any 값이
  인자, 대입, 호출 대상, member access의 객체, 반환값이 되면 실패시키고, `no-unsafe-type-assertion`은 type을 좁히는 type
  assertion을 실패시킵니다. fixture가 각각을 심습니다. JSON은 schema로 읽고(K158) unknown 값은 검사로 좁힙니다. TypeScript
  project 밖의 파일에는 type이 없어 그 안의 import 호출은 모두 error type의 unsafe call이 됩니다: 레포의 tsconfig는 lint-ts가
  lint하는 모든 TypeScript 파일을, script까지 담고 kit의 사본은 뺍니다. non-null assertion은 없습니다(K156):
  `no-non-null-assertion`은 `!`를 실패시킵니다. kit은 있다고 아는 값을 `scripts/kit/present.mts`의 `present`로 읽으며, 이것은
  기대한 식을 밝히며 던집니다. test는 `tests/kit/known.mts`의 `known`으로 읽고 assert합니다. API
  Extractor는 tsc 7이 쓴 `.d.ts`를 내장 TypeScript 5.9.3으로 읽습니다. `ae-undocumented`는 API report를 거쳐서만 나오므로 base
  설정이 report를 켜며, report를 끄면 문서 없는 export가 통과합니다(fixture). `ae-undocumented`와 `ae-forgotten-export`는 report의
  줄이 아니라 error입니다. package는 report(`etc/<package>.api.md`)를 commit합니다. `ae-missing-release-tag`는 꺼져
  있습니다(K139): release tag(`@public`, `@beta`, `@alpha`, `@internal`)는 잘라낸 `.d.ts` rollup에 무엇이 남을지 정하는데,
  polyspec은 rollup을 쓰지 않고 export에 tag를 달지 않으므로, 이 message는 아무것도 바꾸지 않는 tag 때문에 모든 package의
  모든 export를 실패시켰습니다(crudui에서 187개).
- **Root 파일.** layout은 root에 `ruff.toml`, `phpcs.xml.dist`, `phpstan.dist.neon`, `.golangci.yml`, `.oxlintrc.json`,
  `knip.json`, `.editorconfig`, Rust workspace(`Cargo.toml`, `Cargo.lock`), Go workspace(`go.work`, `go.work.sum`), Composer
  monorepo의 development project(`composer.json`, `composer.lock`; K167)를 허용합니다.

### 한계

- ruff는 `__import__("sys").path`나 `getattr(sys, "path")`를 보지 못합니다. module과 attribute가 실행 시점에 정해집니다. 이를
  다루는 ruff 규칙은 없습니다.
- vulture whitelist 항목과 `exclude` 경로의 이유는 review가 확인하는 주석이며, 이를 읽는 도구는 없습니다.
- API Extractor가 @rushstack/ts-command-line과 argparse 1.0.10을 거쳐 가져오는 sprintf-js 1.0.3의 moderate advisory
  GHSA-hp3w-g68c-fv3c(npm advisory 1241202)는 sprintf-js의 모든 release에 해당합니다. kit의 dependency policy가 이를
  받아들입니다(받아들인 advisory, K77).

## 받아들인 advisory (K77)

어떤 release도 고치지 않는 advisory는 모든 dependency gate를 실패시켰고, 통과하는 길은 숨기는 것뿐이었습니다.
`config/dependency-policy.json`의 `advisoryExceptions` 항목은 한 lock의 한 package의 advisory 하나를 `reason`과
`removalCondition`과 함께 받아들입니다. `advisory`는 review가 기록하는 식별자입니다(npm audit는 advisory를 번호로 부릅니다).

- `make dependency-review`와 `make dependency-policy-check`는 받아들인 advisory에서 실패하지 않고, 각각 그 advisory를 이유와
  제거 조건과 함께 받아들였다고 출력하며, review 기록은 그 advisory를 유지합니다. 항목이 없는 advisory는 전처럼 둘 다 실패시킵니다.
- lock의 review가 찾지 못한 advisory를 적은 항목은 stale이며, stale version exception처럼 둘 다 실패시킵니다. 이유나 제거 조건이
  없는 항목은 gate를 실패시키고 아무것도 받아들이지 않습니다.
- `make dependency-review UPDATE=1`은 받아들인 advisory 때문에 package를 갱신하지 않습니다.
- kit은 자기 `package-lock.json`을 review합니다(`config/dependency-policy.json`, `config/dependency-review.json`). 유일한 항목은
  sprintf-js를 받아들입니다. 어떤 release도 advisory를 고치지 않고, sprintf-js는 `make lint-ts`가 고정된 인자로만 실행하는
  api-extractor 명령의 도움말과 오류 문구만 형식화합니다. sprintf-js의 release가 advisory를 고치거나 API Extractor가 더 이상
  argparse에 의존하지 않으면 제거하며, 그때 review가 항목을 stale로 보고합니다.

Composer monorepo는 root에 development composer.json 하나(`composerPlatforms`가 지정하며 `path` repository로 published package를
require함)와 root lock 하나를 두고, published package는 lock도 vendor/도 commit하지 않습니다(K168). root의 first-party requirement는
그 `require`와 `require-dev`, 그리고 path repository가 제공하는 각 package의 `require`이며, root lock은 그 package를 path dist 항목으로
기록합니다. version은 root lock의 것입니다. review는 각 root의 directory에서 `composer outdated --locked --all --format=json`을 한 번
실행하고 그 package만 남깁니다: `--direct`는 root의 requirement만 세었으므로 published package의 requirement(symfony/console 등)가
review에서 빠졌습니다. third-party package만 require하는 library는 review하지 않습니다. platform과 lock 검사는 root에 적용되고,
published manifest는 `--no-check-lock`으로 검증합니다. `UPDATE=1`은 published package의 requirement를 그 directory의
`composer require --no-update`와 root의 `composer update --with-dependencies`로 올립니다.

## Release archive의 consumer 설치 (K5.4)

`scripts/kit/release-consumer.mts install TAG`는 한 tag의 모든 archive를 저장소 밖의 깨끗한 consumer project에 함께 설치하고 package마다
smoke command를 실행합니다. `lock TAG`는 그 project의 manifest와 lock을 씁니다. 파일은 `scripts/kit/release-consumer.mts`,
`scripts/kit/release-consumer-config.mts`(설정 규칙이며 `release.mts`의 `loadConfig`가 호출), `schema/release.schema.json`의 section `consumers`,
make target `release-consumer`와 `release-consumer-lock`입니다. 설치와 lock은 template을 base로 하고, archive 규칙은 crudui, manifest 규칙은
crudui와 ordered-json, smoke 검사는 다섯 저장소 모두에서 가져왔습니다.

### `config/release.json`의 `consumers`

```json
"consumers": {
  "npm": {
    "directory": "tests/release-consumer/npm",
    "smoke": { "@scope/lib": ["node", "-e", "require('@scope/lib/package.json')"] }
  },
  "composer": {
    "directory": "tests/release-consumer/composer",
    "smoke": { "vendor/lib": ["php", "-r", "require 'vendor/autoload.php';"] }
  }
}
```

`directory`는 project의 commit된 manifest(`package.json`, `composer.json`)와 lock(`package-lock.json`, `composer.lock`)을 담습니다. `smoke`는 project가
설치하는 package마다 설치된 project에서 shell 없이 실행하는 command(문자열 배열)를 대응시킵니다. `consumers`가 있으면 `packages`에 해당 종류의 package가
있는 모든 종류에 project가 필요하고, smoke key는 그 종류의 package여야 합니다. key가 아닌 package는 project에 복사만 하고 설치하지 않습니다
(예: Composer가 설치하지 않는 type `php-ext`의 Composer package). manifest 파일은 저장소의 `notReleased`에 둡니다.

`composer.polyspec`(선택, K140)는 Composer project의 polyspec 의존성을 `config/release-assets.json`의 entry 이름으로 적습니다: 각각의
release zip은 sha256을 지녀야 하며(`make release-assets-fetch`가 내려받습니다), tag의 zip 옆에서 project의 `artifacts` repository에
놓입니다. 그래서 project는 polyspec 의존성을 inline package repository로 선언하지 않고 그 version으로 require하여, consumer처럼
release된 archive에서 설치합니다. `wheel.polyspec`의 대응입니다. lock은 어떤 실행도 다시 만들지 않는 그 zip의 shasum을 유지하며,
목록이 있으면 `make release-tools`가 zip을 내려받습니다.

### 절차

1. `make release-assets TAG=vX.Y.Z`가 archive를 만듭니다. `make release-consumer-lock TAG=vX.Y.Z`(ONLINE)는 각 project를 저장소 밖의 임시 directory에 그 종류의
   모든 archive와 함께 복사하고, 설치할 package를 manifest에 적고(npm은 `"file:<archive>"`, Composer는 version), `npm install --package-lock-only` 또는
   `composer update --no-install`을 실행한 뒤 lock에서 archive의 hash를 지우고 manifest와 lock을 atomic하게 다시 씁니다. archive는 그것을 설치하는 실행에서
   만들므로 npm entry에는 `integrity`가, Composer entry에는 `shasum`이 비어 있고, registry package는 둘 다 유지합니다. 두 번째 실행은 같은 byte를 씁니다.
   tag를 push하기 전의 release commit에서 실행합니다(`release-assets`에는 local tag면 충분합니다).
2. `make release-consumer TAG=vX.Y.Z`는 `var/release/assets`가 그 version의 archive만 정확히 담을 것, manifest와 lock이 그 archive를 이름으로 가리킬 것
   (`dependencies.<name>`이 `file:<archive>`이고 lock entry의 version과 `resolved`가 같음; `require.<name>`이 version이고 lock entry의 version과 url이
   `artifacts/<archive>`이며 manifest에 `artifact` repository `artifacts`가 있음)을 요구합니다. 그런 다음 project를 저장소 밖의 새 임시 directory에 복사하고
   `npm ci` 또는 `composer install`을 실행하며, 설치된 모든 package가 tag의 version일 것을 요구하고 project에서 smoke command를 실행합니다. 차이는
   기대값과 실제 값, 그리고 고치는 command를 적습니다.
3. 환경에는 임시 directory 안의 빈 `npm_config_cache`, `COMPOSER_HOME`, `COMPOSER_CACHE_DIR`가 있고 `npm_config_offline`, `COMPOSER_DISABLE_NETWORK`,
   `COMPOSER`, `COMPOSER_VENDOR_DIR`는 없으며, 이 저장소의 각 npm scope는 닿지 않는 registry `http://127.0.0.1:9/`를 가리킵니다. lock이 registry에서 고정한
   package는 version과 integrity로 download합니다. 이것은 registry 조회가 아니라 설치이므로 이 설치는 offline check가 아닙니다. 범위를 해석하는 것은 `lock`뿐입니다.
   Go module tag는 archive가 없어 설치할 것이 없습니다.

### 합친 동작

| 동작 | 출처 | 합친 형태 |
|---|---|---|
| 비어 있는 npm과 Composer cache로 저장소 밖의 임시 directory에 설치 | template, crudui, hyper, ordered-json, orm | 유지; directory가 checkout 밖임을 real path로 확인 |
| npm project: `file:<archive>` dependency, commit된 lock, 이 저장소의 scope를 닿지 않는 registry로 두고 `npm ci` | 전부 | 유지; scope는 `packages`의 이름에서 읽음 |
| Composer project: `artifact` repository, Packagist 끔, commit된 lock, `composer install` | 전부 | 유지; zip directory는 `artifacts`(template) |
| 이 저장소의 archive는 이름과 version만으로 lock: `integrity` 없음, `shasum` 빈 값 | 전부 | 유지; `resolved`와 url의 archive 이름으로 찾음 |
| 설치할 때 recipe의 offline 설정 제거 | crudui, hyper, ordered-json, orm(환경); template(`--offline=false`) | 환경 변수를 제거 |
| `--ignore-scripts --no-audit --no-fund`와 `--no-plugins --no-scripts` | template, crudui, orm | 유지; `--fetch-retries=0`(crudui, hyper)도 넣어 닿지 않는 registry에서 바로 실패 |
| 설치된 모든 package의 version이 tag의 version | crudui, template | 모든 smoke key에 대해 유지; npm은 `node_modules`, Composer는 `installed.json`에서 읽음 |
| `lock`이 tree의 version에 맞는 manifest를 씀 | crudui, ordered-json | 유지; commit된 manifest의 다른 field는 그대로 둠 |
| package마다 smoke command: module load, class load, build | template, orm, ordered-json, hyper | command는 설정에서 옴 |
| 다른 archive를 가리키는 manifest나 lock은 lock command를 적고 실패 | template, hyper, ordered-json | 유지; 차이마다 기대값과 실제 값을 적음 |
| Go module tag는 아무것도 설치하지 않음 | crudui | 유지 |

### 버린 동작

| 동작 | 출처 | 이유 |
|---|---|---|
| 설치 안에서 archive를 만듦(`packTree`, `buildAssets`, working tree의 `git stash create`) | template, crudui, hyper, ordered-json, orm | `release.mts assets`가 tag의 archive를 만들고, 설치는 `var/release/assets`를 읽으므로 어떤 release도 만들지 않는 archive를 check가 설치하는 일이 없음 |
| 다른 저장소의 release archive를 project로 download | orm, hyper | kit은 저장소 이름을 모름; 다른 저장소의 dependency는 lock에 URL, integrity, shasum으로 고정되고 설치는 이를 registry package처럼 download함 |
| URL dependency를 위한 npm `--allow-remote` 설정 | hyper | npm 한 release의 우회(npm/cli#9818); 저장소 설정을 합치지 않으므로 remote tarball이 있는 lock은 이를 받아들이는 npm이 필요 |
| `--workspaces=false` | crudui | project는 어떤 workspace 밖에 있음 |
| project가 build하는 sample application과 `php-ext` package의 `composer show --available` | hyper, template | smoke command는 설치된 project에서 실행되며 저장소의 파일을 읽지 않음; 그런 package의 검사는 package 자신에 속함 |
| Python test class `InstallFromAssets`와 `install_fixtures.py` | ordered-json | Node 도구로 대체 |

### 한계

- `smoke`가 모든 package를 나열할 필요는 없습니다: key가 없는 package는 복사만 하고 설치하거나 검사하지 않습니다.
- lock은 `lock`을 실행한 때 archive가 선언한 dependency를 담으므로, dependency가 바뀌면 `lock`을 다시 실행해야 합니다.

## 다른 repository의 release archive (K140)

다른 polyspec repository의 release archive(예: template release의 php와 php-ext zip, orm과 ordered-json의 Composer zip)를 쓰는
repository는 자기 downloader 대신 `config/release-assets.json`(schema `scripts/kit/schema/release-assets.schema.json`, `make kit-check`가
검사)에 그것을 고정합니다:

```json
{
  "schema": 1,
  "assets": [
    { "name": "codec-php", "version": "0.0.14", "url": "https://github.com/polyspec/codec/releases/download/v{version}/polyspec-codec-php-{version}.zip",
      "sha256": "<64 hex digits>", "directory": "var/composer-artifacts", "unpack": "var/products/codec" }
  ]
}
```

- version은 entry에 한 번만 선언합니다. `url`의 `{version}`이 그것을 뜻하며 다른 placeholder는 받지 않습니다. tag가 필요한
  Makefile은 그것을 읽습니다: `$(shell node $(KIT)/release-assets.$(KIT_EXT) version codec-php)`.
- 목적지는 `directory`와 URL의 마지막 path segment입니다. `directory`와 `unpack`은 `..` 없는 `var/` 아래 directory이고 Git이
  무시해야 합니다(`git check-ignore`). 두 entry가 같은 name이나 목적지를 가지면 거부합니다.
- `make release-assets-fetch`(ONLINE, install 단계)는 목적지가 sha256을 지니지 않은 archive를 Node의 fetch로 내려받고, sha256이
  다르면 거부하며 그때는 아무것도 쓰지 않고, `<destination>.next-<pid>`와 rename으로 씁니다. `unpack`이 있는 entry는 zip이며,
  `unzip`이 `unpack` 옆의 임시 directory에 풀고 rename으로 그것을 바꿉니다. 그 안의 `.release-asset.sha256`가 archive를 기록하므로
  같은 archive는 다시 풀지 않습니다.
- `config/release.json`의 `consumers.composer.polyspec`는 Composer consumer project가 담는 zip의 entry를 적습니다(release archive의
  consumer 설치).
- `tests/kit/release-assets.test.mts`는 fetch의 stub과 machine의 `zip`이 만든 zip으로 도구를 실행합니다.

## Release proof (K5.5)

`scripts/kit/release-proof.mts TAG`(`make release-proof TAG=vX.Y.Z`, ONLINE)는 release된 tag를 저장소 밖에서 증명합니다. release가 존재한 뒤에
release workflow(`workflows/release.yml`)가 `release-publish` 뒤 같은 job에서 draft에 대해 실행합니다. 증명이 실패하면 그 run이 실패하고 release는 draft로 남습니다.
developer도 어떤 released tag에든 실행할 수 있습니다. offline check가 아닙니다.

### Release workflow, tool과 draft (K38)

- `workflows/release.yml`은 사본 `.github/workflows/release.yml`의 원본입니다(package.json의 `kit.copies`). `make kit-sync`가 설치된 package에서 이를 쓰며, `make kit-check`가 차이를 실패시킵니다.
- `make release-prepare`는 sibling release의 checkout처럼 저장소의 release가 release-tools 전에 필요로 하는 준비를 실행합니다:
  kit.mk는 이를 일이 없는 double-colon target으로 선언하고, 저장소는 Makefile에 `release-prepare::` 규칙을 더합니다(K132).
  vendor된 release workflow는 install-packages 다음에 이를 실행합니다.
- `make release-tools`(`scripts/kit/release-tools.mts`)는 config/release.json에서 install-tools 이름을 유도합니다: npm package나 consumer에는 npm, composer에는 composer, wheel에는 python과 pythonBackend, Go module에는 go. git-tag proof는 Rust가 필요합니다: release-tools가 checkout에서 `rustup toolchain install --no-self-update`를 실행하면 rust-toolchain.toml의 channel을 읽고, 이어서 `check-toolchain rust`가 rustc를 그 channel과 비교합니다. rust-toolchain.toml이 없는 git-tag proof는 파일 이름과 함께 실패합니다.
- `release-publish`는 release를 draft로 만듭니다. `release-publish`는 그 id를 `var/release/<tag>.json`에 기록합니다. `release-proof`와 `release-undraft`는 release 목록에서 tag로 찾지 않고 그 id로 draft를 읽습니다(`repos/O/R/releases/<id>`). 목록은 새 draft를 한동안 보여 주지 않고(0.0.38 run은 생성 3초 뒤에 실패했습니다), tag는 draft를 가리키지 않기 때문입니다. 기록이 없으면 `var/release/<tag>.json is missing; make release-publish writes it`로 실패합니다. `release-proof`는 각 자산을 id로 내려받고, `release-undraft`는 id로 release를 공개하며 공개된 release는 바꾸지 않습니다. wheel lock이 가리키는 다른 저장소의 release는 공개되어 있으므로 여전히 tag로 찾습니다. 이전 run의 draft는 교체하고, 공개된 release는 절대 교체하지 않습니다. 다섯 저장소의 어떤 도구에도 대응하는 것이 없었습니다. archive의
설치는 K5.4의 `installConsumers`입니다. 첫 실패 step에서 멈추고 통과한 step마다 `✔ <what>`을 출력합니다. 실패는 command와 그 status 및 error,
또는 기대값과 실제 값을 적습니다.

tag `vX.Y.Z`에 대해:

1. `gh release view TAG --repo HOST/OWNER/REPO --json assets`(`repositoryUrl`에서 만듦)가 `packages`가 그 version에 선언한 archive를 정확히 나열합니다.
   실패는 없는 이름과 예상하지 못한 이름을 적습니다.
2. `gh release download`가 asset을 임시 directory에 쓰고, `installConsumers`가 checkout의 commit된 manifest와 lock으로 깨끗한 npm과 Composer project에
   설치한 뒤 `consumers`의 smoke command를 실행합니다(consumer project가 그 version의 archive를 가리키는 tag의 checkout에서 실행).
3. `git-tag` mode의 각 manifest를 `proof.gitTag`의 command로 임시 directory에서 tag로 설치합니다. Rust crate는 임시 crate의 git dependency
   `<name> = { git = "<repositoryUrl>", tag = "TAG" }`로 두고, 자신의 target directory를 쓰는 그 crate에서 smoke command(예: `cargo check`)를
   실행합니다. Python package는 git-tag manifest가 아닙니다. `wheel` package이며 그 wheel은 2단계의 archive입니다(K29).
4. `goModules`의 각 Go module은 remote(`git ls-remote --tags <repositoryUrl>`)에 tag `<directory>/vX.Y.Z`(root의 module은 `vX.Y.Z`)가 있고,
   `GOFLAGS=-mod=mod`, `GOPROXY=direct`, 빈 `GOPATH`로 실행한 `go list -m <module>@vX.Y.Z`가 `<module> vX.Y.Z`를 출력합니다.

tag `<directory>/vX.Y.Z`는 그 Go module만 release하므로 release에는 archive가 없어야 하고, 그 module에 대해 4단계만 실행합니다.

### `config/release.json`의 `proof`

```json
"proof": {
  "gitTag": {
    "rust/Cargo.toml": { "kind": "rust", "name": "name", "smoke": ["cargo", "check"] }
  }
}
```

`proof`가 있으면 `manifests`에서 mode가 `git-tag`인 모든 manifest에 entry가 필요하고, entry가 없으면 `release-proof`가 실패합니다. `kind`는
`Cargo.toml`이면 `rust`입니다. `pyproject.toml`에 `kind` `python`을 쓰면 거부합니다. `smoke`는 shell 없이 실행하는 문자열 배열입니다. archive의 smoke command는 K5.4의
`consumers`입니다.

### 한계

- proof는 첫 실패 step에서 멈춥니다.
- Rust step은 crate가 필요로 하는 registry crate에 이 machine의 `CARGO_HOME`을 쓰고, 새로 만드는 것은 crate와 그 target directory뿐입니다. Go step은 새
  `GOPATH`를 쓰므로 module을 download합니다.
- archive 설치는 checkout의 manifest와 lock을 읽으므로 다른 version의 checkout은 첫 차이에서 `make release-consumer-lock`을 적고 실패합니다.

## Wheel package (K29)

kind `wheel` package는 `packages`에 directory와 project 이름(`name`)으로 선언하는 Python package이며, 그 `pyproject.toml`은
`archive` manifest입니다. archive는 PEP 427 wheel `<distribution>-<version>-py3-none-any.whl`입니다. distribution은 word 문자와 dot이
아닌 문자의 각 연속을 `_`로 씁니다. 그래서 `0.0.1`의 `kit-fixture`는 pip이 파싱하는 `kit_fixture-0.0.1-py3-none-any.whl`입니다.

- `release-assets`는 tag된 commit의 directory 복사본(`git archive`)에서 wheel을 만듭니다. 명령은
  `var/tools/mise/shims/python3 -m pip wheel --no-deps --no-index --no-cache-dir --find-links var/tools/wheels -w <output> <source>`이며,
  `SOURCE_DATE_EPOCH`는 commit의 시각입니다. `--no-index`로 directory가 유일한 source가 되므로 build는 network를 읽지 않습니다.
- build backend는 tool pin이므로 그 유일한 선언인 `config/toolchain.json`의 `pythonBackend`에 고정합니다(K166; `config/release.json`의
  `buildBackend`는 없어졌습니다). `requirement`는 backend의 정확한 requirement
  (`setuptools==84.0.0`, pyproject의 `[build-system] requires`와 같아야 함)이고, `sha256`은 PyPI release의 그 wheel digest입니다.
  wheel package나 wheel consumer가 있고 `pythonBackend`가 없는 config/release.json은 `make kit-check`와 release에서 고치는 방법과
  함께 실패합니다. `make install-tools`와 `make release-backend`(ONLINE)는 digest를 적은 requirement 파일로
  `pip download --no-deps --only-binary :all: --require-hashes`를 실행해 `var/tools/wheels`에 받습니다. `release-assets`는 build마다
  파일의 digest를 확인하고 다르면 거부합니다. 다운로드는 wheel package의 유일한 network 단계이며 release 전에 실행합니다.
- `release-assets`는 wheel의 각 `Requires-Dist`를 그 lock과 대조합니다(K49): plain `name==version`, polyspec release 참조 또는 같은
  release의 sibling(K52)만 받으며, 다른 형식은 줄과 형식을 적어 실패합니다. `release-versions`는 다른 archive manifest와 같이 pyproject.toml의 `[project]`
  `version`을 요구합니다.
- `release-consumer`는 wheel을 `var/tools/mise/shims/python3`의 깨끗한 virtual environment에 설치합니다. 먼저 lock(K49), 그다음
  `pip install --no-input --disable-pip-version-check --no-index --require-hashes --no-deps -r <requirements>`로 wheel을 설치합니다.
  requirement 파일은 이번 실행의 wheel을 그 파일의 sha256으로 적습니다. 그다음 `pip check`가 통과해야 하며, `pip show`가 출력하는
  version을 확인하고 `consumers.wheel`의 smoke command를 실행합니다.

```json
"consumers": { "wheel": { "smoke": { "kit-fixture": ["python", "-c", "import kit_fixture"] }, "lock": { "kit-fixture": "packages/fixture-python/pylock.wheel.toml" }, "polyspec": {} } }
```

config/toolchain.json:

```json
"pythonBackend": { "requirement": "setuptools==84.0.0", "sha256": "<sha256 of setuptools-84.0.0-py3-none-any.whl>" }
```

## Wheel dependencies (K49)

wheel의 `Requires-Dist`는 세 형식 중 하나입니다: registry 고정, polyspec 참조, 그리고 sibling(K52, 아래)입니다. registry package는
`name==version`으로 고정합니다. polyspec package는 release asset의 PEP 508 직접 참조이며, fragment로 그 asset의 sha256을 붙입니다:

    name @ https://github.com/polyspec/<repo>/releases/download/v<version>/<file>#sha256=<hex>

`<file>`은 `<version>`의 `name` wheel의 PEP 427 이름이고, URL의 name과 version은 requirement의 것과 같아야 합니다. 저장소는 이름에서
추정하지 않고 config/release.json의 `consumers.wheel.polyspec`(distribution 이름에서 저장소 URL로 가는 map)에서 가져옵니다. 다른 모든
형식(다른 host, git URL, branch, extra, 범위, marker)은 거부하며, 거부 문구는 requirement를 적습니다. `consumers.wheel.polyspec`이
선언하지 않은 이름도 거부합니다.

wheel package마다 PEP 751 lock 하나를 `consumers.wheel.lock`(`pylock.toml` 또는 `pylock.<name>.toml`)으로 선언합니다. lock은 superset이며
transitive dependency를 포함한 모든 dependency를 담습니다. registry package는 version과 파일의 sha256을 가지고, polyspec package는 참조와
같은 URL과 sha256을 가진 `archive` 항목입니다. `release-assets`는 tag된 commit에서 오프라인으로 검사합니다: lock은 K36 reader가 읽고,
registry와 archive가 아닌 source는 거부하며, 각 `Requires-Dist`는 같은 version(registry) 또는 같은 URL과 sha256(polyspec)으로 lock에
있어야 하고, fragment는 lock의 sha256과 같아야 하며, 각 archive는 선언된 저장소의 그 version release asset이어야 합니다. 여기서는 network를
읽지 않습니다.

`release-consumer install`은 `lockRequirements`(`scripts/kit/wheel-dependencies.mts`)로 lock을 hash가 든 requirement 파일로 바꾸고,
checkout의 pip가 `makeVenv`의 venv에 설치합니다: registry 파일마다 `name==version --hash=sha256:…`, archive마다 `name @ <url>
--hash=sha256:…`입니다.

    var/tools/mise/shims/python3 -m pip --python <venv>/bin/python install --no-input --disable-pip-version-check --require-hashes --no-deps --only-binary :all: -r <dependencies>

이어서 wheel을 `--no-index --require-hashes --no-deps`로 설치하고, `pip --python <venv>/bin/python check`가 0으로 끝나야 합니다(불완전한
lock은 여기서 실패합니다). 그다음 smoke command를 실행합니다. pip 자체의 `pylock.toml` 읽기는 쓰지 않습니다(발견 사항 참조). 설치는 PyPI와
release asset에 닿으므로 `release-proof`에서만 온라인으로 실행합니다. `release-proof`의 2단계는 각 polyspec archive를 선언된 저장소의 그
version release에서 내려받고, sha256이 lock이 담은 sha256과 같아야 합니다.

발견 사항, pip 26.2.1과 고정된 Python 3.14.8로 측정했습니다(`tests/source/wheel-dependencies-real.test.mts`가 이 사례를 반복합니다):

- `pip install -r pylock.toml`은 lock을 requirement source로 읽고 `WARNING: Using pylock.toml as a requirements source is an experimental
  feature. It may be removed/changed in a future release without prior warning.`를 출력합니다. 그래서 lock을 requirement로 바꿉니다.
- `pip --python <venv>/bin/python check`는 pip가 없는 venv에서 동작합니다. dependency가 없으면 `kit-app 0.0.1 requires six, which is not
  installed.`를 출력하고 1로 끝나며, version이 다르면 `kit-app 0.0.1 has requirement kit-reg==1.0.0, but you have kit-reg 0.0.1.`를 출력하고
  1로 끝납니다. 완전한 설치는 `No broken requirements found.`를 출력하고 0으로 끝납니다.
- 로컬 복사(limepie가 내려받은 파일로 dependency wheel을 설치하는 경우): 같은 바이트의 로컬 파일로 dependency wheel을 설치하고
  (`--require-hashes --no-deps`), 이어서 wheel을 `--no-deps`로 설치한 뒤 `pip check`를 실행했더니 `No broken requirements found.`를
  출력하고 0으로 끝났습니다. `pip check`는 version만 비교하므로 로컬 파일이 만족하는 직접 URL requirement를 거부하지 않습니다.
- resolver는 설치에 쓰지 않습니다(`--no-deps`). dependency와 함께 resolve하면 pip는 설치된 복사본을 받아들이기 전에 직접 URL requirement를
  읽습니다. 같은 version의 `file:` URL에는 `Processing .../kit_lib-0.0.1-py3-none-any.whl`을 출력하고,
  `kit-lib is already installed with the same version as the provided wheel. Use --force-reinstall to force an installation of the wheel.`를
  출력한 뒤 0으로 끝났습니다. 원격 URL에는 먼저 가져오며(`Collecting kit-lib @ https://...`), 응답하지 않는 URL은
  `ERROR: HTTP error 404 while getting https://...`로 실패합니다. 따라서 dependency를 resolve하는 consumer는 polyspec archive를 다시
  내려받습니다.

테스트: `tests/kit/wheel-dependencies.test.mts`(형식, 문구와 함께 거부하는 사례, lock 형식, 렌더링된 requirement),
`tests/kit/release-wheel.test.mts`(`release-assets`를 거치는 같은 검사, consumer 선언), `tests/kit/release-proof.test.mts`(polyspec archive의
digest), `tests/source/wheel-dependencies-real.test.mts`(실제 pip: registry와 polyspec dependency를 가진 wheel의 GREEN 설치, 불완전한 lock,
로컬 복사, resolver)입니다.

## Sibling wheels (K52)

sibling은 같은 config/release.json의 다른 wheel package입니다. wheel의 `Requires-Dist`는 같은 release의 sibling asset을 hash fragment
없이 직접 참조로 가리킬 수 있습니다:

    name @ <repositoryUrl>/releases/download/v<version>/<file>

참조는 모든 조건이 맞을 때만 받습니다: `name`이 sibling이고, URL이 config/release.json의 `<repositoryUrl>/releases/download/v<version>/`
아래에 있으며, `<version>`이 검사하는 release의 version이고, `<file>`이 `wheelName(name, version)`, 즉 sibling wheel의 PEP 427 이름입니다.
실패마다 고유한 문구가 있으며, 거부 사례는 다음과 같습니다: `#sha256` fragment를 가진 sibling, `name==version`으로 적은 sibling, 다른
version의 sibling, 다른 저장소 아래의 sibling URL, version의 wheel 이름이 아닌 파일, 그리고 sibling을 담은 wheel의 lock(형식과 무관하게
lock은 sibling을 담지 않습니다). 다른 모든 polyspec 참조는 여전히 sha256 fragment가 필요합니다(K49).

sibling은 `packages`에서 유도합니다(`siblingsOf`, scripts/kit/wheel-dependencies.mts): 설정의 다른 wheel package이며, 두 번째 선언이
아닙니다. 이유: 한 config/release.json의 wheel package들은 한 저장소에서 한 tag로 함께 릴리스되므로, 두 번째 목록은 `packages`와
어긋날 수만 있습니다. `consumers.wheel.polyspec`은 다른 저장소의 저장소를 적으므로, 이 설정의 wheel package를 거부합니다
(`consumers.wheel.polyspec.<name> names the wheel package <name> of this repository`).

sibling의 sha256은 release가 빌드한 뒤에야 알 수 있습니다. SOURCE_DATE_EPOCH가 release commit의 시각이므로, wheel의 sha256은 빌드
전에는 tree에 없습니다. 그래서 wheel의 lock은 sibling을 담지 않으며, 참조에는 hash가 없습니다.

`release-proof` 3단계는 GitHub가 게시한 release에서 sibling을 온라인으로 증명합니다(scripts/kit/release-proof.mts, `proveWheels`):
1. release의 각 wheel 파일을 내려받은 뒤, 그 sha256이 GitHub가 그 asset에 나열한 sha256과 같아야 합니다(release listing의 `digest`,
   `sha256:<hex>`). 어떤 wheel의 digest를 나열하지 않으면 proof가 실패합니다.
2. wheel의 METADATA가 이름 붙인 각 sibling은 그 sibling의 게시된 asset URL(`browser_download_url`)과 정확히 같아야 하며, release가 그
   asset을 나열해야 합니다.

그다음 release의 wheel들은 한 번의 `pip install --no-index --require-hashes --no-deps` 명령으로 파일에서 함께 설치합니다
(release-consumer.mjs의 `installWheelFiles`, 이미 설정의 모든 wheel package를 함께 설치합니다). `pip check`가 통과하고 smoke command가
실행됩니다. archive는 자체 검사를 유지합니다. digest 검사는 wheel에만 추가하는데, digest를 나열하기 전에 게시된 release도 증명되어야
하기 때문입니다.

consumer는 sibling을 polyspec wheel과 같이 설치합니다(K49): 자기 lock이 sibling을 URL과 sha256을 가진 `archive` 항목으로 적으며,
이 sha256은 게시된 asset의 hash입니다. sibling을 요구하는 wheel의 lock은 sibling을 적지 않습니다.

sibling 참조에 대한 발견 사항은 checkout의 pip(`var/tools/python-build`, pip 26.2.1, Python 3.14.8)로 측정했습니다. 두 wheel은 손으로
만들었고, `kit-gen`은 `kit-val @ <URL>`을 요구합니다(`tests/source/wheel-sibling-real.test.mts`가 파일 사례를 반복합니다):

- hash와 함께 두 wheel을 로컬 파일에서 `--no-deps`로 설치하면 설치되고, `pip check`가 `No broken requirements found.`를 출력하며
  0으로 끝납니다. `--no-deps`에서 pip는 `Requires-Dist`를 읽지 않습니다.
- dependency를 resolve하고 같은 명령에 `kit-val`을 로컬 파일로도 주면, pip는 참조에 대해 로컬 파일을 취하지 않습니다. `Collecting
  kit-val @ <URL>`을 출력하고 URL을 내려받으며, URL이 같은 바이트를 주면 `ERROR: Cannot install kit-val 0.0.1 (from <local file>) and
  kit-gen==0.0.1 because these package versions have conflicting dependencies`를 출력하고 1로 끝납니다. 로컬 파일과 참조는 두 후보이며,
  resolver는 선택하지 않고 충돌을 보고합니다.
- dependency를 resolve하고 `kit-val`을 주지 않으면, pip는 URL을 내려받아 그 파일로 설치합니다(URL이 파일을 주면 0으로 끝남). URL이 응답하지
  않으면 `connection-failed`로 재시도 뒤 실패합니다(1로 끝남). 참조가 없는 파일을 가리키면 pip는 `Processing <path> (from
  kit-gen==0.0.1)`을 출력하고 `No such file or directory`로 실패합니다(1로 끝남).
- 로컬 파일에서 설치된 복사본은 참조를 만족하지 않습니다. `kit-val`을 파일에서 설치한 뒤 dependency와 함께 `kit-gen`을 resolve하면 pip는
  URL을 다시 내려받았습니다.

이 결과가 위 설계의 근거입니다. proof는 로컬 파일에서 `--no-deps`로 설치하고, 참조가 게시된 URL과 같음을 증명합니다. 그래서 dependency를
resolve하는 consumer도 release가 게시한 asset을 내려받습니다.

테스트: `tests/kit/wheel-sibling.test.mts`(sibling 형식과 거부, lock, consumer 선언, `siblingLinks`),
`tests/kit/release-wheel.test.mts`(같은 거부를 `release-assets`로), `tests/kit/release-proof.test.mts`(wheel digest, sibling URL, wheel의 한
번 설치), `tests/source/wheel-sibling-real.test.mts`(실제 pip: pip check가 있는 `--no-deps` 설치, 참조를 읽고 로컬 wheel은 읽지 않는 resolve).

## Language parity (K33)

`scripts/kit/parity.mts`는 repository의 모든 implementation이 같은 unit을 갖추는지 검사합니다. `config/parity.json`은
implementation(repository의 language 집합의 유일한 원천), 그것을 묶는 profile, unit을 선언합니다. 선언은 완료나 예정 같은 상태를
담지 않습니다. 검사기는 모든 사실을 tree에서 가져옵니다.

- 각 implementation에서 각 suite와 feature의 binding을 직접 실행하고, 실행과 각 실행이 보고한 case와 test id의 ledger를 memory에
  둡니다. 저장된 report는 읽지 않습니다.
- 각 implementation의 public symbol을 그 생태계의 표준 도구(go/packages, API Extractor, nikic/php-parser, Python의 ast, rustdoc
  JSON)로 읽습니다. commit된 snapshot은 읽지 않습니다.
- 각 implementation의 생성물에서 error code를 읽습니다.

한 spec을 여러 implementation으로 가진 repository는 `config/parity.json`을 선언하고, `parity-declarations-check`를 검사 target에서,
`parity-check`를 CI에서 실행하며, 둘 다 push가 반영되기 전에 실행합니다.

### 신뢰 경계

검사기는 스스로 만들지 않는 입력 세 가지를 신뢰합니다. 각각은 다른 검사가 막습니다:

- **각 symbol extractor의 도구**(go/packages, API Extractor, nikic/php-parser, ast, rustdoc). 검사기는 이 도구를 source에
  실행하고 그 public symbol을 그대로 받습니다. kit의 extractor 프로그램은 도구가 주는 것을 나열할 뿐입니다.
- **생성된 error code 생성물.** repository의 생성기 검사가 catalog에서 생성물을 다시 만들고, 다르면 실패합니다. 이 검사도
  `parity-check`보다 먼저 실행해야 합니다. parity 검사는 commit된 생성물을 catalog와 비교하며, 다시 만들지 않습니다.
- **각 native 도구의 출력**(node:test, vitest, go test, cargo test, unittest, PHPUnit). binding의 test는 검사를 위해 아무것도
  출력하지 않으며, 각 case의 결과는 그 test에 대한 도구 자신의 보고입니다. go, node, vitest는 이벤트를 틀에 넣어 씁니다. go는
  test의 출력을 JSON 이벤트의 `Output` 필드 안에 쓰고 `test-output.mts`가 이를 읽습니다. node는 kit의 node:test reporter인
  `parity-node-reporter.mts`에 이벤트를 보고하고, vitest는 JSON report를 파일에 씁니다. cargo, unittest, PHPUnit은 틀에 넣지 않으므로, test가 같은 stream에 결과처럼 읽히는 줄을 출력할 수 있습니다:
  cargo의 표준 출력에 있는 `test <name> ... ok`, unittest의 표준 오류에 있는 `... ok` 줄, 또는 PHPUnit이 되풀이한
  `##teamcity[` 메시지입니다. 이 셋에 대해 검사기는 도구가 자신의 결과만 출력한다고 신뢰하며, 리뷰가 이를 강제합니다. 출력을
  검사하는 방법으로는 막을 수 없습니다.

Make target: `parity-check`는 binding과 symbol extractor를 실행하고 모든 rule을 검사합니다. `parity-declarations-check`는
R1, R3, R11을 뺀 모든 rule을 검사하며 아무것도 실행하지 않습니다. 둘 다 offline이고, 단계마다와 finding마다 한 줄을 출력하며, finding이 있으면 1로 끝납니다.

| Module | 담당 |
|---|---|
| `parity.mts` | 명령과 rule의 순서 |
| `parity-declaration.mts` | schema, 선언의 참조, finding |
| `parity-units.mts` | R1, R2, R4, R5, R6, R8, R11 |
| `parity-ledger.mts` | R3: binding 실행과 ledger |
| `parity-runners.mts` | runner마다의 native 명령과 그 출력에서 읽은 case의 결과 |
| `parity-node-reporter.mts` | node runner의 node:test reporter: 각 test를 감싼 suite와 함께 JSON 줄로 |
| `parity-symbols.mts` | R1과 R11의 symbol extractor, rustdoc JSON 탐색 |
| `install-symbols.mts` | go extractor의 build와 php extractor의 설치(var/tools) |
| `symbols/` | extractor 프로그램: `go/`(go/packages), `php/`(nikic/php-parser), `python.py`(ast) |
| `test-output.mts` | go, cargo, unittest, PHPUnit 출력의 parser, run-tests와 공유. node:test는 `parity-node-reporter.mts`로 보고하며, K125의 TAP reader는 제거했습니다 |
| `parity-errors.mts` | R7 |
| `parity-text.mts` | R9, R10 |

### Rule

모든 finding은 검사를 실패시킵니다. finding은 rule, unit, implementation, 위치(파일 또는 file:line)를 적습니다.

| Rule | Finding |
|---|---|
| `declaration` | 선언에 다음 결함 중 하나가 있습니다. 이런 선언에는 다른 rule을 실행하지 않습니다. <br>- `scripts/kit/schema/parity.schema.json`을 어깁니다. <br>- 없는 파일이나 모르는 implementation 또는 profile을 적습니다. <br>- 모든 implementation보다 좁은 profile에 `reason`이 없거나, `spec` anchor를 인용하지 않거나, 그 profile을 unit 하나만 쓰거나, 모든 implementation의 profile이 anchor를 인용합니다. <br>- profile이나 `nativeOnly` 항목의 `spec` anchor가 풀리지 않습니다. <br>- implementation이 어떤 profile에도 없거나, root가 repository 전체입니다. <br>- binding이 unit의 profile 밖 implementation의 것입니다. <br>- go 또는 cargo suite binding에 `symbol`이 없거나, go symbol이 `^Test\w*$`에 맞지 않습니다. <br>- feature binding에 `id`가 없거나 `symbol`이 있거나, suite binding에 `id`가 있거나, feature unit에 `file`, `cases`, `admit`이 있습니다. <br>- case 이름이 반복되거나, 공백을 담거나, go binding이 있는 unit에서 `/`를 담습니다. <br>- `nativeOnly` 항목이 없는 implementation이나 `symbols`를 선언하지 않은 implementation을 적습니다. <br>- `symbols`의 `entry`가 없습니다. <br>- exclusion이 unit이 binding한 쌍을 적습니다. <br>- pattern에 group이 없습니다. <br>- catalog pattern이 catalog의 줄을 읽지 못하거나, catalog 또는 생성물 pattern이 code를 하나도 읽지 못합니다. <br>- `support` glob이 그 implementation의 test 파일(그 runner의 규약, 그 `tests`, 그 runner의 `testPatterns`)도 test처럼 이름 붙은 파일도 하나도 고르지 않거나, 보조 파일이 그 implementation의 `roots` 밖에 있거나, Go 보조 파일이 `go test`가 실행하는 함수를 선언하거나, cargo 보조 파일이 test attribute를 담거나, binding의 test가 그 implementation의 `support`에 맞습니다. <br>- `command`, `args`, `env` 값이 `${NAME}`이 아닌 `${` 형식을 담습니다. <br>- env가 `PYTHONPATH`를 설정하거나, 경로 field나 `args`, `env` 값의 단어가 절대 경로이거나 `~`로 시작하거나 `..` segment를 담습니다(S3). <br>- `admit` key가 어떤 case 객체에도 없거나, 목록이 비었거나, implementation 이름을 두 번 적거나, profile의 implementation이 admit하는 case가 없습니다(K47). |
| R1 missing-implementation | API unit이 profile의 한 implementation의 symbol을 선언하지 않거나, 선언한 symbol이 그 implementation의 extractor가 주는 public symbol이 아닙니다. 또는 implementation의 extractor가 symbol을 주지 못합니다: 프로그램이나 nightly가 없거나, 실패하거나, 목록을 출력하지 않습니다. |
| R2 missing-binding | suite 또는 feature unit에 profile의 한 implementation의 binding이 없습니다. |
| R3 not-executed | binding이 시작하지 못하거나(program이 없거나, 그 implementation의 environment 참조가 설정되지 않았거나 비었거나 checkout 밖 경로로 풀림), 0이 아닌 status로 끝나거나, 통과한 case가 suite 파일의 case와 정확히 같지 않습니다. feature binding은 그 test 파일 전체의 실행이 오류로 끝나거나 그 `id`가 정확히 한 번 통과하지 않으면 실패합니다. 각 binding은 두 번 실행되므로, 두 번째 실행의 exit status, case, 결과가 첫 번째와 다른 것도 R3입니다. finding은 실패, skip, 누락, 초과 case와 두 실행의 차이를 나열합니다. 한 실행이 case를 두 번 보고하면 finding은 `reported twice in run <n>` 부분으로 그 case를 적습니다. build되지 않는 Go package는 compiler 출력을 덧붙입니다. |
| R4 undeclared-suite | `suites` glob의 파일이 어떤 suite unit의 파일도 아니고 어떤 case directory 안에도 있지 않습니다. |
| R5 undeclared-test | implementation의 test 파일(그 root 안에서 그 runner의 규약이나 `testPatterns`가 고르는 파일, 또는 그 `tests` glob의 파일) 중 그 `support` 파일이 아닌 것이 그 implementation의 어떤 binding의 test도 아닙니다. 또는 그 root 안의 파일이 test처럼 이름 붙었고(`*_test.*`, `test_*.*`, `*Test.*`, `*.test.*`, `*.spec.*`), 어떤 규약도 고르지 않으며, 어떤 binding도 실행하지 않습니다. 또는 node, php, python implementation의 보조 파일이 `parity-check`가 실행할 때 case를 보고합니다. |
| R6 misplaced-test | binding의 test가 그 implementation의 `roots` 밖이고 `comparators` 밖에 있습니다. 또는 하나 이상의 runner의 규약이나 `testPatterns`가 고르는 파일로서 그 runner들의 implementation의 `support` 파일이 아닌 것이, 그 runner들의 모든 implementation의 root 밖이고 `comparators` 밖이며 `tools` root 밖에 있습니다. vendored `scripts/kit`과 `tests/kit`은 kit 자신의 것이어서 검사하지 않습니다. |
| R7 error-catalog | `errors` profile의 implementation이 code를 선언하지 않거나, 그 code가 catalog와 다릅니다(누락 또는 초과 code). |
| R8 exclusion | exclusion입니다. unit을 갖춘 것으로 세지 않으므로, exclusion이 적은 item이 그것을 제거할 때까지 검사가 실패합니다. |
| R9 language-set-drift | `languageLists`가 선언한 다른 파일의 목록이 profile과 다르거나, pattern이 아무것도 찾지 못합니다. |
| R10 docs-count | `documents`의 문서가 implementation N개를 세는데, implementation N개의 어떤 profile도 그 문장이 적은 implementation을 모두 담지 않습니다. 다만 문장이 정확히 N개를 적고 passage의 이름을 모두 모은 것이 profile이면 예외입니다. 또는 implementation 이름을 모두 모아도 어떤 profile도 아닌 문장에서 implementation 이름 세 개 이상을 나열합니다. |
| R11 undeclared-public | implementation의 extractor가 주는 public symbol을 API unit도 그 implementation의 `nativeOnly` 항목도 선언하지 않습니다. 또는 `nativeOnly` 항목이 public symbol이 아닌 것을 적습니다. |

### Runner

| Runner | 명령 | Case | Feature id |
|---|---|---|---|
| `go` | `go.mod`가 있는 가장 가까운 directory에서 `go test -json -count=1 -run ^<symbol>$ ./<directory>`. feature는 `-run` 없이 실행합니다 | 직계 subtest `<symbol>/<case>`의 `pass`, `fail`, `skip` event | test 또는 subtest 이름 `TestX/case` |
| `cargo` | `<crate>/tests/<name>.rs`이면 `cargo test --manifest-path <crate>/Cargo.toml --test <name>`, 아니면 `--lib`, 이어서 `-- --test-threads=1 <symbol>::`. feature는 filter 없이 실행합니다 | `<symbol>::<case>` test의 출력 줄 `test <name> ... ok`, `FAILED`, `ignored`. libtest-mimic(`harness = false` test target)은 각 이름을 가장 긴 이름에 맞춰 채우므로 `...` 앞의 공백은 몇 칸이든 됩니다 | libtest 경로 `module::test` |
| `node` | `node --test --test-reporter=<scripts/kit/parity-node-reporter.mts> <test>` | reporter가 이름 붙인 최상위 test: node:test 자신의 통과, 실패, skip, todo입니다. 파일 자신의 test는 case가 아닙니다 | test와 그것을 감싼 suite의 이름을 ` › `로 이은 것 |
| `vitest` | checkout root에서 `node node_modules/vitest/vitest.mjs run <args> --reporter=json --outputFile.json=var/parity/vitest.json <test>` | JSON report의 최상위 test: `passed`, `failed`, `skipped` 또는 `pending`, `todo` | `ancestorTitles`와 `title`을 ` › `로 이은 것 |
| `php` | `php <args> <package>/vendor/bin/phpunit --teamcity <configuration> <test>`를 checkout root에서 실행합니다. `<package>`는 test 위에서 `composer.json`이 있는 가장 가까운 directory이고, `<configuration>`은 `--configuration <package>/phpunit.xml`, `phpunit.xml.dist`만 있으면 `--configuration <package>/phpunit.xml.dist`, 둘 다 없으면 `--no-configuration`입니다. symbol `<class>::<method>`가 있는 suite binding은 `--filter /^<class>::<method>(?: with data set \|$)/`를 더해 그 method만 실행합니다 | symbol이 있으면 TeamCity 메시지의 data set `<method> with data set "<case>"`, 없으면 test method `test_<case>` | test method |
| `python` | `var/tools/mise/shims/python3 <args> -m unittest -v <test>` | 표준 오류의 verbose 출력의 test method `test_<case>` | test method |

go, cargo, php, python runner는 그 도구의 출력을 `test-output.mts`의 parser로 읽습니다. run-tests가 실행을 읽는 parser와 같습니다(K47).
node는 reporter API로, vitest는 JSON report로 보고하므로 그 글은 parse하지 않습니다. todo는 도구가 실패를 기대하는 test, 즉 node나
vitest의 todo와 unittest의 `expected failure`입니다. 통과가 아니므로 그 case는 검사에서 실패하며, run-tests는 todo를 통과 줄로 보여 줍니다. binding의 case가 아닌 test 이름은 무시하되, go subtest가 case 아래에 중첩되면 `/`를 유지하므로 suite가
선언하지 않은 case로 R3가 잡습니다. case 이름에는 공백이 없고, go binding이 있는 unit에서는 `/`도 없습니다. Go가 subtest 이름을
`/`에서 중첩하기 때문입니다. node:test 실행은 `NODE_TEST_CONTEXT`를 뺀 environment로 시작합니다. 검사를 시작한 test 실행에 합류하지
않게 하기 위해서입니다.

PHPUnit은 작업 directory에서 설정을 읽습니다. 검사는 모든 runner의 작업 directory를 checkout root로 두어서 `command`, `args`와 경로가
한 기준을 공유하므로, php binding은 자신의 package의 설정을 직접 적습니다. `--configuration`에 package의 `phpunit.xml`(없고
`phpunit.xml.dist`만 있으면 그것)을 주며, 둘 다 없으면 `--no-configuration`을 줍니다. 다른 directory의 설정이 적용되지 않게 하기 위해서입니다.

implementation은 비어 있지 않은 `command`로 runner의 program을 바꿀 수 있습니다. `/`를 담은 command는 virtual environment의
Python처럼 checkout root에 대한 상대 경로입니다. 아니면 PATH의 이름입니다. 선언의 어떤 경로도 checkout을 벗어나지 않습니다(S3).
schema는 경로 field와 `args`, `env` 값의 각 단어(`=`, `:`, 공백 사이)에서 절대 경로, `~`로 시작하는 경로, `..` segment를 거부하고,
package를 설치된 그대로 test하므로 이름이 `PYTHONPATH`인 `env`도 거부합니다. `${NAME}` 참조가 그런 경로로 풀리는 값은 실행을
시작하지 못합니다(R3). `args`는 go와 cargo에서는 `test` 뒤에, node에서는 test 파일 앞에, php에서는 PHPUnit 경로 앞에, python에서는 `-m unittest` 앞에 옵니다. 예를 들어 PHP implementation 하나에만 `-d extension=<library>`를 줍니다. `env`는 검사의 environment 위에
그 implementation의 실행에만 변수를 설정합니다.

`command`, `args`, `env` 값은 이웃 repository의 checkout이나 Makefile이 build하는 library처럼 실행 environment를 `${NAME}`으로
참조할 수 있습니다. `parity-declarations-check`는 environment를 읽지 않고 `${NAME}`이 아닌 `${` 형식에서만 실패합니다. 그래서 기본값
형식은 없고, 중괄호 없는 `$NAME`은 그냥 글입니다. `parity-check`는 binding을 실행할 때 각 참조를 NAME의 값으로 바꿉니다. NAME이
설정되지 않았거나 비었으면 그 implementation의 모든 binding이 그 값과 NAME을 적은, 시작하지 못하는 R3 finding이고, 다른 rule은
계속 실행됩니다. 단계 줄은 command와 argument를 선언한 그대로, 값이 아니라 참조로 출력합니다.

implementation은 test 보조 파일을 `support` glob으로 선언합니다. 그 `roots` 안에서 그 runner의 규약, 그 `tests`, 그 runner의
`testPatterns`가 고르거나 test처럼 이름 붙었지만 test를 담지 않는 파일로, 이름이 `_test.go`로 끝나야 하는 Go helper가 그 예입니다. 보조 파일은 binding의 test가 아니므로
R5가 건너뛰고, R6는 그 implementation의 runner의 pattern에 대해서만 건너뜁니다. 보조 파일은 그 runner가 실행할 test를 담지
않습니다:

- Go 보조 파일은 `go test`가 실행하는 top-level 함수를 선언하지 않습니다. 소문자가 뒤따르지 않는 `Test`, `Benchmark`, `Fuzz`, 그리고
  `Example`입니다.
- cargo 보조 파일은 test attribute를 담지 않습니다. `#[test]`, `#[bench]`, `#[test_case]`, `#[rstest]`, 또는 `#[tokio::test]`처럼
  path가 붙은 그것들입니다.
- `parity-check`는 node, php, python 보조 파일을 그 implementation의 runner로 한 번씩 실행하고, 그 출력이 보고하는 case는 R5 finding입니다.

각 glob은 그런 파일을 하나 이상 골라야 하므로, 낡은 glob은 선언 finding입니다.

### Test 파일 규약 (K75)

kit은 runner마다 test 파일을 고정합니다(S3, `parity-declaration.mts`의 `CONVENTIONS`): go `**/*_test.go`, cargo
`**/tests/**/*.rs`와 test attribute를 담은 모든 `.rs` 파일, node `**/*.test.{ts,mts,cts,mjs,cjs,js}`, vitest
`**/*.{test,spec}.{ts,mts,cts,js,mjs,cjs,tsx,jsx}`, php `**/*Test.php`, python `**/test_*.py`. implementation의 test 파일은 그 root
안에서 그 runner의 규약이 고르는 파일과 그 `tests` glob의 파일입니다. implementation의 `tests`와 runner의 `testPatterns`는 규약에
더하기만 하고, 선언의 어떤 것도 규약에서 파일을 빼지 못하며, 보조 파일은 test를 담지 않음이 증명됩니다. implementation의 root 안에서
흔한 규약으로 test처럼 이름 붙었고(`*_test.*`, `test_*.*`, `*Test.*`, `*.test.*`, `*.spec.*`) 어떤 규약도 고르지 않는 파일은
`*_test.php`라는 이름의 PHP script처럼 그 runner가 실행하지 않는 test입니다. binding이 실행하거나, 규약대로 이름을 바꾸거나, support
glob이 선언할 때까지 R5가 실패시킵니다. node와 vitest의 규약은 겹치므로, R6는 그 파일을 고르는 runner 중 어느 하나의 root 안에 있는
파일을 받아들입니다.

### Feature unit (K75)

kind가 `feature`인 unit은 profile의 각 implementation의 native test 하나를 적습니다. `bindings`는 `{ implementation, test, id }`이고,
`id`는 runner가 보고하는 native test id입니다(위 Feature id 참고). vector 파일은 없습니다. `parity-check`는 feature binding의 test
파일 전체를, 그 implementation에서 그 파일을 binding하는 모든 feature에 대해 한 번씩, 두 번 실행합니다. 실행이 0으로 끝나고 그
`id`가 각 실행에서 한 번 통과하면 binding이 성립합니다. 없거나, 실패하거나, 건너뛰었거나, 반복되거나, 바뀌는 id는 R3이고, 한
implementation의 binding이 없는 feature는 R2입니다.

### Symbol extractor (K75)

implementation의 `symbols`는 `{ extractor, entry }`를 선언합니다. `parity-check`는 extractor를 실행해 `entry`의 public API를 그
생태계의 표준 도구로 읽고, 그것이 주는 것으로 R1과 R11을 판정합니다. commit된 snapshot은 읽지 않으며,
`parity-declarations-check`는 extractor를 실행하지 않습니다.

| Extractor | 도구 | Entry | Id |
|---|---|---|---|
| `go` | `var/tools/symbols-go/bin/kit-symbols-go`, `golang.org/x/tools/go/packages` v0.52.0 위의 kit 프로그램 | module directory | 각 internal이 아니고 test가 아닌 package의 export된 이름의 `<import path>.<name>`, `<import path>.<type>.<method or field>` |
| `ts` | API Extractor 7.59.4(`@microsoft/api-extractor`, kit의 의존성)의 API model | 가장 가까운 `package.json`의 package에 있는, tsc 7이 내는 것 같은 `.d.ts` entry point. 그 package의 `tsconfig.json`으로, 없으면 ESNext library와 `@types` 없이 compile함 | `@scope/name!Codec#encode:member(1)` 같은 canonical reference |
| `php` | nikic/php-parser 5.9.0 위의 `scripts/kit/symbols/php/extract.php` | source directory나 파일, 예를 들어 PHP extension의 `*.stub.php` | public 선언의 `Ns\Class`, `Ns\Class::method`, `Ns\Class::CONST`, `Ns\Class::$property`, `Ns\function`, `Ns\CONST` |
| `python` | 표준 library `ast` 위의 `scripts/kit/symbols/python.py`, `var/tools/mise/shims/python3 -I`로 실행 | package directory나 module 파일 | `__all__`, 없으면 `_`로 시작하지 않는 이름의 `<module>.<name>`과 `<module>.<class>.<method>` |
| `rust` | `cargo +<nightly> rustdoc -- -Z unstable-options --output-format json`(format 61) | `Cargo.toml`, 그 library | root에서 닿는 각 public item(re-export 포함)의 `<crate>::<path>`와 그 public field, variant, inherent item, trait item |

- repository는 `config/toolchain.json`의 `symbolExtractors`에 `go`와 `php`를 적습니다. 그러면 `make install-tools`가 go 프로그램을
  `var/tools/symbols-go`에 build하고, php extractor의 lock된 Composer project를 선언된 Composer로 `var/tools/symbols-php`에
  설치합니다(`install-symbols.mts`). 각각의 release는 source 파일의 sha256이므로, 그것을 바꾸는 kit release는 다시 설치합니다.
  `make build`는 `scripts/kit/symbols`를 `dist/symbols`로 복사합니다.
- rustdoc JSON은 불안정하므로(rust-lang/rust#76578), rust extractor는 `config/toolchain.json` `exceptions`에서 tool이 `rust`이고
  scope가 crate를 담는 항목의 Rust nightly를 `RUSTUP_AUTO_INSTALL=0`으로 실행합니다. 그 재시도 조건은 "rustdoc JSON is stable"이며,
  nightly를 쓰는 곳은 이것뿐입니다. `make install-tools`가 exceptions의 Rust channel마다
  `rustup toolchain install <channel> --profile minimal`로 설치하며(`install-rust.mts`), rustup이 없으면 그 설치 방법과 함께 실패합니다.
- 설치되지 않은 extractor, 없거나 둘인 nightly, 실패한 도구, id 목록이 아닌 출력은 extractor와 entry를 적은 R1 finding입니다.

### Spec anchor (K75)

영구적인 차이는 그것을 차이로 만드는 spec을 인용합니다(S6). 모든 implementation보다 좁은 profile과 모든 `nativeOnly` 항목은
`spec`에 그 이유의 anchor `<file>#<fragment>`를 선언하며, 파일은 `contracts/`나 `docs/spec/` 아래에 있습니다. 각 anchor는
풀립니다. Markdown 파일은 fragment를 explicit anchor `<a id>`나 heading anchor로 정의하고, JSON 파일의 fragment는 그 값 하나를
가리키는 JSON Pointer(RFC 6901)입니다. 모든 implementation의 profile은 anchor를 인용하지 않습니다.

### case별 admission

suite unit은 `admit`을 선언할 수 있습니다. `admit`은 `cases`에서 case 이름 옆에 있는 각 case 객체의 key이며, 그 case를 admit하는
implementation의 목록을 담습니다(예: `kinds`). 이 key가 없는 case 객체는 profile의 모든 implementation이 admit합니다. 목록의 각
이름은 profile의 implementation이어야 하며, key는 그런 이름의 배열이어야 합니다. 아니면 선언 finding입니다. 목록이 빼는 implementation은
그 case를 실행하지 않습니다. 그 binding의 기대 case에서 빠지므로, 그 case의 native test는 R3 finding(`not in the suite`)이고, 모든
실행은 `unit <unit> does not run <case> for <implementations>: <key> lists <implementations>` 줄을 출력합니다. `admit`은 suite unit에만
둡니다.

다음은 선언 finding입니다. 어떤 case 객체에도 없는 key, 빈 목록, 두 번 적힌 이름, 그리고 admit하는 case가 없는 profile의
implementation입니다(R8이 제외한 경우는 그 자체가 finding이므로 제외). 아무것도 admit하지 않는 implementation은 아무것도 실행하지
않으므로, profile에서 빼거나 이유와 item을 적어 제외해야 합니다.

### 선언

`config/parity.json`은 `scripts/kit/schema/parity.schema.json`으로 검증합니다(`make kit-check`도 검증합니다):

| Key | 내용 |
|---|---|
| `implementations` | `name`, `runner`(`go`, `cargo`, `node`, `vitest`, `php`, `python`), `prose`(문서가 그것을 적는 이름으로, R10이 읽음), `roots`(그 directory; repository 전체는 안 됨), `tests`(test 파일의 glob 하나 이상), `support`(test 보조 파일의 glob), `command`, `args`, `env`(`name`, `value`), `symbols`(`go`, `php`, `python`, `rust`, `ts` 중 하나인 `extractor`와 그것이 읽는 path인 `entry`; Symbol extractors), `errors`(`file`, `pattern`: 생성된 code) |
| `profiles` | `name`, 묶는 `implementations`, 그리고 모든 implementation보다 좁은 profile에 필요한 `reason` |
| `suites` | 공유 vector 파일의 glob |
| `comparators` | 여러 implementation의 출력을 비교하는 검사의 directory |
| `tools` | contract를 구현하지 않는 단일 언어 tooling test의 각 directory의 `root`와 `reason`으로, 매 실행이 출력합니다. R6은 그곳의 test를 받아들이고 R3과 R5는 판정하지 않습니다. implementation root와 겹치거나 binding의 test를 담은 root는 declaration finding입니다 |
| `testPatterns` | 각 `runner`에 대해 repository 전체의 test 파일 `globs` |
| `units` | `id`, `kind`(`suite`, `feature` 또는 `api`), `profile`. suite는 `file`, `cases`(vector 파일이면 `$` 뒤에 `.<key>`와 `[*]` 단계와 선택적인 마지막 `.~` 단계가 오는 path로, `.~`는 object의 key를 case 이름으로 고릅니다. directory이면 그에 상대적인 glob으로, `/` 단계마다 directory 한 단계에 맞고, 맞은 directory 하나가 directory에 상대적인 path로 이름 붙은 case 하나입니다. 예는 `<group>/<case>/` 위의 `*/*`입니다. case 안은 검사하지 않고, 맞은 파일은 declaration finding입니다. go binding은 그런 이름을 중첩 subtest로 보고합니다), `bindings`(`implementation`, `test`, `symbol`)를 가집니다. API unit은 `symbols`(`implementation`, `symbol`)를 가집니다. |
| `nativeOnly` | 한 implementation만 가진 export된 symbol의 `implementation`, `symbol`, `reason` |
| `exclusions` | `unit`, `implementation`, `reason`, 그리고 exclusion을 제거하는 checklist item인 `item` |
| `errors` | `profile`과 `catalog`(`file`, `pattern`) |
| `languageLists` | `file`, `pattern`(첫 group이 목록을 담고, group의 단어가 이름), `profile` |
| `documents` | `globs`와 수 뒤에 오는 단어인 `nouns`(`languages`, `언어`) |

pattern은 각 줄에 적용하는 정규식(flag `gm`)이며, 첫 group이 값입니다. 수는 숫자, twelve까지의 영어 수 단어나 `both`, 또는 열까지의
한국어 고유어 수사이고, 공백, hyphen(`four-client`), 또는 한국어 단위(`6개 언어`, `여섯 개 언어`, `세 가지 언어`) 뒤에 noun 하나가
옵니다. 목록은 `,`, `and`, `or`, `/`, `및`, 또는 조사 `와`와 `과`로 이은 implementation 이름 세 개 이상입니다. implementation의
extractor는 그 public symbol의 id를 줍니다(Symbol extractors).

R10은 `scripts/kit/markdown.mts`의 Markdown reader 위에서 문서의 산문을 passage 단위로 읽습니다. passage는 이어지는 줄을 포함한
문단이나 list item, marker를 뺀 block quote, ATX heading(`#`부터 `######`와 공백), 또는 table row입니다. fenced block, 들여쓴 code
block, setext 밑줄은 산문이 아니며, setext 밑줄은 그 문단을 끝냅니다. inline code, link 목적지, autolink, 그냥 쓴 URL, link 정의,
HTML tag와 주석은 비우므로 산문만 implementation을 적습니다. 이름 뒤의 code span은 그 이름을 목록에 남깁니다
(``Go `x`, PHP `y`, Rust `z`, and TypeScript `w` ``). 문장은 공백 앞의 `.`, `!`, `?`에서 끝나고, table cell은 따로 한 문장입니다.

N의 수는 implementation N개의 profile이 그 문장이 적은 implementation을 모두 담거나("five clients: Go, PHP, Rust, TypeScript and
Python"), 문장이 정확히 N개의 implementation을 적고 passage의 이름을 모두 모은 것이 profile일 때 맞습니다. 그래서 다른 것을 하나나
둘 세는 수도 다른 수와 똑같이 실패하며, 문서는 그런 문장을 수사 없이 씁니다. 목록은 그 문장의 implementation 이름을 모두 모은 것이
profile일 때 맞습니다. implementation 일부에 대해 말하는 문장은 같은 문장에서 나머지도 적습니다("Go, Rust and TypeScript generate
the methods; PHP and Python resolve them at call time"). marker와 들여쓰기가 같고 사이에 다른 passage가 없는 한 Markdown
list의 item들은, 각 item이 implementation을 정확히 하나 적을 때 한 목록입니다. 그런 이름 세 개 이상은 모두 모아 profile일 때
맞습니다. implementation은 그 이름이나 `prose`의 이름(`php-extension`의 `"prose": ["PHP extension"]`)으로 대소문자 구분 없이
적힙니다. 다른 implementation의 이름인 prose 이름과 반복된 prose 이름은 declaration finding입니다.

catalog pattern은 catalog에서 빈 줄도 주석(`#` 또는 `//`로 시작하는 줄)도 아닌 각 줄에 적용합니다. 그런 줄 모두에 맞아야 하므로
어떤 code도 빠지지 않습니다. pattern이 group 없이 맞는 줄은 항목의 다른 field처럼 code를 담지 않습니다. 예는
`^- code: (\w+)$|^  \w+: .*$`입니다.

모든 implementation보다 좁은 profile은 빠진 implementation을 그 unit에서 제외합니다. 실행마다 그런 profile을 빠진 것과 이유와 함께
출력합니다. unit 둘 이상이 그 profile을 씁니다. unit 하나의 profile은 실패하지 않는 exclusion이 되기 때문입니다.

### Repository 연결

1. `make kit-sync` 뒤에 `config/parity.json`을 씁니다. 모든 implementation, profile, vector 파일마다 suite unit, 공개 개념마다
   API unit, 그리고 implementation이 아직 갖추지 못한 unit마다 checklist item을 적은 exclusion을 선언합니다.
2. 각 binding의 native test가 suite의 case마다 runner의 이름으로 그 case를 보고하게 합니다(Runner 표 참고). Go에서는 subtest
   `<symbol>/<case>`, cargo에서는 test `<symbol>::<case>`, node:test에서는 이름이 `<case>`인 최상위 test, PHPUnit에서는 binding이
   symbol로 적은 method `<class>::<method>`의 이름이 `<case>`인 data set(문자열 key의 `#[DataProvider]`, class는 fully
   qualified), 그렇지 않으면 PHPUnit과 unittest에서는 test method `test_<case>`입니다. binding은 검사를 위한 줄을 출력하지
   않습니다.
3. 각 implementation의 `symbols`(`extractor`, `entry`)를 선언하고, 각 implementation의 error code를 catalog에서 생성합니다.
4. `parity-declarations-check`를 repository의 검사 target에, `parity-check`를 CI에 추가해 둘 다 push가 반영되기 전에 실행되게
   합니다. error code 생성물을 다시 만드는 검사 뒤에 실행합니다(신뢰 경계). 설치된 package의 kit.mk에 target이 이미 있습니다.

```json
{
  "schema": 1,
  "implementations": [
    { "name": "go", "runner": "go", "roots": ["packages/go"], "tests": ["packages/go/**/*_test.go"],
      "symbols": { "extractor": "go", "entry": "packages/go" }, "errors": { "file": "packages/go/codes.go", "pattern": "^\\tCode\\w+ = \"(\\w+)\"$" } },
    { "name": "python", "runner": "python", "roots": ["packages/python"], "tests": ["packages/python/tests/*.py"],
      "symbols": { "extractor": "python", "entry": "packages/python/src/client" }, "errors": { "file": "packages/python/codes.py", "pattern": "^\\w+ = \"(\\w+)\"$" } }
  ],
  "profiles": [{ "name": "client", "implementations": ["go", "python"] }],
  "suites": ["tests/**/vectors.json"],
  "comparators": ["tests/conformance/check"],
  "testPatterns": [
    { "runner": "go", "globs": ["**/*_test.go"] },
    { "runner": "python", "globs": ["**/test_*.py"] }
  ],
  "units": [
    { "id": "codec", "kind": "suite", "profile": "client", "file": "tests/codec/vectors.json", "cases": "$.vectors[*].name",
      "bindings": [
        { "implementation": "go", "test": "packages/go/codec_test.go", "symbol": "TestCodecVectors" },
        { "implementation": "python", "test": "packages/python/tests/test_codec.py" }
      ] },
    { "id": "host-decode", "kind": "api", "profile": "client", "symbols": [
        { "implementation": "go", "symbol": "packages/go/hostcodec.go::HostDecode" },
        { "implementation": "python", "symbol": "packages/python/codec.py::host_decode" }
      ] }
  ],
  "exclusions": [],
  "errors": { "profile": "client", "catalog": { "file": "docs/errors.yaml", "pattern": "^\\s*- code: (\\w+)$" } }
}
```

## Python lock: PEP 751 pylock.toml (K36)

의존성 gate는 Python lock을 PEP 751의 표준 형식(상태 Final, resolution 2025년 3월 31일)인 `pylock.toml` 또는 `pylock.<name>.toml`로만 읽으며,
이 파일은 `config/dependency-policy.json`의 `pythonLocks`에 적습니다. uv.lock은 읽지 않습니다. uv 고유의 형식이고, wheel을 배포하는 저장소에는
모든 installer가 읽는 lock이 필요합니다.

쓰는 도구는 uv 0.12.11과 pip 26.2.1로 측정했습니다: `uv export --format pylock.toml --frozen --no-emit-project -o <lock>`과 `pip lock`.
uv는 이 파일로 hash를 확인하며 설치하고, pip는 이 파일의 `vcs` 항목을 거부합니다. 두 도구 모두 `created-by`를 씁니다.

### 규칙

- 파일은 `scripts/kit/pylock.mts`(`readPylock`)가 smol-toml(`scripts/kit/toml.mts`)로 읽으며, smol-toml은 TOML 전체를 읽습니다.
  올바른 TOML이 아닌 텍스트는 파일, 줄, 열과 함께 실패합니다.
- `lock-version`은 `"1.0"`이어야 하며, 다른 값이면 gate가 실패합니다.
- 각 lock의 sha256은 다른 생태계의 lock과 같이 `config/dependency-review.json`에 기록합니다.
- registry package(`sdist` 또는 `wheels`)는 lock의 의존성입니다. 이름과 버전을 기록하고, 최신 stable release를 PyPI에 질의하며, 고정된 버전의
  advisory를 PyPI release JSON(`vulnerabilities`)에서 읽습니다. 모든 `sdist`, `wheels`, `archive` 파일은 `sha256`을 가져야 하며, 없으면 gate가 실패합니다.
- `vcs` package(git)는 `commit-id`로 고정하며, 값은 40자리 16진수여야 합니다. 기록에는 URL, `requested-revision`, `commit-id`를 둡니다. lock과 기록이
  다른 commit을 가리키면 gate가 실패합니다. git package는 advisory나 release를 질의하지 않습니다.
- source table이 없는 package나 `directory` package는 gate가 실패시킵니다. 소비자는 `--no-emit-project`로 lock을 내보내므로 로컬 package에는 검토할 release가 없습니다.
- `created-by`는 필수입니다. 오래된 release나 advisory의 fix는 lock을 쓴 도구를 이름으로 지정합니다. uv는 `uv lock --upgrade-package <name>` 뒤에 export를 다시 실행하고,
  pip는 `pip lock`입니다. 다른 값이거나 없는 `created-by`의 lock은 빠진 도구를 이름으로 지정하는 fix를 받습니다. 검토는 lock을 직접 다시 쓰지 않으며(`UPDATE=1`은 이 package를 건너뜁니다).
- 이 릴리스를 도입하는 소비자는 각 lock을 `config/dependency-policy.json`의 `pythonLocks`에 `source`를 가진 object로 추가합니다(K54): `{ "lock": "<pylock.toml>", "source": { "requirements": "<file>", "constraints": "<file>" } }`. 이 필드는 필수이며 호환 경로는 없습니다.

### 한계

- reader는 lock을 쓰는 도구의 부분집합만 읽습니다. 그 밖의 구문을 쓰는 다른 도구의 lock은 reader가 읽도록 확장될 때까지 실패합니다.
- `directory` package는 검토하지 않고 거부합니다.

## uv와 Python lock writer (K54)

`uv`는 `mise.toml`의 도구입니다. mise가 정확한 release를 `mise.lock`의 sha256으로 설치하고, shim
`var/tools/mise/shims/uv`가 그것을 실행합니다(K127). `make python-lock`(ONLINE)은 그 uv로
`pythonLocks`의 각 Python lock을 쓰고, `make python-lock-check`(offline)은 각 lock을 source와 비교합니다. 고정하는 이유는, PATH의 선언되지 않은
uv로 쓴 lock이 기계에 따라 달라지기 때문입니다. `pip lock`(pip 26.2.1)은 experimental이며 실행 중인 platform 하나만 lock했습니다(cryptography가
macOS arm64 wheel 하나만 받음). uv의 universal resolution은 모든 platform의 파일을 marker와 hash와 함께 씁니다.

### uv: 설치와 state

- **Release archive (K64, K127):** mise가 uv를 release archive `uv-<target>.tar.gz`(aqua backend)에서 설치하며, linux-x64,
  linux-arm64, macos-arm64, macos-x64의 sha256은 `mise.lock`에 있습니다. K127 이후 uv는 Python을 설치하지 않습니다. Python은 `mise.toml`의 도구입니다.
- **state는 `var/tools` 아래, home에는 쓰지 않음:** checkout의 mise 환경(kit.mk, `miseEnvironment`)이
  `UV_CACHE_DIR=var/tools/mise/cache/uv`, `UV_PYTHON_DOWNLOADS=never`(uv는 interpreter를 내려받지 않음), `UV_NO_CONFIG=1`(home이나
  system의 `uv.toml`을 읽지 않음)을 설정하고, `toolsEnvironment`가 mise의 python3인 `UV_PYTHON`을 더합니다.

### 측정한 uv 동작 (uv 0.12.11, aarch64-apple-darwin, install-tools의 Python 3.14.8 virtual environment)

| 경우 | 결과 |
|---|---|
| 출력 이름 | `-o`는 `pylock.toml` 또는 `<name>`에 점이 없는 `pylock.<name>.toml`이어야 합니다. `-o lock.toml`은 그 규칙으로 exit 2입니다. |
| header | 첫 주석은 `-o` 경로와 source 경로를 포함한 명령 줄 전체를 적습니다. 그래서 writer는 source 이름으로 임시 directory에서 실행합니다. |
| 쓰는 파일 | cache가 비어 있는 online 실행은 lock 하나만 씁니다. working directory의 다른 파일은 없습니다. |
| cache | `UV_CACHE_DIR` 아래에만 있습니다: `interpreter-v4`, `sdists-v9`, `simple-v24`, `wheels-v6`, `archive-v0`(URL constraint가 있을 때), `.lock`, `CACHEDIR.TAG`, `.gitignore`. 아래 여섯 package 집합은 904K입니다. |
| offline, cache 비어 있음(`--offline`) | exit 1, "unsatisfiable"이며 파일을 쓰지 않습니다. |
| offline, cache 있음(online 실행의 cache) | exit 0입니다. lock의 본문은 online과 byte 단위로 같고, `--offline`을 적은 header 줄만 다릅니다. |
| PATH에 Python 없음(`env -i PATH=/bin`), cache 비어 있음 | exit 0입니다. `--universal`은 interpreter가 필요 없습니다. |
| marker 요구 `colorama==0.4.6; sys_platform == "win32"` | 해당 package가 `marker = "sys_platform == 'win32'"`를 가집니다. |
| constraint `certifi @ <wheel URL>#sha256=<digest>` | 해당 package는 registry 항목이 아니라 `archive = { url, hashes = { sha256 } }`입니다. digest는 fragment의 값입니다. |
| platform | `charset-normalizer==3.5.2`는 wheel 파일이 86개입니다. 집합의 97개 파일은 모두 sha256을 가집니다(`--generate-hashes`). |
| `pyproject.toml`을 requirements로 쓰고 임시 directory에 그 이름으로 복사 | uv는 거기서 `[project].dependencies`를 읽습니다. project 자신은 출력되지 않으므로 lock에는 의존성만 있습니다. lock 이름 아래 제자리 실행은 측정하지 않았습니다(첫 시도는 uv가 거부하는 `out-a.toml`을 썼습니다). 복사는 동작하므로 writer는 복사합니다. |
| `--no-index --find-links <dir>`, `<dir>`은 상대 또는 절대 경로 | local wheel마다 `wheels = [{ url = "file:///<realpath>/<wheel>", hashes = { sha256 } }]`입니다. uv는 상대 입력이 아니라 realpath를 적습니다. header에는 `--no-index`가 있고 `--find-links`는 없으므로 header에 checkout 경로가 없습니다. |
| `path = "<lock 기준 상대 경로>"`(PEP 751) | `uv pip install --dry-run --no-index -r pylock.toml`과 pip 26.2.1의 `install --dry-run --no-index -r pylock.toml`은 lock의 directory 기준으로 path를 읽습니다. uv는 두 working directory에서, pip은 lock directory에서 측정했습니다(집합의 wheel 두 개). |
| `--universal`의 하한 | `--python-version`이 없으면 uv는 universal resolution의 Python 하한을 `requires-python`이 아니라 찾은 interpreter에서 정합니다(측정함: PATH에 Python 3.11이 있으면 3.11로 풀고 의존성 하나가 3.14를 요구한다고 알렸습니다). 그래서 writer는 `mise.toml`의 `python`의 minor를 `--python-version`으로 넘기고, 그것이 없는 `mise.toml`은 uv 실행 전에 거부합니다. |
| `[project].dynamic`의 `dependencies` 항목 | uv로는 측정하지 않았습니다. writer와 검사는 uv 실행 전에 거부합니다. |

여섯 package 집합은 `requests==2.34.2`, `certifi==2026.7.22`, `charset-normalizer==3.5.2`, `idna==3.20`, `urllib3==2.8.0`, 그리고 marker를 위한
`colorama==0.4.6`입니다. 모든 package가 고정되어 있어 어떤 실행도 version을 고르지 않습니다.

### lock 선언

`config/dependency-policy.json`은 `pythonLocks`에서 lock마다 항목을 두며, 그 `source`는 lock을 쓰는 파일을 적습니다
(`scripts/kit/schema/dependency-policy.schema.json`):

```json
"pythonLocks": [
  {
    "lock": "packages/app-python/pylock.toml",
    "source": {
      "requirements": "packages/app-python/pyproject.toml",
      "constraints": "packages/app-python/constraints.txt",
      "findLinks": "packages/app-python/wheels"
    }
  }
]
```

- `requirements`: 직접 요구사항이며, 두 형태 중 하나입니다.
  - requirements 파일, 한 줄에 하나: `name`, `name==version`, `name>=2.30,<3` 또는 `name~=2.34` 같은 범위, 또는 `name @ url`.
    `;` 뒤의 marker는 uv가 유지하며 pin을 읽지 않고, extra도 pin을 읽지 않습니다. option이나 다른 형태는 그 줄과 함께 실패합니다.
  - `pyproject.toml`: 정적 `[project].dependencies`가 직접 요구사항입니다. wheel package는 자기 pyproject를 가리키므로 요구사항의
    사본이 하나뿐입니다. `[project].dynamic`에 `dependencies`가 있는 pyproject는 거부합니다. 요구사항이 파일에 없기 때문입니다.
    kit의 reader는 한 줄 문자열만 읽으므로, 여러 줄 문자열이 있는 pyproject는 그 줄과 함께 실패합니다.
- `constraints`: 모든 package를 고정하는 constraints 파일입니다(전이 의존성 포함). 한 줄에 하나씩 `name==version` 또는
  polyspec archive의 `name @ https://...#sha256=<digest>`입니다. 그 밖의 형태(범위, marker, option, hash)는 그 줄과 함께 실패합니다.
- `findLinks`(선택): checkout 안의 directory이며 root 기준 상대 경로이고 local wheel을 담습니다. writer는 uv를
  `--no-index --find-links <directory>`로 실행하여 index를 읽지 않습니다. checkout 밖의 경로나 없는 directory는 실패합니다.
  directory는 lock의 package(lock의 directory) 안에 있습니다. lock은 local wheel마다 lock 기준 상대 경로를 적고, 그 경로는
  package를 벗어날 수 없습니다. writer는 package 밖의 findLinks를 uv 실행 전에 거부하고, `python-lock-check`는 package를
  벗어나는(`..`) local 경로를 package와 file을 밝히며 거부합니다.

```text
# packages/app-python/pyproject.toml
[project]
name = "app"
version = "0.0.0"
dependencies = ["requests==2.34.2", "colorama==0.4.6; sys_platform == 'win32'"]

# packages/app-python/constraints.txt
requests==2.34.2
certifi==2026.7.22
charset-normalizer==3.5.2
colorama==0.4.6
idna==3.20
urllib3==2.8.0
```

### writer (`make python-lock`, findLinks를 선언하지 않으면 ONLINE)

`scripts/kit/python-lock.mts write`는 `var/tools/mise/shims/uv pip compile <requirements> -c <constraints> --universal --python-version <python>
--generate-hashes --format pylock.toml -o pylock.toml`(`<python>`은 `mise.toml`의 `python`의 minor)을 `var/tools`의 directory(`python-lock-<random>`)에서 실행합니다. 이 directory에는 두 source가
각자의 이름으로 있습니다. `pyproject.toml`은 그 이름으로 복사되며, uv는 거기서 읽습니다(아래 측정). 그래서 uv를 위해 pyproject가
checkout에 그대로 있을 필요는 없습니다. findLinks가 있으면 `--no-index --find-links <directory>`를 덧붙입니다. source는 먼저 읽고
파싱하므로, 잘못된 source는 uv 실행 전에 멈춥니다.

uv는 local wheel을 `url = "file:///<checkout 경로>/<wheel>"`로 적습니다. writer는 이 URL을 lock의 directory 기준 상대 `path`
(`path = "../links/<wheel>"`, PEP 751)로 바꾸고, 그 밖의 file URL은 거부하므로 lock에는 기계 경로가 남지 않습니다. 쓰인 lock은
sources와 대조한 뒤(`python-lock-check`와 같은 검사) 제자리로 이름이 바뀝니다. 거부된 실행은 이전 lock을 그대로 두고 directory를
지웁니다. 전이 의존성이 고정되지 않았으면 writer는 그 package 이름과 함께 거부합니다. uv가 registry release로 해석했지만 constraints에는
없고, 검사가 그것을 lock에서 찾기 때문입니다.

### 검사 (`make python-lock-check`, offline)

resolve하지 않습니다. 다음 경우 파일과 package 이름, 그리고 고치는 방법을 적고 실패합니다.

- lock의 package에 constraints의 pin이 없거나(전이 의존성 포함), pin에 대응하는 lock package가 없습니다.
- lock package의 version이 pin과 다르거나, git 또는 directory package입니다(lock은 registry 파일과 archive만 담습니다).
- constraint가 `name==version`이나 `#sha256`이 붙은 직접 참조가 아니거나, 줄이 option 또는 hash입니다(requirement와 constraint
  줄은 pip-requirements-js가 PEP 508과 pip의 파일 문법으로 읽습니다).
- requirement에 pin이 없거나, 고정된 version이 그 specifier를 만족하지 않습니다(@renovatebot/pep440의 `satisfies`).
- `pyproject.toml` source가 `[project].dynamic`에 `dependencies`를 나열하거나 `[project]` table이 없습니다.
- registry 파일에 sha256이 없거나, lock이 PEP 751 1.0이 아니거나 읽히지 않습니다(`readPylock`).
- lock의 local 파일(lock 기준 상대 `path`)이 없거나, 절대 경로이거나, lock의 sha256을 갖지 않습니다. 검사는 파일을 읽으므로
  findLinks lock의 wheel은 checkout에 있어야 합니다.
- archive의 URL이나 sha256이 constraint와 다릅니다.
- source 또는 lock이 없습니다.

각 경우에는 그 경우에서만 실패하는 test가 있습니다(`tests/kit/python-lock-check.test.mts`). writer의 경우는
`tests/kit/python-lock-write.test.mts`에 있으며 uv는 stub입니다. `tests/source/python-lock-real.test.mts`는 network 없이 실제 uv를
실행합니다. wheel은 `var/tools/wheels`의 고정된 setuptools wheel과, 고정된 Python으로 source tree에서 만든 순수 Python wheel이며,
둘 다 test의 directory(`var/` 아래)에 있습니다. 이 test는 findLinks로 pyproject의 lock을 쓰고, offline 검사가 그 lock을 통과시키며,
version drift(`0.0.1`에서 `0.0.2`)는 `tinylib`과 함께, `setuptools`가 빠진 constraints는 `setuptools`와 함께 실패하는지 봅니다.
`tests/kit/fixture`의 fixture policy는 존재하고 lock과 일치하는 source를 선언하며, test가 그 fixture에서 검사를 실행합니다.

### 한계

- findLinks lock의 local 파일을 검사가 읽으므로, wheel이 없는 checkout은 내려받기 전까지 검사에 실패합니다.
- 검사는 pyproject의 `[project].dependencies`만 읽습니다. uv는 lock을 쓸 때 `[tool.uv]`(index, source)도 읽습니다. uv가 git이나
  directory로 해석하는 source는 검사에 실패하며, 추가 index는 검사가 보지 않습니다.
- kit의 reader는 한 줄 문자열만 읽으므로, 여러 줄 문자열이 있는 pyproject는 그 줄과 함께 실패합니다(reader가 이름을 적으며, 조용히
  건너뛰지 않습니다).
- 검사는 registry 파일의 sha256을 network 없이 registry와 비교할 수 없으므로, registry hash의 16진수 한 자리 차이는 통과합니다. dependency
  review는 lock의 sha256을 기록하고 그 변경에서 gate가 실패합니다(K36).
- findLinks를 선언하지 않으면 writer는 network(uv를 통한 PyPI)가 필요합니다.
- requirement의 extra와 marker는 고정되는 package를 바꾸지 않습니다. lock의 모든 package는 marker와 관계없이 constraints에 있어야 합니다.

## Editor tools (K80)

orm과 template은 둘 다 editor package를 갖습니다: language service, language server, CodeMirror adapter, VS Code extension입니다.
이것을 검사하고 시험하는 두 tool이 template(`scripts/check-editor-boundaries.mjs` 103, `scripts/install-vscode.mjs` 75)에서
kit으로 옮겨집니다. 각 repository는 자기 make target에서 자기 설정으로 이것을 실행합니다.

### Editor boundaries

`scripts/kit/check-editor-boundaries.mts`는 `config/editor-boundaries.json`(`scripts/kit/schema/editor-boundaries.schema.json`)을
읽습니다. 각 boundary는 다음을 갖습니다:
- `packages`: package directory;
- `sources`: 각 package의 source directory;
- `forbiddenModules`: package가 import하지도, package.json의 dependency field에 선언하지도 못하는 module의 glob;
- `forbiddenGlobals`: package가 쓰지 못하는 global;
- `exempt`: 시작점이 아닌 source, 예를 들어 language service의 command line.

검사는 exempt glob에 맞지 않는 모든 source에서 시작합니다. relative import를 package 밖까지 이행적으로 따라가고, finding을 import
사슬과 함께 보고합니다. 검사한 source가 닿는 파일은 exempt glob 아래에 있어도 검사합니다. bare specifier는 이름으로 판정하며 따라가지
않습니다. relative import는 자기 파일을 적고, `.ts` 파일에는 `.js`를 적습니다. 검사가 따라갈 수 없는 import는 건너뛰지 않고 finding이
됩니다: 계산된 `import()`, subpath import, 파일이 없는 relative import, `.tsx`나 `.jsx` source입니다.

template tool은 설정이 없었고 import를 따라가지 않았습니다. `src`의 각 파일에서 정규식 하나로 import를 찾았고, `document`의 property를
나열한 두 번째 정규식으로 DOM global을 찾았습니다. kit은 대신 parse합니다:
- Node.js의 TypeScript 제거기인 amaro가 transform mode로 TypeScript를 JavaScript로 바꿉니다. Node.js 26에 내장된 제거기는 strip만
  하며, parameter property에서 실패합니다.
- acorn이 JavaScript를 parse하고, acorn-walk가 `import`, `export … from`, `import()`, `require()` node를 찾습니다.
- eslint-scope가 어떤 scope도 선언하지 않은 reference를 찾으므로, `document`라는 지역 변수는 global의 사용이 아닙니다.

이것들이 다음 대안을 대신했습니다:
- TypeScript 7에는 불안정한 compiler API만 있습니다.
- dependency-cruiser와 madge는 TypeScript 6의 API가 필요합니다(K111).
- es-module-lexer는 `require()`도 global도 읽지 않습니다.

template tool의 runtime self-test는 `tests/kit/editor-boundaries.test.mts`가 되었습니다.

### VS Code installer

`scripts/kit/install-vscode.mts <extension package directory> <tools directory>`는 `engines.vscode`의 최소 버전(`^X.Y.Z`; 다른
형식은 실패)을 `@vscode/test-electron`의 layout으로 설치하며, 내려받기는 그 library가 합니다. tool은 library에 없는 두 가지를 더합니다:
- `installedExecutable`: integration 실행의 offline 읽기입니다. 사본이 없으면 `run make install-vscode`와 함께 실패합니다.
- `<tools>/.next-<pid>`에 내려받아 제자리로 rename합니다. library는 최종 directory에 압축을 풀므로 두 install이 동시에 돌면 서로를
  망가뜨립니다. rename을 쓰면 먼저 끝난 install의 사본이 남습니다.
- 내려받기를 자기 process에서 돌립니다(K173). `@vscode/test-electron` 3.1.0은 `.tar.gz` 내려받기를 `tar -xzf -` child에 pipe하고,
  응답이 실패하면("aborted") 그 child를 끝내지도 죽이지도 않습니다. 그 child가 event loop를 붙잡아 재시도가 성공한 뒤에도
  install이 끝나지 않았습니다. 명령은 `--download`로 자기 자신을 자기 process group에 fork하고, 내려받기가 끝나면 그 group을
  죽입니다. 실패한 내려받기는 그 오류로 install을 실패시킵니다. install이 먼저 사라지면 내려받기 process도 끝납니다.

`@vscode/test-electron`은 kit의 optional peer dependency입니다: VS Code를 설치하는 repository가 이것을 선언합니다.
`tests/kit/install-vscode.test.mts`는 내려받기를 함수로 바꾸므로 어떤 test도 network에 닿지 않습니다. 명령의 test는
local proxy 뒤의 update.code.visualstudio.com stub(openssl이 만든 인증서, `NODE_EXTRA_CA_CERTS`)에 대해 `@vscode/test-electron`을
돌리며, stub은 고른 시도의 archive 응답을 중간에 끊습니다.
