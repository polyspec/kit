<!-- doc-id: plan-kit-harness -->
<!-- source-sha256: a1b067836ae4129baed3e1a46258d87dbfed7fdff4948b686f8c28feac7cec64 -->
# 공통 규칙과 하네스로서의 kit

[English](plan.md)

## 목표
- kit은 족쇄가 아닌 하네스다. 모든 저장소에 공통인 규칙은 kit이 주입한다. 각 저장소는 자기 규칙을 스스로 정하고 지킨다.
- 하네스가 없으면 저장소마다 제각각이 된다. 그렇다고 모든 규칙을 kit에 두면, 저장소가 바뀔 때마다 kit을 고쳐야 한다.
- 각 저장소는 스스로 완결된 문서를 가진다. 그래서 PRINCIPLES를 각 저장소에 복사한다.
- 규칙을 강제하는 제한은 하네스다. 불필요한 간섭은 족쇄이고, 패키지 관리자의 일을 대신하는 것도 족쇄다.
- kit은 패키지 관리자가 아니다.
- 릴리스 때는 패키지 관리자가 명시된 버전을 설치한다. 개발도 같다. 다만 명시된 버전이 설치되었다고 가정하고, 그 설치 폴더를 개발 폴더에 심링크한다(2026-10-30).
- 심링크된 개발 폴더는 어떤 경우에도 망가뜨리지 않는다.

## 기준
- **kit이 주입하는 공통 규칙:** 모든 저장소에 같은 규칙이다. 조건부 규칙도 해당된다("PHP를 쓰는 저장소는 PSR-4를 따른다", "구현이 여럿인 저장소는 parity를 유지한다"). 조건을 만족하는 저장소는 모두 똑같이 지켜야 하기 때문이다. 조건은 여러 저장소가 공유하는 런타임이나 저장소 형태를 가리키며, 한 저장소의 도메인을 가리키지 않는다. 이를 각 저장소로 옮기면 복사본이 생기고, 복사본끼리 어긋나게 된다. 규칙은 `PRINCIPLES.md`에 있다. kit이 이를 각 저장소에 복사하고, 그 검사를 제공하며, `kit-gates`를 통해 모든 저장소에서 실행한다.
- **저장소 자체 규칙:** 그 저장소의 도메인에 관한 규칙이다. 그 저장소의 `AGENTS.md`에 `Own:` 규칙으로 있다(`scripts/kit/check-rules.mts:139,141`). 저장소가 대상을 구현하고, 그 대상을 자신의 `CHECK_TARGETS`와 CI에 나열한다. kit은 이 때문에 결코 바뀌지 않는다. `make rules-check`가 CI나 hook이 그 대상에 닿는다는 것을 증명한다.
- **하네스 부품:** 두 층이 함께 작동하게 하는 kit 코드다. 적힌 규칙이 이를 이름으로 지정해야 한다.
- **족쇄:** 어떤 규칙도 필요로 하지 않는 kit 코드이거나, package manager의 일을 하는 kit 코드다. 삭제한다.

## 사실 (근거는 table.md에 있다)
- PRINCIPLES 규칙 전부(P1–P38, S1–S11)는 위 기준에 따른 공통 규칙이다. 무조건이거나 조건부다(table.md, 표 2). 따라서 어떤 규칙도 PRINCIPLES 밖으로 옮겨지지 않는다.
- 두 층과 그 연결은 이미 존재한다:
  - `kit-gates`(`scripts/kit/kit.mk:203`)는 공통 검사의 명시적 목록이다.
  - CI 분할(`kit.mk:209-216`, `workflows/gates.yml`)이 이를 모든 저장소에서 실행한다.
  - `land.mts:123-125`, `bypass-check.mts:47`, `tests/kit/gates-workflow.test.mts:42`가 그 목록을 읽는다. 목록에는 kit 대상만 들어 있다.
  - 저장소 규칙은 각 `AGENTS.md`에 있으며, 저장소마다 `Enforced by` 줄이 9개에서 62개다.
