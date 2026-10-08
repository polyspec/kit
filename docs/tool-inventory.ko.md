<!-- doc-id: tool-inventory -->
<!-- source-sha256: a731a2bde12ba971c5310da9ba18d4b602d60946e8dd10eaf19c8126c82b7efb -->
<!-- source-sha256: 423420f084740d3b7a1a744f8687d7aab997ade69e7bb796139b9594f0dfe055 -->
<!-- source-sha256: a4dcbbbce0d2e3393d95c817c6cb930790db4f564f7a384fbf898453fff8beba -->
<!-- source-sha256: 933a7cb3966f4ef7c43d7a74b16b43568e7c3734f91ddb3d11dbf214132caa48 -->
<!-- source-sha256: 7ae77d943c7590647b6aed5f3fa90c950a125bf185476539a8e4ec3978e7875e -->
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
## 문서 검사 (K7.1)

`scripts/kit/check-documents.mjs`는 template, crudui, hyper의 `check-documents.mjs`와 ordered-json의 `docs_check.py`를 대체합니다.
어느 Markdown 파일이 문서인지, 체크리스트, status table, changelog는 `config/documents.json`
(`scripts/kit/schema/documents.schema.json`)에 선언합니다. finding은 한 줄 `<file>:<line>:<column>: <rule>: <message>`입니다.

합친 동작(더 넓은 동작을 채택):

| 관심사 | 구현 | kit의 동작 |
|---|---|---|
| 문서 선택 | template, crudui: 고정 목록과 directory; hyper: tracked `*.md`; ordered-json: 모든 문서를 등록하는 manifest | `include`와 `exclude` glob이 고르는 tracked 및 ignore되지 않은 새 Markdown 파일; `.ko.md`는 영어 파일에 대응 |
| 쌍 | 모두: 영어에는 한국어 필요; hyper, ordered-json: 한국어에는 영어 필요 | 양방향 (`pair-missing`) |
| `doc-id` | ordered-json만 | 두 파일이 같은 `<!-- doc-id: id -->`를 한 번씩 가지고, id는 문서 하나를 가리킴 |
| revision | ordered-json만 | 한국어 파일은 `<!-- source-sha256: ... -->`를 한 번 가지고 영어 파일의 sha256과 같음 |
| section identifier | ordered-json (`<a id>` anchor) | anchor가 두 파일에서 같고 한 번씩만 나옴 |
| fenced block | template, crudui, hyper: 내용만; ordered-json: info string과 내용, `~~~`, 닫히지 않은 fence | ordered-json 동작: info string과 내용 비교, 두 fence 문자 지원, 닫히지 않은 fence는 실패 |
| link | 모두: inline link; ordered-json: reference link, autolink, `href`, query, 저장소 밖으로 나가는 link, explicit anchor; template: `.md`, `.ko.md`, `index.md` 후보와 `/` 건너뜀; crudui: `/` 거부 | 모든 link 형식; code는 읽지 않음; anchor는 explicit anchor 또는 heading anchor; static site의 `/`와 확장자 없는 link 동작은 `siteLinks` |
| private path | ordered-json | home directory 경로는 실패 (`private-path`) |
| `{{` | template (VitePress) | `interpolation` glob이 정한 문서에서 fenced block 밖의 `{{`는 실패 |
| checklist, table | template, crudui, hyper | task row, 마지막 cell의 state, marker는 state에만, 그 밖의 줄은 실패; crudui와 hyper의 구분 줄(`:---:`) 허용; ID pattern은 checklist의 `idPattern` |
| checklist, list | orm | `- [o] ID text` 항목, 하위 항목, 이어지는 줄, `[!]`의 `Cause:`와 `Retry:`; 두 형식 모두 한국어 label 허용 |
| checklist 쌍 | template, hyper: 마지막 cell 전체 비교; orm: ID와 state 비교 | task ID와 state marker를 비교; bypass는 각 언어에서 cause와 retry 조건을 적고, 그 글은 번역함 |
| 중복과 빈 checklist | orm, ordered-json | 반복된 task ID와 task가 없는 checklist는 실패 |
| status table | template (두 형식), crudui (6 cell), ordered-json (7 cell) | 설정의 `statusTables`: cell 수, cell별 닫힌 값과 pattern; 영어와 한국어 row는 ID와 닫힌 값이 같음 |
| changelog | orm | `## Unreleased`가 맨 처음에 한 번, 버전 `X.Y.Z`는 최신이 위에 한 번씩, 두 언어의 section이 같음 |

버린 동작:

- template과 crudui의 고정 문서 목록과 ordered-json의 등록 manifest: include glob과 `doc-id` marker가 대체합니다.
- template의 두 번째 status table 형식(5 cell): table의 형식은 하나이고, 호환 계층으로 옛 형식을 유지하지 않습니다.
- 저장소 사실을 읽는 ordered-json의 검사는 그 저장소에 남습니다: implementation, verification, distribution 상태 사이의 관계,
  상태의 근거 record, record와 benchmark 파일, distribution 관찰, tracker 절의 배치 규칙, 하위 저장소로의 재귀.
- changelog section과 `VERSION`의 비교(orm): release 검사가 manifest를 읽어 비교합니다.
- orm의 `scripts/docs`, `scripts/features`는 제품 전용이므로 orm에 남습니다.

## Owner check (K8.1-1)

`scripts/kit/owner-check.mjs`는 template, crudui, hyper의 `owner-check.mjs`와 ordered-json의 `owner_check.py`를 대체합니다.
선언은 `config/owner-checks.json`(`scripts/kit/schema/owner-checks.schema.json`)입니다.

합친 동작:

- glob(`*`, `**`, `{a,b}`), `always` test, 변경된 test 파일을 뜻하는 `$path`, `--paths`, `--base`, `--dry-run`, `--validate`는
  template, crudui, hyper가 같고 그대로 유지합니다.
- check 종류: crudui는 make target, root `package.json`의 script, workspace, package directory를 고릅니다. template과 hyper는
  make target을, ordered-json은 implementation과 이름 붙은 check 둘을 고릅니다. kit은 crudui의 종류를 따릅니다. workspace는 root
  `package.json`의 `workspaces`가 가리키는 directory에서 `test` script가 있는 `package.json`이고, package directory는 그 밖의
  것입니다(crudui는 directory `packages/`를 가정했습니다).
- `variable`(template, hyper)은 rule의 target에 일치한 경로를 make 변수로 넘깁니다.
- target은 `CHECK_TARGETS` 순서(template, hyper)로 정렬하고, 다른 check는 선언 순서(crudui)를 유지합니다.
- full suite target은 recipe가 `full-run.mjs`를 시작하는 target과 `fullSuite`에 적은 target입니다. template의 고정 이름 `check`,
  `rerun-failed`, clean release check는 `fullSuite`의 항목이 됩니다.
- `CHECK_TARGETS`의 모든 target을 고르는 rule은 실패합니다(template). `inputs` 검사는 crudui 형식이고, schema validator가 키가
  자유로운 object를 읽지 못하므로 선언은 `{ check, paths }`의 목록입니다.
- Makefile이 include하는 파일(`include scripts/kit/kit.mk`)의 target도 알려진 target입니다(새 동작).
- node test 파일은 `scripts/kit/run-tests.mjs`로 실행하거나, make target `testTarget`에 `TESTS=<files>`를 넘겨 실행합니다(hyper).
- 고른 check는 모두 끝까지 실행하고 실패를 함께 나열합니다(모든 구현). check에는 시간 제한이 없습니다.

버린 동작:

- ordered-json의 `languages`와 `checks`는 그 저장소의 build를 가리키므로 Makefile의 `targets`가 됩니다. `$module`은 `$path`가
  됩니다. Python test module은 node test가 아니므로 kit 밖에 남습니다.
- crudui의 `useCheckoutNpm`: Makefile이 `var/tools`의 npm을 `PATH` 맨 앞에 두고, 도구는 `PATH`의 `npm`을 시작합니다.
- `inputs`의 key로 쓰던 target 이름(template, hyper): 이름은 crudui처럼 `make <target>`입니다.

## 테스트 실행기 (K8.1-2)

`scripts/kit/run-tests.mjs`는 template, crudui, hyper의 `run-tests.mjs`와 ordered-json의 `test.py`를 대체합니다. 진행 reporter는
`test-progress.mjs`, `node-reporter.mjs`, `vitest-reporter.mjs`이고, `test-load-check.mjs`는 각 node test 파일에 preload되며,
`test-hooks.mjs`는 test의 `setup`과 `teardown` helper입니다.

합친 동작:

- tool: `node`, `vitest`, `go`, `cargo`, `phpunit`(template, crudui); hyper는 첫째, 마지막, `vitest`를 가집니다. 각 test는 시작,
  실행 중 한 줄, 경과 시간과 함께 결과를 출력하고, test마다 자기 timeout(`--timeout`, 기본 30 s)을 가집니다. `node --test`와
  vitest가, 다른 tool은 실행기가 timeout을 적용합니다. 전체 실행, package, 파일에는 시간 제한이 없습니다(모든 구현; crudui의
  `go test -timeout 10m`은 `-timeout=0`으로 바꿉니다).
- pass, fail, timeout인 test가 하나도 없는 실행은 실패합니다. template은 skip한 test도 test로 셌고 hyper와 crudui는 세지 않았으며,
  skip만 한 실행은 아무것도 검증하지 않았으므로 kit은 후자를 따릅니다. reporter는 count를 `KIT_TEST_RESULT`(hyper의
  `HYPER_TEST_RESULT`) 파일에 쓰고, count가 오지 않으면 실행기가 실패합니다.
- test를 하나도 등록하지 않은 node test 파일(crudui)과, module이 모든 test를 등록하기 전에 process가 끝난 파일(crudui
  `load-check`)은 실패합니다. test case를 시작하지 않은 Go package는 skip으로 보고합니다(crudui).
- 실패한 실행의 요약은 tool의 error 줄과 build되지 않은 Go package의 build error를 적습니다(template). timeout 줄은 멈추는
  command를 적습니다(crudui).
- `phpunit`은 `<cwd>/vendor/bin/phpunit` 또는 `COMPOSER_VENDOR_DIR`의 vendor directory(crudui)를 실행하고, extension은
  `--php-extension`(template, hyper의 `--extension`)으로 넘깁니다. 없는 extension은 tool을 시작하기 전에 실패합니다.
- 시작할 수 없는 tool은 command와 고치는 방법과 함께 실패합니다.

버린 동작:

- signal timeout을 쓰는 Python `unittest` 실행(`test.py`): kit은 node test를 실행하므로 ordered-json의 Python test는 실행하지
  않습니다.
- crudui의 conformance record를 쓰는 `recordSuiteRun`과 `run-rust-command.mjs`를 통한 cargo 시작, template의 `tools.mjs`
  vitest 진입점, hyper의 `toolPath`는 저장소 전용입니다. 실행기는 `cargo`와 `go`를 `PATH`에서 시작하고(Makefile이 `var/tools`를
  앞에 둠) vitest는 `node_modules/vitest/vitest.mjs`로 시작합니다.
