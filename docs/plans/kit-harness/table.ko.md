<!-- doc-id: table-kit-harness -->
<!-- source-sha256: dd9dc1fc8dd4e18eb45efb0b154937f9d37b022fecc37d011d359592059a2d78 -->
# kit 사실 표, 2026-10-30

범위: 현재 main 트리의 `kit/`, 읽기 전용. 코드 변경 없음, make 실행 없음. 경로는 kit과 소비자 저장소를 담은 polyspec 작업 공간 폴더 기준 상대 경로다.
소비자: T=template, H=hyper, OJ=ordered-json, O=orm, S=ssr, C=crudui, F=fsm, FM=flowmark. 소비자 목록은 `+=` 줄을 포함한 전체 CHECK_TARGETS 단어 목록이다(orm `+=`는 Makefile:3077, 3079; hyper `+=`는 Makefile:325).
"Kit target"은 `kit/Makefile` 또는 `kit/scripts/kit/kit.mk` 또는 `kit/scripts/kit/kit-bootstrap.mk`에 정의된 target을 뜻한다. 어느 kit 파일도 정의하지 않는 이름은 저장소 고유(repo-local)이므로 제외한다(주목할 점 참고).
(a) PRINCIPLES 열 = "Enforced by" 줄이 해당 target을 적은 규칙 ID다(`kit/PRINCIPLES.md:N` = 그 줄). AGENTS = `kit/AGENTS.md` 규칙의 시작 줄이며, target을 적은 줄은 괄호 안에 적었다.

## 표 1. Kit gate target

### 1a. Kit-gates 전제 조건 (`kit/scripts/kit/kit.mk:203`, target 22개)