- 주입은 강제되지 않는다. `PRINCIPLES.md:6-7`과 `AGENTS.md:35-37`은 바뀐 복사본이 실패한다고 말하지만, `kit-check.mts:4-5`(K799)는 복사본을 비교하지 않는다. kit-sync는 설치된 패키지로부터 복사본을 멱등하게 다시 쓴다(`kit-sync.mts:2-9`).
- kit은 다음 곳에서 package manager의 일을 한다:
  - **worktree-setup.** `worktree-setup.mts:36-160`이 npm, Composer, uv 설치를 직접 실행한다. 그다음 `worktree-setup.mts:258-265`가 저장소의 make 대신 kit의 `link rebuild`로 빌드하므로, 저장소의 생성 전제 조건이 건너뛰어진다(`fsm/Makefile:462-468`, fsm 세션이 보고한 대로).
  - **worktree 거부.** `kit-bootstrap.mk:46-48`과 `kit.mk:100-102`가 worktree에서 `make install`을 거부한다.
  - **link.** `link.mts:137,362`가 Go 0.0.x pin 규칙을 적용하고, `link.mts:246-253`(K401-1)은 uv lock을 읽어 다시 설치할 릴리스를 고른다.
  - **link-state-check.** `link-state-check.mts:149-170`이 어느 lock이 link나 경로를 기록하는지 판정한다. 소유자의 모델에서 dev link는 install 폴더 위의 symlink이며, lock은 바뀌지 않는다. 이는 composer와 uv에 대해 측정했다. 그러므로 이 검사가 판정할 것이 없다.
  - **toolchain-check.** 네 가지를 판정한다(`check-toolchain.mts:148-151,204-206`):
    - 도구가 있고 시작되는지. 이는 mise의 설치 결과다.
    - `.npmrc` 키
    - K192 uv sidecar. kit 자신의 `AGENTS.md:73-79` 규칙이다.
    - php-parser pin(`arginfoToolFindings`)
  - **install-php-arginfo.** `install-php-arginfo.mts:40-47`이 arginfo 출력을 대조하고 php-parser pin을 비교한다.
  - **kit-check.** `kit-check.mts:46-57`이 `.php-version`을 요구한다(K193). 이를 이름으로 지정하는 PRINCIPLES 규칙은 없다.
  - **lint-go.** `lint-go.mts:5-6`이 go.mod의 `replace`와 `toolchain`을 금지한다.
  - **cargo-downloads-check.** `check-cargo-downloads.mts:1-8`이 crate 존재 여부를 판정한다. ordered-json이 이를 쓴다.
- `catch-check`는 살아 있다(`lint-ts.mts:181`, `lint-rust.mts:37-47`). `check-editor-boundaries`도 살아 있다. 다만 이를 쓰는 것은 template뿐이다. template의 `editor-boundary-check`가 이를 실행하고(`template/Makefile:514-515`), `orm/docs/spec/editor-stack.md`가 이를 언급한다.
- `lint-rust --locked`는 cargo 자체의 플래그를 넘긴다. 판정은 cargo가 하고 kit은 하지 않으므로, 이는 package manager의 일이 아니다.
- `release-run.mts:46,54-56`은 릴리스 도구의 인자(버전 형식, SHA, run id)를 검사한다. 이는 입력 검증이지 간섭이 아니다.
- `worktree-setup`은 worktree를 만들거나 재사용한다(`kit.mk:440`, `worktree-setup.mts:5`).

## 결정
kit은 package manager가 아니다. kit은 다음 중 어느 것도 하지 않는다:
- 패키지를 설치, 갱신, 제거, pin, 해석하는 일;
- 버전, pin, lock 내용을 비교하는 일;
- 설치된 파일을 패키지와 대조하는 일;
- package manager의 설치를 거부하거나, 대체하거나, 감싸는 일. 다만 소유자의 규칙이 요구하는 경우는 예외다. symlink된 dev 폴더는 결코 훼손하지 않는다;
- 저장소 자체의 make 대신 빌드하는 일.

kit은 package manager나 도구를 얇은 recipe로 호출할 수 있다(`mise install --locked`, `mise lock`, rustup, `cargo fetch`, 가드된 `make uv-install`). 그리고 자신의 플래그(cargo `--locked`)를 넘길 수 있다. 이 경우 판정은 도구가 하고, kit은 결과를 읽지 않는다. 소유자의 말에 따른 모델은 이렇다. 개발은 install 폴더를 dev 폴더로 symlink하며 아무것도 내려받지 않는다. 릴리스는 package manager가 명시된 버전을 직접 가져오게 한다. kit은 패키지를 내려받지 않는다.

