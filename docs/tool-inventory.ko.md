<!-- doc-id: tool-inventory -->
<!-- source-sha256: 1f8305e7493a511bede52091f1af95ded2909242d033015e10f5538add3b6871 -->
# 도구 목록

[English](tool-inventory.md)

공유 도구는 여러 구현으로 존재합니다. 이 목록은 각 도구가 어디에 있는지, 크기가 얼마인지, kit이 기반으로 삼는 구현이
무엇인지 기록합니다. 도구를 kit으로 합칠 때는 구현들 중 더 넓은 동작을 택하고, kit 테스트로 고정하고, 모든 사본을 vendored
파일로 바꿉니다. 5개 저장소의 작업 트리에서 잰 줄 수입니다.

| 도구 | template | crudui | hyper | ordered-json | orm | kit의 기반 |
|---|---|---|---|---|---|---|
| release | `scripts/release.mjs` 388 | 357 | 317 | `scripts/release.py` 383 | `scripts/release/release.mjs` 302 | template, ordered-json의 Go tag 규칙 포함 |
| push-gate | 125 | 149 | 121 | `push_gate.py` 192 | `scripts/check/push-gate.mjs` 121 | crudui |
| full-run | 199 | 240 | 246 | `full_run.py` 285 | `scripts/check/full-run.mjs` 328 | orm |
| git-hooks | 27 | 없음 | 28 | 없음 | 없음 | hyper |
| holder-lock | 134 | 275 | 111 | 없음 | 없음 | crudui |
| check-documents | 151 | 95 | 70 | `docs_check.py` | 없음 | template |
| owner-check | 219 | 254 | 178 | `owner_check.py` 171 | 없음 | crudui |
| run-tests | 289 | 282 | 159 | `test.py` | 없음 | template |
| target-report, ci-targets | 100, 52 | 73, 47 | 없음 | `ci_run.py` | 없음 | template |
| ci-passed | 36 | 39 | 없음 | `ci_run.py` | `scripts/check/ci-passed.mjs` 32 | template |
| install-tools | 189 | 없음 | 없음 | `toolchains.py` | 없음 | template |
| 의존성 상태, 검토, 게이트 | v0.0.2부터 kit에 있음 | 317, 288, 185 | 없음 | 없음 | 없음 | crudui, kit과 병합 |
| github-ruleset | 182 | 없음 | 164 | 없음 | 없음 | 제거(0.x에는 ruleset이 없음) |

## 결정

- 모든 도구는 Node(`.mjs`)입니다. ordered-json의 Python 도구는 대체하고 삭제합니다.
- 저장소끼리 다른 것은 `config/*.json`뿐입니다. 도구의 코드에는 저장소 이름이나 경로를 넣지 않습니다.
- `github-ruleset`은 vendored하지 않습니다. 0.x 규칙에는 pull request도 ruleset도 없으므로 template과 hyper에서 파일과 Make
  target을 제거합니다.

## Toolchain (K8.2)

`scripts/kit/install-tools.mjs`는 선언된 toolchain을 `var/tools`에 설치하고, `scripts/kit/check-toolchain.mjs`는 실행 중인
도구를 선언과 대조합니다. `scripts/kit/toolchain-declared.mjs`가 선언을 읽고, 설치하는 도구마다 module이 하나씩 있습니다
(`install-npm.mjs`, `install-go.mjs`, `install-ruff.mjs`, `install-composer.mjs`; cargo-audit와 govulncheck는 기존
`install-cargo-audit.mjs`, `install-govulncheck.mjs`를 씁니다). 모든 installer는 `install-tool.mjs`를 씁니다. release를 대상
옆에서 만들고 거기서 확인한 뒤 rename하므로, 두 번째 실행은 아무것도 바꾸지 않습니다. Make target은 `install-tools`(`ONLINE`을
통한 online)와 `toolchain-check`(offline, `TOOLS`가 도구를 제한)입니다.

### 선언

