<!-- doc-id: tool-inventory -->
<!-- source-sha256: 58538b606b9dd9c8b0842a6b75625e4d99d8a81ebe3c67f10993770bcac70810 -->
<!-- source-sha256: 423420f084740d3b7a1a744f8687d7aab997ade69e7bb796139b9594f0dfe055 -->
# 도구 목록

[English](tool-inventory.md)

공유 도구는 여러 구현으로 존재합니다. 이 목록은 각 도구가 어디에 있는지, 크기가 얼마인지, kit이 기반으로 삼는 구현이
무엇인지 기록합니다. 도구를 kit으로 합칠 때는 구현들 중 더 넓은 동작을 택하고, kit 테스트로 고정하고, 모든 사본을 vendored
파일로 바꿉니다. 5개 저장소의 작업 트리에서 잰 줄 수입니다.

| 도구 | template | crudui | hyper | ordered-json | orm | kit의 기반 |
|---|---|---|---|---|---|---|
| release | `scripts/release.mjs` 388 | 357 | 317 | `scripts/release.py` 383 | `scripts/release/release.mjs` 302 | template, ordered-json의 Go tag 규칙 포함 |
| push-gate | 125 | 149 | 121 | `push_gate.py` 192 | `scripts/check/push-gate.mjs` 121 | crudui |
| full-run | 199 | 240 | 246 | `full_run.py` 285 | `scripts/check/full-run.mjs` 328 | orm |
| git-hooks | 27 | 없음 | 28 | 없음 | 없음 | hyper |
| holder-lock | 134 | 275 | 111 | 없음 | 없음 | crudui |
| check-documents | 151 | 95 | 70 | `docs_check.py` | 없음 | template |
| owner-check | 219 | 254 | 178 | `owner_check.py` 171 | 없음 | crudui |
| run-tests | 289 | 282 | 159 | `test.py` | 없음 | template |
| target-report, ci-targets | 100, 52 | 73, 47 | 없음 | `ci_run.py` | 없음 | template |
| ci-passed | 36 | 39 | 없음 | `ci_run.py` | `scripts/check/ci-passed.mjs` 32 | template |
| install-tools | 189 | 없음 | 없음 | `toolchains.py` | 없음 | template |
| 의존성 상태, 검토, 게이트 | v0.0.2부터 kit에 있음 | 317, 288, 185 | 없음 | 없음 | 없음 | crudui, kit과 병합 |
| github-ruleset | 182 | 없음 | 164 | 없음 | 없음 | 제거(0.x에는 ruleset이 없음) |

## 결정

- 모든 도구는 Node(`.mjs`)입니다. ordered-json의 Python 도구는 대체하고 삭제합니다.
- 저장소끼리 다른 것은 `config/*.json`뿐입니다. 도구의 코드에는 저장소 이름이나 경로를 넣지 않습니다.
- `github-ruleset`은 vendored하지 않습니다. 0.x 규칙에는 pull request도 ruleset도 없으므로 template과 hyper에서 파일과 Make
  target을 제거합니다.

## Toolchain (K8.2)

`scripts/kit/install-tools.mjs`는 선언된 toolchain을 `var/tools`에 설치하고, `scripts/kit/check-toolchain.mjs`는 실행 중인
도구를 선언과 대조합니다. `scripts/kit/toolchain-declared.mjs`가 선언을 읽고, 설치하는 도구마다 module이 하나씩 있습니다
(`install-npm.mjs`, `install-go.mjs`, `install-ruff.mjs`, `install-composer.mjs`; cargo-audit와 govulncheck는 기존
`install-cargo-audit.mjs`, `install-govulncheck.mjs`를 씁니다). 모든 installer는 `install-tool.mjs`를 씁니다. release를 대상
옆에서 만들고 거기서 확인한 뒤 rename하므로, 두 번째 실행은 아무것도 바꾸지 않습니다. Make target은 `install-tools`(`ONLINE`을
통한 online)와 `toolchain-check`(offline, `TOOLS`가 도구를 제한)입니다.

### 선언