| target | (a) PRINCIPLES | (a) AGENTS | (b) 검사가 판단하는 것 | (c) 버전, 고정값, 락 파일 내용 또는 패키지 설치 상태를 판단하는가? | 소비자의 CHECK_TARGETS |
|---|---|---|---|---|---|
| kit-check | 없음 | 규칙 :34 (L35, L37); 규칙 :45 (L59); 규칙 :80 (L85); 규칙 :130 (L131) | `config/*.json`을 kit 스키마로 검사(`kit-check.mts:102`); Composer 패키지 또는 toolchain의 `php`가 PHP를 필요로 하면 `.php-version`이 있어야 함(`kit-check.mts:85-86`); 도구를 bare name으로 시작하거나 테스트 러너를 안전하지 않게 실행하는 recipe(`kit-check.mts:19`, `:149`); kit.copies가 선언하지 않은 scripts/kit 파일(`kit-check.mts:130`). 복사본 내용은 비교하지 않음(`kit-check.mts:5-6`) | T H OJ O S C F FM |
| toolchain-check | S4 (`:198`) | 규칙 :69 (L73, L79); 규칙 :80 (L89, L92, L93) | 선언된 각 도구의 버전 명령을 checkout의 shim에서 실행; 도구가 없거나 시작할 수 없거나 출력을 파싱할 수 없으면 해결 방법과 함께 발견 사항으로 보고(`check-toolchain.mts:148-151`) | 예: 도구 설치 상태(`check-toolchain.mts:150-151`). 버전 출력은 파싱하지만(`:58`, `:64`) "비교하지 않음"(`:148`, `:203`). Git이 추적하는 uv 락 사이드카도 판단(`check-toolchain.mts` 헤더 `:9-12`) | T H OJ O S C F FM |
| layout-check | S5 (`:206`), S7 (`:218`), S9 (`:225`) | 없음 | checkout에서 `alint check --config config/layout.yml` 실행(`kit.mk:121-122`); target 설명은 Git-ignore(K372)와 no-tracked-generated(K426)도 언급(`kit.mk:120`)하지만 recipe는 이를 직접 실행하지 않음 | 아니오: recipe는 alint만 실행(`kit.mk:121-122`); 판단은 설정 파일에 있음 | T H OJ O S C F FM |
| docs-check | P1 (`:15`), P24 (`:121`), P25 (`:126`), P26 (`:129`) | 규칙 :21 (L24) | `check-documents.mts`: 앵커, 펜스, 상대 링크, 개인 홈 경로, 코드 밖 `{{`, 체크리스트 유효성과 kit 항목 ID(`check-documents.mts:1-14`); DOCS_CHECKS도 실행(`kit.mk:289-290`) | 아니오(앵커, 링크, 체크리스트; 패키지나 버전 데이터 없음) | T H OJ O S C F FM |
| rules-check | P3 (`:22`) | 없음 | PRINCIPLES와 AGENTS의 모든 규칙이 CI, Git 훅 또는 Claude 훅이 도달하는 Enforced-by 검사를 가지는지 확인(`check-rules.mts:1-12`) | 아니오 | T H OJ O S C F FM |
| owner-validate | 없음 | 없음 | `config/owner-checks.json`이 추적되는 모든 경로를 소유하고, 이름이 적힌 각 target이 존재하며 전체 스위트를 실행하지 않는지 확인(`owner-check.mts:1-20`, `kit.mk:332-333`) | 아니오 | T H OJ O S C F FM |
| rebuild-check | P14 (`:66`), P34 (`:162`), S1 (`:186`), S8 (`:221`) | 규칙 :40 (L44) | 각 도구 소스가 `config/rebuild.json`에서 ecosystem / replaced / record / policy로 분류되는지 확인(`rebuild-check.mts:1-14`) | 아니오 | T H OJ O S C F FM |
| language-check | P11 (`:55`) | 없음 | 코드의 주석, 식별자, 오류·로그 메시지, 테스트 이름에 한글이 있는지 확인(`language-check.mts:1-6`) | 아니오 | T H OJ O S C F FM |
| test-markers-check | P6 (`:35`), P32 (`:156`) | 없음 | 테스트의 skip/only 표시: `test.skip`, `it.only`, `t.Skip`, `unittest.skip`, `#[ignore]`(`test-markers.mts:1-6`) | 아니오 | T H OJ O S C F FM |
| duplication-check | P15 (`:68`), P34 (`:162`) | 규칙 :60 (L61, L62) | jscpd: `config/duplication.json` 폴더 밖에서 중복된 6줄 이상 검출(`duplication-check.mts:1-5`) | 아니오 | T H OJ O S C F FM |
| parity-declarations-check | P32 (`:156`), P33 (`:159`), S3 (`:196`), S6 (`:215`), S7 (`:218`) | 규칙 :94 (L95, L97) | 바인딩이나 추출기를 실행하지 않고 `config/parity.json` 선언만 확인(`parity.mts:9-11`, `kit.mk:549-550`) | 아니오 | T H OJ O S C F FM |
| parity-check | P32 (`:156`), S6 (`:215`) | 규칙 :94 (L95) | 모든 parity 바인딩과 모든 규칙(`parity.mts:9-14`, `kit.mk:516-517`) | 예: 설치된 Python 배포판의 RECORD를 읽는 심볼 추출기를 실행(`parity-symbols.mts:4`, `:75`); TS 러너는 설치된 vitest가 필요(`parity-runners.mts:270`); PHP 러너는 설치된 phpunit이 필요(`parity-runners.mts:305`) | H OJ O S C F FM (T 제외) |
| bypass-check | P31 (`:150`) | 없음 | CI identity를 설정하거나, kit-gates target을 `make -o`로 실행하거나, `--no-verify`를 쓰는 테스트/스크립트/Makefile(`bypass-check.mts:1-10`) | 아니오 | T H OJ O S C F FM |
| suppression-check | P8 (`:41`) | 없음 | 각 도구 형식에서 이유 없는 린트 억제(`suppression-check.mts:1-12`) | 아니오 | T H OJ O S C F FM |
| divergence-check | P32 (`:156`) | 없음 | 런타임/플랫폼에 따라 갈라지는 구현 분기, 범위를 좁힌 실행, 부분 기능, 이유 없는 예외(`divergence-check.mts:1-12`) | 아니오. PHP_VERSION과 process.versions는 버전 고정이 아니라 분기 조건으로 나타남(`divergence-check.mts:34`) | T H OJ O S C F FM |
| lint-ts | P8 (`:41`), P13 (`:64`) | 없음 (규칙 :25가 본문에 이름을 적음, L29) | checkout에서 oxlint type-aware, knip, API Extractor 실행(`lint-ts.mts:1-12`) | 예: 설치 상태. package-lock.json과 설치된 kit 패키지가 필요(`lint-ts.mts:130`, `:151`, `:156`). 락 내용은 비교하지 않음 | T H OJ O S C F FM |
| lint-php | P8 (`:41`), S2 (`:190`) | 없음 | phpcs PSR-12, PHPStan S2 규칙, autoload 파일 내용(`lint-php.mts:1-18`) | 예: 설치 상태. php-parser autoloader가 없으면 실패(`lint-php.mts:44-47`); PHPStan은 각 패키지의 Composer autoloader가 필요(`lint-php.mts` 헤더 `:9-14`) | T H OJ O C F FM (S 제외) |
| lint-python | P8 (`:41`), P13 (`:64`) | 없음 | 루트에서 `ruff check`와 `ruff format --check`; 패키지별 vulture(`lint-python.mts:1-14`) | 예: 도구 설치 상태. mise.toml에서 설치한 ruff와 vulture가 없으면 예외 발생(`lint-python.mts:25`) | T H OJ O C F (S, FM 제외) |
| lint-go | P8 (`:41`), P13 (`:64`) | 없음 | kit 설정의 golangci-lint를 빌드 태그별로 실행하고 deadcode 실행(`lint-go.mts:1-12`) | 예, go.mod 내용: kit 설정은 `replace`와 `toolchain` 줄을 금지(`lint-go.mts:5`). 락 검사 없음 | T OJ O C F FM (H, S 제외) |
| lint-rust | P8 (`:41`) | 없음 | 워크스페이스마다 `cargo clippy --workspace --all-targets --locked -D warnings`(`lint-rust.mts:2`, `:47`) | 아니오: cargo 자체의 --locked 플래그를 넘긴다. kit은 lock을 읽지 않는다 | T OJ O S C F (H, FM 제외) |
| lint-php-ext | S10 (`:241`) | 없음 | 이름, 유일한 stub, arginfo 헤더의 stub 해시(`php-extension.mts:115-119`) | 아니오. stub 해시는 내용의 sha1(`php-extension.mts:46`); 버전이나 락은 판단하지 않음 | T OJ O C F (H, S, FM 제외) |
| test-php-ext | S10 (`:241`) | 없음 | 빌드된 확장과 PHP 라이브러리의 Reflection 비교 후, 확장을 로드한 PHPUnit 실행(`php-extension.mts:10-13`, `kit.mk:177-178`) | 아니오. 먼저 빌드된 확장이 필요(`kit.mk:177`) | T OJ O C F (H, S, FM 제외) |