1. **공통 harness로 유지한다.**
   - PRINCIPLES와 그 복사본
   - 명시적 목록인 `kit-gates`와 CI 분할
   - gates.yml과 release.yml 복사본
   - `rules-check`, `catch-check`, `owner-validate`
   - kit-sync
   - `link`(link, check)와 `install-link`
   - `link-check`. 항목 6의 삭제 뒤에 폴더 동일성만 판정한다. 각 install 폴더가 link 선언(항목 8)대로 dev 폴더로 가는 symlink인지 확인한다. P30과 S11은 Enforced by를 `make link-check`로 바꾸고, 그 본문(`PRINCIPLES.md:147`, `:245`, 한국어 쌍 포함)도 같은 행에서 `link-check`를 이름으로 든다. 파일 내용도 버전도 읽지 않는다. `link-state-check`는 남은 폴더 검사와 겹치므로 여기에 합쳐져 삭제된다.
   - `worktree-link-state`. `link-state-check` 대신 `link-check`를 호출한다(`kit.mk:444`, `worktree-setup.mts:258`).
   - `release-run` 인자의 형식 검증
   - `lint-rust --locked`. table.md의 lint-rust 행 (c)는 "passes cargo's flag; kit reads no lock"으로 고쳐 쓴다.
   - `bootstrap/tool-wrappers.mts`

   조정자는 앞서 분할과 gates.yml 복사본을 삭제하라고 판정했다(class F). 이 판정은 뒤집는다. 이것들이 없으면 모든 저장소가 자기 CI harness를 다시 만들고, 저장소들이 서로 달라진다.
2. **symlink된 dev 폴더는 결코 훼손하지 않는다.** 이는 소유자의 말에 따른 공통 규칙이며, 새 PRINCIPLES 규칙이 이를 명시한다.
   - 이 규칙의 harness는 K539 가드다. 측정 결과 uv uninstall, remove, `sync --no-install-package`는 link를 통해 삭제한다. npm ci는 link를 교체하지만 dev 폴더는 그대로 둔다. composer install은 link를 유지한다. 그러므로 uv 호출만 가드한다.
   - `unlink`는 `releaseLinks`(`link.mts:232-234`)로 줄어든다. link만 제거한다. `install`의 전제 조건으로 만들지 않는다. 새 checkout에서는 node가 아직 없고(`kit.mk:55-61`), `uv-install.mts:41`이 이미 uv 쓰기 전마다 link를 먼저 해제하기 때문이다.
   - 저장소 recipe는 `make uv-install`을 통해 uv를 호출한다. 이것이 가드된 진입점이다(`uv-install.mts:41`). 현재 SYNC는 `--no-install-project`와 `--all-groups`만 허용한다(`uv-install.mts:10,78-79`). 또 SYNC를 공백으로 나누어 토큰마다 검사하므로(`:76-78`), `--group test`나 `--project packages/python`의 값은 거부된다. `--locked`는 이미 내부에서 전달된다. 이 행은 SYNC를 플래그와 값의 쌍으로 파싱하고, consumer가 쓰는 플래그를 추가한다: `--no-editable`, `--group <name>`, `--all-packages`, `--project <dir>`, `--quiet`. `kit.mk:466` 도움말도 따라 바뀐다.
   - red 테스트: crudui `Makefile:173`, orm `Makefile:751`, hyper `Makefile:116`의 정확한 SYNC 문자열로 `make uv-install`을 실행한다. 이는 `install-link` 뒤에 실행되며, dev 폴더를 바이트 단위로 동일하게 둔다. 저장소 recipe에 날것의 `uv sync`가 있으면 검사가 실패한다.
   - 이 규칙의 Enforced by는 `tests/kit/uv-install.test.mts`와 `tests/source/uv-link-real.test.mts`를 이름으로 든다.
3. **주입.**
   - `make kit-inject-check`는 `make kit-sync`를 실행한다. 그다음 복사 경로에 대해 `git status --porcelain --untracked-files=all`이 무엇이든 출력하면 실패한다. Red: 현재 트리에는 `kit-inject-check`가 없으므로, fixture consumer에서 손으로 고친 복사본이 발견되지 않는다. 새 대상은 이 경우에 실패해야 한다. Green: 대상이 실패하고, 같은 트리는 `make kit-sync` 뒤에 통과한다.
   - 이 대상은 consumer의 gates에만 들어간다. `kit.mk`의 `$(if …)` 가드가 kit 자신의 checkout을 건너뛴다. kit-sync가 이를 거부하기 때문이다(`kit-check.mts:122-124`).
   - 이 대상은 `make kit-sync`를 실행한다. 이 명령은 `node_modules` 아래 설치된 kit 패키지의 복사본(PRINCIPLES, gates.yml, release.yml)을 쓰고, 그다음 복사 경로에 대해 git이 보고하는 것이 무엇이든 실패한다. 버전도 lock도 읽지 않는다. 이것이 주입 규칙의 harness다.
   - 한국어 쌍과 함께 새 PRINCIPLES 규칙 항목이 다음을 말한다: "common rules are injected identically; Enforced by: `make kit-inject-check`". `PRINCIPLES.md:6-7`은 서문이라 이 줄을 담을 수 없다. `AGENTS.md:35-37`은 새 대상을 가리키도록 바꾼다.
