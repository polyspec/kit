<!-- doc-id: changelog -->
<!-- source-sha256: 60b9d9bc90dfb20e616ced41f9531eb68356e517f99b5924e7e0822e1df15061 -->
# 변경 기록

[English](CHANGELOG.md)

## Unreleased

- docs/spec이 두 번 정의한 요구사항은 범위 실행을 포함한 모든 parity 선언 검사를 실패시키고, finding은 두 정의의 파일과 줄을 이름 붙인다(K520).
- uv-install, link, link-state-check는 checkout이 가리키는 uv workspace root의 member를 Python provider에 포함하므로, 설치된 member가 link된다(K518).
- unit으로 범위를 정한 parity 검사는 schema를 어기는 unit을 빼고 이름을 밝힌 뒤 나머지에 규칙을 실행하므로, 범위 실행이 실행 없이 통과하지 않는다(K517).
- 링크된 worktree는 main checkout의 도구를 쓰고 아무것도 설치하지 않는다. mise의 data dir, install, shim과 var/tools/bin은 main checkout의 것이고 mise.toml만 worktree 자신의 것이므로 worktree에서 make land가 pypi:vulture를 찾는다. worktree에서 install-tools와 install-kit은 거부되고, worktree-setup은 make install 대신 node_modules를 link한다(K519).
- kit이 내보내는 owner 규칙은 kit이 더는 복사하지 않는 lint 설정을 소유하지 않으므로, kit-sync 뒤의 consumer가 owner-validate를 통과한다(K514-2).
- make land는 어디서 호출되든 main을 checkout한 checkout으로 land하고, main을 checkout한 checkout이 없으면 그것을 이름 붙여 실패한다(K516).
- polyspec-lock-check와 config/polyspec.json을 제거했다. 추적되는 lock은 각 polyspec 패키지의 release를 기록하고, gate는 추적되는 lock의 release URL이 이름 붙인 sibling 저장소를 clone한다(K515).
- kit-check는 kit이 더는 복사하지 않는데 저장소가 아직 가진 lint 설정을 make kit-sync를 고침으로 하여 이름 붙인다(K514-1).
- main에서 make item-new는 BODY_FILE로 행 등록을 docs(plan) commit 하나로 commit하며, BODY_FILE이 없거나 다른 변경이 staged면 무엇을 쓰기 전에 거부한다(K499-2).
- 각 lint는 설정을 kit 패키지에서 읽는다(ruff.toml, phpcs.xml.dist, phpstan.dist.neon, .golangci.yml, clippy.toml, .oxlintrc.json, knip.json). kit-sync는 이 사본들과 config/api-extractor.kit.json을 저장소에서 지운다(K514).
- land는 main이 움직이기 전에 worktree의 merge 결과로 make build를 실행하고, build가 실패하는 branch는 아무것도 merge하지 않고 거부한다(K513).
- link는 .git에 아무것도 쓰지 않는다. consumer의 .gitignore가 /.claude/settings.local.json을 무시하며, Git이 무시하지 않는 동안 link-state-check가 그 파일을 이름 붙이므로 sandbox 안의 worktree도 link된다(K512).
- Python 폴더 link는 uv가 sync하는 환경, 즉 UV_PROJECT_ENVIRONMENT가 설정되면 그것(limepie의 python/var/venv)을, 아니면 .venv를 읽으므로 그 polyspec 패키지가 link된다(K448-14).
- bootstrap의 install-packages는 다시 package-lock.json을 npm ci로 설치하므로, CI runner처럼 kit.mk가 없는 checkout도 @polyspec/kit을 설치한다. make install은 그 뒤 link한다(K511).
- link 계약(docs/operations/local-links.md)은 폴더 link를 적는다. polyspec 패키지는 release로 설치된 것으로 보고, 설치 뒤 폴더를 직접 상대 symlink로 바꾸며, 복사본은 금지이고, 어떤 단계도 버전을 판단하지 않으며, worktree는 도구와 의존 폴더를 main checkout의 것으로 link한다(K448-4).
- `make link`은 checkout의 모든 tracked 프로젝트의 설치된 polyspec 패키지를 link하며, hyper의 examples/board 같은 중첩 Composer 프로젝트도 포함한다. 테스트, fixture, release consumer는 시험하는 설치를 그대로 둔다(K447).
- push gate는 push되는 각 commit의 메시지와 identity, push되는 tip의 checklist를 한 번 검사하고 checklist 텍스트의 Markdown을 한 번만 파싱하므로, 수백 개 commit의 백업 push가 모든 commit 검사를 다시 실행해 멈춘 것처럼 보이지 않는다. 각 commit의 item, 행, twin 규칙은 commit-msg hook과 land의 commits-check에 남는다(K510).
- land와 branch commit의 행 ID 검사는 branch가 갈라진 뒤 더하거나 바꾼 행만 main과 비교하므로, 행 문구를 바꾼 main보다 뒤처진 branch가 더는 거부되지 않는다(K497-1).
- `link --project <dir> --siblings`와 `check --project <dir> --siblings`는 옆에 polyspec checkout이 없는 consumer의 claude-hook 항목을 early return 전에 쓰고 검사한다(K498-4).
- main의 `make commit`은 checklist의 크기와 상관없이 HEAD의 행을 읽으므로 orm의 checklist(1MB 초과)의 상태 변경은 새 행이 아니며, git이 읽지 못하는 HEAD의 checklist는 원인과 함께 commit을 실패시킨다(K499-1).
- K452-1를 닫는다 (K452-1): 확장 검사가 커밋되었고 커밋된 트리에서 검증되었다.
- K452-1를 마친다 (K452-1): 실행 시작 전에 각 PHP 확장을 검사하고, 로드되지 않는 것은 경로와 실행 중인 PHP를 이름으로 대며 실패한다.
- 확장 실행은 PHPUnit을 시작하기 전에 각 --php-extension을 검사한다: 로드되지 않는 것은 .so 경로, PHP가 보고하는 내용(빌드된 API), 실행 중인 PHP를 이름으로 대므로, 라이브러리를 잘못된 PHP에서 조용히 테스트하지 않는다 (K452-1).
- K452를 마친다 (K452): run-tests의 확장 실행이 패키지 phpunit.xml을 --configuration으로 넘겨, 라이브러리 실행과 같이 bootstrap이 로드된다.

### 2026-10-22 — 확장 실행이 PHPUnit에 패키지 설정을 준다 (K452)

- link는 폴더다(K448): `make link`, `npm-install`, `composer-install`, `uv-install`은 tracked lock을 그대로 설치한 뒤, checkout이 제공하는 설치 패키지 폴더(node_modules, vendor, site-packages)를 그 checkout으로 가는 직접 상대 symlink로 바꾸고 복사본을 지운다. link에는 composer.link.json, file: spec, editable wheel, package manager의 해석이 남지 않으며, 그 폴더 밖에는 아무것도 쓰지 않는다. kit은 버전도 pin도 강제하지 않는다(S4): link-state-check는 복사본이나 잘못된 link만 판단하고(그리고 이제 release tarball과 저장소 자신의 패키지를 받아들이는 K507의 release 기록), dependency-policy-check는 sharedPin, local, tagged, latest, stale, PHP platform pin, 제약 검사, 검토 기록, advisory를 뺀다. toolchain-check는 release를 비교하지 않고, dependency-review는 실패하지 않고 보고한다. 업데이트 후 `make link`를 한 번 실행하라.
- `make land`와 branch의 `make commit`은 main이 다른 task로 가진 ID의 checklist 행을, 그 ID가 branch 자신의 행이 아니면 거부하고, main과 어떤 로컬 branch도 갖지 않은 다음 ID를 이름 붙인다(K497).
- `scripts/kit/run-tests.mts`가 확장 실행에 패키지의 `phpunit.xml`(또는 `phpunit.xml.dist`)을 `--configuration`으로 넘긴다(K452). 그래서 설정이 지정한 bootstrap이 라이브러리 실행과 같이 로드되고, bootstrap 함수를 부르는 orm 같은 테스트가 확장에서 더는 실패하지 않는다. Red: `node --test --test-name-pattern=K452 tests/kit/run-tests.test.mts`가 6d3db7685abd에서 수정 전 실패; green: 통과, 이 파일의 62개 테스트 모두 통과.
- `link --project`가 `<dir>/.claude/settings.local.json`에 쓰는 Claude Code hook 항목은 kit checkout의 node를 이름으로 든다. 그래서 link와 check를 어느 node로 실행하든 서로 일치하며, check는 kit node가 없으면 보고한다(K498-3).
- main에서 `make commit`은 index가 그곳에 stage한 새 item의 checklist row를 거부하고, 그 등록의 branch 경로를 이름으로 든다. 변경이 stage된 main checkout의 land는 이미 거부된다(K499).
- K509: `make polyspec-lock-check`는 추적 매니페스트의 프로젝트 폴더에 대해 config/polyspec.json이 선언한 polyspec 이름을 면제하므로, kit 패키지를 선언한 소비자가 검사를 통과한다 (K509). Red: 수정 전 `node --test --test-name-pattern=K509 tests/kit/polyspec-lock.test.mts`가 1096cb67에서 실패했고(선언된 @polyspec/kit이 finding이었다), green은 파일 10/10 통과한다.
- `make land`는 main이 앞지른 branch를 lock 아래에서 그 깨끗한 worktree에서 main 위로 rebase하고 rebase된 commit에 gate를 실행하므로, 다른 land를 기다린 land는 rebase를 요구하지 않고 land된다. 충돌하는 rebase는 abort하고 파일을 이름 붙여 거부한다(K495-1).
- `make composer-install DIR=<project> CHECKOUTS="<checkout>..."`은 Composer 프로젝트의 polyspec 패키지를 제공하는 checkout을 DIR 뒤에서 받으므로, 설치가 저장소를 명시하고 sibling 탐색이 필요 없다. `NO_DEV=1`은 그것과 함께 계속 동작한다(K501). Red: aff8cbac에서 `node --test --test-name-pattern=K501 tests/kit/link.test.mts`가 실패했다. CLI가 checkout 인수를 usage 메시지와 함께 거부했다.
- K507: `make link-state-check`는 polyspec 패키지를 path 또는 link source로 기록한 추적 Cargo.lock, package-lock.json, composer.lock을 거부하며, 파일, 패키지, release source 형식을 이름 붙인다(source 없는 Cargo 패키지, link 또는 file: resolved, Composer path dist). 그래서 추적 lock은 release 기록으로 남는다 (K507). Red: 수정 전 `node --test --test-name-pattern=K507 tests/kit/link-state-check.test.mts`가 f68fe82e에서 실패했고(path lock 3개가 통과), green은 파일 25/25 통과한다.

### 2026-10-22 — 체크아웃의 Composer 셔임은 kit의 도구 환경으로 실행된다 (K508)

- land의 K459 테스트는 K453 이후 land가 merge 뒤 실행하는 build target을 fixture에 주므로 main에서 다시 green이다(K504).
- K508는 닫힌다: red와 green은 위에 기록되어 있다 (K508).
- `tests/kit/dependency-review.test.mts`가 체크아웃의 Composer 셔임을 kit의 도구 환경(`toolingEnvironment`)으로 실행한다. 그 환경이 셔임에 체크아웃의 신뢰와 디렉터리를 준다 (K508). 없으면 셔임이 "mise.toml are not trusted"로 실패한다. Red: `node --test --test-name-pattern=K508 tests/kit/dependency-review.test.mts`가 51969e466b9f에서 수정 전 실패; green: 통과.
- K490: review record는 tracked composer.json이 선언한 의존성을 적는다; link manifest는 아무것도 더하지 않는다 (K490). Red: make item-red ID=K490 exit 1 (vendor/linked가 기록됨). Green: make 아래 make item-test ID=K490 통과, lint-ts 통과. (K490).
- `link --project <dir>`는 package를 link하기 전에, 그 결과와 관계없이 `<dir>/.claude/settings.local.json`의 kit hook 항목을 쓰므로, 설치되지 않은 checkout도 hook을 받는다(K506).
- K492: kit의 Go 핀은 advisory GO-2026-6809가 없는 릴리스 go1.27.3이다; mise.toml, lock, 핀 파일, symbols go.mod, tool inventory가 그것을 적는다. Red: make item-red ID=K492 exit 1 (kit 핀 1.27.2). Green: make 아래 make item-test ID=K492 통과. (K492).
- `make land`는 실행 내내 lock을 잡으므로 두 번째 land는 첫 번째를 기다리고, gate가 도는 동안 main이 움직였으면 움직인 commit을 이름 붙여 merge를 거부한다. `make hooks`는 reference-transaction hook을 쓰며, 그 hook은 make land(`KIT_MAIN_WRITER`)나 pre-commit hook을 통과한 commit이 아닌 main의 이동을 거부하므로 main에서 수동 `git merge --ff-only`, `git reset`, `git commit --no-verify`는 거부된다. `make hooks`를 한 번 실행하라(K495).
- K448-5-2: `make cargo-fetch`는 patch된 그래프를 link 상태(var/link)에서 --locked 없이 해석하고 fetch하므로, dependency가 잠긴 release보다 앞선 sibling이 fetch를 실패시키지 않는다. 추적 Cargo.lock과 Cargo.toml은 그대로이며, sibling 없이 실행하면 plain 잠금 fetch를 유지한다 (K448-5-2). Red: 수정 전 `node --test --test-name-pattern=K448-5-2 tests/kit/link.test.mts`가 9f3a0ff8에서 실패했고(fetch가 --locked로 실행됨), green은 K448, K489, K440 테스트가 15/15 통과한다.
- K478: 추적된 polyspec-lock 검사는 link의 repository 범위 package ownership을 써서 자기 workspace의 package는 허용하고 외부 sibling finding은 유지한다 (K478). red: 8f487225에서 `node --test-name-pattern=K478` exit 1(자기 workspace 테스트 두 개), green: K478 테스트 통과.
- K478-1: checkout 밖으로 해석되는 추적된 package manifest symlink는 locked 외부 0.0.x polyspec package에 ownership을 주지 않는다 (K478-1). red: checkout 밖 guard를 뺀 상태의 K478-1 테스트 exit 1, green: K478-1 테스트 통과.
- `link --project <dir>`는 실행한 kit의 claude-hook의 Bash PreToolUse hook을 추적되지 않는 `<dir>/.claude/settings.local.json`에 쓰고, 파일의 다른 key를 유지하며, `<dir>`의 Git exclude로 그 파일을 무시하게 한다. `link check --project <dir>`는 hook이 없으면 그 파일을 이름으로 든다 (K498).
- `make npm-install`은 project의 `.npmrc`를 임시 설치 폴더로 복사하므로, npm이 project의 설정(예: checkout이 제공하는 platform peer를 위한 `legacy-peer-deps=true`)으로 설치한다(K502). Red: `node --test --test-name-pattern=K502 tests/kit/npm-install.test.mts`가 71ef287d에서 실패했다: 설치의 npm이 `.npmrc`를 찾지 못했다.
- PHP 애플리케이션 예시는 framework 제품 이름을 적지 않는다: PRINCIPLES.md의 S10과 한국어 짝, common-standard checklist의 K359, K425 row가 userland framework 위 애플리케이션의 예로 framework 제품이 아닌 PHP console application을 든다 (K477). red: 수정 전 make text-absent FILE=PRINCIPLES.md TEXT="Symfony Console CLI"가 exit 2, green: 수정 후 같은 실행 (K477).
- `dependency-policy-check`가 `--packages <name,...>`(`make dependency-policy-check PACKAGES=`)를 받으며, 그 패키지 이름을 가진 finding만 보고하고 실패한다. 범위 없는 gate는 그대로다(K493).
- `make npm-install`은 `ADD=<checkout>...`을 받아, 프로젝트가 선언하지 않은 패키지의 폴더도 처음부터 link한다. 임시 manifest의 file: 의존성이며, 추적 package.json과 package-lock.json은 그 패키지를 이름 짓지 않는다(K485).
- K491: 의존성 테스트 fixture는 make의 mise 설정이 아니라 자신의 테스트 환경에서 돈다. MISE_LOCKED을 빼고, fixture 도구는 checkout의 var/tools 밖에서 PATH가 찾는 것을 쓰므로 checkout의 shim이 mise로 재귀하지 않는다 (K491). Red: make 아래 make item-red ID=K491이 exit 1(go shim 재귀, lockfile에 없는 ruff); green: make 아래 make item-test ID=K491 통과, lint-ts 통과. (K491).
- K205 테스트 link는 install-packages가 `npm-install DIR=.`를 실행하고 npm-install이 `npm ci`를 실행함을 단정한다. K448-8 이후 kit-bootstrap의 설치 레시피이며, 낡은 `$(NPM) ci` 줄을 대체해 테스트가 main에서 통과한다 (K500).
- K448-5-1: `make cargo-fetch`는 소비자의 Cargo.lock이 이름하는 sibling crate만 patch하므로, 사용하지 않는 crate가 추적 lock에 patch.unused 항목을 남기지 않고 --locked가 이를 받는다 (K448-5-1). Red: `node --test --test-name-pattern=K448-5-1 tests/kit/link.test.mts`가 f57380a8에서 실패했고(이름 없는 crate에 patch가 쓰였다), green은 K448, K489, K440 테스트가 통과한다.
- `make link`는 대상이 절대 경로이고 provider로 해석되는 npm 링크를, 링크 폴더 기준 상대 경로 링크로 다시 만든다. link가 쓰는 형식이며 kit 규칙이 정한 형식이다. 대상 형식은 `docs/operations/local-links.ko.md`에 정했다 (K326-3).
- `make npm-install`은 패키지 폴더를 가진 checkout에서 그 폴더들을 받고 checkout 자신은 받지 않는다. 그래서 package.json이 패키지 이름을 가진 root(ordered-json)도 packages/js를 link한다(K494-2). Red: `node --test --test-name-pattern=K494-2 tests/kit/npm-install.test.mts`가 f57380a8에서 root를 link하며 실패했다.
- `make npm-install`은 lock에만 transitive로 있고 release URL을 가진 sibling 패키지를 file: 의존성으로 선언해 연결하므로 release를 받지 않는다(K484).
- `make uv-install ... STATE=<dir>`은 설치의 editable wheel을 절대 경로 폴더 STATE 아래에 쓴다. 그래서 읽기 전용으로 mount된 원본 checkout에는 아무것도 쓰지 않는다. STATE가 없으면 wheel은 지금처럼 소비자의 var/link에 있고, 상대 경로 STATE는 거부한다(K488). Red: 5d6f9a96에서 `node --test --test-name-pattern=K488 tests/kit/uv-install.test.mts`가 소비자 var/link의 mkdir에서 EACCES로 실패했다.
- `make npm-install`은 npm 패키지를 제공하지 않는 `CHECKOUTS` 항목(예: PHP 전용 fork)을 받고, 같은 목록을 받는 `link`처럼 그것에서는 아무것도 link하지 않는다. 존재하는 디렉터리가 아닌 항목만 거부된다(K494-1). Red: `node --test --test-name-pattern=K494-1 tests/kit/npm-install.test.mts`가 2fbe521f에서 composer 전용 checkout을 거부하며 실패했다.
- K489: `make cargo-fetch`는 sibling checkout의 crate를 그 checkout이 저장소(config/release.json)를 선언하거나 소비자의 Cargo.lock이 그 crate 중 하나를 이름 붙일 때만 patch하므로, 소비자 옆의 무관한 polyspec checkout이 "declares no repositoryUrl"로 fetch를 멈추지 않는다 (K489). Red: 수정 전 `node --test --test-name-pattern=K489 tests/kit/link.test.mts`가 그 오류로 실패했고, green은 같은 명령이 1/1 통과한다.
- `make npm-install`은 `CHECKOUTS`로 저장소 root를 받고, sibling checkout처럼 packages/ 아래 패키지 폴더를 스스로 찾는다. 그래서 소비자는 link할 checkout을 넘길 뿐 제공자의 구조를 읽지 않는다. 패키지 폴더도, 패키지 폴더를 가진 root도 아닌 checkout은 거부된다(K494). Red: `node --test --test-name-pattern=K494 tests/kit/npm-install.test.mts`가 ce55629e에서 "is a repository root, not a package folder"로 실패했다.
- `make item-red BEFORE=`는 추가된 새 모듈이 없어서만 나는 red를 거부한다. 실패한 모든 실행이 change가 추가하고 `<rev>` tree에 없는 파일만 가리키면 옛 동작의 red가 아니므로, 거부 메시지가 그 파일을 이름으로 밝히고 양쪽에 있는 진입점으로 테스트하라고 안내한다 (K389-3).
- `make uv-install`은 프로젝트가 이름을 선언한 각 checkout을 이름과 무관하게 처음부터 link하고 sync에서 그 이름으로 제외한다. 그래서 limepie-contracts라는 sibling은 release가 되지 않는다. `SYNC="<flags>"`는 uv sync에 `--no-install-project`와 `--all-groups`를 전달하고 다른 flag는 거부한다(K487). Red: 747470df에서 `node --test --test-name-pattern=K487 tests/kit/uv-install.test.mts`가 실패했다. limepie-contracts checkout이 release로 설치되었고, SYNC flag는 무시되었다.
- K442 완료: row가 이 commit에서 [o]이다. red는 cc8707a9^(수정 전 commit)에서 실행한 K442 테스트이다. 수정 전 item-edit는 CAUSE와 RETRY를 받지 않아 테스트가 `[plan] VERIFICATION is empty`로 실패하며 exit 1이다 (`make item-red BEFORE=cc8707a9^`로 기록). green은 이 commit의 K442 테스트이다 (K442).
- `npm-install`은 기존 node_modules의 내용을 바꾸고 디렉터리를 유지하므로, mount point인 node_modules도 설치된다(K486).
- K439-6: composer-provider-entries는 tracked 버전이 잠긴 요구를 깨뜨릴 때(polyspec/orm이 고정한 fork 등) Composer writer가 고른 버전을 쓴다 (K439-6). K468-2의 규칙은 link-owner 판정에 따라 잠긴 요구를 모두 만족하는 tracked 버전으로 좁혀진다. Red: node --test --test-name-pattern=K439-6 tests/kit/dependency-review.test.mts가 exit 1(tracked 1.0.0이 유지됨); green: make 아래에서 owner 파일 31/31 통과, lint-ts 통과. (K439-6).
- `make composer-install`은 `NO_DEV=1`을 받아 추적 lock을 `--no-dev`로 설치한다. production 설치에 쓴다(K483-2).
- `composer-install`과 `npm-install`은 checkout이 없는 선언된 polyspec 패키지를 모든 모드에서 패키지 이름을 적어 거부하며, 그 대신 npm ci나 composer install을 실행하지 않는다(K483-1).
- K448-13: npm-install은 packages/ 아래 세 단계까지 형제 패키지를 찾으므로, 패키지를 packages/server/ts에 둔 저장소(hyper)가 그것을 제공하고 npm은 릴리스를 가져오지 않는다 (K448-13). Red: node --test --test-name-pattern=K448-13 tests/kit/npm-install.test.mts가 exit 1(링크되지 않고 npm ci가 가져옴); green: make item-test ID=K448-13 통과, npm-install 파일 10/10, lint-ts 통과. (K448-13).
- PHP 애플리케이션 패키지(composer type project)는 S10 extension 실행 밖에 있고 test-php에서 자기 패키지로 test를 실행한다(K433).

### 2026-10-21 — worktree-setup이 link-state-check 전에 패키지를 빌드한다 (K482)

- K460은 이 커밋에서 done으로 기록된다: 항목이 [o]이고, red는 progress 변경을 stash한 상태에서 실행한 K460 테스트이며, green은 이 커밋의 K460 테스트다 (K460).
- 스킵된 테스트가 있는 run은 실패하고 각 스킵 케이스의 이름을 말한다. `run-tests`는 요약 줄에 `skipped cases: <이름>`을 출력하고 실패한 테스트와 같이 exit 1을 낸다. 스킵은 검증이 아니므로이다 (K460). 모든 테스트가 스킵한 run도 실패한다.
- K457 완료: row가 이 commit에서 [o]이다. red는 fix를 stash한 상태의 K457 테스트 실행(make 변수 `$`가 확장되어 `run  and $HOME`로 저장됨, exit 1)이고, green은 이 commit의 K457 테스트이다 (K457). `make item-new`와 `make item-edit`은 각 text를 작성된 그대로 도구에 넘기므로, 달러 기호·괄호·따옴표가 확장 없이 checklist에 기록된다 (K457).
- `make uv-install DIR=<project> CHECKOUTS="<checkout>..."`은 consumer의 uv 환경을 uv sync 대신 설치한다. checkout이 제공하는 polyspec 패키지는 sync에서 제외되고 그 checkout의 editable link로 설치되므로 polyspec release는 설치되지 않으며, checkout이 없는 선언된 polyspec 패키지는 uv를 실행하기 전에 거부된다(K448-3). Red: 428ec1f7에서 `node --test --test-name-pattern=K448-3 tests/kit/uv-install.test.mts`가 "does not provide an export named 'uvInstall'"로 실패했다.
- K439-5: composer-provider-entries는 Composer writer가 path repository에 쓰지 않는 source와 notification-url을 tracked lock 항목에서 보존하므로, provider 항목은 기록된 release source를 유지한다 (K439-5). Red: node --test --test-name-pattern=K439-5 tests/kit/dependency-review.test.mts가 exit 1(source 소실); green: make 아래에서 파일 30개 통과, K439-5 포함, lint-ts 통과. (K439-5).
- `scripts/kit/worktree-setup.mts`가 `make install` 뒤, `make link-state-check` 앞에 worktree의 link rebuild(`link rebuild .`, K482)를 실행하므로 새 worktree가 빌드되어 오래됨으로 보고되지 않는다 (K482). rebuild는 worktree가 가진 link 도구를 쓴다: kit 자신의 `scripts/kit/link.mts`, 또는 소비자의 설치된 `node_modules/@polyspec/kit/dist/link.mjs`. K348 fixture에는 소비자 도구를 넣었다. Red: `node --test --test-name-pattern=K482 tests/kit/worktree-setup.test.mts`가 9f7954d54d16에서 수정 전 실패(rebuild 없음, 검사가 빌드를 읽음); green: 통과, `tests/kit/worktree-setup.test.mts` 전체도 통과.
- commit-msg 검사는 code, test, script나 recipe를 스테이징한 docs나 chore commit을 경로와 함께 거부하므로, 수정은 자기 type으로 커밋한다(K449).
- `make npm-install`은 임시 manifest 사본으로 설치하므로 프로젝트의 상대 file: 의존성을 프로젝트 폴더 기준 절대 경로로
  npm에 주고, 설치 뒤에도 그 link가 풀린다(K448-12).
- 체크아웃을 주지 않은 `make npm-install`은 각 형제 저장소의 루트뿐 아니라 패키지 폴더(packages/<x>)에서도 제공 패키지를
  찾으므로, npm ci를 실행하지 않고 template/packages/ts의 @polyspec/template을 link한다(K448-11).