| 도구 | 선언 위치 | 설치 또는 검증 |
|---|---|---|
| Node.js | `.node-version`(정확한 version) | 검증 |
| npm | `package.json`의 `packageManager`: `npm@X.Y.Z` 또는 `npm@X.Y.Z+sha512.<digest>` | 설치 |
| Go | `config/toolchain.json`의 `go`: `versionFile`, 없으면 `go.mod`의 `toolchain` 줄, 없으면 `go` directive | 설치 |
| Rust | `rust-toolchain.toml`의 `channel`(정확한 version) | 검증 |
| PHP | `config/toolchain.json`의 `php`(minor release 목록), 없으면 `.php-version` | 검증 |
| Python | `config/toolchain.json`의 `python`(minor release), 없으면 `.python-version`; 둘 다 있으면 같아야 함 | 검증, 그리고 ruff 환경의 minor |
| Composer | `config/toolchain.json`의 `composer` `{ version, sha256? }` | `sha256`이 있으면 설치, 없으면 검증 |
| ruff | `ruff.pyproject`가 가리키는 `pyproject.toml`의 `ruff==X.Y.Z` pin | 설치 |
| cargo-audit, govulncheck | `config/toolchain.json`의 `cargoAudit`, `govulncheck` | 설치 |

`config/toolchain.json`의 형태는 `scripts/kit/schema/toolchain.schema.json`입니다. `schema`(1), `comment`, `php`(minor release
목록), `python`(minor release), `composer`(`version`, `sha256`), `go`(`mod`, `versionFile`), `ruff`(`pyproject`),
`cargoAudit`, `govulncheck`, `node`(platform별 Node.js archive의 SHA-256)입니다. Rust와 Node.js는 `setup-node`와 `rustup`이
읽는 자기 파일에 둡니다. 선언하지 않은 도구는 설치도 검증도 하지 않습니다.

### 합친 동작

- npm: template의 설치(machine의 npm이 `npm install --prefix`를 실행)와 hyper, ordered-json의 설치(registry tarball을 받아
  SHA-512가 선언한 digest와 같을 때만 사용)는 하나의 설치입니다. `packageManager`에 digest가 있으면 두 번째 경로를 씁니다.
  배치는 `var/tools/npm/node_modules/npm`이고, wrapper `npm`과 `npx`가 `npm-cli.js`와 `npx-cli.js`를 실행합니다. 같은
  version에서 digest가 바뀌면 다시 설치합니다(hyper). link나 특수 파일이 든 tarball은 거부합니다(ordered-json). bootstrap npm은
  `PATH`에서 `var/tools/bin`을 뺀 채 실행합니다(template).
- Go: toolchain module `golang.org/toolchain@v0.0.1-go<version>.<os>-<arch>`을 받는 template의 설치는 이제 release를 세 곳에서
  읽습니다. version 파일(`go.mod`의 `go` directive와 일치하는지 확인하며, crudui와 orm의 파일), `toolchain` 줄(ordered-json),
  `go` directive(template)입니다. 압축을 푼 toolchain만 쓰므로 module cache에 받은 zip은 설치 뒤 지웁니다.
- Composer: hyper는 SHA-256을 확인한 `composer.phar`를 설치하고, template, crudui, orm은 실행 중인 Composer만 검증합니다.
  합친 도구는 `sha256`이 선언되면 설치하고 아니면 검증합니다.
- Python: crudui는 minor release를 설정에, template과 ordered-json은 `.python-version`에 선언합니다. 합친 도구는 설정을 먼저
  읽고 없으면 파일을 읽으며, 둘 다 있고 다르면 실패합니다. PHP도 `.php-version`(ordered-json, orm)과 crudui, template의 목록에
  같은 방식을 씁니다. 파일의 값이 목록에 없으면 실패합니다.
- ruff: template의 virtual environment는 `--copies`로 만들어 interpreter로의 link가 없습니다.
- 검증: crudui의 도구 목록과 메시지(선언한 파일, 실행 중인 version, 기대 version, 해결 방법), minor release로 비교하는 PHP와
  Python(crudui, ordered-json, hyper), 나머지 도구의 정확한 release 비교, `GOTOOLCHAIN=local`과 `RUSTUP_AUTO_INSTALL=0`
  (ordered-json), 증거 함수 `toolchainVersions`(crudui)입니다. 검증은 ruff, cargo-audit, govulncheck도 포함하고, 도구를 하나도
  검사하지 않은 실행은 실패합니다.
- 설정 data: 형태는 모든 저장소의 data를 받습니다. `php`는 목록(hyper는 `["8.5"]`로 씀), `composer`는 객체(template과 crudui는
  `{ "version": "2.10.3" }`로 씀), 모든 파일에 `schema: 1`이 있습니다.

### 버린 동작