4. **멱등성(P17).** 한 트리에서 `make install`을 두 번 실행해도 어떤 파일도 바뀌면 안 된다. `bootstrap/verify-idempotent.mts`는 mtime과 inode를 비교한다(`:12-22`). 따라서 relink는 항상 변경으로 보고된다. 증명은 kit 코드가 아니라 `tests/kit` 아래의 테스트가 한다. 이 테스트는 fixture에서 `make install`을 두 번 실행하고 `var/tools`와 install 폴더의 내용을 비교한다. Red: 두 번째 설치가 `var/tools`의 파일을 다시 쓰는 fixture는 현재 트리에서 테스트에 실패한다. Green: 수정으로 테스트가 통과한다. lock은 제외한다. 그 내용은 package manager의 것이기 때문이다. P17의 Enforced by가 이 테스트를 이름으로 든다.
5. **harness 부품마다 규칙에 이름을 붙인다.**
   - 남기는 부품은 모두 규칙에 이름이 있다. Red: 어떤 규칙도 이름으로 지정하지 않은 남긴 부품은, `gates-workflow.test.mts`의 새 단언을 실패하게 한다. 이 단언은 순서 3의 `kit-gates` 전제 조건뿐 아니라 남긴 부품을 각각 이름으로 나열한다. Green: 각 부품이 이름으로 지정되면 통과한다. `owner-validate`, `install-link`, `catch-check`(P8 아래), release-run 인자 검사, `bootstrap/tool-wrappers.mts`, `worktree-link-state`, `uv-install`은 각각 kit AGENTS 규칙이나 Enforced-by 항목을 받는다. `gates-workflow.test.mts`의 단언은 owner-validate 규칙과 같은 행에 들어간다.
   - `.php-version` 요구는 `AGENTS.md:93`(K283) 아래에 남는다. install-php는 이 파일을 선언된 PHP로 읽는다.
   - S4는 다음과 같이 고쳐 쓴다: "kit compares and pins no version or lock; format validation of arguments is allowed". 강제 수단은 `Enforced by: none`이며, 이유를 함께 적는다.
