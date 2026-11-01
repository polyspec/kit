<!-- doc-id: operations-release -->
<!-- source-sha256: 2f41c494ce280ec47bd98134293d9fc98df9ee58c349c87f934e3004b2f8bb4e -->
# 릴리스

[English](release.md)

kit 릴리스의 절차이며, 규칙은 AGENTS.md의 규칙이다.

kit은 `main`의 commit 중 `ci` 실행이 success로 끝난 commit에 tag `vX.Y.Z`를 붙여 릴리스합니다. `package.json`이 tree의 버전을 가집니다. 저장소는
package-lock의 `@polyspec/kit`을 갱신하고 `make install-packages`와 `make kit-sync`를 실행해 릴리스를 채택합니다.

소비자는 `node_modules/@polyspec/kit/scripts/kit/kit-bootstrap.mk`를 include합니다. 깨끗한 checkout에서 공유 workflow는 `devEngines.packageManager`에 선언된 npm version의 native `npm ci --ignore-scripts`를 checkout 밖의 임시 폴더에서 `--prefix`를 주어 먼저 실행하고(devEngines가 다른 version을 이름하는 폴더에서 npm 11이 실행을 거부하기 때문이다, K938-1) 기존 tool 설치와 package 설치 target을 실행합니다. 옆의 kit checkout을 clone하지 않습니다. 로컬의 `npm link ../kit`은 같은 설치 package path에서 source bootstrap을 사용하며 kit 자체는 자기 source Makefile을 사용합니다.

Kit의 native npm prepack은 source export와 hook bin을 build된 dist path로 바꿉니다. Asset gate는 tag의 kit manifest에 같은 canonical producer 변환을 적용한 뒤 모든 byte를 비교하며 다른 package manifest는 byte-exact를 유지합니다. 기존 packed-consumer 검사는 단일 native pack으로 그 gate를 실행하고 생성된 archive를 설치합니다. Native consumer lock은 개발 lock과 다른 호환 전이 version을 해석할 수 있으므로 npm audit가 두 개의 정확한 locked graph를 모두 검사합니다.

공개 module subpath에는 기존 tool module과 함께 `glob`, `parity-declaration`, `land`, `parity`, `checklist`, `php-extension`이 있습니다. Source checkout에서는 각 경로가 `scripts/kit/<name>.mts`로 해석되고, packed consumer에서는 같은 subpath가 `dist/<name>.mjs`로 해석됩니다. Packed-consumer 검사는 설치한 archive에서 각 공개 subpath를 import하고 export 이름을 source module과 비교합니다.

후속 변경은 앞선 release의 검증 증거를 무효화하지 않습니다. 현재 version은 자기 CI가 통과하면 완료하고 다음 version을 올려 별도로 검증합니다. 로컬 main commit이 자동으로 원격 release에 포함되는 것은 아니므로 원격 candidate와 해당 CI를 확인합니다. 구현 완료와 소유 검사 통과는 공개를 뜻하지 않으며 release 공개 후에만 release checklist 항목을 완료합니다.

