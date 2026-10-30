<!-- doc-id: agents -->
<!-- source-sha256: 5e3016b0c841c817c83ee8a596a57187961d9ef2a3622f49113badd9453da6a5 -->
# 개발

[English](AGENTS.md)

## 목적

kit은 모든 polyspec 저장소가 공유하는 도구를 담습니다. release, 의존성, 문서, 설치 도구입니다. 저장소는 `scripts/kit/`와
`tests/kit/` 대신 package `@polyspec/kit`을 설치하고, 그 `package.json`의 `kit.copies`가 나열하는 파일의 사본을 byte 단위로 같게 두며, 사본은 `make kit-sync`가 씁니다. 저장소끼리 다른 것은
`config/*.json`뿐입니다. kit은 어느 저장소에도 의존하지 않습니다. kit은 모든 polyspec 저장소의 작업 원칙인 [PRINCIPLES.md](PRINCIPLES.md)와 그 한국어 쌍도 담아 같은 경로로 vendor하므로, 모든 저장소가
같은 원칙을 가집니다; 각 저장소의 AGENTS.md는 그것으로 link하고 자기만의 규칙만 적습니다. 아래 규칙은 kit 자신의 것입니다.

## 규칙

- Own: Kit 변경 요청은 GitHub issue에서 추적합니다. 각 issue에 구현 진행 상황, 검증 근거와 release 상태를 기록하고,
  명시된 acceptance 조건을 충족한 뒤에만 닫습니다.
  Enforced by: none, issue 갱신은 agent가 판단합니다

- Own: 영어 문서가 정본입니다. 모든 문서에는 같은 정보를 담은 `.ko.md` 파일이 있으며, 두 파일을 한 변경에서 함께 고칩니다. 한국어 파일의
  개정 표식 `source-sha256`은 영어 파일의 sha256입니다. 한국어 문서는 기술 용어를 영어로 씁니다.
  Enforced by: `make docs-check`
- Own: 도구는 Node 내장 모듈(`node:`), `scripts/kit/`의 파일, `package.json`의 `dependencies`가 선언한 package(각각 정확히 pin)와,
  `peerDependencies`가 선언하고 도구를 실행하는 저장소가 설치하는 optional peer(`install-vscode.mts`의 `@vscode/test-electron` 등)만
  import합니다. `scripts/kit/bootstrap/`의 module은 npm이 package를 설치하기 전에 실행되므로 Node 내장 모듈과 같은 디렉터리의 파일만
  import합니다. `tests/kit/isolation.test.mts`가 둘 다 강제하며, 어떤 도구도 쓰지 않는 선언된 package에서도 실패합니다. 쓴다는 것은 import하거나, 그 명령을 실행하거나(`lint-ts.mts`의 lint
  도구), 그렇게 쓰는 package의 peer로 필요한 것입니다.
  fixture와 `tests/kit/isolation.test.mts`를 뺀 어떤 도구나 테스트도 다른 저장소의 이름을 쓰지 않습니다. 저장소마다 다른 값은 `config/<name>.json`의 데이터이며, schema는 `scripts/kit/schema/`에 있습니다.
  schema는 ajv가 검증합니다(draft 2020-12, strict mode, 모든 error).
  Enforced by: `tests/kit/isolation.test.mts`
- Own: vendored 파일은 kit에서 고치고 설치된 package의 사본을 쓰는 `make kit-sync`로 복사합니다(npm ci가 package-lock.json의 version을 integrity로 설치합니다). 저장소에서
  직접 고치지 않으며, 고치면 `make kit-inject-check`가 바뀐 파일이나 빠진 파일로 실패합니다. `scripts/kit/`은 kit의 사본만 담으므로
  사본이 아닌 그 안의 파일에도 실패하며, `make kit-sync`가 그 파일을 지웁니다.
  Enforced by: `make kit-inject-check` (S13), `.claude/settings.json`
- Own: 일반적인 package manager 설치, dependency lock, version release를 따른다. 이를 벗어나는 요청은 명시적인 사용자 요청이라도 구현 전에 이탈 지점과 영향을 보고하고 정석적인 대안을 제시한다. 로컬 source link는 개발 수단으로 유지한다.
  Enforced by: none, 선택과 설명은 검토가 필요하다.
- Refines P14: [PRINCIPLES.md](PRINCIPLES.md)의 생태계 원칙을 `scripts/kit/`의 도구에 적용합니다: Python interpreter, environment, lock은 uv, PHP 의존성은 Composer를
  쓰며, uv가 만드는 symbolic link 같은 그 도구 자신의 동작은 받아들입니다; 우리 규칙은 우리가 만드는 것을 다스립니다. kit은 dependency 해석, link, 설치 record, 생성 metadata를 native package manager에 위임하며 직접 dependency 폴더를 교체하거나 설치 metadata를 합성하지 않습니다.
  Enforced by: `make rebuild-check`
