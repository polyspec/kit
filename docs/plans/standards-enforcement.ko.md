<!-- doc-id: standards-enforcement -->
<!-- source-sha256: eadd0bfbfcf2c8dcb79646ead9c5607ab89ed4cce69fe60f9d42e132456a274f -->
# Standards enforcement 계획

[English](standards-enforcement.md)

## 상태와 범위

소유자가 2026-10-13에 이 계획을 승인했고, 아직 착수하지 않았다.

개정 2는 두 번의 적대 검증(사실 검증, 설계 검증) 뒤에 다시 쓴 판이다. 두 검증은 scratch 디렉터리에서만 돌았고 어느
레포도 바꾸지 않았다. 검증 때문에 바뀐 내용은 "검증에 따른 정정"에 모아 두었다.

대상 레포는 crudui, fsm, hyper, kit, ordered-json, orm, template, template-benchmark, ssr이다. template_2026은 대상이
아니다.

아래 사실은 2026-10-13 각 레포의 HEAD에서 측정했다. 개수에는 모집단을 함께 적었다.

## Context

orm-php는 PSR-4로 충분한 class loading을 직접 만들었다.
- `packages/orm-php/src`의 파일 11개에 추가 class가 26개 있다. 이 수는 "파일에서 첫 선언 다음의 선언"으로 세든 "파일
  이름과 다른 이름의 선언"으로 세든 같다. `Planner.php` 하나에만 8개다.
- `composer.json:22-29`가 `src/`를 `psr-4`와 `classmap` 양쪽으로 map한다.
- `tests/autoload.php:7-44`가 항목 26개짜리 map을 둔다.
- 파일 14개가 `spl_autoload_register`를 15번 호출한다.

점검에서 찾은 원인은 세 가지다.

1. **기준이 문서에만 있고, 도구로 강제되지 않는다.**
   - PSR 규칙, 금지 API, 폴더 구조, test 위치, 버전을 검사하는 것이 없다.
   - kit의 parity checker(`scripts/kit/parity.mjs`)는 fsm에만 연결돼 있다(`fsm/Makefile:16`).
   - orm은 `config/parity.json`을 선언만 하고 실행하지 않는다.
   - ordered-json과 template은 checker를 vendor했지만 연결하지 않았다.
   - 같은 개념을 레포마다 다시 만들었다.
     - orm, template: `contracts/features.json`
     - template: `tests/runner/parity.mjs`
     - ordered-json: `implementations.json`, `package-tests.json`
     - crudui: evidence 파일
     - ssr: `features.json`
2. **우리 규칙이 재발명을 낳았다.**
   - kit 규칙 "도구는 Node built-in만 import한다"(`kit/AGENTS.md:17`) 때문에 JSON Schema validator, TOML reader, PEP 508
     requirement parser, version 비교, commit linter를 직접 구현했다. `pylock.mjs`는 이 규칙을 이유로 든다.
   - symlink 금지 규칙 때문에 hyper와 template이 npm workspaces를 쓰지 못한다. 두 레포의 `.npmrc`가 `bin-links=false`를
     설정하므로 우회 스크립트 `hyper/scripts/tsc.mjs`가 필요하고, `npx tsc`는 실패한다.
   - "외부 도구가 하는 일을 다시 만들지 않는다" 규칙이 orm, template, ssr의 AGENTS.md에 없다.
3. **언어마다 구현과 test의 깊이가 다르다.** 지금은 grep으로 읽는 사람만 이를 볼 수 있고, 도구는 보지 못한다.

그래서 이 계획은 다음 순서로 진행한다.
1. 기준을 세운다.
2. 기준마다 도구를 둔다. 생태계 표준 도구가 있으면 그것을 쓴다. kit 도구로 남기는 것은 그 일을 하는 생태계 도구가
   없음을 rebuild 기록으로 문서화해야 한다.
3. HEAD에 도구를 돌려 red 결과를 기록한다.
4. green이 될 때까지 구현한다.

통과시키려고 기준을 낮추지 않는다. 기준이 틀렸으면 보고하고 정정한다.

## 검증에 따른 정정

개정 1은 다음 부분이 틀렸다.

