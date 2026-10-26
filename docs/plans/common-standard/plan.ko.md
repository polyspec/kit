<!-- doc-id: plan-common-standard -->
<!-- source-sha256: 7d80e7ee0b655d3dd5599a8c1cbf936fb478cd8f9b029f1595d71cbb0a0c874e -->
# 공통 표준

[English](plan.md)

## 목표

모든 polyspec 저장소는 folder, plan과 checklist, test, command에 하나의 표준을 따른다. 표준은 kit이 가진다.
PRINCIPLES.md가 각 규칙을 한 번 기술하고, kit tool이 그 규칙을 강제하며, 저장소는 저장소마다 실제로 다른 data
(`config/*.json`)와 자기 제품의 규칙(AGENTS.md)만 가진다.

## Source link와 bootstrap 인계 (2026-10-26)

구현 상태와 배포 상태를 구분합니다. K657과 K664는 source 설치를 native npm, Composer, uv, Go, Cargo에 위임합니다. 앱이 선언과 호환되는 개발 lock을 소유하며 일반적인 앱 수정마다 kit을 고칠 필요는 없습니다. 현재 운영 계약은 [local link](../../operations/local-links.ko.md)입니다.

K671은 K614의 필수 sibling checkout과 추적된 공유 파일 link, K670의 우회 처리를 대체합니다. 소비자는 설치 package의 bootstrap을 include하고 kit-sync는 일반 공유 사본을 씁니다. Native `npm link ../kit`은 선택적인 로컬 개발 수단으로 유지합니다. Kit 자체는 공개된 자기 package를 설치하지 않고 자기 source를 실행합니다. CI에 sibling clone을 복구하면 제거한 의존성이 다시 생깁니다.

K670-1은 PHP tokenizer 설정을 유지하고 K670-3은 release chore에서 구현 변경은 거부하면서 release manifest metadata를 허용하며 K670-4는 무관한 Python project를 건너뜁니다. K671에서는 제안된 일괄 `--legacy-peer-deps`와 이미 연결된 대상 생략을 채택하지 않았습니다. 확인된 npm 실패는 lock 읽기를 유지해 해결했습니다. 후속 K673과 K674가 멱등한 source 인식을 추가·보완하며 그 증거는 앞선 CI가 아닌 해당 후속 변경의 증거입니다.

### Release 상태와 다음 작업