### 1b. 소비자 CHECK_TARGETS에 있으나 kit-gates가 실행하지 않는 kit target (target 13개)

| target | (a) PRINCIPLES | (a) AGENTS | (b) 검사가 판단하는 것 | (c) 버전, 고정값, 락 파일 내용 또는 패키지 설치 상태를 판단하는가? | 소비자의 CHECK_TARGETS |
|---|---|---|---|---|---|
| cargo-downloads-check | 없음 | 없음 | 각 Cargo.lock에 대해 `cargo fetch --locked --offline` 실행; CARGO_HOME에 크레이트가 없으면 실패(`check-cargo-downloads.mts:1-8`, `:27-28`; `kit.mk:84-85`) | 예: 락 내용(`--locked`)과 패키지 설치 상태(레지스트리의 크레이트) | OJ |
| hooks-check | 없음 (P34가 `:162`에서 `.githooks/pre-commit`을 이름으로 적음, target 이름은 아님) | 없음 | core.hooksPath는 `.githooks`; `config/checklist.json`의 훅이 설치되고 실행 가능하며 변경되지 않았는지 확인(`git-hooks.mts:1-12`; `kit.mk:143-144`) | 패키지에 대해서는 아니오. Git 훅 파일을 확인하며 패키지는 확인하지 않음 | T H OJ S F |
| link-check | 없음 | 없음 | 제공자가 주는 설치된 패키지 폴더 중 다른 곳의 복사본이거나 링크인 것을 나열; 0.0.x가 아닌 pin의 Go require는 보고(`link.mts:362`; `kit.mk:436-437`) | 예: 설치 상태(폴더가 링크인지); 버전은 Go require에 대해서만 판단(`link.mts:137`, `:362`); uv 락의 잠긴 릴리스를 읽음(`link.mts:246-253`) | C |
| link-state-check | PRINCIPLES Enforced-by에는 없음. 본문에서만 언급: P30 (`:147`), S11 (`:245`) | 없음 | 설치된 polyspec 폴더가 복사본이 아니라 링크인지; 추적되는 락이 제공 패키지를 path나 link로 기록하지 않는지(`link-state-check.mts:154-169`); workspace/go.work 상태 | 예: 락 내용(`link-state-check.mts:154-169`)과 설치 상태(`link-state-check.mts:1-14`). 헤더 `:4`는 버전을 비교하지 않는다고 함; 헤더 `:6-7`은 npm/Composer 0.0.x pin을 판단한다고 하지만 파일에는 0.0.x 검사가 없음 | T H OJ O S C F FM |
| parity-api-check | 없음 | 없음 | 공개 심볼 추출기와 정적 parity 규칙, 네이티브 바인딩 없음(`parity.mts:13`; `kit.mk:541-542`) | 예: 심볼 추출기를 실행하며, Python 추출기는 설치된 RECORD를 읽음(`parity-symbols.mts:4`, `:75`) | T |
| release-coverage | 없음 | 없음 | 체크아웃의 모든 패키지 파일이 `config/release.json`에 분류되었는지 확인(`release.mts:629-650`; `kit.mk:400-401`) | 아니오 | OJ O |
| test-go | 없음 | 없음 | 이름 필터와 함께 `go test -run`으로 각 Go 패키지의 단위 테스트 실행(`runtime-targets.mts:109`) | 아니오. 도구가 없으면 실행 자체가 실패 | T OJ FM |
| test-infrastructure | 없음 | 없음 | 플랫폼별로 추적되는 루트 Node 인프라 테스트 전부(`runtime-targets.mts:180-185`, `:307`; `kit.mk:190-191`) | 아니오 | FM |
| test-js | 없음 | 없음 | node --test 또는 vitest로 JS 패키지의 단위 테스트 실행(`runtime-targets.mts:107`) | 아니오 | OJ |
| test-php | 없음 | 없음 | phpunit으로 PHP 패키지의 단위 테스트 실행(`runtime-targets.mts:113`) | 아니오 | T OJ |
| test-python | 없음 | 없음 | unittest로 Python 패키지의 단위 테스트 실행; 각 테스트 폴더는 패키지여야 함(`runtime-targets.mts:66-77`) | 아니오 | T OJ |
| test-rust | 없음 | 없음 | cargo test로 Rust 패키지의 단위 테스트 실행(`runtime-targets.mts:111`) | 아니오 | T OJ |
| test-ts | 없음 | 없음 | node --test 또는 vitest로 TS 패키지의 단위 테스트 실행(`runtime-targets.mts:107`) | 아니오 | T |