| 주제 | 개정 1 | 정정 |
|---|---|---|
| `spl_autoload_register` 수 | 16회 | 파일 14개, 호출 15회 |
| `.npmrc` | npm workspaces를 막고, crudui에도 있다 | `install-links`는 workspaces에 영향이 없다. 이 key를 둔 레포는 hyper와 template뿐이다 |
| `config/phpunit` | 사용처 없음 | `tests/source/parity-real.test.mjs`가 쓴다 |
| template lint stack | eslint 8, TS 5 | eslint 10, TypeScript 6 |
| template-ts test | load-failure test 없음 | load-failure test는 있다. object-calls와 compiler-interface는 다른 곳에서 다룬다(§2) |
| validator-python | unit test 없음 | test 파일 5개가 있고, `hiddenPaths`가 test되지 않는다 |
| Unicode generator | 3개 | 7개 |
| `--strict-psr` | 파일당 class 하나를 증명한다 | exit 0으로 끝나고 추가 class를 조용히 뺀다. 잡는 것은 phpcs `MultipleClasses`뿐이다 |
| hyper Python JSON | 재발명 | spec이 PHP `json_encode`와 byte 단위 동일을 요구한다. ordered-json은 encode case 34개 중 14개에서 실패한다. 정당하다 |
| ordered-json PHP `files` | PSR-4 우회 | `files`는 namespaced function과 constant를 읽는 Composer 표준 방법이다. class만 옮긴다 |
| rustdoc JSON | stable 추출기 | stable 1.98과 1.99에서 `-Z unstable-options`가 필요하다 |
| `path.matchesGlob` | `glob.mjs`를 그대로 대체 | dot-path를 match하지 않아 `**`가 `.github/…`를 조용히 빠뜨린다 |
| npm `semver` | `version.mjs`를 대체 | `version.mjs`는 npm, Go, PyPI, Composer, crates 버전을 비교하는데, `semver`는 PEP 440과 Go pseudo-version을 읽지 못한다 |
| API Extractor `ae-undocumented` | 동작한다 | `apiReport.enabled`일 때만 나오고, `ae-forgotten-export`에는 `addToApiReportFile: false`가 필요하다 |
| generator-svelte TS 6 | workspace 안 devDependency 하나 | npm이 `ts-api-utils`와 `eslint-plugin-svelte`를 TS 7 쪽으로 hoist해 eslint가 죽는다 |
| kit npm 의존 | byte copy 안에서도 가능 | 복사된 파일은 의존성을 소비자 레포에서 찾는다. 그래서 kit이 먼저 package가 되어야 한다 |
| `--test-force-exit` 제거 | red가 된다 | 새는 handle이 있으면 파일이 실패하지 않고 멈춘다 |
| exclusion | 이유가 있으면 허용 | kit parity R8은 이미 모든 exclusion을 실패시킨다. 영구 차이는 `profiles` / `nativeOnly`로 둔다 |
| 기준 ID R1–R8 | 사용 | parity rule ID와 겹쳐서 이제 S1–S9로 부른다 |

## 0. 기준

기준은 `PRINCIPLES.md`(레포 root, `PRINCIPLES.ko.md`와 쌍)의 "Repository standards" 절에 둔다. kit 담당 session과 합의한 대로 kit이 모든 레포에 vendor한다. 각 레포의
AGENTS.md와 AGENTS.ko.md는 이 문서를 참조만 하고 내용을 복사하지 않는다.

| ID | 기준 | 강제 도구 (red test) |
|---|---|---|
| S1 | **재발명 금지.** 각 생태계의 규칙을 따르고, 외부 도구나 library가 하는 일을 다시 만들지 않는다. symbolic link 금지 같은 우리 규칙은 우리가 만드는 것에만 적용한다. npm이 workspace와 bin에 만드는 link를 포함해, 외부 도구의 동작을 막지 않는다. 자체 구현은 rebuild 기록(`docs/rebuild/<tool>.md`)이 있을 때만 허용한다. 기록에는 요구사항, 찾아본 생태계 도구, 어느 것도 맞지 않는 이유를 쓴다. | 아래 lint와 금지 API check; 외부 형식을 parse하는 kit 도구와 레포 도구마다 rebuild 기록이 있는지 보는 check |
| S2 | **PHP.** 파일당 class 하나. package는 PSR-4, test는 `autoload-dev`. `classmap` 금지. `files`는 namespaced function과 constant에만 쓴다. `spl_autoload_register`와 runtime `ClassLoader` 등록 금지. 생성 코드도 PSR-1과 PSR-4를 따른다. test는 PHPUnit. | phpcs PSR-12(`PSR1.Classes.ClassDeclaration.MultipleClasses`, `PSR1.Files.SideEffects`); ajv로 검사하는 composer.json policy schema(`autoload.classmap` 금지, `autoload-dev` 필수); phpstan + `spaze/phpstan-disallowed-calls`(문자열 변수를 거친 `spl_autoload_register`와 `ClassLoader::addPsr4`도 잡는다); commit된 생성 결과 sample에 phpcs; 이름이 틀린 단일 class 파일에는 `composer dump-autoload --strict-psr` |
| S3 | **test runner.** test는 생태계 표준 runner로만 돈다: `node --test`, vitest, PHPUnit, `go test`, `cargo test` / nextest, unittest. 자체 PASS/FAIL protocol, `check()` helper, 파일을 하나씩 잇는 chain을 쓰지 않는다. test는 설치된 package를 대상으로 돈다. `PYTHONPATH`, `sys.path` 변경, 레포를 벗어나는 경로를 쓰지 않는다. | kit이 runner별 test 파일 규약을 고정한다(`*.test.{ts,mjs}`, `*Test.php`, `*_test.go`, `tests/`와 `#[test]`, `test_*.py`). 레포 선언은 파일을 더할 수만 있고 좁힐 수 없다. test root 아래에서 test API를 import하는 파일은 모두 binding에 속해야 한다. parity R3, R5; ruff TID251 `sys.path`, 중첩된 `[tool.ruff]`는 반드시 root를 `extend`; parity schema와 layout 도구가 `env`, Makefile, 설정의 `PYTHONPATH`와 레포 밖 경로를 거부 |
| S4 | **버전.** lock의 모든 의존성이 동작함을 보인 뒤에만 버전을 정한다. LTS가 있는 생태계(Node, Symfony)는 최신 LTS를 쓴다. 그 밖에는 의존성이 지원하는 최신 stable을 쓴다. LTS에 근접한 더 새 non-LTS는 허용한다. 선언 하한은 pin 정밀도로 pin과 같다. 모든 레포가 같은 pin을 쓴다. 예외는 범위, 이유, 재시도 조건과 함께 선언한다. source build로 조용히 fallback하지 않는다. | kit이 pin을 data로 배포한다. 레포는 쓰는 도구와 예외만 선언한다. `check-toolchain`이 모든 manifest 하한을 pin과 비교한다(새 TypeScript key 포함). uv `no-build`, npm `engine-strict`, Composer `config.platform.php`. CI가 pin에서 전체 suite를 돈다. |
| S5 | **폴더.** 모든 monorepo가 한 폴더 구조를 쓴다(아래). | layout 도구(§1.4) |
| S6 | **언어 parity.** 레포의 모든 구현은 같은 feature unit, vector, API를 같은 수준으로 test한다. 영구 차이는 parity `profile`이나 `nativeOnly` 항목으로 두고, 그 이유는 도구가 확인하는 spec anchor(`contracts/…#id` 또는 `docs/spec/…#id`)를 인용해야 한다. `exclusion`은 제거될 때까지 실패하는 임시 부채다(kit parity R8). | kit parity 확장(§1.3) |
| S7 | **test 위치.** 기본 기능의 test는 그 기능을 소유한 package와 레포에 둔다. 소비자는 소비자 관점의 test만 둔다. | 한 레포 안에서는 parity R6와 layout 도구. 다른 레포의 vector나 fixture를 읽는 test는 S3의 경로 규칙이 잡는다. 소유자의 assertion을 말만 바꿔 반복하는 소비자 test는 도구로 찾을 수 없어 review로 찾아 기록한다 |
| S8 | **이유.** 이상한 점의 보고는 PRINCIPLES "책임"의 두 번째 항목이므로 다시 적지 않는다. S8은 모든 예외, profile, rebuild 기록이 선언된 자리에 이유를 가진다는 것을 더한다(K117). | 보고 자체는 어떤 도구로도 강제할 수 없고, 계획은 이를 그대로 적는다. 도구가 맡는 부분은 모든 예외, profile, rebuild 기록에 이유를 요구하는 것이다 |
| S9 | **인프라 언어 하나.** kit을 포함한 언어 간 orchestration과 check는 TypeScript로 쓴다. Node 26은 레포 안의 `.ts`를 바로 실행한다(type stripping). `tsc` 7이 `noEmit`, `erasableSyntaxOnly`, `allowImportingTsExtensions`, `verbatimModuleSyntax`로 검사한다. Node는 `node_modules` 안에서 type을 지우지 않으므로, kit package는 `tsc` 7 출력(JS와 `.d.ts`)으로 배포한다. | layout 도구가 인프라 경로의 비-TS 스크립트를 실패시킨다. 선언된 예외: (a) 한 언어의 구현을 구동하는 harness는 그 언어의 test이므로 소유 package에 둔다; (b) 언어별 정적 check는 그 생태계 analyzer(golangci-lint, PHPStan)의 plugin으로 둔다; (c) symbol 추출기는 그 생태계 도구를 돌려 JSON을 낸다 |