릴리스는 세 단계로 준비하고 진행합니다. (1) commit `chore(release): Release X.Y.Z`가 모든 release manifest와 lock의 버전을 정하고
`CHANGELOG.md(.ko)`의 Unreleased 절을 `## X.Y.Z`로 바꿉니다. packing 전에 버전을 commit합니다. native packer가 version 파일을
`HEAD`에서 복원하는 package lifecycle script를 실행할 수 있기 때문입니다. tag 없는 candidate archive 전체는 커밋된 `HEAD`에서
`make release-candidate-assets VERSION=X.Y.Z`로 만듭니다. 이 명령은 tag asset producer와 같은 manifest 검사, 생성 파일 처리 및 native
packer를 사용하며 tag를 조회하거나 만들지 않습니다. package lifecycle script가 package directory 바깥의 build input도 읽을 수 있으므로
candidate command는 tracked 변경과 ignore되지 않은 untracked 파일이 없는 checkout을 요구합니다. 거부되면 source 변경을 commit한 뒤 candidate
command를 다시 실행합니다. 버전 변경은 package-manager lock을 다시 씁니다. `composer.lock`의 content-hash가 `version`을 포함하므로,
composer.json의 버전 변경은 그 directory에서 `composer update --lock`으로 다시 lock합니다. 이 commit은 `main`에 들어가고 그 `.github/workflows/ci.yml` CI run이 success로 끝납니다. (2) release workflow를 그 run의 id만으로
dispatch합니다(`gh workflow run release.yml -f run=<id>`, 또는 GitHub API의 workflow dispatch). tag push는 이 workflow를 시작하지
않습니다. 그 `make release-tag`(`release-run tag RUN`)는 run id의 형식과 config/release.json의 저장소를 검사하고, `gh api`로 run을 읽어
`main` 위 ci.yml의 push 또는 dispatch run이 성공으로 끝났고 그 commit이 `origin/main`에 있는지를 요구하고, 그 commit에서 config/release.json의 `changelog`와 `goModules`(그 두 field만 검사합니다)와
그 change log의 첫 section `## X.Y.Z`로 X.Y.Z를 읽은 뒤(`git show`, 그런 section이 없거나 `## Unreleased` 아래 항목이 있는 commit은 거부합니다) 그 commit에 tag를 달고, 뒤 step을
위해 `TAG=vX.Y.Z`와 `VERSION=X.Y.Z`를 `GITHUB_ENV`에 덧붙입니다(K924). 먼저 `vX.Y.Z`와 root 아래 모든 Go module의 tag `<directory>/vX.Y.Z`를 검사해 하나라도 다른 commit에 있으면
멈추고, 없는 tag를 annotated tag(`git tag -a vX.Y.Z -m vX.Y.Z`)로 만들어 한 번의 push로 올립니다. 이미 그 commit에 있는 tag는
통과합니다(K911). 테스트는 다시 돌지 않습니다: 근거는 id가 가리키는 CI run입니다. (3) 이어서 `.github/workflows/release.yml`, 곧
vendor되는 `workflows/release.yml` 그대로의 run이 tag를 checkout하고, publication의 유일한 source인 `make release-assets TAG=vX.Y.Z`로
그 tag에서 공식 asset을 만들고, GitHub Release에 draft로 게시한 뒤 공개합니다. 저장소는 그 asset의 URL과 integrity를 pin합니다.
게시된 tag는 옮기지 않습니다.

kit은 `workflows/release.yml`을 package.json의 `kit.copies`로 모든 저장소의 `.github/workflows/release.yml`에 vendor합니다. 저장소는 이를 편집하지 않으며, `make kit-sync`가 다시 씁니다. workflow는 저장소가 `.php-version`을 선언하면 그 PHP를 설치하고, `main`에서 `make release-tag`를 실행하고, tag를 checkout해 그 tag의 kit와 package를 설치한 뒤 `make release-prepare`(저장소의 release가 Makefile의 `release-prepare::` 규칙으로 선언한 준비, 기본은 없음), `make release-tools`(config/release.json이 필요로 하는 tool이며, make entry는 tool을 더하지 않습니다), `make release-tools-path`(뒤따르는 단계가 설치된 tool로 실행되도록 `var/tools/bin`과 mise의 shim을 그 PATH에, mise의 환경을 그 환경에 올립니다), `make release-publish`(draft release, 그 id를 `var/release/<tag>.json`에 기록), `make release-undraft TAG=<tag>`(release 공개)를 실행합니다. undraft는 새 draft를 한동안 보여 주지 않는 release 목록의 tag가 아니라 그 id로 draft를 읽습니다. 실패한 step은 release를 draft로 남기고 run을 실패시킵니다.