- K481: 생성된 Composer link manifest는 linked exact version을 caret range로 표현하고 각 path repository에는 provider의 실제 version을 유지하므로 tracked manifest를 바꾸지 않고 strict validation을 통과한다. real Composer test는 stale link lock과 일반 exact-version manifest warning이 계속 validation을 실패시키는 것을 증명한다 (K481).
- K480: Python editable wheel은 named mapping과 함께 선언된 default package-dir로 해석되는 listed package를 허용하고 import root와 finder를 모두 보존하며 default 없이 mapping되지 않은 package는 계속 거부한다. Red: 수정 전 mixed-mapping 두 case가 missing-prefix 거부로 실패했다. Green: focused regression 세 개가 모두 통과했다 (K480).
- K479: 생성된 Composer link requirement는 provider의 exact version을 사용하고, 없거나 잘못된 provider version을 거부하며 선언된 constraint와 tracked manifest를 보존한다. 선언되지 않은 package의 path repository도 오래된 tracked lock 대신 같은 provider version을 사용하며, fork는 충돌을 검증한 linked-provider의 exact pin을 유지한다 (K379-2). Red: focused regression은 `0.0.1` 대신 `*`를 보고했고, 최종 baseline 실행은 behavioral failure 7개를 기록했다. Green: K379-2를 포함한 focused K479 test 12개가 모두 통과했다 (K479).
- K476: Go workspace discovery와 go.mod/go.work reader는 checkout mise shim을 checkout의 mise environment로 실행하여, dependency-review가 managed Go shim을 가공되지 않은 process environment로 호출하지 않게 한다 (K476).
- K435-1: Go와 PyPI targeted release에 registry 검증과 정확한 update plan의 focused test를 추가하고, completeness test가 모든 target-release handler의 coverage를 맞춘다 (K435-1).
- K439-3-1: K439-3 real-Composer test는 checkout이 선언한 Composer를 사용하고, 없으면 skip하지 않고 install-tools 수정을 안내하며 실패한다. Verification은 run-tests를 거쳐 skipped-only case를 거부한다 (K439-3-1).
- K468-2-1: Composer regression fixture는 parsed lock entry를 unknown element로 검증하여, unsafe JSON assignment 없이 `make lint-ts`를 통과한다 (K468-2-1).
- K468-2: provider에 version 선언이 없으면 오프라인 Composer provider-entry 해석은 sibling package의 exact version requirement를 사용한다. Composer가 strict requirement를 해석하고, 다시 쓴 tracked lock의 version 필드는 기존 값을 유지한다 (K468-2).
- K468-1: consumer workspace와 sibling이 같은 package name을 제공하면 provider 탐색은 consumer의 own package를 유지한다. sibling이 duplicate-provider 오류를 일으키거나 소유권을 가져가지 않는다 (K468-1).
- K464-2: commit된 main을 읽지 못하는 sibling 또는 commit된 HEAD가 없는 checkout은 progress-only 출력 대신 shared-pin finding으로 실패한다 (K464-2).
- K464-1-1: shared-pin 비교를 commit된 tracked source로 옮긴 뒤 사용하지 않는 working-tree source reader와 import를 제거했다. `make lint-ts`가 통과한다 (K464-1-1).
- K464-1: sibling rule은 현재 checkout의 commit된 HEAD와 각 sibling의 commit된 main에서 추적되는 Composer pin을 비교하며, 생성된 Composer link 파일과 분리한다. Link 파일은 K326-2의 runtime platform 및 validation rule에서 계속 판단한다. K464 focused test는 생성된 link 불일치, 실제 tracked 불일치, commit되지 않은 tracked lock 수정을 검증한다 (K464-1).
- K475: provider 항목은 추적되는 composer.lock의 소비자 `vcs` repository를, `origin`이 같은 저장소를 가리키는 형제 checkout을 path repository로 삼아 해석하므로, `make dependency-review UPDATE=1`은 COMPOSER_DISABLE_NETWORK 아래에서 오프라인으로 실행된다. 형제 checkout이 가리키지 않는 vcs repository는 이름을 붙여 실패한다. red: 수정 전 `tests/kit/dependency-review.test.mts`의 K475 테스트가 실패한다(Composer가 오프라인에서 repository에 닿지 못함) (K475).
- K469-1은 이 커밋에서 done으로 기록된다: 항목이 [o]이고, red는 가드를 stash한 상태에서 실행한 K469-1 테스트(install-tools가 심볼릭 링크 var를 통해 기록했다)이며, green은 이 커밋의 K469-1 테스트다 (K469-1). `make install-tools`는 심볼릭 링크인 var를 거부하여, worktree가 자신의 var/tools와 mise 상태를 유지한다.
- K469는 이 커밋에서 done으로 기록된다: 항목이 [o]이고, red는 fix를 stash한 상태에서 실행한 K469 테스트(스테이징 트리에 mise.toml의 신뢰가 없어 mise가 거부한다)이며, green은 이 커밋의 K469 테스트다 (K469). main 커밋 또는 land의 스테이징 트리는 자신의 mise.toml을 체크아웃의 mise 상태에 신뢰로 기록하고, 트리를 제거하기 전에 그 신뢰를 제거하여, 신뢰되지 않은 설정을 mise가 거부하는 대신 게이트가 그곳에서 실행된다.
- K474는 이 커밋에서 done으로 기록된다: 항목이 [o]이고, red는 fix를 stash한 상태에서 실행한 K474 테스트(기준선이 `Error 127`로 실패한 게이트가 HEAD에서도 실패한 것으로 통과했다)이며, green은 이 커밋의 K474 테스트다 (K474). 환경 사유로 실패한 게이트 실행(신호, `Error 126` 또는 `Error 127`, 또는 발견 줄 없음)은 자체 출력과 함께 거부되며 기준선과 비교되지 않는다.
- K454는 이 커밋에서 done으로 기록된다: 항목이 [o]이고, red는 fix를 stash한 상태에서 실행한 K454 테스트이며, green은 이 커밋의 K454 테스트이다 (K454).
- deadline에 실행 중인 테스트가 남은 node 파일은 종료하기 전에, 테스트가 시작한 자식 프로세스를 모두 멈춘다. 그룹의 리더가 되는 자식도 포함한다 (K454). `stopGroup`은 그룹 신호를 보내기 전에 그룹 밖의 run 자손을 같은 방식으로 멈춘다. 자기 그룹의 리더인 자손은 그룹 리더가 끝나면 launchd로 재부모화되기 때문이다 (K454).
- K465 완료: row가 이 commit에서 [o]이다. red는 수정 전 K465 테스트 실행(root의 workspace가 빠지고 exit 0)이고, green은 이 commit의 K465 테스트이다 (K465). `make npm-install`은 root가 선언한 workspace를 임시 manifest에 project 기준으로 유지하므로 그 link가 project 폴더를 가리킨다. 임시 폴더는 tmpdir()의 실제 경로 아래에 만든다. npm은 /var에서 /private/var로 넘어가는 경로의 workspace를 버리기 때문이다. install 후 project에 dangling link가 남으면 실패한다 (K465).
- K473: vendored gates workflow는 config/polyspec.json이 선언한 각 저장소를 프로젝트 옆에 기본 브랜치로 설치 전에 clone하고, gates 전에 `make link`를 실행한다. 선언은 `repository`를 owner/name으로 명시하므로(schema), 0.0.x polyspec 패키지를 가진 저장소의 CI가 link 모델에 필요한 sibling checkout을 갖는다. Red: 수정 전 `tests/kit/gates-workflow.test.mts`와 `tests/kit/polyspec-lock.test.mts`의 K473 test가 실패한다 (K473).
- K437-1은 이 커밋에서 done으로 기록된다: 항목이 [o]이고, red는 이전 단정으로 실행한 K437-1 테스트이며, green은 이 커밋의 K437-1 테스트이다 (K437-1).
- top-level await가 끝나지 않는 node 파일의 K437 테스트는 run이 보고하는 deadline 메시지를 받아들인다. run-tests의 gap watch(K371-1)가 같은 deadline에 run을 먼저 끝내며 `no test started within 2 s`를 보고하므로, run-tests 아래에서 나타나지 않는 파일 쪽 문구를 확인하던 테스트가 실패했다. 테스트는 이제 run이 deadline에 exit status 1로 끝나고, 파일 이름과 두 deadline 메시지 중 하나를 포함하며, 제한 전에 끝나는 것을 요구한다 (K437-1).
- K380-2-1: K380-2 amend 테스트의 fixture commit이 fixture tree가 갖고 있는 row `T1-1`만 적는다. 그래서 `commit-row`는 main에서 통과하고 테스트는 자신이 이름을 붙이는 amend를 검사한다 (K380-2-1). red: `node --test --test-name-pattern=K380-2 tests/kit/git-hooks.test.mts`는 66a4fb26에서 exit 1이다(commit-row: subject이 K380-2를 적음). green: `make item-test ID=K380-2-1`이 통과한다(1 test, none skipped) (K380-2-1).
- K468는 이 커밋에서 done으로 기록된다: 항목이 [~]에서 [o]로 바뀌고, 그 changelog 줄은 위의 줄이다 (K468).
- K468는 done입니다. 항목은 이 커밋에서 [o]이며, red는 수정 전 K468 test 실행이고 green은 이 커밋의 K468 test입니다 (K468). 추적되는 Composer, npm, pylock 파일은 0.0.x polyspec 패키지를 이름으로 적지 않는다. 선언은 config/polyspec.json에 있고, `make polyspec-lock-check`가 추적되는 이름을 실패시키며, link는 선언된 각 패키지를 형제 checkout에서 설치한다 (K468).
- K464: `make dependency-policy-check`의 sibling 규칙은 direct dependency의 버전 불일치를 config/dependency-review.json의 reviewed target에서 벗어난 체크아웃만 보고하며, 둘 다 target에 있고 target이 다르면 둘 다 보고한다. sibling은 commit된 main에서 읽고, 읽을 수 없는 sibling은 not evaluated로 명시한다. finding 문장에는 review 날짜가 없고 날짜는 progress 출력에 남는다 (K464).
- K455은 done입니다. 항목은 이 커밋에서 [o]이며, red는 수정 전 K455 test 실행이고 green은 이 커밋의 K455 test입니다 (K455).
- `config/rebuild.json`은 `make rebuild-check`가 읽는 23개 tool마다 class를 정하므로 검사는 main에서 통과하고, class가 없는 tool은 경로와 함께 실패합니다. composer-constraint 재구축 기록(`docs/rebuild/composer-constraint.md`)은 그 근거인 npm 검색을 이름으로 적습니다 (K455).
- K404-1-1: main의 commit gate는 `make land`가 읽는 같은 sibling checkout으로 문서 check를 실행한다. index의 임시 snapshot은 시스템 임시 폴더가 아니라 checkout 옆에 놓이므로 `check-documents`는 sibling의 kit checklist를 land와 같이 해석하고, kit checklist가 갖지 않은 kit 항목을 이름으로 적는 row는 main에서 거부된다 (K404-1-1). red: `node --test --test-name-pattern=K404-1-1 tests/kit/git-hooks.test.mts`는 b0a99e5c에서 exit 1이다(main의 commit이 수락됨). green: `make item-test ID=K404-1-1`이 통과한다(1 test, none skipped) (K404-1-1).
- K453은 done입니다. 항목은 이 커밋에서 [o]이며, red는 수정 전 K453 test 실행이고 green은 이 커밋의 K453 test입니다 (K453).
- `make land`는 fast-forward 뒤 메인 체크아웃에서 `make build`를 실행해 무시되는 dist/가 병합된 소스를 담게 하며, 빌드 실패는 land를 실패시킵니다. `link-state-check`는 오래된 빌드의 연결된 npm provider를 이름과 함께 실패시킵니다 (K453).
- `make land`는 worktree의 프로세스를 `lsof -nP`로 읽습니다. 이름 조회를 건너뛰어 호출당 5.6초가 0.4초가 됩니다 (K453).
- K459는 done입니다. 항목은 이 커밋에서 [o]이며, red는 수정 전 K459 test 실행이고 green은 fix 커밋의 K459 test입니다 (K459).
- K459: `make land`은 변경된 경로가 dependency manifest 또는 lock(`package.json`, lock 파일, `pyproject.toml`, `Cargo.toml`, `go.mod`, requirements 파일)이면 `dependency-policy-check`를 실행하며, 저장소의 owner 선언이 무엇을 적었든 그렇다. `owner-check`가 `scripts/kit/dependency-files.mts`의 glob을 선언에 덧붙이므로, `package.json`의 변경은 review 항목 없이 land되지 않는다 (K459). red: `node --test --test-name-pattern=K459 tests/kit/land.test.mts`는 b0a99e5c에서 exit 1이다(`package.json`이 gate를 고르지 않음: missing expected exception). green: `make item-test ID=K459`가 통과한다(1 test, none skipped) (K459).
- K439-4-1: 추적되는 composer.lock의 provider 항목을, 그 lock에서 update 명령을 실행하기 전에 쓴다. 그래서 낡은 polyspec 항목(crudui의 polyspec/ordered-json 0.0.9처럼 이전 release의 php >=8.5)이 다른 패키지의 추적 update를 Composer의 platform 검사에서 더 이상 실패시키지 않는다. `scripts/kit/dependency-review.mts`의 `runUpdateSteps`는 plan의 전과 후에 항목을 쓴다 (K439-4-1). 붉은 확인: `node --test --test-name-pattern=K439-4-1 tests/kit/dependency-review.test.mts`가 18cf55d5에서 exit 1이다(추적 update 실패: polyspec/orm 0.0.18은 php >=8.5를 요구한다). 초록 확인: `make item-test ID=K439-4-1`이 통과한다(1 test, none skipped) (K439-4-1).
- K462는 done입니다. 항목은 이 커밋에서 [o]이며, red는 수정 전 K462 test 실행이고 green은 이 커밋의 K462 test입니다 (K462).
- `link.mjs providers <checkout>...`은 checkout의 npm provider마다 이름, 탭, package folder를 이름순으로 한 줄씩 출력합니다. link가 provider를 읽는 규칙(제외 경로 제외, package folder를 저장소 루트보다 우선)을 따르므로, 소비자는 polyspec 패키지의 folder를 규칙을 복사하지 않고 kit에서 얻습니다 (K462).
- K439-4: composer-provider-entries는 scratch 프로젝트를 소비자 자신의 repositories로 해석한다. provided 패키지가 먼저, 그다음 소비자의 repositories이며, 그 path url은 소비자 폴더 기준으로 풀린다. packagist는 꺼진 채이고, 읽을 수 없는 소비자 path repository는 이름을 밝히고 실패한다. 그런 repository만 제공하는 root 요구(crudui, orm, template)는 더 이상 "not in remote repositories"로 실패하지 않는다 (K439-4). 붉은 확인: `node --test --test-name-pattern=K439-4 tests/kit/dependency-review.test.mts`가 3554285c에서 exit 1이다(2 of 2 실패: root 요구를 찾지 못하고, 읽을 수 없는 repository는 알아채지 못하고 통과한다). 초록 확인: `make item-test ID=K439-4`가 통과하고(2 tests, none skipped), K439-3 test도 계속 통과한다 (K439-4).
- K463은 done입니다. 항목은 이 커밋에서 [o]이며, red는 수정 전 K463 test 실행이고 green은 이 커밋의 K463 test입니다 (K463).
- `make land`의 명령줄은 함수와 같이 종료 상태와 함께 실패한 gate를 거부합니다. land.mts의 진입점은 모듈의 모든 상수가 초기화된 뒤 실행되므로, 거부된 gate가 `Cannot access 'endOf' before initialization`으로 보고되지 않습니다 (K463).
- K448-10은 done입니다. 항목은 이 커밋에서 [o]이며, red는 수정 전 K448-10 test 실행이고 green은 이 커밋의 K448-10 test입니다 (K448-10).
- `make npm-install`은 manifest의 `overrides` 항목 중 제공되는 패키지를 이름으로 가진 항목을 깊이와 관계없이 direct dependency의 checkout 폴더로 다시 씁니다. 그래서 npm은 임시 manifest를 받아들이고(`dependencies`와 `overrides`에 이름이 모두 있는 limepie node/contracts 형태에서 EOVERRIDE가 더 나오지 않음), 제공되는 패키지의 asset spec이 임시 manifest에 남지 않습니다. manifest의 다른 overrides는 버리지 않고 유지합니다 (K448-10). npm 문서(package.json, overrides): direct dependency의 override는 그 dependency와 같은 spec이어야 합니다.
- K458은 done입니다. 항목은 이 커밋에서 [o]입니다. 변경은 fix 커밋 12e458ca이고, red는 f925cb58, green은 그 커밋의 K458 test입니다 (K458).
- K458: `make dependency-policy-check`의 sibling 비교는 checkout을 폴더가 아니라 repository 이름으로 적으므로, worktree `<repo>-NAME-ID`의 finding이 main의 finding으로 읽히고 `make land`는 더 이상 이를 새 finding으로 셈하지 않는다. 이름은 `scripts/kit/link-providers.mts`의 `repositoryName`이 준다. 붉은 확인: `node --test --test-name-pattern=K458 tests/kit/dependency-policy.test.mts`가 f925cb58에서 실패한다(worktree finding이 `repo-x-K1`을 적는다). 초록 확인: `make item-test ID=K458`이 통과한다(1 test, none skipped) (K458).
- K326-2: 링크된 Composer project에서 `make dependency-policy-check`의 모든 Composer 규칙(platform, K415 잠금 요구사항, `composer validate`, 검토 기록 버전)은 `composer.link.json`과 `composer.link.lock`을 판단하고, 링크되지 않으면 추적된 파일을 판단한다. 하나의 선택 함수 `scripts/kit/composer-project.mts`를 모든 규칙과 검토가 쓴다. 붉은 확인: `node --test --test-name-pattern=K326-2 tests/kit/dependency-policy.test.mts`가 8ad71384에서 추적된 lock의 `psr/log requires php >=8.5.0` finding으로 실패하고 link lock은 깨끗하다. 초록 확인: `make item-test ID=K326-2`가 통과한다(1 test, none skipped) (K326-2).
- K404-1: pre-commit hook은 main의 각 commit에서 `make land`의 gate를 스테이징된 tree에서 실행하고, HEAD에 없는 finding일 때만 이름을 적어 거부한다. pre-merge-commit hook은 main의 merge commit을 거부하므로 main은 commit과 fast-forward로만 움직인다(K404, K446, P10, P38). `make commit`은 이 hook을 통해 gate를 한 번만 실행한다 (K404-1).
- K448-9은 done입니다. 항목은 이 커밋에서 [o]입니다. 변경은 fix 커밋 76ac1d3f이고, red는 4a420f07, green은 그 커밋의 K448-9 test입니다 (K448-9).
- `make npm-install DIR=<project> CHECKOUTS="<package folder> ..."`은 주어진 각 checkout을 도구에 전달하고, 명시 모드에서 그것을 연결합니다. 그래서 polyspec 작업 공간 밖의 소비자(TMPDIR 아래 임시 clone)가 자기 lock의 npm ci를 더 이상 실행하지 않습니다. 대신 `packages/` 아래 package folder를 가진 저장소 루트를 주면 거부하며, 거부 메시지가 그 package folder들을 밝힙니다. package.json이 없는 폴더도 거부합니다(K448-9). Red: 4a420f07에서 CHECKOUTS를 준 상태로 `node --test --test-name-pattern=K448-9 tests/kit/npm-install.test.mts`가 lock의 npm ci를 실행했습니다.
- K371-1-1은 done입니다. red는 fb5dfef0(base 9177fbab에 test를 더한 상태)에 기록되었고 green은 현재 tree에서 확인했습니다. 위 항목이 둘을 담습니다 (K371-1-1).
- K371-1-1: 테스트가 test를 보고하지 않고 event loop를 양보하지 않는 node 파일을 다룹니다. 이런 파일은 test-exit-deadline의 파일 쪽 watch가 끝낼 수 없고, 실행기의 gap watch(K371-1)가 timeout에서 `no test started within N s after <마지막 event>`와 함께 끝냅니다. handle을 쥐고 test를 보고하지 않는 파일도, name pattern이 test와 맞지 않는 경우를 포함해 같은 방식으로 끝납니다. supervisor가 본 29시간 실행은 K371-1 이전입니다. 14:42의 kit dist에는 gap watch가 없으므로 consumer를 위해 kit을 다시 build해야 합니다. Red: base 9177fbab(K371-1 source를 되돌린 상태)에서 `node --test --test-name-pattern=K371-1-1 tests/kit/run-tests.test.mts`가 실패합니다. busy 파일이 20.2 s를 돌고 `no test ran`으로 끝났습니다. Green: `make item-test ID=K371-1-1`이 통과합니다(테스트 2개, 건너뛰기 없음). supervisor의 kevent-idle 경우는 재현되지 않았습니다(보고 참조). (K371-1-1).
- K439-2-1: `tests/kit/dependency-review.test.mts`의 K439-2 test는 checkout이 mise.toml에 선언한 Composer를 쓰고(`make install-tools`가 설치), 없거나 실행할 수 없으면 "no Composer on this machine"으로 건너뛰지 않고 `make install-tools`를 가리키며 실패한다. `COMPOSER_BIN` 재정의는 없앤다(K439-2-1). Red: Composer shim을 제거한 채 `node scripts/kit/run-tests.mts node -- --test-name-pattern=entries.are.Composer tests/kit/dependency-review.test.mts`가 exit 1로 끝난다("1 skipped, no test ran"). green: `make item-test ID=K439-2-1`이 통과한다(test 1개, 건너뛰기 없음), 없는 경우는 make install-tools를 가리키며 실패한다. (K439-2-1).
- K441-1: `make land`와 `make worktree-prune`은 process의 working directory, 열린 file, executable 가운데 하나가 worktree 안에 있을 때만 그 process가 worktree에서 도는 것으로 본다(lsof로 읽으며, 이제 lsof가 필요하다). command line에만 경로가 적힌 process는 사용이 아니므로, 관계없는 `du -sh`가 land를 막지 않는다. `make worktree-prune`도 그런 process가 쓰는 merge된 worktree를 남기며, `make land`가 거부하는 것과 같다(K441-1). Red: `node --test --test-name-pattern=K441-1 tests/kit/land.test.mts`가 exit 1로 끝나고(인자만 적은 process 2개, 201과 205가 세임), `node --test --test-name-pattern=K441-1 tests/kit/worktree-prune.test.mts`가 exit 1로 끝난다(cwd가 안에 있는 process가 있는 worktree가 제거됨). green: `make item-test ID=K441-1`이 통과한다(test 2개, 건너뛰기 없음). (K441-1).
- K371-1: run-tests는 test event가 없는 모든 구간을 test별 timeout으로 제한합니다. node, vitest, go, cargo, phpunit, python 모두에 적용되며, 첫 test 전, test 사이, 마지막 test 뒤에서 timeout에 이르면 실행기는 test timeout과 같이 tool의 process group을 멈추고 실행 경과 시간과 함께 `no test started within N s after <마지막 event>`를 출력합니다. 실행은 실패합니다. 전체 실행에는 시간 제한이 없습니다. Red: bc80fb67에서 `node --test --test-name-pattern=K371-1 tests/kit/run-tests.test.mts`가 실패(4개 모두 실패: timeout을 넘겨 자는 python import와 go shim이 통과하며, gap watch module이 없음); green: `make item-test ID=K371-1`이 통과(테스트 4개, 건너뛰기 없음). (K371-1).
- kit-check는 env(할당과 option 포함), exec, command, sh/bash/zsh/dash의 -c 문자열 뒤에서 시작하는 PHPUnit과 phpunit.phar도 찾는다(K436-1). Red: 7b4825eb에서 `node --test --test-name-pattern=K436 tests/kit/recipe-tools.test.mts`가 실패(finding 5개 중 4개); green: 통과.
- kit-check는 make 변수를 펼쳐 읽은 recipe 명령 중 run-tests 밖에서 PHPUnit을 시작하는 명령(PHPUnit 자체, 또는 그것을 실행하는 php interpreter)을 거부한다(K436). 시간 제한을 넘긴 test의 process group을 끝내는 run-tests만 멈춘 PHPUnit test를 멈출 수 있고, PHPUnit의 enforceTimeLimit은 libpq 안에서 기다리는 test를 중단하지 못한다. Red: 변경 전 `node --test --test-name-pattern=K436 tests/kit/recipe-tools.test.mts`가 실패(검사가 없고 orm에 그런 명령이 37개 있다); green: 통과하며 kit의 recipe에는 finding이 없다.
- K439-3: composer-provider-entries는 Composer writer의 scratch 프로젝트를 tracked lock에서 해석한다. 소비자의 composer.json과 composer.lock이 기준이고, 제공되는 패키지는 path repository이며, Composer는 그 패키지만 오프라인으로 갱신한다. 그래서 nikic/php-parser 같은 transitive 요구는 packagist가 아니라 lock에서 온다 (K439-3). Red: node --test --test-name-pattern=K439-3 tests/kit/dependency-review.test.mts가 exit 1(lock 없이는 transitive 요구를 찾지 못함); green: make item-test ID=K439-3이 통과한다(테스트 1개, 건너뛰기 없음). (K439-3).
- `make cargo-fetch DIR=<project>`는 소비자의 Cargo crate를 `cargo fetch --locked` 대신 가져온다. sibling checkout이 제공하는 polyspec crate는 처음부터 경로로 patch되므로 sibling crate의 git tag를 가져오지 않는다. `link-state-check`는 polyspec crate가 든 lock을 가져오는 recipe를 finding으로 알린다 (K448-5).
- K435: `make dependency-review UPDATE=1 TARGETS=<file>`은 배치의 목표 버전을 registry 스냅샷 시점과 함께 담긴 JSON 파일(dependency-targets.schema.json)에서 읽는다. 이름이 있는 dependency는 정확히 목표 버전으로 옮겨지고, 이름이 없는 dependency는 그대로 남는다. registry에 없거나 PHP 정책을 깨는 목표는 어떤 dependency도 바꾸기 전에 실패하며 그 이름을 밝히고, RECORD=1은 스냅샷 시점을 기록한다 (K435). Red: node --test --test-name-pattern=K435 tests/kit/dependency-review.test.mts가 exit 1(4개 중 4개가 수정 전 실패: TARGETS를 읽지 않음); green: 같은 명령이 4개 중 4개 통과 (K435).
- K440: `link --siblings`는 kit checkout의 claude-hook을 실행하는 Bash PreToolUse hook을 workspace 폴더의 `.claude/settings.json`에 쓰고 다른 설정은 지킨다. 그 hook이 없으면 `link-state-check`가 실패하므로 workspace 폴더에서 시작한 세션도 보호된다(K440). Red: node --test --test-name-pattern=K440 tests/kit/link.test.mts가 exit 1(workspace 폴더에 hook이 없다); green: make item-test ID=K440이 통과한다(테스트 4개, 건너뛰기 없음). (K440).
- K440-2: `link --siblings`의 Claude Code hook은 kit checkout의 node가 link를 거쳐 실행 가능한 정규 파일로 resolve될 때만 그 node로 실행된다. writer와 `link-state-check`가 하나의 predicate를 공유한다. writer는 쓰기 전에 없거나 실행할 수 없는 node를 거부하고, 기존 hook을 바이트 단위로 그대로 두며 `make -C <kit realpath> install-tools`를 알린다. `link-state-check`는 drift 클래스마다 하나의 메시지로 실패한다: hook 없음, hook 내용 다름, node 없음 또는 실행 불가(K440-2). Red: `node --test --test-name-pattern=K440-2 tests/kit/link.test.mts`가 exit 1(3개 중 2개 실패: 내용 drift와 실행 불가 node가 알려지지 않은 채 통과한다); green: `make item-test ID=K440-2`이 통과한다(테스트 3개, 건너뛰기 없음). (K440-2).
- K441: `make land`와 `make worktree-prune`은 자기 worktree를 제거하기 전에 그 Makefile의 `WORKTREE_STOP` target을 실행하고, `make land`는 그 target이 실패하면 worktree를 남기고 target과 그 출력을 적어 실패한다. `make worktree-prune`은 제거된 worktree 폴더를 명령행에 적은 프로세스를 pid와 경로로 나열하며, 어떤 프로세스도 종료하지 않는다(K441). Red: `node --test --test-name-pattern=K441 tests/kit/land.test.mts`와 `node --test --test-name-pattern=K441 tests/kit/worktree-prune.test.mts`가 base에서 exit 1(서버가 멈추지 않고 프로세스가 나열되지 않음); green: `make item-test ID=K441`이 통과한다(테스트 3개, 건너뛰기 없음).
- `make npm-install`은 주어진 checkout이 제공하는 패키지를 origin과 상관없이 연결하고, lock에만 transitive로 있는 패키지는 override로 연결하며, checkout이 없는 선언된 polyspec 패키지는 npm ci 대신 실패한다(K448-7).
- K439-2: composer-provider-entries는 provider 항목을 Composer 자체의 lock writer로 오프라인에서, 소비자가 선언한 플랫폼으로 쓴다. 그래서 자기가 쓴 lock을 다시 실행해도 바뀌지 않고, 플랫폼보다 많이 요구하는 provider는 둘을 함께 적고 실패한다 (K439-2). Red: node --test --test-name-pattern=K439-2 tests/kit/dependency-review.test.mts가 exit 1(manifest의 license 형식); green: make 아래에서 make item-test ID=K439-2가 통과한다(툴체인 Composer, 테스트 2개, 건너뛰기 없음). (K439-2).
- K440-1: kit은 `link`가 각 Go module에 쓰는 `go.work`와 `go.work.sum`을 무시한다. kit 자신의 도구(scripts/kit/symbols/go)도 포함하므로, `link`가 K440의 workspace hook을 쓰기 전에 "not ignored by Git"으로 실패하지 않는다(K440-1). Red: `node --test --test-name-pattern=K440-1 tests/kit/link.test.mts`가 exit 1로 끝난다(scripts/kit/symbols/go/go.work가 무시되지 않음). green: `make item-test ID=K440-1`이 통과하고, checkout에서 `make link`가 hook을 쓴다.

### 2026-10-21 — install-packages가 make npm-install로 설치한다 (K448-8)

- `scripts/kit/kit-bootstrap.mk`의 `install-packages`는 모든 소비자의 `make install`이 거치는데, 맨 `npm ci` 대신 `make npm-install DIR=.`를 실행한다 (K448-8). 그래서 lock이 release URL로 고정한 형제 checkout 제공 polyspec 패키지가 처음부터 링크되고 release는 받지 않는다. Red: `node --test tests/kit/install-packages.test.mts`가 base에서 실패(recipe가 `npm ci`를 실행); green: 통과, `tests/kit/npm-install.test.mts`도 통과.
- `make composer-install`과 `make npm-install`은 kit.mk의 다른 설치 대상처럼 온라인으로 실행되므로, 검사를 위해
  COMPOSER_DISABLE_NETWORK나 npm_config_offline을 내보내는 consumer도 lock의 서드파티 패키지를 설치한다(K448-6).
- `make npm-install DIR=<project>`는 consumer의 npm 패키지를 npm ci 대신 설치한다. sibling checkout이 제공하는 polyspec 패키지는 임시 manifest로 처음부터 link되고, release를 받지 않으며 추적 파일도 쓰지 않는다(K448-2).

### 2026-10-21 — 매핑된 package-dir prefix가 나열된 하위 패키지를 링크한다 (K398-3)