### S5: 폴더 구조

**root 폴더**

| 폴더 | 담는 것 |
|---|---|
| `packages/` | package |
| `contracts/` | 공유 spec data: vector, fixture, JSON schema, machine 정의 |
| `docs/` | 문서 |
| `scripts/` | TypeScript 인프라 |
| `tests/` | 언어 간 runner와 도구 test만 |
| `examples/` | 예제 |
| `benchmarks/` | benchmark |
| `config/` | 설정 |

지금 있는 root는 이렇게 옮긴다.
- `schema/`, `conformance/`, `fixtures/`, `machines/` → `contracts/`
- `bench/` → `benchmarks/`
- `tools/` → `scripts/`, package라면 `packages/`
- orm의 root Go module(`engine/`, `generator/`, `cmd/`, `internal/`) → `packages/go/`
- ssr의 `verification/` → `packages/verification/`
- template-benchmark는 package monorepo가 아니다. `adapters/` → `packages/`로 옮기고, kit과 S1–S9를 도입한다

도구를 켜기 전에 각 레포의 `config/layout.yml`에 이 대응을 적는다. 그래야 red의 green이 정해진다.

**package 폴더**
- 주 spec의 runtime port는 `packages/<runtime>/`에 둔다. runtime은 go, php, php-ext, python, rust, ts, js 중 하나다.
- 다른 component는 `packages/<component>/`에 둔다.
- port가 있는 component는 `packages/<component>/<runtime>/`에 둔다.
- 폴더 이름에는 레포 prefix를 붙이지 않는다. 배포 이름에는 붙인다.

### S4: 사용 가능성 판정

2026-10-13 HEAD의 lock 의존성 전부를 대상으로 했다.

