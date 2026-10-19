<!-- doc-id: agents -->
<!-- source-sha256: 127ad27cfa14f61c12cafa31874192f5227e25d5c9c3a36e78788bb3e725ef2c -->
# 개발

[English](AGENTS.md)

## 목적

kit은 모든 polyspec 저장소가 공유하는 도구를 담습니다. release, 의존성, push-gate, 문서, 설치 도구입니다. 저장소는 `scripts/kit/`와
`tests/kit/` 대신 package `@polyspec/kit`을 설치하고, 그 `package.json`의 `kit.copies`가 나열하는 파일의 사본을 byte 단위로 같게 두며, 사본은 `make kit-sync`가 씁니다. 저장소끼리 다른 것은
`config/*.json`뿐입니다. kit은 어느 저장소에도 의존하지 않습니다. kit은 모든 polyspec 저장소의 작업 원칙인 [PRINCIPLES.md](PRINCIPLES.md)와 그 한국어 쌍도 담아 같은 경로로 vendor하므로, 모든 저장소가
같은 원칙을 가집니다; 각 저장소의 AGENTS.md는 그것으로 link하고 자기만의 규칙만 적습니다. 아래 규칙은 kit 자신의 것입니다.

## 규칙

- 영어 문서가 정본입니다. 모든 문서에는 같은 정보를 담은 `.ko.md` 파일이 있으며, 두 파일을 한 변경에서 함께 고칩니다. 한국어 파일의
  개정 표식 `source-sha256`은 영어 파일의 sha256입니다. 한국어 문서는 기술 용어를 영어로 씁니다.
  Enforced by: `make documents-check`
- 도구는 Node 내장 모듈(`node:`), `scripts/kit/`의 파일, `package.json`의 `dependencies`가 선언한 package(각각 정확히 pin)와,
  `peerDependencies`가 선언하고 도구를 실행하는 저장소가 설치하는 optional peer(`install-vscode.mts`의 `@vscode/test-electron` 등)만
  import합니다. `scripts/kit/bootstrap/`의 module은 npm이 package를 설치하기 전에 실행되므로 Node 내장 모듈과 같은 디렉터리의 파일만
  import합니다. `tests/kit/isolation.test.mts`가 둘 다 강제하며, 어떤 도구도 쓰지 않는 선언된 package에서도 실패합니다. 쓴다는 것은 import하거나, 그 명령을 실행하거나(`lint-ts.mts`의 lint
  도구), 그렇게 쓰는 package의 peer로 필요한 것입니다.
  fixture와 `tests/kit/isolation.test.mts`를 뺀 어떤 도구나 테스트도 다른 저장소의 이름을 쓰지 않습니다. 저장소마다 다른 값은 `config/<name>.json`의 데이터이며, schema는 `scripts/kit/schema/`에 있습니다.
  schema는 ajv가 검증합니다(draft 2020-12, strict mode, 모든 error).
  Enforced by: `tests/kit/isolation.test.mts`
- vendored 파일은 kit에서 고치고 package-lock.json이 resolve하는 version의 사본을 쓰는 `make kit-sync`로 복사합니다. 저장소에서
  직접 고치지 않으며, 고치면 `make kit-check`가 바뀐 파일이나 빠진 파일로 실패합니다. `scripts/kit/`은 kit의 사본만 담으므로
  사본이 아닌 그 안의 파일에도 실패하며, `make kit-sync`가 그 파일을 지웁니다.
  Enforced by: `make kit-check`, `.claude/settings.json`
- [PRINCIPLES.md](PRINCIPLES.md)의 생태계 원칙을 kit의 도구에 적용합니다: Python interpreter, environment, lock은 uv, PHP 의존성은 Composer를
  쓰며, uv가 만드는 symbolic link 같은 그 도구 자신의 동작은 받아들입니다; 우리 규칙은 우리가 만드는 것을 다스립니다.
  Enforced by: `make rebuild-check`
