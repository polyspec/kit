<!-- doc-id: local-links -->
<!-- source-sha256: 6e81b7650b37cda8f13bc64fddd6c03fe1a67e81e8ddc846393d0517b42d4abf -->
# 0.0.x 개발의 로컬 링크

[English](local-links.md)

## 상태와 범위

소유자가 2026-10-15에 결정했고 시행 중입니다. 사용자는 2026-10-22에 link 형식을 판정했습니다(K448). polyspec 저장소와 consumer의 모든 개발 checkout, 즉 한 workspace 폴더에 나란히 있는 `polyspec/`과 `consumer/` 폴더에 polyspec 버전이 0.0.x인 동안 적용됩니다.

## 결정

개발은 각 polyspec 저장소의 최신 소스를 기준으로 완료합니다. 모든 저장소의 개발이 끝날 때까지 아무것도 release하지 않습니다. kit을 포함해 어떤 저장소에서도 tag, 버전 올림, release workflow 실행이 없습니다. push는 백업이며 아무것도 게시하지 않습니다. kit의 변경은 `make build` 뒤 link를 통해 다른 checkout에서 보입니다.

- polyspec 패키지는 release로 설치된 것으로 봅니다. 각 tracked manifest와 lock은 package manager가 쓴 release 기록을 유지하며, 저장소의 lock은 그 한 번의 설치 기록입니다.
- 로컬 source dependency는 provider checkout에 연결된 상태를 유지합니다. npm은 `npm link`로 link를 관리합니다. Composer와 Python의 직접 folder link는 package manager로 교체 중인 legacy 동작입니다(K657).
- 어떤 link나 설치 단계도 버전, 제약, provider 버전을 판단하지 않습니다. kit은 버전도 pin도 강제하지 않습니다(S4). 각 package manager와 그 lock이 버전을 정합니다.
- release는 개발이 완료된 뒤 의존 순서대로 한 번에 합니다: kit → ordered-json → orm, template → crudui → hyper → fsm, template-benchmark.

이유: 각 저장소가 다른 저장소의 release를 기다리고 그것이 또 다른 저장소를 기다리면서 개발이 멈췄고, package manager를 거친 link는 link 안에서 버전을 다시 해석하고 거부했습니다. 폴더 link는 버전을 읽지 않으므로 변경이 모든 consumer에 바로 보입니다.

## 방식

link 도구는 native package-manager 명령을 실행합니다. npm은 각 provider에서 `npm link`를 실행한 다음 consumer에서 `npm link <name>...`을 실행하며, `var/link/npm` 아래 project-local npm prefix를 사용합니다. `--no-save --package-lock=false`는 release manifest와 lock을 유지하고, 설치 link와 record는 npm이 관리합니다. source 수정은 즉시 반영됩니다. npm의 dependency 처리와 lifecycle 동작은 그대로 유지합니다. Composer와 Python은 K657 전환을 마칠 때까지 아래 legacy 방식을 사용합니다.

link된 Composer package의 requirement가 설치된 release metadata와 다르면 Composer가 requirement를 일치시킵니다. `var/link/composer/` 아래 실행별 manifest와 lock은 추적 release record를 보존하고 link된 package의 path repository를 추가합니다. Composer는 network access, script와 plugin을 비활성화하고 해당 package만 update한 뒤 해석한 runtime metadata를 설치합니다. 외부 package record는 바뀌지 않아야 합니다. Composer의 platform 검사를 유지하며, metadata가 일치하는 두 번째 link는 Composer 명령을 실행하지 않습니다. 실행은 `finally`에서 임시 manifest와 lock을 제거하며 vendor metadata를 변경하는 동안 lease를 보유합니다.

| 생태계 | link가 되는 설치 폴더 |
|---|---|
| npm | `npm link`가 `node_modules/<name>`을 project-local npm prefix를 거쳐 provider에 연결하며 link와 설치 record는 npm이 관리합니다 |
| Composer | 각 tracked Composer 프로젝트의 `<vendor-dir>/<vendor>/<package>`, `composer.json`의 `config.vendor-dir`(없으면 `vendor`) |
| Python | 프로젝트 `.venv`의 `site-packages`에 있는 각 패키지. provider의 패키지 폴더로 가는 symlink 하나입니다. 한 namespace의 패키지(`polyspec/orm`, `polyspec/ordered_json`)는 따로 link됩니다. uv-install의 uv sync는 link된 각 패키지를 `--inexact --no-install-package <이름>`으로 건너뛰어 uv가 link를 통해 쓰지 않게 합니다. `--no-install-package`만 쓰면 uv가 link를 통해 패키지를 제거합니다(K592) |
| Go | 각 Go module에 git이 무시하는 `go.work`. module과 provider module의 `use` 줄을 가집니다 |
| Rust | `link.mjs cargo <dir> <cargo args>`가 `--config` `[patch]` 항목과 `var/link/cargo` 아래 lock 사본으로 cargo 명령 하나를 실행합니다 |

- checkout의 모든 tracked 프로젝트를 link하며, hyper의 `examples/board`처럼 root 아래의 중첩 프로젝트도 포함합니다(K447). 테스트, fixture, release consumer는 시험하는 설치를 그대로 둡니다.
- provider: 인자로 준 main checkout, 없으면 저장소 옆의 checkout(`--siblings`)에 있는 패키지의 각 tracked manifest, 그리고 workspace의 `forks/`에 있는 fork(K379)입니다. checkout 자신의 패키지는 같은 저장소의 main checkout이 아니라 자기 폴더로 link됩니다.
- 설치는 package manager 자신의 것이며 tracked lock을 그대로 씁니다. `make npm-install`은 `npm ci`, `make composer-install`은 `composer install`, `make uv-install`은 `uv sync --frozen`을 실행하고, 각각 그 뒤 폴더를 link합니다. 설치는 link를 복사본으로 바꾸므로, 설치 뒤에는 `make link`를 다시 실행합니다.
- build 없음: `link`는 link만 합니다. provider는 `link.mjs rebuild <repository>...`나 자기 target이 build합니다.

