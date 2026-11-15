<!-- doc-id: spec-utilities-and-recipes -->
<!-- source-sha256: 812d74ed6c1e689e486af38f94b766d3cd817c4250453e898b9d041bcd59706d -->
# 유틸리티와 예제

[English](utilities-and-recipes.md)

## 문제

kit은 레시피를 강제한다. 레시피 한 벌(`scripts/kit/kit.mk`, `scripts/kit/kit-bootstrap.mk`, K1054 전까지)을 모든 저장소에 include시키고, 공유 CI에서 자기 검사의 결과를 필수로 요구한다. 모든 저장소가 함께 쓰는 레시피는 저장소마다의 경우를 감당해야 하므로, 새 경우마다 공유 덩어리에 분기, 스위치, 덮어쓰기가 붙었다. `UV_NO_CONFIG`, `MISE_*`, `unexport CARGO_TARGET_DIR`, `INSTALL_PACKAGES_EXTRA`, `npm_config_allow_remote=root`가 그 예다. 명령줄이나 환경변수의 덮어쓰기는 저장소 자신의 설정보다 우선하고, 필수 검사는 예상하지 못한 경우를 거부한다. 어느 쪽이든 저장소에 남는 수는 우회뿐이다.

allow-remote 사례가 그 연쇄를 보여 준다.
1. kit은 K1045 전까지 `allow-remote=root`를 강제했다.
2. 제공 라이브러리가 URL로 적은 의존성을 npm이 거부한다.
3. 제공 라이브러리는 어느 레지스트리도 내주지 않는 버전 번호로 물러선다.
4. 각 소비자가 그 패키지를 루트에 선언하고, `overrides`로 다시 고정하고, knip의 정확한 "안 쓰는 의존성" 지적을 막는다.

## kit이 제공하는 것

1. **유틸리티.** 유틸리티는 받은 인자와 파일로 동작이 정해지는 스크립트다. 도구 설치기, 검사기, 릴리즈 도구가 여기에 든다. 일부 유틸리티는 저장소의 레시피를 실행한다. 저장소가 이름을 대는 target을 실행하는 것으로, CI target 실행기(`ci-targets`), 저장소 자신의 설치를 실행하는 worktree 설정, 테스트 실행기가 그 예다. 저장소는 원하는 유틸리티를 자기 레시피에서 실행한다. 유틸리티는 레시피를 적힌 그대로 실행한다. 잘못된 레시피는 잘못된 대로 실행되며, 유틸리티는 그것을 판정하지 않는다. 유틸리티가 멈추는 것은 자기 일을 할 수 없을 때뿐이다. 도구가 없을 때, 커밋하지 않은 변경이 있는 main checkout에서 land할 때가 그 예다. 실패한 유틸리티는 자기가 바꾼 것을 찾은 그대로 남긴다. uv-install은 실패한 uv sync 전에 지운 provider 링크를 되돌린다(K1134).
2. **예제.** `docs/examples/`는 저장소들이 보편적으로 일하는 방법을 주제마다 작동하는 예제 하나로 보여 준다.
   - row의 worktree를 어떻게 짜고 그 안에서 어떻게 일하는가
   - 레시피를 어떻게 짜는가: 유틸리티를 실행하는 Makefile의 설치, 빌드, 테스트, lint, 릴리즈 target
   - 네이티브 설정을 어떻게 적는가: `.npmrc`, `uv.toml`, `mise.toml`의 `[settings]`, `.cargo/config.toml`
   - CI workflow를 어떻게 짜는가
   - 개발 중에 형제 checkout을 어떻게 링크하는가
   - 체크리스트 row를 Red부터 커밋까지 어떻게 진행하는가

   예제는 작동하는 방법 하나를 보여 준다. 저장소는 그것을 복사하거나, 바꾸거나, 무시한다.

## 로컬 workflow job (K1228)

`ci-job.mts --workflow <file> --job <id>`는 job의 script와 로컬 composite action을 선언된 순서로 실행한다.
`--matrix <key>=<value>`는 matrix 조합을 선택하고, `--plan`은 script를 실행하지 않고 plan을 출력한다. 외부 action은
입력과 함께 출력하고 실행하지 않으므로, 로컬 실행에는 해당 action이 설치할 도구가 필요하다.