6. **족쇄를 삭제한다.** 각 항목은 별도 행이다. 각 행은 자기 red 테스트(삭제되는 동작이 아직 있음을 보여 주는 것)와 green(행의 테스트가 항목을 뺀 뒤 통과하는 것)을 이름으로 든다.
   - **버전, pin, lock 판정.** 소유자의 직접 판정에 따라 kit 행으로 진행 중이다:
     - toolchain-pins와 toolchain-exceptions
     - toolchain-lock은 스크립트 없이 make recipe 안의 mise 명령만으로 바꾸고, kit은 결과를 읽지 않는다. 호출, 순서, PATH, uv의 Python, 플랫폼은 kit 행 K836이 실측한 red 사례(uv가 자기 Python이나 기계의 uv로 해석함)로 정한다.
     - toolchain-mise의 lock, pin, 정확한 릴리스, K192 sidecar 검사
     - toolchain-lint의 lock 형식
     - install-php-arginfo의 pin 비교와 출력 대조(`:40-47`)
     - link-state-check의 lock 판정(`:149-170`)
     - toolchain-mise가 kit이 모르는 mise.toml 키를 거부하는 것(`toolchain-mise.mts:100`). mise가 자기 설정을 판정한다. `MISE_TOOLS` 표는 남는다. install-tools, install-symbols, recipe-tools, toolchain-lock, ci-setup의 도구 목록이기 때문이다.
     - Rust 채널 형식 검사(`toolchain-files.mts:85`). rustup이 채널을 판정한다

     Rust 채널은 rust-toolchain.toml의 평범한 선언값으로 읽는다. `declaredRust`는 형식 검사 없이 원래 문자열을 반환한다(`toolchain-files.mts:85` 삭제). `check-toolchain.mts:23`은 toolchain-check와 함께 제거된다. `install-tools.mts:31`은 원래 문자열을 rustup에 넘기고, `ci-setup.mts:15`는 형식 검사 없이 이를 CI 값으로 내보낸다(`ci-setup.mts:94`). Red: `channel = "nightly"`는 오늘 kit에서 실패한다. Green: kit 오류 없이 rustup에 도달한다.
   - **`toolchain-check` 전체.** 도구가 checkout에서 실행되는지 본다. 이는 설치 상태를 확인하는 검사다. 도구가 없으면 저장소의 make가 어차피 실패한다. bare-name 규칙은 이미 kit-check의 것이다(`kit-check.mts:1-8`).
     - 도구 목록은 이미 `toolchain-mise.mts`의 `MISE_TOOLS`에 있다. 어떤 행도 이를 옮기지 않는다.
     - kit 자신의 CI, gates, 테스트, 규칙도 같은 행에서 이를 뺀다. 여기에는 S4, kit AGENTS.md:73-79와 :89-93(각각 새 Enforced by를 받거나, check-rules.mts:271-274가 요구하는 대로 이유와 함께 `none`을 받는다), `config/owner-checks.json:45`, kit CI의 `install-tools TOOLS=…` 호출(`ci.yml:177-200,241-262`)이 포함된다. 이 호출은 명시적인 얇은 대상으로 옮긴다.
     - `.npmrc` 키 검사(`npmrcFindings`)도 함께 빠진다. `docs/operations/tool-inventory.md:148`은 같은 행에서 다시 쓴다.
     - 조정자는 4차 라운드에서 이를 남겨 두었고, 지금은 삭제한다. 4차 라운드의 이유는 깨짐이었다. 유지되는 도구 목록(`MISE_TOOLS`)과 consumer 단계가 그 깨짐을 없앤다.
   - **설치된 배포본에서 읽는 Python 공개 심볼.** 이는 `parity-symbols.mts:4,75-80`의 RECORD 읽기다. 소스 패키지를 읽는 방식으로 대체한다.
   - **link 자체의 package manager 작업.**
     - Go pin 규칙(`link.mts:137,362`)
     - `unlink`의 재설치: `:533`, `:542`, `:561`, `:569`, 그리고 `pylockReleases`(`:246-253`)
     - `cargo update --offline`(`:663`)
     - `link rebuild`
   - **worktree-setup의 설치와 빌드.**
     - `prepareWorktreeNpm`, `prepareWorktreeComposer`, `prepareWorktreePython`, `prepareWorktreeGo`(`:36-229`)
     - 그 `link rebuild` 단계(`:258-265`)

     worktree-setup은 여전히 명명 규칙(`PRINCIPLES.md:45`)에 따라 worktree를 만들고, 그 안에서 `make install`을 실행한다. release asset은 링크하지 않는다(K865가 `linkReleaseAssets`를 삭제한다).
   - **worktree의 `make install` 거부**(`kit-bootstrap.mk:46-48`, `kit.mk:99-102`).
     - `KIT_TOOLS`는 checkout 자신의 `$(CURDIR)/var/tools`가 된다(`kit.mk:19`). 지금은 main의 것이다. worktree의 `make install`은 온라인으로 실행되며, 소유자의 판정에 따라 자기 도구를 설치한다. `kit.mk:440` 도움말도 따라 바뀐다.
     - K519 주석과 `docs/operations/local-links.md:64`도 따라 바뀐다.
     - red 테스트: worktree의 `make install` 뒤에도 main의 `var/tools`와 lock이 바뀌지 않는다.
   - **kit 자신의 설치 래퍼.**
     - `npm-install`과 쓰이지 않는 `ADD`(K485). 어떤 consumer도 이를 넘기지 않는다.
     - `composer-install`과 `cargo-fetch`
     - 그 `.mts` 스크립트와 테스트

     현재 `ci-setup.mts`는 `composer-install`(`:214`)과 `uv-install`(`:219`)을 내보낸다. 그다음 `make deps-<runtime>`(`deps-php`, `deps-python`, `deps-node`, `deps-rust`, `deps-go`)을 내보내며, 각 저장소는 이 대상을 자기 Makefile에서 얇은 package manager 호출로 정의한다. 따라서 각 분할 작업은 자기 도구만 설치한다(`kit.mk:207-208`). ci-setup의 나머지(410줄)는 자기 행을 가지며, 기준에 따라 항목별로 판정한다.
   - **install-tools 자체의 설치**(`install-tools.mts:90-110`). Composer, Rust, symbol, arginfo 설치는 얇은 호출로서 저장소의 `make install` 전제 조건 뒤로 옮긴다. `mise install --locked`는 남긴다.
   - **`install-php`의 PATH, apt, Homebrew 탐색.** 선언된 minor의 `php`를 PATH에서 요구하며, 없으면 실패한다. 래퍼는 남는다.
   - **`bootstrap/install-mise.mts`.** mise의 공식 설치기가 된다. 다만 red 사례가 공식 설치기로는 그 일을 할 수 없음을 보이면 예외다.
   - **`cargo-downloads-check`의 확인 모드.** crate 존재 여부를 확인한다. `cargo-downloads-fetch`(`check-cargo-downloads.mts:5-8,16`, `kit.mk:82-86`)는 얇은 `cargo fetch`로 남는다. kit CI가 이를 쓰기 때문이다(`ci.yml:45,203,268`).
   - **kit 자신의 패키지 내려받기:** `release-assets-fetch`, `var/products`, 그것이 채우는 Composer `artifact` 저장소, worktree-setup의 `linkReleaseAssets`(K622/K780, `kit.mk:411-414`). 개발은 symlink를 쓴다. 릴리스에서는 Composer가 `composer` 타입 저장소에서 가져온다. 각 릴리스는 `packages.json` asset을 게시한다. 이 파일은 패키지 자체의 composer.json에 zip URL과 sha1을 더해 생성하며, consumer의 composer.json은 `https://github.com/polyspec/<repo>/releases/download/<tag>/packages.json`을 가리킨다. Composer는 경로에 `.json`이 들어간 URL을 그대로 사용한다(Composer 2.10.3, `getPackagesJsonUrl`). Composer가 패키지 메타데이터를 직접 읽으므로, consumer는 메타데이터가 아니라 그 URL의 태그만 다시 적는다(`package` 저장소는 메타데이터를 다시 적는다. `hyper/tests/scripts/template-pins.test.mts:82-84` 참고). hyper는 `composer` 타입 저장소만 출하하며, 그것도 template이 `packages.json`을 게시한 뒤에만 한다. 중간의 `package` 저장소는 릴리스하지 않는다.
   - **Hyper 자신의 template PHP 확장 빌드**(`hyper/scripts/build-template-ext.mts`: phpize, configure, make, stamp). PIE가 하는 일을 다시 만들고 있다(P14). PIE는 위의 Composer 소스에서 이를 설치한다(`template/packages/php-ext/composer.json`은 이미 `type: php-ext`다). ordered-json이 이미 그렇게 하는 것과 같다(`ordered-json/Makefile:92-93`). 개발에서는 확장 소스를 link 선언을 통해 링크한다. PIE가 로컬 폴더에서 빌드할 수 있는지는 먼저 검증한다. 할 수 없으면 개발에서는 소스 폴더를 링크한다.
   - **go.mod의 `replace`/`toolchain` 금지**(`lint-go.mts:5-6`).
   - **`check-editor-boundaries`.** template 자신의 규칙이므로 template으로 옮긴다. template의 행은 스크립트와 그 테스트를 template으로 옮기고, `editor-boundary-check`가 이를 가리키게 한다. 그다음 kit은 자기 복사본, `config/rebuild.json:65`, `tests/kit/editor-boundaries.test.mts`, `docs/operations/tool-inventory.md:1518`을 삭제하며, orm의 `docs/spec/editor-stack.md` 참조도 따라 바뀐다.
