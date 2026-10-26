<!-- doc-id: local-links -->
<!-- source-sha256: d99609826f6c8c28acc3192cb86ccadc1d6ac6a41ee0b9117419295c309b7295 -->
# 0.0.x 개발의 로컬 링크

[English](local-links.md)

## 상태와 범위

소유자가 2026-10-15에 결정했고 시행 중입니다. 사용자는 2026-10-22에 link 형식을 판정했습니다(K448). polyspec 저장소와 consumer의 모든 개발 checkout, 즉 한 workspace 폴더에 나란히 있는 `polyspec/`과 `consumer/` 폴더에 polyspec 버전이 0.0.x인 동안 적용됩니다.

## 결정

로컬 개발은 필요한 polyspec 저장소의 최신 source를 native package manager로 연결해 사용합니다. release는 의존성과 release 검사가 준비되면 독립적으로 진행하며, consumer가 kit 변경을 필요로 하면 kit을 먼저 release합니다. release 뒤에도 로컬 source 연결은 유지할 수 있습니다. CI는 각 앱의 manifest와 lock에 기록한 정확한 배포 버전의 의존성을 설치합니다.

- 앱이 dependency 선언과 lock을 소유합니다. package manager가 호환되는 requirement를 해석하고 설치 record, link, 생성 metadata를 관리합니다.
- kit은 native 명령을 실행하고 선언 누락이나 호환되지 않는 requirement를 보고합니다. 제약을 우회하거나 버전을 만들거나 설치 metadata를 수기로 맞추지 않습니다.
- 로컬 설치 상태와 release 설치 상태는 구분합니다. 선택한 Composer 개발 manifest에는 자체 native lock이 있으며 실제 로컬 dependency를 나타내야 합니다.

## 방식

link 도구는 native package-manager 명령을 실행합니다. npm은 선택한 provider의 전이 local npm dependency를 따라가고 각 provider에서 `npm link`를 실행한 다음 workspace 처리를 끈 상태로 consumer에서 `npm link <name>...`을 실행하며, `var/link/npm` 아래 project-local npm prefix를 사용합니다. 이 방식은 workspace override 때문에 npm이 local source dependency의 release URL을 해석하는 일을 막습니다. 선택한 모든 설치 package가 이미 source로 resolve되면 consumer 재해석을 생략합니다. `--no-save --package-lock=false`는 release manifest와 lock을 유지하고, 설치 link와 record는 npm이 관리합니다. source 수정은 즉시 반영됩니다. npm의 dependency 처리와 lifecycle 동작은 그대로 유지합니다. Composer와 Python도 아래 native 방식을 사용합니다.

Composer 로컬 개발은 앱이 선언한 `path` repository와 호환되는 requirement를 사용합니다. 기본 `composer.json`이나 명시적으로 선택한 `COMPOSER=composer.local.json`을 Composer가 읽고, 해당 manifest의 lock, 설치 record, link, autoload를 함께 관리합니다. kit는 임시 manifest, version alias, 별도 runtime metadata를 만들지 않습니다. `composer update <로컬 package> --with-dependencies`는 선택한 개발 lock과 전이 dependency를 변경할 수 있으며 실행 전에 그 사실을 출력합니다. release manifest와 lock은 별도 release 설치의 입력이며 개발 source metadata로 위장하지 않습니다.

| 생태계 | Native source 연결 |
|---|---|
| npm | `npm link`가 `node_modules/<name>`을 project-local npm prefix를 거쳐 provider에 연결하며 link와 설치 record는 npm이 관리합니다 |
| Composer | 선언된 path repository에서 Composer가 source link를 만들며 `COMPOSER`, `COMPOSER_VENDOR_DIR`를 따르고 선택한 lock과 autoload를 관리합니다 |
| Python | `uv sync --locked`가 앱이 선언한 path/workspace source를 설치하며 uv가 editable metadata를 관리하고 `uv pip check`가 설치된 distribution을 검사합니다 |
| Go | 각 Go module에 git이 무시하는 `go.work`. module과 provider module의 `use` 줄을 가집니다 |
| Rust | `link.mjs cargo <dir> <cargo args>`가 `--config` `[patch]` 항목과 `var/link/cargo` 아래 lock 사본으로 cargo 명령 하나를 실행합니다 |

