<!-- doc-id: kit-package -->
<!-- source-sha256: f66a2df8c1ac4a5518fcd141ff463ca5a6bb970d29b0dcedc59e7e47c1eee9b6 -->
# package인 kit (K71-2)

[English](kit-package.md)

상태: 2026-10-13 kit 담당 session과 설계를 합의했습니다(review 지적 1–7 반영). 진행 중입니다.

## 왜

kit은 지금 byte copy로 배포됩니다: `make kit-sync KIT_TAG=`가 kit tag를 clone해 `scripts/kit/`, `tests/kit/`, `vendoredFiles`의
파일을 repository로 copy하고, `.kit/kit.lock.json`이 그 sha256을 기록합니다. copy는 외부 module을 자기를 담은 repository에서
resolve하므로 copy된 tool은 Node built-in만 import할 수 있었고(`kit/AGENTS.md`), 그래서 kit은 JSON Schema validator, TOML
reader, version 비교, commit linter를 다시 만들었습니다(계획: S1). 또 kit은 자기 TypeScript를, Node가 type을 지우지 않는
`node_modules` 아래의 소비자에게 검사된 JavaScript로 배포할 수 없습니다(S9).

K71-2는 kit을 npm package `@polyspec/kit`으로 만듭니다. repository는 그것을 package-lock이 pin하는 devDependency 하나로
설치하고, 그 make target은 build된 tool을 `node_modules`에서 실행합니다. 이로써 tool의 byte copy가 사라지고, K73이 재발명한
tool을 package가 선언하는 library로 바꿀 수 있습니다.

## 전환 뒤 repository가 가지는 것

| 지금 | 뒤 |
|---|---|
| `scripts/kit/*.mts`, `tests/kit/*.mts`(copy) | 없음; tool은 `node_modules/@polyspec/kit/dist/*.mjs` |
| `.kit/kit.lock.json` | 없음; package-lock이 version과 integrity를 pin |
| `include scripts/kit/kit.mk` | package의 `kit.mk`를 include하는 `include scripts/kit/kit-bootstrap.mk`(copy) |
| `make kit-sync KIT_TAG=`(git clone) | `make kit-sync`가 repository에 남아야 하는 파일을 설치된 package에서 copy |
| `make kit-test`(repository에서 kit의 test 실행) | 없음; kit이 자기 CI에서 소비자 layout으로 package를 test |

package가 설치되기 전에 있어야 하거나 고정된 경로에 있어야 하므로 copy로 남는 파일:

- `scripts/kit/kit-bootstrap.mk`: `node_modules/@polyspec/kit/dist/kit.mk`가 없으면 `make install-tools TOOLS=npm`과
  `make install-packages`를 이름으로 대는 error로 멈추고, 있으면 include합니다. 조용한 `-include`는 쓰지 않습니다.
- pin된 npm의 installer와 그 import(`install-npm`, `install-tool`, `tool-wrappers`, `digest`, `files`, 그리고 `packageManager`와
  `.node-version`의 유일한 reader인 `toolchain-declared`)를
  `scripts/kit/bootstrap/` 아래에 두고, `npm ci` 전에 `make install-tools TOOLS=npm`으로 실행합니다. 다른 npm은 lock을 다시
  쓰거나 거부할 수 있으므로 pin된 npm이 lock을 설치해야 합니다(S4: tool은 pin에서 돕니다).
- `.github/workflows/release.yml`, `PRINCIPLES.md(.ko)`, lint 설정(K77): 그 tool이 읽는 고정 경로.

## bootstrap 순서

1. `make install-tools TOOLS=npm`(copy된 bootstrap installer)은 먼저 실행 중인 node가 `.node-version`의 version인지 확인하고,
   아니면 두 version을 이름으로 대며 멈춥니다; 그다음 `packageManager`의 npm을 `var/tools`에 설치합니다. online.
2. `make install-packages`(`kit-bootstrap.mk`)가 kit을 포함해 `var/tools/bin/npm ci`를 실행합니다. 내려받는 모든 target처럼
   `$(ONLINE)`으로 표시한 online 단계입니다.
3. 나머지 target은 모두 package에서 돌며 2단계 뒤로는 offline입니다: 다른 tool의 `make install-tools`, 검사, release 단계.