7. **동시 항목 ID.** `make item-new`(`plan.mts:146-170`)는 main이나 worktree가 이미 가진 ID를 거부한다. Red: 두 worktree가 같은 ID를 고르면 두 번째 `make item-new`가 성공한다. Green: 두 번째 호출은 실패하고, 새 ID는 성공한다. `check-commits.mts:71`과 같은 방식으로 main의 체크리스트를 읽는다. 동시에 일어나는 경합은 land 시점의 docs-check가 여전히 잡는다.
8. **link 선언 하나(소유자의 제안).** 경우마다 복사, 링크, 설치를 따로 하면 template 같은 결함이 계속 생긴다. git-ignore되는 설정 하나를 두고, 그것을 멱등하게 검사하는 방식으로 대체한다.
   - checkout마다 git-ignore되는 파일이 하나 있다. 평문이며, 줄마다 provider checkout 경로 하나를 적는다. 상대 경로는 이를 선언한 checkout의 루트를 기준으로 해석한다. 이 파일이 개발 링크의 유일한 선언이다.
   - 이 파일은 sibling 자동 탐색을 대체하므로, 옆에 두 번째 선언이 되지 않는다. 개발 폴더가 소비자 옆에 있다고 가정하지 않는다.
     - 자동 탐색(`siblingCheckouts`, `link-providers.mts:145`; `install-link`은 `link --siblings`를 실행한다, `kit-bootstrap.mk:38-40`)은 디스크 배치로부터 dev 폴더를 짐작한다. 상위 폴더를 workspace로 잡고, 폴더 이름을 `github.com/polyspec/<name>`과 맞춰 보며, `forks/`에 대한 특수 처리를 추가한다.
     - 이 짐작은 이미 깨져 있다. limepie는 polyspec의 sibling이 아니므로 `POLYSPEC=<path>`를 대신 넘기는데, 이것이 두 번째 메커니즘이다. worktree는 main checkout 옆에 놓이며, 명명 규칙으로만 걸러진다.
     - 자동 탐색, `forks/` 특수 처리, limepie의 `POLYSPEC=` 변수는 모두 파일로 대체하며 삭제한다. 파일은 provider 경로를 명시적으로 나열한다.
     - 자동 탐색을 쓰는 현재의 모든 호출처는 각각 한 행에서 파일로 옮긴다:
       - `link.mts cargo --siblings`(`link.mts:899-900`): orm `Makefile:205,2022,2894,2907`, ssr `Makefile:113`;
       - hyper의 하드코딩된 `CHECKOUTS=… ../template ../forks/…`(`hyper/Makefile:127-128`)와 `npm-install`에 넘기는 위치 인자 checkout(`:183`);
       - `composer-install.mts:49`, 이는 `siblingCheckouts`로 대체된다(`composer-install`과 함께 삭제된다);
       - K440 workspace Claude hook. 이는 `--siblings`에서만 쓰인다(`link.mts:874`). `make link`는 파일이 있으면 언제나 이를 쓰며, kit AGENTS 규칙이 이를 이름으로 든다;
       - `--siblings`를 단언하는 테스트: `template/tests/scripts/toolchain-files.test.mts:298`, `crudui/tests/build/ci-local.test.mts:785`;
       - `POLYSPEC=`을 넘기는 limepie의 Makefile들. limepie 자신의 채택 행에서 다룬다.
     - 파일이 없으면 아무것도 링크하지 않는다. 그것이 릴리스 상태다.
   - kit은 `link-providers.mts`가 오늘 하듯 manifest로부터 install 폴더를 유도한다.
   - `make link`는 이 파일을 멱등하게 적용한다. `make link-check`는 파일과 상태만 비교한다:
     - 선언된 각 폴더는 자기 provider를 가리키는 symlink다;
     - 선언되지 않은 link가 없다;
     - 파일이 없으면 어떤 install 폴더도 link가 아니다.
   - worktree는 main의 파일을 `$(KIT_MAIN_CHECKOUT)/<file>`(`kit.mk:18`)에서 읽는다. 읽기 전용이다. 복사하거나 쓰지 않는다.
   - package manager는 건드리지 않는다. kit은 install 위에 link를 놓고 검사할 뿐이다. `AGENTS.md:47`의 규칙(네이티브 npm link, Composer path 저장소, uv editable 설치)은 같은 행에서 선언 파일을 이름으로 든다도록 다시 쓰며, `docs/operations/local-links.md`도 따른다. 이것은 설치를 건너뛰던, 거부된 marker 설계가 아니다.
   - red 테스트:
     - `make link`는 선언된 link만 정확히 만들며, 두 번째 실행은 아무것도 바꾸지 않는다(readlink와 inode로 비교);
     - 선언되지 않은 link는 실패한다;
     - 선언된 복사본은 실패한다;
     - 파일이 없으면 어떤 link든 실패한다;
     - worktree는 main의 파일을 읽는다.