- 이 저장소는 symbolic link를 만들지 않습니다: 추적 파일, configuration, script, generated output 어디에도 두지 않습니다. 단 하나의
  예외는 0.0.x 개발의 local link(`docs/operations/local-links.md`)입니다: polyspec root가 선언되면, 개발 checkout에 설치된 0.0.x
  polyspec package 폴더를 그 제공자 source로의 link로 바꿉니다. 이 link는 추적되지 않고 release output에 들어가지 않습니다. 이 저장소가
  쓰는 path는 명시된 기준(repository root, 또는 PEP 751의 lock directory처럼 그 형식이 정하는 기준)에 상대적이고, repository 안에
  머물며, working directory에 의존하지 않습니다. 절대 path는 쓰지 않습니다. repository root는 working directory가 속한 Git work tree의
  top level(`git rev-parse --show-toplevel`, `scripts/kit/paths.mts`의 `repositoryRoot`)이므로, `npm -w`가 package directory에서
  시작하듯 root 아래에서 시작한 도구도 repository의 path를 읽고 씁니다. work tree 밖에서는 root가 필요한 도구가 실패합니다. path는 추적 파일에 이름이 적힌 declarative 방식으로 정하거나, 명시된 discovery 규칙으로 찾습니다.
  외부 도구가 만드는 link는 위 규칙이 받아들이는 그 도구의 동작이며, 이 저장소가 만드는 것이 아닙니다.
  테스트는 link가 그 대상일 때만 link를 만듭니다(link를 거쳐 가리키는 path, link를 담은 archive). 테스트는 이 checkout의 도구를
  sandbox에 link하지 않고 sandbox에서 실행합니다(`tests/kit/kit-tools.mts`).
  Enforced by: `make kit-check`
- 두 도구가 필요로 하는 함수나 상수는 둘 다 import하는 `scripts/kit/`의 module 하나에 둡니다. `make duplication-check`(jscpd)는 6줄 이상의
  같은 부분이 두 번 있으면 실패합니다.
  Enforced by: `make duplication-check`
- 테스트는 `tests/kit/`에 있고, stub 명령과 fixture `tests/kit/fixture`로 오프라인에서 실행하며, 각 테스트는 동작이 깨지면 실패합니다. 결함은
  재현하는 실패 테스트를 먼저 추가하고, 고치고, 테스트를 유지합니다.
  stub은 stub이나 mise shim이 제공하는 명령(go, composer, npm, node, php, python, uv, mise)을 실행하지 않습니다. checkout 밖의
  shim은 PATH의 다음 명령을 실행하기 때문입니다. machine의 archiver는 허용됩니다(`tests/kit/stubs.test.mts`).
  Enforced by: `tests/kit/stubs.test.mts`
- 저장소는 설치하는 도구(Go, Python, uv, ruff, alint, golangci-lint, deadcode, govulncheck, cargo-audit, cargo-nextest,
  cargo-deny, Composer, vulture)를 `mise.toml`에 선언하고, `make toolchain-lock`으로 그 digest를 `mise.lock`에 쓰며, `make install-tools`로 설치합니다. 이
  target은 bootstrap의 mise로 `mise install --locked`를 실행합니다. `pypi:` 도구의 uv lock은 mise.lock이 가리키는 sidecar folder
  `.mise/locks/<tool>/<version>`입니다: kit이 쓰는 lock data이며 mise의 문서대로 mise.lock과 함께 track하고, Git이 track하지
  않으면 `make toolchain-check`가 실패합니다(K192). wheel을 배포하는 consumer는 config/toolchain.json에
  `pythonBackend`도 선언합니다. vendored test는 consumer의 선언을 이 규칙으로만 검사합니다. vendored dependency test는 go와 Composer를 실제 도구의
  기록으로 답하는 stub으로 읽으며, 실제 도구를 실행하지 않습니다. kit 자신의 실제 도구 test는 `tests/source`에 있습니다.
  kit-sync가 vendor하지 않으며, 고정한 도구를 실행하는 source test에는 먼저 `make install-tools`가 필요하고, `make
  source-test`가 실행하며 CI는 `make kit-test` 뒤에 실행합니다.
  Enforced by: `make toolchain-check`
- kit 자신의 검사는 kit pin에 맞춘 `mise.toml`의 도구를 쓰며, 이것들은 `make install-tools`가 var/tools/mise에 설치합니다.
  Rust는 `rust-toolchain.toml`의 것을 쓰고, `mise.toml`의 Node.js는 bootstrap(`make install-tools TOOLS=npm`)이 npm보다 먼저
  설치합니다(K171). kit.mk의 모든 recipe는 checkout의 mise 환경으로, var/tools/bin과 mise의 shim을 PATH 맨 앞에 두고
  실행되며, checkout의 도구를 이름만으로가 아니라 절대 경로(`$(NODE)`, `$(NPM)`, `$(ALINT)`)로 실행합니다: make 3.81은 shell
  문법이 없는 recipe 줄을 make가 시작할 때의 PATH에서 찾습니다. 그렇게 하지 않는 recipe는 `make kit-check`가 실패시킵니다. mise가 설치하지 않는 두 toolchain은 machine이나 CI runner가 제공합니다. `make install-tools`가
  rustup으로 `rust-toolchain.toml`의 toolchain을 그 component와 함께 설치하고(checkout에서 파일을 읽는 `rustup toolchain install`;
  rustup 1.28은 cargo가 처음 실행될 때 더는 설치하지 않습니다), config/toolchain.json `exceptions`가 선언한 Rust channel도
  설치합니다. rustup이 없으면 그 설치 방법과 함께 실패하고, `make toolchain-check`는 설치되지 않은 toolchain을 이름으로
  알립니다. PHP는 `.php-version`의 release이며(CI에서는
  install-tools 앞의 setup-php 단계), `make toolchain-check`가 이를 검증합니다.
  Enforced by: `make toolchain-check`, `make kit-check`