- Own: 저장소는 uv를 `make uv-install`로 실행합니다. 이 target은 uv가 link를 거쳐 쓰고 지우므로(K539) uv가 쓰기 전에 uv가 쓸 environment의
  package link를 제거하고(`SYNC`의 `--project`, `--directory`, `--active`가 고르는 environment 포함), lock의 native locked 설치(`uv sync --locked`, 또는 pylock.toml의 `uv pip install`)를 `SYNC`의 flag 그대로 실행합니다. symlink된 개발 폴더는 손상되지 않습니다.
  Enforced by: `tests/kit/uv-install.test.mts`, `tests/source/uv-link-real.test.mts`
- Own: 추적되는 공유 root 파일과 workflow는 설치된 kit package의 일반 파일 사본이며 `make kit-sync`가 관리합니다. 소비자는
  `node_modules/@polyspec/kit/scripts/kit/kit-bootstrap.mk`를 include하며 첫 Make 실행 전에 lock에 고정된 npm dependency를 설치합니다.
  로컬 개발은 main checkout의 git-ignored `.links`가 한 줄에 하나씩 지정한 provider checkout을 link합니다. `make link`는
  그 패키지의 설치된 folder마다 provider로 가는 평범한 directory symlink 하나로 만듭니다(`docs/operations/local-links.md`, K869).
  이 link는 추적되지 않고 release output에 들어가지 않습니다. `.links`가 없으면 아무것도 link하지 않고 설치된 릴리즈가 실행됩니다.
  kit 자체는 자기 source를 실행하며 자기의 공개 package를 설치하지 않습니다. 이 저장소가
  쓰는 path는 명시된 기준(repository root, 또는 PEP 751의 lock directory처럼 그 형식이 정하는 기준)에 상대적이고, repository 안에
  머물며, working directory에 의존하지 않습니다. 절대 path는 쓰지 않습니다. repository root는 working directory가 속한 Git work tree의
  top level(`git rev-parse --show-toplevel`, `scripts/kit/paths.mts`의 `repositoryRoot`)이므로, `npm -w`가 package directory에서
  시작하듯 root 아래에서 시작한 도구도 repository의 path를 읽고 씁니다. work tree 밖에서는 root가 필요한 도구가 실패합니다. path는 추적 파일에 이름이 적힌 declarative 방식으로 정하거나, 명시된 discovery 규칙으로 찾습니다.
  외부 도구가 만드는 link는 위 규칙이 받아들이는 그 도구의 동작이며, 이 저장소가 만드는 것이 아닙니다.
  테스트는 link가 그 대상일 때만 link를 만듭니다(link를 거쳐 가리키는 path, link를 담은 archive). 테스트는 이 checkout의 도구를
  sandbox에 link하지 않고 sandbox에서 실행합니다(`tests/kit/kit-tools.mts`).
  Enforced by: `make kit-check`
- Own: `make install`은 `install-link`로 끝납니다. 이 target은 설치된 polyspec package를 개발 checkout에 link합니다
  (`docs/operations/local-links.md`). `make worktree-setup`은 행의 worktree를 만들고 거기서 `make install`을 실행한 뒤 link를
  검사하므로, worktree는 자기 자신의 checkout입니다(K858).
  Enforced by: `tests/kit/link.test.mts`, `tests/kit/worktree-setup.test.mts`
- Own: `config/owner-checks.json`은 각 추적 경로를 소유하는 검사를 지정하므로, branch의 변경은 그것을 소유한 검사가 검사합니다.
  `make land`는 바뀐 경로의 owner가 고른 gate를 실행합니다. `make owner-validate`는 어떤 owner도 갖지 않은 추적 경로와 존재하지 않는 검사를 지정한 owner를
  실패시킵니다.
  Enforced by: `make owner-validate`
- Refines P15: 두 도구가 필요로 하는 함수나 상수는 둘 다 import하는 `scripts/kit/`의 module 하나에 둡니다. `make duplication-check`(jscpd)는 6줄 이상의
  같은 부분이 두 번 있으면 실패합니다.
  Enforced by: `make duplication-check`
