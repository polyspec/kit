<!-- doc-id: local-links -->
<!-- source-sha256: cc7e3d903efa8fa0770b092f4553652e5400f66d05481029244bebbd3b036f4a -->
# 0.0.x 개발의 로컬 링크

[English](local-links.md)

## 상태와 범위

소유자가 2026-10-15에 결정했고 시행 중입니다. 사용자는 2026-10-22(K448)과 2026-10-29(K761)에 link 형식을 판정했습니다. polyspec 저장소와 consumer의 모든 개발 checkout, 즉 한 workspace 폴더에 나란히 있는 `polyspec/`과 `consumer/` 폴더에 polyspec 버전이 0.0.x인 동안 적용됩니다.

## 결정

사용자 규칙(2026-10-29): 개발 시에는 polyspec 패키지의 정식 설치 폴더와 개발 폴더를 연결하므로, 설치 폴더는 개발 checkout으로 가는 디렉터리 심링크 하나입니다. 설치 폴더를 거친 수정은 checkout의 수정이고 거기서 push할 수 있습니다. 릴리즈 시에는 정식 설치본을 사용합니다. release는 의존성과 release 검사가 준비되면 독립적으로 진행하며, consumer가 kit 변경을 필요로 하면 kit을 먼저 release합니다. release 뒤에도 로컬 source 연결은 유지할 수 있습니다. CI는 각 앱의 manifest와 lock에 기록한 정확한 배포 버전의 의존성을 설치합니다.

- 앱이 dependency 선언과 lock을 소유합니다. package manager가 잠긴 release를 설치하고, kit이 설치된 각 polyspec 패키지 폴더를 디렉터리 심링크 하나로 바꿉니다. link를 위해 package manager가 consumer를 다시 해석하지 않습니다(K761).
- polyspec 패키지는 모든 checkout에서 link이고, 제3자 패키지는 각 checkout 자신의 lock에서 옵니다. 모든 checkout이 자기 install 뒤 자기 `make link`를 실행하므로 provider의 polyspec 의존성도 link입니다.
- 개발 중 각 polyspec 패키지의 설치 폴더(node_modules, vendor, site-packages)는 checkout으로 가는 평범한 디렉터리 심링크 하나입니다. 패키지 매니저의 링크 단계(npm link, Composer path repository, pip/uv editable)는 쓰지 않습니다(PRINCIPLES S11).
- kit은 설치 누락과 복사본을 보고합니다. 제약을 우회하거나 버전을 만들거나 설치 metadata를 수기로 맞추지 않습니다.

## 설치와 검증의 경계

| Mode | Native 계약과 범위 |
|---|---|
| Release 설치 | 설치 package bootstrap은 npm ci 같은 native locked 설치를 사용하며 sibling checkout이 선행 조건이 아니다. Composer는 선택한 release manifest와 lock을 설치한다. |
| npm, Composer, Cargo | kit은 설치를 감싸지 않는다(K859). 각 저장소는 자기 `deps-<runtime>` target에서 package manager의 lock 설치(`npm ci`, `composer install`, `cargo fetch --locked`)를 실행하고, 그 뒤 `make link`가 설치된 각 provider 폴더를 link한다. |
| Python source helper | uv-install은 tracked lock의 `uv sync --locked`를 실행한 뒤 site-packages에 설치된 provider 패키지 폴더를 각 checkout의 같은 패키지로 link한다. 설치 record는 release의 dist-info이며 editable build와 build backend는 실행하지 않는다(K765). `uv pip check`가 설치 distribution을 검증한다. |

link-check는 source 연결을 설명하며 모든 version과 peer dependency를 해석하는 공통 solver가 아니다. peer 검증이 필요하면 native 진단은 npm ls --all이다. Kit 전용 resolver나 위장된 설치 version으로 불일치를 보정하지 않는다. Composer와 uv 실패도 숨기지 않는다.


Provider는 변경된 dependency와 build 입력을 자신의 package manager로 설치한다. 이미 올바른 source link를 재사용해도 새 외부 provider dependency를 설치하거나 lifecycle을 다시 실행하지는 않는다. Source 수정은 새 release 없이 보이며 컴파일 산출물은 native build가 필요하다.

독립 runtime job은 `make link RUNTIME=<runtime>`을 실행한다(`go`, `php`, `php-ext`, `python`, `rust`, `ts`). 선택자는 provider 탐색, link와 설치 source 검증을 해당 runtime으로 제한한다. TypeScript는 npm 폴더, PHP와 PHP extension은 Composer vendor 폴더를 link하고 Python은 site-packages 패키지 폴더를 link하고 Go는 workspace를 사용하며 Rust는 기존 Cargo source patch 경로를 유지한다. 기본 `make link`와 parity job은 선언한 모든 ecosystem을 유지한다.