| 도구 | 선언 위치 | 설치 또는 검증 |
|---|---|---|
| Node.js | `.node-version`(정확한 version) | 검증 |
| npm | `package.json`의 `packageManager`: `npm@X.Y.Z` 또는 `npm@X.Y.Z+sha512.<digest>` | 설치 |
| Go | `config/toolchain.json`의 `go`: `versionFile`, 없으면 `go.mod`의 `toolchain` 줄, 없으면 `go` directive | 설치 |
| Rust | `rust-toolchain.toml`의 `channel`(정확한 version) | 검증 |
| PHP | `config/toolchain.json`의 `php`(minor release 목록), 없으면 `.php-version` | 검증 |
| Python | `config/toolchain.json`의 `python`(minor release), 없으면 `.python-version`; 둘 다 있으면 같아야 함 | 검증, 그리고 ruff 환경의 minor |
| Composer | `config/toolchain.json`의 `composer` `{ version, sha256? }` | `sha256`이 있으면 설치, 없으면 검증 |
| ruff | `ruff.pyproject`가 가리키는 `pyproject.toml`의 `ruff==X.Y.Z` pin | 설치 |
| cargo-audit, govulncheck | `config/toolchain.json`의 `cargoAudit`, `govulncheck` | 설치 |

`config/toolchain.json`의 형태는 `scripts/kit/schema/toolchain.schema.json`입니다. `schema`(1), `comment`, `php`(minor release
목록), `python`(minor release), `composer`(`version`, `sha256`), `go`(`mod`, `versionFile`), `ruff`(`pyproject`),
`cargoAudit`, `govulncheck`, `node`(platform별 Node.js archive의 SHA-256)입니다. Rust와 Node.js는 `setup-node`와 `rustup`이
읽는 자기 파일에 둡니다. 선언하지 않은 도구는 설치도 검증도 하지 않습니다.

### 합친 동작

- npm: template의 설치(machine의 npm이 `npm install --prefix`를 실행)와 hyper, ordered-json의 설치(registry tarball을 받아
  SHA-512가 선언한 digest와 같을 때만 사용)는 하나의 설치입니다. `packageManager`에 digest가 있으면 두 번째 경로를 씁니다.
  배치는 `var/tools/npm/node_modules/npm`이고, wrapper `npm`과 `npx`가 `npm-cli.js`와 `npx-cli.js`를 실행합니다. 같은
  version에서 digest가 바뀌면 다시 설치합니다(hyper). link나 특수 파일이 든 tarball은 거부합니다(ordered-json). bootstrap npm은
  `PATH`에서 `var/tools/bin`을 뺀 채 실행합니다(template).
- Go: toolchain module `golang.org/toolchain@v0.0.1-go<version>.<os>-<arch>`을 받는 template의 설치는 이제 release를 세 곳에서
  읽습니다. version 파일(`go.mod`의 `go` directive와 일치하는지 확인하며, crudui와 orm의 파일), `toolchain` 줄(ordered-json),
  `go` directive(template)입니다. 압축을 푼 toolchain만 쓰므로 module cache에 받은 zip은 설치 뒤 지웁니다.
- Composer: hyper는 SHA-256을 확인한 `composer.phar`를 설치하고, template, crudui, orm은 실행 중인 Composer만 검증합니다.
  합친 도구는 `sha256`이 선언되면 설치하고 아니면 검증합니다.
- Python: crudui는 minor release를 설정에, template과 ordered-json은 `.python-version`에 선언합니다. 합친 도구는 설정을 먼저
  읽고 없으면 파일을 읽으며, 둘 다 있고 다르면 실패합니다. PHP도 `.php-version`(ordered-json, orm)과 crudui, template의 목록에
  같은 방식을 씁니다. 파일의 값이 목록에 없으면 실패합니다.
- ruff: template의 virtual environment는 `--copies`로 만들어 interpreter로의 link가 없습니다.
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
- `config/toolchain.json` `node`의 Node.js archive checksum은 저장소 자신의 download가 읽는 data입니다. kit는 받아들이기만 하고
  읽지 않습니다.