- Expression은 native coercion, property filter, built-in function을 포함하여 GitHub의 `@actions/expressions`를 사용한다.
  실행은 status function과 지원하는 `github`, `runner`, `matrix`, `env`, `steps`, workflow 또는 composite `inputs` 값을 제공한다.
  로컬 실행이 제공할 수 없는 context는 script를 실행하기 전에 이름을 밝히고 거부한다. 외부 action의 output,
  secret, 저장소 variable은 로컬 script 실행이 제공할 수 없다.
- 따옴표로 감싼 expression literal은 `format`과 step condition에 쓰인 literal을 포함해 모든 겹친 작은따옴표를
  한 번씩 해석한다(K1228-1). Pin한 lexer는 첫 쌍만 해석하므로 adapter는 검증한 raw lexeme에서 STRING token 값을
  만들고 원래 lexeme과 range를 보존한다. Tokenization, syntax 거부, parsing, evaluation은 native로 유지한다.
  Pin한 lexer가 정규화 없이 같은 반복 escape 회귀 시험을 통과하면 adapter를 제거한다. 이미 해석한 token 값을
  고치면 첫 쌍을 두 번 해석하게 된다.
- Workflow input은 plan이나 script 실행 전에 결정한다(K1233). 반복하는 `--input name=value` 인자는 첫 `=`에서
  나누고 빈 text와 뒤의 `=` 문자를 보존하며 선언한 이름에 대소문자를 구분하지 않고 연결한다. 이 CLI 연결 규칙은
  expression context의 대소문자를 구분하지 않는 조회를 따른다. 중복 input 이름과 대소문자만 다른 선언은 거부한다.
  Boolean 인자는 정확히 `true` 또는 `false`이고 number 인자는 공백 없는 유한 JSON number 문법을 따른다.
  String 인자는 text로 유지하며 default는 이미 선언한 type이어야 한다. Expression default는 native default 평가
  context를 이 로컬 runner가 제공하지 않으므로 literal text로 취급하지 않고 거부한다. 명시한 지원 type이 없는
  input 선언도 거부한다. 소문자로 바꾼 이름이 Object.prototype의 own property와 겹치는 선언도 이름을 밝히고
  거부한다. Pin한 native Dictionary가 해당 key를 조용히 버리기 때문이다. 원래 대소문자가 prototype property와
  같다는 이유만으로 거부하지는 않는다. Native 조회는 먼저 이름을 소문자로 바꾼다. Pin한 native Dictionary가
  evaluation과 serialization 회귀 시험에서 이 key들을 보존하면 이 제한을 제거한다.
- 선택한 `workflow_call` 선언은 문서화된 암시적 default를 제공한다. Boolean은 false, number는 0, string은 빈
  text다. 선언한 default가 없는 required input에는 명시한 값이 필요하다. `workflow_dispatch` 선언은 boolean,
  number, string, choice, environment input을 지원한다. Choice 값은 options에 속해야 하고 environment 값은
  GitHub에 조회하지 않는 text다. 선언한 default가 없는 dispatch input은 optional이어도 명시한 값이 필요하다.
  이 로컬 runner는 native에서 생략한 값을 확정하지 않기 때문이다. 알 수 없는 이름, 잘못된 type, 누락한 값과
  지원하지 않는 선언은 `--plan`을 포함해 script 실행 전에 실패한다.
- Input을 받을 수 있는 event 선언이 하나면 다른 event를 함께 선언했어도 자동으로 선택한다.
  `--input-event workflow_call` 또는 `--input-event workflow_dispatch`는 두 선언 중 하나를 선택한다. 두 선언을
  선택하지 않은 상태에서 input을 읽는 job은 거부한다. `--input-event`를 반복하거나 없는 선언을 선택해도 거부한다. 이는 로컬 input 선언의
  선택이며 GitHub event를 만들거나 `github.event` 값을 제공하지 않는다. Typed workflow input은 workflow와 job
  environment, job condition, matrix, default, output, step에 전달한다. Composite action은 자신의 string input으로
  이를 가린다. Composite 사전 검사는 내부 input 값을 추측하지 않고 caller input을 가린다. Runtime guard는
  script 실행 전에 실제로 연결한 composite input으로 계산한 외부 output producer를 검사한다. Reusable caller
  job은 계속 거부하며 호출할 workflow 자체의 job을 실행해야 한다.