- Refines P19: 테스트는 `tests/kit/`에 있고, stub 명령과 fixture `tests/kit/fixture`로 오프라인에서 실행하며, 각 테스트는 동작이 깨지면 실패합니다. 결함은
  재현하는 실패 테스트를 먼저 추가하고, 고치고, 테스트를 유지합니다.
  stub은 stub이나 mise shim이 제공하는 명령(go, composer, npm, node, php, python, uv, mise)을 실행하지 않습니다. checkout 밖의
  shim은 PATH의 다음 명령을 실행하기 때문입니다. machine의 archiver는 허용됩니다(`tests/kit/stubs.test.mts`).
  Enforced by: `tests/kit/stubs.test.mts`
- Own: 저장소는 설치하는 도구(Go, Python, uv, ruff, alint, golangci-lint, deadcode, govulncheck, cargo-audit, cargo-nextest,
  cargo-deny, Composer, vulture)를 `mise.toml`에 선언하고, `make toolchain-lock`으로 그 digest를 `mise.lock`에 쓰며, `make install-tools`로 설치합니다. 이
  target은 bootstrap의 mise로 `mise install --locked`를 실행합니다. `pypi:` 도구의 uv lock은 mise.lock이 가리키는 sidecar folder
  `.mise/locks/<tool>/<version>`입니다: kit이 쓰는 lock data이며 mise의 문서대로 mise.lock과 함께 track합니다. 그것이
  없으면 `mise install --locked`가 스스로 실패하므로(K192) kit은 mise.lock을 검사하지 않습니다(K835). wheel은 uv build가 자기 pyproject.toml의 build-system.requires로
  build하며, kit은 build backend를 고정하지 않습니다(K788). vendored test는 consumer의 선언을 이 규칙으로만 검사합니다. vendored dependency test는 go와 Composer를 실제 도구의
  기록으로 답하는 stub으로 읽으며, 실제 도구를 실행하지 않습니다. kit 자신의 실제 도구 test는 `tests/source`에 있습니다.
  kit-sync가 vendor하지 않으며, 고정한 도구를 실행하는 source test에는 먼저 `make install-tools`가 필요하고, `make
  source-test`가 실행하며 CI는 `make kit-test` 뒤에 실행합니다.
  Enforced by: none, mise install --locked checks mise.lock and its sidecars itself (K835)
- Own: kit 자신의 검사는 kit pin에 맞춘 `mise.toml`의 도구를 쓰며, 이것들은 `make install-tools`가 var/tools/mise에 설치합니다.
  Rust는 `rust-toolchain.toml`의 것을 쓰고, `mise.toml`의 Node.js는 bootstrap(`make install-tools TOOLS=npm`)이 npm보다 먼저
  설치합니다(K171). kit.mk의 모든 recipe는 checkout의 mise 환경으로, var/tools/bin과 mise의 shim을 PATH 맨 앞에 두고
  실행되며, checkout의 도구를 이름만으로가 아니라 절대 경로(`$(NODE)`, `$(NPM)`, `$(ALINT)`)로 실행합니다: make 3.81은 shell
  문법이 없는 recipe 줄을 make가 시작할 때의 PATH에서 찾습니다. 그렇게 하지 않는 recipe는 `make kit-check`가 실패시킵니다. mise가 설치하지 않는 두 toolchain은 machine이나 CI runner가 제공합니다. `make install-tools`가
  rustup으로 `rust-toolchain.toml`의 toolchain을 그 component와 함께 설치하고(checkout에서 파일을 읽는 `rustup toolchain install`;
  rustup 1.28은 cargo가 처음 실행될 때 더는 설치하지 않습니다), config/toolchain.json `exceptions`가 선언한 Rust channel도
  설치합니다. rustup이 없으면 그 설치 방법과 함께 실패하고, 설치되지 않은 toolchain은 cargo가 실행될 때 rustup이 이름으로
  알립니다. PHP는 설치하지 않고 wrapper로 제공합니다(K283, K862):
  `.php-version`이나 config/toolchain.json `php`가 PHP를 선언하면 `make install-tools`가 PATH의 `php`를 그대로, 그 옆의
  php-config, phpize와 함께 var/tools/bin에 wrapper로 쓰고, release를 비교하지 않습니다. PATH에 php가 없거나
  `packages/php-ext`에 php-config나 phpize가 없으면 실패합니다. PHP가 필요한 저장소는 CI setup-php의 입력인 `.php-version`을
  둡니다. 이 파일이 없으면 setup-php는 조용히 다른 PHP를 설치합니다(K193).
  Enforced by: `tests/kit/install-rust.test.mts`, `tests/kit/install-tools.test.mts`, `tests/kit/install-php.test.mts`, `make kit-check` (phpVersionFinding, K193)