## 방식

link 도구는 provider가 제공하는 polyspec 패키지의 설치된 npm·Composer 폴더를 각각 provider 패키지 폴더로 가는 상대 디렉터리 심링크 하나로 바꿉니다(K591, K761). 이를 위해 package manager를 실행하지 않습니다. `npm link`, `var/link/npm` 아래 npm prefix와 cache, Composer path repository, `composer update`가 없습니다. 그래서 consumer manifest의 override나 release URL을 다시 해석하지 않습니다. 이미 provider를 가리키는 link는 그대로 두고, 복사본이나 다른 곳을 가리키는 link는 바꿉니다. 선언됐지만 설치 폴더가 없는 polyspec 패키지는 install이 실행되지 않았거나 실패했다는 뜻이므로 link가 보고하고(K529) 아무것도 만들지 않습니다. `var/platforms/*`처럼 consumer 자신의 폴더를 가리키는 `file:` 의존성은 polyspec provider가 아니므로 그대로 둡니다.

Composer가 생성한 autoload는 `vendor/<vendor>/<package>/src`를 가리키며 link를 거쳐 checkout을 읽습니다. source 수정은 바로 보입니다. provider가 autoload 규칙을 바꾸면 새 class map 항목은 소유자의 `composer dump-autoload`가 필요합니다.

| 생태계 | Native source 연결 |
|---|---|
| npm | `node_modules/<name>`은 `npm ci` 뒤 쓴, provider로 가는 상대 디렉터리 심링크 하나입니다 |
| Composer | `<vendor-dir>/<vendor>/<package>`는 `composer install` 뒤 쓴, provider로 가는 상대 디렉터리 심링크 하나이며 `COMPOSER`, `COMPOSER_VENDOR_DIR`를 따릅니다 |
| Python | `<site-packages>/<package path>` -> provider source root 아래 같은 package path, namespace의 package마다 link 하나입니다. uv가 lock을 먼저 설치하고, uv는 link를 거쳐 쓰므로 모든 uv 쓰기 전에 이 link를 제거합니다(K539). environment가 없는 project는 아직 설치되지 않았으므로 `make link`는 그것을 빼고 environment를 만들지 않습니다(K689-3, K888) |
| Go | 각 Go module에 git이 무시하는 `go.work`. module과 provider module의 `use` 줄을 가집니다 |
| Rust | `link.mjs cargo <dir> <cargo args>`가 `--config` `[patch]` 항목과 `var/link/cargo` 아래 lock 사본으로 cargo 명령 하나를 실행합니다 |

- checkout의 모든 tracked 프로젝트를 link하며, hyper의 `examples/board`처럼 root 아래의 중첩 프로젝트도 포함합니다(K447). 테스트, fixture, release consumer는 시험하는 설치를 그대로 둡니다.
- link 선언(K869): main checkout 루트의 git-ignored 파일 `.links`가 provider checkout을 한 줄에 하나씩, 그 루트 기준 상대 경로로 지정합니다. 빈 줄과 `#`로 시작하는 줄은 무시합니다. worktree는 자기 main checkout의 파일을 읽습니다. 파일이 없으면 checkout은 릴리즈 상태입니다. 아무것도 link하지 않으며, `make link`는 `make unlink`처럼 이전 선언이 만든 link를 제거하고 그다음 `make install`이 배포된 패키지를 복원합니다. `make link`는 파일을 적용하며 멱등입니다. 선언된 folder는 각각 자기 link가 되고, checkout 밖으로 link되며 파일이 지정하지 않은 패키지 폴더는 제거됩니다. checkout 안을 가리키는 link는 npm과 Composer의 workspace link처럼 남습니다. K773이 추적 manifest가 저장소 밖 경로를 지정하지 못하게 하기 때문입니다. bin link도 남습니다.
- provider: 선언된 checkout에 있는 패키지의 각 tracked manifest입니다. checkout 자신의 패키지는 같은 저장소의 main checkout이 아니라 자기 폴더로 link됩니다.
- package manager의 lock 설치가 먼저 실행되고 그 뒤 `make link`가 link를 씁니다(K859). `make uv-install`은 lock의 `uv sync --locked` 뒤 link를 씁니다. Python 개발 lock이 없거나 오래됐으면 native `uv lock`으로 준비해야 합니다.
- kit은 link 중 build target을 실행하지 않습니다. native package-manager lifecycle hook은 정상 동작을 유지합니다. 별도 provider build는 자체 target을 사용합니다.