- K448-5: K448-5를 항목으로 등록한다: cargo는 polyspec checkout의 형제 crate를 [patch] 경로로 처음부터 링크하므로 로컬 설치가 release crate를 물질화하지 않는다(K448의 cargo 부분). red와 green은 link 테스트와 함께 온다. (K448-5).
- `scripts/kit/link.mts`가 `.`에 매핑된 prefix를 가진 정적 `package-dir`를 받아들인다. `setuptools.packages`에는 하위 패키지만 나열한다 (K398-3): 나열된 패키지는 자기가 시작하는 가장 긴 package-dir prefix로 풀리고, 편집 가능 wheel의 finder는 이름을 가장 긴 prefix로 매핑하며 prefix의 상위 패키지에는 자기 폴더가 없는 namespace 패키지를 준다. 그래서 `limepie.module.x.src`가 폴더로 풀리고 거기에는 아무것도 쓰지 않는다. 어떤 prefix도 매핑하지 않는 나열 패키지는 여전히 거부한다. Red: `node --test --test-name-pattern=K398-3 tests/kit/link.test.mts`가 f6e6f254a6b2에서 수정 전 실패(링크가 package-dir를 거부); green: 통과, 나머지 K398 테스트도 통과.
- K379-2: 링크는 소비자나 연결된 provider가 요구하는 정확한 고정 버전(require와 require-dev)을 tag로 써서 fork를 연결하고, 두 고정 버전이 다르면 둘을 함께 적고 실패한다 (K379-2). Red: node --test --test-name-pattern=K379-2 tests/kit/link.test.mts가 exit 1(link manifest가 lock 버전 2.6.0을 씀); green: link 테스트 파일 82개 전부 통과, K379-2 포함. (K379-2).
- main의 `make commit`은 `make land`처럼 gate의 finding을 읽고 kit 도구가 대괄호 이름으로 찍는 진행 줄은 빼므로, HEAD와 다른
  진행 줄이 commit을 거부하지 않는다(K446-4).
- `make land`와 main의 `make commit`은 각 gate를 `make -s`로 실행하므로, checkout마다 다른 make의 recipe 출력 줄을
  HEAD에 없는 finding으로 읽지 않는다(K446-3).
- K439-1: composer-provider-entries는 각 composer.lock의 platform과 platform-overrides를 그 디렉터리의 composer.json에서 다시 계산하고, release-consumer lock은 건드리지 않는다 (K439-1). Red: node --test --test-name-pattern=K439-1 tests/kit/dependency-review.test.mts가 exit 1(export와 재계산 없음); green: 파일 전체 15개 통과, K439-1 포함. (K439-1).

### 2026-10-21 — 정적 package-dir는 편집 가능 wheel의 finder로 링크된다 (K398-2)

- `scripts/kit/link.mts`가 pyproject에서 패키지를 자기 폴더에 매핑하는 정적 `package-dir`를 가진 Python provider를 링크한다. 패키지는 `setuptools.packages`에 나열되어야 한다 (K398-2): 편집 가능 wheel이 패키지 이름을 폴더에 매핑하는 finder `__editable___<dist>_finder.py`를 쓰고, `.pth`가 그것을 import하여 설치한다. 폴더는 쓰지 않으며 소스는 복사하지 않는다. 정적 문자열 맵이 아닌 `package-dir`나 `setuptools.packages`에 없는 패키지 매핑은 여전히 거부한다. Red: `node --test --test-name-pattern=K398-2 tests/kit/link.test.mts`가 0ad7267f7793에서 수정 전 실패(링크가 package-dir를 거부); green: 통과, `tests/kit/link.test.mts`의 82개 테스트 모두 통과.
- `make land`와 main의 `make commit`은 체크아웃의 실제 경로와 논리 경로를 같은 키로 읽으므로, 경로만 다른 변경 없는 finding으로 거부되지 않는다(K446-2).
- main에서 `make commit`은 선택된 gate를 `make land`처럼 HEAD와 비교하고, HEAD에 없는 finding만 거부하므로 HEAD가 이미 가진 finding은 관계없는 변경을 막지 않는다(K446-1).
- lock을 composer install하는 recipe는 뒤에 link 단계가 있어도 거부되며, sibling이 제공하는 polyspec 패키지를 처음부터
  link하는 make composer-install을 쓰라고 적는다(K448-1).
- main에서 `make commit`은 스테이징된 경로에 대해 `make land`가 고르는 정적 gate를 실행하고, 하나라도 실패하면 아무것도
  커밋하지 않는다. commit-msg 검사는 HEAD가 main인 동안 커밋을 거부하지 않으므로, owner가 K404를 폐지하며 정한 대로 작업은
  main에서 직접 한다(K446).
- `make composer-install DIR=<project>`는 composer install 대신 Composer 프로젝트를 설치한다. sibling checkout이 그 lock의
  polyspec 패키지를 제공하는 곳에서는 composer.link.json과 composer.link.lock을 쓰고 그것으로 설치하므로, 링크된 패키지의
  release metadata(php >=8.5를 요구하는 polyspec/orm 0.0.18 같은)를 읽지 않는다. CI처럼 sibling이 없으면 추적 lock으로
  composer install을 실행한다. link는 새 프로젝트의 polyspec 패키지를 그 lock에서 읽는다(K432).
- kit이 쓰는 추적 composer.lock은 sibling checkout이 제공하는 각 polyspec provider의 manifest(require, autoload와
  composer.json의 다른 field)를 담고 오래된 release의 metadata를 담지 않으며, 버전, dist, source는 그대로 둔다.
  `dependency-review UPDATE=1`이 이를 적용하고, `make composer-provider-entries`는 이것만으로 모든 추적 lock을 다시 쓰므로
  어떤 lock도 release의 `php >=8.5`를 지니지 않는다(K439).
- link는 --project 아래 consumer 자신의 Python 프로젝트도 K398의 editable wheel로 --no-deps와 함께 설치하고 direct_url.json을
  그 폴더의 editable 기록으로 다시 쓰므로, container가 read-only로 mount한 checkout에 아무것도 쓰지 않는다. `uv pip install
  -e`는 남지 않으며, K398의 거부가 그것에도 적용된다(K398-1).
- fork의 링크는 consumer가 고정한 버전을 지킨다: 링크 manifest는 fork checkout의 path repository에 lock이 고정 전에 기록한
  release가 아니라 consumer composer.json의 정확한 핀을 태그로(2.6.0-p1을 v2.6.0-p1로) 주므로, Composer는 partial update에서
  forks/<name>의 fork를 받는다(K379-1).
- `./run-command`의 runCommand는 option onLine(stream, line)을 받는다. 이는 pipe된 stdout이나 stderr의 완성된 각 줄을
  도착하는 대로, stream이 끝날 때는 newline 없는 마지막 줄을 받으므로, 호출자는 출력을 maxOutputBytes 아래에서 계속 모으면서
  병렬 명령을 각자의 prefix와 함께 내보낼 수 있다(K430-1).
- checkout에 도구가 없는 parity runner나 symbol extractor는 그것을 실행의 오류, 즉 도구와 run make install을 적는 R3나 R1
  finding으로 보고하며, K393-1 이후 python3가 없는 checkout에서 그랬듯 parity-check와 parity-declarations-check를 잡히지
  않은 오류로 끝내지 않는다(K393-2).
- `make text-absent FILE=<path> TEXT=<text>`는 추적되는 파일이 그 문구를 그대로 가진 동안 각 줄을 적어 실패하고, 문구가
  사라지면 통과한다. 이는 변경 전체가 text인 행의 red이며, P19는 이제 이것과 함께 변경이 낡게 만든 주석과 문서를 그 변경의
  커밋에서 고친다는 규칙을 적는다. 문구는 환경 변수로 도구에 전해지므로 그 안의 백틱이나 `$( )`는 아무것도 실행하지 않는다
  (K431).
- `make parity-declarations-check UNITS=`는 config/parity.json의 schema finding도 범위로 좁힌다: `/units/<index>`의 finding은
  그 unit이 이름 붙었을 때만 세므로, 다른 unit이 아직 schema를 어겨도 한 unit의 requirement를 더하는 행은 red와 green을
  증명한다. 그때 실행은 다른 규칙이 schema를 통과하는 선언을 필요로 한다고 말한다(K400-1).
- kit 패키지는 `./run-command`를 export한다. runCommand는 명령 하나를 시간 제한 없이 자기 process group에서 끝까지 실행하고,
  명령이 끝나면 group에 남긴 것을, 호출자가 중단되면 실행 중인 명령을 멈추며, 출력을 한도까지 담고 status, signal, 경과
  시간, 시작 오류를 돌려준다. failureOf는 실패를 한 줄로 적고, stopGroup은 이것과 run-tests를 위해 process-group.mts로
  옮겼다(K430).
- P10은 `.githooks/pre-push`로만 강제되고, PRINCIPLES.md의 어떤 Enforced by 줄도 PRINCIPLES.md를 kit의 복사본으로 받는
  consumer에 없는 tests/나 scripts/ 아래 경로를 적지 않으므로, kit-sync 뒤에도 `make rules-check`가 통과한다(K359-2).
- `make land`는 자기를 실행한 make와 shell 같은 자기 조상을 worktree의 프로세스에서 빼므로, make land 전에 worktree로
  이동한 shell이 branch를 거부하지 않는다(K429-1).
- `make land`는 worktree에서 실행 중인 프로세스, 즉 command line이 그 안의 경로를 가리키거나(테스트 database server의
  --datadir 같은) 작업 폴더가 그 안에 있는 프로세스가 있으면, 어떤 gate도 돌기 전에 각 pid와 command를 적어 branch를
  거부한다. 그때는 아무것도 merge, 삭제되지 않는다(K429).
- `make land`는 main에서도 실패하는 gate에서 kit 도구의 진행 줄을 finding으로 세지 않는다. stderr의 모든 줄과, kit 도구 이름을
  대괄호로 시작하는 줄(`[parity] tools root ...`)을 뺀 stdout 줄을 비교하므로, linter가 stdout에 낸 finding은 여전히 센다
  (K394-3).
- `make dependency-policy-check`는 remote tarball URL(registry.npmjs.org가 아닌 http(s) `.tgz`)에서 resolve되었지만 lock
  root나 그 workspace의 어떤 package.json도 그 URL로 적지 않은 package-lock.json 항목을 lock의 줄, 패키지, URL과 함께
  실패시키므로, allow-remote=root(K189)에서 npm ci가 거부하는 일이 먼저 보인다. 고치는 방법은 그 패키지를 URL과 함께 root에
  선언하는 것이다(K427).
- `make install-packages`는 npm ci 뒤에 저장소 변수 INSTALL_PACKAGES_EXTRA가 이름 붙인 make target(예: npm workspace 밖에
  자기 package-lock.json을 가진 tools 프로젝트의 설치)을 같은 npm과 allow-remote 설정으로 실행한다. 그것들은 설치만 하고,
  `make install`이 그 뒤에 link하며, link-state-check는 그것들에 link 단계를 요구하지 않고, release workflow는
  install-packages로 그것들을 설치한다(K428).
- `make layout-check`가 실행하는 `generated-files tracked`는 생성 segment, 실행 object header 또는 생성 파일 header
  (shebang을 빼고 `Code generated .* DO NOT EDIT`와 맞는 첫 주석 줄)를 가진 추적 경로를, config/generated.json이 예외로
  선언하지 않는 한, 경로와 함께 실패시킨다. hook의 staged 검사는 hook이 생기기 전에 커밋된 파일을 볼 수 없다(K426).
- Red-Gate나 Red-Test 줄은 HEAD와 main의 merge-base를 적는다. 행 branch를 main 위로 rebase해도 그 커밋은 fix의 조상으로
  남으므로, branch에서 red를 기록한 행도 `make land`가 요구하는 rebase 뒤에 닫힌다. 또 `make item-red BEFORE=`는 행을 닫으며
  바뀐 changelog를 가진 tree를 받는다(K389-2).
- `make item-red BEFORE=`는 바꾸는 각 파일의 바이트와 함께 mode를 복구하므로, BEFORE에 없는 Git hook 같은 실행 파일이 실행
  가능한 채로 돌아온다(K389-1).
- P24는 `make commits-check`를, S10은 `make dependency-policy-check`를, 즉 K424와 K425가 만든 검사를 planned 항목 대신
  적으므로 `make rules-check`가 main에서 다시 통과한다(K359-1).
- `make commits-check`와 commit-msg hook은 id `(#<id>)`가 그 커밋 tree의 docs/plans checklist 항목이 아닌 커밋을 실패시키므로
  (규칙 commit-row), 변경은 등록된 행에서 시작한다(P24). 행을 등록하는 커밋은 그 행을 더하므로 통과하고, 저장소의 첫 커밋은
  예외다(K424).
- `make dependency-policy-check`는 composer.json의 require에 애플리케이션 framework(symfony/console,
  symfony/framework-bundle, symfony/http-kernel, laravel/framework, laminas/laminas-mvc)를 요구하는 S10의 PHP library를
  manifest와 패키지 이름과 함께 실패시킨다. 애플리케이션은 library를 요구하는 자기 Composer 패키지다(K425).
- `make parity-declarations-check IDS="<requirement>..."`는 requirement id 중 하나를 가리키는 finding만 UNITS, RULES와의
  교집합으로, config/parity.json 자체의 finding과 함께 보고한다. 어떤 unit도 인용하지 않는 id는 실행을 실패시키므로, 몇
  requirement의 인용을 옮기는 행도 red를 증명할 수 있다(K414-1).
- link는 kit이 build backend 없이 consumer의 `var/link/python`에 직접 쓰는 editable wheel로 Python provider를 설치한다.
  wheel은 provider pyproject.toml의 metadata와 import root를 가리키는 .pth만 담고 source는 담지 않으므로, link는 container가
  read-only로 mount한 provider 폴더에 아무것도 쓰지 않는다. metadata에 backend가 필요한 provider는 `uv pip install -e`로
  대체하지 않고 거부한다(K398).
- php, node, npm, composer, go, python, uv를 실행하는 kit의 모든 도구는 하나의 helper(mise-tools.mts의 `toolCommand`:
  `var/tools/bin`, 다음 checkout의 mise shim)로 checkout에서 그 도구를 가져오며, 없으면 PATH로 대체하지 않고 run make
  install과 함께 실패한다. bootstrap npm installer는 machine의 node를 쓰고, cargo는 PATH에 남는다(K393-1).
- `make dependency-policy-check`는 저장소와 sibling checkout이 모두 직접 요구하는 패키지의 핀을 각 root의 install lock에서
  비교하고, 다른 version이나 다른 source로 lock된 패키지를 두 lock과 그 entry의 줄과 함께 실패시킨다. 전이 패키지와 tests/나
  fixtures/ 아래의 lock은 비교하지 않으며, CI처럼 sibling이 없으면 아무것도 비교하지 않는다(K378).
- PRINCIPLES.md는 owner의 작업 지침을 그 검사와 함께 적는다: 작업은 `make land`로만 main에 들어가고(P10, P38), 행마다
  자유 디스크 30 GB 이상에서 만든 worktree를 merge 뒤 지우며(P10), 전체 suite는 conductor의 지시로만 돌고(P20),
  subagent는 Haiku 5.5에서 행 하나씩 맡고 결과를 검증받으며(P22), 행이 작업보다 먼저이고(P24, planned K424), 미루지 않으며
  (P36), 결과는 검사 뒤에만 보고하고(P37), S10의 PHP library는 library code뿐이다(planned K425)(K359).
- `make item-red ID=`는 active 행의 Verification을 test 작성 뒤, fix 전에 실행해 실패를 요구하고 기록한다. `make commit`은
  그 기록을 행의 각 커밋에 Red-Test 줄로 쓰고, `make item-state`의 done 상태는 그 기록이나 history의 그런 줄을 요구하며,
  그 줄은 rebase 뒤 parent의 조상에서도 성립한다. `make item-red ID= BEFORE=<rev>`는 기록 없이 커밋된 행의 red를 `<rev>`의
  source로 증명한다(K389).
- `config/parity.json`의 binding은 `runner`를 `reason`과 함께 선언할 수 있다. 그 test는 그 runner의 program, argument, 출력
  parser로 실행되고 R2와 R3에서 여전히 구현의 binding으로 세므로, C engine의 node test가 계약을 확인하는 PHP extension도
  binding할 수 있다. reason 없는 runner나 runner 없는 reason은 선언의 finding이다(K422).
- `link --siblings`는 checkout 옆 `forks/` 폴더의 main checkout을 origin과 상관없이 그 manifest가 이름 붙인 패키지의
  provider로 링크하며, fork는 polyspec 패키지의 0.0.x 규칙이 다루지 않는 자기 핀(예: 2.6.0-p1)으로 링크된다(K379).
- kit의 layout은 kit link가 링크된 checkout의 root에 쓰는 파일(`composer.link.json`, `composer.link.lock`)을 선언하므로,
  링크된 worktree도 main checkout처럼 `make layout-check`를 통과한다(K423).
- 실제 layout 테스트가 `make layout-check`의 install 폴더 검사와 함께 다시 통과한다. 그 fixture는 kit의 도구를 그 node로
  실행하고 install 폴더를 무시한다(K372-1).
- TypeScript 실제 lint 테스트 K170과 K172가 다시 통과한다. 그 fixture는 각 테스트가 증명하는 규칙 옆에서 더는 tsc에 실패하지
  않는다. 타입 없는 매개변수와, fixture의 tsconfig가 이제 빼는 일부러 깨진 입력 때문이었다(K417).
- `make unlink`은 `pylock.toml`로 lock한 Python project를 복원한다. 링크된 package의 lock된 release를 pylock에서 환경에 다시
  설치하고, pylock에 없는 링크된 package를 적는다(K401-1).
- docs-check는 `template-benchmark K79-3`처럼 sibling 저장소의 이름 뒤에 온 K-id를 그 저장소의 item으로 읽고, 자기 id가
  K-id인 저장소에서는 `kit K<n>`만 kit item으로 읽는다(K374-1).
- kit의 module이 자기 옆에서 읽는 파일이나 폴더를 kit-build가 dist에 담지 않으면 kit의 테스트가 실패하고, kit-build 테스트의
  sandbox는 build가 담는 폴더를 Makefile에서 얻는다(K421).
- run-tests는 표준 library만 쓰는 kit의 runner로 Python 테스트를 실행한다. runner는 테스트마다 자기 timeout을 주고 각각의
  경과 시간을 출력하므로 어떤 환경도 새 package가 필요 없다. `docs/operations/tool-inventory.md`는 언어마다 무엇이 테스트에
  timeout을 주는지 적는다(K371).
- kit의 prepare-commit-msg hook은 기록만 하는 commit에서 아무것도 출력하지 않는다. 오류는 계속 출력한다(K380-3).
- `make lint-php`는 `autoload.files` 항목의 각 파일을 PHP parser로 읽고, S2가 요구하듯 namespace의 함수와 상수가 아닌
  것이 있으면 파일과 줄을 적어 실패한다(K377).
- docs-check는 kit 자신이나 consumer 옆의 kit checkout에서 읽은 kit의 checklist에 없는 kit item을 적은 checklist row를
  그 파일과 줄을 적어 실패시킨다(K374).
- `make layout-check`는 Git이 무시하지 않는 install 폴더(`package.json` 옆의 `node_modules`, Composer project의 vendor, `var`,
  `pyproject.toml` 옆의 `.venv`)에서 그 폴더와 고칠 `.gitignore`를 적어 실패한다. Go vendor 폴더는 정당하다(K372).
- kit main에서 `make layout-check`가 다시 통과한다. `config/layout.yml`은 marker 검사의 Python helper와 PHPUnit이 앞에
  붙이는 PHP 파일을 S9에서 예외로 둔다. 그 언어의 program만 그것일 수 있기 때문이다(K420).
- test-markers-check는 자기 module 옆의 Python helper를 쓰고 kit-build는 `markers/`를 dist에 담으므로, `scripts/kit`이
  없는 consumer의 Python 테스트도 읽는다(K345-1).
- link는 linked로 보고하는 모든 Composer project의 link manifest와 lock을 쓰며, 설치된 vendor로 linked인 project도 그렇다.
  링크된 project에 그것이 없는 동안 `link check`는 실패하므로, dependency-review는 링크된 project를 링크되지 않은 것으로
  보지 않는다(K392-3).
- `dependency-policy-check`는 tracked Composer lock의 각 package를 그 `composer.json`의 `config.platform`의 `php`와
  `ext-*`로 검사하고, platform이 요구를 채우지 못하는 package를 적는다(K415).
- `link check`는 consumer module의 go.work가 쓰는 module을 그 go.work에서 읽으므로, tracked workspace의 다른 module을
  요구하지 않는 module이 더는 not a known dependency로 검사에 실패하지 않는다(K399-1).
- amend의 commit-msg 검사는 index를 amend되는 commit의 parent와 비교한다. `make hooks`가 amend를 기록하는
  `prepare-commit-msg` hook을 쓰므로, 테스트를 가진 fix commit의 문서를 다시 stage하는 amend가 통과한다. git은 `-C HEAD`에
  같은 인자를 주므로 그것도 같게 검사된다(K380-2).
- checklist는 각 row의 id로 row마다 merge된다. `make hooks`는 `docs/plans/*/checklist.md`에 driver `kit-checklist`를
  선언하고 `kit-twin`은 그 쌍둥이를 같게 merge하므로, main이 닫은 row는 branch가 그 뒤에 덧붙인 row 옆에 한 번만 남고,
  양쪽이 다르게 바꾼 row는 그 id를 적은 conflict이다(K354-3).
- `make docs-check`는 check-documents를 실행한 뒤 저장소가 `DOCS_CHECKS += <target>`으로 더한 모든 문서 검사를 다른 것의
  상태와 상관없이 실행하고, 실패한 것을 적어 실패한다(K419).
- `make dependency-review`는 Go module을 가장 가까운 go.work로 검사한다. link가 쓰는 옆의 go.work, 없으면 그 module을 쓰는
  상위 폴더의 tracked go.work를 쓰므로, 저장소 workspace의 module이 자기 module을 찾는다(K418).
- P8은 규칙마다 강제된다. phpcs는 `@`로 숨긴 오류를, oxlint는 잡은 오류를 cause로 갖지 않고 던지는 catch를, PHP
  extension의 build는 확인해야 하는 결과를 버리는 것을(`-Werror=unused-result`), gate `make suppression-check`는 이유를
  적지 않은 lint finding의 모든 억제를 거부한다(K334).
- generated file 검사는 `config/generated.json`이 선언하지 않는 한 경로와 상관없이 내용이 실행 object(ELF, Mach-O thin
  또는 fat, PE)인 파일을 거부한다. commit 때는 index에서, `commits-check`에서는 각 commit에서 읽는다(K416).
- `commits-check`는 메시지와 identity 검사 외에 pre-commit hook의 generated file 검사와 한국어 쌍둥이 검사도 범위의 모든
  commit에 실행하므로, `--no-verify`로 만든 commit은 gate와 pre-push에서 실패한다(K351).
- `make parity-declarations-check RULES="<rule> ..."`는 id나 이름으로 지정한 rule의 finding과 `config/parity.json` 자체의
  finding만 보고한다. UNITS도 주면 둘이 모두 고르는 finding을 보고한다(K414).
- Verification의 gate 명령은 `make parity-declarations-check RULES=R9`처럼 target 뒤의 make 변수를 받으므로, UNITS나
  RULES로 좁힌 gate도 fix row의 기록된 red이고 그 Red-Gate 줄이 그것을 증명한다(K357-2).
- `link rebuild`는 consumer의 링크된 Composer project마다 link 파일로 `composer dump-autoload`를 실행하므로, provider가
  파일을 지운 뒤에도 autoload는 있는 파일만 적는다(K347).
- test-markers-check는 checkout의 Python의 ast module로 Python 파일의 syntax tree에서 marker를 읽으므로, 문자열이나
  docstring 안의 skip marker는 finding이 아니다(K345).
- twin driver는 git이 `CHANGELOG.md`를 merge하는 방식대로, 그 파일의 merge attribute로 `CHANGELOG.ko.md`를 merge하고
  marker를 계산한다. hook이 아직 union으로 merge하는 checkout도 rebase 뒤 현재의 twin을 갖는다(K354-2).
- branch는 reflog가 그 위에서 만든 commit을 기록할 때 자기 commit을 가지므로, rebase로 더 새로운 main 위로 옮겨진 새
  branch를 `make worktree-prune`과 `make link-state-check`가 더는 merge된 것으로 보지 않는다(K381-1).
- run-tests는 checkout의 mise 환경(`toolsEnvironment`)으로 runner를 시작하므로, shell에서 run-tests로 실행한 owner
  테스트도 make에서처럼 checkout의 trust와 도구를 읽는다(K411).
- kit의 `make install`은 PHP symbol extractor의 package도 설치하므로(`kit-install`), `make worktree-setup`이 만든 worktree가
  `make lint-php`를 실행한다(K412).
- kit main에서 `make lint-php`가 다시 통과한다. kit의 PHP 파일 네 개에서 phpcs의 120자를 넘는 줄을 나누었고, extractor가
  보고하는 symbol과 leak은 같다(K413).
- parity 선언 검사는 요구 id를 하나도 정의하지 않는 `docs/spec`의 문서마다 그 파일을 적어 보고한다(규칙 R19
  `spec-without-requirement`)(K337).
- test-php-ext의 Reflection 비교는 extension이 등록하는 상수도 읽고, library 밖의 class나 함수에서 이미 그랬듯 PHP
  library가 정의하지 않는 상수에서 실패한다(K338).
- python-venv는 home이 main checkout의 공유 install에 있는 Python인 환경을 받는다. K387 이후 worktree는 그 Python을
  실행하므로, 새 worktree의 Python 설치가 더는 실패하지 않는다(K387-1).
- install-tools는 php, php-config, phpize 옆에 `.php-version`의 PHP의 `sbin`에 있는 `php-fpm`을 감싸고, toolchain-check는
  `php-fpm`이나 `php-cgi`를 PATH에서 bare name으로 시작하는 recipe나 script를 거부한다(K341).
- `make item-state`는 kit row를 인용하지 않는 한 release, version tag, "not reproducible", flake, "transient",
  "unrelated", "environment"를 적은 bypassed나 impossible의 사유를 거부하고, 테스트를 지우는 commit은 같은 요구를 다루는
  테스트를 적은 `Replaced-By:` 줄이 있어야 한다(규칙 `commit-deleted-test`)(K339).
- worktree는 그 저장소의 main checkout이 설치한 mise의 도구를 읽으므로(`kit.mk`와 `miseEnvironment`가 설정하는
  `MISE_SHARED_INSTALL_DIRS`) `make install`은 main checkout에 없는 도구만 설치하고, worktree마다 약 0.7 GB를 덜 쓴다.
  data dir, state, shim, wrapper는 자기 것으로 남는다(K387).
- Python link는 `uv.lock`이 없는 workspace에서 PEP 751 lock(`pylock.toml`)으로 설치의 constraint를 얻으므로, orm처럼
  그렇게 lock한 project도 그 설치가 만든 환경에 링크된다(K401).
- 변경 기록의 Unreleased 항목은 rebase 뒤에도 최신순으로 남는다. `CHANGELOG.md`는 driver `kit-changelog`로, 그 한국어
  쌍둥이는 `kit-twin`으로 merge되며, 둘은 적용되는 commit만 더한 항목을 main 목록의 형식(항목마다 한 줄, 또는 항목마다 한
  문단)대로 앞에 둔다. `make hooks`는 union 줄을 바꾼다(K354-1).
- kit main에서 `make lint-ts`가 다시 통과한다. 테스트 파일 네 개가 non-null assertion 두 개와 `any`에서의 unsafe assertion
  네 개 대신 검사나 타입이 있는 parse로 값을 읽는다(K409).
- kit main에서 `make owner-validate`가 다시 통과한다. `config/owner-checks.json`은 merge driver `twin-merge.mts`를
  `git-hooks.mts`를 통해, `clippy.toml`을 실제 Rust lint 테스트를 통해, `scripts/kit/php-library`를 그것을 읽는 module을 통해
  소유한다(K410).
- `make lint-go`는 module이 `//go:build` 줄에 적는 모든 build tag 뒤의 Go 파일을 lint한다. go 도구가 스스로 설정하는 tag를
  빼고 그런 tag마다 golangci-lint(`--build-tags`)와 deadcode(`-tags`)를 한 번 더 실행하므로, tag 뒤의 파일도 lint되고 tag가
  붙은 파일만 쓰는 helper를 더는 쓰이지 않는 것으로 보지 않는다(K406).
- kit package는 `kit.copies`가 선언하는 `clippy.toml`을 담으므로, kit-sync가 그것을 consumer에 복사하고 main에서 copy
  테스트가 통과한다(K408).
- kit main에서 `make duplication-check`와 `make lint-python`이 다시 통과한다. Python extractor의 symbol과 leak은 한 함수로
  module의 공개 이름을 읽고, extractor는 format되어 있다(K407).
- 저장소는 kit-sync가 복사하는 `config/commit-identity.json`에 commit identity를 선언하고, commit-msg 검사와
  `commits-check`는 그와 다른 author나 committer를 거부하며(규칙 `commit-identity`) clone의 `git config user.name`과
  `user.email`을 고칠 곳으로 적는다. AI identity 규칙(K265)은 남는다(K405).