- Own: var/tools/bin의 도구는 설치된 파일을 이 checkout 설치의 environment(checkout의 mise data 폴더 같은)와 함께 절대 경로로
  실행하는 wrapper script이며, environment를 담지 못하는 symbolic link가 아닙니다. 한 checkout의 도구는 다른 checkout의 도구로
  실행되지 않습니다(`scripts/kit/bootstrap/tool-wrappers.mts`).
  Enforced by: `tests/kit/install-php.test.mts`
- Own: 한 spec을 여러 implementation으로 가진 저장소는 그것을 `config/parity.json`에 선언하고, `parity-declarations-check`를 검사
  target에서, `parity-check`를 CI에서 실행하며, 둘 다 push가 반영되기 전에 실행합니다(docs/operations/tool-inventory.md, Language parity).
  Enforced by: `make parity-declarations-check`
- Own: 모든 검사는 같은 tree에 같은 결과를 냅니다. 도구는 임시 파일과 rename으로 쓰고, 단계마다 한 줄을 출력하며, 시간 제한이 없습니다. 테스트
  case는 자기 timeout을 가집니다. 네트워크 조회는 make recipe가 `$(ONLINE)`으로 실행하는 명령(예: `install-tools`와
  `release-assets`의 명령)만 하고, 결과는 commit된 기록, 설치, 또는 저장소 자신의
  release archive입니다. kit은 다른 저장소의 package를 내려받지 않습니다(K865).
  Enforced by: `make kit-test`
- Own: dependency advisory는 갱신으로 고칩니다. npm audit, composer audit, cargo audit와 govulncheck가 오래되거나 취약한
  dependency를 보고하며, kit은 version을 비교하지 않고 그 기록도 두지 않습니다.
  Enforced by: none, native audit 도구가 advisory를 보고하고 갱신은 review의 판단입니다.
- Own: 주석, 문서, commit message는 동작과 그 대상을 밝히는 직접적인 표현으로 씁니다.
  Enforced by: none, 직접적인 문장은 review의 판단입니다.

## 생성 파일

- Own: 생성 파일은 Git에 추적하지 않습니다. 여기에는 의존성 설치(`node_modules/`, `vendor/`, 가상 환경), 빌드 산출물(`dist/`, `target/`, `*.tsbuildinfo`),
  캐시(`.cache/`, `__pycache__/`, `.pytest_cache/`), 테스트 실행 산출물(`test-results/`, `playwright-report/`, PHPUnit 캐시), 도구
  다운로드(`var/`)가 포함됩니다. 예외는 저장소가 의도적으로 필요로 하는 파일뿐이며 이것만 추적합니다: lock 파일(`package-lock.json`, `composer.lock`,
  `Cargo.lock`, uv lock, `mise.lock`), 이 문서가 밝히는 커밋된 생성 문서, 테스트 fixture, 그리고 consumer가 tagged tree 그 자체로 설치하는 생성 source(Go module, Rust crate)로서 `config/generated.json`의 `tracked`에 이유와 함께 선언된 파일(P34). 각 `.gitignore`가 이 경로를 덮으며, 새 생성기는 같은 commit에서
  ignore 항목을 추가합니다.
  Enforced by: `.githooks/pre-commit`

## 릴리스

kit은 release workflow가 `main`에서 성공한 CI run의 commit에 만드는 annotated tag `vX.Y.Z`로 릴리스한다. 절차는
[docs/operations/release.ko.md](docs/operations/release.ko.md)이다.

- Own: 릴리스 tag는 annotated이고, CI가 성공으로 끝난 `main` commit 위에 있으며, 공개된 tag는 옮기지 않는다.
  Enforced by: `make release-tag`
- Own: 릴리스는 archive와 함께 draft로 만들고 마지막에 공개한다. 실패한 step은 draft로 남긴다.
  Enforced by: `make release-publish`, `make release-undraft`
- Own: 릴리스는 성공한 CI run의 id만 받고(`gh workflow run release.yml -f run=<id>`) 다른 테스트를 돌리지 않는다.
  `make release-tag`는 RUN의 형식, config/release.json의 저장소, RUN이 `main` 위 ci.yml의 push 또는 dispatch run으로 성공해
  끝났고 그 commit이 `origin/main`에 있는지를 검사하고, 그 commit에 있는 config/release.json의 `changelog`가 가리키는 change log에서 가장 새로운 section `## X.Y.Z`로 버전을 읽은 뒤
  (그런 section이 없거나 `## Unreleased` 아래 항목이 있는 commit은 거부한다) 그 commit과 그 `goModules`의 module에 tag를 단다. version을 비교하지 않는다(S4, K911, K924).
  Enforced by: `tests/kit/release-run.test.mts`
- Own: 모든 저장소는 vendor된 `workflows/release.yml`로 릴리스하며 그것을 편집하지 않는다.
  Enforced by: `make kit-check`