- 각 script는 새로운 `GITHUB_OUTPUT`, `GITHUB_ENV`, `GITHUB_PATH`, `GITHUB_STEP_SUMMARY` 파일을 받는다. Output은 해당
  step에 속하며, environment 변경과 path 항목은 다음 step에 전달된다. Output과 environment 파일은 `name=value`와
  delimiter를 사용하는 multiline 값을 모두 받는다. 잘못된 file command는 해당 step을 실패시키지만, 다른 정상 채널의
  변경은 적용하므로 cleanup step이 사용할 수 있다.
- Step이 실패하면 status function이 없는 후속 condition은 건너뛴다. `failure()`, `always()`, `!cancelled()`를 사용하는
  condition은 native 의미를 유지하며, 허용된 실패의 outcome은 failure이고 conclusion은 success다.
  허용하지 않은 step 실패가 있으면 이후 cleanup step이 성공해도 job은 실패한다.
- Matrix는 axes, exclusions, inclusions, fail-fast 설정을 적용한다. `needs.<job>.outputs`를 읽는 job은 먼저 해당
  dependency를 실행한다. 다른 dependency 속성과 matrix job의 output은 로컬 실행이 전체 CI 실행의 결과나 마지막에
  끝나는 matrix 조합을 재현할 수 없으므로 거부한다.
- 실행은 script process와 runner 임시 디렉터리를 소유한다. 중단하면 새 step의 실행을 막고, 소유한 process를 종료하고
  기다린 뒤 디렉터리를 지운다. Process는 runner 디렉터리가 존재하는 동안 cleanup을 마쳐야 한다.

## Installer command 검증 (K1232)

Installer command test는 로컬 service의 archive 요청, downloader의 settled result, 소유 helper의 close,
installer의 close를 관찰한다. 전체 경과 시간의 deadline은 성공을 판정하지 않는다. Native process 시작이 download
retry보다 오래 걸릴 수 있기 때문이다. Download library가 request limit을 소유하고, 소유 process cleanup은 선언한
termination grace를 유지한다. 첫 archive response를 보류하는 동안 주입한 test clock을 진행해도 installer를 죽이거나
result를 바꾸면 안 된다. Test는 response를 풀어 중단된 요청과 성공한 retry를 관찰한 뒤 publication과 process
cleanup을 검증한다.

Fixture는 소유 command가 닫힐 때까지 유지한다. Assertion이 실패해도 test는 proxy의 upgraded connection을 닫고,
server의 close를 기다린 뒤 관련 파일을 지운다. Download 속도와 별개로 native lifecycle test가 helper의 협력 종료와
escalation을 검증한다. Test는 이 lifecycle에 두 번째 deadline을 추가하지 않는다.

## Progress event 관측 (K1235)

Progress heartbeat는 test event를 기다리는 상태를 보고한다. 이름을 적은 각 case는 마지막으로 active라고
보고되었으며 heartbeat의 경과 시간은 reporter가 시작 event를 관측한 뒤 흐른 시간이다. Case가 현재 실행 중이거나
이 시간이 native 실행 시간이라고 단정하지 않는다. 이후 동기 작업이 실행되는 동안 native event가 buffer에 남을 수 있다.

Heartbeat 주기, run의 경과 시간 prefix, native 결과 시간, count, 선택, tool timeout, process cleanup은 바꾸지 않는다.
Progress run을 닫으면 계속 interval을 해제하며 관측 대기에 deadline을 추가하지 않는다.

## Case-sensitive test directory (K1231)

이름의 대소문자 구분이 필요한 test는 실행 전에 실제 두 이름 probe를 통과한 filesystem의 directory를 받는다.
Darwin은 disk image를 caller의 임시 parent 아래에 두지만 빈 mountpoint는 `getconf DARWIN_USER_TEMP_DIR`가 보고하는
native 사용자 임시 directory 아래에 만든다. Disk Arbitration은 소유권을 무시하는 volume의 mountpoint를 거부할 수
있으므로 caller가 선택한 임시 저장 volume으로 native mountpoint도 선택할 수는 없다. 모든 test file은 mount된 image에
있으며 빈 mountpoint directory만 native 임시 저장소를 사용한다. Linux와 Windows는 기존 directory provisioning을 유지한다.

실행은 image 저장 directory와 mountpoint directory를 따로 소유한다. 두 directory를 지우기 전에 image를 detach한다.
Detach가 실패하거나 결과를 확인하지 못하면 두 directory를 보존하고 두 path, command 실패, 필요한 cleanup 순서를
보고한다. 비어 있지 않은 절대 경로의 native 임시 directory를 찾지 못하면 attach 전에 실패하며, 추측한 path를 대신
사용하거나 case probe를 건너뛰지 않는다.