## 검증

`make link-state-check`(K305-1, P30)는 모든 저장소의 gate입니다. 제공되는 패키지 폴더가 복사본이거나 provider가 아닌 곳을 가리키면 실패합니다. sibling이 제공하는 polyspec 패키지를 release 기록 대신 path나 link로 적은 tracked lock(K507. release tarball을 가리키는 `file:` 항목은 release 기록이며, 저장소 자신의 패키지는 당연히 path입니다), 잘못된 workspace link, `go.work`, Claude Code hook에서도 실패합니다. 버전과 요구사항은 판단하지 않습니다. `make link-check`는 복사본이거나 다른 곳을 가리키는 제공 폴더를 나열합니다.

## Worktree

- 사용자는 2026-10-22에 worktree는 아무것도 설치하지 않는다고 판정했습니다. worktree는 도구와 의존 폴더(`var/tools`, `node_modules`)를 main checkout의 것으로 link합니다. worktree branch는 `main`에서 만든 `<type>/<name>-<id>`이고(P10) `make land`로 `main`에 들어갑니다. worktree의 Composer vendor 폴더는 패키지, `bin`, installed 기록을 main checkout의 것으로 link한 진짜 폴더이며, `composer dump-autoload`가 오프라인으로 쓰는 자기 autoload를 가집니다. autoload는 그것을 쓴 checkout의 소스를 가리키기 때문입니다(K521).
- `make worktree-setup`은 worktree를 만들고, main checkout의 패키지로 link하되 저장소 자기 workspace 패키지는 worktree 안으로 link한 `node_modules`를 주며(K530), main checkout이 설치한 다른 각 npm 프로젝트와 main checkout의 각 Python `.venv`에도 같게 하되 그 script, activate 파일, editable `.pth` 파일은 worktree의 경로로 쓰고(K533), 각 Composer 프로젝트에 link로 된 vendor 폴더와 자기 autoload를 주고(K521), 아무것도 설치하지 않습니다(K519). 도구에는 link가 필요 없습니다. worktree에서 kit.mk와 kit의 도구는 main checkout의 `var/tools`(mise의 data dir, install, shim과 `var/tools/bin`)를 worktree 자신의 `mise.toml`과 함께 씁니다. worktree에서 `make install`과 `make install-tools`는 거부됩니다.
- `make worktree-link-state`는 같은 link 준비를 하고 product package를 rebuild하지 않은 채 `link-state-check`를 실행합니다. worktree의 목적이 link state 검사일 때 사용하며 검사를 건너뛰지는 않습니다. `make worktree-setup`은 검사 전 rebuild를 계속 수행합니다.
- worktree-setup은 main checkout의 `var/composer-artifacts`, 곧 `composer.json`이 이름 붙인 artifact repository를 하나의 directory symlink로 link합니다. Composer는 그것을 읽기만 하기 때문입니다(K622). symlink가 worktree에 할 수 없는 일이 둘 있습니다. Python `.venv`는 main checkout의 것으로 가는 하나의 directory symlink일 수 없습니다. 그러면 저장소 자기 패키지의 editable install이 main checkout의 소스를 실행하므로, 그 항목들을 link합니다(K533). make의 timestamp stamp는 새 checkout을 건너 이어질 수 없습니다. worktree에 checkout된 파일은 main checkout의 모든 stamp보다 새로우므로 시간을 비교하는 target은 worktree에서 다시 실행되며, 거기서 유지되어야 하는 stamp는 내용으로 판단합니다.
- `main`은 `make land`와 pre-commit hook을 통과한 commit만 씁니다(K495). 두 번째 land는 첫 번째의 lock을 기다리고, `main`보다 뒤처진 branch는 그 worktree에서 rebase되며, `main`의 수동 merge, reset, update-ref는 reference-transaction hook이 거부합니다.
- worktree와 branch는 branch가 `main`에 merge되면 바로 지웁니다. `make land`는 land한 branch를 지우고, `main`이 포함한 branch의 다른 깨끗한 worktree 중 process가 없는 것도 모두 지웁니다. process가 아직 실행 중인 worktree는 다음 land까지 남습니다(K626).

## 알려진 영향

- package manager는 여전히 release 버전을 기록합니다(lock 파일, Composer의 `installed.json`). 이것은 위의 release 기록이며 결함이 아닙니다.
- Node는 module 파일의 import를 그 실제 경로에서 resolve하므로, link된 npm 패키지는 자신의 의존성을 provider checkout의 `node_modules`에서 찾습니다.
- PHP C extension은 link되지 않습니다. build된 공유 library가 필요합니다.

## 소유

`link-owner` 세션이 link를 소유하고 registry `polyspec/scratch/link/REGISTRY.md`를 관리합니다. 각 세션, 그 폴더, link 상태를 적습니다. 다른 세션은 자기 폴더에서 link를 실행하고 `link.mjs check`를 보고합니다.

## 종료

개발이 완료되면 모든 checkout의 link를 풀고, 모든 저장소가 새 release로 의존성을 한 번 가져오며, 이 문서를 닫습니다.