- commit-msg hook은 `HEAD`가 `main`이고 `main`에 commit이 있는 동안의 commit을 거부한다(규칙 `commit-on-main`). row는
  등록과 닫기를 포함해 자기 branch에서 commit하고 `make land`의 fast-forward로만 `main`에 닿는다. `main`을 만드는 저장소의
  첫 commit만 예외이다(K404).
- `make land`는 branch와 main에서 실행한 gate의 출력을 비교하기 전에 시스템 임시 폴더 안의 모든 경로를 하나의 자리표시자로
  읽는다. 그래서 duplication-check가 실행마다 새 임시 폴더에 쓰는 jscpd 설정을 더는 새 finding으로 보지 않는다(K394-2).
- Composer project가 링크된 동안 `make dependency-review UPDATE=1`은 갱신하는 package 중 polyspec package가 아닌 것마다
  tracked `composer.lock`도 lock만으로 갱신한다. 그래서 기록한 review가 link lock이 tracked lock인 새 checkout에서도
  성립한다. polyspec package는 계속 release 검사를 기다린다(K392-2).
- `make link-state-check`는 `make install`의 사슬을 따라가기 전에 저장소의 Makefile이 대입하는 변수를 펼친다. 그래서
  `$(PACKAGE_DEPS)`를 거치는 fsm-js-install처럼 변수를 거쳐 닿는 recipe를 더는 link 단계 없는 설치로 보고하지 않는다.
  target이 여럿인 rule은 그중 하나가 닿으면 닿은 것이다(K403).
- `commits-check`는 ref에 점이 있는 범위를 받으므로, `make land`는 `chore/kitsync-T2.60`처럼 점이 있는 row id의 branch를
  land한다. 점 세 개, 빈 쪽, 점으로 시작하거나 끝나는 쪽은 계속 거부한다(K402).
- `kit.mk`와 `miseEnvironment`는 `MISE_GLOBAL_CONFIG_ROOT`를 checkout으로 설정한다. `MISE_GLOBAL_CONFIG_FILE`이 설정되어
  있으면 `mise install`은 global config의 root(기본값은 home 디렉터리)의 trust를 기록하므로, `make install-tools`가 K397이
  지운 home 항목을 곧바로 다시 썼다(K397-1).
- `make worktree-prune`은 자기 commit(reflog가 기록한 생성 지점 이후의 commit)이 모두 main에 있는 branch를 모두 지우고,
  그 worktree에 commit하지 않은 변경이 없으면 worktree도 지운다. 새 branch, merge되지 않은 branch, 변경이 있는 branch는
  이유와 함께 적는다. merge된 branch가 남아 있는 동안 `make link-state-check`는 실패한다(K381).
- `make land`는 branch에서 실패한 gate를 main에서 실행한 같은 gate의 출력에 없는 줄이 있을 때만 거부하고 그 줄을 적는다
  (worktree 폴더는 main checkout으로 읽고 숫자는 무시하며 반복 수를 센다). 새 finding이 없으면 main에서 red인 gate가 더는
  모든 branch를 거부하지 않는다. row의 Verification이 실행하는 `parity-check`와 `test-` target은 실행하지 않는다(K394-1).
- link는 바깥 Composer project의 path repository가 설치하는 package 폴더를 그 project의 일부로 보므로, 그 폴더의
  polyspec 요구를 그 project의 vendor에 링크하고, 아직 설치되지 않은 동안에는 그 vendor를 적는다(K396).
- 저장소의 tracked `go.work` 아래에 있는 module에 대해 link가 쓰는 `go.work`는 그 module과 provider 외에 그 workspace의
  모든 module을 쓴다. 그래서 링크된 동안에도 저장소의 module이 서로를 import한다(K399).
- `make parity-declarations-check UNITS="<id> ..."`는 그 unit을 가리키는 finding과 `config/parity.json` 자체의 finding만
  보고한다. 그래서 자기 unit의 선언을 고친 row는 다른 unit에 finding이 남아 있어도 통과한다. UNITS가 없으면 모든
  finding을 보고한다(K400).
- checkout의 mise 상태는 자기 `mise.toml`만 신뢰한다. `trustConfig`와 `make install-tools`는
  `var/tools/mise/state/trusted-configs`의 다른 항목(home 디렉터리, 다른 checkout, 지운 worktree로의 링크)을 모두 지우고,
  `make link-state-check`는 그런 항목을 적어 실패한다. `MISE_GLOBAL_CONFIG_FILE`이 설정된 채 실행한 `mise trust`는 home
  디렉터리를 신뢰해 그 아래의 모든 `mise.toml`을 신뢰하게 했다(K397).
- Composer project가 linked인 동안 `make dependency-review UPDATE=1`은 `composer.link.json`에 쓰는 새 범위를 tracked
  `composer.json`에도 쓴다(tracked manifest로 `composer require --no-update`). tracked lock은 release 검사를 기다린다.
  red: 범위가 link manifest에만 쓰였다. green: `node --test --test-name-pattern=K392-1 tests/kit/dependency-review.test.mts`가
  통과한다 (K392-1).
- `make test-php-ext CASES=<pattern>`은 각 PHP library에서 filter가 고르는 test를 그 library run의 명령으로 실행한
  PHPUnit 자신의 `--list-tests --filter`에서 받으므로 `#[Test]` method, data provider, 상속된 test도 센다. K390의 `function
  test…` method 읽기는 지웠다. red: 맞는 test가 접두어 없는 `#[Test]` method뿐인 library가 no case selected로 보고되었다.
  green: `node --test --test-name-pattern=K390 tests/kit/runtime-targets.test.mts`가 통과한다 (K390-1).
- `make land BRANCH=<branch>`는 branch를 main에 합친다. main에 rebase되지 않았거나 worktree가 없는 branch를 거부하고,
  그 worktree에서 바뀐 경로가 `config/owner-checks.json`으로 고르는 kit-gates의 정적 gate를 docs-check와 commits-check
  (`main..<branch>`)와 함께 실행하며 test는 실행하지 않는다. 실패한 gate의 출력과 함께 거부하고 `--ff-only`로 합친 뒤
  깨끗한 worktree와 branch를 지운다. main이 이미 가진 branch는 남은 것만 지운다. red: gate를 거쳐 branch를 합치는 utility가
  없었다. green: `node --test --test-name-pattern=K394 tests/kit/land.test.mts`가 통과한다 (K394).
- `make link-state-check`는 저장소가 polyspec 의존성을 선언하는 ecosystem에서만, 그리고 install이 마지막에 link하므로(K360-2)
  `make install`이 prerequisite나 `$(MAKE)` 호출로 이르지 않는 recipe에만 lock에서 설치한 직후 link하라고 요구한다.
  local-links.md가 둘 다 말한다. red: link할 것이 없는 kit의 `install-packages` recipe가 검사에 실패해 kit의 모든 worktree가
  red로 끝났다. green: `node --test --test-name-pattern=K349-2 tests/kit/link-state-check.test.mts`가 통과하고 kit이 검사를
  통과한다 (K349-2).
- kit checkout `../kit` 옆의 checkout에서 `kit-bootstrap.mk`는 첫 make부터 link가 설치하는 provider인 `../kit/dist`를
  `KIT`로 쓰고, build되지 않았으면 실패한다. 없으면 CI처럼 `KIT`는 설치된 package이다. 그래서 새 worktree는 `npm ci` 전에
  `kit.mk`를 읽어 kit target을 가리키는 저장소 단계가 실행되고, 자신이 개발하는 kit의 도구로 설치한다. red: 새 template
  worktree의 `make install`이 `cargo-downloads-fetch` 규칙을 몰랐고 그 install-tools가 php wrapper를 쓰지 않았다.
  green: `node --test --test-name-pattern=K348-1 tests/kit/link.test.mts`가 통과한다 (K348-1).
- `make install`은 link가 읽는 환경을 설치하는 저장소의 단계를 포함한 모든 prerequisite 뒤에 link하고,
  `install-kit`은 설치만 한다. local-links.md가 그 순서를 말한다. red: 새 orm worktree에서 install-kit의 link가 Composer
  vendor와 Python 환경이 생기기 전에 실행되어 make install을 멈췄다. green: `node --test
  --test-name-pattern='K360|K205' tests/kit/link.test.mts`가 통과한다 (K360-2).
- `run-tests`는 PHP extension을 쓰는 phpunit run이나 library run의 php, Go run의 go, Python run의 python을
  checkout(`var/tools/bin/php`, mise의 shim)에서 시작하고, 없으면 `<path> does not exist; run make install`과 함께
  실패하며 PATH의 도구를 쓰지 않는다. red: run이 PATH의 php, 즉 make install 없는 worktree에서 pin이 아닌 PHP를 썼다.
  green: `node --test --test-name-pattern=K393 tests/kit/run-tests.test.mts`가 통과한다 (K393).
- `link`는 link lock이 없을 때만 tracked `composer.lock`에서 `composer.link.lock`을 쓰고 그 뒤에는 유지하므로, `make
  dependency-review UPDATE=1`이 link lock에 적용한 version이 다시 link해도 남고 부분 update는 linked package만 바꾼다.
  red: 두 번째 link가 갱신된 link lock 위에 tracked lock을 다시 복사했다. green: `node --test --test-name-pattern=K392
  tests/kit/link.test.mts`가 통과한다 (K392).
- 실패한 명령의 message는 비어 있지 않은 두 stream을 stderr, stdout 순서로 모두 가지므로 도구가 stderr의 진행 뒤
  stdout에 쓴 오류가 남는다. stream이 하나인 명령은 message가 그대로이다. red: stdout의 gen_stub.php 오류가 stderr의
  download 진행 뒤에서 사라졌다. green: `node --test --test-name-pattern=K352 tests/kit/process.test.mts`가 통과한다
  (K352).
- `make parity-declarations-check`는 새 rule R18 duplicate-suite로 다른 case 집합에서 같은 requirement id를 인용하는 두
  directory suite를 두 unit과 id를 말하며 보고한다. 기능은 모든 구현이 test하는 하나의 unit이기 때문이다. red: 한
  기능의 두 suite가 통과했다. green: `node --test --test-name-pattern=K350 tests/kit/parity.test.mts`가 통과한다 (K350).
- `make item-edit ID= DELIVERABLES=`는 done이 아닌 모든 상태의 item에 대해 item-new의 검사를 거쳐 두 언어의 Deliverables
  cell을 바꾼다. red: item-edit이 DELIVERABLES를 받지 않았다. green: `node --test --test-name-pattern=K388
  tests/kit/plan.test.mts`가 통과한다 (K388).
- `make commit`과 commit-msg hook은 make commit이 붙이는 id 앞에 이미 ` (#<id>)`를 가진 Subject를 거부한다(rule
  commit-subject-id). red: subject `Fix it (#T1) (#T1)`이 통과했다. green: `node --test --test-name-pattern=K380-1
  tests/kit/commits.test.mts`가 통과한다 (K380-1).
- `make link-state-check`는 recipe가 도구의 make 변수로 실행하는 lock 설치, 즉 `$(COMPOSER) install`,
  `$(COMPOSER_BIN) install`, `$(NPM) ci`, `$(UV) sync`도 읽고, 그 뒤에 kit link 단계가 없으면 실패시킨다. red: link 단계
  없이 `$(COMPOSER) install`을 가진 recipe가 통과했다. green: `node --test --test-name-pattern=K349-1
  tests/kit/link-state-check.test.mts`가 통과한다 (K349-1).
- `make hooks`는 `.git/info/attributes`에 `CHANGELOG.md`와 영어 checklist의 git union merge와 그 한국어 문서의 merge
  driver `kit-twin`(`make twin-merge`)을 선언한다. driver는 양쪽의 union과 rebase가 merge한 영어 파일의 revision
  marker를 쓰므로, changelog 줄과 checklist row를 더하는 두 branch의 rebase에 손 편집이나 script가 필요 없고 rebase가 쓰는
  각 commit은 최신 한국어 문서를 가진다. driver는 git이 적용하는 commit을 알려 주는 rebase에서 작동하고 그 밖에서는
  rebase를 말하며 실패한다. 선언이 없으면 `make hooks-check`가 실패한다. red: 그런 rebase가 두 한국어 문서에서 충돌했다.
  green: `node --test --test-name-pattern=K354 tests/kit/git-hooks.test.mts`가 통과한다 (K354).
- Claude Code hook은 `pgrep`, `pidof`, `ls`, `test`, `[`를 상태를 기다릴 수 있는 `while`이나 `until` loop의 조건이나
  본문에서만 poll로 읽는다. 목록을 도는 `for` loop는 목록과 함께 끝나므로 그것들을 실행해도 되고, `sleep`은 모든 loop에서
  계속 거부된다. red: hook이 이름 붙인 두 파일을 `test -f`로 도는 `for` loop(orm의 recipe)를 거부해 그것에 의존하는
  row에서 orm의 docs-check가 실패했다. green: `node --test --test-name-pattern=K386-1 tests/kit/claude-hook.test.mts`가
  통과한다 (K386-1).
- `make test-php-ext CASES=<pattern>`은 PHPUnit이 `--filter`를 `Class::method`에 맞추듯 `*Test.php` 파일의 `test…`
  method에서 읽어 filter가 test를 고르는 PHP library마다 실행하고, 다른 library마다 `<library>: no case selected by
  CASES`를 출력하며, 어느 library에서도 test를 고르지 못하면 실패한다. red: 한 library의 test를 가리키는 filter가 다른
  library를 실패시켰다. green: `node --test --test-name-pattern=K390 tests/kit/runtime-targets.test.mts`가 통과한다
  (K390).
- kit은 `make hooks`가 쓰는 commit-msg hook(K380)을 추적하므로 kit 자신의 commit도 만들 때 검사되고 kit에서 `make
  hooks-check`가 통과한다. red: kit에서 `make hooks-check`가 `.githooks/commit-msg`를 말하며 실패했다. green: `make
  hooks-check`가 통과한다 (K391).
- `make duplication-check`는 PHP extension의 S10 stub `packages/php-ext/src/polyspec_*.stub.php`를 경로로 제외한다. S10이
  stub에 library를 같은 이름과 signature로 선언하게 하기 때문이다. library 안의 clone은 계속 세며
  docs/operations/tool-inventory.md가 그 이유를 말한다. red: jscpd가 library class를 따라 쓴 stub을 보고했다. green:
  `node --test --test-name-pattern=K366 tests/kit/duplication-check.test.mts`가 통과한다 (K366).
- kit의 Claude Code hook은 기다리는 Bash 명령, 즉 `sleep`과 본문이 sleep하거나 poll하는(`pgrep`, `pidof`, `ls`, `test
  -e`/`-f`/`-d`, `[ -e`) `for`, `while`, `until` loop를 거부하고, 대안인 자기 작업과 timeout으로 끝나는 foreground 명령
  또는 끝날 때 알리는 background 실행을 한 message로 말한다. red: hook이 `sleep 280; echo waited`를 받았다. green: `node
  --test --test-name-pattern=K386 tests/kit/claude-hook.test.mts`가 통과한다 (K386).
- `make worktree-setup NAME=<name> ID=<id> [TYPE=<type>]`은 row의 worktree, 즉 `main`에서 `<type>/<name>-<id>`의
  `../<repository>-<name>-<id>`를 만들고, 자기 source로 `make install`(도구, package, link, 그다음 저장소의 단계)을 실행해
  설치하고 `make link-state-check`로 검사한다. 여유 disk가 30 GB 미만이면 거부하고, 다시 실행하면 같은 worktree를 다시
  설치하고 검사한다. docs/operations/local-links.md는 worktree와 K360-1의 설치 순서를 말한다. red: worktree를 만드는
  target이 없어 손 작업이 필요했다. green: `node --test --test-name-pattern=K348 tests/kit/worktree-setup.test.mts`가
  통과한다 (K348).
- `link`는 소비자 자신의 저장소 package를 그것을 실행하는 work tree(main checkout이나 worktree)에서 받고, 인자 가운데
  같은 저장소의 checkout에서는 받지 않으므로 worktree는 다른 저장소만 link하고 main checkout의 source를 받지 않으며 자기
  저장소의 checkout을 밝히지 않는다. 자기 package는 `own (this repository)`로 보고된다. red: worktree의 자기 package를 main
  checkout이 제공했다. green: `node --test --test-name-pattern=K385 tests/kit/link.test.mts`가 통과한다 (K385).
- `make commit`과 check-commits의 fix 검사는 Rust unit test를 fix의 test로 받는다. commit 쪽에서 읽은 `.rs` 파일의 바뀐
  `tests.rs`, 또는 `#[cfg(test)]` item이나 `#[test]` 함수 안의 바뀐 줄이다. red: test가 `src/tests.rs`인 fix가 test
  파일을 바꾸지 않는다고 거부되었다. green: `node --test --test-name-pattern=K370 tests/kit/commits.test.mts`가 통과한다
  (K370).
- kit의 pre-commit hook과 `make commit`은 staged tree에서 읽어 commit 뒤 한국어 문서의 revision marker가 영어 문서의
  sha256이 아니게 되는 commit을 그 문서와 `make documents-stamp`를 말하며 거부한다. red: 한국어 문서의 새 marker 없이
  stage된 `CHANGELOG.md` 변경이 commit되었다. green: `node --test --test-name-pattern=K382 tests/kit/documents.test.mts`가
  통과한다 (K382).
- `make hooks`는 kit의 commit-msg hook `.githooks/commit-msg`를 쓰고, 이 hook은 모든 commit에 `make commit`의 message
  검사(`make commit-msg-hook`, check-commits `--message`)를 실행하므로 AI 도구의 footer를 가진 amend를 포함해 `make
  commit` 밖에서 만든 commit은 만들 때 거부된다. hook이 없거나 바뀌면 `make hooks-check`가 실패한다. red: `make hooks`
  뒤 AI 도구의 `Co-Authored-By` trailer를 가진 amend가 성공했다. green: `node --test --test-name-pattern=K380
  tests/kit/git-hooks.test.mts`가 통과한다 (K380).
- `make test-php-ext`의 library run은 Composer가 library에 주는 vendor 디렉터리, 즉 library 자신의 것이나 path
  repository와 `vendor-dir`로 library를 설치하는 root project의 것에서 `run-tests`가 `phpunit --cwd`에 하듯이(K186)
  PHPUnit을 찾는다. red: `vendor-dir`을 가진 root project가 설치한 library가 `packages/php/vendor/phpunit/phpunit/phpunit
  does not exist`로 실패했다. green: `node --test --test-name-pattern=K367 tests/kit/run-tests.test.mts`가 통과한다
  (K367).
- `make link-state-check`는 `.php-version`보다 새 PHP를 요구하는 linked vendor의 platform check를 보고하고, package의
  더 낮은 floor를 요구하는 vendor는 보고하지 않는다. Composer는 package가 요구하는 가장 높은 floor(`>=8.4`이면 80400)를
  요구하기 때문이다. red: `.php-version` 8.4.1에서 80400을 요구하는 vendor가 finding이었다. green: `node --test
  --test-name-pattern=K384 tests/kit/link-state-check.test.mts`가 통과한다 (K384).
- `make dependency-review`는 lock된 version보다 오래된 version을 제안하지 않는다. registry의 최신 release가 lock된
  version보다 오래된 의존성, 예컨대 `0.0.6`에 대한 미출시 `0.0.11`은 linked 여부와 상관없이 outdated가 아니며 update
  plan에 들어가지 않는다. red: review가 `polyspec/template 0.0.11 < 0.0.6`을 제안하고 `composer require ...:^0.0.6`을
  계획했다. green: `node --test --test-name-pattern=K369 tests/kit/dependency-review.test.mts`가 통과한다 (K369).
- `make link-check`는 `CHECKOUTS`가 비면 `make link`처럼 저장소 옆의 checkout으로 검사하므로 `make link` 직후 모든
  link를 NOT linked로 보고하지 않는다. red: 그 명령이 checkout을 하나도 넘기지 않았다. green: `node --test
  --test-name-pattern=K383 tests/kit/kit-mk.test.mts`가 통과한다 (K383).
- `make install-packages`는 `npm ci`만 실행하고, `make install`은 link에 전체 install-tools만 설치하는 Go가 필요하므로
  전체 `make install-tools` 뒤 마지막 kit 단계인 `make install-link`로 link한다. bootstrap의 message는 그 순서를 말한다.
  red: 문서의 순서가 `npm ci` 뒤 link에서 실패했고 recipe가 install-packages 안에서 link했다. green: `node --test
  --test-name-pattern='K360|K205' tests/kit/link.test.mts`가 통과한다 (K360-1).
- `make dependency-review`는 link가 `go.mod` 옆에 쓴 `go.work`로 Go module을 scan하므로 govulncheck가 code가 쓰는
  linked module을 compile하고, version 목록은 released module(`GOWORK=off`)에 머문다. 실패한 Go scan은 advisory
  database의 장애가 아니라 그 출력과 원인을 고치는 방법으로 보고된다. red: linked module의 scan이 `go.work` 없이
  실행되었다. green: `node --test --test-name-pattern=K365 tests/kit/dependency-go.test.mts`가 통과한다 (K365).
- `make item-new`, `make item-edit`, `make docs-check`는 따옴표 밖의 pipe를 가진 Verification 명령을 거부한다.
  pipeline은 첫 명령의 exit status를 숨기기 때문이다. `-run 'A|B'`처럼 따옴표 안의 pattern은 계속 허용된다. red:
  item-edit이 pipeline으로 실행되는 `go test -run A|B ./...`를 받았다. green: `node --test --test-name-pattern=K376
  tests/kit/plan.test.mts`가 통과한다 (K376).
- `make link-state-check`는 checkout의 install directory(`node_modules`, `vendor`, `.venv`, `target`, `var`)가 symbolic
  link이거나 `node_modules` 안의 workspace package link가 checkout 밖으로 resolve되면 실패한다. 그것들을 main
  checkout에 link한 worktree는 main checkout의 source를 실행하기 때문이다. polyspec provider로의 link는 계속 허용된다.
  red: `node_modules`를 link한 checkout이 통과했다. green: `node --test --test-name-pattern=K375
  tests/kit/link-state-check.test.mts`가 통과한다 (K375).
- `make lint-php`는 phpstan을 제한 없음을 뜻하는 phpstan의 값 `--memory-limit=-1`로 실행한다. 분석에 필요한 memory는
  package와 함께 커지고 제한은 분석을 멈출 뿐이기 때문이다. red: phpstan이 orm packages/php에서 php.ini의 128M에서
  멈췄고 명령에 memory 제한 option이 없었다. green: `node --test --test-name-pattern=K346 tests/kit/lint-php.test.mts`가
  통과한다 (K346).
- kit의 isolation test는 다른 저장소의 이름을 그 저장소를 가리키는 곳, 즉 package(`polyspec/<name>`,
  `@polyspec/<name>`, `github.com/polyspec/<name>`)나 경로 segment(`../<name>/`)에서만 읽으므로 link test의 변수
  `template` 같은 같은 영어 단어는 finding이 아니다. red: 그 변수 때문에 kit main에서 test가 실패했다. green: `node
  --test tests/kit/isolation.test.mts`가 통과한다 (K361).
- `make test-markers-check`는 하나의 규약을 따르는 fixture, 즉 `fixtures`나 `testdata` 폴더 안의 파일이나
  `*_fixture_test.go`, `*.fixture.test.*`, `test_*_fixture.py`, `*FixtureTest.php`라는 이름의 파일의 skip을 finding으로
  보지 않는다. 그런 fixture의 skip은 그 test가 검사하는 동작이기 때문이다. 그 밖의 skip과 fixture의 다른 marker는
  계속 finding이다. red: `*_fixture_test.go` 파일의 TestFixtureSkip이 finding이었다. green: `node --test
  --test-name-pattern=K344 tests/kit/test-markers.test.mts`가 통과한다 (K344).
- consumer의 `make install-packages`는 옆의 kit checkout의 link(`../kit/dist/link.mjs`)를 실행하고, `npm ci`가 방금
  설치한 released kit에는 `--siblings`가 없으므로 그 checkout이 build되지 않았으면 `npm ci` 전에 해결 방법과 함께
  실패한다. CI처럼 sibling kit이 없으면 설치된 kit의 link를 실행한다. K205 test는 K349가 사실로 만든 대로 recipe가
  설치 직후 link하고 build하지 않는다고 말한다. red: kit checkout 옆에서 recipe가 설치된 kit의 link를 실행했고 K205
  test가 실패했다. green: `node --test --test-name-pattern='K360|K205' tests/kit/link.test.mts`가 통과한다 (K360).
- plan utility는 home directory 안의 경로를 더하는 checklist를 docs-check의 private-path 함수로 거부하고, `make
  item-edit ID= TASK= TASK_KO=`는 done row를 포함해 row의 Task cell을 두 언어로 바꾼다. kit의 docs-check를 실패시킨
  home 경로 없이 row K358과 K363을 다시 썼다. red: item-new가 row에 home directory 안의 경로를 썼고 item-edit은 TASK를
  받지 않았다. green: `node --test --test-name-pattern=K373 tests/kit/plan.test.mts`가 통과하고 kit의 docs-check가
  통과한다 (K373).
- `make item-new`, `make item-edit`, `make item-state`, `make plan-split`은 자신이 바꾸는 한국어 문서가 최신이었으면
  새 영어 text의 revision marker를 쓰고, 낡은 문서는 낡은 채로 두므로 출력이 `make documents-stamp` 없이 docs-check를
  통과한다. red: item-new 뒤 marker가 바뀌기 전 text를 가리켰다. green: `node --test --test-name-pattern=K368
  tests/kit/plan.test.mts`가 통과한다 (K368).
- `make hooks`와 `make hooks-check`는 저장소에 `config/generated.json`이 없으면 그 파일을 말하며 실패한다. 이들이
  설치하는 pre-commit hook이 그 파일로 generated-file 검사를 실행해 모든 commit을 거부하기 때문이다. red: 파일 없이도
  check가 통과했다. green: `node --test --test-name-pattern=K362 tests/kit/git-hooks.test.mts`가 통과한다 (K362).
- `config/layout.kit.yml`은 kit-sync가 모든 저장소에 쓰는 `clippy.toml`을 root 파일로 선언하고, `kit.copies`의 root
  파일이 그 목록에 없으면 kit test가 실패한다. red: `clippy.toml`이 선언되지 않아 fsm에서 `make layout-check`가
  실패했다. green: `node --test --test-name-pattern=K356 tests/kit/kit-sync.test.mts`가 통과한다 (K356).
- kit-check는 다른 언어의 lint처럼 Rust source가 있는 저장소에서만 `CHECK_TARGETS`에 `lint-rust`를 요구한다. red:
  `.rs` 파일이 없는 저장소가 `CHECK_TARGETS`가 `lint-rust`를 실행하지 않는다는 finding을 받았다. green: `node --test
  --test-name-pattern=K364 tests/kit/kit-check.test.mts`가 통과한다 (K364).
- `link --siblings`는 origin이 `github.com/polyspec/<folder>`인 polyspec 저장소의 main checkout만 받고, `.git`을 가진
  그 밖의 폴더는 이유와 함께 skipped로 한 번 출력하므로 `template_2026` 같은 사본이 package를 한 번 더 제공하지 않는다.
  red: 사본 `prov_2026`과 `prov-copy`가 checkout으로 받아들여졌다. green: `node --test --test-name-pattern=K363
  tests/kit/link.test.mts`가 통과한다 (K363).
- `make item-state`, check-commits, `make bypass-check`는 kit-gates의 gate를 저장소 Makefile의 make database, 즉
  저장소가 쓰는 kit의 kit.mk를 include한 database에서 읽고, Makefile이 kit-gates를 선언하지 않으면 kit-gates를 말하며
  실패한다. 이전에는 kit만 가진 `scripts/kit/kit.mk`를 읽어 consumer에 gate가 없었으므로 Red-Gate 기록이 쓰이지 않았고
  `make -o <gate>`가 bypass-check를 통과했다. red: consumer layout에서 기록이 쓰이지 않았고 심어 둔 `make -o lint-go`가
  통과했다. green: `node --test --test-name-pattern=K357 tests/kit/plan.test.mts tests/kit/bypass-check.test.mts`가
  4개 중 4개 통과하고 fsm은 24개 gate를 읽는다 (K357-1).
- Composer project가 linked인 동안 link lock이 checkout의 절대 폴더를 가진 path dist로 기록한 provider는 저장소의
  path package가 아니라 review record와 비교되고 link로 판단되는(K328) linked 의존성이다. 상대 url의 path dist만
  저장소의 package이다. red: fsm에서 `make link` 뒤처럼 `make dependency-policy-check`가
  `packages/fixture-php/<절대 폴더>/composer.json is missing`으로 실패했다. green: `node --test
  --test-name-pattern=K358 tests/kit/dependency-policy.test.mts`가 통과한다 (K358).
- 결함이 lint finding 같은 kit-gates gate의 finding인 fix commit은 test 파일 대신 parent에서 그 gate의 red로
  증명된다. `make item-state`는 row가 `docs/plans` 밖에서 HEAD와 같은 tree에서 active가 될 때 Verification의 gate
  명령을 실행해 exit status를 `var/plan/<id>.json`에 기록하고, `make commit`은 실패한 gate마다
  `Red-Gate: make <gate> exit <n> at <parent>` 줄을 쓰며, check-commits는 commit이 item을 done으로 옮기고 그 줄이
  row의 gate와 parent를 가리킬 때 commit을 받아들인다. red: 그런 commit은 commit-fix-test로 거부되었고 red는 기록되지
  않았다. green: `node --test --test-name-pattern=K357 tests/kit/plan.test.mts`가 2개 중 2개 통과한다 (K357).