9. **저장소의 CI는 공통 gates를 다시 실행하지 않는다(소유자의 지시: 병렬 설계로 CI 시간을 줄인다).** 한국어 쌍과 함께 새 PRINCIPLES 규칙은 `kit-gates` 전제 조건(`kit.mk:203`)을 읽는 kit 대상이 강제한다. Red: 현재 트리에는 이를 검사하는 대상이 없으므로, `gates.yml`이 아니면서 `kit-gates` 전제 조건을 이름으로 든 fixture workflow와, 하나를 이름으로 든 `ci-targets` 입력이 검사되지 않은 채 지나간다. 새 대상은 둘 다에서 실패해야 한다. Green: 둘 다에서 대상이 실패하며, 각 consumer는 채택 행에서 중복을 제거한 뒤 통과한다. 이 대상은 `gates.yml`이 아닌 어떤 workflow, 또는 `ci-targets`나 `ci-setup`이 읽는 어떤 파일(예: `template/config/ci.json`)이라도 그중 하나를 이름으로 들면 실패한다. kit 자신의 `ci.yml`은 예외다. kit에는 gates.yml 복사본이 없고, 분할이 실행되는 곳이 `ci.yml`이기 때문이다(`ci.yml:53,61,95,108,112,139`). 중복은 오늘도 존재한다:
    - orm `ci.yml:213-226`, `Makefile:257,268` 포함
    - hyper `ci.yml:40,71`
    - ordered-json `ci.yml:75,136`
    - crudui `ci.yml:69,122,128`
    - template `ci.yml:63`

    각 consumer는 자기 채택 행에서 중복을 제거한다. fsm `ci.yml:76`은 전체 `make check`를 실행한다. 이는 자기 스위트이며, 자기 행에서 판정한다.