### 1c. 생성되는 parity binding target (`kit/scripts/kit/kit.mk:533`, `:539-547`; 이름은 `parity.mts --make-targets`에서 가져옴)

| target | (a) PRINCIPLES | (a) AGENTS | (b) 검사가 판단하는 것 | (c) 버전, 고정값, 락 파일 내용 또는 패키지 설치 상태를 판단하는가? | 소비자의 CHECK_TARGETS |
|---|---|---|---|---|---|
| parity-bindings-go-check | 없음 | 없음 | Go 구현의 네이티브 바인딩 실행(`parity.mts:14`) | 확인 안 함: Go 러너에서 grep으로 설치 상태 발견 사항을 찾지 못함 | T |
| parity-bindings-php-check | 없음 | 없음 | PHP 구현의 네이티브 바인딩 실행(`parity.mts:14`) | 예: 설치 상태, phpunit이 있어야 함(`parity-runners.mts:305`) | T |
| parity-bindings-php-ext-check | 없음 | 없음 | PHP 확장 구현의 네이티브 바인딩 실행(`parity.mts:14`) | PHP 바인딩처럼 PHPUnit을 실행하면 예(`parity-runners.mts:305`); 별도로 검증하지 않음 | T |
| parity-bindings-python-check | 없음 | 없음 | Python 구현의 네이티브 바인딩 실행(`parity.mts:14`) | 확인 안 함: Python 러너에서 grep으로 설치 상태 발견 사항을 찾지 못함 | T |
| parity-bindings-rust-check | 없음 | 없음 | Rust 구현의 네이티브 바인딩 실행(`parity.mts:14`) | 확인 안 함: Rust 러너에서 grep으로 설치 상태 발견 사항을 찾지 못함 | T |
| parity-bindings-ts-check | 없음 | 없음 | TS 구현의 네이티브 바인딩 실행(`parity.mts:14`) | 예: 설치 상태, vitest가 있어야 함(`parity-runners.mts:270`) | T |

