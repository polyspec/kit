<!-- doc-id: agents -->
<!-- source-sha256: 1af8ae1dcf376afabd0a476202d59a0ff2f541fb3b1ccaee2f0ebb24d8bd0b49 -->
# 개발

[English](AGENTS.md)

## 목적

kit은 모든 polyspec 저장소가 공유하는 도구를 담습니다. release, 의존성, push-gate, 문서, 설치 도구입니다. 저장소는 `scripts/kit/`와
`tests/kit/` 대신 package `@polyspec/kit`을 설치하고, 그 `package.json`의 `kit.copies`가 나열하는 파일의 사본을 byte 단위로 같게 두며, 사본은 `make kit-sync`가 씁니다. 저장소끼리 다른 것은
`config/*.json`뿐입니다. kit은 어느 저장소에도 의존하지 않습니다.

kit은 모든 polyspec 저장소의 작업 원칙인 [PRINCIPLES.md](PRINCIPLES.md)와 그 한국어 쌍도 담아 같은 경로로 vendor하므로, 모든 저장소가
같은 원칙을 가집니다; 각 저장소의 AGENTS.md는 그것으로 link하고 자기만의 규칙만 적습니다. 아래 규칙은 kit 자신의 것입니다.

## 규칙

- 영어 문서가 정본입니다. 모든 문서에는 같은 정보를 담은 `.ko.md` 파일이 있으며, 두 파일을 한 변경에서 함께 고칩니다. 한국어 파일의
  개정 표식 `source-sha256`은 영어 파일의 sha256입니다. 한국어 문서는 기술 용어를 영어로 씁니다.
- 도구는 Node 내장 모듈(`node:`), `scripts/kit/`의 파일, `package.json`의 `dependencies`가 선언한 package(각각 정확히 pin)와,
  `peerDependencies`가 선언하고 도구를 실행하는 저장소가 설치하는 optional peer(`install-vscode.mts`의 `@vscode/test-electron` 등)만
  import합니다. `scripts/kit/bootstrap/`의 module은 npm이 package를 설치하기 전에 실행되므로 Node 내장 모듈과 같은 디렉터리의 파일만
  import합니다. `tests/kit/isolation.test.mts`가 둘 다 강제하며, 어떤 도구도 쓰지 않는 선언된 package에서도 실패합니다. 쓴다는 것은 import하거나, 그 명령을 실행하거나(`lint-ts.mts`의 lint
  도구), 그렇게 쓰는 package의 peer로 필요한 것입니다.
  fixture와 `tests/kit/isolation.test.mts`를 뺀 어떤 도구나 테스트도 다른 저장소의 이름을 쓰지 않습니다. 저장소마다 다른 값은 `config/<name>.json`의 데이터이며, schema는 `scripts/kit/schema/`에 있습니다.
  schema는 ajv가 검증합니다(draft 2020-12, strict mode, 모든 error).
- vendored 파일은 kit에서 고치고 package-lock.json이 resolve하는 version의 사본을 쓰는 `make kit-sync`로 복사합니다. 저장소에서
  직접 고치지 않으며, 고치면 `make kit-check`가 바뀐 파일이나 빠진 파일로 실패합니다.
- [PRINCIPLES.md](PRINCIPLES.md)의 생태계 원칙을 kit의 도구에 적용합니다: Python interpreter, environment, lock은 uv, PHP 의존성은 Composer를
  쓰며, uv가 만드는 symbolic link 같은 그 도구 자신의 동작은 받아들입니다; 우리 규칙은 우리가 만드는 것을 다스립니다.
- 이 저장소는 symbolic link와 relative path를 만들지 않습니다: 추적 파일, configuration, script, generated output 어디에도 두지 않습니다.
  path는 추적 파일에 이름이 적힌 declarative 방식으로 정하거나, 명시된 discovery 규칙으로 찾습니다.
  외부 도구가 만드는 link는 위 규칙이 받아들이는 그 도구의 동작이며, 이 저장소가 만드는 것이 아닙니다.
  테스트는 link가 그 대상일 때만 link를 만듭니다(link를 거쳐 가리키는 path, link를 담은 archive). 테스트는 이 checkout의 도구를
  sandbox에 link하지 않고 sandbox에서 실행합니다(`tests/kit/kit-tools.mts`).
- 두 도구가 필요로 하는 함수나 상수는 둘 다 import하는 `scripts/kit/`의 module 하나에 둡니다. `make duplication-check`(jscpd)는 6줄 이상의
  같은 부분이 두 번 있으면 실패합니다.