- Claude Code hook, `make item-test`, `make item-state`는 `run-tests.mts` 명령을 runner와 같은 방식으로 읽는다. option 뒤의
  인수는 `--` 없이도 받고 파일은 `--cwd`에서 해석하므로 `--cwd packages/php -- ../../tests/XTest.php`가 허용된다.
  item-test와 item-state는 Verification 명령의 파일을 명령을 실행하는 root에서 판단한다. red: 두 명령 모두 hook이
  거부했다. green: `node --test --test-name-pattern=K353-2 tests/kit/claude-hook.test.mts tests/kit/plan.test.mts`가
  2개 중 2개 통과한다 (K353-2).
- `make dependency-policy-check`는 `make dependency-review`처럼 `GOWORK=off`로 실행되므로, linked Go checkout이 어떤 manifest도
  선언하지 않는 lock의 review record를 더 이상 보고하지 않는다 (K343).
- `make lint-ts`, `make commit`, `make item-test`의 type 검사는 package의 `package.json`에 `typecheck` script가 있으면
  그것(`.svelte` 파일이 있는 package는 svelte-check)을 실행하고, 없을 때만 `tsc --noEmit`을 실행한다 (K355).
- Composer project가 linked인 동안 의존성 review와 policy는 locked version을 `composer.link.lock`에서 읽으므로, review record는 relock할
  수 없는 tracked lock이 아니라 Composer가 resolve하고 vendor가 가진 것과 비교된다 (K326-1).
- `make install-packages`는 설치한 패키지를 저장소 옆의 polyspec checkout에 링크하고(`link --siblings`), `CHECKOUTS` 없는 `make link`는
  worktree에서도 그 checkout을 쓰며, `make link-state-check`는 lock에서 설치한 뒤 link 단계가 없는 recipe와 `.php-version`과 다른 PHP를 요구하는
  linked vendor를 실패시킨다 (K349).
- `make item-state`는 verification을 실행하기 전에 done으로의 transition을 검사하므로, waiting row는 stage하지 않은 파일이 아니라 이동할 수 있는 상태와 함께
  거부된다 (K353-1).
- `make item-edit ID= VERIFICATION=`는 `item-new`와 같은 검사를 거쳐 두 언어 row의 Verification 칸을 바꾸고, `make item-state`와 `make
  item-test`의 type 검사는 tsc가 찾지 못하는 workspace package를 build(`npm run build`)한 뒤 다시 compile한다 (K353).
- `make lint-rust`는 P8 은폐도 실패시킨다: `let_underscore_untyped`, `map_err_ignore`, 명시적 `unused_must_use`, `allow_attributes_without_reason`, 그리고 kit이 복사하는 `clippy.toml`은 `#[allow]`가 reason을 밝히지 않는 한 `Result::ok`, `unwrap_or`, `unwrap_or_default`, `unwrap_or_else`를 금지한다. `lint-rust`는 `kit-gates`와 kit의 CI에 들어가므로 P8이 이를 명시한다. Red: type 없는 `let _`와 금지 method가 통과했다. green: 각각 해당 lint로 실패하고 reason을 밝힌 variant는 통과한다 (`tests/source/lint-rust-real.test.mts`) (K334).
- `make parity-declarations-check`는 root에 ecosystem의 manifest(`package.json`, `composer.json`, `pyproject.toml`,
  `go.mod`, `Cargo.toml`)가 없는 `config/parity.json`의 implementation과 다른 implementation의 root를 그대로 가진 implementation을
  실패시킨다. implementation은 source root이지 test glob만이 아니기 때문이다 (K336).
- `make lint-go`는 P8 은폐도 실패시킨다: `check-blank`와 `check-type-assertions`를 켠 errcheck(`_`에 대입한 error, 확인하지 않은 assertion), nilerr, errorlint, nolintlint(`//nolint`는 linter와 reason이 필요하다). Red: 심은 pattern 7개가 통과했다. green: 각각 해당 linter로 실패하고 need를 밝힌 variant는 통과한다 (`tests/source/lint-go-real.test.mts`). symbol extractor `symbols/go/main.go`는 marshal error를 보고한다 (K334).
- `make item-state`는 item의 Verification 칸의 명령이 commit이 담는 tree에서 통과한 뒤에만 done으로 표시한다. 산출 파일은 stage되었거나 commit되어 있어야
  하고, 실패한 명령은 그 상태를 거부한다 (K335).
- 의존성 policy는 일반 Composer release를 version으로 비교하므로, registry의 latest release보다 높은 locked version(예: 0.0.6에 대한 미공개
  `polyspec/template 0.0.11`)은 outdated가 아니다 (K328-1).
- `make lint-python`은 P8 은폐도 실패시킨다: SIM105, typed `try`-`except`-`pass`와 `continue`(`check-typed-exception`의 S110, S112), TRY201, TRY203, TRY400, B012, 규칙 없는 `type: ignore`(PGH003)와 `noqa`(PGH004), 아무것도 억제하지 않는 `noqa`(RUF100). Red: 심은 각 pattern이 lint를 통과했다. green: 각각 해당 rule로 실패하고 need를 밝힌 variant는 통과한다 (`tests/source/lint-python-real.test.mts`) (K334).
- Parity 규칙 R16은 internal test의 모든 match 중 `docs/spec`이 정의한 requirement pattern의 match만 보고하므로, `UTF-8`과 `SHA-256`은
  requirement를 이름으로 부르지 않는다 (K342).
- Composer project가 linked인 동안 `make dependency-review`는 `composer.link.json`과 그 lock으로 Composer를 실행하고, linked
  package를 registry와 비교하거나 update하지 않으며, tracked `composer.json`과 `composer.lock`을 바꾸지 않는다 (K340).
- link와 parity test는 시간이 제한되고 더 싸다. `tests/kit/link.test.mts`의 모든 case는 60초 timeout을 갖고, sandbox repository는 git
  process 6개 대신 설정된 `.git` 폴더 하나의 복사이며, link workspace는 process당 한 번 commit한 repository 세 개를 복사한다 (K301).
- Parity 규칙 R17(leaked-internal)은 internal symbol을 이름으로 가리키는 public signature, parent class, interface를 finding으로 한다.
  대상은 `@internal` PHP class, `_`로 시작하는 private Python 이름, entry point가 export하지 않는 TypeScript type(API Extractor
  `ae-forgotten-export`)이다 (K307-1).
- Parity 규칙 R10은 구현의 개수를 말하는 문구만 센다. 복합 명사의 수식어("one language service")와 비교의 쌍("between the two languages")은 개수로 보지
  않는다 (K311).
- `make duplication-check`는 `config/duplication.json`의 exclude glob을 설정 파일로 jscpd에 넘기므로, `{tests,spec}/**` 같은 중괄호
  glob은 중괄호를 유지하고 그 이름의 파일을 제외한다 (K310).
- kit에서 `make lint-ts`가 통과한다. link, divergence check, PHP library autoload의 test와 tool은 JSON을 schema나 guard로 읽고,
  real-tool test의 `php` binary는 `config/knip-entries.json`에 선언한다 (K333).
- `make lint-ts`는 TypeScript가 있는 각 `tsconfig.json`의 폴더에서 `tsc --noEmit -p tsconfig.json`을 실행하고, vitest와 node는 type 검사
  없이 transpile하므로 `make commit`과 `make item-test`는 변경된 각 TypeScript 파일이 속한 `tsconfig.json`으로 이를 실행해 type error면 거부한다
  (K309).
- `kit link`는 install recipe의 uv sync가 editable을 제거한 뒤처럼 환경에 없는 선언된 polyspec Python package를 provider 폴더의 editable
  install로 설치하므로, 두 번째 실행도 첫 번째처럼 linked로 끝난다 (K316-2).
- Parity 규칙 R6은 bound 파일처럼 어느 구현의 `internal` glob이 고르는 test 파일도 제외하므로, PHP 구현의 internal node 실행 test는 R6에 걸리지 않는다
  (K332).
- `kit link`는 linked package의 partial `composer update`를 `--with-dependencies`로 실행하므로, linked package가 새 constraint로
  요구하는 dependency는 resolve되고 관계없는 package는 locked release에 남는다 (K331).
- Composer는 `repositories`를 root manifest에서만 읽으므로, `make dependency-policy-check`는 polyspec package를 require하는 root
  `composer.json`에 그 package의 `composer.json`이 선언한 repository가 없으면 package와 repository 이름과 함께 실패하고, `kit link`는 linked
  package가 선언한 repositories를 `composer.link.json`에 쓴다 (K330).
- `make test-php-ext`의 extension 실행은 library의 PHPUnit 파일을 load하고 library의 source는 하나도 load하지 않는다(K329) in S10: `run-tests phpunit --without-library <폴더>`가 library의 vendor directory 위에 Composer가 dump한, library의 dependency와 autoload-dev는 담고 library 자신의 autoload는 담지 않는 autoloader로 PHPUnit script를 시작하며, library의 source를 include하는 test는 실행을 실패시킨다. `make divergence-check`는 Git이 무시하는 구현 root 아래의 source도 읽고 `function_exists`를 `extension_loaded`처럼 보고하므로 library에는 extension에 대한 guard가 없다. Red: `node --test tests/source/php-library-real.test.mts`에서 library autoload로 library의 source가 load되었다. Green: 하나도 load되지 않고 require한 source는 실행을 실패시킨다.
- 연결된 패키지(Composer project의 link lock의 path dist, `node_modules`의 심볼릭 링크)는 `make dependency-review`와 `make dependency-policy-check`에서 registry의 최신 release와 비교하지 않고 외부 패키지는 여전히 비교한다(K328). 개발 중에는 local checkout이 canonical이므로 그 패키지는 link로 판단하고 registry 비교는 일괄 release의 검사에 속한다. Red: `node --test --test-name-pattern=K328 tests/kit/dependency-policy.test.mts`가 연결된 패키지에 `psr/log: 3.0.2 is older than 99.0.0`으로 실패했다. Green: 통과하고 외부 패키지는 여전히 보고된다.
- 저장소는 `mise.toml`에 http backend로 내려받는 자기 도구를 선언할 수 있다(K327). key는 `http:<이름>`이고 정확한 `version`과 https `url`을 가진 table이다. `mise.lock`이 모든 platform의 sha256을 pin하고 `make toolchain-check`가 sha256이 빠진 platform을 이름으로 알린다. kit이 검사하지 않는 다른 backend의 도구는 여전히 거부한다. Red: `node --test --test-name-pattern=K327 tests/kit/toolchain-mise.test.mts`가 `mise.toml tools declares http:pie, which kit does not check`로 거부되었다. Green: 통과한다.
- `make divergence-check`(K315)는 모든 저장소의 gate이다. extension, runtime, platform으로 분기하는 test, 다른 구현이 있는지 읽는 구현의 code, `--exclude-group`, `contracts/features.json`의 `partial`이나 `unsupported`, reason이 kit이 정한 kind(`generated:`, `fixture:`, `test:`, `harness:`, `ecosystem:`, `external:`)로 시작하지 않는 `config/duplication.json`의 예외와 `config/parity.json`의 `tools`, `internal`에 실패한다. `make test-markers-check`는 `testing.Short()`, `pytest.importorskip`, `@requires`, `#[Requires...]`, `node:test` context의 skip도 읽고, `make item-state`는 cause가 release, 재현되지 않음, flake, 일시적이거나 무관한 실패, 환경을 인용하는 bypassed나 impossible 상태를 거부한다. 2026-10-21의 finding: orm 101(test 분기 68, partial feature 18, 예외 11, code 분기 4), template 12, crudui 44, hyper 10, fsm 5, ordered-json 4, ssr 5. Red: 검사가 없었다(case가 `divergenceFindings`를 import한다). Green: `node --test tests/kit/divergence-check.test.mts`가 각 kind를 찾는다.
- provider 폴더의 non-editable 설치나 릴리스 wheel 위의 link는 editable install이 된다(K316-1): 설치의 overrides 파일은 연결된 package마다 `-e <폴더>` 줄 하나를 담는다. `name @ file://<폴더>` 줄은 uv가 non-editable 요구로 보게 해서 명령줄의 `-e`보다 우선하고 package를 non-editable로 남겼기 때문이다(이 checkout의 uv로 확인: URL 줄이면 `dir_info`가 비고 `-e` 줄이면 `{"editable":true}`이며, 다른 package를 릴리스 URL로 요구하는 package도 마찬가지이다). registry나 archive 설치의 메시지는 그렇게 말한다. Red: `node --test --test-name-pattern=K316-1 tests/kit/link.test.mts`가 `name @ file://` 줄을 찾았다. Green: `-e` 줄을 찾는다.
- linked 패키지의 `composer.link.json` path repository는 `symlink`와, lock이 기록한 릴리스(없으면 project가 요구하는 정확한 릴리스)로 정한 `versions`를 가지고 다른 repository보다 앞에 오므로, Composer가 그 릴리스를 폴더로 취하고 같은 version의 archive를 택하지 않는다(K304-2). orm, hyper(root와 `examples/board`), crudui의 link lock은 연결된 모든 polyspec 패키지를 dist type `path`로 가지며 `platform_check.php`가 폴더에서 나온 PHP 8.4.1 또는 8.4.0이다. Red: lock에 없는 패키지는 `versions`를 받지 못했다. Green: `node --test --test-name-pattern=K304-2 tests/kit/link.test.mts`가 통과한다.
- Composer project가 link된 동안(`composer.link.lock`이 있는 동안) `make dependency-policy-check`는 그 project의 platform과 `composer validate`를 `composer.link.json`과 `composer.link.lock`에서 판단하고, link manifest의 path repository의 패키지를 link lock이 다른 dist로 가지면 실패시키며, 추적되는 lock의 review hash는 일괄 release의 검사에 맡긴다(K326). Red: `node --test --test-name-pattern=K326 tests/kit/dependency-policy.test.mts`가 PHP 8.5.0으로 resolve된 추적되는 lock에서 실패했다. Green: link lock에서는 통과하고 다른 platform이나 dist의 link lock은 여전히 실패시킨다.
- `config/parity.json`의 구현은 이유를 단 `internal` glob을 선언한다(K313). 맞는 test는 parity unit이 아니므로 R5가 binding을 요구하지 않고 어떤 binding도 부를 수 없으며, spec의 requirement를 부르지 않으므로(R16) contract test가 거기 숨을 수 없고, test를 고르지 않는 glob은 선언을 실패시킨다. 기존 `tools`가 contract를 구현하지 않는 단일 언어 package를 이미 덮으므로 `outside` 선언은 더하지 않는다. Red: schema가 선언을 거부했고 R5가 internal 파일을 지적했다. Green: `node --test --test-name-pattern=K313 tests/kit/parity.test.mts`가 통과한다.
- conductor의 상시 결정은 kit의 규칙이다(K314): PRINCIPLES P32~P35가 범위(모든 구현의 contract 동작, 고유한 통합은 중립 규칙 하나, parity unit이 아닌 내부 test, `docs/spec`에 없는 규칙은 먼저 쓰기, unit을 버리지 않음, test 없이 인용하지 않음, 검사를 피하려는 이름 변경 금지, 반복된 code 재구성, 생성물 미추적)와 provider(release 때문에 막힌 finding은 link 결함)를 각각 `Enforced by`와 함께 적고, `docs/operations/adoption.md`가 item 경계의 절차와 물을 수 있는 질문을 적는다. Red: 결정이 message와 scratch 파일에 있었다. Green: `node scripts/kit/check-rules.mts`가 각 규칙을 그 검사와 함께 읽는다.
- `make bypass-check`(K308)는 모든 저장소의 gate이다. workflow 밖에서 CI identity(`GITHUB_ACTIONS`, `CI`)를 설정하거나, `make -o`, `--old-file`, `--assume-old`에 `kit-gates`의 gate를 적거나, `--no-verify`를 쓰는 추적되는 test, script, Makefile, Git hook에 실패하고, kit 자신의 도구와 test는 제외한다. Red: 검사가 없어서 `GITHUB_ACTIONS: 'true'`나 `make -o toolchain-check`를 가진 test가 모든 gate를 통과했다(case가 `bypassFindings`를 import한다). Green: `node --test tests/kit/bypass-check.test.mts`가 각각을 찾는다.
- `make rules-check`는 make target을 부른 변수 집합마다 한 번 펼치므로 workflow의 모든 `make ci-targets TARGETS=...` 호출에 닿고, 뒤의 호출의 target으로 강제되는 규칙이 어디서도 실행되지 않는다고 보고되지 않는다(K312). Red: `node --test --test-name-pattern=K312 tests/kit/check-rules.test.mts`가 `make second`를 닿지 않았다고 보고했다. Green: 아무것도 찾지 않는다.
- `make test-js`와 `make test-ts`는 package의 `*.test.*`와 `*.spec.*` 파일, 곧 node와 vitest 규약의 이름만 부르므로 `tests/` 아래의 probe나 helper는 test로 실행되지 않는다(K325). Red: `node --test --test-name-pattern=K325 tests/kit/runtime-targets.test.mts`가 `tests/probe.mjs`와 `tests/helper.mts`를 나열했다. Green: test 파일만 나열한다.
- `make test-python`은 package의 test를 그 package의 환경에서 실행한다. package 폴더 이하 위쪽의 가장 가까운 `.venv`를 `--venv`로 싣는다(K324). 그래서 package의 dependency가 import된다. Red: `node --test --test-name-pattern=K324 tests/kit/runtime-targets.test.mts`가 `--venv` option을 기대했는데 실행에 없었다. Green: 통과한다.
- kit이 쓰는 Composer project(`config/php-lint`, `config/phpunit`, symbol extractor)는 `composer.json`과 lock의 `platform-overrides`에서 `.php-version`의 minor에 patch 1을 붙인 PHP 8.4.1로 resolve한다(K322). Red: `node --test tests/kit/php-platform.test.mts`가 config/php-lint와 extractor project에서 `8.4`를 찾았다. Green: `8.4.1`을 찾는다.
- suite `CHECK_TARGETS`는 `suiteTargets`가 `$(VAR)` 단어를 펼쳐서 읽으며, `kit-check`의 gate 검사와 owner 검사가 이를 쓴다(K321). Red: `node --test --test-name-pattern=K321 tests/kit/kit-check.test.mts`가 `$(MORE)`가 `docs-check`를 담는데도 빠졌다고 보고했다. Green: 아무것도 찾지 않는다.
- `make link-state-check`는 kit이 쓰는 Composer project(`kit.copies`의 사본, `config/php-lint`, `config/phpunit`)를 제외하므로 그런 것만 가진 저장소는 Composer가 필요 없다(K320). Red: `node --test --test-name-pattern=K320 tests/kit/link-state-check.test.mts`가 없는 Composer 때문에 throw했다. Green: 아무것도 찾지 않는다.
- `make lint-php`와 `make lint-python`은 PHP나 Python source가 없는 저장소에서 통과한다. 도구나 설정을 찾기 전에 step이 비어 있다(K319). Red: 문서만 있는 tree에서 `node --test tests/kit/lint-php.test.mts tests/kit/lint-python.test.mts`가 없는 도구 때문에 throw했다. Green: 둘 다 step 없이 돌아온다.
- Composer 패키지는 폴더가 link이고 `installed.json`이 `dist` type `path`를 기록할 때만 linked로 센다(K318). 옛 mechanism이 남긴 릴리스 archive 설치 위의 link는 partial update가 다시 설치하고, 이미 link된 폴더도 같은 update에 남으며, `link-state-check`는 기록이 다른 dist type인 link를 실패시킨다. Red: 손으로 만든 link 아래 archive 설치가 있는 `tests/source/link-composer-real.test.mts`에서 archive가 유지되었다(기록 dist type `zip`). Green: 기록이 `path`이고 platform check가 폴더를 따른다.
- Python link는 provider 폴더의 editable install이다(K316): lock의 constraints와 연결된 각 패키지를 폴더의 URL로 지정하는 overrides 파일로 `uv pip install --reinstall-package <이름> -e <폴더>`를 실행한다. `var/link/wheels`에 wheel을 build하거나 보관하지 않고, 상태는 `direct_url.json`(폴더와 `dir_info.editable`)에서 읽으며, uv가 그 설치 시점에 `Requires-Python`과 요구사항을 검사한다. fingerprint, prebuilt wheel, read-only stale 경로는 제거했다. Red: link test가 `-e <폴더>` 설치를 기대했는데 `uv run`으로 build한 wheel이었다. Green: 통과하며 이 checkout의 실제 uv가 다른 연결된 패키지를 릴리스 URL로 요구하는 패키지를 `-e`와 override로 설치한다.
- Composer link는 Composer가 스스로 설치하는 `symlink` path repository이다(K304-1): link는 git이 무시하는 `composer.link.json`(추적되는 `composer.json`에 provider 폴더마다 path repository를 repositories 앞에 두고 lock의 릴리스를 version으로 쓴 것)과 lock의 사본을 쓰고 연결된 polyspec 패키지와 자기 path 패키지에 `COMPOSER=composer.link.json composer update`를 실행한다. 설치된 폴더는 심볼릭 링크이고 기록, autoload 규칙, platform check는 폴더의 `composer.json`에서 나오며, `composer.json`과 `composer.lock`은 그대로이고, `unlink`는 link 파일을 지운다. K304의 손으로 한 `installed.json` 수정은 제거했다. Red: link test가 `composer.link.json`을 쓰는 `composer update`를 기대했는데 `dump-autoload`였다. Green: 통과하며 `tests/source/link-composer-real.test.mts`가 실제 Composer로 archive가 PHP 99를 요구하는 패키지를 폴더에서 설치한다.
- `make link-state-check`가 `link-metadata-check`를 대체한다(K305-1): link는 설치된 릴리스 버전으로 간주되므로 version도 요구사항도 비교하지 않으며, link가 있는 동안 link들 사이의 사본인 설치된 0.0.x polyspec package, 그 이름의 package로 풀리지 않는 link, `go.mod` 없는 `go.work`의 `use` 폴더에 대해 package를 적어 실패한다. PRINCIPLES P30과 local-links가 owner 규칙을 적는다. Red: `tests/kit/link-state-check.test.mts`가 없는 module을 import했고 낡은 기록이 옛 gate를 실패시켰다. Green: 통과한다.
- PHP symbol extractor는 docblock에 `@internal`을 가진 class, function, constant, method, property를 public API로 보지 않으며(phpstan과 psalm의 의미), 그 tag를 가진 class는 member를 숨긴다(K307). Red: `node --test tests/source/symbols-php-real.test.mts`가 `A\\Hidden`, `A\\Open::secret` 등 internal symbol을 나열했다. Green: public인 것만 나열한다.
- `parity.mts`는 extractor와 runner를 `toolsEnvironment(root)`로 실행하므로, mise shim이 consumer에서 "mise.toml not trusted"로 실패하지 않고 checkout의 mise 환경을 찾는다(K306). Red: `MISE_GLOBAL_CONFIG_FILE`이 필요한 python shim으로 `node --test --test-name-pattern=K306 tests/kit/parity.test.mts`가 실패했다. Green: 통과한다.
- `make link-metadata-check`(K305)는 모든 저장소의 gate이다. link가 있는 동안 연결된 npm 패키지가 그 이름의 패키지로 풀리지 않거나, installed.json의 Composer 기록이 install-path의 composer.json과 다르거나, editable Python 설치의 Version 또는 Requires-Python이 pyproject.toml과 다르거나, go.work의 use 폴더에 go.mod가 없으면 패키지와 field를 적어 실패하고, link가 없는 checkout은 통과한다. Red: gate가 없어서 hyper의 낡은 기록이 모든 gate를 통과했다(case가 `linkFindings`를 import한다). Green: `node --test tests/kit/link-check.test.mts`가 통과하고 gate가 `hyper/examples/board`의 낡은 기록을 보고한다.
- Composer link는 `composer dump-autoload` 전에, 링크된 package와 프로젝트의 path package에 대해 연결된 source의 composer.json의 `require`, `autoload`, `replace`, `provide`, `conflict`, `version`을 installed.json에 가져오므로 platform check와 autoload 규칙이 source 그대로를 따른다(K304). Red: `node --test --test-name-pattern=K304 tests/kit/link.test.mts`에서 기록이 릴리스된 `php >=8.5`를 그대로 요구했다. Green: source의 `>=8.4`를 기록한다.
- `make toolchain-check`는 `packages/php-ext`가 있는 저장소에서 `make php-ext-arginfo`가 필요로 하는 system 명령을 알린다: PHP의 gen_stub.php가 PHP-Parser를 내려받고 풀 때 쓰는 `curl` 또는 `wget`과 `tar`이다(K303). 고정된 Composer PHP-Parser는 택하지 않았다. gen_stub.php가 자기 PHP에 맞는 release를 하나로 정하기 때문이다. Red: 빠져 있어도 toolchain-check가 조용했다(case가 없던 `arginfoToolFindings`를 import한다). Green: `node --test --test-name-pattern=K303 tests/kit/check-toolchain.test.mts`가 통과한다.
- `make build-php-ext`와 `make php-ext-arginfo`의 build 사본은 extension의 source(stub, config.h를 뺀 C와 header 파일, config.m4, config.w32, src/ 옆의 composer.json)만 담고 build folder나 산출물은 담지 않으므로, 무시된 src/에 남은 낡은 object나 module이 build되거나 게시될 수 없다(K302). Red: `node --test --test-name-pattern=K302 tests/kit/php-ext.test.mts`가 C가 compile되지 않는데도 extension을 built로 보고했다. Green: build가 실패하고 아무것도 게시하지 않는다.
- `make rules-check`는 AGENTS.md를 구조로 읽는다(K300): PRINCIPLES.md의 각 규칙에는 id(P<n>, S<n>)가 있고, AGENTS.md의 각 규칙은 `Own:` 또는 `Refines <id>:`로 시작하며, 다듬는 규칙은 PRINCIPLES.md에 없는 기존 경로나 make target을 backtick으로 적는다. K279의 4단어 유사도는 제거했다. kit의 AGENTS.md와 한국어 쌍이 이를 따른다. Red: `node --test --test-name-pattern=K300 tests/kit/check-rules.test.mts`에서 짧은 되풀이 "Build modular components"에 finding이 없었다. Green: 통과한다.
- spec의 requirement는 `**<id>**`로 시작하는 list item, 곧 글머리 기호(`-`, `*`, `+`)나 번호(`1.`, `1)`) 항목, 또는 heading으로 정의한다(K299). S6과 schema는 list item이라고 적는다. Red: `node --test --test-name-pattern=K299 tests/kit/parity-requirements.test.mts`가 `1. **AB-4**`에 R13을 찾지 못했다. Green: 통과한다.
- `make test-python`은 `test_*.py`를 담고 `__init__.py`가 없는 Python package의 test directory를 더할 파일을 적어 거부한다. unittest는 directory를 package로만 discover하므로 그렇지 않으면 아무 test도 실행하지 않았다("no test ran")(K298). orm, template, crudui, hyper는 이미 test directory를 package로 만들었고 ordered-json이 파일을 더한다. Red: 바뀌지 않은 runner가 실행을 돌려주어 `node --test --test-name-pattern=K298 tests/kit/runtime-targets.test.mts`가 실패했다. Green: 통과한다.
- S10은 PHP library가 둘 이상인 저장소에도 성립한다(K293): extension 하나가 모든 library를 구현하며, library는 `polyspec/<repository>`라는 이름의 `packages/php`이거나 `polyspec/<repository>-<component>`라는 이름의 `packages/<component>/php`이다. `make lint-php-ext`가 그 이름을 확인하고, `make test-php-ext`가 등록한 이름마다 그것을 선언한 library와 비교하며 모든 library의 PHPUnit 파일을 실행하고, parity extension이 모든 library의 implementation을 공유한다. Red: `packages/php` 하나를 가정해서 `tests/kit/php-ext.test.mts`, `runtime-targets.test.mts`, `parity.test.mts`의 K293 case가 실패했다. Green: 통과한다.
- `make plan-split FROM= TO= IDS=`는 item의 행을 sub-item과 함께 text를 바꾸지 않고 한 plan의 checklist에서 다른 plan의 checklist로, 한국어 쌍에서도 옮기고, 대상 plan이 없으면 만들며, 거부하면 아무것도 쓰지 않는다(K292). Red: `splitPlan`이 없어서 `node --test tests/kit/plan.test.mts`가 실패했다. Green: 통과한다.
- `make lint-php-ext`, `make build-php-ext`, `make php-ext-arginfo`는 tracked 파일과 함께 disk의 `packages/php-ext` 파일을 읽으므로, `src/`를 생성하고 Git이 무시하는 extension도 tracked와 똑같이 통과한다(K297). Red: `node --test --test-name-pattern=K297 tests/kit/php-ext.test.mts`가 `the stub of the extension is missing`으로 실패했다. Green: 통과한다.
- 문서는 존재하는 규칙을 적는다(K291): local-links는 모든 개발이 끝나기 전에는 kit을 포함해 어떤 저장소에서도 릴리스, tag, 버전 올림을 하지 않으며 push는 아무것도 게시하지 않는다고 적고, tool-inventory의 language parity 절은 S6이 선언에서 없앤 profile, admit 목록, exclusion(R8), nativeOnly 항목, spec anchor를 더는 기술하지 않는다. Red: 본문이 이들을 기술했다. Green: `node scripts/kit/check-documents.mts`가 통과하고 절이 `parity.schema.json`을 따른다.
- pyproject의 dependency array에 `[build-system] requires`가 포함되므로 `make dependency-review UPDATE=1`이 setuptools 같은 build requirement를 project의 것처럼 pin한다(K296). Red: `node --test --test-name-pattern=K296 tests/kit/pin-python-dependency.test.mts`가 setuptools의 exact pin이 없다며 실패했다. Green: 통과한다.
- `make build-php-ext`와 `make php-ext-arginfo`는 `composer.json`을 `src/` 옆에 둔 사본에서 작업하므로 `config.m4`가 version의 유일한 source인 `../composer.json`에서 package version을 읽는다(K295) in S10. Red: `node --test tests/kit/php-ext.test.mts`가 build한 fixture의 `phpversion()`이 composer.json의 1.2.3이 아니라 비어 있어 실패했다. Green: 통과한다.
- `make php-ext-arginfo`는 header의 규칙이 configure가 쓰는 Makefile에 있으므로 header를 만들기 전에 사본에서 ./configure를 실행한다(K290). Red: `node --test --test-name-pattern=K290 tests/kit/php-ext.test.mts`가 `make: *** No rule to make target polyspec_demo_arginfo.h`로 실패했다. Green: 통과한다.
- `make rebuild-check`는 consumer 자신의 package.json에는 없는 kit.copies가 아니라 설치된 kit(`node_modules/@polyspec/kit/package.json`의 kit.copies, kit-check가 읽는 것과 같다)가 나열하는 vendored 사본을 제외한다(K294). Red: `node --test --test-name-pattern=K294 tests/kit/rebuild-check.test.mts`가 사본을 tool source로 나열해 실패했다. Green: 통과한다.
- `make dependency-policy-check`는 PHP platform을 하나로 요구한다(K282): composerPlatforms의 모든 항목과 Composer manifest의 모든 config.platform.php가 같은 PHP를 가리키고, .php-version이 있으면 그 minor에 PHPUnit 13이 요구하는 patch 1을 붙인 값(8.4.1)이다. Red: 검사를 되돌린 상태에서 `node --test --test-name-pattern=K282 tests/kit/dependency-policy.test.mts`가 실패했다(platform finding 없음). Green: 통과한다. hyper, fsm, orm, template(8.4.0)은 이제 이 규칙에 실패한다.
- version이 아닌 Composer 응답은 version으로 기록하지 않는다(K281): `version.mts`의 `isVersionText`가 composer outdated의 "[none matched]"를 거부하므로 dependency-review는 release 없음으로 보고하고 dependency-policy-check는 latest가 version이 아닌 review 기록을 실패시킨다. Red: dependency-review와 dependency-policy test의 `--test-name-pattern=K281`이 실패했다(sentinel이 기록되고 받아들여졌다). Green: 둘 다 통과한다.
- `make rules-check`는 PRINCIPLES 규칙을 되풀이한 AGENTS 규칙을 실패시킨다: 4단어 연속의 4분의 1을 넘는 부분이 PRINCIPLES.md의 한 규칙에 있는 경우이다(K279). 일곱 저장소의 AGENTS 규칙은 kit의 되풀이한 규칙(0.29, 0.71, 0.82)을 빼면 0.15 이하였고, kit의 사본 네 개를 제거했다. Red: `node --test --test-name-pattern=K279 tests/kit/check-rules.test.mts`가 되풀이한 규칙에 finding을 내지 않았다. Green: 통과하며 kit에서 `node scripts/kit/check-rules.mts`가 통과한다.
- `make kit-check`는 저장소의 CHECK_TARGETS가 kit-gates의 모든 prerequisite에 단어나 prerequisite로 닿을 것을 요구하며, 언어의 lint와 PHP extension gate는 그 code를 가진 저장소에서만 요구한다(K289). Red: suite를 읽는 check가 없어서 language-check, rebuild-check, duplication-check가 없는 저장소도 kit-check를 통과했다(case가 없던 `gateFindings`를 import한다). Green: `node --test tests/kit/kit-check.test.mts`가 통과하고 kit-check가 hyper, fsm, ordered-json, crudui에서 빠진 gate를 지목한다.
- `make duplication-check`는 jscpd 자체의 `--ignore-pattern`으로 logic이 없는 줄의 token을 건너뜁니다(K287): PHP의 declare, namespace, use, TypeScript와 JavaScript의 import(한 줄과 block), Go의 package와 import(단일과 block), Python의 import와 from-import, Rust의 use(단일과 중괄호), C의 #include. docblock, signature, mode, 최소 token 수는 그대로입니다. Red: `node --test --test-name-pattern=K287 tests/kit/duplication-check.test.mts`가 header만 같은 두 file이 보고되어(`1 !== 0`) 7개 case 모두 실패했습니다. Green: 7개 모두 통과하며 6줄 body가 같은 두 file은 여전히 실패합니다.
- kit의 typecheck가 통과한다(K288): `tests/kit/link.test.mts`의 두 assertion은 문자열 message를 넘기고 `tests/kit/parity-requirements.test.mts`는 `caseFile`을 주어졌을 때만 지정한다. Red: `npx tsc --noEmit -p .`가 link.test.mts(384,125)와 (387,134)의 TS2769, parity-requirements.test.mts(65,106)의 TS2375를 나열했다. Green: 출력이 없다.
- `make rebuild-check`는 저장소의 layout(`scripts/`, package의 `scripts|tools|bin`, generator, benchmark, example, fixture generator)으로 tool source를 찾고 `config/rebuild.json`은 분류만 한다: `paths`를 없앴으므로 저장소는 gate가 보는 범위를 좁힐 수 없다(K286). 좁은 `paths`가 가리던 `install-php.mts`와 PHP·Python symbol extractor의 class를 kit 자신의 config에 추가했다. Red: `node --test tests/kit/rebuild-check.test.mts`가 선언한 path 밖 tool의 case에서 실패했다(benchmarks/run.js와 packages/codec/tools/make.mjs가 통과). Green: 통과하며, `node scripts/kit/rebuild-check.mts`는 처음에 kit의 미분류 tool 다섯을 지목한 뒤 통과한다.
- PHP extension의 test는 `packages/php`의 PHPUnit 파일이다(K285), S10: `make test-php-ext`는 extension을 load해 `packages/php`(그리고 test가 있으면 `packages/php-ext`)를 실행하고, root `packages/php-ext`의 parity implementation은 layout에 따라 root `packages/php`의 implementation을 공유하므로, 저장소는 `config/parity.json`에 상대 경로(`../php/tests`)를 선언하지 않는다. Red: test 없는 fixture extension에 `node --test tests/kit/runtime-targets.test.mts`가 `cwd: 'packages/php-ext'`로 실패했고, `node --test --test-name-pattern=K285 tests/kit/parity.test.mts`가 `php-ext`의 R6을 찾았다. Green: 둘 다 통과한다.
- var/tools의 Composer project 설치(PHPUnit, PHP lint)는 최신일 때만 유지한다: 설치의 composer.lock이 project의 lock과 byte 단위로 같고 Composer 자체의 `composer check-platform-reqs --lock`이 wrapped PHP 아래에서 통과해야 하며, 아니면 `make install-tools`가 다시 설치한다. 그래서 PHP 8.5로 만든 설치가 PHP 8.4에서 `Composer dependencies require a PHP version >= 8.5.0`으로 실패하지 않는다. Red: `node scripts/kit/run-tests.mts node -- tests/kit/install-composer-project.test.mts` 0 passed, 3 failed; green: 3 passed (K284).
- `make install-tools`는 `.php-version`의 PHP를 탐색해서 제공한다: PATH의 해당 minor `php`, 없으면 apt의 `php<minor>`, 없으면 Homebrew의 `opt/php@<minor>` keg. Composer 설치 전에 php, php-config, phpize의 exec wrapper를 var/tools/bin에 쓰므로, machine이 어떤 PHP를 PATH 앞에 두어도 모든 저장소가 고정된 PHP로 실행되고, 일치하는 것이 없으면 시도한 목록과 함께 실패한다. Red: `node scripts/kit/run-tests.mts node -- tests/kit/install-php.test.mts` 0 passed, 9 failed; green: 9 passed (K283).
- link는 소비자 자신의 환경의 각 프로젝트를 `--no-deps`로, 연결된 각 provider를 dependency와 함께 두 번의 install로 설치합니다. 소비자 자신의 프로젝트의 dependency는 소비자의 lock sync가 제공하므로, 다른 방식으로 제공되는 path dependency를 가진 프로젝트가 더는 install을 실패시키지 않습니다 (K280).
- directory suite의 case directory는 자신이 test하는 requirement를 `case.json`의 `requirements`(JSON으로 읽음)에 나열합니다. R15는 unit의 case 집합의 case.json 하나가 나열한 id를 이름이 있는 것으로 세고, 없거나 형식이 틀린 case.json은 declaration finding이며, docs/spec이 정의하지 않는 id는 R14입니다. unit은 `caseFile`을 선언해 그 파일을 가진 case directory만 가질 수 있습니다 (K277).