10. **낡은 문구를 고친다.** 삭제된 대상의 주석이나 설명은 그 대상의 행에서 제거한다. `kit.mk:92-93`과 `kit.mk:113`은 toolchain-check 행에서, `kit.mk:475`는 unlink 설명 행에서 제거한다. Red: `text-absent`(P19)이 옛 문장을 찾는다. Green: 아무것도 찾지 못한다.

## 순서
1. 적대적 감사(adversarial audit)를 거쳐 이 계획에 합의한다. 소유자의 판정은 각각 날짜와 함께 이 파일에 기록한다.
2. 이 계획의 체크리스트에 행을 등록한다. 결정 2–10의 항목 묶음마다 한 행이다. 각 행은 자기 테스트를 red→green으로 실행한다. worktree와 브랜치 이름을 바꿔 첫 행의 ID를 담는다(`PRINCIPLES.md:45`). kit 세션이 이미 시작한 버전, pin, lock 행은 참조만 하고 중복으로 만들지 않는다.
3. `gates-workflow.test.mts`에 새 단언을 추가한다. 모든 `kit-gates` 전제 조건은 PRINCIPLES 규칙이나 kit `AGENTS.md` 규칙이 이름으로 지정하며, 분할의 합집합은 여전히 `kit-gates`와 같다.
4. **0.0.74를 채택하기 전의 consumer.** 각 저장소는 자기 채택 행에서 다음을 한다:
   - 삭제된 대상을 가리키는 모든 참조를 지운다. build와 test 전제 조건, AGENTS의 Enforced-by 줄도 포함한다:
     - `toolchain-check`, 여덟 개 저장소 모두에서
     - `cargo-downloads-check`, template, orm, crudui, ordered-json에서
     - `cargo-fetch`, ssr `Makefile:112,141`에서
     - `link-state-check`, 모든 consumer의 CHECK_TARGETS에서(table.md, 표 1b), ordered-json `Makefile:38`과 crudui `Makefile:552`에서. `link-check`가 이를 대체한다.
     - `composer-install`, hyper `Makefile:127-128`에서. `npm-install`, hyper `Makefile:183`에서.
     - `release-assets-fetch`, hyper `Makefile:100`과 crudui `Makefile:197`에서
   - `deps-<runtime>` 대상을 정의해 ci-setup이 쓰게 한다;
   - 자기 link 선언 파일을 쓰고, `--siblings`, `CHECKOUTS=`, `POLYSPEC=`을 뺀다(limepie 포함);
   - PIE와 Composer 저장소가 이를 대체하면 hyper는 자기 `config/release-assets.json` 항목과 `build-template-ext.mts`를 제거한다;
   - 날것의 `uv sync` recipe가 `make uv-install`을 거치게 한다: crudui `Makefile:173`, orm `Makefile:751`, hyper `Makefile:116`.
5. 0.0.74를 릴리스한다. 그다음 각 저장소가 kit-sync로 이를 채택한다. 실제 순서 제약은 ordered-json이 orm과 crudui보다 먼저, template이 hyper보다 먼저라는 것뿐이다. 나머지는 독립이다. crudui는 kit 0.0.63에서 올라온다.

## 종료 조건
- 모든 `kit-gates` 전제 조건은 적힌 규칙이 이름으로 지정한다. 이는 `gates-workflow.test.mts`가 증명한다.
- kit 코드는 어떤 패키지도 설치, 갱신, pin, 해석하지 않는다. 버전, pin, lock 내용을 비교하지 않는다. 저장소의 make 대신 빌드하지 않는다. package manager 호출은 얇은 recipe뿐이다: `mise install --locked`, `mise lock`, `cargo fetch`, rustup, 그리고 가드된 `uv-install`이며, 이것은 dev 폴더 규칙을 지킨다.
- `make install`을 두 번 실행해도 `var/tools`나 install 폴더의 어떤 파일도 바뀌지 않는다. 이는 P17 테스트가 증명한다.
- 선언 파일이 있을 때와 릴리스 상태(파일 없음)일 때 `make link-check`가 통과한다.
- 어떤 consumer workflow나 CI 설정도 `kit-gates` 전제 조건을 이름으로 들지 않는다.
- `install-link` 뒤의 저장소식 `uv sync`는 dev 폴더를 바이트 단위로 동일하게 둔다.
- 저장소에서 kit 복사본이 바뀌거나 추가되면 `make kit-inject-check`가 실패한다.
- worktree의 `make install` 뒤에도 main의 도구와 lock은 바뀌지 않는다.
- 모든 consumer가 0.0.74를 채택했고, 각 저장소에서 `make rules-check`가 통과한다.