## Command resource 수명 (K1231-1)

비동기 command resource scope는 준비부터 cleanup까지 resource를 소유한다. 제어하는 action은 소유한 일반 command를
기다리며 resource를 사용하는 작업을 기다리지 않은 채 남기지 않는다. Action이 끝난 뒤에 cleanup을 시작하며 반환한
promise가 끝날 때까지 resource를 유지한다. 정상 완료와 action 실패 모두 cleanup을 기다린다. Action과 cleanup이
모두 실패하면 호출자에게 두 오류를 전달한다.

중단하면 일반 command 실행을 즉시 막고, 소유한 작업 group에 종료를 요청하여 자식 close와 cleanup을 기다린다.
Harness는 이어서 모든 active resource scope의 cleanup이 끝난 뒤 SIGINT는 130, SIGTERM은 143으로 종료한다.
Resource cleanup callback은 그 callback 실행 중에만 유효한 runner를 받는다. 해당 command도 소유하고 기다리며,
새 작업 실행이 아니라 cleanup이다. 보관한 cleanup runner는 callback이 끝난 뒤 command를 시작할 수 없다.

Runtime runner는 native 인자와 상속한 표준 입력을 유지한다. 해당 native runner가 닫힐 때까지 결과 디렉터리와
case-sensitive 시험 filesystem을 유지한다.
선택한 environment 값을 복구하고 image를 detach한 뒤 mountpoint나 image 저장소를 제거한다. 명시적인 결과 report가
있으면 native test runner는 report의 부모 디렉터리를 만들고 그 안에 private counts와 extension 설정을 둔다. Report
입력을 hash하기 전에 private 디렉터리를 제거한다. Report가 없으면 호출자의 임시 디렉터리 배치를 유지한다. 두 형태
모두 자식의 임시 디렉터리 environment를 바꾸지 않는다. Cleanup 실패는
남아 있는 resource를 보고하며 중단되거나 실패한 실행을 성공으로 바꾸지 않는다.

## Native event identity (K1091)

Native event parser는 framework의 완전한 test identity를 보존한다. PHPUnit TeamCity message의
`TestRef.id`는 `locationHint`의 fully qualified class, method, data set이며 맨 앞 namespace separator만 제외한다.
`TestRef.name`은 native display name을 유지한다. Parser는 동시에 진행되는 event flow를 구분한다.
서로 다른 namespace의 class는 class basename, method, data set이 같아도 구별된다.
명시적 invocation, selection, expected case inventory는 repository가 소유하며 이 utility는 해당 정책을 추가하지 않는다.

## 짝 문서의 merge driver (K1197)

`make hooks`는 merge driver `kit-twin`, `kit-changelog`, `kit-checklist`를 선언한다(`twin-merge.mts`, K354). 한국어 짝은 git이
merge하는 그대로의 영어 파일에서 revision marker를 받으므로, driver는 git이 실행하는 merge의 세 쪽에서 영어 파일을 읽는다.
branch를 들이는 기본 방법인 merge에서 theirs는 git이 merge하는 commit이다. git은 `MERGE_HEAD`를 merge가 멈춘 뒤에야
쓰므로, 그 commit을 driver 환경의 변수 `GITHEAD_<commit>`으로 알려 준다. base는 `git merge-base HEAD <commit>`이다. `main`보다
뒤진 branch에 `make land`가 실행하는 rebase(K495-1)에서 theirs는 rebase가 적용하는 commit, 곧 `rebase-merge/done`의 마지막
commit이고 base는 그 부모이다. cherry-pick처럼 그 밖의 작업은 어느 쪽도 알려 주지 않으며, driver는 merge를 이름으로 대고
실패한다. 세 쪽을 알 수 없거나 checklist의 task row를 양쪽이 서로 다르게 바꿔 파일을 merge할 수 없는 driver는 `git
merge-file`의 충돌을 양쪽 표시와 함께 그 파일에 쓰고 1로 끝난다. 그래서 작업 파일은 다른 쪽의 흔적 없이 한쪽만 담는 일이
없다.

## 문서 속의 commit 이름 (K1210)