## 0.0.54

- ID는 마지막 -<number> 앞부분이 그 저장소 pattern의 ID일 때만 sub-item이므로, S-01 같은 ID 체계는 부모 S를 요구하지 않는다 (K249-5).
- parity 선언에는 `admit` key가 없다: 모든 구현이 모든 suite의 모든 case를 실행하므로, 한 구현이 건너뛰는 case는 더 이상 영구 차이가 아니다 (K276-1).
- config/parity.json은 모든 unit을 모든 구현이 가진다고 선언합니다: `profiles`, `nativeOnly`, `exclusions`와 unit의 `profile`이 없고(schema가 거부합니다), R8과 R11의 native-only 절이 없으며, width와 size suite는 모든 구현에 있습니다 (K276).
- suite 또는 feature unit은 각 binding의 test 또는 suite의 vector file이 이름으로 적은 requirement만 인용하고(R15), 그런 unit만 requirement를 추적한다: unit이 spec의 모든 requirement를 인용해 R13을 통과할 수 없다 (K275).
- parity declaration check는 인용된 spec file을 한 번만 parse한다: anchor마다 file을 다시 parse해서 큰 spec에서 8분이 걸렸다 (K274).
- config/parity.json은 requirements.pattern을 선언하고, 모든 unit은 자신이 test하는 requirement를 인용한다: docs/spec이 정의했으나 어떤 unit도 인용하지 않는 requirement는 실패하고(R13), 정의되지 않은 것을 인용하는 unit도 실패한다(R14). 구현을 가진 repository는 requirement id를 spec에 쓴다 (K273).
- kit-gates가 전체 parity check를 실행한다: config/parity.json의 모든 binding이 CI에서 각 구현마다 실행되므로, 한 언어에서만 test된 feature는 gate를 실패시킨다 (K272).
- kit 테스트가 installed version 규칙, TSX parser, release tag 단계를 따른다: 어떤 테스트도 version 비교를 기대하지 않고, 모든 sandbox 저장소는 initRepository로 만들며, 어떤 comment도 저장소를 이름 짓지 않는다 (K271).
- kit은 gate workflow `workflows/gates.yml`을 모든 저장소의 `.github/workflows/gates.yml`로 vendor한다. 저장소를 설치하고 PRINCIPLES.md의 규칙을 강제하는 모든 check인 `make -k kit-gates`를 실행하므로, 어떤 저장소도 gate를 CI에 손으로 연결하지 않는다 (K270).
- language check는 Go와 Rust의 raw string을 여러 줄에 걸쳐 데이터로 읽으므로, 그 안의 한국어 데이터는 identifier가 아니다 (K268-1).
- 저장소는 고정 작업이 아닌 suite target `check`를 유지하고, `make install`은 저장소가 더한 install 단계보다 먼저 kit의 bootstrap을 prerequisite `install-kit`으로 실행한다 (K246-2).
- release는 tag와 함께 release workflow를 dispatch해서 시작한다. `make release-tag`가 origin/main에 annotated tag를 만들어 push하고, tag가 이미 그 commit을 가리키면 통과하므로, 어떤 machine도 tag를 push할 필요가 없다 (K269).
- language check와 test-markers check는 JSX와 TSX를 읽는다. JSX를 읽지 못하는 Node.js의 type stripping과 acorn 대신, 이제 package의 의존성인 oxc-parser로 script를 해석하고 tree의 모든 node를 `script-ast.mts`에서 type으로 순회한다 (K268).
- kit-sync, kit-check, lint-ts는 버전과 상관없이 설치된 @polyspec/kit을 읽는다. npm ci가 lock의 integrity로 설치할 때 강제하며, 개발 상태인 kit checkout의 local link를 더는 버전 때문에 거부하지 않는다 (K267).
- kit 0.0.54가 K243~K266의 공통 표준과 함께 release된다 (K263).
- isolation test는 다른 polyspec 저장소 이름만 쓴다. history 재작성이 외부 프로젝트 이름을 공통 단어 consumer로 바꿔, 목록이 그것을 모든 곳에서 거부했다 (K266).
- vendored knip.json은 어떤 binary도 허용하지 않는다. K247이 `ignoreBinaries` php를 넣었는데, php를 실행하지 않는 저장소의 knip이 configuration hint를 출력했다. PHP extension test는 도구처럼 process.mts의 `execute`로 php를 실행한다 (K247-1).
- package test는 `make kit-build`로 kit을 build하고, package.json의 build와 prepack script도 그것을 실행한다. K246이 `make build`를 runtime 집계로 바꿨는데, Git과 var/tools의 node가 없는 복사본은 그것을 실행할 수 없다. runtime target과 PHP extension의 test는 isolation test가 요구하는 대로 다른 저장소 이름을 쓰지 않는다 (K246-1).
- commit check는 AI 도구가 commit의 author나 committer인 것을 range, commit-msg hook, `make commit`에서 거부한다(`commit-ai-identity`). test의 sandbox 저장소는 자기 identity를 가진다 (K265).
- commit check는 AI 도구의 footer, 곧 그 co-author나 session trailer 또는 generated-with 줄을 range, commit-msg hook, `make commit`에서 거부한다(`commit-ai-footer`) (K264).
- 없는 phpcs 또는 PHPStan은 install-tools가 거부하는 `make install-tools TOOLS=phpLint` 대신 config/php-lint를 설치하는 `make install-tools`를 안내한다 (K262).
- layout 규칙 suites-at-root가 적용된다. 어떤 규칙도 확장하지 않는 config/layout.kit.yml의 templates 안에 있어 어떤 checkout도 실행하지 않았다. 실제 layout test가 package 안에 suite를 심는다 (K244-1).
- PHP extension은 S10을 따른다. `packages/php`의 PHP library `polyspec/<repository>`를 구현하고, stub 하나 `src/polyspec_<repository>.stub.php`와 함께 `packages/php-ext/`에 두며, 이름은 `polyspec/<repository>-php-ext`와 `polyspec_<repository>`이다. `php-extension.mts`는 이름과 arginfo header의 stub hash를 확인하고(`make lint-php-ext`), phpize로 extension을 var/php-ext에 build하며(`make build-php-ext`), PHP의 gen_stub.php로 header를 쓰고(`make php-ext-arginfo`), unit test 전에 extension이 등록한 것을 Reflection으로 PHP library와 비교한다(`make test-php-ext`). layout 규칙은 다른 곳의 stub을 거부하고, kit의 CI가 lint와 test를 실행하며, knip은 binary php를 허용한다 (K247).
- 작업의 make target은 kit.mk와 kit-bootstrap.mk가 정의하는 고정된 이름을 가진다. `install`, `build`, `test`, `lint`는 `packages/`의 각 runtime의 target을 실행하고, `build-<runtime>`은 그 ecosystem의 build를 실행하며, documents-check는 `docs-check`이다. kit-check는 작업 이름으로 시작하면서 kit이 정의하지 않는 Makefile target과, build, test, lint target이 없는 runtime에서 실패한다. Claude Code hook은 CI에서만 실행하는 `make test`를 거부한다. kit 자신의 target은 고정 작업의 prerequisite인 `kit-build`와 `kit-install-symbols-php`이다 (K246).
- 공통 layout은 관심사마다 한 곳을 고정한다. `docs/`는 `spec/`, `operations/`, `plans/`, `rebuild/`, `features.md`와 VitePress site의 파일을 가지고, AGENTS, CHANGELOG, Makefile은 root에 두며, test 폴더는 `tests/`이고, `js` 폴더는 TypeScript를 가지지 않는다. kit의 tool inventory는 docs/operations/로 옮긴다 (K245).
- `make test-<runtime> CASES=<pattern>`(`runtime-targets.mts`)은 runtime의 각 package의 unit test를 그 runner의 name filter로 실행한다. `make test-integration`과 `make test-conformance`는 root의 `tests/integration/`과 `tests/conformance/`의 suite를 CI에서만 실행한다. layout 규칙은 suite를 package 밖에 두게 하고, Claude Code hook은 CASES 없는 test target과 suite를 거부한다 (K244).
- rules check는 규칙 문서에서 section을 소개하는 문단 밖의 문단에서 실패하므로, 규칙은 자기 check를 가진 list item이다. kit의 릴리스 절차는 docs/operations/release.md로 옮기고, AGENTS.md는 릴리스와 생성 파일 규칙을 list item으로 기술한다 (K243-1).
- commit 규칙은 모든 저장소에 같은 check-commits.mts의 상수 `COMMIT_RULES`이고, kit-check는 남은 `config/commits.json`을 알린다. PRINCIPLES.md에 plan, item, 검증, commit 규칙을 가진 Workflow 절이 있고, kit의 AGENTS.md는 그것을 다시 기술하지 않는다 (K243).
- `make language-check`(`language-check.mts`)는 data인 문자열을 빼고 code의 주석, identifier, error 또는 log message, test name의 한글에서 실패하고, commit check는 commit message의 한글에서 실패한다(`commit-language`). kit의 CI가 둘 다 실행한다 (K252).
- duplication check는 kit의 isolation test가 읽는, 실행하는 jscpd의 command를 명시한다 (K248-3-1).
- `make test-markers-check`(`test-markers.mts`)는 marker가 건너뛰거나 좁히는 test에서 실패한다. parser로 읽는 node:test 또는 vitest의 `test.skip`, `it.only`, `skip`, `only`, `todo` option과, code 줄의 `t.Skip`, `unittest.skip`, `pytest.mark.skip`, `markTestSkipped`, `#[ignore]`이다. kit의 CI가 실행한다 (K255).
- 삼킨 오류는 그 언어의 lint에서 실패한다. oxlint `no-empty`와 `no-useless-catch`, ruff BLE001, S110, S112, phpcs `Generic.CodeAnalysis.EmptyStatement`, clippy `let_underscore_must_use`, golangci-lint의 errcheck이며, 각각 test에 실패하는 sample이 있다 (K256).
- `make duplication-check`는 kit.mk의 도구(`duplication-check.mts`)이므로 모든 저장소가 실행한다. 이제 package의 dependency인 jscpd가 `config/duplication.json`이 이유와 함께 제외하는 folder 밖에서 checkout의 code를 runtime의 format으로 읽는다 (K248-3).
- kit은 2026-10-19 review 시점의 최신 stable release인 knip 6.42.0, @decimalturn/toml-patch 3.3.1, ruff 0.17.1을 lock한다 (K261).
- CI workflow test는 `.php-version`을 literal 8.5 대신 kit의 PHP pin과 비교한다 (K259-1).
- commit check는 oxlint가 요구하는 대로 fix commit의 type을 `startsWith`로 읽는다 (K257-1).
- push gate는 `{type}/{shortname}-{checklist id}`로 이름 붙지 않은 main 외의 push된 branch, `{project}-{shortname}-{checklist id}`로 이름 붙지 않은 worktree folder, main이 merge한 local branch를 그것을 제거하는 command와 함께 거부한다 (K253).
- commit check는 kit runner의 test 파일(tests/, `*.test.*`, `*_test.go`, `test_*.py`, `*Test.php`)을 바꾸지 않는 `fix` commit을 range, commit-msg hook, `make commit`에서 거부한다 (K257).
- `make kit-check`는 Git index의 symbolic link에서 실패하고 그것을 명시하므로, 어떤 저장소도 자신이 만든 link를 track하지 않는다 (K254).
- push gate test의 편집은 text에 일치가 없으면 그대로 두는 대신 실패한다 (K260).
- `make commit ID= TYPE= SCOPE= SUBJECT= BODY_FILE=`은 commit-msg hook의 check를 거친 뒤, body를 config/commits.json의 폭으로 감싸고 trailer를 그대로 둔 item의 message로 index를 commit한다 (K249-4).
- 열린 checklist item은 자기를 검증하는 command를 명시하고, 그중 Claude Code hook이 거부하는 것은 없으므로, documents-check는 suite로 검증하는 item에서 실패한다(`verification.mts`). `make item-test ID=`가 그 command를 실행한다. checklist header는 ID, Task, Deliverables, Verification, State로 고정된다. hook은 make target을 그 prerequisite와 recipe를 따라 읽고 `run-tests.mts <runner> -- <args>`를 그 runner로 읽으므로, 저장소 자신의 suite target도 거부된다 (K249-3).
- kit은 어떤 코드도 필요로 하지 않는 8.5 대신, 저장소의 코드와 도구가 필요로 하는 하한인 PHP 8.4를 pin한다. `toolchain-pins.json`과 `.php-version`이 8.4를 선언하고, kit의 Composer project는 platform 8.4(PHPUnit 13은 8.4.1)와 함께 `>=8.4`를 요구한다 (K259).
- PHP symbol extractor는 phpcs를 통과한다. visitor는 `extract.php` 옆 `PublicSymbols.php`의 class `Polyspec\Kit\Symbols\PublicSymbols`이다. extractor의 release는 kit PHP lint의 vendor/를 건너뛰고 다른 folder에서 실패한다 (K248-4-1).
- `make item-state ID= STATE=`는 허용된 전이를 따라 두 언어에서 item을 옮기고, working tree가 두 changelog에 그 줄을 추가할 때만 done을 설정하며, bypass의 원인과 재시도 조건, impossible item의 원인을 쓰고, commit-msg hook이 거부할 것을 거부한다(`workingItemFindings`). kit의 config/commits.json이 changelog를 선언하므로 commit check는 done item의 entry를 요구한다 (K249-2).
- `make item-new PLAN= ID= TASK= TASK_KO= DELIVERABLES= VERIFICATION=`은 checklist와 그 짝에 waiting row를 추가하고, sub-item은 부모의 마지막 sub-item 뒤에 두며, cell의 pipe를 escape하고, row가 추가할 documents-check의 finding을 거부한다. documents-check와 utility는 하나의 함수 `checklistsFindings`로 checklist를 읽는다 (K249-1).
- `make plan-new NAME= TITLE= TITLE_KO=`(`plan.mts`)는 plan folder를 네 파일, doc-id, 언어 link, checklist header, revision 표식과 함께 쓰고, slug가 아닌 이름, 이미 있는 plan, 빈 title을 거부한다 (K249).
- Composer installer의 comment는 Composer가 archive digest를 검사한다고 주장하는 대신, commit reference가 각 package를 고정하고 lock에 archive digest가 없음을 기술한다 (K258).
- 읽기가 state를 위치로 가져오므로, cell 수가 그 table의 header와 다른 checklist row는 줄과 두 수를 알리며 실패한다. kit의 checklist에서 그런 row 31개를 고쳤다 (K242).
- kit의 `make install-symbols-php`는 lint-php의 PHPStan을 위해 PHP symbol extractor의 package를 install하고, kit의 CI는 lint 전에 그것을 실행하며, `make build`는 그 vendor/를 dist/에서 뺀다 (K248-4).
- @polyspec/kit/test-output의 export test는 tests/source에서 build된 copy로 실행되므로, vendor된 test에는 dist/가 필요 없다 (K250-1).
- go extractor test는 sandbox에 checkout의 install을 가리키는 mise wrapper를 준다. K199가 그 install로 extractor를 build한다 (K250-3).
- K208 trust test는 shim의 environment에서 CI와 GITHUB_ACTIONS를 제거한다. 둘 중 하나가 설정되면 mise가 모든 config file을 trust하기 때문이다 (K250-2).
- test의 sandbox 저장소는 receive.autogc를 false로 설정하여, git 2.43에서 그 저장소로의 push가 gc를 시작하지 않는다 (K250-4).
- parity 선언 test는 initRepository로 저장소를 만들고 실패한 git command에서 실패한다 (K248-2-1).
- plan은 `plan.md`, `checklist.md`와 그 한국어 짝을 가진 folder `docs/plans/<plan>/`이며, kit은 이 folder로 checklist를 찾는다 (K241). `config/checklist.json`은 hook과 ID pattern만 가진다. checklist는 state 5개를 가진 table이므로 list format과 선언된 state는 제거된다. 다른 파일이 있거나 plan이 없는 folder, 두 checklist에 있는 item ID, 부모가 없는 sub-item은 파일과 줄을 알리며 실패한다. document check는 plan folder 밖에서 checklist item을 가진 docs/ 아래 문서를 다시 실패시킨다. 이는 K240이 full-run과 함께 제거한 K235의 check다. kit의 execution checklist는 plan tool-unification과 standards-enforcement로 나뉘고, local-links는 docs/operations/로 옮긴다.
- PRINCIPLES.md와 AGENTS.md의 모든 규칙은 `Enforced by:`로 끝나며, `make rules-check`(`check-rules.mts`)가 명시된 check를 CI workflow와 Git hook에서 make를 따라 추적하고, 그런 지점이 실행하지 않는 check를 가진 규칙에서 실패하며, tool이 강제하지 않는 규칙과 planned item이 강제할 규칙을 나열한다. Claude Code hook은 `--no-verify`, `core.hooksPath` 변경, sleep으로 polling하는 loop, consumer에서 vendor된 파일의 편집도 거부한다. kit의 CI는 PHP, Python, Go lint, rules check, parity 선언을 실행한다 (K248).
- 구현 folder가 최대 하나인 checkout은 `config/parity.json`이 필요 없고, 둘 이상인 checkout은 그것 없이 실패한다 (K248-2).
- kit.mk가 `rebuild-check`와 `rules-check`를 정의하여 모든 저장소가 그것을 실행한다 (K248-1).
- kit CI의 모든 check step은 앞의 step이 실패한 뒤에도 실행되어, run 하나가 모든 실패를 보여 준다 (K251).
- 공통 layout은 Claude Code가 설정을 읽는 `.claude/`를 허용하고, kit의 layout은 vendor되는 설정의 원본 `claude/`를 허용한다 (K240-2).
- full suite는 CI에서만 실행된다 (K240). `make ci-targets`, 전체 `make parity-check`, `make owner-check`의 실행, test file, 이름, id를 선택하지 않은 test 실행은 GitHub Actions run 밖에서 거부한다(`ci-only.mts`, `test-selection.mts`). `full-run.mts`, 그 record, kit의 `make check`와 `make rerun-failed`를 제거했다. kit은 `.claude/settings.json`을 vendor하며, 그 PreToolUse hook(`claude-hook.mts`)은 suite target, selection 없는 test runtime 전체를 실행하거나 GITHUB_ACTIONS 또는 CI를 설정하는 Bash command를 거부한다.
- isolation test는 module-imports.mts로 module의 import를 읽어, `--import` 같은 option 이름을 가진 문자열은 import가 아니다 (K240-1).
- lint-ts가 다시 통과하고, kit의 어떤 module과 test도 다른 저장소를 지명하지 않고(fsm과 flowmark도 목록에 있다), make test는 모든 make release가 출력하는 것을 assert하며, read-only link test는 link가 읽는 쓰기 가능성에 따른 동작을 assert하여 root로 실행해도 통과한다 (K250).
- Python link는 sync를 실행하지 않고 link한 package만 바꾼다 (K239).
- Python unlink는 모든 group의 release를 복원하고 consumer project를 남긴다. link는 marker를 포함해 uv pip check로 의존성을 검사한다 (K238).
- Python link는 consumer가 설치한 package를 지우지 않고 link한 checkout의 의존성을 설치한다. unlink도 지우지 않는다 (K237).
- 전체 `make parity-check`는 makefile을 읽는 동안 full-run gate를 실행해, 저장소가 덧붙인 선행 target보다 먼저 거부한다 (K236).
- 어떤 tracker도 선언하지 않은 docs/ 아래의 checklist 항목 문서는 전체 실행과 gate를 거부한다 (K235).
- kit에 full-run guard로 전체 suite를 실행하는 `make check`가 생기고, UNITS 없는 `make parity-check`는 항목이 대기이거나 active이면 거부하는 `full-run gate`로 시작한다 (K234).
- 전체 실행 guard는 항목이 대기(`[ ]`)일 때도 거부한다. 완료, 우회, 불가 항목만 남을 수 있다 (K233).
- `config/parity.json`의 implementation이 자기 runtime에서 test를 실행하는 같은 runner의 implementation을 `shares`로 선언할 수 있고, R6은 그 binding을 그 implementation의 root 안에서 받아들인다(K232).
- `make parity-check`는 database item마다 실행되는 TypeScript coverage case의 보고(`<case> [<database>]`)를 그 case로 묶습니다. case는 모든 보고가 통과해야 통과하며, PHP data set과 Python item과 같습니다. 그 밖의 반복된 이름은 여전히 R3입니다(K231).
- `make parity-check`는 PHPUnit feature binding이 선언한 id, 즉 `<Class>::<method>`(PHPUnit이 보고하는 id) 또는 bare method와 맞춥니다. 그래서 `RollbackTest::test_rollback_failed` 같은 orm binding이 R3 not-executed 대신 통과합니다. cargo는 test의 이름과 결과 사이에 출력이 끼었을 때 줄 하나에 홀로 적힌 결과를 읽으므로, 데이터베이스에 연결하는 `identity_load` case가 실행된 것으로 셉니다(K229).
- kit parity 선언은 언어 parity만 담습니다. 소비자 interface manifest는 parity.json 키가 아니라 spec anchor로 참조합니다(K227).
- `link`는 프로젝트 자신이 제공하는 의존성을 NOT linked 대신 `workspace`로 보고하고 충족된 것으로 봅니다: `npm query`가 프로젝트의 폴더에 나열하는 npm workspace member, 그리고 루트 composer.json 또는 그것이 선언한 path repository의 Composer 이름입니다. 체크아웃도 프로젝트 패키지도 제공하지 않는 의존성은 여전히 실패합니다(K226).

