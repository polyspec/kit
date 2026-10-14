<!-- doc-id: changelog -->
<!-- source-sha256: a1a216113624ad0ac2fee847e3043fd0c97edf0a58ccebab4526f3cf1a99410d -->
# 변경 기록

[English](CHANGELOG.md)

## Unreleased

- knip은 make가 실행하는 파일을 layout에 따라 entry로 둡니다: kit의 사본을 포함한 `scripts/` 아래 script, `benchmarks/`의 프로그램, 모든 node:test 파일이며, Makefile이 include하는 `@polyspec/kit`은 쓰이지 않는 dependency가 아닙니다. kit은 CI에서 make lint-ts로 자신을 lint하고 찾은 것을 고쳤으며, 그중에는 모든 consumer의 lint를 실패시킨 `scripts/kit/bootstrap/install-mise.mts`의 template literal이 있습니다. make kit-sync를 실행하세요(K142).

## 0.0.43

- mise.toml은 cargo-nextest(`"github:nextest-rs/nextest" = { version, version_prefix = "cargo-nextest-" }`)와 cargo-deny(`cargo-deny`, mise registry의 aqua backend)를 선언할 수 있습니다. mise.lock이 모든 플랫폼의 native binary를 고정하고 make toolchain-check가 그 `--version`을 읽습니다. 이전에는 kit가 둘 다 거부했습니다(K143).
- run-tests는 test가 timeout을 넘었을 때와 실행기 자신이 중단될 때(SIGINT, SIGTERM, SIGHUP) tool의 process group 전체를 멈추고, 5 s의 유예 뒤에는 SIGKILL을 보냅니다. 중단된 실행기는 tool과 그것이 시작한 process(mise shim 뒤의 interpreter 등)를 고아로 남겼습니다(K141).
- `no-floating-promises`는 typescript-eslint의 option `allowForKnownSafeCalls`로 node:test의 최상위 등록(`test`, `describe`, `it`, `suite`)을 허용합니다. runner가 그것을 기다리기 때문이며, test 안의 진짜 floating promise는 여전히 실패합니다. make kit-sync를 실행하세요(K138).
- API Extractor는 더는 `ae-missing-release-tag`를 보고하지 않습니다: polyspec은 export에 `@public`이나 `@beta`를 달지 않고 잘라낸 rollup을 쓰지 않으므로, `make lint-ts`가 모든 package에서 이것으로 실패했습니다. make kit-sync를 실행하세요(K139).
- parity는 test target이 libtest-mimic(`harness = false`)을 실행하는 cargo binding의 case를 읽습니다. libtest-mimic은 각 test 이름을 `...` 앞에서 가장 긴 이름에 맞춰 채우므로, 이전에는 그 case를 하나도 읽지 못했습니다(K136).
- php suite binding은 test method를 `symbol`로, fully qualified class의 `<class>::<method>`로 적습니다: parity는 그 method만 `--filter`로 실행하고, data provider의 각 data set `<method> with data set "<case>"`가 case `<case>`입니다. 이전에는 data set이 어떤 case에도 대응하지 않았고, 파일의 다른 test는 모두 unit이 선언하지 않은 case였습니다(K137).

### 소비자 이전

변경:
- case가 한 test method의 data set인 php suite binding은 `"symbol": "<Namespace>\\<Class>::<method>"`를 선언합니다. case가 test method `test_<case>`인 binding은 그대로 둡니다.

## 0.0.42

- bootstrap이 `var/tools/go.mod`를 써서, `var/tools` 아래 mise의 Go와 그 test 소스가 별도 module이 되며, 루트가 Go module인 저장소의 `./...`가 그것을 훑지 않습니다(K135).
## 0.0.41

- mise.lock은 bootstrap이 mise를 설치하는 모든 플랫폼인 linux-arm64와 macos-x64의 archive도 고정합니다. 0.0.39와 0.0.40은 ARM Linux runner에서 make install-tools가 실패했습니다(K134).
## 0.0.40

- kit-sync는 package가 더는 선언하지 않는 `scripts/kit/`의 파일(0.0.39 이후의 `scripts/kit/bootstrap/bootstrap-npm.mts` 등)을 지우고, kit-check는 그런 파일을 보고합니다(K133).
- make toolchain-lock은 mise 환경이 mise.toml을 global configuration으로 지정하므로 `mise lock --global`로 그 도구를 잠급니다. 0.0.39는 lock이 없는 저장소에서 lock을 쓰지 못했습니다(K127).
- release workflow는 `make release-tools` 전에 `make release-prepare`를 실행합니다: 저장소는 release에 필요한 준비를 Makefile의 `release-prepare::` 규칙으로 선언합니다(K132).

### 소비자 이전

추가:
- sibling release의 checkout처럼 release에 준비가 필요한 저장소는 workflow의 단계 대신 Makefile의 `release-prepare::`로 이를 선언합니다.