- K655, version 0.0.55: 준비와 소유 검사는 CHANGELOG.md에 기록되어 있고 공개는 대기 중입니다. [CI run 40313948359](https://github.com/polyspec/kit/actions/runs/40313948359)는 K672-1까지 검사하며 kit test는 1398개 통과, 4개 실패를 보고했습니다. 남은 source test와 gate를 끝까지 수집한 뒤 전체 실패를 분류합니다. 이 실행을 취소하거나 소유 검사 결과를 전체 CI 승인으로 간주하지 않습니다.
- K673과 K674는 해당 CI에 포함되지 않은 후속 로컬 main commit입니다. K677은 공개된 0.0.55 tag 밖의 승인 변경을 포함할 후속 0.0.56 release를 추적합니다. 0.0.55가 공개되기 전에는 수정이 해당 candidate에 남을 수 있으므로 로컬 commit이 이미 공개된 version에 속한다고 가정하지 말고 최종 candidate를 확인합니다. 각 release는 자기 code의 CI와 consumer proof를 통과해야 하며 0.0.55 결과는 0.0.56의 검증 증거가 아닙니다.
- CI가 실패하면 해당 release는 진행하지 않습니다. 실패 소유 범위를 수정하고 선택 검사 후 수정된 release candidate를 push합니다. 개발 중 전체 로컬 suite를 반복하지 않습니다. Candidate의 CI 통과 뒤 [release 절차](../../operations/release.ko.md)를 따르며 tag, draft, version bump만으로 공개 release라 하지 않습니다.
- K676은 source 선택 검사로 입증하지 않은 Cargo target directory 상속 문제를 기록합니다. K678은 반복되는 package test 준비 비용을 검토합니다. Native 격리 설치와 package 소비 검증은 계속 필요하며 준비 비용만으로 해당 검사가 부당해지는 것은 아닙니다.

K675는 이 인계를 기록합니다. Checklist의 완료는 해당 구현과 증거의 완료이며 K655와 K677은 release 공개까지 미완료로 유지합니다. 배포 상태를 갱신하기 전에 Git, CI 실행, release를 확인합니다. Checklist는 task만, CHANGELOG.md는 실제 변경과 검사 증거를 담고 이 절은 관계와 남은 작업을 설명합니다.

## 원인

kit을 쓰는 저장소(orm, template, crudui, hyper, fsm, ordered-json)와 flowmark를 2026-10-19에 각 `main`의 head에서
측정했다.

- kit은 모든 곳에서 같아야 하는 것을 저장소가 설정하게 한다. `config/checklist.json`이 각 checklist의 state와
  format을 선언한다. template, crudui, hyper, ordered-json은 state 4개, orm, kit, fsm, flowmark는 5개이고, orm과
  flowmark는 list format, 나머지는 table format이다.
- 모든 AGENTS.md가 공통 규칙(commit format, branch와 worktree, Red와 Green, timeout, 한국어 문서, symbolic link,
  uncommitted 범위)을 각자의 문장으로 다시 기술한다. 파일은 88줄에서 280줄이고, 문장이 서로 다르다.
- 모든 AGENTS.md가 저장소의 checklist를 하나로 정하지만, checklist는 plan에 속한다. 저장소당 checklist 하나는 끝없이
  커진다. orm은 항목 1269개에 1.6 MB, kit, template, crudui, hyper는 179 KB에서 262 KB다.
- full-run guard는 waiting 또는 active 항목이 없을 때, 즉 작업이 끝난 직후에 `make check`를 허용한다. PRINCIPLES.md는
  full suite를 수정마다, 항목마다, 끝에서도 돌리지 않는다고 정한다. agent가 full suite를 돌리는 것을 막는 tool이 없다.
- test의 선택과 이름이 저장소마다 다르다. 8개 저장소 중 6개 이상에 있는 target은 `check`와 `install`뿐이다. 한
  작업이 `test-ts`, `test-js`, `test-node`, `test-npm`이라는 이름을 가지고, 다른 작업은 `ext`, `php-ext`,
  `php-extension`, `build-php-extension`이라는 이름을 가진다.
- S5는 TypeScript 소스에 `packages/ts`와 `packages/js`를 둘 다 허용한다. ordered-json은 package마다 AGENTS.md,
  CHANGELOG.md, Makefile을 둔다. 문서는 서로 다른 folder에 배치된다. flowmark는 Go 코드를 root folder 15개에 둔다.
- PHP extension은 5가지 model을 따른다. `Native` namespace(orm, template), PHP library의 class 이름(crudui, fsm),
  PHP library가 호출하는 global function(ordered-json)이다. stub, build, package 이름이 서로 다르고, crudui는 phpize
  없이 compile하며, crudui와 hyper는 다른 저장소의 extension을 각자의 script로 build한다.

## 결정

1. plan은 folder `docs/plans/<plan>/`이고 `plan.md`, `checklist.md`와 그 한국어 짝 `plan.ko.md`, `checklist.ko.md`를
   가진다. folder 이름은 plan을 부르는 slug다. kit은 checklist를 `docs/plans/*/checklist.md`로 찾는다. plan은 원인,
   결정, 순서, exit criteria를 기술하고, checklist row는 task, 원인, acceptance를 기술한다. Red와 Green 결과는 row가
   아니라 CHANGELOG.md에 있다. item ID는 저장소의 모든 checklist에서 유일하고, sub-item의 부모(`K12`의 `K12-1`)는 같은
   checklist의 item이다. 근거: plan마다 checklist 하나는 checklist의 크기를 그 plan으로 제한하고, Markdown plan은 kit이
   다른 저장소에 의존하지 않고 검사를 kit 자신의 tool에 둔다.
2. checklist는 state 5개 `[ ]`, `[~]`, `[o]`, `[!]`, `[-]`를 가진 table이다. kit이 둘을 고정하고, 저장소는 ID
   prefix만 선언한다.
3. full suite는 CI에서만 돈다. 어떤 local command도 full suite를 돌리지 않고, kit이 vendor하는 Claude Code hook이
   suite 또는 selection 없는 runtime 전체를 돌리는 command를 거부한다.
4. test는 위치에 따라 unit, integration, conformance다. local에서는 unit test만 `make test-<runtime>
   CASES=<pattern>`으로 돌고, kit이 이것을 runner의 filter로 바꾼다.
5. 작업의 공통 규칙은 PRINCIPLES.md에 한 번 기술한다. AGENTS.md는 그 저장소의 규칙만 기술한다.
6. folder 표준 S5는 관심사마다 folder 하나, 소스 언어마다 runtime 이름 하나를 정하고, 관리 파일(AGENTS, CHANGELOG,
   Makefile, plans)은 저장소 root에만 둔다.
7. kit이 make target의 이름을 고정하고, 저장소는 recipe를 제공한다.
8. PHP extension은 PHP library의 class 이름을 등록하므로, 같은 PHPUnit 파일이 두 구현을 모두 test한다. kit tool
   하나가 phpize로 extension을 build하고 gen_stub.php로 arginfo를 생성한다.
9. 모든 규칙은 건너뛸 수 없는 지점에서 강제한다. make가 설치하는 Git hook, kit이 vendor하는 Claude Code hook, CI
   push-gate job이다. text로만 존재하는 규칙은 kit이 나열하는 결함이다. plan, item, commit은 그 check의 함수를
   호출하는 utility가 쓰므로, 올바른 출력은 utility가 쓰는 출력이다.

## 순서

checklist는 항목을 순서대로 나열한다. K240이 처음이다. 이후의 모든 항목이 그 아래에서 진행되기 때문이다. 다음은 K248과 K249다. 이후의 모든 항목이 그 형식으로 규칙을 쓰기 때문이다. K241은
나머지 항목에 자리를 준다. kit 항목이 끝나면 각 저장소가 자기 plan에서 표준을 적용한다.

## Exit criteria

checklist의 모든 항목이 `[o]` 또는 `[-]`이고, kit을 쓰는 각 저장소가 표준을 적용하는 plan을 가진다.