표 1 메모:
- `typecheck`는 T, H, OJ의 CHECK_TARGETS에 있지만 kit.mk의 target이 아니다. 정의는 `kit/Makefile:132`(kit 자체 저장소)뿐이다. 소비자에서는 저장소 고유이므로 제외한다.
- kit 어디에도 정의되지 않은 소비자 목록 이름(저장소 고유): 예를 들어 `link-metadata-check`, `verify-all`, `release-config-check`, `pie-check`, `evidence-check`(OJ `Makefile:109-128`), `docs-static-check`, `virtiofs-check`(H `Makefile:323`), 그리고 O의 모든 `*-helper-check`, `feature-*`, `dbspec-*` 이름.

## 표 2. PRINCIPLES.md 규칙

적용 대상은 규칙 본문에서 가져왔다. "모든 저장소"는 규칙에 런타임, 기능, 저장소 유형 한정이 없다는 뜻이다.

| 규칙 | 요지 | Enforced by (`kit/PRINCIPLES.md`) | 적용 대상 |
|---|---|---|---|
| P1 | 코드, 테스트, 문서, AGENTS, 메모리에 대한 책임 | `make docs-check` (:15) | 모든 저장소 |
| P2 | 규칙은 옳기 때문에 따른다; 이상한 점은 보고 | 없음 (:19) | 모든 저장소 |
| P3 | 규칙이 먼저; 규칙 없는 동작은 결함 | `make rules-check` (:22) | 모든 저장소 |
| P4 | 확정된 판단은 명세에 기록 | 없음 (:25) | 모든 저장소 |
| P5 | 잘못된 변경은 피해와 정확성으로 판단 | 없음; commit-msg 훅 언급 (:29) | 모든 저장소 |
| P6 | 기준은 통과를 위해 낮추지 않는다 | `make test-markers-check` (:35) | 모든 저장소 |
| P7 | 속임수 금지 | `.claude/settings.json` (:38) | 모든 저장소 |
| P8 | 오류를 숨기지 않는다; 조용한 대체(fallback) 금지 | `make lint-ts`, `lint-python`, `lint-go`, `lint-php`, `lint-rust`, `suppression-check` (:41) | 모든 저장소 |
| P9 | 정확성이 먼저; 빠름은 정확할 때만 | 없음 (:43) | 모든 저장소 |
| P10 | 작업은 자체 worktree와 `make land`를 거쳐 main에 반영 | 없음 (:52) | 모든 저장소 |
| P11 | 코드, 식별자, 로그, 메시지, 테스트 이름, 커밋은 영어; 문서는 두 언어 | 코드는 `make language-check` (:55) | 모든 저장소 |
| P12 | 릴리스가 명시하기 전까지 하위 호환성을 두지 않는다 | 없음 (:61) | 모든 저장소 |
| P13 | 가장 단순한 구현; 추측성 추상화 금지 | `make lint-ts`, `lint-python`, `lint-go` (:64) | 모든 저장소 |
| P14 | 외부 생태계 도구를 쓰고 다시 만들지 않는다 | `make rebuild-check` (:66) | 모든 저장소 |
| P15 | 구성 요소는 모듈화하고 관심사는 분리 | `make duplication-check` (:68) | 모든 저장소 |
| P16 | 장기 아키텍처; 임시방편 금지 | 없음 (:71) | 모든 저장소 |
| P17 | 멱등 적용; 이벤트로 공개되는 변경; 선언적 경로; 다중 플랫폼 | `.claude/settings.json` (:74) | 모든 저장소 |
| P18 | 폴링 루프 금지 | `.claude/settings.json` (:78) | 모든 저장소 |
| P19 | 결함은 실패하는 테스트로 시작; 낡은 텍스트는 `text-absent`로 검사 | `.githooks/commit-msg` (Red 줄) (:86) | 모든 저장소 |
| P20 | 항목은 자체 단위 테스트로 완료; 전체 스위트는 conductor만 실행 | `.claude/settings.json` (:90) | 모든 저장소 |
| P21 | 어려운 판단은 적대적으로 검증 | 없음 (:95) | 모든 저장소 |
| P22 | 에이전트 인계는 전체 맥락을 싣는다; 서브에이전트는 Haiku 5.5 | 없음 (:102) | 에이전트에게 작업을 넘기는 모든 저장소 |
| P23 | 질문은 필요할 때만 | 없음 (:109) | 모든 저장소 |
| P24 | plan.md와 checklist.md가 있는 계획 폴더 | `make docs-check` (:121) | 계획을 두는 모든 저장소(저장소 수준, 런타임 아님) |
| P25 | 항목 상태와 허용되는 전이 | `make docs-check` (:126) | 체크리스트가 있는 모든 저장소 |
| P26 | 열린 항목은 자체 단위 테스트 명령을 명시; 스위트 없음 | `make docs-check`, `.claude/settings.json` (:129) | 체크리스트가 있는 모든 저장소 |
| P27 | 커밋당 항목 하나 | 없음; commit-msg 훅은 안내 규칙 (:132) | 모든 저장소 |
| P28 | 커밋 메시지 형식; AI 꼬리말 없음; 사람 작성자 | 꼬리말과 작성자 정체성용 `.githooks/commit-msg` (:137) | 모든 저장소 |
| P29 | 작업과 런타임별로 고정된 make target 이름 | 없음; 이름은 저장소 고유 (K810) (:141) | 런타임 패키지가 있는 저장소(본문: "for each runtime of packages/") |
| P30 | 0.0.x: 애플리케이션은 네이티브 링크로 provider 소스를 연결; 위장된 버전 금지 | 없음; 본문에 `make link-state-check` 언급 (:147) | 0.0.x 개발 중 polyspec provider를 쓰는 애플리케이션 |
| P31 | 어떤 gate도 우회하지 않는다 (CI identity, `make -o`, `--no-verify`) | `make bypass-check` (:150) | 모든 저장소 |
| P32 | 공유 계약 동작은 모든 구현에 있어야 함; 범위 규칙 | `make parity-declarations-check`, `parity-check`, `divergence-check`, `test-markers-check` (:156) | 하나의 계약에 여러 구현이 있는 저장소(AGENTS.md:94-95가 config/parity.json을 지정) |
| P33 | 작업에 필요한 규칙은 docs/spec에 먼저 쓴다 | `make parity-declarations-check` (:159) | docs/spec 요구사항이 있는 저장소 |
| P34 | 반복 코드는 재구성; 생성된 산출물은 추적하지 않음 | `make duplication-check`, `make rebuild-check`, `.githooks/pre-commit` (:162) | 모든 저장소 |
| P35 | 로컬 소스 개발은 provider 릴리스를 기다리지 않는다 | 없음 (:166) | provider 패키지를 쓰는 저장소 |
| P36 | 발견한 결함은 등록하고 즉시 처리 | 없음 (:168) | 모든 저장소 |
| P37 | 결과는 검사가 실행된 뒤에만 보고 | 없음 (:171) | 모든 저장소 |
| P38 | checkout마다 한 행위자만 main에 직접 쓴다; 브랜치는 `make land`로 main에 반영 | 없음 (:174) | 모든 저장소 |
| S1 | 생태계 도구를 다시 빌드하지 않는다; 재빌드 기록 | `make rebuild-check` (:186) | 모든 저장소 |
| S2 | PHP: 파일당 클래스 하나, PSR-4, classmap 없음, PHPUnit | `make lint-php` (:190) | PHP 저장소만(본문이 PHP 전용) |
| S3 | 테스트는 표준 러너에서만; 설치된 패키지 사용, 자체 harness 없음 | `make parity-declarations-check` (:196) | 테스트가 있는 모든 저장소(러너 목록은 kit이 고정) |
| S4 | 버전: kit은 버전이나 고정값을 강제하지 않는다 | `make toolchain-check` (:198) | 모든 저장소 |
| S5 | 모든 monorepo의 루트 폴더는 같아야 함 | `make layout-check` (:206) | 모든 monorepo |
| S6 | 언어 간 동등성: 모든 구현에 같은 단위와 벡터 | `make parity-declarations-check`, `make parity-check` (:215) | 여러 구현이 있는 저장소 |
| S7 | 테스트 위치: 기본 기능 테스트는 소유 패키지와 함께 둔다 | `make layout-check`, `make parity-declarations-check` (:218) | 패키지 또는 테스트가 있는 모든 저장소 |
| S8 | 모든 예외, 프로필, 재빌드 기록에는 사유가 있어야 함 | `make rebuild-check` (:221) | 예외가 있는 모든 저장소 |
| S9 | 언어 간 오케스트레이션과 kit은 TypeScript로 작성하고 tsc로 검사 | `make layout-check` (:225) | 언어 간 오케스트레이션이나 검사가 있는 저장소(kit 포함) |
| S10 | PHP 확장은 저장소의 모든 PHP 라이브러리를 같은 이름과 시그니처로 구현 | `make lint-php-ext`, `make test-php-ext` (:241) | PHP 라이브러리와 packages/php-ext가 있는 저장소 |
| S11 | 개발 중에는 로컬 링크; 패키지 관리자 링크 단계 없음 | 없음; 본문에 `make link-state-check` 언급 (:245) | polyspec 패키지를 링크하는 개발 중 저장소 |