## 0.0.39

- mise의 shim은 어느 작업 디렉터리에서든 checkout이 pin한 도구를 실행합니다: mise 환경이 checkout의 mise.toml을 global configuration으로 지정합니다(K127).
- 0.0.38의 원칙 검토(K129): stable release가 없는 Go module, npm advisory 범위, revision의 tracker는 빈 값으로 읽히는 대신 이름과 함께 보고되거나 실패합니다. 모든 npm workspace pattern을 읽고, go.work가 resolve하는 module에는 go.sum이 필요 없으며, PHP lint는 PHP를 선언한 저장소의 도구일 뿐이고, ts extractor는 standard library를 받으며, go.mod와 go.work는 tab으로 들여쓰고, 중첩된 test 실행의 실패한 case는 오류 전문과 함께 보고됩니다.
- status table, changelog section, release note, checklist, parity 산문을 mdast tree에서 읽습니다(K130).
- `@polyspec/kit`이 repository가 import하는 tool API를 export합니다: `tracked-files`, `test-hooks`, `test-progress`, `run-tests`, `holder-lock`, 그리고 optional peer `@vscode/test-electron`이 필요한 `install-vscode`(K79).
- kit이 자체 release installer로 설치하던 도구는 mise가 `mise.toml`에서 `mise.lock`의 digest로 설치합니다(K127): Go, Python, uv, ruff, alint, golangci-lint, deadcode, govulncheck, cargo-audit, Composer, vulture. bootstrap은 `packageManager`의 npm 다음에 `config/toolchain.json` `mise`의 sha256으로 mise를 설치하고, `make toolchain-lock`이 `mise.lock`을 쓰며, `make install-tools`는 `mise install --locked`를 실행한 뒤 wheel backend, Composer project, `exceptions`의 Rust channel을 설치합니다. kit.mk의 모든 recipe는 checkout의 mise 환경으로, 그 shim을 PATH 맨 앞에 두고 실행되며, checkout 밖은 아무것도 바뀌지 않습니다.
- check-toolchain은 `mise.toml`의 도구를 shim으로 실행하고, `mise.lock`이 모든 archive를 linux-x64와 macos-arm64의 sha256으로 고정할 것을 요구하며(`go:` 도구인 govulncheck와 deadcode는 Go의 checksum database로), `mise.toml`의 go와 python minor를 kit의 pin과 비교합니다(K127).

### 소비자 이전

처음 도입: `scripts/kit/kit-bootstrap.mk` 자체가 사본이므로 그것이 생기기 전에는 `make`가 실패합니다. `npm install`이 pin한 `@polyspec/kit`를 추가한 뒤 저장소 root에서 `node node_modules/@polyspec/kit/dist/kit-sync.mjs`를 한 번 실행하면 Makefile이 include하는 파일을 포함한 모든 사본을 씁니다. 그 뒤로는 `make kit-sync`를 씁니다.

추가:
- `config/dependency-policy.json`의 `advisoryExceptions`에 sprintf-js의 advisory 1241202. `@polyspec/kit`이 `@microsoft/api-extractor`를 거쳐 가져오며 어떤 release도 고치지 않습니다. kit이 스스로 선언한 reason과 removal condition을 씁니다.
- `config/toolchain.json` `mise`: kit이 선언한 대로 version과 platform별 archive의 sha256. `make install-tools TOOLS=npm`이 이를 설치합니다.
- 저장소가 설치하는 도구를 정확한 release로, Go와 Python은 kit의 pin으로 적은 `mise.toml`. 그다음 `make toolchain-lock`이 쓰는 `mise.lock`과, `pypi:` 도구가 있으면 `.mise/locks/`. Composer 같은 `http:` 도구의 `checksum`은 `mise.toml`에 선언합니다.
- `config/layout.yml`이 root 목록을 덮어쓰는 곳에 `mise.toml`, `mise.lock`, `.mise`.

변경:
- make를 실행하는 CI 단계에는 따로 PATH가 필요 없습니다. kit.mk가 `var/tools/bin`과 shim을 맨 앞에 둡니다. `make release-tools-path`는 mise의 환경도 `GITHUB_ENV`에 씁니다.

삭제:
- `config/toolchain.json`의 `python`, `pythonBuild`, `uv`, `ruff`, `vulture`, `alint`, `golangciLint`, `deadcode`, `composer`, `cargoAudit`, `govulncheck`, `go`; `.python-version`.
- `make install-tools` 뒤의 도구 이름. 이 target은 `mise.lock`의 모든 도구를 설치합니다.

증명: `make install-tools TOOLS=npm`, `make install-packages`, `make toolchain-lock`, `make install-tools`, 그다음 `make toolchain-check`가 통과합니다.

## 0.0.38