**pin마다 원천 하나(S4).**
- npm: `package.json`의 `packageManager`가 유일한 선언입니다; `install-npm`과 `toolchain-declared`가 이미 거기서 읽고,
  `config/toolchain.json`에는 npm key가 없습니다. `check-toolchain`이 설치된 npm을 그것과 비교합니다.
- Node: `.node-version`이 pin입니다. kit을 포함한 모든 `package.json`의 `engines.node`는 그 version 이상(`>=`)이며(하한 =
  pin), 다르면 `check-toolchain`이 실패합니다.

CI와 release workflow는 이 순서로 돌며, consumer-layout 후속 test가 `release.yml`의 순서를 증명합니다.

## kit 자신

- `package.json`: 이름 `@polyspec/kit`, `type: module`, repository가 import해도 되는 tool module의 `exports`, tool을 이름으로
  실행하지 않으면 `bin` 없음, 그리고 tarball을 review할 수 있고 kit-check가 고정된 목록을 갖도록 명시적인 `files` 목록:
  `dist/`(build가 `scripts/kit/kit.mk`와 `scripts/kit/schema/`도 그 안으로 copy하므로 tool은 `$(KIT)/schema`를 찾고 repository는
  `node_modules/@polyspec/kit/dist/kit.mk`를 include합니다), 그리고 copy되는 파일 `scripts/kit/kit-bootstrap.mk`, `scripts/kit/bootstrap/*`,
  `workflows/release.yml`, `PRINCIPLES.md`, `PRINCIPLES.ko.md`, `config/layout.kit.yml`(K76), K77의 lint 설정 파일(착지하는
  대로).
- `tsconfig.build.json`: `rewriteRelativeImportExtensions`로 `scripts/kit/**/*.mts`를 `dist/`로; `tsc` 7.
- source는 `scripts/kit/`에 남습니다(kit repository는 지금처럼 바로 실행합니다); `dist/`는 git이 무시하는 build 출력입니다.
- release는 `npm pack`으로 tarball을 만들어 polyspec package들처럼 GitHub release에 붙입니다(kit의 `config/release.json`이
  package를 선언하며 작업 단계 3–4와 함께); repository는 asset URL과 그 integrity를 pin합니다.
- kit 자신의 Makefile은 `KIT := scripts/kit`로 `scripts/kit/kit.mk`를 include하고 source를 실행합니다; repository의
  `kit-bootstrap.mk`는 `KIT := node_modules/@polyspec/kit/dist`를 둡니다. `kit.mk`는 모든 tool을 맞는 확장자(kit은 `.mts`,
  dist는 `.mjs`)의 `$(KIT)/<tool>`로 이름 붙입니다.

## 검사

- `kit-check`는 copy된 파일을 설치된 package 파일과 byte 단위로 비교하고, 설치된 package의 version이 package-lock이
  `@polyspec/kit`에 resolve한 version과 다르면 실패합니다.
- consumer-layout 후속 test는 kit을 pack하고, tarball과 그 의존으로 npm cache를 채운 뒤, sandbox 소비자에 offline으로
  설치하고, 거기서 bootstrap 순서와 gate target을 실행합니다.
- `kit-test`는 kit에서만 돕니다.

## 작업 순서

1. package build(`tsconfig.build.json`, `package.json`).
2. `$(KIT)`를 쓰는 `kit.mk`, `kit-bootstrap.mk`, bootstrap copy, 설치된 package에서의 `kit-sync`와 `kit-check`.
3. offline의 consumer-layout 후속 test.
4. bootstrap 순서의 kit CI와 release workflow, 그리고 kit의 `config/release.json`과 release asset.
5. kit release 하나; repository는 K79에서 전환하며, 각각 그 소유 session에 알립니다.

전환을 담은 release가 나오기 전까지 copy는 그 경로에 남으므로, 어느 repository도 옮기기 전에 깨지지 않습니다.

## repository가 지금 참조하는 것