- checkout의 모든 tracked 프로젝트를 link하며, hyper의 `examples/board`처럼 root 아래의 중첩 프로젝트도 포함합니다(K447). 테스트, fixture, release consumer는 시험하는 설치를 그대로 둡니다.
- provider: 인자로 준 main checkout, 없으면 저장소 옆의 checkout(`--siblings`)에 있는 패키지의 각 tracked manifest, 그리고 workspace의 `forks/`에 있는 fork(K379)입니다. checkout 자신의 패키지는 같은 저장소의 main checkout이 아니라 자기 폴더로 link됩니다.
- `make npm-install`은 `npm ci` 뒤 native link를 실행하며 `ADD`로 새 provider를 명시적으로 연결합니다. `make composer-install`은 설치 전에 선언된 local provider를 해석하고 선택한 개발 lock이 없으면 생성하며 있으면 선택한 provider를 갱신합니다. `make uv-install`은 앱의 native source/workspace 선언을 따르는 `uv sync --locked`에 한 번 위임합니다. Python 개발 lock이 없거나 오래됐으면 native `uv lock`으로 준비해야 합니다. legacy Python folder link에는 metadata 수정 대신 새 native environment가 필요합니다.
- kit은 link 중 build target을 실행하지 않습니다. native package-manager lifecycle hook은 정상 동작을 유지합니다. 별도 provider build는 자체 target을 사용합니다.

## 검증

`make link-state-check`(K305-1, P30)는 native npm, Composer, Python 설치를 통해 제공된 source가 예상 checkout으로 resolve되는지 검사하고 workspace link, `go.work`, Claude Code hook을 검증합니다. `make link-check`는 개발 보조로 불일치를 나열합니다. dependency 호환성은 각 native package manager가 판단합니다. release CI는 로컬 provider 탐색 대신 선언된 배포 dependency를 사용합니다.

Source 개발 계약은 배포된 dependency와 같은 version의 source 수정, release보다 앞선 source checkout, 배포 이력이 없는 새 provider를 포함합니다. Native package metadata는 유효해야 하며 release가 없다는 이유로 package manager의 metadata 요구를 생략하지 않습니다. 앱이 호환되는 개발 requirement와 local source를 선언하며 source 사용에 tag나 배포 archive는 필요하지 않습니다. Cargo의 exact-version requirement는 patch 선택을 막을 수 있으므로 wrapper는 native workspace metadata를 검사하고 필요한 개발 source 대신 release가 선택되면 거부합니다. 이 검사 전에 선언한 path patch를 사용해 복사한 lock에 이미 있는 sibling crate 이름만 대상으로 native `cargo update --offline`을 실행합니다. 이후 metadata와 요청 명령은 `var/link/cargo` 아래 생성된 lock을 사용하며 tracked manifest와 lock은 바뀌지 않고 다른 package의 전역 갱신도 요청하지 않습니다. Cargo source 검사는 `-p`로 선택한 package에만 한정되지 않고 workspace resolution을 대상으로 합니다.

같은 선언 입력으로 두 번 실행하면 source 선택, manifest, lock, 설치 record가 같아야 하며 log와 timestamp는 이 상태에 포함하지 않습니다. Provider 코드 수정에 relink는 필요 없지만 compiled code에는 native build가 필요합니다. 명시적 `unlink`는 앱이 선택한 native lock 상태를 복원하고 생성한 Go workspace를 제거하며 앱이 소유한 local source 선언을 삭제하지 않으므로 복원 상태에도 native editable이 있을 수 있습니다. Release 설치는 release 선언과 lock을 사용합니다.

