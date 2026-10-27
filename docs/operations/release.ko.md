<!-- doc-id: operations-release -->
<!-- source-sha256: 99df3ca878dd7a8e6c53d1b4081600d436620c21982d8674c0da6534db5d58ce -->
# 릴리스

[English](release.md)

kit 릴리스의 절차이며, 규칙은 AGENTS.md의 규칙이다.

kit은 `main`의 commit 중 `ci` 실행이 success로 끝난 commit에 tag `vX.Y.Z`를 붙여 릴리스합니다. `package.json`이 tree의 버전을 가집니다. 저장소는
package-lock의 `@polyspec/kit`을 갱신하고 `make install-packages`와 `make kit-sync`를 실행해 릴리스를 채택합니다.

소비자는 `node_modules/@polyspec/kit/scripts/kit/kit-bootstrap.mk`를 include합니다. 깨끗한 checkout에서 공유 workflow는 `packageManager`에 선언된 정확한 npm version으로 native `npm ci --ignore-scripts`를 먼저 실행하고 기존 tool 설치와 package 설치 target을 실행합니다. 옆의 kit checkout을 clone하지 않습니다. 로컬의 `npm link ../kit`은 같은 설치 package path에서 source bootstrap을 사용하며 kit 자체는 자기 source Makefile을 사용합니다.

Kit의 native npm prepack은 source export와 hook bin을 build된 dist path로 바꿉니다. Asset gate는 tag의 kit manifest에 같은 canonical producer 변환을 적용한 뒤 모든 byte를 비교하며 다른 package manifest는 byte-exact를 유지합니다. 기존 packed-consumer 검사는 단일 native pack으로 그 gate를 실행하고 생성된 archive를 설치합니다. Native consumer lock은 개발 lock과 다른 호환 전이 version을 해석할 수 있으므로 두 개의 정확한 locked graph를 모두 advisory review에 포함합니다.

공개 module subpath에는 기존 tool module과 함께 `glob`, `parity-declaration`, `land`, `parity`, `checklist`, `php-extension`이 있습니다. Source checkout에서는 각 경로가 `scripts/kit/<name>.mts`로 해석되고, packed consumer에서는 같은 subpath가 `dist/<name>.mjs`로 해석됩니다. Packed-consumer 검사는 설치한 archive에서 각 공개 subpath를 import하고 export 이름을 source module과 비교합니다.

후속 변경은 앞선 release의 검증 증거를 무효화하지 않습니다. 현재 version은 자기 CI와 consumer proof가 통과하면 완료하고 다음 version을 올려 별도로 검증합니다. 로컬 main commit이 자동으로 원격 release에 포함되는 것은 아니므로 원격 candidate와 해당 CI를 확인합니다. 구현 완료와 소유 검사 통과는 공개를 뜻하지 않으며 proof 통과와 release 공개 후에만 release checklist 항목을 완료합니다.

릴리스는 세 단계입니다. (1) commit `chore(release): Release X.Y.Z`가 `package.json`과 `package-lock.json`의 버전을 정하고
`CHANGELOG.md(.ko)`의 Unreleased 절을 `## X.Y.Z`로 바꿉니다. 릴리스 commit은 소비자 lock도 담습니다: `make release-assets
TAG=vX.Y.Z` 다음 `make release-consumer-lock TAG=vX.Y.Z`(ONLINE)를 실행하고, 그것이 `tests/release-consumer/*/`에 쓴 manifest와
lock을 버전 변경과 함께, 또는 tag 전의 다음 commit으로 commit합니다(docs/operations/tool-inventory.md, Consumer install of the release
archives, 1단계와 2단계). 버전 변경은 `package-lock.json`을 다시 쓰므로, 릴리스 commit은 `make dependency-review RECORD=1`(ONLINE)이
그 lock에 대해 쓴 `config/dependency-review.json`도 담습니다. CI는 review와 다른 lock을 실패시키는 `make dependency-policy-check`를
실행합니다(K169). composer.json의 버전 변경도 마찬가지로 그 directory에서 `composer update --lock`으로 다시 lock합니다:
`composer.lock`의 content-hash가 `version`을 포함하므로, 검사는 그 변경이 낡게 만든 lock을 실패시킵니다(`composerLock`, K180, K181). draft의 증명은 그 lock으로 archive를 설치하므로, lock이 없는 tag는 실패합니다. 이 commit은 `main`에
들어가고 CI가 success로 끝납니다. tag는 CI가 success로 끝났고 그 lock을 담은 commit에만 붙입니다. (2) release workflow를 tag와 함께 dispatch합니다(`gh workflow run release.yml -f tag=vX.Y.Z`, 또는 GitHub API의
workflow dispatch). 그 `make release-tag`가 origin/main에 annotated tag를 만들어 push하고, tag가 이미 있으면 통과합니다
(K269). tag를 push해도 같은 workflow가 시작됩니다. (3) `.github/workflows/release.yml`이 실행됩니다. 이 파일은 vendor되는
`workflows/release.yml` 그대로이며, `config/release.json`이 선언한 `@polyspec/kit`의 npm archive를 만들어 GitHub Release에
draft로 게시하고, 소비자 project에서 증명한 뒤 공개합니다. 저장소는 그 asset의 URL과 integrity를 pin합니다.

