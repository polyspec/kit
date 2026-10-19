<!-- doc-id: changelog -->
<!-- source-sha256: 8d0d41c7b0ed2d6f59ac26c3121b5058cd61593f43562dda3535b904a9a9f47a -->
# 변경 기록

[English](CHANGELOG.md)

## Unreleased

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
