<!-- doc-id: plan-common-standard -->
<!-- source-sha256: 3c074cceccf0e106903e80da64ab10c90bb7f884f5650ac2ebba06f93a4b4a73 -->
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

## Checklist 정합성 검토 (K679, 2026-10-26)

이 감사는 K675 이전 세 plan checklist에 있던 미완료·폐기 항목 31개 전체를 다룹니다. Code와 이력 검토이며 새 검사 통과 증거가 아닙니다. 기존 task 문장이 남아 있다는 이유만으로 재개하지 않습니다. 아래 현재 판정이 우선이며 과거 ID와 task 문구는 보존하고 대체 요구는 별도 등록 ID로 관리합니다.

등록 이력도 구분합니다. K655, K657, K664는 구현 전 plan commit으로 등록되었습니다. K671은 최초 sync 구현과 같은 commit에서 처음 등장했으므로 선등록 절차를 지키지 않았습니다. 현재 ID가 있다는 사실을 사전 계획의 증거로 사용하지 않습니다. K675는 최초 인계를, K679는 더 넓은 기존 항목 정합성 검토를 별도로 기록합니다.

| 기존 항목 | 현재 판정 | 확인한 code 또는 증거 |
|---|---|---|
| K395 | 과거 제외 유지. Native 재연결은 유지하며 provider 재작성으로 재개하지 않는다. | `npm-install.mts npmInstall/npmLink; K673/K674` |
| K399-2 | 기존 Go workspace 진단으로 대체됨. 중복 구현하지 않는다. | `link-state-check.mts goFindings; link-state-check.test.mts` |
| K410-1 | 현재 배포되는 owner 선언으로 대체됨. | `package.json kit.owners; owner-check.mts ownerDeclaration; kit-sync.test.mts K410-1` |
| K437 | 후속 검사가 정체 case와 parent 종료를 다루지만 원래 process 원인 증거는 미확인이다. | `run-tests.test.mts K437/K437-1; test-exit-deadline.mts` |
| K438 | 통합 선행 조건을 폐기하고 K655/K677의 독립 candidate 승인을 따른다. | `P35; local-links Decision; release procedure` |
| K443 | K631 진단 정책으로 대체됨. 새 land 차단기로 복구하지 않는다. | `land.mts mainRun; land.test.mts K631-1` |
| K444 | K452-1 load 사전 검사로 대체됨. 문자 그대로 extension_loaded 검증을 했다고 주장하지 않는다. | `run-tests.mts probeExtensions; run-tests.test.mts K452-1` |
| K445 | 과거 범위 제외 유지. 이번 작업이 generated file filtering을 입증하지는 않는다. | `lint-python.mts lintSteps still selects tracked Python sources` |
| K456 | 부분 구현됨. 남은 명령·결과·경과시간 출력은 K685가 추적한다. | `check-documents.mts; land.mts runGate; test-hooks.mts` |
| K461 | 과거 build deadline 요구를 대체한다. 남은 전체 build timeout은 K682가 추적한다. | `AGENTS operation rule; run-tests.mts BUILD_MS/buildWatch; test-build-first.test.mts` |
| K466 | 감사 제거라는 과거 사유는 낡았다. 실제 nested copy 귀속 결함은 K680이 추적한다. | `dependency-review.mts npm advisory collection ignores audit nodes` |
| K467 | 옛 recipe를 복구하지 않는다. Online review의 offline 환경 처리는 K684에서 검증한다. | `dependency-review.mts query/advisories; offline gate reads committed review` |
| K470 | 대체됨. Stale sprintf-js 예외가 제거되었으므로 복구하지 않는다. | `K660; dependency-policy.json advisoryExceptions; current review` |
| K471 | 대체됨. Native npm이 override를 소유하며 copy별 advisory 범위는 K680이다. | `dependency policy advisoryExceptions and native npm overrides` |
| K472 | 제외 유지. Kit이 최신 version이나 sibling version 일치를 강제하지 않는다. | `K660 newer-only test; dependency-review CLI result policy` |
| K475 | Lock 합성으로 재개하지 않는다. 현재 남은 legacy review/update metadata 보정은 K681이 추적한다. | `dependency-review.mts providerEntries/composerEntries/runUpdateSteps` |
| K479-1 | 대체됨. Kit이 만드는 composer.link manifest 모델은 폐기되었다. | `composer-install.mts selected COMPOSER; native Composer K664-2` |
| K480-1 | K683에서 native dependency 검증 범위를 재정의한다. 언어 공통 resolver를 만들지 않는다. | `composer-install.mts native update; uv-install.mts pip check; npm peer limits` |
| K483 | 의도를 분리한다. NO_DEV는 구현되어 있으며 checkout 없는 release 설치 거부는 복구하지 않는다. | `composer-install.mts native fallback; link.test.mts NO_DEV; K683` |
| K573 | Cache 제외는 유지한다. Main 비교가 사라졌다는 옛 사유는 낡았다. | `land.mts mainRun; K603/K631/K580` |
| K589 | 제외 유지. 합성 link metadata 복사로 앱의 stale lock을 가리지 않는다. | `worktree-setup.mts native vendor/autoload; selected manifests remain app-owned` |
| K597 | 제외 유지. K561을 유지하며 bindingless catch 진단을 제거하지 않는다. | `catch-check.mts bindinglessCatches; catch-check.test.mts K561` |
| K618 | 과거 오진 제외 유지. 각 PHP generator가 선언하는 parser를 선택한다. | `install-php-arginfo.mts; PHP tests K637/K652/K670-1` |
| K649 | K654/K658의 guarded FINAL_RUN=1 API로 대체됨. API 존재가 금지된 로컬 suite를 허가하지는 않는다. | `ci-only.mts; ci-only.test.mts K654/K658; repository check rules` |
| K655 | 미완료 유지. 실패한 CI는 release 승인이 아니며 K686이 실패 수집과 수정을 추적한다. | `CI 40313948359; release-verify; public consumer proof` |
| K76-1 | 제외 유지. 필수 PR이나 CODEOWNERS 승인 gate를 도입하지 않는다. | `P10/P38; S8; remote protection settings were not inspected` |
| K111 | Dependency-cruiser 수단은 제외 유지. Native import graph 기반 owner 선택은 이미 있다. | `owner-check.mts importGraph; owner-check.test.mts K191` |
| K119 | 원래 오진은 제외 유지. 정상 cleanup은 존재하며 예외 경로의 cleanup은 미확인이다. | `release-sandbox.mts cleanup after tar; no finally proof in this audit` |
| K55 | 현재 package exports와 K71-2/K671로 대체됨. Kit.json과 과거 API path를 복구하지 않는다. | `release.json; package.test.mts; installed-hook-real.test.mts` |
| K56 | 제외 유지. Native uv가 Python environment를 소유하며 별도 installer prefix/home API를 만들지 않는다. | `python-venv.mts makeVenv` |
| K57 | 제외 유지. Native local wheel proof가 있으며 consumer 전용 archive mapping API를 추가하지 않는다. | `release-consumer.mts installWheelFiles; wheel-dependencies.mts lockRequirements` |