- hyper는 `PATH`의 `npm`과 `composer`가 `var/tools/bin`의 파일인지 검사했습니다. 정책은 선언한 version이고 version 검사가 모든
  도구에 그것을 강제하므로, machine의 npm이 선언한 release이면 통과합니다.
- hyper는 `node_modules` 없이 npm을 `var/tools/npm`에 두었습니다. template의 배치로 바꾸므로 wrapper 문구가 하나입니다.
- ordered-json의 `pin TOOL` 명령은 CI에 pin된 version을 출력했습니다. setup action이 pin 파일을 읽고, script는
  `declaredToolchain`에서 같은 값을 받습니다.
- orm은 `.node-version`, `.php-version`, `.go-version` 끝의 newline을 요구했습니다. 파일을 trim해서 읽습니다.
  편집기 설정은 toolchain version이 아닙니다.
- crudui의 `.tools/npm` 경로는 `var/tools/npm`으로 대체합니다(`checkout-npm.mjs`는 vendored하지 않음).

### 저장소에 남는 것

- Playwright와 Puppeteer 브라우저 설치(crudui `install-browsers.mjs`): 한 project의 브라우저에 의존합니다.
- crudui의 `install-lock.mjs`, `tool-resolution.mjs`, `run-command.mjs`: 첫째는 한 install project의 lock을 만들고, 둘째는 한
  build의 cargo, rustc, rustdoc 절대 경로를 찾으며, 어느 것도 선언된 toolchain을 설치하지 않습니다.
- ordered-json의 `make tools`: Rust toolchain(`rustup toolchain install`은 machine에서 rustup이 관리하는 toolchain을 바꿈),
  crate(`cargo fetch`), PIE phar, JSONTestSuite checkout. kit는 Rust를 검증만 하고 설치하지 않습니다.
- crudui의 phpDocumentor 설치, orm의 CI workflow 파일 검사(`node-version-file`, `go-version-file`, `php-version-file`,
  `tools: composer:`), `engines.node`와 `require.php`의 최소 release, `go.mod` module 경로: 한 저장소의 파일을 검사하며
  machine의 도구가 아닙니다.
- `config/toolchain.json` `node`의 Node.js archive checksum은 저장소 자신의 download가 읽는 data입니다. kit는 받아들이기만 하고
  읽지 않습니다.
## Gate: push-gate, full-run, git-hooks, holder-lock (K6.1)

파일: `scripts/kit/checklist.mjs`, `push-gate.mjs`, `git-hooks.mjs`, `holder-lock.mjs`, `full-run.mjs`, `target-run.mjs`,
`schema/checklist.schema.json`, 그리고 `kit.mk` 끝의 make target `hooks`, `hooks-check`, `push-gate-commit`, `rerun-failed`입니다.
lock은 crudui, guard와 hook은 template, tracker는 다섯 구현의 합집합을 기반으로 삼았습니다.

### 정책

tracker의 항목이 active 상태(checklist는 `[~]`)이면 push한 commit이나 working tree에 있을 때 push를 거부합니다. 대기 `[ ]`, 완료
`[o]`, 우회 `[!]` 상태는 막지 않으며 거부 메시지가 이를 밝힙니다. pre-push hook이 gate를 실행합니다. 전체 실행의 guard는
항목이 active 상태인 동안, 추적하는 파일에 변경이 있는 동안, 현재 tree의 전체 실행 기록이 있을 때 거부합니다. 이 정책에는 pull
request, merge queue, ruleset이 없습니다.

### `config/checklist.json`

```json
{
  "schema": 1,
  "hooks": ["pre-push"],
  "trackers": [
    {
      "path": "docs/plans/execution-checklist.md",
      "translation": "docs/plans/execution-checklist.ko.md",
      "format": "table",
      "states": ["[ ]", "[~]", "[o]", "[!]"],
      "active": "[~]"
    }
  ]
}
```

`hooks`는 `.githooks`에서 추적하는 hook의 목록이며 `pre-push`를 포함해야 합니다. tracker는 `path`, `format`(`table`: `| ID | ... | state |`
행, `list`: `- [state] ID text` 항목이며 하위 항목은 들여 씁니다), `active`를 가지고, `translation`, `states`(목록 밖의 state는 오류),
`column`(state가 있는 table 행의 0부터 센 cell, 없으면 마지막 cell)을 가질 수 있습니다. state는 cell이나 항목 앞의 `[x]`이고,
cell이 `[`로 시작하지 않으면 cell 전체입니다.

### 합친 동작