## Worktree

- worktree branch는 `main`에서 만든 `<type>/<name>-<id>`이고(P10) `make land`로 `main`에 들어갑니다. 도구는 main checkout에서 재사용합니다. npm dependency는 공유하며 저장소 자신의 workspace package는 worktree source에 연결합니다(K530). 각 Composer 프로젝트는 main 설치로의 link가 있는 실제 vendor 폴더와 오프라인 `composer dump-autoload`로 만든 자체 출력을 가집니다(K521).
- Python environment는 `uv venv`로 만들고 main checkout의 cache 입력에서 `uv pip install --offline`으로 채웁니다(K657-4). native `uv pip freeze`의 requirement를 `var/worktree-python` 아래에 두며 main checkout 내부 editable 경로는 uv 설치 전에 대응하는 worktree source로 바꿉니다. script, editable metadata, 설치 record는 uv가 만듭니다. cache 입력이 없으면 main checkout에서 준비하라는 안내와 함께 실패하며 setup은 다운로드하지 않습니다. 기존 legacy environment는 수정하지 않고 보존한 채 거부합니다.
- `make worktree-setup`은 이 dependency를 준비하고 worktree를 검사합니다. kit.mk와 kit 도구는 worktree 자신의 `mise.toml`과 main checkout의 `var/tools`를 사용합니다. 일반 `make install`과 `make install-tools`는 worktree에서 계속 거부하며 native offline Python 준비는 worktree setup의 일부입니다.
- `make worktree-link-state`는 같은 link 준비를 하고 product package를 rebuild하지 않은 채 `link-state-check`를 실행합니다. worktree의 목적이 link state 검사일 때 사용하며 검사를 건너뛰지는 않습니다. `make worktree-setup`은 검사 전 rebuild를 계속 수행합니다.
- worktree-setup은 main checkout의 읽기 전용 `var/composer-artifacts` repository를 공유합니다(K622). Python environment는 자체 editable package가 worktree source를 실행해야 하므로 main environment로 가는 단일 directory link일 수 없습니다. make timestamp stamp는 새 checkout을 건너 이어질 수 없으며 거기서 유효해야 하는 stamp는 내용으로 판단합니다.
- `main`은 `make land`와 pre-commit hook을 통과한 commit만 씁니다(K495). 두 번째 land는 첫 번째의 lock을 기다리고, `main`보다 뒤처진 branch는 그 worktree에서 rebase되며, `main`의 수동 merge, reset, update-ref는 reference-transaction hook이 거부합니다.
- worktree와 branch는 branch가 `main`에 merge되면 바로 지웁니다. `make land`는 land한 branch를 지우고, `main`이 포함한 branch의 다른 깨끗한 worktree 중 process가 없는 것도 모두 지웁니다. process가 아직 실행 중인 worktree는 다음 land까지 남습니다(K626).

## 알려진 영향

- 로컬 설치 record는 native package manager가 실제 설치한 dependency를 나타냅니다. Composer 개발 record와 autoload는 선택한 로컬 source와 일치해야 하며 release CI의 record는 배포 package를 나타냅니다.
- Node는 module 파일의 import를 그 실제 경로에서 resolve하므로, link된 npm 패키지는 자신의 의존성을 provider checkout의 `node_modules`에서 찾습니다.
- PHP C extension은 link되지 않습니다. build된 공유 library가 필요합니다.

## 소유

각 앱은 로컬 dependency 선언과 선택한 개발 lock을 소유합니다. provider checkout은 source와 native build 입력을 제공합니다. kit은 package manager를 실행하고 생성된 source 연결을 검증합니다.

## 종료

consumer는 정상 package manager를 통해 배포 dependency를 채택하고 바뀐 manifest와 lock을 commit합니다. 로컬 source 개발은 독립적으로 계속할 수 있으며 release 채택에 모든 checkout의 동시 unlink가 필요하지 않습니다.