`commit-names-check.mts`는 추적되는 Markdown 파일이 Git commit을 적지 않는지 보는 검사다. release와 lock이 commit을 고정하며,
문서에 적힌 이름은 history가 바뀌면 틀린 값이 된다. 그런 이름을 금지하는 규칙을 가진 저장소는 자기 recipe에서
`$(NODE) $(KIT)/commit-names-check.$(KIT_EXT) --except '<glob>'`로 이 검사를 돌리고, 읽지 않을 경로를 `--except <glob>`으로
하나씩 선언한다. lock 파일과 workflow는 Markdown이 아니므로 읽지 않는다. finding마다 `<file>:<line>:<column>: names the Git
commit <name>` 한 줄을 출력하고 exit 1로 끝난다. Markdown 파일을 하나도 읽지 않은 실행은 실패한다.

- 경계: 후보는 양쪽에 ASCII 글자나 숫자가 닿지 않은 소문자 16진수 7~40자리다. 세 가지 이음은 그 자리를 더 긴 낱말의 일부로
  만들며, 그것은 후보가 아니다: 그 자리와 글자나 숫자 사이의 `.`(파일 이름, version, 소수), 그 자리와 16진수만으로 된 이웃 자리
  사이의 `-`나 `_`(UUID, 묶음으로 쓴 digest, 날짜). 다른 모든 문자는 이름을 끝낸다. `:`, `=`, `@`, `#`, `/`, 그리고 16진수가 아닌
  낱말 앞의 `-`나 `_`도 그렇다.
- 내용: 숫자와 글자를 모두 가진 후보는 commit 이름이다. 숫자만이거나 글자만인 후보는 같은 줄에서 marker가 바로 앞에 있을 때만
  commit 이름이다. marker는 대소문자를 가리지 않는 낱말 `commit`, `commits`, `sha`, `rev`, `revision`에 선택적 공백, `:`, `=`, `/`
  중 최대 하나, 선택적 공백, backtick 최대 하나가 따르는 것, 또는 `@`에 backtick 최대 하나가 따르는 것이다. 7자리 이상의 수는
  대개 날짜, 크기, run id이므로 marker 없이는 이름이 아니다.
- 받아들이는 미탐: marker가 없는 숫자만의 이름이나 글자만의 이름(낱말 `at` 뒤도 포함한다. `at`은 크기와 날짜 앞에도 온다),
  대문자 16진수로 쓴 이름, `-`나 `_`가 16진수만으로 된 낱말에 이은 이름.
- 받아들이는 오탐(commit이 아닌 것): 숫자와 글자를 가진 그 밖의 16진수 7~40자리 낱말, 예를 들어 파일의 SHA-1 digest. 그런
  경로는 `--except`로 선언한다.

## kit이 하지 않는 것

kit은 어떤 것도 강제하지 않는다. 특히 다음과 같다.

- kit은 저장소에 레시피를 include시키지 않는다.
- kit은 다른 도구의 설정을 정하지 않는다. 명령줄에서도, 환경변수에서도, 유틸리티가 실행하는 도구의 환경에서도 그렇다. 도구 설치기는 자기가 설치하는 것을 어디에 두는지 정하며, 그것은 설치기 자신의 일이다. mise 설치기는 호출자가 다른 환경을 넘기지 않으면 자기가 설치하는 mise의 디렉터리와 그 shim이 읽는 checkout의 설정 파일을 정한다(`MISE_DATA_DIR`, `MISE_CACHE_DIR`, `MISE_STATE_DIR`, `MISE_CONFIG_DIR`, `MISE_GLOBAL_CONFIG_FILE`, `MISE_GLOBAL_CONFIG_ROOT`). Go에는 환경을 주지 않고, `var/tools`에 다른 파일을 쓰지 않으며, mise가 기록한 trust를 지우지 않는다(K1092). 이 중 어느 것도 저장소의 도구가 어떻게 동작할지를 정하지 않는다. PHP의 lint는 PHPStan에 패키지의 Composer가 쓴 autoloader를 준다(`--autoload-file`). 그것이 없으면 PHPStan은 패키지의 호출을 해석하지 못한다. `--locked`, `--profile minimal`, `--memory-limit=-1` 같은 flag는 호출자의 것이다. 유틸리티는 호출자가 준 인자를 넘기고 자기 것은 넘기지 않는다(K1097).
- Rust의 lint는 checkout의 각 Cargo workspace 폴더에서 clippy step을 하나씩 실행하고, 첫 `--workspace-args`보다 앞의 인자를 모든 step에 준다. `--workspace-args <folder>`는 그 뒤부터 다음 `--workspace-args`까지의 인자를 `<folder>`에 있는 workspace의 step에만, 모든 step의 인자 뒤에 준다. `<folder>`는 그 Cargo.toml이 있는 폴더의 저장소 상대 경로이다(root는 `.`). checkout의 Cargo workspace가 없는 폴더와 폴더 없는 `--workspace-args`는 어느 step도 실행하기 전에 lint를 실패시키고 checkout의 workspace를 나열한다. 그래서 package의 `--exclude`는 그 package를 가진 workspace에만 가고, cargo는 다른 workspace에서 뜻이 없는 제외를 경고하지 않는다(K1195).
- kit은 저장소의 CI, hook, gate에 어떤 결과도 필수로 요구하지 않는다.
- kit은 저장소의 레시피나 예제를 검사하는 기능을 제공하지 않는다.