- 한 spec을 여러 implementation으로 가진 저장소는 그것을 `config/parity.json`에 선언하고, `parity-declarations-check`를 검사
  target에서, `parity-check`를 CI에서 실행하며, 둘 다 push가 반영되기 전에 실행합니다(docs/tool-inventory.md, Language parity).
  Enforced by: `make parity-declarations-check`
- 모든 검사는 같은 tree에 같은 결과를 냅니다. 도구는 임시 파일과 rename으로 쓰고, 단계마다 한 줄을 출력하며, 시간 제한이 없습니다. 테스트
  case는 자기 timeout을 가집니다. 네트워크 조회는 kit.mk가 ONLINE으로 표시한 target(`dependency-review`, `python-lock`,
  `install-tools`, `release-tools`, `release-backend`, `release-consumer-lock`, `release-proof`, `cargo-downloads-fetch`,
  `release-assets-fetch`)만 하고, 결과는 commit된 기록, var/tools의 설치, 또는 config/release-assets.json이 고정한 var/ 아래의 archive입니다.
  Enforced by: `make kit-test`
- dependency advisory는 갱신으로 고칩니다. 어떤 release도 고치지 않는 advisory는 `config/dependency-policy.json`의
  `advisoryExceptions` 항목이 이유와 제거 조건과 함께 받아들일 때만 받아들이며, review와 gate가 받아들였다고 출력합니다. 숨기지
  않습니다. kit은 자기 `package-lock.json`을 review합니다(docs/tool-inventory.md, Accepted advisories).
  Enforced by: `make dependency-policy-check`
- 하위 호환성은 유지하지 않습니다: 호환 layer, fallback, migration을 더하지 않고 옛 경로를 제거합니다.
  Enforced by: none, PRINCIPLES.md가 기술하는 설계 판단이며, K243이 이 사본을 제거합니다.
- 현재 요구를 완전히 충족하는 가장 단순한 구현을 씁니다. 불확실한 미래를 위한 추상화, 설정, 간접 계층을 두지 않습니다.
  Enforced by: `make lint-ts`
- 각 관심사를 자기 module에 분명히 분리한 modular component로 만듭니다.
  Enforced by: `make duplication-check`
- architecture는 장기적으로 정합니다: 지금은 동작하지만 나중에 교체해야 하는 임시방편은 받아들이지 않습니다.
  Enforced by: none, PRINCIPLES.md가 기술하는 설계 판단이며, K243이 이 사본을 제거합니다.
- 주석, 문서, commit message는 동작과 그 대상을 밝히는 직접적인 표현으로 씁니다.
  Enforced by: none, 직접적인 문장은 review의 판단입니다.

## 생성 파일

- 생성 파일은 Git에 추적하지 않습니다. 여기에는 의존성 설치(`node_modules/`, `vendor/`, 가상 환경), 빌드 산출물(`dist/`, `target/`, `*.tsbuildinfo`),
  캐시(`.cache/`, `__pycache__/`, `.pytest_cache/`), 테스트 실행 산출물(`test-results/`, `playwright-report/`, PHPUnit 캐시), 도구
  다운로드(`var/`)가 포함됩니다. 예외는 저장소가 의도적으로 필요로 하는 파일뿐이며 이것만 추적합니다: lock 파일(`package-lock.json`, `composer.lock`,
  `Cargo.lock`, uv lock, `mise.lock`), 이 문서가 밝히는 커밋된 생성 문서, 테스트 fixture. 각 `.gitignore`가 이 경로를 덮으며, 새 생성기는 같은 commit에서
  ignore 항목을 추가합니다.
  Enforced by: `.githooks/pre-commit`

## 릴리스

kit은 `main` commit의 annotated tag `vX.Y.Z`로 릴리스한다. 절차는
[docs/operations/release.ko.md](docs/operations/release.ko.md)이다.

- 릴리스 tag는 annotated이고, CI가 성공으로 끝났으며 consumer lock과 그 lock의 review를 가진 `main` commit 위에 있고,
  공개된 tag는 옮기지 않는다.
  Enforced by: `make release-verify`, `make dependency-policy-check`
- 릴리스는 그 proof가 consumer project에서 설치한 뒤에만 공개된다. 실패한 step은 draft로 남긴다.
  Enforced by: `make release-proof`, `make release-undraft`
- 모든 저장소는 vendor된 `workflows/release.yml`로 릴리스하며 그것을 편집하지 않는다.
  Enforced by: `make kit-check`