| 동작 | 출처 | 결정 |
|---|---|---|
| 마지막 cell에 state가 있는 table 행 | template, crudui, hyper, ordered-json | `format: table` |
| 하위 항목이 있는 list 항목 `- [state] ID text` | orm | `format: list`, 제목은 첫 문장 |
| state가 column의 단어인 두 번째 tracker(feature table의 implementation column의 `partial`) | ordered-json | tracker의 `column`과 `active`, tracker는 여러 개 허용 |
| 항목이 없는 tracker, 중복 ID, 선언한 state 밖의 state, 항목이 아닌 행은 읽을 수 없는 문서로 거부 | ordered-json, orm(문서 검사), template은 그런 행을 무시 | gate와 guard에서 거부: 더 넓게 읽어 읽을 수 없는 문서를 빈 문서로 보지 않음 |
| tracker 파일이 없는 push된 commit은 거부 | 전체 | 유지, 메시지가 파일을 적음 |
| hook 입력의 잘못된 줄은 거부, 삭제하는 ref는 commit을 push하지 않음, working tree는 항상 읽음 | ordered-json(잘못된 줄), 전체(나머지) | 유지 |
| 한국어 짝은 같은 ID를 같은 순서로, 같은 state로 가져야 함 | orm, ordered-json(문서 검사) | 짝을 같은 parser로 읽으므로 gate와 guard도 다른 짝을 거부, 나머지 규칙(marker, 우회 문구)은 K7의 문서 검사가 유지 |
| 거부 메시지가 파일, ID, 제목, 위치(push하는 ref와 commit 또는 working tree)를 적음 | 전체 | 유지, 어떤 state가 막고 어떤 state가 막지 않는지도 적음, commit은 12자로 표시(ordered-json, orm, template과 hyper는 7자) |
| `commit <rev>`는 줄마다 GitHub annotation을 출력하고 `%`와 줄바꿈을 escape하며 `$GITHUB_STEP_SUMMARY`에 덧붙이고 hook의 mode 100755를 요구하고 commit이 아닌 revision을 알림 | template, crudui, hyper, ordered-json, orm | 유지, `hooks`의 모든 hook의 mode를 요구(ordered-json은 `pre-commit`도 요구, 나머지는 `pre-push`만) |
| `hooks-check`는 `core.hooksPath`가 다르거나 hook이 없거나 실행할 수 없으면 실패 | 전체 | `git-hooks.mjs check`, `pre-push`의 내용이 도구의 hook과 다를 때도 실패 |
| `make hooks`가 `core.hooksPath`를 설정하고 검사 | template, hyper, ordered-json(`hooks-install`) | `git-hooks.mjs install`이 `pre-push`도 쓰고 나열한 hook을 실행 가능하게 함, 두 번째 실행은 아무것도 바꾸지 않음 |
| make를 호출할 때마다 `core.hooksPath`를 설정 | template, orm | `kit.mk`는 `.githooks/pre-push`를 추적하는 checkout에서만 설정, hook이 없는 checkout은 바꾸지 않음 |
| `pre-push`의 내용 | 전체가 최상위 directory로의 `cd`와 주석에서 다름 | 내용 하나, `git-hooks install`이 쓰고 `check`가 비교 |
| `pre-push`가 아닌 hook(ordered-json의 `pre-commit`, orm의 `commit-msg`) | ordered-json, orm | `hooks`에 적고 존재와 mode를 검사, 내용은 저장소에 둠 |
| lock 기록: checkout, process ID, process 시작 시각, 잡은 시각, command, token, 원자적 link, 시작 시각으로 재사용된 process ID와 holder를 구별 | crudui | `holder-lock.mjs`의 기반, template과 hyper는 시작 시각을 기록하지 않았음 |
| 끝난 holder의 lock은 `clear`까지 남음, `clear`는 lock을 옆으로 rename하고 그 사이 새 holder가 잡았으면 되돌림 | crudui(`remove-dead`), template과 hyper(`clear`) | crudui의 제거 방식을 `clear`라는 이름으로 |
| process 종료와 SIGINT, SIGTERM, SIGHUP(종료 상태 128 + n)에서 release | template | 유지, process 안의 holder의 기본값, `run`은 신호를 command에 전달 |
| `run <lock> -- <command>`는 command의 상태로 종료, 신호는 128 + n, 시작하지 못하면 127 | crudui(`hold`), template, hyper | `run`이라는 이름으로 유지 |
| token이 다르면 release 실패 | template, crudui, hyper는 메시지만 출력 | 실패 |
| lock directory를 만듦 | crudui, hyper | 유지 |
| guard 조건: active 항목, hook 미설치, 변경된 tree, 다른 실행 진행 중, 현재 tree의 기록 | template, crudui, hyper, ordered-json | 유지 |
| Git이 무시하지 않는 untracked 파일이 있으면 거부: 기록은 tree를 가리키는데 tree에는 그 파일이 없음 | ordered-json, 나머지는 추적하는 파일만 봄 | 더 넓은 검사 |
| 한 번에 한 실행: guard가 첫 읽기부터 마지막 쓰기까지 `var/full-run.lock`을 잡음 | template(`var/full-run.json.lock`), crudui(`var/locks/full-run.lock`), hyper와 ordered-json(`var/full-run.lock`) | `holder-lock.mjs`를 통한 `var/full-run.lock`(ordered-json은 `flock` 사용) |
| 기록 `var/full-run.json`: tree, commit, result, target별 status·시각·경과 시간, reruns | orm 제외 전체 | 유지, process 전용 파일에 쓰고 rename |
| 끝나지 않은 기록이 process를 적음, 실행 중인 process가 있으면 거부 | template, crudui, hyper, ordered-json | 기록에 process 시작 시각도 적어 재사용된 process ID가 이후 실행을 영구히 막지 않음(네 구현의 결함) |
| `rerun-failed`는 현재 tree에서 통과하지 못한 target(failed, running, pending)을 다시 실행 | template, crudui, hyper, ordered-json | 유지 |
| tree 말고 실행의 또 다른 입력: dependency의 commit | hyper | `--key name=value`, 기록에 `keys`를 두고 run과 rerun은 같은 keys를 요구 |
| 실패한 target은 마지막 출력 20줄을 기록에 두고 출력 | hyper | 유지 |
| `make -k <target>`과 target별 log `var/report/full-run/targets/<target>.log`, 마지막 줄바꿈이 없는 출력 다음 줄은 column 0에서 시작 | template(`-k`, log), hyper(column 0, 마지막 줄) | 유지 |