## kit의 일이 아닌 것 (K1219)

kit은 저장소가 만든 규칙을 시작한다. 그 규칙은 저장소의 Makefile과 설정이 선언한 target, 검사, release 단계이다. kit은 저장소의
일을 대신하지 않는다. 저장소가 무엇을 build하고 pack하고 tag하고 증명하고 publish하는지, 어떤 순서와 어떤 값으로 하는지는
저장소의 파일이 적는다. 그래서 그 단계를 자기 코드로 정하거나 한 종류의 package 구조를 가진 유틸리티는 kit의 일부가 아니다.
kit은 package manager가 아니다. 설치, download, version 결정, package의 build와 pack은 npm, Composer, cargo, go, uv, mise,
rustup의 일이고, 유틸리티는 recipe가 준 인자로 그것들을 시작한다. local link는 개발 도구로서 kit의 일부이다. link는 개발자의
checkout을 서로 잇고, 어느 release도 link를 읽지 않는다(K591, K869).

### 제거한 것

- `link.mts packages <dir> python|npm` (K1217). 폴더의 manifest가 선언한 polyspec package를 `uv sync --no-install-package`의
  인자로 출력했다. 아무도 쓰지 않는 link의 표면이었다. 어느 recipe도 부르지 않았다.
- package의 export `./link-folders` (K1218). 설치 폴더를 link로 바꾸는 함수를 저장소의 test에 주었다. 아무도 쓰지 않는 link의
  표면이었다. 저장소의 어느 파일도 import하지 않았다.
- `release.mts go-modules`와 `release-go-module.mts`, target `release-go-modules` (K1220). tag의 commit에서, Go module의 생성
  파일과 플랫폼별 정적 라이브러리를 더한 commit을 만들고, 거기에 `<directory>/vX.Y.Z` tag를 달고, 그 tag에서 consumer의
  `go test`를 실행했다. Go module의 tag가 어떤 파일을 담고 무엇으로 증명하는지는 저장소의 release이다. 저장소의 recipe가 자기
  index에서 `git read-tree`, `git update-index --add --cacheinfo`, `git write-tree`, `git commit-tree`를 실행하고,
  `git tag -a <directory>/vX.Y.Z <commit>`과 `git push <remote> <tag>`를 가지며, 그 앞에 원하는 검사를 둔다.
- config/release.json의 플랫폼별 package 종류 `wheel-abi3`, `php-ext`, `npm-native`, `go-static`과 `release-native.mts`, asset
  set(`RELEASE_PLATFORM`, `RELEASE_PHP`, `release.mts sets`, target `release-sets`), 예시 release workflow의 matrix, 예시
  `workflows/release-candidate.yml` (K1221). Rust core와 그 binding을 플랫폼마다 어떻게 build하고 pack하는지(cargo, uv build를
  통한 maturin, napi CLI, PIE archive, llvm-strip), 그 asset의 이름, workflow의 job과 플랫폼별 runner를 kit의 코드가 정했다.
  그것은 저장소의 build와 release이다. 저장소의 recipe가 그 도구를 직접 실행해 archive를 asset 폴더에 쓰고, 저장소의 workflow가
  자기 matrix를 적는다. `release.mts assets`는 전과 같이 `npm`, `composer`, `wheel` package를 빌드한다.