## 검증

`make link-check`(K305-1, P30, K869)는 link를 link 선언에 맞춰 검사합니다. 선언된 provider의 설치된 npm·Composer·Python 패키지 폴더가 각각 checkout으로 가는 link인지, 선언이 지정하지 않은 바깥으로 가는 link가 없는지, 각 `go.work`가 module과 그것이 require하는 선언된 provider만 정확히 쓰는지(선언이 없으면 없음), 추적되는 package.json, composer.json, pyproject.toml이 패키지와 상관없이 텍스트상 저장소 밖 경로(npm `file:`이나 `link:` 의존성, Composer path repository, uv source path)를 지정하지 않는지(깨끗한 클론과 CI가 재현하지 못하므로, K773, K902; 저장소 안의 경로는 개발에서는 sibling checkout으로 가는 link를, CI에서는 복사본을 담는 git-ignored 폴더처럼 저장소가 어떻게 채우든 저장소 자신의 폴더이므로 어디로 resolve되는지 판단하지 않음, K976), `.links`가 git-ignored인지 검사합니다. link는 Claude Code 설정을 쓰지 않습니다(K960). `make link`는 link 다음에 같은 프로세스에서 `make hook`의 hook을 쓰고(K967), `make hook`은 kit checkout의 Claude Code hook을 checkout 최상위의 `.claude/settings.local.json`(K498)에, 저장소가 무엇을 무시하든(K966), `PROJECT`가 없으면 workspace 폴더, 곧 hook을 실행하는 kit checkout이 있는 폴더의 `.claude/settings.json`(K440)에도 씁니다. container는 link만 실행합니다. 추적된 project가 선언하고 다른 repository의 선언된 checkout이 제공하는 npm, Composer, Python package에 그것을 link하는 설치된 folder가 없으면 finding입니다. `make link`는 installer가 아직 실행되지 않은 project(node_modules, vendor folder, environment가 없음)를 빼므로, 설치가 설치하지 않은 project는 통과하지 않습니다(K888). `.links`가 없으면 검사는 거기서 `make link`가 남기는 release 상태와 비교합니다. 어떤 설치 폴더도 link를 갖지 않으며, uv가 editable로 설치하는 checkout 자체 저장소의 패키지는 link로 요구되지 않습니다(K935). link된 npm provider마다 그 provider가 실행 시 필요한 polyspec 패키지도 실제 경로를 거쳐 한 단계 판단합니다. 거기 있는 복사본은 그 패키지의 두 번째 instance여서 consumer와 provider 사이 `instanceof`가 실패합니다(K761). dependency 호환성은 각 native package manager가 판단합니다. release CI는 로컬 provider 탐색 대신 선언된 배포 dependency를 사용합니다.

Source 개발 계약은 배포된 dependency와 같은 version의 source 수정, release보다 앞선 source checkout, 배포 이력이 없는 새 provider를 포함합니다. Native package metadata는 유효해야 하며 release가 없다는 이유로 package manager의 metadata 요구를 생략하지 않습니다. 미배포 provider도 package manager의 정식 version metadata 또는 version 추론 규칙을 따르며 kit이 version을 만들어 주지 않습니다. 앱이 호환되는 개발 requirement와 local source를 선언하며 source 사용에 tag나 배포 archive는 필요하지 않습니다. Cargo의 exact-version requirement는 patch 선택을 막을 수 있으므로 wrapper는 native workspace metadata를 검사하고 필요한 개발 source 대신 release가 선택되면 거부합니다. metadata와 요청 명령은 `var/link/cargo` 아래 tracked lock의 복사본을 사용하며 그 복사본은 Cargo가 갱신하고 tracked manifest와 lock은 바뀌지 않습니다. Cargo에서 release보다 앞선 checkout은 이 계약의 한계입니다. 소비자의 requirement나 git tag보다 version이 높은 patch는 선택되지 않으며, 거부 메시지는 requirement보다 앞선 provider는 먼저 release한 뒤 요구하고, 뒤처진 provider는 그 checkout을 갱신하라고 알려 줍니다. Cargo source 검사는 `-p`로 선택한 package에만 한정되지 않고 workspace resolution을 대상으로 합니다.