## 주목할 점

1. 버전이나 고정값에 대한 kit의 판단(근거 포함): `toolchain-check`는 버전을 파싱하지만 비교하지 않는다(`check-toolchain.mts:148`, `:203`). `lint-go`는 go.mod의 `replace`와 `toolchain` 줄을 금지한다(`lint-go.mts:5`). `link`는 0.0.x pin 규칙을 Go require에만 적용한다(`link.mts:137`, `:362`). `kit-check`는 `.php-version`이 있어야 함을 요구한다(`kit-check.mts:85-86`).
2. kit의 락 내용 판단: `cargo-downloads-check`는 `--locked`를 쓴다(`lint-rust.mts:2`, `:47`; `check-cargo-downloads.mts:1-8`). `link-state-check`는 링크나 path를 기록하는 락 항목을 판단한다(`link-state-check.mts:154-169`). `link`는 uv 락을 읽는다(`link.mts:246-253`).
3. `link-state-check` 헤더와 코드가 충돌한다. 헤더 `:4`는 버전을 비교하지 않는다고 하고, 헤더 `:6-7`은 npm과 Composer 0.0.x pin을 판단한다고 하지만, 파일에는 0.0.x 검사가 없어 npm/Composer pin 주장은 코드에 없다.
4. `layout-check` 설명(`kit.mk:120`)은 Git-ignore(K372)와 no-tracked-generated(K426) 검사를 언급한다. recipe는 `alint check --config config/layout.yml`만 실행한다(`kit.mk:121-122`).
5. `kit-check` 헤더는 복사본 일치 여부가 npm과 kit-sync의 일이며 검사가 아니라고 한다(`kit-check.mts:5-6`). `kit-check`는 kit.copies가 선언하지 않은 scripts/kit의 파일만 찾고(`kit-check.mts:130`), 복사본 내용은 비교하지 않는다.
6. PRINCIPLES Enforced-by에 이름이 나오지 않는 target (없음): kit-check, owner-validate, release-coverage, link-check, link-state-check(본문만), hooks-check, cargo-downloads-check, parity-api-check, 모든 test-* 및 parity-bindings-*. PRINCIPLES Enforced-by 줄은 kit 밖 항목(`.claude/settings.json`, `.githooks/commit-msg`, `.githooks/pre-commit`)도 이름으로 적는다.
7. 본문 기준 저장소 한정 PRINCIPLES 규칙: S2(PHP), S10(php-ext), S6과 P32(여러 구현), S11과 P30과 P35(0.0.x 개발과 provider 소비자), S5(monorepo), S9(언어 간 오케스트레이션).
8. 하나 이상의 소비자에 없는 kit-gates 전제 조건: `parity-check`는 T에 없다. `lint-python`은 S와 FM에 없다. `lint-go`는 H와 S에 없다. `lint-rust`는 H와 FM에 없다. `lint-php`는 S에 없다. `lint-php-ext`와 `test-php-ext`는 H, S, FM에 없다.
9. 소비자가 실행하지만 kit-gates는 실행하지 않는 kit 전용 target(표 1b): cargo-downloads-check, hooks-check, link-check, link-state-check, parity-api-check, release-coverage, test-go, test-infrastructure, test-js, test-php, test-python, test-rust, test-ts. 그리고 생성되는 parity-bindings-*-check 여섯 개(T만).