- config/release.json의 `contracts` (K1222). release는 archive를 빌드하기 전에, 선언된 파일마다 저장소의 contract 도구를
  `<check> <file> --release`로 실행했다. 인자 `--release`와 release 안에서 그 검사의 자리는 한 contract 도구에 대한 지식이다.
  저장소의 recipe가 `release-assets`를 시작하기 전에 자기 contract 검사를 실행한다.
- `php-extension.mts`의 cargo build (K1223). Cargo.toml이 있고 `src/config.m4`가 없는 extension 폴더에 대해, `build`는 extension
  이름을 composer.json의 `php-ext.extension-name`에서 읽고 checkout의 php와 php-config로
  `cargo build --release --locked -p <package>`를 실행했다. cargo가 빌드하는 extension을 어떻게 빌드하는지는 그 저장소의 recipe가
  적는다.

## 근거

- 강제한 설정과 필수 결과 하나하나가 저장소의 선택을 없앴다. 저장소의 경우가 kit의 예상과 다르면 남은 수는 우회뿐이었다. "문제"에 적은 덮어쓰기는 모두 거기서 나왔다.
- 저장소 자신의 레시피는 자기 경우 하나만 적으므로 분기가 필요 없다. 도구는 네이티브 파일을 문서에 적힌 대로 읽는다.
- 예제는 작동하는 방법을 전하되 누구도 거기에 묶지 않는다.
- 레시피를 검사하는 기능은 kit이 저장소 위에 정하는 새 규칙이 되고, 그것은 다시 같은 강제다.

## kit에 대한 결과

kit은 자기가 강제하는 것을 지운다. 각 변경은 Red, Green, 커밋을 거치는 체크리스트 행이다. 지금 강제하는 부분은 다음과 같다.
- **include되는 레시피.** K1054 전까지 저장소는 package의 `scripts/kit/kit.mk`와 `scripts/kit/kit-bootstrap.mk` 레시피 한 벌을 include했고, AGENTS.md는 그들을 위해 kit.mk의 모든 레시피의 mise 환경을 적었다. 이제 package는 make 파일을 싣지 않는다. kit.mk는 kit 자신의 Makefile의 레시피이고, bootstrap은 예시 `docs/examples/bootstrap.mk`이며, toolchain-lock 레시피는 UV_PYTHON을 적지 않고 `mise.toml`의 `[env]`가 정한다.
- **유틸리티 안의 덮어쓰기.** `bootstrap/install-mise.mts`(`miseEnvironment`)와 `mise-tools.mts`(`toolsEnvironment`)는 K1048 전까지 자기가 실행하는 도구에 mise와 uv의 설정(`MISE_LOCKED`, `MISE_AUTO_INSTALL`, `UV_*`, `UV_PYTHON`)을 넣었고, `link.mts`와 `run-tests.mts`는 K1049 전까지 `CARGO_TARGET_DIR`를 지웠다. K1050 전까지 lint 유틸리티는 각 도구를 저장소 자신의 설정 대신 kit의 설정으로 실행했다. golangci-lint는 kit의 `.golangci.yml`로, phpcs는 kit의 `phpcs.xml.dist`로, ruff는 kit의 `ruff.toml`로, clippy는 kit을 가리키는 `CLIPPY_CONF_DIR`로, oxlint와 knip은 kit의 `.oxlintrc.json`과 `knip.json`으로 실행한다.
- **저장소의 레시피와 workflow에 대한 검사.** K1051 전까지 kit-check는 레시피가 도구를 실행하는 방식(`recipe-tools.mts`), Makefile과 workflow의 링크 단계(S11), ci.yml의 모양과 마지막 `ci-passed` job(S12), Makefile의 `$(KIT)/<name>`(S15), manifest 경로(P30)를 판정했고, bypass-check는 Makefile과 스크립트를 판정했다. K1070 전까지 kit-check는 각 config/<name>.json을 그 이름의 kit schema로 검증했다. 이제 kit-check는 없고, 각 도구가 자기가 읽는 설정을 검증한다.
- **복사본.** K1052 전까지 kit-sync는 kit package.json의 `kit.copies` 항목 전부를 모든 저장소에 썼다. `PRINCIPLES.md`와 그 짝, `ci-pipeline.yml`, `release.yml`, bootstrap action, `config/layout.kit.yml`, `config/` 아래의 스키마, `.editorconfig`, `.claude/settings.json`이 그 안에 들었다. kit-inject-check가 바뀐 복사본을 실패시켰으므로, 복사본 파이프라인의 마지막 `required` job은 모든 저장소를 `kit-gates-*` gate를 포함한 파이프라인의 모든 job 결과에 묶었다. 이제 package는 이 파일을 예시로 담는다. 저장소는 원하는 것을 복사해 각 사본을 자기 것으로 가지며, 그 파이프라인과 그 job도 마찬가지다. kit은 어느 것도 쓰거나 비교하지 않는다. 그 파일에 대한 kit.owners의 owner 규칙, lint-ts와 rebuild-check의 사본 제외, 사본 편집에 대한 claude-hook의 거부, layout 규칙 `lint-cargo-lints`와 `config/cargo.schema.json`도 함께 사라졌다.
- **거부.** K1053 전까지 다음이 거부했다.
  - `.claude/settings.json`의 Claude hook(`claude-hook.mts`)은 모든 저장소의 세션에서 명령을 거부했고, `make link`와 `make hook`이 그것을 각 checkout과 workspace 폴더의 설정에 썼다.
  - `make hooks`가 쓴 git hook은 커밋을 거부했다. commit-msg hook과 staged-generated hook이며, `commit` target도 이것들을 실행했다. `make item-test`와 docs-check는 Claude hook이 거부하는 Verification 명령을 거부했다.
  - `ci-targets`, `owner-check`, 선택 없는 run-tests, runtime-targets의 suite, 전체 `parity-check`는 FINAL_RUN이 깨끗한 커밋 트리를 가리키지 않는 한 CI 밖에서의 실행을 거부했다.
  - `land`는 정적 gate나 커밋 규칙이 실패하는 branch를 거부했고, 자기가 고정한 gate가 저장소 `kit-gates`의 선행 조건에 들어 있기를 요구했다.
  - `item-state`는 changelog 줄 없는 완료와, Verification이 통과하지 않은 검증 중 또는 완료로의 이동을 거부했다.
  - `ci-setup`은 `kit-ci-setup`을 다시 실행하는 설정 target을 거부했다.
  - `run-tests --venv`는 Python이 checkout의 것이 아닌 환경을 거부했다.