- Python editable wheel의 fingerprint는 추적되거나 새로 생긴, 무시되지 않은 파일의 디렉터리만 셉니다. 그래서 읽기 전용 checkout 아래 컨테이너가 쓰는 git-ignored var/ 디렉터리가 fingerprint를 바꾸지 않고, 호스트에서 만든 wheel을 다시 씁니다(K225).

- parity binding `command`의 단어는 실행 environment를 `${NAME}`으로 참조할 수 있습니다. binding을 실행할 때 구현의 `command`, `args`, `env`와 같은 규칙으로 풀리며, NAME이 설정되지 않았거나 비었으면 그 NAME을 적은 R3 finding이고 그 binding은 아무것도 실행하지 않습니다. 이전에는 `${NAME}`을 그대로 실행했습니다(K223).
- `link`는 제공자와 같이 동기화된 환경의 모든 Python 프로젝트를, 소비자 자신과 polyspec 의존 여부와 무관한 각 workspace member까지 editable wheel로 설치한다(K224). sync는 `uv sync --locked --no-install-project`이다(uv workspace root면 `--no-install-workspace`). 그래서 읽기 전용 소비자 checkout에서 `os.utime`으로 실패하던, 프로젝트를 제자리에서 빌드하는 일이 없다. wheel은 패키지 폴더가 쓰기 가능하면 `var/link/wheels/<name>/<fingerprint>/`에 만들고, 읽기 전용이면 있는 것을 재사용한다. 읽기 전용 폴더에 wheel이 없으면 `stale prebuilt wheel <name> (fingerprint <fp>): run kit link on the host`로 실패한다. 모든 wheel을 sync 전에 먼저 확인하므로 하나라도 없으면 환경은 그대로 둔다. `check`는 설치된 각 wheel의 fingerprint를 검사한다. `unlink`는 여전히 전체 `uv sync --locked`로 각 프로젝트 자신의 설치를 복원한다(K224).

- `link`는 Python 제공자를 editable wheel로 연결한다(K222). 각 제공자는 `uv sync --locked` 뒤에 `var/link/wheels/<name>/<fingerprint>/`의 wheel로 `uv pip install --no-deps`를 한다. 이전의 `-e`와 `--overrides` 파일은 없어졌다. checkout이 쓰기 가능하면 그 pyproject의 backend로 격리된 `uv run`에서 wheel을 만들고, 읽기 전용 checkout(컨테이너 마운트)은 미리 만든 wheel만 설치하며 트리에 쓰지 않는다. 그곳에 wheel이 없으면 `stale prebuilt wheel <name> (fingerprint <fp>): run kit link on the host`로 실패한다. `check`는 설치된 wheel의 fingerprint가 checkout의 것과 다르면 실패한다. `link`와 `restore`는 같은 sync를 쓴다.

- `make parity-check UNITS="<id> …"`는 `config/parity.json`의 이름 붙은 unit만 실행합니다. `scripts/kit/parity.mts --unit <id>`(반복 가능)는 그 binding을 전체 실행과 같은 runner, cwd, reader로 실행하고 결과를 일반 ledger 줄로 보고합니다. unit 전체가 필요한 cross-unit rule(R1, R2, R4~R11)은 실행하지 않으며, 출력이 그 사실을 한 줄로 적습니다. 어떤 unit도 갖지 않은 id는 실행 없이 그 id를 적은 오류입니다 (K221).

- `link`는 provider checkout의 private npm 패키지도 다른 패키지와 같이 연결한다. manifest의 `package.json` `name`은 `private` 여부와 관계없이 제공한다. `private`는 게시만 막고 로컬 연결과는 무관하므로, tgz에서 설치된 복사본이 링크로 바뀌고 `check`가 통과한다. 제공자가 이름을 제공하는 npm 패키지는 `/*`만이 아니라 모든 scope(예: `/*`)를 연결한다(K220). 같은 이름의 manifest가 둘이면 전과 같이 둘 다 밝히며 실패한다(K220).

- `run-tests python --module <name>`는 Python 테스트를 `unittest` 대신 그 module(`python -m <name> …`)로 실행한다. 그래서 자체 harness로 테스트를 실행하는 저장소(예: orm의 `packages.python.tests.testcase`)도 같은 reader로 harness의 case를 센다. module 옵션은 python 도구에서만 읽는다 (K219).

- `run-tests node`는 helper module이 등록한 case(`test()`를 부르는 case 함수, 예: orm의 `caseTest`)를 `node --test`가 실행하는 test 파일의 case로 센다. node는 파일을 하나씩 실행하므로(`--test-concurrency=1`) 각 case는 그 파일의 group 이벤트가 연 파일에 속한다. 그래서 helper가 등록한 case의 파일이 `the file ran no test case`로 실패하지 않는다. test가 하나도 실행되지 않은 실행은 여전히 실패한다 (K218).

- `scripts/kit/test-output.mts`의 `nodeEvents`(`@polyspec/kit/test-output`)는 parity의 node:test reporter(parity-node-reporter.mts)가 내는 줄을 sink로 읽는다. goEvents, cargoEvents, pythonEvents, phpunitEvents가 각 도구의 출력을 읽는 것과 같다. 언어 parity 검사는 node의 case를 이것으로 읽고, consumer도 node:test case를 같은 방식으로 센다. case가 없는 실행은 아무 case도 읽지 않는다 (K217).

- parity binding은 `command`로 그 binding을 실행할 명령을 적습니다. 이 argv 배열은 runner의 기본 명령을 대신합니다(예: orm의 데이터베이스별 feature를 위한 `["make", "feature-check", "ITEM=…"]`). runner는 그 명령의 출력을 기본 명령의 출력과 같은 방식으로 읽고, 필드는 모든 unit 종류에서 받습니다. 시작하지 못하거나 0이 아닌 상태로 끝나는 명령은 그 명령을 이름 붙인 R3이며, 기본 명령으로 대신하지 않습니다 (K216).

- `make parity-check`는 timing을 붙인 cargo 하네스(orm testcase crate가 출력하는 libtest-mimic)의 출력을 읽는다. 이 출력은 test 이름 줄 다음 줄에 결과가 나온다. 그래서 선언된 case가 모두 통과한 rust binding의 각 case를 통과로 센다(이전에는 0개로 셌다). suite 실행은 선언된 case 중 통과한 것만 세므로 셈이 선언된 개수를 넘지 않는다. 종료 0인 실행에 선언된 case가 없으면 그 이름을 적고 실패하며, 실패한 실행이 test 이름을 보고하지 않으면 출력의 마지막 20줄을 보인다 (K215).

- `make parity-check`는 feature 실행을 패키지 전체가 아니라 `-run ^(<top>|…)$`로 실행한다. 이 정규식은 id의 첫 `/` 앞 top-level test 이름을 이스케이프해 하나의 선택으로 묶은 것이다. 그래서 feature가 많은 패키지도 test 파일마다 그 test만 실행되고, 관계없는 test의 실패가 모든 unit을 실패시키지 않는다. suite 실행은 symbol을 그대로 쓴다 (K214).

- `make parity-check`는 feature 실행이 0이 아닌 상태로 끝나면, 그 실행이 보고한 실패 test 중 id가 아닌 것의 이름을 줄에 적는다. 이름은 `go test -json`의 Test 이름을 가진 fail 이벤트와 node:test reporter에서 읽는다. 읽을 이름이 없으면 `failed outside the ids: no test name readable from the output`로 그렇게 적는다. 이전에는 종료 상태만 출력했다 (K213).

- `link.mjs link|check|unlink --project <dir>`는 `<dir>`의 manifest를 Git 추적 여부와 관계없이 그 폴더에서 직접 읽는다. 그래서 git-ignored 트리(var/example/installation) 아래의 설치도 package-lock.json 없이 npm 사본을 링크한다. manifest가 없는 `<dir>`이나, checkout이 제공하는데 실행이 링크하지 않은 선언된 polyspec 패키지는 0으로 종료하지 않고 이름이 붙은 오류로 실패한다(K212).

- `make install-tools`는 checkout의 mise.toml 신뢰를 state dir에 `mise trust`로 기록하며, 어떤 환경 변수도 그것을 신뢰시키지 않는다. parity의 python extractor는 새 worktree에서 그 변수 없이 실행된다(K208).

- Rust symbol extractor의 rustdoc 스키마가 format 61(`format_version` 61, 문자열 `macro`)을 읽는다. config/toolchain.json의 Rust nightly가 내는 형식이며, 이 형식에서 R1 추출이 실패했다(K207).

- `make install-tools`는 go symbol extractor를 `GOWORK=off`로, mise의 Go 환경(`-mod=readonly`, var/tools 아래의 GOPATH와 GOCACHE)에서 build한다. extractor는 consumer의 node_modules 아래에 있는 별도 module이므로, 그것을 나열하지 않는 consumer의 root `go.work`가 "current directory is contained in a module that is not one of the workspace modules listed in go.work"로 build를 멈췄고(template), module cache와 build cache는 machine의 것을 썼다 (K196).

- `make parity-check`의 R10은 each나 각각 뒤의 수를 그 문장의 implementation count로 읽지 않고("Go module, Rust crate, PHP package, PHP extension, Python package도 각각 한 구현이다"), 열거의 다른 항목이 양쪽에 있는 implementation 이름의 run을 implementation의 list로 읽지 않는다("Node.js, npm, Go, Rust, PHP minor version, Composer"). template의 참인 두 문장이 check에서 실패했다 (K197).

- `make install-tools`는 go symbol extractor를 mise의 shim 대신 consumer의 go로, 곧 consumer root에서 `mise where go`가 출력하는 install의 bin/go를 절대 경로로 실행하여 build한다. kit을 링크한 consumer에서는 extractor 소스가 kit checkout으로 resolve되고, shim은 그곳에서 kit 자신의 mise.toml을 읽어 "Config files in …/kit/mise.toml are not trusted"로 멈췄다 (template, K199).

- `make link`, `make link-check`, `make unlink`(scripts/kit/link.mts)는 0.0.x 개발의 local link를 만든다(docs/plans/local-links.md): `CHECKOUTS`가 지정한 main checkout이 패키지를 제공하고, 각 제공자는 release-assets의 prerequisite로 build하며, npm의 hidden lockfile과 Composer의 installed.json이 기록한 사본은 제공자 폴더를 가리키는 링크가 되고, Python 패키지는 의존과 --overrides 파일을 준 uv install 한 번으로 editable 설치하며, 각 Go 모듈은 go가 스스로 읽는 git 무시 go.work를 얻는다. `make install-packages`는 빌드도 링크도 하지 않는다 (K201, K205).

- `make parity-check`는 vitest를 test를 가진 implementation의 root를 `--dir`로 주어 실행한다. checkout root에서는 vitest의 discovery가 home 폴더로 링크하는 mise의 trust 기록 var/tools/mise/state/trusted-configs를 따라가 같은 test의 옛 사본까지 찾았으므로 case가 두 번 보고되었다 (template, K202).

- `make link`(scripts/kit/link.mts)의 링크는 각 도구 자신의 기록(npm query, Composer의 installed.json, uv pip list, go mod edit -json)에서 읽은 0.0.x 고정 패키지만 링크하고, `composer config vendor-dir`이 각 Composer 프로젝트에 주는 vendor를 링크한 뒤 autoloader를 다시 쓰며, polyspec 패키지의 plain copy를 경로와 함께 NOT linked로 보고하고, 빌드하지 않으며(`link.mjs rebuild`가 빌드하고 `link-check`는 STALE을 보고한다), Git이 무시하는 경로에만 쓰고, release target과 `dependency-review`를 `GOWORK=off`로 실행한다. kit의 `make build`는 완성된 dist.next를 dist로 rename하고, (K201-1).

- `link.mjs`는 checkout을 인자로 받고 환경 변수를 읽지 않는다(K205): `link.mjs link|check [--project <dir>] <checkout>...`, `unlink [--project <dir>]`. kit이 없는 소비자는 `node <kit checkout>/dist/link.mjs`를 실행한다.

- `link`는 Python provider를 환경이 editable install을 가질 때만 linked로 보고합니다. 설치된 상태는 venv 자신의 python이 읽고(PEP 610 direct_url.json과 RECORD의 PEP 660 `__editable__` marker), 설치 후에도 다시 읽습니다. 예전에는 wheel의 `uv pip freeze` 경로를 믿었는데 non-editable 설치도 같은 경로를 가지므로 site-packages 복사본이 있는 venv가 `linked`를 출력했습니다. 이제 그런 venv는 NOT linked로 실패합니다(K230).

## 0.0.53

- `make release-proof`는 wheel이 요구하는 각 sibling의 asset을 release가 나열하는지 확인하고 URL은 비교하지 않는다. sibling의 URL을 draft가 나열하는 URL과 비교했으나, GitHub은 draft가 publish되기 전까지 그 asset을 `untagged-` URL로 나열하므로 sibling wheel이 있는 첫 release가 proof에서 실패했다(crudui v0.0.6). sibling의 URL, 곧 tag의 asset URL은 release가 build되기 전에 확인된다 (K195).

## 0.0.52

- `config/owner-checks.json`의 owner rule은 `importers`와 `modules`를 받는다: 변경된 경로는 `importers` glob의 node test 중에서 그 경로를 직접 또는 다른 module을 거쳐 import하는 test를 실행하며, import는 owner-check의 import graph가 읽는다(`module-imports.mts`: amaro, acorn, acorn-walk; relative import, re-export, `import()`, `require()`, `import.meta.resolve('<specifier>')`, `siblingTool(import.meta.url, '<name>')`). `modules`는 schema나 fixture처럼 module이 아닌 경로를 대신하는 module을 적는다. `make owner-validate`는 그런 rule의 경로 중 어떤 test도 import하지 않는 경로에서 실패한다. kit의 rule이 이것을 쓴다: scripts/kit의 module 변경은 도구 suite 전체인 `make kit-test`를 실행했고, 이제 그것을 import하는 test를 실행한다; package 파일은 그것을 읽는 check를 실행한다 (K191).

- make kit-check는 PHP가 필요한데 `.php-version`이 없는 저장소에서 실패한다: `config/release.json`의 Composer package나 Composer consumer, 또는 `config/toolchain.json`의 `php`가 있는 저장소이다. release workflow는 `.php-version`의 PHP만 설치하고 그 밖에는 runner의 PHP를 유지했으므로, PHP를 다른 곳에 고정한 저장소는 Ubuntu의 PHP로 release하여 release proof에 실패했다. release workflow는 이제 make install-packages 뒤, 어떤 release 단계보다 먼저 make kit-check를 실행한다 (K193).

### Consumer migration

PHP가 필요하고 `.php-version`이 없는 저장소는 `8.5` 같은 PHP minor release로, `config/toolchain.json`의 `php`가 있으면 그 minor로 그것을 선언하고, 새 release workflow를 위해 make kit-sync를 실행한다 (K193).

K191에는 할 일이 없다: source 변경에 test suite 전체를 실행하는 owner rule을 가진 저장소는 대신 node test의 glob으로 `importers`를 선언하고, test가 시작만 하는 도구는 `import.meta.resolve`로 이름을 적을 수 있다 (K191).

## 0.0.51

- make toolchain-check는 mise.lock이 가리키는 uv lock sidecar(`pypi:` 도구의 `uv = { path = ".mise/locks/<tool>/<version>" }`)를 Git이 track하지 않거나 그 track한 파일이 없을 때 실패한다. mise의 문서는 sidecar folder를 mise.lock과 함께 commit하라고 하며, 그것이 없는 checkout의 `mise install --locked`는 "dependency sidecar … No such file or directory"로 실패한다; 그것을 지웠거나 commit하지 않은 저장소는 이제 해결 방법과 함께 finding을 받는다 (K192).

- make lint-ts는 knip.json 사본의 ignore를 knip이 필요로 하는 곳에서만 남기며, 그 판단은 knip 자신이 한다: reporter `knip-ignore-hints.mts`로 knip을 먼저 실행해 아무 issue에도 맞지 않은 ignore에 대한 knip의 configuration hint를 얻고, 그것을 lint의 설정에서 뺀다. script가 `@polyspec/kit`을 import하는 레포는 고칠 수 없는 사본에 대해 "Remove from ignoreDependencies" hint를 받았다; 이제 받지 않는다. 이는 같은 실행이 다루는 K176의 선언된 package 기준 filter를 대체한다 (K188).

- make dependency-review UPDATE=1은 npm 명령(npm install, npm audit fix, npm dedupe)을 make install-packages의 npm ci와 같은 설정인 allow-remote=root로 실행한다: `kit-bootstrap.mk`는 그 설정의 하나의 source로 `npm_config_allow_remote=root`를 두 recipe에 export한다. npm audit fix는 그것 없이 실행되어 URL로 고정된 `@polyspec/kit`을 EALLOWREMOTE로 거부했다; install-packages의 recipe는 이제 같은 설정을 읽는 `npm ci`이다 (K189).

- config/release.json의 wheel package의 `pyproject.toml`을 source로 하는 make python-lock은 sibling(configuration의 다른 wheel package)을 release asset의 URL로 가리키는 requirement를 resolution에서 뺀다. 이는 wheel-dependencies가 sibling link로 분류하는 requirement와 정확히 같다: uv는 그 이름의 `--excludes`와 함께 실행되고, make python-lock-check는 그것을 비교에서 뺀다. 그런 URL은 release가 publish한 뒤에야 존재하므로 lock은 404로 실패했고, sibling에 의존하는 wheel은 lock할 수 없었다; sibling을 가리키지 않는 URL requirement는 전처럼 해석되고 검사된다 (K190).

- kit-check의 recipe-tools check는 shell-quote가 line을 나누는 동안 make reference 자리에 두는 placeholder인 `KIT_MAKE_REFERENCE_`를 이미 담은 recipe line에서 실패한다. 그런 word는 reference로 읽혔다: line의 reference 범위를 넘는 것은 빈 word가 되어 버려졌고, 범위 안의 것은 다른 reference의 word를 가졌다; 이제 그 line은 자기 text와 해결 방법(그 변수의 이름을 바꾼다)과 함께 실패한다 (K187).

### Consumer migration

mise.toml에 `pypi:` 도구를 선언한 저장소는 `make toolchain-lock`이 쓰는 `.mise/locks/` folder를 mise.lock과 함께 commit한다; 그것을 지운 저장소는 `make toolchain-lock`을 다시 실행한다 (K192).

## 0.0.50

- parity의 php binding은 run-tests와 lint-php처럼 그 package에 Composer가 주는 vendor directory의 PHPUnit을 실행합니다(composer-vendor.mts): package 자신의 것, 또는 그 위의 가장 가까운 Composer project의 것입니다. root composer.json이 path repository로 library를 require하고 root에 `vendor/` 하나를 설치하는 Composer monorepo(K163)는 모든 php binding을 "`<package>/vendor/bin/phpunit` does not exist"와 함께 R3 not-executed로 보고했습니다; 이제 그것을 실행하며, 위로 vendor directory가 없는 package는 여전히 해결 방법과 함께 실패합니다(K178).
- kit-check의 recipe-tools 검사(K171)는 POSIX shell의 quoting 규칙으로 recipe line을 나눕니다: quote된 문자열은 한 word이고, quote 안의 `|`, `;`, `&&`는 operator가 아닙니다. `@echo "build-ts|go|…"` 같은 help line은 go를 bare name으로 시작한다고 보고되어 문구를 바꿔야 했습니다; 이제 통과하며, `foo | node x`는 여전히 실패합니다(K179).
- composer.json의 version을 정하는 릴리스는 그 directory에서 `composer update --lock`으로 다시 lock합니다: `composer.lock`의 content-hash가 `version`을 포함하므로 version 변경만으로는 낡은 lock이 남고, `make dependency-policy-check`가 그것을 실패시킵니다(`composerLock`). AGENTS.md와 docs/operations/tool-inventory.md의 릴리스 절차가 이를 말하며, `make dependency-policy-mutation-check`는 새 lock 없는 version 변경이라는 mutation을 얻고 gate는 그것을 거부해야 합니다(K180).
- make dependency-policy-check가 checkout의 모든 Composer manifest를 검사합니다: `composerPlatforms`가 지정하지 않고, 그것이 지정한 manifest의 path repository가 제공하지도(K168) 않는 추적된 composer.json은 rule `composerCoverage`로 실패합니다. 이전에는 Composer platform을 하나도 적지 않은 저장소가 어떤 manifest에도 `composer validate --strict`를 실행하지 않았으므로, version 변경이 낡게 만든 lock이 release를 지나도록 낡은 채 남았습니다. kit이 쓰는 manifest, kit이 배포하는 symbol extractor project, `config/release.json`의 Composer consumer project는 검사하지 않습니다(K181).
- `config/owner-checks.json`이 `ciExempt`를 받습니다: 저장소의 CI workflow가 실행하지 않는 owner rule의 make target과 각각의 이유입니다. kit의 CI workflow test는 다른 모든 owner target에 step을 요구합니다; kit의 CI는 이제 실패가 local 실행까지 숨어 있던 make toolchain-check, kit-check, release-coverage를 실행하고, make install-hooks가 쓰는 local core.hooksPath가 필요한 hooks-check를 면제합니다(K183).
- kit-check의 recipe-tools 검사는 자체 splitter(K179) 대신 kit의 새 dependency인 shell-quote 1.12.0의 `parse`로 recipe line을 shell word로 나눕니다; kit의 모든 recipe와 기존 case의 word는 같고, `$(if $(RANGE),--range $(RANGE))` 같은 중첩된 make function은 더 이상 엉뚱한 command `if`를 내지 않습니다(K184).
- run-tests, lint-php, parity의 php runner는 Composer project의 vendor directory를 Composer에게 묻습니다: kit이 복사한 규칙(K163, K178) 대신, checkout의 mise.toml의 Composer로 composer.json의 folder에서 offline으로 실행하는 `composer config vendor-dir`입니다. kit이 무시하던 composer.json의 `config.vendor-dir`도 이제 `vendor`, `COMPOSER_VENDOR_DIR`와 함께 반영됩니다; package 위의 가장 가까운 Composer project를 찾는 것은 그대로입니다. 이 도구들은 이제 make install-tools가 설치하는 mise.toml의 Composer(`http:composer`)가 필요합니다(K184).
- `kit-bootstrap.mk`는 package가 설치되기 전에도 `$(NPM)`처럼 bootstrap이 설치하는 checkout의 node인 `$(NODE)`를 정의합니다. install-packages가 필요로 하는 step처럼 kit.mk가 생기기 전에 도는 저장소의 recipe는 빈 `$(NODE)`를 받아 var/tools/bin/node를 직접 적어야 했습니다(K185).
- run-tests phpunit은 parity와 lint-php처럼(K178) composer-vendor.mts의 같은 function으로 `--cwd` 또는 그 위에서 PHPUnit이 있는 가장 가까운 Composer project의 PHPUnit을 실행합니다. 자기 vendor directory가 없는 Composer monorepo의 package는 root를 `--cwd`로 넘겨야 했습니다; 이제 자기 folder에서 실행합니다(K186).

### 소비자 이전

make dependency-policy-check가 `composerCoverage`로 보고하는 각 composer.json은 `config/dependency-policy.json`의 `composerPlatforms`에 `{ "manifest": "<path>", "php": "<최소 PHP>" }` 항목을 얻고, manifest의 `config.platform.php`를 그 PHP로 두며, `composer update --lock`이 쓴 lock과 `make dependency-review RECORD=1`(ONLINE)을 더합니다; Composer monorepo의 published package는 대신 root의 path repository로 require합니다(K181). composer.json의 version을 정하는 릴리스는 `make dependency-review RECORD=1` 전에 그 directory에서 `composer update --lock`을 실행합니다(K180).

## 0.0.49

- `config/knip-entries.json`의 `ignore`는 저장소의 code가 아닌 파일을 선언하며, knip도 oxlint도 그 파일을 읽지 않습니다: make lint-ts는 각 glob을 knip의 `ignore`에 더할 뿐 아니라 kit 사본처럼 oxlint에 `--ignore-pattern`으로 줍니다. 일부러 깨뜨린 build 도구 test의 입력 같은 파일이 더는 풀 수 없는 import로 oxlint의 type-aware rule에서 실패하지 않으며, 선언한 glob 밖의 같은 위반은 여전히 실패합니다(K172).
- make install-vscode가 내려받기 뒤에 끝납니다. `@vscode/test-electron` 3.1.0은 실패한 내려받기 시도("aborted")의 `tar -xzf -` child를 살려 두었으므로, 재시도가 성공한 뒤에도 install이 CI job의 timeout까지 멈춰 있었습니다. install은 내려받기를 자기 process에서 돌리고, 내려받기가 끝나면 그 process group을 죽입니다. 모든 시도가 실패한 내려받기는 `@vscode/test-electron`의 오류로 install을 실패시킵니다(K173).
- 자기 package의 build 출력(`../dist/…`)을 import하는 test는 `tsconfig.json`이 build project를 참조하면 knip에서 source의 사용으로 셉니다. knip은 TypeScript project reference를 따르고 knip의 `paths`는 이미 있는 dist에 닿지 않으므로 kit은 option을 더하지 않습니다(K175).
- make toolchain-lock이 checkout의 node가 생기기 전에 돕니다. 0.0.48에서는 bootstrap이 `mise.lock`이 고정한 node로 설치하는 `var/tools/bin/node`로 돌았으므로, `mise.lock`이 아직 node를 고정하지 않은 저장소는 lock도 bootstrap도 할 수 없었습니다. 이제 machine의 node(`$(BOOTSTRAP_NODE)`)가 그것을 시작하며, bootstrap처럼 `config/toolchain.json`의 mise를 스스로 설치합니다(K174).
- knip이 복사된 `knip.json`에 대한 configuration hint를 출력하지 않습니다(K176). make lint-ts는 knip.json의 각 `ignoreDependencies` 항목(`@polyspec/kit`, oxlint, oxlint-tsgolint, jscpd)을 저장소의 package.json(root나 `config/knip-entries.json`의 workspace)이 선언할 때만 남기며, knip.json에는 더는 `ignoreBinaries`가 없습니다: kit의 어떤 사본도 knip이 보고하는 binary를 실행하지 않고, node, git, python3, cargo는 knip의 global binary입니다. knip은 언제나 `var/lint-ts/knip.json`을 읽습니다.
- dependency review가 `pythonManifests`의 각 pyproject.toml에서 `build-system.requires`와 extra뿐 아니라 `[dependency-groups]`(PEP 735)의 group도 읽으며, 각 `{ include-group }`은 PEP 735대로 풉니다; dependency group만 선언한 requirement(test 전용 등)는 review를 벗어났습니다. `make dependency-review UPDATE=1`은 이미 그것을 고정했고, 이제 review와 pin-python-dependency는 한 module로 그 array를 읽습니다(K177).

### 소비자 이전

`make kit-sync`를 실행합니다. 그것은 `ignoreBinaries`가 없는 `knip.json`을 씁니다(K176). 그다음 make lint-ts가 unlisted binary로 보고하는 각 binary(저장소의 script나 test가 실행하는 make, go, php, composer, rustup, shasum 등)를 이유와 함께 `config/knip-entries.json`의 `binaries`에 넣습니다(K176).

`pythonManifests`의 pyproject.toml은 extra처럼 dependency group의 각 requirement도 정확히 고정하고(`name==version`), include-group은 그 파일의 group을 가리킵니다; 그다음 `make dependency-review`가 그것을 기록하며, 그때까지 gate는 실패합니다(K177).

oxlint가 보고한 파일 중 저장소의 code가 아닌 것은 disable 주석이나 oxlint의 ignore 대신 이유와 함께 `config/knip-entries.json`의 `ignore`에 넣습니다(K172). VS Code를 설치하는 저장소는 kit 갱신과 함께 make install-vscode의 수정을 받으며, 설정에서 바꿀 것은 없습니다(K173). test가 자기 `dist`를 import하고 knip이 export를 unused로 보고하는 package는 build를 `outDir`, `rootDir: src`, `composite: true`를 둔 자기 tsconfig에 두고, test를 유지하는 `tsconfig.json`의 `references`에 그것을 적습니다. 설정은 `docs/operations/tool-inventory.ko.md`에 있습니다(K175).