| 항목 | 근거 | 결정 |
|---|---|---|
| Rust | Cargo.lock 23개, registry 항목 2,203개, 고유 버전 674개. 선언된 MSRV 최고는 1.96(oxc 0.151.0)이고, 204개 버전은 선언이 없다. 1.99.0은 2026-10-01에 나왔다. 우리 코드는 `no_mangle_generic_items`(1.99부터 hard error)도, legacy integer module도 쓰지 않는다. 나머지는 build가 증명한다. | **1.99.0**, edition 2024 |
| Python | 최신인 PyYAML 6.0.3에 cp315, abi3, none-any wheel이 모두 없다. no-build로 `uv sync --python 3.15`를 하면 PyYAML에서 실패하고, 3.14는 통과한다. cryptography, psycopg-binary, cffi는 cp315 wheel이 있다. | **3.14**. PyYAML이 cp315 wheel을 내면 3.15로 올린다. 판단은 uv no-build가 한다 |
| PHP | composer.lock 22개가 모두 8.5.10을 허용한다. 추적되는 PHP 파일 587개에 `php -l` 오류가 없다. | **8.5** |
| PHPUnit | 13은 PHP `>=8.4.1`이 필요하고, 최신은 13.4.2다. | **^13.4** |
| Node | 26은 2026-10-28에 LTS가 된다. 26.11.1은 2026-10-07에 나왔다. package-lock 24개의 engines가 모두 허용한다. node-gyp, nan, node-addon-api가 없다. | **26.11.1** |
| TypeScript | "TypeScript 7" 참조. | **7.0.2**, 선언된 Svelte 예외만 제외 |
| Go | 레포의 directive는 1.21–1.27.1에 걸쳐 있다. 의존성의 `go.mod`(proxy.golang.org, module 버전 51개)는 최대 1.27을 요구한다. 현재 버전은 go1.27.2다. | **1.27.2** |

build로 아직 증명해야 할 것(red 다음 green):
- `-D warnings` 아래에서 Rust 1.99의 새 lint
- 8.5에서 우리 PHP extension
- Node 26에서 playwright와 puppeteer

### TypeScript 7

TypeScript 7.0.2는 `.`, `./package.json`, `./unstable/*`만 export한다. Microsoft는 7.1이 "새로운 (그리고 다른) API와 함께
나올 것"으로 예상한다. TypeScript 6 API를 쓰는 곳은 세 묶음이다.

**1. 우리 코드(6곳).** 교체한다.

| 위치 | 쓰임 | 교체 |
|---|---|---|
| orm-npm `src/generate/scan.ts` | syntax. 배포 library의 runtime `dependencies`에 `typescript ^6`가 있다 | oxc-parser |
| orm-npm `tests/models-scan.mjs` | `createSourceFile` | oxc-parser |
| template `scripts/check-compiler-interface.mjs` | syntax | oxc-parser |
| template `tools/showcase/compile-generated.mjs` | `transpileModule` | esbuild |
| crudui `tests/build/public-packages.test.mjs` | `createProgram` 진단 | 소비자 fixture에 `tsc --noEmit` 7 |
| crudui `scripts/check-contract-manifest.mjs` | symbol과 resolution | API Extractor API model |

**2. lint.** eslint + typescript-eslint를 oxlint 1.87 + oxlint-tsgolint 7.0.2004로 바꾼다.
- typescript-eslint의 parser는 canary를 포함해 `typescript <6.1`만 허용한다. 지원은 #10940에서 계획 중이고, 그 issue는
  열려 있으며 PR을 받는 중이다. 하지만 아직 나오지 않았다.
- oxlint core는 stable이고 tsgolint는 stable로 표시돼 있다. README는 지원 범위를 "59/61"과 "60 of the 62" 두 가지로 적고
  있다.
- crudui와 template은 non-type-aware `recommended` set만 쓴다.
- oxlint JS plugin은 alpha라서 쓰지 않는다.
- oxlint는 `.svelte` template을 lint하지 못하므로, `.svelte` lint는 Svelte 예외에 남는다.
- typescript-eslint가 TypeScript 7 지원을 내면 S1에 비추어 이 선택을 다시 검토한다.

**3. TypeScript 7을 지원하지 않는 외부 도구(crudui).**
- **svelte-check 4.7.6.** peer는 `^5 || ^6`. sveltejs/language-tools #3063(열림)에서 member가 `--tsgo` mode에서도 두 버전이
  모두 필요하다고 말한다.
- **@sveltejs/package 3.0.0.** latest와 next 모두 peer `^6`.
- **typedoc 0.28.20.** peer는 6.0.x까지. API Extractor 7.59.4 + API Documenter로 교체한다. API Extractor는 TypeScript
  5.9.3을 내장하고 TypeScript 7이 내는 `.d.ts`를 읽는다. scratch 재현으로 둘 다 확인했다.
  - 문서 gate에는 `apiReport.enabled`와 `addToApiReportFile: false`가 필요하다. `ae-undocumented`가 API report를 통해서만
    나오기 때문이다. 이 설정이 없으면 gate가 green으로 남는다.
  - red fixture로 gate를 증명한다: 문서 없는 export가 실패하고, forgotten export가 실패해야 한다.
  - crudui package 7개를 모두 통과시킨다. 지금까지는 sample package 하나만 돌렸다.
- svelte-check와 @sveltejs/package는 Svelte의 표준 도구이므로 그대로 둔다.
- **예외.** `packages/generator-svelte`는 TypeScript 6을 쓴다.
  - 자체 `package.json`과 lock을 가진 별도 npm project로 workspaces 밖에 둔다. workspace 안에 두면 npm이
    `ts-api-utils`와 `eslint-plugin-svelte`를 TypeScript 7 쪽으로 hoist해 eslint가 죽는다(재현).
  - 이 예외는 범위, 이유, 재시도 조건과 함께 toolchain data에 선언한다. 재시도 조건은 "Svelte 도구가 TypeScript 7을
    허용한다"이다.
  - red/green fixture로 격리를 증명한다.