릴리스 tag는 annotated tag입니다: `git tag -a vX.Y.Z -m vX.Y.Z`로 만듭니다. `release-verify`는 object 종류
(`git cat-file -t <tag>`)가 `tag`가 아닌 tag를 거부하고, tag 이름과 그 종류를 적은 줄을 출력합니다(lightweight tag는 `commit`).
이미 게시된 tag는 옮기지 않으며, 검사는 릴리스되는 tag에만 실행합니다.

kit은 `workflows/release.yml`을 package.json의 `kit.copies`로 모든 저장소의 `.github/workflows/release.yml`에 vendor합니다. 저장소는 이를 편집하지 않으며, `make kit-check`가 차이를 실패시킵니다. workflow는 저장소가 `.php-version`을 선언하면 그 PHP를 설치하고, `make release-prepare`(저장소의 release가 Makefile의 `release-prepare::` 규칙으로 선언한 준비, 기본은 없음), `make release-tools`(config/release.json이 필요로 하는 tool), `make release-tools-path`(뒤따르는 단계가 설치된 tool로 실행되도록 `var/tools/bin`과 mise의 shim을 그 PATH에, mise의 환경을 그 환경에 올립니다), `make release-publish`(draft release, 그 id를 `var/release/<tag>.json`에 기록), `make release-proof TAG=<tag>`(draft의 증명)를 실행하고, 증명이 통과한 뒤에만 `make release-undraft TAG=<tag>`로 release를 공개합니다. 증명과 undraft는 새 draft를 한동안 보여 주지 않는 release 목록의 tag가 아니라 그 id로 draft를 읽습니다. 실패한 step은 release를 draft로 남기고 run을 실패시키므로, 설치할 수 없는 release는 공개되지 않습니다.

kind `wheel` package(`pyproject.toml`을 가진 Python package)는 PEP 427 wheel `<distribution>-<version>-py3-none-any.whl`로 릴리스되며,
이 파일 이름을 pip이 파싱합니다. `release-assets`는 tag된 commit에서 이 wheel을 만들고, build backend는 그 유일한 선언인
config/toolchain.json의 `pythonBackend`가 정확한 requirement와 wheel의 sha256으로 고정합니다. `make install-tools`와 `make release-backend`는 그 wheel을 digest를 확인하며
`var/tools/wheels`에 받고, 어떤 build도 network를 읽지 않습니다. wheel의 `Requires-Dist`는 plain `name==version`, polyspec package의 release asset을 sha256 fragment와 함께 직접 참조하는 형식, 또는 같은 release의 sibling(같은 config/release.json의 다른 wheel package)을 hash 없이 직접 참조하는 형식입니다.
앞의 두 형식은 wheel의 lock(`consumers.wheel.lock`)이 담으며, sibling은 lock이 담지 않습니다. 다른 형식(URL, git source, 범위, marker)은 거부합니다. 같은 형식의 npm 또는
Composer manifest를 거부하는 것과 같습니다(docs/operations/tool-inventory.ko.md, Sibling wheels). `release-consumer`는 깨끗한 virtual environment에 lock을 hash와 함께 설치하고, release의
wheel들을 `--no-deps`로 함께 설치한 뒤 `pip check`를 실행하고, 그다음 smoke command를 실행합니다.
Python package는 git tag로 릴리스하지 않습니다.