같은 선언 입력으로 두 번 실행하면 source 선택, manifest, lock, 설치 record가 같아야 하며 log와 timestamp는 이 상태에 포함하지 않습니다. Provider 코드 수정에 relink는 필요 없지만 compiled code에는 native build가 필요합니다. 명시적 `unlink`는 link와 생성한 Go workspace만 제거하고 package manager를 실행하지 않습니다. 그 뒤 `make install`이 앱이 선택한 native lock 상태를 복원하며(링크 제거로 패키지 폴더가 빠진 Python 배포본은 uv가 설치된 배포본을 그대로 두므로 다시 설치합니다), 앱이 소유한 local source 선언은 남으므로 복원 상태에도 link된 패키지 폴더가 있을 수 있습니다. Release 설치는 release 선언과 lock을 사용합니다.

## Worktree

- worktree branch는 `main`에서 만든 `<type>/<name>-<id>`이고(P10) `make land`로 `main`에 들어갑니다. worktree는 그 자체로 checkout이며 `var/tools`, dependency tree와 link가 모두 자기 것입니다(K858).
- `make worktree-setup`은 worktree를 만들고 다른 checkout처럼 거기서 온라인으로 `make install`을 실행합니다. `make install`은 `mise.toml`과 `mise.lock`의 도구를 자기 `var/tools`에, lock의 package, 저장소의 단계, link를 설치합니다. 그다음 `make link-check`를 실행합니다. `node_modules`가 없는 worktree는 CI 파이프라인의 clean checkout처럼 먼저 `devEngines.packageManager`가 지정한 npm으로 `npm ci --ignore-scripts`를 실행하므로, 설치된 kit은 `make install-link`가 주는 link, 곧 main checkout의 link 선언이 지정한 kit checkout으로 가는 link를 한 단계 먼저 받으므로, `node_modules`에서 kit을 include하는 Makefile은 live kit을 실행합니다. 선언이 없으면 설치된 릴리즈가 실행됩니다. main checkout의 `var/tools`와 lock은 바뀌지 않습니다. `make install`과 `make install-tools`도 worktree에서 바로 실행됩니다. K858 전에 만든 worktree는 자기 도구를 갖도록 `make install`을 한 번 실행합니다.
- worktree-setup은 main checkout의 `var/`에서 아무것도 worktree로 link하지 않습니다. kit은 package를 내려받지 않으므로 worktree는 다른 checkout처럼 필요한 것을 설치합니다(K865). 설치된 vendor tree를 link하거나 metadata를 합성하지 않습니다(K690). Python environment는 link된 package가 worktree source를 실행해야 하므로 main environment로 가는 단일 directory link일 수 없습니다. make timestamp stamp는 새 checkout을 건너 이어질 수 없으며 거기서 유효해야 하는 stamp는 내용으로 판단합니다.
- `make land`는 branch를 `main`에 fast-forward로 merge합니다(K495). 두 번째 land는 첫 번째의 lock을 기다리고, `main`보다 뒤처진 branch는 그 worktree에서 rebase됩니다.
- worktree와 branch는 branch가 `main`에 merge되면 바로 지웁니다. `make land`는 land한 branch를 지우고, `main`이 포함한 branch의 다른 깨끗한 worktree 중 process가 없는 것도 모두 지웁니다. process가 아직 실행 중인 worktree는 다음 land까지 남습니다(K626).

## Worktree 저장 공간과 전환 (K690)

`var/tools`를 포함한 설치 directory는 worktree마다 독립적입니다(K858). 공유 download cache가 설치 tree 공유를 제공하지는 않습니다. 실측 kit npm·Composer 설치 합계는 worktree당 약 291 MiB, 열 개면 약 2.85 GiB이며 도구, product와 build 출력은 별도입니다. kit 자신의 `var/tools` 도구는 worktree당 약 1.4 GiB입니다. merge된 worktree를 지우며 병렬 설치 비용이 없다고 가정하지 않습니다. Package manager 교체는 필요하지 않습니다.

## 알려진 영향

- 설치 record는 package manager가 설치한 잠긴 release를 나타내며 link는 패키지 폴더만 바꿉니다. release CI의 record는 배포 package를 나타냅니다.
- Node는 module 파일의 import를 그 실제 경로에서 resolve하므로, link된 npm 패키지는 자신의 의존성을 provider checkout의 `node_modules`에서 찾습니다. 그래서 provider도 자기 install과 `make link`를 실행합니다.
- PHP C extension은 link되지 않습니다. build된 공유 library가 필요합니다.

## 소유

각 앱은 dependency 선언과 lock을 소유합니다. provider checkout은 source와 native build 입력을 제공합니다. kit은 link를 쓰고 검증합니다.

## 종료

consumer는 정상 package manager를 통해 배포 dependency를 채택하고 바뀐 manifest와 lock을 commit합니다. 로컬 source 개발은 독립적으로 계속할 수 있으며 release 채택에 모든 checkout의 동시 unlink가 필요하지 않습니다.