- **Parity.** K1129 전까지 kit은 `config/parity.json`을 읽고 저장소의 구현들이 서로 어떻게 관계되는지 검사했다. 공유 unit, requirement 인용, test 이름과 id, public symbol, divergence, test marker(parity-check, parity-declarations-check, divergence-check, test-markers-check)이며, CI 파이프라인에 parity job이 있었다. parity 삭제: kit은 구현들이 서로 어떻게 관계되는지 검사하지 않으며, 각 저장소가 자기 테스트를 실행한다.
- **owner 거부.** K1131 전까지 owner-check는 저장소가 무엇을 선언하거나 넘기든, recipe 문장이 ci-targets를 시작하는 target과 make 변수 CHECK_TARGETS의 모든 target을 고르는 규칙을 각각 full suite로 보고 거부했다. 이제는 저장소 자신의 `fullSuite`가 적은 target만 거부한다.
- **Verification cell.** K1132 전까지 docs-check(verification.mts)는 Verification 열이 있는 checklist의 모든 열린 item이 거기에 backtick으로 command를 적기를 요구하고 pipeline을 거부했으며, 다른 checklist 규칙과 달리 저장소의 recipe가 뺄 수 있는 flag가 없었다. docs-check는 command를 요구하지 않으며, `make item-test`는 여전히 cell이 적은 command를 실행한다.
- **규칙 문장.** PRINCIPLES의 `Enforced by:` 줄은 이 검사들(S11, S12, S13, S15 등)을 적었고 각 삭제와 함께 바뀌었다. K1055 전까지 PRINCIPLES의 본문은 모든 저장소를 kit의 파이프라인(S12), kit의 gate(P31), kit에서만 하는 변경에도 묶었다. 이제 배포되는 PRINCIPLES는 kit이 더는 강제하지 않는 검사를 주장하지 않는다.

작동하는 부분은 kit에서 지우는 바로 그 변경에서 `docs/examples/`의 예제가 된다. 삭제는 kit의 새 패치 릴리즈로 나간다. 저장소는 자기가 설치하는 kit 릴리즈를 고정하므로, 새 릴리즈를 받을 때까지 지금 릴리즈를 유지하고, 받을 때 예제를 보고 자기 레시피를 쓴다.