- kit은 npm package `@polyspec/kit`입니다. 저장소는 `make install-tools TOOLS=npm`과 `make install-packages`로 이를 설치하고, `scripts/kit/kit-bootstrap.mk`를 include하며, `kit.copies`의 파일만 사본으로 둡니다. `make kit-sync`가 설치된 package에서 이를 쓰고, `make kit-check`가 package-lock.json의 버전에 묶습니다(K71-2).
- kit의 tool과 test는 TypeScript(`.mts`)이며 tsc 7.0.2가 검사합니다(K71-1). 실행이 checkout을 바꾸면 `make kit-test`가 실패합니다(K71-2-1).
- kit의 tool은 재발명 대신 생태계 library를 씁니다: schema는 ajv, glob은 picomatch, TOML은 smol-toml, PEP 508은 pip-requirements-js, version은 semver와 @renovatebot/pep440입니다. Composer version은 composer 자체의 `latest-status`에서 오며, npm install-links 사본은 더 읽지 않습니다(K73, K100, K112–K116).
- 모든 kit tool은 `config/rebuild.json`에 분류되고, kit이 유지하는 tool은 `docs/rebuild/`에 rebuild 기록을 가집니다(K74).
- parity: runner test id에 대한 feature unit, runner별 고정 test 규약, test처럼 이름 붙은 파일의 bind 의무, profile 이유의 spec anchor, vitest runner, symbol 추출(Go, TypeScript, PHP, Python, 선언된 nightly의 Rust), case directory와 `.~` 단계, Markdown 목록과 prose 이름(K75, K42, K43).
- 모든 생태계의 lint 설정(phpcs PSR-12, phpstan 금지 호출, Composer policy, Rust workspace lint, gomoddirectives를 둔 golangci-lint, deadcode, TID251을 둔 ruff, vulture, tsgolint를 둔 oxlint, knip, API Extractor, `.editorconfig`). 고쳐진 release가 없는 advisory는 이유와 제거 조건을 적은 기록된 예외로만 받아들입니다(K77).
- check-toolchain은 kit이 내보내는 pin, pin과 같은 하한, scope·이유·재시도를 가진 선언된 예외, TypeScript pin, `.npmrc` link key를 검사하고, tool을 끝낸 signal의 이름을 댑니다(K78, K118).
- editor 경계 checker와 통합 test의 VS Code installer(K80).
- Markdown은 mdast와 micromark로 읽고, owner-check는 make의 database를 읽으며, pyproject pin은 toml-patch로 고치고, wheel metadata는 pip의 report에서 오고, govulncheck는 SARIF로 읽으며, 중복은 jscpd가 찾고, 쓰이지 않는 TAP reader는 지웠습니다(K120–K126).
- release coverage는 repository의 폴더를 가리키지 않는 `file:` dependency를 거부합니다. smoke의 archive를 가리키는 것은 npm release consumer project뿐입니다(K129).
- Node 26.11.1.

### 소비자 이전

추가:
- 이 release의 asset URL과 integrity로 pin한 devDependency `@polyspec/kit`, package.json과 package-lock.json에.
- Makefile의 `include scripts/kit/kit.mk` 대신 `include scripts/kit/kit-bootstrap.mk`.
- `make kit-sync`가 쓰는 사본: `scripts/kit/kit-bootstrap.mk`, `scripts/kit/bootstrap/`, `workflows/release.yml`, `PRINCIPLES.md(.ko)`, `config/layout.kit.yml`, `ruff.toml`, `phpcs.xml.dist`, `phpstan.dist.neon`, `.golangci.yml`, `.oxlintrc.json`, `knip.json`, `config/api-extractor.kit.json`, `.editorconfig`.
- 없으면 저장소 체크리스트의 `config/checklist.json`; Rust가 있으면 Rust pin의 `rust-toolchain.toml`.

변경:
- `.node-version` 26.11.1과 `engines.node` `>=26.11.1`; Composer `require.php` `>=8.5`와 `config.platform.php` `8.5`; `requires-python` `>=3.14`; toolchain 줄 없는 go.mod `go 1.27.2`; Cargo `rust-version` `1.99.0`; `typescript` `7.0.2`, 다른 version은 예외로 선언.
- `config/parity.json`: `symbols`는 `{ extractor, entry }`; 좁은 profile과 `nativeOnly` 항목은 `spec` anchor를 가집니다; Go나 PHP symbol을 추출하면 `config/toolchain.json`이 `symbolExtractors`를 적습니다.

삭제:
- vendored `scripts/kit/*`, `tests/kit/*`, `.kit/kit.lock.json`과 모든 `kit.json` 참조.
- `.npmrc`의 `install-links`와 `bin-links`; go.mod의 `replace`(형제는 go.work); 중첩된 ruff 설정.

증명: `make install-tools TOOLS=npm`, `make install-packages` 다음 `make kit-check toolchain-check layout-check documents-check owner-validate`가 통과합니다. 여전히 실패하는 검사는 저장소 체크리스트에 기록합니다.