### 버린 동작

| 동작 | 출처 | 이유 |
|---|---|---|
| pull request, merge queue, merge group, ruleset을 말하는 문구(`REASON`, workflow `push-gate.yml`의 trigger, 필수 check `push-gate`) | template, crudui, hyper, ordered-json, orm | 0.x 정책에는 그것들이 없음, `commit <rev>`는 hook이 없는 checkout의 push를 위해 남김 |
| `push-gate.mjs`의 `hooks-check` mode와 `push_gate.py`의 `hooks-install` | template, crudui, hyper, ordered-json, orm | hook은 `git-hooks.mjs`의 몫, make target은 이름을 유지 |
| command line(`sh -c <text>`)이나 `--` 뒤의 인자 묶음인 target | crudui, ordered-json | 기록 이름과 log 경로는 안정된 단어여야 함, 저장소는 command를 make target으로 감쌈 |
| committed tree의 새 clone에서 `make install`과 clone 안의 marker로 실행 | crudui | 저장소의 install command와 저장소 이름이 붙은 marker가 필요, 필요한 저장소는 clone하는 target을 만듦 |
| 실행 전 conformance evidence directory 초기화 | crudui | 저장소 전용 |
| 기록의 `environment`(toolchain 버전)와 보고서의 `summary.md` | template, crudui | toolchain command는 저장소 data, K8.1이 target report와 toolchain 기록을 합침 |
| 기록된 commit 이후 바뀐 path로 rerun target 선택, 후손 commit에서의 rerun, status `not-run`과 `crashed`, preflight `decide`, `claim`과 `recorder` 인터페이스, `.runtime/`의 기록 | orm | orm만 가지며 K8의 owner check를 읽음, 나머지 넷은 같은 tree의 rerun에 합의 |
| `full_run.py`의 `flock` guard | ordered-json | `holder-lock.mjs`로 대체, 모든 도구는 Node |
| `user-lock-file`과 `checkoutLockFile` | crudui | lock 경로에 저장소 이름이 있음, 호출자가 절대 경로를 넘김 |
| `test-progress`의 진행 줄 | crudui | crudui의 module, gate는 단계마다 한 줄을 출력 |
| `scripts/git/check.mjs`(commit subject 형식, `commit-msg` hook)와 `scripts/checklist/check.mjs`의 marker·우회 문구 규칙 | orm | gate가 아님, hook은 `hooks`에 적고 문서 규칙은 K7의 몫 |