패키지가 생성물을 필요로 하면 그 생성 경로마다 `make` entry를 `config/release.json`에 선언합니다. target과 output을 적습니다. pack(`make release-assets`와 `make release-candidate-assets`)은 먼저 자신이 pack하는 commit과 다른 checkout을 거부합니다. HEAD가 tag된 commit이 아니거나(candidate는 HEAD 자신을 pack합니다), 추적되거나 추적되지 않은 경로가 바뀌었거나, checkout의 dependency가 바깥으로 link되어 있으면 실패합니다(K939). 그다음 선언된 output을 지우고, checkout의 tool이 올라간 PATH(toolsEnvironment)로 checkout에서 `make <target>`을 실행합니다. target이 `php-config`를 직접 부르고 Makefile은 checkout이 설치한 kit을 include합니다. output을 stage한 뒤에는 checkout에서 다시 지우므로, pack 전에 checkout에 있던 선언된 경로도 그렇게 지워집니다. target이 선언되지 않은 output 밖에 남긴 변경되었거나 추적되지 않은 경로는 pack을 실패시키고 경로를 밝힙니다(K939). npm package는 make 항목을 거부합니다(npm은 prepack script에서 산출물을 만듭니다). target은 필요한 것을 스스로 설치하고 그 저장소의 lock을 통해 설치합니다. kit은 lock을 검사하지 않고 package manager를 직접 실행하지 않습니다. make 실행의 PATH는 checkout의 tool을 먼저, 그다음 기계의 PATH를 둡니다. PHP가 필요한 target을 가진 저장소는 `release-prepare::` 규칙에서 `make install-tools TOOLS="php"`로 PHP를 설치합니다. `gen_stub.php`는 빌드하는 tree의 `var/php-ext/gen-stub/`에 고정 PHP-Parser를 한 번 내려받을 수 있으며, 이는 도구 내부의 fetch이므로 P35가 다루지 않습니다. 선언된 output은 target 실행 뒤에 있어야 하고 Git에 추적되면 안 됩니다. 그렇지 않으면 pack이 경로를 밝히며 실패합니다(K930, K939, P34).

kind `wheel` package(`pyproject.toml`을 가진 Python package)는 PEP 427 wheel `<distribution>-<version>-py3-none-any.whl`로 릴리스되며,
이 파일 이름을 pip이 파싱합니다. `release-assets`는 tag된 commit에서 `uv build --wheel`로 이 wheel을 만들며, uv build가 package 자신의
pyproject.toml의 `[build-system].requires`를 격리된 build 환경에 설치합니다. kit은 build backend를 고정하지 않습니다(K788). wheel의 `Requires-Dist`는 plain `name==version`, polyspec package의 release asset을 sha256 fragment와 함께 직접 참조하는 형식, 또는 같은 release의 sibling(같은 config/release.json의 다른 wheel package)을 hash 없이 직접 참조하는 형식입니다.
consumer가 wheel을 설치할 때 uv와 pip가 이 형식을 해석합니다(docs/operations/tool-inventory.ko.md, Sibling wheels).
Python package는 git tag로 릴리스하지 않습니다.

`composer` kind의 package가 있는 release는 archive 옆에 `packages.json`도 게시합니다(K871). release asset은 폴더를 담지 않으므로 하나의 평면 Composer repository입니다. config/release.json의 각 Composer package를 그 이름과 version 아래에 commit의 composer.json으로 담고, URL이 그 zip의 release asset이고 shasum이 그 zip의 sha1인 type zip의 dist를 붙입니다. 소비자는 `{ "type": "composer", "url": "<repositoryUrl>/releases/download/vX.Y.Z/packages.json" }`를 선언합니다. Composer는 경로에 `.json`이 있는 URL을 그 파일 자체로 읽고 package metadata를 그 파일에서 읽으므로 소비자는 tag만 적습니다. `release-candidate-assets VERSION`의 packages.json은 release `vVERSION`의 asset URL을 적으며, 이 URL은 그 release가 게시된 뒤에만 존재합니다. Composer 도구는 이 형태를 쓰지 않습니다: Satis는 metadata-url을 위해 `p2/<vendor>/<name>.json`을 쓰고 dist URL을 위해 package를 다시 묶으며, `composer archive`는 repository를 쓰지 않습니다.