- 테스트는 `tests/kit/`에 있고, stub 명령과 fixture `tests/kit/fixture`로 오프라인에서 실행하며, 각 테스트는 동작이 깨지면 실패합니다. 결함은
  재현하는 실패 테스트를 먼저 추가하고, 고치고, 테스트를 유지합니다.
- 저장소는 설치하는 도구(Go, Python, uv, ruff, alint, golangci-lint, deadcode, govulncheck, cargo-audit, Composer, vulture)를
  `mise.toml`에 선언하고, `make toolchain-lock`으로 그 digest를 `mise.lock`에 쓰며, `make install-tools`로 설치합니다. 이
  target은 bootstrap의 mise로 `mise install --locked`를 실행합니다. wheel을 배포하는 consumer는 config/toolchain.json에
  `pythonBackend`도 선언합니다. vendored test는 consumer의 선언을 이 규칙으로만 검사합니다. vendored dependency test는 go와 Composer를 실제 도구의
  기록으로 답하는 stub으로 읽으며, 실제 도구를 실행하지 않습니다. kit 자신의 실제 도구 test는 `tests/source`에 있습니다.
  kit-sync가 vendor하지 않으며, 고정한 도구를 실행하는 source test에는 먼저 `make install-tools`가 필요하고, `make
  source-test`가 실행하며 CI는 `make kit-test` 뒤에 실행합니다.
- kit 자신의 검사는 kit pin에 맞춘 `mise.toml`의 도구를 쓰며, 이것들은 `make install-tools`가 var/tools/mise에 설치합니다.
  Rust는 `rust-toolchain.toml`의 것을 씁니다. kit.mk의 모든 recipe는 checkout의 mise 환경으로, var/tools/bin과 mise의 shim을
  PATH 맨 앞에 두고 실행됩니다. mise가 설치하지 않는 두 toolchain은 machine이나 CI runner가 제공합니다. rustup이 그 channel을
  설치하고(`rustup toolchain install`), `make install-tools`를 통해 config/toolchain.json `exceptions`가 선언한 Rust
  channel도 설치합니다. rustup이 없으면 그 설치 방법과 함께 실패합니다. PHP는 `.php-version`의 release이며(CI에서는
  install-tools 앞의 setup-php 단계), `make toolchain-check`가 이를 검증합니다.
- 한 spec을 여러 implementation으로 가진 저장소는 그것을 `config/parity.json`에 선언하고, `parity-declarations-check`를 검사
  target에서, `parity-check`를 CI에서 실행하며, 둘 다 push가 반영되기 전에 실행합니다(docs/tool-inventory.md, Language parity).
- 모든 검사는 같은 tree에 같은 결과를 냅니다. 도구는 임시 파일과 rename으로 쓰고, 단계마다 한 줄을 출력하며, 시간 제한이 없습니다. 테스트
  case는 자기 timeout을 가집니다. 네트워크 조회는 kit.mk가 ONLINE으로 표시한 target(`dependency-review`, `python-lock`,
  `install-tools`, `release-tools`, `release-backend`, `release-consumer-lock`, `release-proof`, `cargo-downloads-fetch`)만
  하고, 결과는 commit된 기록이나 var/tools의 설치입니다.
- dependency advisory는 갱신으로 고칩니다. 어떤 release도 고치지 않는 advisory는 `config/dependency-policy.json`의
  `advisoryExceptions` 항목이 이유와 제거 조건과 함께 받아들일 때만 받아들이며, review와 gate가 받아들였다고 출력합니다. 숨기지
  않습니다. kit은 자기 `package-lock.json`을 review합니다(docs/tool-inventory.md, Accepted advisories).
- 하위 호환성은 유지하지 않습니다: 호환 layer, fallback, migration을 더하지 않고 옛 경로를 제거합니다.
- 현재 요구를 완전히 충족하는 가장 단순한 구현을 씁니다. 불확실한 미래를 위한 추상화, 설정, 간접 계층을 두지 않습니다.
- 각 관심사를 자기 module에 분명히 분리한 modular component로 만듭니다.
- architecture는 장기적으로 정합니다: 지금은 동작하지만 나중에 교체해야 하는 임시방편은 받아들이지 않습니다.
- 주석, 문서, commit message는 동작과 그 대상을 밝히는 직접적인 표현으로 씁니다.

## 체크리스트

`docs/plans/execution-checklist.ko.md`가 유일한 체크리스트입니다. 작업은 `[ ]` 대기, `[~]` 진행 중, `[o]` 완료, `[!] cause: <cause>; retry: <condition>`
우회, `[-] cause: <cause>` 불가입니다. 작업은 그것을 끝내는 commit에서, 소유 명령이 통과한 뒤 `[o]`가 됩니다. commit message는 `type(scope): Subject (#task)`이며
subject는 50자 이하, body는 72자로 줄바꿈하고, type은 `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`입니다.