`mise.lock`이 node를 고정하지 않은 저장소(0.0.47에서 옮겨 오는 저장소 등)는 다음 순서로 실행합니다(K174):
1. 이 kit을 설치하는 `make install-packages`.
2. 0.0.48의 안내대로 `mise.toml`에 node를 선언한 뒤, `mise.lock`에 node를 쓰는 `make toolchain-lock`.
3. mise, 그 node, npm을 var/tools에 설치하는 `make install-tools TOOLS=npm`.
4. checkout의 node로 도는 `make kit-sync`와 `make install-tools`.

## 0.0.48

- 복사되는 `.github/workflows/release.yml`이 actions/checkout v7.0.1, actions/setup-node v7.1.0, shivammathur/setup-php 2.40.0을 각 release의 전체 SHA로 고정합니다. setup-php는 움직이는 tag v2의 SHA로 고정되어 있었습니다. 두 major는 workflow가 넘기는 input을 하나도 바꾸지 않습니다(K169).
- 각 checkout이 자기 Node.js를 실행합니다(K171). `node`는 kit pin에 맞춘 `mise.toml`의 도구이고 `mise.lock`이 platform별 archive를 고정합니다. `.node-version`은 없어졌고 kit의 layout도 더는 허용하지 않습니다. `make install-tools TOOLS=npm`은 machine의 어떤 node로든 시작하며 `config/toolchain.json`의 mise를, 그것으로 `mise.toml`의 node를, 그다음 `packageManager`의 npm을 설치합니다. `var/tools/bin/node`는 그 node를 절대 경로로 실행하고 npm과 npx wrapper는 그 node로 npm을 실행하므로, `npm ci`와 이후 모든 단계가 checkout의 node로 실행됩니다. bootstrap은 더는 실행 중인 node를 선언과 비교하지 않습니다. `make toolchain-check`는 `var/tools/bin/node`를 실행하고 고칠 방법으로 `make install-tools TOOLS=npm`을 알립니다. `config/toolchain.json`은 더는 `node`를 받지 않습니다.
- kit.mk는 checkout의 각 도구를 절대 경로로 실행합니다: `$(NODE)`(`var/tools/bin/node`), `$(NPM)`, `$(ALINT)`; `$(BOOTSTRAP_NODE)`는 bootstrap만 시작하는 machine의 node입니다. macOS의 make인 make 3.81은 shell 문법이 없는 recipe 줄을 kit.mk가 export한 PATH가 아니라 make가 시작할 때의 PATH에서 찾으므로, Mac에서는 모든 `node $(KIT)/…` recipe가 machine의 node를 실행했습니다. `make kit-check`는 checkout의 도구(var/tools/bin의 wrapper나 `mise.toml`의 command)를 이름만으로 실행하는 Makefile의 recipe를 실패시킵니다(K171).

- kit이 Node.js 26.12.0(최신 release)을 고정합니다(`scripts/kit/toolchain-pins.json`): `mise.toml`의 `node`는 그 release여야 하고 모든 `package.json`의 `engines.node`는 `>=26.12.0`이어야 합니다. 각 checkout은 이 kit을 받을 때 그것을 var/tools에 설치하므로 어떤 machine의 node도 바뀌지 않습니다(K169, K171).

### 소비자 이전

실행:
- `.github/workflows/release.yml`(K169, K171)과 `scripts/kit/bootstrap`, `scripts/kit/kit-bootstrap.mk`의 copy(K171)를 쓰는 `make kit-sync`.
- 아래 변경 뒤 `make toolchain-lock`, 그다음 `make install-tools TOOLS=npm`과 `make install-tools`(K171).

변경:
- Node.js release를 `.node-version`에서 `mise.toml`의 `[tools]`에 있는 `node = "26.12.0"`으로 옮기고, 모든 `package.json`의 `engines.node`를 `>=26.12.0`으로 하며, `.node-version`을 지웁니다. CI의 setup-node는 `node-version-file: mise.toml`을 읽습니다(K171).
- `config/toolchain.json`에서 `node`를, 그것을 읽던 저장소의 download와 함께 지웁니다. node는 mise가 설치합니다(K171).
- Makefile의 recipe에서 checkout의 각 도구를 이름만으로가 아니라 kit.mk의 변수(`$(NODE)`, `$(NPM)`, `$(ALINT)`)나 `$(CURDIR)/…`의 절대 경로로 실행합니다. `make kit-check`가 그런 줄을 하나하나 알립니다(K171).

## 0.0.47

- 복사되는 `.oxlintrc.json`이 non-null assertion을 error로 실패시킵니다(`typescript/no-non-null-assertion`): `noUncheckedIndexedAccess` 아래의 list 항목이나 정규식 group처럼 type이 undefined나 null을 허용하는 값은 검사로 읽습니다. kit은 그런 값을 기대한 식을 밝히며 던지는 `scripts/kit/present.mts`의 `present`로, test는 assert하는 `tests/kit/known.mts`의 `known`으로 읽습니다(K156).
- 복사되는 `.oxlintrc.json`의 type-aware rule은 typescript-eslint의 `disableTypeChecked`가 JavaScript에서 끄는 것처럼 TypeScript 파일(`**/*.{ts,mts,cts,tsx}`, oxlint `overrides` 항목)에만 적용됩니다: `no-unsafe-*` rule, `no-unnecessary-type-assertion`, `no-floating-promises`, correctness category의 type-aware rule입니다. 일반 .js나 .mjs 파일에서는 type이 없는 parameter가 모두 `any`이므로 0.0.46은 그 파일이 JavaScript라는 뜻뿐인 finding을 수천 개 보고했습니다. `ban-ts-comment`, `no-explicit-any`, `no-non-null-assertion`과 나머지 correctness는 여전히 모든 파일에 적용됩니다(K170).

### 소비자 이전

실행:
- `.oxlintrc.json`을 쓰는 `make kit-sync`(K156, K170).

수정:
- 0.0.46이 보고한 JavaScript 파일에는 할 일이 없습니다: make kit-sync 뒤에는 type-aware rule이 그 파일을 읽지 않으며, TypeScript 파일은 전과 같이 lint됩니다(K170).
- `make lint-ts`가 이제 보고하는 `!` 하나하나를 disable 없이: 값을 구조 분해해 검사하거나, 기대하는 것을 밝히는 레포의 throwing accessor로 읽습니다(K156).

## 0.0.46

- 복사되는 `.oxlintrc.json`이 TypeScript type의 비상구를 error로 금지합니다: `typescript/ban-ts-comment`는 `@ts-ignore`와 `@ts-nocheck`를 금지하고 `@ts-expect-error` 뒤에 설명(`// @ts-expect-error: <이유>`)을 요구하며, `typescript/no-explicit-any`와 `typescript/no-unnecessary-type-assertion`은 명시적 `any`와 아무것도 바꾸지 않는 type assertion을 실패시킵니다. 한 레포가 type 검사를 통과하는 code에 `@ts-expect-error`를 달고 cast로 tsc를 잠재웠습니다. 사본 `scripts/kit/bootstrap/files.mts`의 `readJson`은 `any` 대신 `unknown`을 돌려줍니다(K155).
- consumer에서 `make lint-ts`는 kit의 사본을 oxlint에서 뺍니다: 설치된 package의 `kit.copies`, 곧 make kit-sync가 쓰고 make kit-check가 byte 단위로 비교하는 기록의 각 파일마다 `--ignore-pattern` 하나입니다. kit은 자기 사본을 자기 tsconfig와 node의 type으로 lint합니다. consumer에서는 oxlint-tsgolint가 그 사본을 project 밖에서 검사했고, 거기서는 모든 `node:*` import가 `any`였습니다. 설치된 kit이 package-lock.json의 version이 아니면 make lint-ts는 make kit-check의 finding으로 실패합니다. 사본 `scripts/kit/bootstrap/files.mts`와 `digest.mts`는 K150이 그 lint만을 위해 좁혔던 byte의 type을 다시 `NodeJS.ArrayBufferView`로 받습니다(K157).
- `go.work`가 Git이 추적하지 않는 go.mod의 module(무시되는 형제 레포의 clone 등)을 use하면 `make dependency-policy-mutation-check`는 finding 하나로 실패합니다: go.work와 `use` 경로를 밝히고, commit된 go.work는 추적되는 module만 use할 수 있다고 알립니다. 이 check의 사본은 추적되는 파일만 담으므로, 그 go.mod를 읽다가 stack과 함께 ENOENT를 던졌습니다(K160).
- `config/knip-entries.json`이 어떤 JavaScript도 import하지 않고 make만 실행하는 root의 dependency(hyper가 recipe를 위해 URL로 설치하는 template compiler 등)를 `ignoreDependencies`(`{ "<package>": "<reason>" }`)에 선언하고, make lint-ts는 그것을 `var/lint-ts/knip.json`에서 knip.json의 `ignoreDependencies` 뒤에 더합니다: knip은 Makefile을 읽지 않으므로 그 dependency를 unused로 보고했습니다(K159).
- 복사되는 `.oxlintrc.json`이 `oxc/number-arg-out-of-range`를 끕니다: 이 rule은 `toFixed`와 `toExponential`의 소수 자릿수 0에서 20, precision 1에서 21만 허용하는데, 이는 ES2018이 100으로 올리기 전의 한계입니다(ECMA-262 `Number.prototype.toExponential`). 그래서 `toExponential(25)` 같은 올바른 code를 실패시켰습니다. 최신 release인 oxlint 1.88.0과 oxc main도 옛 한계를 유지하며, 이를 보고한 oxc issue는 없습니다(K161).
- kit의 도구가 읽는 모든 JSON(파일이나 command의 출력)은 `scripts/kit/schema`의 schema 파일(JSON Schema 2020-12, `schema-validate.mts`의 strict Ajv2020)로 검증되고 cast가 아니라 ajv의 type guard로 type을 얻습니다: `readConfig<T>(root, file, schema)`, `readJsonFile<T>`, `parseJson<T>(text, schema, source)`는 T를 돌려주거나, 파일이나 command와 ajv 각 error의 JSON Pointer를 밝히는 `SchemaError`를 던지며, `readConfigFindings<T>`는 check에 그 줄을 finding으로 줍니다. `readConfig`는 이제 `{ value, errors }`를 돌려주지 않고 던지며, 호출자가 T를 정합니다. 새 schema는 kit이 읽는 package.json, package-lock.json, composer.json, composer.lock, knip.json의 부분과 gh, npm, composer, go, cargo, pip, vitest, rustdoc 출력의 부분, kit이 스스로 쓰는 record를 기술합니다. 그것을 어기는 레포의 manifest(예: list가 아닌 `workspaces`)는 이제 파일과 JSON Pointer와 함께 실패합니다. ajv가 설치되기 전에 도는 bootstrap은 사본 `scripts/kit/bootstrap/files.mts`의 `readJsonObject`로 JSON object를 읽고 각 field를 검사합니다. 예시 호출자는 `scripts/kit/kit-check.mts`입니다(K158).
- `make lint-php`는 Composer package에 Composer가 그 파일에 주는 autoloader로 PHPStan을 실행합니다: package의 `vendor/autoload.php`, 또는 그 위의 가장 가까운 Composer project(path repository로 library를 require하는 Composer monorepo의 root development composer.json 등)의 것입니다. `COMPOSER_VENDOR_DIR`는 run-tests의 PHPUnit처럼 다른 vendor directory를 지정하며, 둘 다 `scripts/kit/composer-vendor.mts`로 그것을 찾습니다. 이전에는 `<package>/vendor/autoload.php`를 요구했는데, lock도 자기 vendor/도 없는 그런 monorepo의 library에는 그것이 없습니다. PHP 파일이 있고 자신에게도 위에도 autoloader가 없는 package는 여전히 실패하며, 이제 그것을 설치할 수 있는 project를 밝힙니다(K163).
- `config/knip-entries.json`이 `ignore`(`{ "<glob>": "<reason>" }`)에 의도적으로 쓰이지 않는 파일(site가 보여 주고 아무것도 실행하거나 import하지 않는 sample source 파일 등)을 root 기준 glob과 이유로 선언하고, make lint-ts는 그것을 `var/lint-ts/knip.json`에서 그런 파일을 위한 knip의 문서화된 option인 knip.json의 `ignore` 뒤에 더합니다. 선언하지 않은 unused 파일은 여전히 실패합니다(K162).
- 복사되는 `.golangci.yml`이 staticcheck `ST1005`("error strings should not be capitalized")를 끕니다: polyspec의 error string은 레포 spec의 cross-port message이고 모든 port가 byte 단위로 같게 돌려주므로 spec의 대소문자를 유지합니다. 다른 check는 golangci-lint 2의 기본값입니다. 또 `issues.max-same-issues`와 `issues.max-issues-per-linter`를 0으로 두어 모든 finding을 보고합니다: 같은 text의 issue 3개와 linter 하나의 issue 50개라는 기본 상한이 한 레포에서 finding 121개 중 118개를 숨겼습니다(K164).
- `run-tests phpunit`은 `--php-extension`을 여러 번 받아 각 extension을 PHP 자체의 방식인 자기 `-d extension=<path>`로 주어진 순서대로 load하므로, extension은 그것이 의존하는 extension 뒤에 load됩니다. 각각이 build되었는지 tool이 시작하기 전에 확인합니다. 레포는 하나가 다른 하나에 의존하는 extension 둘을 한 PHPUnit run에서 load할 수 있습니다(K165).
- 복사되는 `.oxlintrc.json`이 `any`의 모든 unsafe 흐름을 error로 실패시킵니다: `typescript/no-unsafe-argument`, `no-unsafe-assignment`, `no-unsafe-call`, `no-unsafe-member-access`, `no-unsafe-return`은 any 값이 인자, 대입, 호출 대상, member access의 객체, 반환값이 되면 실패시키고, `typescript/no-unsafe-type-assertion`은 type을 좁히는 type assertion을 실패시킵니다. kit은 JSON을 schema로 읽고(K158), unknown 값을 검사로 좁히며, 있다고 아는 값은 `scripts/kit/present.mts`의 `present`로, errno code는 `process.mts`의 `errorCode`로 읽습니다(K157).
- `make python-lock`이 `make python-venv`처럼 uv shim을 checkout의 mise 환경으로 실행하므로, make 밖에서 `node scripts/kit/python-lock.mts`가 더는 `Config files in <checkout>/mise.toml are not trusted`로 실패하지 않습니다. Python 도구의 real test도 자기 shim 호출에 같은 환경을 줍니다(K157).
- Python wheel의 build backend는 tool pin인 `config/toolchain.json`의 `pythonBackend` 하나로만 선언합니다: install-tools가 그것을 설치하고, `make release-backend`, `release-assets`, wheel build는 그것을 거기서 읽습니다. `config/release.json`의 `buildBackend`는 schema에서 빠졌습니다. `buildBackend`만 선언한 레포는 install-tools가 backend를 설치하지 않아 release가 release-assets에서 실패했습니다(`setuptools-84.0.0 wheel is missing`). `wheel` package나 wheel consumer가 있고 `pythonBackend`가 없는 `config/release.json`은 이제 `make kit-check`와 release에서 고치는 방법과 함께 실패합니다(K166).
- `make release-coverage`는 kit이 쓰는 file을 kit 자신의 기록에서 도출하여 릴리스되지 않는 것으로 보므로, 어떤 레포도 그것을 분류하지 않습니다: 실행 중인 package의 `kit.copies` 사본(`config/php-lint/composer.json` 등), PHPUnit의 Composer project `config/phpunit/composer.json`, `.mise/locks/` 아래 mise의 lock tree(`.mise/locks/<tool>/<version>/pyproject.toml` 등)입니다. 복사되는 `config/layout.kit.yml`은 `package.json`과 `package-lock.json`처럼 Composer monorepo의 root `composer.json`과 `composer.lock`을 허용합니다(K167).
- `make dependency-review`는 Composer monorepo의 published package의 requirement를 review합니다: `composerPlatforms`의 root composer.json의 first-party requirement는 그 `require`와 `require-dev`, 그리고 `path` repository가 제공하는 각 package(root lock의 path dist 항목)의 `require`이며 version은 root lock의 것입니다. review는 root에서 `composer outdated --locked --all --format=json`을 한 번 실행하고 그 package만 남깁니다. `--direct`는 root의 requirement만 세었으므로 published package의 requirement(symfony/console 등)가 review에서 빠졌습니다. third-party package만 require하는 library는 여전히 review하지 않습니다. `UPDATE=1`은 published package의 requirement를 그 directory의 `composer require --no-update`와 root의 `composer update --with-dependencies`로 올립니다(K168).

### 소비자 이전

실행:
- `.oxlintrc.json`과 `scripts/kit/bootstrap`의 사본을 쓰는 `make kit-sync`(K155, K157, K161, K166).
- `.golangci.yml`을 쓰는 `make kit-sync`, 이어서 `make lint-go`: 상한이 숨겼던 모든 finding을 이제 보고하며, 각각을 code에서 고칩니다(K164).
- Composer monorepo에서 published package의 requirement를 기록하는 `make dependency-review RECORD=1`. 기록이 그것을 담을 때까지 `make dependency-policy-check`는 실패합니다(K168).

추가:
- make만 실행하는 root dependency(hyper의 `@polyspec/template-compiler` 등)마다 이유와 함께 `config/knip-entries.json`의 `ignoreDependencies`(K159).
- knip이 unused로 보고하지만 의도적으로 그런 파일(site가 보여 주는 sample 등)마다 이유와 함께 `config/knip-entries.json`의 `ignore`(K162).

수정:
- `make lint-ts`의 새 finding 하나하나를 disable 없이 code에서: tsc를 잠재우는 `@ts-ignore`나 `@ts-nocheck`, cast, `any`를 없애고 tsc가 통과하도록 type을 답니다. test에 필요한 `@ts-expect-error`는 기대하는 error를 밝힙니다(K155).
- `make dependency-policy-mutation-check`가 보고하는 `go.work`: use하는 module의 go.mod를 commit하거나 `use`를 지웁니다. 형제 레포의 local clone은 commit하지 않는 go.work나 `GOWORK`에 둡니다(K160).
- 도구가 이제 schema의 JSON Pointer와 함께 거부하는 manifest나 설정(예: `workspaces`가 object인 package.json, `repositories`가 object인 composer.json): schema의 형태로 씁니다(K158).
- `make lint-php`만을 위해 자기 lock이나 vendor/를 두었던 Composer monorepo의 library: 그것을 지우고 root development project에서 `composer install`을 실행합니다. 이제 그 vendor/가 lint에 쓰입니다(K163).
- `make lint-ts`의 `no-unsafe-*` 규칙의 새 finding 하나하나를 disable이나 cast 없이 code에서: JSON은 schema로 읽거나 `JSON.parse`의 unknown 값을 검사로 좁히고, error는 unknown으로 잡아 `instanceof Error`로 검사합니다(K157).
- 레포의 tsconfig: `make lint-ts`가 lint하는 모든 TypeScript 파일을 script와 benchmark까지 include하고, kit의 사본인 `scripts/kit`은 exclude합니다. project 밖의 파일에는 type이 없어 그 안의 import 호출은 모두 `typescript/no-unsafe-call`로 실패합니다(K157).
- 이제 `make kit-check`가 거부하는 `config/release.json`의 `buildBackend`: `config/toolchain.json`의 `pythonBackend`(`{ "requirement": "<name>==<version>", "sha256": "<sha256 of its wheel>" }`)로 옮기고 `make install-tools`를 실행합니다(K166).
- kit이 쓰는 file(`.mise/locks/…`, `config/php-lint/composer.json`, `config/phpunit/composer.json`)에 대한 `config/release.json`의 `notReleased` 항목과 `config/layout.yml`의 `vars.root_files`에 있는 `composer.json`, `composer.lock`: 이제 kit이 다루므로 지웁니다. `make kit-sync`가 `config/layout.kit.yml`을 씁니다(K167).

## 0.0.45

- knip.json은 make, go, rustup, shasum에 더해 polyspec이 mise나 setup으로 고정하는 runtime인 php, composer, python3, cargo, node, git의 binary를 무시합니다: php나 composer를 spawn하는 script가 unlisted binary였습니다. 한 레포만의 system 도구(Apple `container` 등)는 `config/knip-entries.json`의 `binaries`(`{ "<name>": "<reason>" }`)에 이유와 함께 선언하고, make lint-ts는 `entries`를 entry에 더하듯 그것을 `ignoreBinaries`에 더합니다. 이제 `entries`는 선택입니다(K152).
- `make dependency-policy-mutation-check`가 의존성 파일과 함께 `go.work`와 `go.work.sum`을 복사합니다: 그것이 없으면 workspace의 다른 member만 요구하는 module에 가질 수 없는 go.sum을 요구했으므로, `make dependency-policy-check`는 통과하는데 template(`tools/showcase/adapters/go`)에서 이 check가 실패했습니다(K153).
- `config/knip-entries.json`이 자기 package.json을 가진 중첩 npm project를 knip workspace로 선언합니다: `workspaces`는 그 directory를 이유, 그 directory 기준의 `entries`, `ignoreDependencies`(그 JavaScript가 import하지 않는 dependency, Rust test만 읽는 것 등)에 각각 이유와 함께 대응시키고, make lint-ts는 그것을 `var/lint-ts/knip.json`의 `workspaces`에 더합니다. root entry로 두면 그 dependency가 root에서 unlisted였습니다(ssr `packages/build/tests/fixtures`). 그 `.svelte` 파일은 knip의 Svelte plugin이 compile합니다(K154).

### 소비자 이전

실행:
- knip.json을 쓰는 `make kit-sync`(K152).

추가:
- script가 spawn하여 knip이 unlisted binary로 보고하는 레포의 system 도구(hyper의 `container`, template의 `gmake` 등)마다 이유와 함께 `config/knip-entries.json`의 `binaries`(K152).
- ssr `packages/build/tests/fixtures` 같은 중첩 npm project마다 그 파일을 root entry로 선언하지 않고 이유, entry, 무시하는 dependency와 함께 `config/knip-entries.json`의 `workspaces`(K154).

## 0.0.44

- kit의 도구는 repository root를 스스로 찾습니다. root는 working directory가 속한 Git work tree의 top level이므로, `npm -w`가 package directory에서 시작하듯 root 아래에서 시작한 도구도 repository의 path를 읽고 씁니다. `paths.mts`의 `ROOT`는 이제 처음 쓸 때 읽는 `repositoryRoot()`이며, root가 필요한 도구는 Git work tree 밖에서 실패합니다(K144).
- `config/release-assets.json`은 다른 polyspec repository의 release archive를 version, URL(`{version}`), sha256, 무시되는 var/ 아래 directory와 함께 한 번 고정합니다. `make release-assets-fetch`(ONLINE)는 var/에 없는 archive를 sha256을 확인하며 내려받고 `unpack`이 있는 zip을 풀며, `release-assets.mts version <name>`은 Makefile에 version을 주고, config/release.json의 `consumers.composer.polyspec`는 polyspec 의존성의 release zip을 Composer consumer의 artifact repository에 두며 release-tools가 그것을 내려받습니다(K140).
- 레포는 사본 knip.json을 고치지 않고 knip entry를 더합니다: `config/knip-entries.json`이 layout entry 밖에서 make가 실행하는 파일마다 이유를 적고, make lint-ts는 knip.json과 그 entry(`var/lint-ts/knip.json`)로 knip을 실행합니다. knip.json에는 더는 주석이 없으므로 lint-ts가 JSON으로 읽습니다(K145).
- `layout-root-files`는 레포의 root 파일을 kit의 목록에 더합니다: config/layout.yml은 자기 파일의 glob alternation인 `vars: { root_files: "{a,b}" }`만 정하며, make layout-check는 그 rule의 `paths`를 override하면 실패합니다(`layout-root-files-additive`). 그 override는 kit의 목록을 바꿨습니다(K145).
- `make install-tools`가 checkout에서 파일을 읽는 `rustup toolchain install --no-self-update`로 `rust-toolchain.toml`의 Rust toolchain을 그 component와 함께 설치합니다. rustup 1.28은 cargo가 처음 실행될 때 이를 더는 설치하지 않으므로, cargo를 실행하는 모든 CI job이 `toolchain '1.99.0-x86_64-unknown-linux-gnu' is not installed`로 실패했습니다. rustup이 없으면 그 설치 방법과 함께 실패하고, `make toolchain-check`는 설치되지 않은 toolchain을 수정 방법 `make install-tools`와 함께 알립니다(K151).
- `make install-tools`가 kit이 더는 쓰지 않는 `var/tools/bin`의 file을 모두 지웁니다. 예를 들어 kit 0.0.38의 `go`, `gofmt`, `python3`, `alint` wrapper입니다: 이 도구는 이제 mise에서 오며, PATH 맨 앞의 옛 wrapper가 mise의 shim을 가렸습니다. bootstrap의 mise, npm, npx와 선언된 Composer project의 wrapper는 남깁니다(K149).
- 사본 `scripts/kit/bootstrap/files.mts`와 `digest.mts`가 byte를 `NodeJS.ArrayBufferView`가 아니라 `Uint8Array`로 받습니다: consumer의 tsconfig는 kit의 사본을 담지 않아 oxlint-tsgolint가 node의 type 없이 검사했고, 해석되지 않은 type이 0.0.43의 ordered-json에서 `typescript/no-redundant-type-constituents`를 실패시켰습니다(kit 자신의 lint는 통과). make kit-sync를 실행하세요(K150).
- ruff가 복사된 `ruff.toml`의 `cache-dir`로 cache를 `var/ruff`에 둡니다: `make lint-python`이 repository root에 `.ruff_cache`를 남겼고, layout S5는 ignore하지 않는 한 이를 거부합니다. make kit-sync를 실행하고 `.ruff_cache`를 지우세요(K147).

### 소비자 이전

추가:
- `config/knip-entries.json`: knip.json의 layout entry 밖에서 make가 실행하는 파일(test probe 등)을 사용하지 않는 파일로 남기지 않고 이유와 함께 선언합니다(`{ "schema": 1, "entries": { "<glob>": "<reason>" } }`)(K145).
- 레포가 내려받는 다른 polyspec repository의 release archive마다 `config/release-assets.json`을, install target에 `make release-assets-fetch`를 둡니다. 자체 downloader(hyper의 `scripts/template-assets.mts`와 `config/template-assets.json`, fsm의 `composer-artifacts` recipe와 `config/composer-artifacts.txt`)는 지웁니다. tag가 필요한 Makefile은 `$(shell node $(KIT)/release-assets.$(KIT_EXT) version <name>)`로 읽습니다. 목적지는 var/ 아래에 있으므로 Composer `artifact` repository는 그 directory를 적습니다(K140).
- polyspec 의존성을 설치하는 Composer consumer에는 inline package repository 대신 config/release.json의 `consumers.composer.polyspec`와 consumer composer.json의 그 version `require`를 둡니다. make release-consumer-lock을 다시 실행합니다(K140).

변경:
- `config/layout.yml`: `layout-root-files`의 `paths` override를 레포의 root 파일만 적는 `vars: { root_files: "{a,b}" }`로 바꿉니다. 예를 들어 `- id: layout-root-files`에 `vars: { root_files: "{tsconfig.build.json}" }`를 둡니다. make layout-check는 그 override에서 실패합니다(K145).

실행:
- `ruff.toml`과 `scripts/kit/bootstrap`의 사본을 쓰는 `make kit-sync`(K147, K150), 이어서 `rust-toolchain.toml`의 Rust toolchain을 설치하고 `var/tools/bin`의 낡은 wrapper를 지우는 `make install-tools`(K151, K149). cargo를 실행하는 CI job은 그 앞에 `make install-tools`를 실행합니다.

제거:
- root의 `.ruff_cache`와, 그것 때문에 `.gitignore`에 넣은 항목이 있다면 그 항목(K147).

## 0.0.43

- parity는 test가 tests/<name>/main.rs인 cargo binding을 module을 가진 test target의 Cargo layout대로 `--test <name>`으로 실행하고, tests/<name>/의 다른 file을 binding이 없는 test가 아니라 그 binding의 module로 셉니다(K148).
- knip은 make가 실행하는 파일을 layout에 따라 entry로 둡니다: kit의 사본을 포함한 `scripts/` 아래 script, `benchmarks/`의 프로그램, 모든 node:test 파일이며, Makefile이 include하는 `@polyspec/kit`은 쓰이지 않는 dependency가 아닙니다. kit은 CI에서 make lint-ts로 자신을 lint하고 찾은 것을 고쳤으며, 그중에는 모든 consumer의 lint를 실패시킨 `scripts/kit/bootstrap/install-mise.mts`의 template literal이 있습니다. make kit-sync를 실행하세요(K142).
- `make dependency-review`와 `make dependency-policy-check`는 없는 설정 파일을 이름으로 알리고(`config/dependency-policy.json is missing; …`) 읽기의 stack trace 대신 상태 1로 끝납니다. 다른 모든 오류는 stack을 그대로 둡니다(K146).
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