K79가 전환하는 모든 repository를 copy 밖에서 조사했습니다(2026-10-13): crudui, fsm, hyper, ordered-json, orm, template,
flowmark(`~/Projects/flowmark`, kit v0.0.34); ssr과 template-benchmark는 K79에서 kit을 처음 도입하며 아직 kit 경로를
참조하지 않습니다.
- code가 import하는 kit module은 `tracked-files` 하나입니다. package가 그것을 export하고, import하는 script는 package를
  import합니다.
- 모든 repository가 `.githooks/*`(`git-hooks`가 씀), `Makefile`, CI와 release workflow, `config/owner-checks.json`과
  `config/dependency-review.json`에 kit tool 경로를 적습니다; flowmark는 `tests/check-refs.test.mjs`에도 적습니다. 각
  전환(K79)이 그것을 `$(KIT)` target이나 package 경로로 다시 쓰고, 각 repository의 소유 검사가 hook과 workflow를 증명합니다.

## 판정

- npm 외의 모든 tool에 대한 `install-tools`는 bootstrap이 npm과 lock을 설치한 뒤 package에서 돕니다.
- `git-hooks`는 tool 경로가 아니라 make target을 부르는 hook을 씁니다: make target은 kit version이 바뀌어도 안정된
  interface이고 tool 경로는 그렇지 않습니다(kit 담당 session과 합의).
- 이 문서는 그것에 기대는 작업 전에 K71-2의 첫 commit으로 착지합니다; K71-1은 이름 변경과 type으로 남습니다.

### 작업의 판정(2026-10-13)

- `kit.mk`는 모든 tool을 `node $(KIT)/<tool>.$(KIT_EXT)`로 실행하며 둘 중 하나라도 없으면 error로 멈춥니다. kit의 Makefile은
  `KIT := scripts/kit`, `KIT_EXT := mts`를, `kit-bootstrap.mk`는 `KIT := node_modules/@polyspec/kit/dist`, `KIT_EXT := mjs`를
  둡니다. repository가 더는 `tests/kit`를 갖지 않으므로 `kit-test`는 `kit.mk`에서 kit의 Makefile로 옮깁니다.
- 다른 tool을 시작하는 tool은 `paths.mts`의 helper 하나로 그것을 이름 붙입니다. 호출하는 module의 directory와 확장자를 쓰므로
  source에서도 `dist`에서도 동작합니다.
- tool의 `ROOT`는 module 자신의 위치에서 얻은 경로가 아니라 작업 directory, 즉 모든 make target이 도는 repository root입니다.
- `kit-bootstrap.mk`는 package가 없을 때 `TOOLS=npm`만 받는 `install-tools`와 `install-packages`를 정의하고, 다른 goal은
  `node_modules/@polyspec/kit/dist/kit.mk is missing; run make install-tools TOOLS=npm, then make install-packages`로 멈춥니다.
- bootstrap module 여섯은 kit 안에서 `scripts/kit/bootstrap/`으로 옮기고 다른 tool은 거기서 import합니다: copy는 하나이며
  둘이 아닙니다. source로 배포되고(`node_modules` 밖에서 실행) `dist/bootstrap/`으로도 build됩니다.
- copy 항목은 `package.json`에 `"kit": { "copies": { "<repository 경로>": "<package 경로>" } }`로 선언하고, 각 원본은 `files`에도
  있습니다. `kit.json`은 지웁니다: `package.json`이 kit version과 copy의 유일한 원천입니다.
- `kit-check`는 copy에 기록된 version이 필요 없습니다: 설치된 package version이 package-lock이 resolve한 version과 다르거나, copy가
  설치된 package의 파일과 byte 단위로 다르면 실패합니다. 둘이 함께 copy를 lock된 version에 묶습니다.
- kit 자신의 `config/release.json`과 release asset은 consumer-layout 후속(작업 단계 3–4)과 함께 합니다: package directory가
  repository root인데 release schema가 지금은 그것을 받지 않습니다.

## 소비자 안의 kit 의존

K73이 package에 library를 더하면 그것은 모든 소비자의 전이 의존이 됩니다. 소비자는 지금 어느 의존에서나 하듯 자기 lock
전체를 review하며(orm의 dependency-policy-check는 package마다 기록을 요구합니다), kit은 자기만의 신뢰 장치를 더하지
않습니다. kit의 release notes가 package의 의존 tree를 적고, K79의 각 전환이 새 package의 review 기록을 더합니다.