### 남은 구현과 실행 순서

우선 K686으로 현재 CI를 끝까지 수집하고 모든 실패 owner를 확인해 release candidate를 수정합니다. K655는 해당 candidate의 CI 통과와 consumer proof를 거친 공개까지 미완료입니다. 후속 version 작업은 K677이며 공개 전 실패한 candidate는 현재 version에서 수정할 수 있습니다.

K681은 실제 남은 소유권 결함입니다. Native 설치 경로를 전환했지만 dependency-review에는 providerEntries, scratch Composer manifest, version override가 남아 있습니다. 모든 Composer metadata 합성 경로를 제거했다고 주장하지 않습니다. K680도 실제 advisory 귀속 결함을 추적합니다. Native npm audit를 사용하지만 취약한 nested copy에 top-level version을 붙일 수 있습니다. 이것이 해당 advisory를 gate가 허용한다는 증거는 아닙니다.

K682는 남은 전체 build timeout을 다룹니다. K683은 npm source 전용 명령의 checkout 누락 거부와 peer 검증 한계를 포함해 native source/release 검증 범위를 정합니다. K684는 offline 환경 review 위험부터 재현하며 아직 false-green이 입증된 것은 아닙니다. K685는 부분적인 operation 진행 출력의 나머지를 다룹니다. 이 항목들은 등록된 요구이며 완료된 수정이나 폐기된 메커니즘을 복원할 근거가 아닙니다.

P30과 P35를 native source 설치, 앱 소유 제약, 독립 release lock과 정합되게 맞춥니다. Source를 설치된 release version으로 위장하지 않으며 kit은 개발 metadata를 합성하지 않습니다. 현재 이 경계를 위반하는 code는 K681이 추적합니다. 승인된 후속 규칙은 과거 완료·폐기 ID의 뜻을 조용히 바꾸는 대신 오래된 지시를 명시적으로 대체합니다.

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