나머지는 모두 TypeScript 7.0.2를 쓴다.

### 결함: `--test-force-exit`이 test를 버린다

kit `scripts/kit/run-tests.mjs:104`가 `node --test`에 `--test-force-exit`을 넘긴다. vendor된 모든 사본에 있다(crudui
:75, fsm :103, hyper와 template :92).

Node 26.8.1에서 `first`를 등록하고, top-level에서 기다린 뒤, 실패하는 `late`를 등록하는 파일을 돌리면 이렇다.
- 그냥 돌리면 `tests 2, fail 1`을 보고하고 exit 1로 끝난다.
- flag를 주면 `tests 1, pass 1`을 보고하고 exit 0으로 끝난다.

즉 이 flag는 강제 종료로 닫히지 않은 handle을 숨기면서 test를 버린다. 그 부작용을 막으려고 땜질이 두 개 더 붙었다:
`test-load-check.mjs` preload와 crudui의 rule `no-await-after-test-registration`이다.

flag만 지우는 것으로는 부족하다. 새는 `setInterval`이 있으면 파일이 15초 넘게 돈다. red가 아니라 멈춤이 된다.

고치는 순서:
1. red test를 먼저 둔다.
   - top-level await 뒤에 등록한 test가 실행되어야 한다.
   - 마지막 test 뒤에도 끝나지 않은 파일은 파일별 종료 기한으로 실패하고, 메시지에 열린 handle
     (`process.getActiveResourcesInfo()`)을 적는다. run-tests는 go, cargo, phpunit, python에 이미 이런 기한을 둔다.
2. flag를 지운다.
3. 기한이 드러낸 누수를 각 test에서 고친다. kit 담당 session이 원인 모를 `tests/kit/dependency-cargo.test.mjs` 1회 실패를
   알려 왔는데, 이런 누수일 수 있다.
4. forced exit 없이도 `test-load-check.mjs`의 blocking stdout이 필요한지 확인한다. 그 뒤 그 파일과
   `scripts/lint/node-test-rules.mjs`, 그리고 각각의 test를 지운다.

## 1. 도구와 순서

순서는 의존 관계로 정한다. kit 도구는 kit 담당 session("new")을 통해서만, 그리고 그 session의 principles 문서가 착지한
뒤에 바꾼다.

1. **kit을 TypeScript package로 만든다(S9).**
   - source를 `.ts`로 옮긴다.
   - `tsc` 7로 JS와 `.d.ts`를 build한다.
   - package에 `bin`을 두고, 자기 lock에 자기 의존성을 pin한다.
   - 각 레포는 devDependency 하나로 소비한다. 지금 polyspec package를 소비하는 방식대로, integrity가 pin된 release-asset
     tarball을 쓴다.
   - fsm, ssr, template-benchmark에는 이를 위한 root `package.json`을 둔다.
   - 이것으로 도구의 byte-copy vendoring을 대체한다. `kit-sync`는 레포 안에 있어야 하는 파일만 남긴다: `release.yml`,
     `PRINCIPLES.md`, lint 설정 파일.
   - npm registry 게시는 외부 행위이므로 먼저 소유자 확인을 받는다.
2. **kit이 재발명한 도구를 교체한다.** 각 변경은 red kit test로 시작한다. 생태계 대체재가 없는 kit 도구에는 rebuild 기록을
   둔다. `.npmrc` key는 그 key에 기대는 코드(`run-tests.mjs`의 "npm writes no bin links", `dependency-state.mjs`의
   "install-links copies")를 바꾸는 release에서 함께 지운다.

   | 지금 | 교체 |
   |---|---|
   | `schema-validate.mjs` | ajv |
   | `glob.mjs` | `dot: true`를 준 picomatch. red test는 `.github/…`와 `docs/.vitepress/…`를 포함한다 |
   | `pylock.mjs`, `dependency-state.mjs`의 pyproject 정규식 | smol-toml |
   | `python-lock.mjs`의 PEP 508 parser | red test를 통과하는 npm PEP 508 parser가 있으면 그것, 없으면 rebuild 기록 |
   | `version.mjs` | 생태계별 comparator(npm `semver`, PyPI는 `@renovatebot/pep440`). 나머지는 rebuild 기록 |
   | `check-commits.mjs` | commitlint + `(#id)` 접미사 rule |
   | `test-output.mjs` 텍스트 parsing | JUnit / JSON reporter(node junit, PHPUnit `--log-junit`, nextest JUnit, `go test -json`) |
   | `install-*.mjs`와 toolchain pin | mise + `mise.lock`(mise가 아직 experimental로 표시)과 비교한 rebuild 기록 |
   | `changelog.mjs`, `git-hooks.mjs`, `duplication.test.mjs` | git-cliff / release-please, lefthook, jscpd와 비교한 rebuild 기록 |
   | `run-tests.mjs --test-force-exit` | 위 "결함"대로 제거 |