## 릴리스

kit은 `main`의 commit 중 `ci` 실행이 success로 끝난 commit에 tag `vX.Y.Z`를 붙여 릴리스합니다. `package.json`이 tree의 버전을 가집니다. 저장소는
package-lock의 `@polyspec/kit`을 갱신하고 `make install-packages`와 `make kit-sync`를 실행해 릴리스를 채택합니다.

릴리스는 세 단계입니다. (1) commit `chore(release): Release X.Y.Z`가 `package.json`과 `package-lock.json`의 버전을 정하고
`CHANGELOG.md(.ko)`의 Unreleased 절을 `## X.Y.Z`로 바꿉니다. 이 commit은 `main`에 들어가고 CI가 success로 끝납니다. (2) 그
commit의 annotated tag `vX.Y.Z`를 push합니다. (3) push가 `.github/workflows/release.yml`을 실행합니다. 이 파일은 vendor되는
`workflows/release.yml` 그대로이며, `config/release.json`이 선언한 `@polyspec/kit`의 npm archive를 만들어 GitHub Release에
draft로 게시하고, 소비자 project에서 증명한 뒤 공개합니다. 저장소는 그 asset의 URL과 integrity를 pin합니다.

릴리스 tag는 annotated tag입니다: `git tag -a vX.Y.Z -m vX.Y.Z`로 만듭니다. `release-verify`는 object 종류
(`git cat-file -t <tag>`)가 `tag`가 아닌 tag를 거부하고, tag 이름과 그 종류를 적은 줄을 출력합니다(lightweight tag는 `commit`).
이미 게시된 tag는 옮기지 않으며, 검사는 릴리스되는 tag에만 실행합니다.

kit은 `workflows/release.yml`을 package.json의 `kit.copies`로 모든 저장소의 `.github/workflows/release.yml`에 vendor합니다. 저장소는 이를 편집하지 않으며, `make kit-check`가 차이를 실패시킵니다. workflow는 저장소가 `.php-version`을 선언하면 그 PHP를 설치하고, `make release-tools`(config/release.json이 필요로 하는 tool), `make release-tools-path`(뒤따르는 단계가 설치된 tool로 실행되도록 `var/tools/bin`과 mise의 shim을 그 PATH에, mise의 환경을 그 환경에 올립니다), `make release-publish`(draft release, 그 id를 `var/release/<tag>.json`에 기록), `make release-proof TAG=<tag>`(draft의 증명)를 실행하고, 증명이 통과한 뒤에만 `make release-undraft TAG=<tag>`로 release를 공개합니다. 증명과 undraft는 새 draft를 한동안 보여 주지 않는 release 목록의 tag가 아니라 그 id로 draft를 읽습니다. 실패한 step은 release를 draft로 남기고 run을 실패시키므로, 설치할 수 없는 release는 공개되지 않습니다.

kind `wheel` package(`pyproject.toml`을 가진 Python package)는 PEP 427 wheel `<distribution>-<version>-py3-none-any.whl`로 릴리스되며,
이 파일 이름을 pip이 파싱합니다. `release-assets`는 tag된 commit에서 이 wheel을 만들고, build backend는 config/release.json의
`buildBackend`가 정확한 requirement와 wheel의 sha256으로 고정합니다. `make release-backend`는 그 wheel을 digest를 확인하며
`var/tools/wheels`에 받고, 어떤 build도 network를 읽지 않습니다. wheel의 `Requires-Dist`는 plain `name==version`, polyspec package의 release asset을 sha256 fragment와 함께 직접 참조하는 형식, 또는 같은 release의 sibling(같은 config/release.json의 다른 wheel package)을 hash 없이 직접 참조하는 형식입니다.
앞의 두 형식은 wheel의 lock(`consumers.wheel.lock`)이 담으며, sibling은 lock이 담지 않습니다. 다른 형식(URL, git source, 범위, marker)은 거부합니다. 같은 형식의 npm 또는
Composer manifest를 거부하는 것과 같습니다(docs/tool-inventory.ko.md, Sibling wheels). `release-consumer`는 깨끗한 virtual environment에 lock을 hash와 함께 설치하고, release의
wheel들을 `--no-deps`로 함께 설치한 뒤 `pip check`를 실행하고, 그다음 smoke command를 실행합니다.
Python package는 git tag로 릴리스하지 않습니다.
