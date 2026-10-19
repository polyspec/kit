<!-- doc-id: plan-common-standard -->
<!-- source-sha256: b6b5b938f32c307bddefce7777ec24054cc5489c3e9c939e5eb83581175fef56 -->
# 공통 표준

[English](plan.md)

## 목표

모든 polyspec 저장소는 folder, plan과 checklist, test, command에 하나의 표준을 따른다. 표준은 kit이 가진다.
PRINCIPLES.md가 각 규칙을 한 번 기술하고, kit tool이 그 규칙을 강제하며, 저장소는 저장소마다 실제로 다른 data
(`config/*.json`)와 자기 제품의 규칙(AGENTS.md)만 가진다.

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