3. **parity를 확장한다.**
   - **feature unit.** feature마다 구현별 test case 하나를 native runner의 test id로 요구한다. runner가 통과로 보고한
     id와 대조한다.
   - **고정된 test 파일 규약.** S3대로.
   - **symbol snapshot.** 각 구현이 자기 생태계 도구로 공개 API를 낸다.

     | 언어 | 도구 |
     |---|---|
     | Go | `go/packages` |
     | TS | API Extractor API model |
     | PHP | `nikic/php-parser` |
     | Python | `ast` |
     | Rust | `rustdoc --output-format json`(nightly가 필요하다. rust-lang/rust#76578 열림) |

     이것으로 parity R1과 R11을 켠다.
   - **Rust 추출 예외.** Rust symbol 추출은 pin된 nightly를 쓴다. 이유와 재시도 조건("rustdoc JSON이 stable이 됨")을 가진
     범위 예외로 선언한다. nightly를 쓰는 곳은 여기뿐이다.
   - **spec anchor.** profile과 `nativeOnly` 항목의 이유는 spec anchor로 확인되어야 한다(S6).
   - **registry 흡수.** 각 레포가 parity를 도입할 때마다 다시 만든 registry를 지운다.
     - ordered-json `implementations.json`, `package-tests.json`
     - orm `scripts/features/*`
     - template `contracts/features.json` check와 `tests/runner/parity.mjs`
     - crudui evidence
     - ssr `features.json`
4. **layout 도구(S5, S7).**
   - fsm의 `check-layout.mjs`는 옮겨 쓸 수 없다. `fsm-<kind>` prefix를 요구하고, `contracts/layout.json`을 읽고,
     `packages/`만 검사한다.
   - 결정(K76): kit은 alint 0.18.2를 설정해 쓰고 layout 도구를 만들지 않는다. alint가 모든 항목을 설정만으로 표현하므로 S1에
     따라 재구현하지 않고 rebuild 기록도 없다. ls-lint는 이름만 검사하고 Repolinter는 archived다. 평가, 항목별 판정, 버전 절차는
     `docs/tool-inventory.ko.md`(Layout 검사)에 있다.
   - `make layout-check`는 `var/tools`의 alint(`install-tools`가 platform archive별 sha256으로 고정해 설치)를
     `config/layout.yml`에 돌린다. 이 파일은 vendored `config/layout.kit.yml`(공통 rule과 template)을 extends하고 레포의 map을
     더한다. S9 예외마다 이유를 주석으로 적고 owner가 review한다(S8).
   - rule은 다음을 검사한다.
     - root allowlist
     - package tree와 레포 접두사 금지
     - go.mod module path = 레포 경로 + 폴더, v2 이상은 Go의 `/vN`
     - `PYTHONPATH` 금지. 여기서만 검사하고 parity schema에서는 검사하지 않는다
     - 레포를 벗어나는 경로 금지: `config/*.json`, 그리고 `go.mod`, `package.json`, `pyproject.toml`, `Cargo.toml`,
       `composer.json`의 path 의존성
     - S9 예외 밖에 비-TS 인프라 스크립트가 없음
     - root `tests/`에는 선언된 runner만 있음(S7)
   - feature 소유는 parity가 맡는다.
   - 소비 레포 적용은 K79에서 한다.
5. **lint 설정.** kit이 배포하고, 실행할 때마다 root 설정을 명시한다(예: `ruff check --config`).

   | 언어 | 설정 |
   |---|---|
   | PHP | phpcs PSR-12 + phpstan disallowed-calls + composer.json policy schema |
   | Rust | `[workspace.lints]`에 `unsafe_code = "deny"`, FFI 지점(orm `tx.rs`, case-clock, ssr v8)에만 범위 allow; clippy `-D warnings` |
   | Go | golangci-lint(govet, forbidigo, `replace`를 막는 gomoddirectives); `deadcode` |
   | Python | ruff TID251 `sys.path`; 죽은 코드는 vulture |
   | TS | oxlint + oxlint-tsgolint; 죽은 코드와 안 쓰는 export는 knip |
   | 공통 | `.editorconfig` |

6. **toolchain check(S4).**
   - 하한을 pin 정밀도로 pin과 비교한다.
     - Node `engines >=26.11.1`
     - Composer `php >=8.5`
     - `requires-python >=3.14`
     - go.mod `go 1.27.2`, `toolchain` 줄 없음: go 명령은 go 줄과 같은 toolchain 줄을 지웁니다
     - `rust-version 1.99.0`
     - TypeScript pin
   - 선언된 예외를 읽는다.
   - npm의 link를 막는 `.npmrc` key를 거부한다.
7. **도구마다 자기 증명.** 도구마다 위반 fixture를 두고, 그 fixture가 도구를 red로 만들어야 한다. fixture에는 검증에서
   찾은 false green이 들어간다.
   - `--strict-psr`에 추가 class
   - `importlib.import_module("sys").path`
   - 중첩된 `[tool.ruff]`
   - `transmute_copy`
   - `apiReport` 없는 문서 없는 export
8. **kit release 하나, sync 한 번.** 1–7을 kit release 하나로 낸다. 그 뒤 모든 레포가 그 release로 한 번에 옮긴다.
   - crudui는 0.0.8, hyper는 0.0.17, template은 0.0.21, fsm은 0.0.26, ordered-json은 0.0.28, orm은 0.0.30에서 옮긴다.
   - ssr과 template-benchmark는 kit을 처음 도입한다.

   각 이동의 담당은 §4에 적는다.

## 2. red 재현

폴더 목적지를 먼저 정한다. 그래야 `config/parity.json`과 `config/layout.yml`을 최종 경로로 한 번만 쓴다.

레포가 release를 도입한 직후 `make check`를 돌리고 실패를 기록한다. 이때는 고치지 않는다. 아래 표가 실패를 예측한다.
- "도구"로 적힌 실패는 그 도구가 보고해야 한다. 나오지 않으면 도구가 틀린 것이므로 도구를 고친다.
- "review"는 도구로 찾을 수 없는 것이다. review로 찾았다고 기록한다.

| 레포 | 예측 실패 | 도구 |
|---|---|---|
| orm | 파일 11개에 추가 class 26개; `classmap` | phpcs; policy schema |
| orm | `spl_autoload_register` 호출 15회 | phpstan |
| orm | `bootstrap.php`의 side effect | 생성 sample에 phpcs |
| orm | PHPUnit 밖의 `*_test.php` 35개(와 helper), orm-php-extension 9개, root `tests/` 16개 | S3 규약 |
| orm | orm-npm test 파일 66개 중 node:test는 1개, 나머지는 `typescript:test`와 `sqlite-test.sh`가 chain으로 실행 | S3 규약 |
| orm | orm-rust `[[bin]]` test program 6개(`#[test]`를 쓰는 파일은 51개) | S3 규약 |
| orm | `transmute` 1개(`planner.rs:1000`) | `unsafe_code` |
| orm | Python이 18개 feature 모두에서 "planned"; events와 DSN vector를 안 돌림; `codec_vector.py`, `dbspec_{cases,plans,ddl}.py`가 실행되지 않음 | parity |
| orm | suite unit 11개에서 python과 php-extension 누락 | parity |
| orm | npm `performance_gate` | parity |
| orm | root Go module | layout |
| orm | `config/parity.json`의 `PYTHONPATH=../ordered-json/…` | layout |
| ordered-json | `OrderedJson.php`에 class 4개(function과 `MAX_DEPTH`는 `files`에 남음); `license` 없음 | phpcs; `composer validate` |
| ordered-json | JS `check()` runner | S3 |
| ordered-json | Go와 php-ext에 strict duplicate key 없음 | parity |
| ordered-json | Python `sys.path.insert`(전체 레포 `packages/` 아래 test 파일 61개 중 3개) | ruff |
| ordered-json | Python 인프라 스크립트 | layout(S9) |
| template | `AstPreparedExecution`이 `AstProgram.php`에 있음 | phpcs |
| template | Python 자체 JSON parser(`json_parse.py`. Go는 `encoding/json`을 감쌈) | review. ordered-json으로 바꿀 수 있는지는 conformance vector가 정한다 |
| template | object-calls test가 php와 python에만 있음. `docs/spec/runtime.md:189`는 TS, Go, Rust도 다룸 | parity |
| template | template-compiler에 자체 test 없음; browser test가 root에 있음 | layout |
| template | `scripts/test-progress/node-reporter.mjs`, `vitest-reporter.mjs`를 참조하는 곳 없음 | knip |
| template | template-python의 중첩 `[tool.ruff]` | ruff 설정 check |
| template | `sys.path.insert` test 파일 6개 | ruff |
| crudui | 두 package가 `Polyspec\Crudui\`를 map | policy schema |
| crudui | `scripts/php-package-autoload.php` | phpstan |
| crudui | php-ext를 `cc`로 build, `config.m4`와 PIE manifest 없음 | layout(필수 파일) |
| crudui | generator-go의 `replace`와 `validator-go v0.0.1` | gomoddirectives |
| crudui | `hiddenPaths`가 Python에서 test되지 않고 Go, PHP, Rust, php-ext에 없음 | parity |
| crudui | generator-python(test 파일 4개)과 generator-rust(1개) 대 Go(15개), PHP(11개) | parity |
| crudui | Unicode generator 7개 | review → 언어별 backend를 가진 generator 하나 |
| crudui | root의 CSS test 4개 | layout |
| crudui | 낡은 `tests/ordered-json/check.py` | knip / layout(binding 없음) |
| crudui | `sys.path.insert` test 파일 7개 | ruff |
| hyper | URL decoding과 multipart parsing(JSON은 spec 때문에 유지) | review. `urllib.parse` / `email.parser`로 바꿀지는 vector가 정한다 |
| hyper | `.npmrc`, `scripts/tsc.mjs` | toolchain check |
| hyper | root의 hyper-build test | layout |
| hyper | server-node router test가 hyper-client의 test를 반복 | review |
| hyper | 추적되지 않는 `packages/hyper-php` 잔재 | 소유자에게 보고(추적되지 않아 도구가 보지 못함) |
| hyper | server-node가 `reads.json`을 돌리지 않음 | parity |
| hyper | Composer `^8.2` | toolchain check |
| fsm | 동시성 test는 npm에만 있음. retry test는 rust에만 있는데, spec(`docs/spec/fsm.md:187`, S-31)이 retry를 Rust에 둔다. 다른 언어에도 필요한지는 parity가 정한다 | parity |
| fsm | fsm-go module path | layout |
| fsm | `polyspec_fsm` namespace | review |
| fsm | inline Composer `package` repository에 orm 0.0.7을 pin | toolchain / dependency policy |
| fsm | `config/parity.json`의 `PYTHONPATH` | layout |
| ssr | adapter 비대칭(vue와 svelte에 invalid-input test 없음, react와 vanilla에 empty-SSR hydration 없음) | parity |
| ssr | `crates/` | layout |
| ssr | kit 없음 | 도입 |
| 전체 | 하한과 pin이 레포마다 다름 | toolchain check |
| 전체 | workspace 밖의 Rust crate; `[workspace.lints]` 없음 | layout / lint |
| 전체 | orm, template, ssr AGENTS.md에 재발명 금지 규칙 없음 | vendor된 `PRINCIPLES.md`로 대체 |

## 3. green

- 각 레포는 red 목록을 `docs/plans/execution-checklist.md`에 등록하고 commit 하나에 항목 하나씩 green으로 만든다.
  commit은 `type(scope): Subject (#id)` 형식에 실제 이유를 적는다. 무관한 변경은 따로 commit한다.
- 호환 layer, fallback, alias를 남기지 않는다. 옛 경로는 지운다.
- **orm PHP.**
  - class를 나누고, `classmap`과 `tests/autoload.php`를 지운다.
  - `src/Generator.php`는 PSR-4 class 파일과 별도의 function/등록 파일을 쓴다. fsm `backends/php.mjs` 방식이다.
  - test는 `autoload-dev`가 map하는 `tests/` 아래 고정된 git-ignore 디렉터리에 model을 생성한 뒤
    `composer dump-autoload`를 돌린다. runtime `ClassLoader` 등록은 없다.
  - PHP test를 PHPUnit으로 옮긴다.
- **Rust.** `unsafe_code = "deny"`. `planner.rs`의 lifetime은 `Scope<'a>`로 넘긴다.
- **수작업 parser 교체.** 소유 spec의 vector가 green으로 남는 경우에만 바꾼다. hyper의 JSON encoder는 유지하고, rebuild
  기록이 `conformance/json.json`을 가리킨다.
- **parity.** 빠진 feature와 test를 소유 package에 구현한다. 판정은 green parity가 한다.
- **test 이동.** 위치가 틀린 test는 소유자에게 옮기고, 중복된 소비자 test는 지운다.
- **버전.** S4 표대로 올리고, PHPUnit 13에 필요한 test 변경을 함께 한다.

## 4. 레포 순서와 조율

- **폴더 이동은 의존 순서대로, 소유자부터 한다.**
  1. ordered-json(`packages/go`, tag `packages/go/vX`, `config/release.json`의 `goModules`).
  2. orm은 T128이 착지한 뒤. root Go module을 `packages/go`로 옮긴다. T128이 CLI를 다시 쓰는 동안 orm-gen 경로가 바뀐다.
  3. fsm, template, hyper, crudui. 그다음 각자 의존성을 갱신한다.

  어느 소비자도 두 번 옮기지 않는다.
- **kit과 orm main**은 "new" session이 소유한다.
  - kit: §1은 그 session의 principles 문서 다음에 시작한다.
  - orm: T128-2a("new")가 모든 orm-gen CLI를 생태계 argument parser로 옮긴다(PHP는 `getopt`). 내 orm 작업은 T128-2a
    다음이다.
  - 새 `packages/orm-dbspec-*` package는 S5에 따라 `packages/dbspec/*`로 만든다.
- **"unify-path-access-boundary"** session이 hyper 의존 버전을 올린다(S-285). hyper나 template을 바꾸기 전에 알린다.
- **consumer**는 옛 tag에 git `subdirectory` source를 pin한다(`consumer/hyper/python/pyproject.toml:33-38`).
  - 옛 tag는 계속 resolve된다.
  - kit release 규칙상 Python package는 git tag로 release하지 않으므로, consumer는 release wheel asset으로 옮긴다.
  - "python-server-uv-finish"에게 알린다.
- **crudui, fsm, ordered-json, ssr, template-benchmark**에는 진행 중인 작업이 없다. 이 레포들의 kit 이동(§1.8)은 내가
  맡고, 각각 시작 전에 알린다.
- **외부 행위**는 직전에 소유자 확인을 받는다: registry 게시, tag push.

## 5. 검증

- **red 기록.** 도구마다 fixture가 그 도구를 red로 만든다. 도입 뒤에는 §2의 실패가 나온다. 둘 다 checklist에 적는다.
- **green.**
  - 모든 레포에서 `make check`가 통과한다: lint, parity, layout, toolchain, 전체 test.
  - CI도 pin에서 같은 결과를 낸다.
- **언어별 check.**

  | 대상 | check |
  |---|---|
  | PHP | phpcs PSR-12 통과; phpstan 통과; policy schema; `composer validate --strict`; PHPUnit |
  | Rust | 1.99에서 `unsafe_code`와 함께 `cargo clippy --workspace -- -D warnings` |
  | Python | 3.14에서 no-build로 `uv sync`; `PYTHONPATH` 없음 |
  | TS | `tsc` 7 `--noEmit`; oxlint; `apiReport`를 켠 API Extractor gate |
  | Node | 26에서 playwright |
  | Go | golangci-lint; 깨끗한 GOPATH에서 `go get <module>@<tag>` |
  | crudui php-ext | phpize와 PIE 설치 |
  | generator-svelte | 자체 lock; TS 6 격리 fixture |

- 실패는 원인에서 고친다. 기준을 낮추지 않는다. 기준이 틀렸으면 보고하고 정정한다.
