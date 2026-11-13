<!-- doc-id: spec-utilities-and-recipes -->
<!-- source-sha256: 1e2ecc1b9b00e6950bc78002a1e11600be8b65565a346d9d32dfd816c0f376b3 -->
# 유틸리티와 예제

[English](utilities-and-recipes.md)

## 문제

kit은 레시피를 강제한다. 레시피 한 벌(`scripts/kit/kit.mk`, `scripts/kit/kit-bootstrap.mk`, K1054 전까지)을 모든 저장소에 include시키고, 공유 CI에서 자기 검사의 결과를 필수로 요구한다. 모든 저장소가 함께 쓰는 레시피는 저장소마다의 경우를 감당해야 하므로, 새 경우마다 공유 덩어리에 분기, 스위치, 덮어쓰기가 붙었다. `UV_NO_CONFIG`, `MISE_*`, `unexport CARGO_TARGET_DIR`, `INSTALL_PACKAGES_EXTRA`, `npm_config_allow_remote=root`가 그 예다. 명령줄이나 환경변수의 덮어쓰기는 저장소 자신의 설정보다 우선하고, 필수 검사는 예상하지 못한 경우를 거부한다. 어느 쪽이든 저장소에 남는 수는 우회뿐이다.

allow-remote 사례가 그 연쇄를 보여 준다.
1. kit은 K1045 전까지 `allow-remote=root`를 강제했다.
2. 제공 라이브러리가 URL로 적은 의존성을 npm이 거부한다.
3. 제공 라이브러리는 어느 레지스트리도 내주지 않는 버전 번호로 물러선다.
4. 각 소비자가 그 패키지를 루트에 선언하고, `overrides`로 다시 고정하고, knip의 정확한 "안 쓰는 의존성" 지적을 막는다.

## kit이 제공하는 것

1. **유틸리티.** 유틸리티는 받은 인자와 파일로 동작이 정해지는 스크립트다. 도구 설치기, 검사기, 릴리즈 도구가 여기에 든다. 일부 유틸리티는 저장소의 레시피를 실행한다. 저장소가 이름을 대는 target을 실행하는 것으로, CI target 실행기(`ci-targets`), 저장소 자신의 설치를 실행하는 worktree 설정, 테스트 실행기가 그 예다. 저장소는 원하는 유틸리티를 자기 레시피에서 실행한다. 유틸리티는 레시피를 적힌 그대로 실행한다. 잘못된 레시피는 잘못된 대로 실행되며, 유틸리티는 그것을 판정하지 않는다. 유틸리티가 멈추는 것은 자기 일을 할 수 없을 때뿐이다. 도구가 없을 때, 커밋하지 않은 변경이 있는 main checkout에서 land할 때가 그 예다. 실패한 유틸리티는 자기가 바꾼 것을 찾은 그대로 남긴다. uv-install은 실패한 uv sync 전에 지운 provider 링크를 되돌린다(K1134).
2. **예제.** `docs/examples/`는 저장소들이 보편적으로 일하는 방법을 주제마다 작동하는 예제 하나로 보여 준다.
   - row의 worktree를 어떻게 짜고 그 안에서 어떻게 일하는가
   - 레시피를 어떻게 짜는가: 유틸리티를 실행하는 Makefile의 설치, 빌드, 테스트, lint, 릴리즈 target
   - 네이티브 설정을 어떻게 적는가: `.npmrc`, `uv.toml`, `mise.toml`의 `[settings]`, `.cargo/config.toml`
   - CI workflow를 어떻게 짜는가
   - 개발 중에 형제 checkout을 어떻게 링크하는가
   - 체크리스트 row를 Red부터 커밋까지 어떻게 진행하는가

   예제는 작동하는 방법 하나를 보여 준다. 저장소는 그것을 복사하거나, 바꾸거나, 무시한다.

## Native event identity (K1091)

Native event parser는 framework의 완전한 test identity를 보존한다. PHPUnit TeamCity message의
`TestRef.id`는 `locationHint`의 fully qualified class, method, data set이며 맨 앞 namespace separator만 제외한다.
`TestRef.name`은 native display name을 유지한다. Parser는 동시에 진행되는 event flow를 구분한다.
서로 다른 namespace의 class는 class basename, method, data set이 같아도 구별된다.
명시적 invocation, selection, expected case inventory는 repository가 소유하며 이 utility는 해당 정책을 추가하지 않는다.

## 짝 문서의 merge driver (K1197)

`make hooks`는 merge driver `kit-twin`, `kit-changelog`, `kit-checklist`를 선언한다(`twin-merge.mts`, K354). 한국어 짝은 git이
merge하는 그대로의 영어 파일에서 revision marker를 받으므로, driver는 git이 실행하는 merge의 세 쪽에서 영어 파일을 읽는다.
branch를 들이는 기본 방법인 merge에서 theirs는 git이 merge하는 commit이다. git은 `MERGE_HEAD`를 merge가 멈춘 뒤에야
쓰므로, 그 commit을 driver 환경의 변수 `GITHEAD_<commit>`으로 알려 준다. base는 `git merge-base HEAD <commit>`이다. `main`보다
뒤진 branch에 `make land`가 실행하는 rebase(K495-1)에서 theirs는 rebase가 적용하는 commit, 곧 `rebase-merge/done`의 마지막
commit이고 base는 그 부모이다. cherry-pick처럼 그 밖의 작업은 어느 쪽도 알려 주지 않으며, driver는 merge를 이름으로 대고
실패한다. 세 쪽을 알 수 없거나 checklist의 task row를 양쪽이 서로 다르게 바꿔 파일을 merge할 수 없는 driver는 `git
merge-file`의 충돌을 양쪽 표시와 함께 그 파일에 쓰고 1로 끝난다. 그래서 작업 파일은 다른 쪽의 흔적 없이 한쪽만 담는 일이
없다.

## 문서 속의 commit 이름 (K1210)

`commit-names-check.mts`는 추적되는 Markdown 파일이 Git commit을 적지 않는지 보는 검사다. release와 lock이 commit을 고정하며,
문서에 적힌 이름은 history가 바뀌면 틀린 값이 된다. 그런 이름을 금지하는 규칙을 가진 저장소는 자기 recipe에서
`$(NODE) $(KIT)/commit-names-check.$(KIT_EXT) --except '<glob>'`로 이 검사를 돌리고, 읽지 않을 경로를 `--except <glob>`으로
하나씩 선언한다. lock 파일과 workflow는 Markdown이 아니므로 읽지 않는다. finding마다 `<file>:<line>:<column>: names the Git
commit <name>` 한 줄을 출력하고 exit 1로 끝난다. Markdown 파일을 하나도 읽지 않은 실행은 실패한다.

- 경계: 후보는 양쪽에 ASCII 글자나 숫자가 닿지 않은 소문자 16진수 7~40자리다. 세 가지 이음은 그 자리를 더 긴 낱말의 일부로
  만들며, 그것은 후보가 아니다: 그 자리와 글자나 숫자 사이의 `.`(파일 이름, version, 소수), 그 자리와 16진수만으로 된 이웃 자리
  사이의 `-`나 `_`(UUID, 묶음으로 쓴 digest, 날짜). 다른 모든 문자는 이름을 끝낸다. `:`, `=`, `@`, `#`, `/`, 그리고 16진수가 아닌
  낱말 앞의 `-`나 `_`도 그렇다.
- 내용: 숫자와 글자를 모두 가진 후보는 commit 이름이다. 숫자만이거나 글자만인 후보는 같은 줄에서 marker가 바로 앞에 있을 때만
  commit 이름이다. marker는 대소문자를 가리지 않는 낱말 `commit`, `commits`, `sha`, `rev`, `revision`에 선택적 공백, `:`, `=`, `/`
  중 최대 하나, 선택적 공백, backtick 최대 하나가 따르는 것, 또는 `@`에 backtick 최대 하나가 따르는 것이다. 7자리 이상의 수는
  대개 날짜, 크기, run id이므로 marker 없이는 이름이 아니다.
- 받아들이는 미탐: marker가 없는 숫자만의 이름이나 글자만의 이름(낱말 `at` 뒤도 포함한다. `at`은 크기와 날짜 앞에도 온다),
  대문자 16진수로 쓴 이름, `-`나 `_`가 16진수만으로 된 낱말에 이은 이름.
- 받아들이는 오탐(commit이 아닌 것): 숫자와 글자를 가진 그 밖의 16진수 7~40자리 낱말, 예를 들어 파일의 SHA-1 digest. 그런
  경로는 `--except`로 선언한다.

## kit이 하지 않는 것

kit은 어떤 것도 강제하지 않는다. 특히 다음과 같다.

- kit은 저장소에 레시피를 include시키지 않는다.
- kit은 다른 도구의 설정을 정하지 않는다. 명령줄에서도, 환경변수에서도, 유틸리티가 실행하는 도구의 환경에서도 그렇다. 도구 설치기는 자기가 설치하는 것을 어디에 두는지 정하며, 그것은 설치기 자신의 일이다. mise 설치기는 호출자가 다른 환경을 넘기지 않으면 자기가 설치하는 mise의 디렉터리와 그 shim이 읽는 checkout의 설정 파일을 정한다(`MISE_DATA_DIR`, `MISE_CACHE_DIR`, `MISE_STATE_DIR`, `MISE_CONFIG_DIR`, `MISE_GLOBAL_CONFIG_FILE`, `MISE_GLOBAL_CONFIG_ROOT`). Go에는 환경을 주지 않고, `var/tools`에 다른 파일을 쓰지 않으며, mise가 기록한 trust를 지우지 않는다(K1092). 이 중 어느 것도 저장소의 도구가 어떻게 동작할지를 정하지 않는다. PHP의 lint는 PHPStan에 패키지의 Composer가 쓴 autoloader를 준다(`--autoload-file`). 그것이 없으면 PHPStan은 패키지의 호출을 해석하지 못한다. `--locked`, `--profile minimal`, `--memory-limit=-1` 같은 flag는 호출자의 것이다. 유틸리티는 호출자가 준 인자를 넘기고 자기 것은 넘기지 않는다(K1097).
- Rust의 lint는 checkout의 각 Cargo workspace 폴더에서 clippy step을 하나씩 실행하고, 첫 `--workspace-args`보다 앞의 인자를 모든 step에 준다. `--workspace-args <folder>`는 그 뒤부터 다음 `--workspace-args`까지의 인자를 `<folder>`에 있는 workspace의 step에만, 모든 step의 인자 뒤에 준다. `<folder>`는 그 Cargo.toml이 있는 폴더의 저장소 상대 경로이다(root는 `.`). checkout의 Cargo workspace가 없는 폴더와 폴더 없는 `--workspace-args`는 어느 step도 실행하기 전에 lint를 실패시키고 checkout의 workspace를 나열한다. 그래서 package의 `--exclude`는 그 package를 가진 workspace에만 가고, cargo는 다른 workspace에서 뜻이 없는 제외를 경고하지 않는다(K1195).
- kit은 저장소의 CI, hook, gate에 어떤 결과도 필수로 요구하지 않는다.
- kit은 저장소의 레시피나 예제를 검사하는 기능을 제공하지 않는다.

## kit의 일이 아닌 것 (K1219)

kit은 저장소가 만든 규칙을 시작한다. 그 규칙은 저장소의 Makefile과 설정이 선언한 target, 검사, release 단계이다. 두 가지 일은
kit의 일이 아니며, 둘 중 하나를 하는 유틸리티는 제거한다.

1. **package manager의 일.** 설치, download, version 결정, package link, package의 build와 pack은 npm, Composer, cargo, go, uv,
   mise, rustup, container engine의 일이다. 유틸리티가 manifest, lock, `go.work`, Composer repository 항목, Cargo patch, 설치
   폴더의 link를 쓰거나, version이나 dependency 순서를 고르거나, archive를 download하거나, 자기 단계로 package를 pack하면 이
   일을 하는 것이다. recipe가 준 인자로 manager를 시작하는 유틸리티는 그렇지 않다.
2. **저장소의 일.** 저장소가 무엇을 build하고 pack하고 tag하고 publish하는지, 어떤 순서와 어떤 값으로 하는지는 저장소 자신의
   Makefile과 설정이 적는다. 그 단계를 저장소의 파일이 아니라 유틸리티의 코드가 정하거나, 유틸리티가 저장소의 파일을 쓰거나,
   한 종류의 package 구조를 유틸리티가 가지고 있으면 이 일을 하는 것이다.

남는 것은 harness이다: 저장소가 선언한 target과 명령을 끝까지 실행하고 보고하는 것, 문서와 checklist와 commit의 검사, 규칙을
저장소의 파일이 적는 검사, 생태계의 표준 runner를 시작하는 test runner.

어느 recipe도 부르지 않는 유틸리티는 여기에 적는 변경에서 삭제한다. recipe가 부르는 유틸리티는 떠나는 것으로 표시한다. 그것을
부르는 recipe가 모두 아래의 native 명령을 가질 때까지 동작하고, 그 뒤에 삭제한다. kit은 그것을 대신하는 유틸리티, 옵션, gate를
더하지 않는다.

### 제거한 것

- `link.mts packages <dir> python|npm` (K1217). 폴더의 manifest가 선언한 polyspec package를 `uv sync --no-install-package`의
  인자로 출력했다. manager가 설치할 package를 고르는 일은 그 manager를 시작하는 recipe의 일이다. 어느 recipe도 부르지 않았다.
- package의 export `./link-folders` (K1218). 설치 폴더를 link로 바꾸는 함수를 저장소의 test에 주었다. 설치 폴더의 link는
  package manager의 일이다. 저장소의 어느 파일도 import하지 않았다.
- `release.mts go-modules`와 `release-go-module.mts`, target `release-go-modules` (K1220). tag의 commit에서, Go module의 생성
  파일과 플랫폼별 정적 라이브러리를 더한 commit을 만들고, 거기에 `<directory>/vX.Y.Z` tag를 달고, 그 tag에서 consumer의
  `go test`를 실행했다. Go module의 tag가 어떤 파일을 담고 무엇으로 증명하는지는 저장소의 release이다. 저장소의 recipe가
  `git commit-tree`, `git tag -a <directory>/vX.Y.Z <commit>`, `git push <remote> <tag>`를 가지고, 그 앞에 원하는 검사를 둔다.
  어느 recipe도 이 mode를 부르지 않았다.
- `release.mts sets`와 target `release-sets` (K1221). `config/release.json`의 asset set을 플랫폼별 runner와 함께 GitHub matrix의
  include 목록으로 출력했다. workflow의 job과 runner는 저장소의 workflow가 적는다. 예시 workflow가 include 목록을 스스로
  가진다. 어느 recipe도 이 mode를 부르지 않았다.

### 떠나는 것

| 유틸리티 | 하는 일 | 종류 | 저장소의 recipe가 대신 가지는 것 |
|---|---|---|---|
| `link-build.mts`, `linked-build.mts` | land와 commit 뒤에, kit이 Makefile에서 읽은 target으로 checkout의 npm package를 build한다 | 2 | 저장소의 build target. recipe가 `land` 뒤에 실행한다 |
| `python-venv.mts` | 가상 환경을 만들고 판정한다 | 1 | `uv venv --python python3 <dir>` |
| `bootstrap/` (`install-mise`, `installNode`) | mise의 archive를 download하고, digest를 비교하고, 풀고, `var/tools/bin`의 wrapper를 쓴다 | 1 | `MISE_VERSION`과 `MISE_INSTALL_PATH`를 준 mise의 installer, 또는 CI의 mise action. 그 다음 `mise install --locked node npm:npm` |
| `install-tools.mts`, `install-rust.mts`, `install-php.mts`, `toolchain-*.mts` | 도구 이름을 `mise.toml`의 key로 바꾸고, prerequisite 순서를 정하고, mise와 rustup을 시작하고, PHP의 wrapper를 쓴다 | 1 | `mise install --locked [<tool>...]`와, `rust-toolchain.toml`을 읽는 `rustup toolchain install` |
| `install-composer-project.mts`, `install-phpunit.mts`, `install-php-lint.mts`, `config/php-lint`, `install-symbols.mts`, `symbols/php` | kit이 가진 Composer project를 `var/tools`에 설치한다 | 1, 2 | 저장소 자신의 `composer.json`의 `require-dev`에 둔 phpunit, phpcs, PHPStan. `composer install`이 설치한다 |
| `install-vscode.mts` | VS Code의 release를 고르고 download한다 | 1 | 저장소의 integration run에서 `@vscode/test-electron`의 `downloadAndUnzipVSCode`. version은 그 run이 적는다 |
| `release-tools.mts` | `config/release.json`에서 release의 도구를 추론해 설치한다 | 1, 2 | release recipe의 `mise install --locked <tool>...`와 `rustup toolchain install` |
| `release.mts assets`, `candidate-assets`, `release-native.mts`, `release-wheel.mts` | tag가 가질 archive와 그 이름을 정하고, Composer zip을 스스로 pack하고, `packages.json`을 쓰고, native 종류의 build를 자기 순서로 실행한다 | 1, 2 | release recipe에 package마다 한 줄: `npm pack --pack-destination <assets>`, `composer archive --format=zip --dir=<assets>`, `uv build --wheel --out-dir <assets>`, `cargo build --release --locked -p <package>`, `napi build --platform --release`와 `napi artifacts`, `llvm-strip --strip-debug`, `zip` |
| `release.mts publish`, `undraft`, `github-release.mts` | 자기가 쓴 notes로 release의 draft를 만들고 공개한다 | 2 | `gh release create <tag> --draft --notes-file <file> <assets>/*`와 `gh release edit <tag> --draft=false` |
| `release-run.mts tag`, `prepare` | CI run과 change log를 읽고 tag를 만들어 push한다 | 2 | `gh run view <run> --json conclusion,headSha,headBranch,event`, `git tag -a <tag> <commit>`, `git push origin <tag>` |
| `php-extension.mts build`, `test` | phpize, arginfo generator, configure, make 또는 cargo를 자기 순서로 실행한다 | 1, 2 | `phpize`, `./configure --with-php-config=<file>`, `make`, 또는 `cargo build --release --locked -p <package>`. `php -d extension=<file> vendor/bin/phpunit` |

### 결정하지 않은 것

아래는 양쪽에 근거가 있으므로, 삭제하지도 표시하지도 않는다.

- local link 전체: `link.mts`(`link`, `unlink`, `providers`, `cargo`), `link-check.mts`, `link-providers.mts`, `link-folders.mts`,
  `cargo-source.mts`, `uv-install.mts`의 link. 종류 1: 설치 폴더를 link로 바꾸고, `use`와 `replace` 줄을 가진 `go.work`를 쓰고
  (K1212), cargo의 patch 인자를 계산하고, 한 package 이름의 두 폴더 중 하나를 고른다(K1213). 반대쪽에는, 개발 때 적힌 version의
  설치 폴더를 개발 폴더로 link한다는 규칙이 있다(K591, `docs/plans/kit-harness/plan.md`의 목표). 저장소는 그 규칙을 `.links`와
  `make link`로 적용한다.
- `lint-go.mts`, `lint-php.mts`, `lint-python.mts`, `lint-rust.mts`, `lint-ts.mts`. 저장소가 정하는 것: 각 linter의 규칙(linter가
  자기 discovery로 읽는 설정, K1050)과 recipe가 넘기는 인자(K1097). kit의 코드가 정하는 것: 어떤 linter를 어떤 폴더에서
  실행하는지와 고정 인자(`./...`, `--workspace --all-targets`, build tag마다 한 번의 실행).
- `workflows/`, `actions/kit-bootstrap`, `docs/examples/bootstrap.mk`, package가 export하는 lint 설정. 저장소가 정하는 것: 파일을
  복사할지와 복사본의 내용(K1052). kit이 정하는 것: 자기가 싣는 파일의 내용. 그 파일은 저장소의 workflow와 Makefile의 공용
  조각을 담는다.
- `ci-setup.mts`의 기본값. 저장소가 정하는 것: `config/ci.json`이 적는 setup target. 적지 않으면 kit의 코드가 `deps-<runtime>`을
  고른다(K859).

## 근거

- 강제한 설정과 필수 결과 하나하나가 저장소의 선택을 없앴다. 저장소의 경우가 kit의 예상과 다르면 남은 수는 우회뿐이었다. "문제"에 적은 덮어쓰기는 모두 거기서 나왔다.
- 저장소 자신의 레시피는 자기 경우 하나만 적으므로 분기가 필요 없다. 도구는 네이티브 파일을 문서에 적힌 대로 읽는다.
- 예제는 작동하는 방법을 전하되 누구도 거기에 묶지 않는다.
- 레시피를 검사하는 기능은 kit이 저장소 위에 정하는 새 규칙이 되고, 그것은 다시 같은 강제다.

## kit에 대한 결과

kit은 자기가 강제하는 것을 지운다. 각 변경은 Red, Green, 커밋을 거치는 체크리스트 행이다. 지금 강제하는 부분은 다음과 같다.
- **include되는 레시피.** K1054 전까지 저장소는 package의 `scripts/kit/kit.mk`와 `scripts/kit/kit-bootstrap.mk` 레시피 한 벌을 include했고, AGENTS.md는 그들을 위해 kit.mk의 모든 레시피의 mise 환경을 적었다. 이제 package는 make 파일을 싣지 않는다. kit.mk는 kit 자신의 Makefile의 레시피이고, bootstrap은 예시 `docs/examples/bootstrap.mk`이며, toolchain-lock 레시피는 UV_PYTHON을 적지 않고 `mise.toml`의 `[env]`가 정한다.
- **유틸리티 안의 덮어쓰기.** `bootstrap/install-mise.mts`(`miseEnvironment`)와 `mise-tools.mts`(`toolsEnvironment`)는 K1048 전까지 자기가 실행하는 도구에 mise와 uv의 설정(`MISE_LOCKED`, `MISE_AUTO_INSTALL`, `UV_*`, `UV_PYTHON`)을 넣었고, `link.mts`와 `run-tests.mts`는 K1049 전까지 `CARGO_TARGET_DIR`를 지웠다. K1050 전까지 lint 유틸리티는 각 도구를 저장소 자신의 설정 대신 kit의 설정으로 실행했다. golangci-lint는 kit의 `.golangci.yml`로, phpcs는 kit의 `phpcs.xml.dist`로, ruff는 kit의 `ruff.toml`로, clippy는 kit을 가리키는 `CLIPPY_CONF_DIR`로, oxlint와 knip은 kit의 `.oxlintrc.json`과 `knip.json`으로 실행한다.
- **저장소의 레시피와 workflow에 대한 검사.** K1051 전까지 kit-check는 레시피가 도구를 실행하는 방식(`recipe-tools.mts`), Makefile과 workflow의 링크 단계(S11), ci.yml의 모양과 마지막 `ci-passed` job(S12), Makefile의 `$(KIT)/<name>`(S15), manifest 경로(P30)를 판정했고, bypass-check는 Makefile과 스크립트를 판정했다. K1070 전까지 kit-check는 각 config/<name>.json을 그 이름의 kit schema로 검증했다. 이제 kit-check는 없고, 각 도구가 자기가 읽는 설정을 검증한다.
- **복사본.** K1052 전까지 kit-sync는 kit package.json의 `kit.copies` 항목 전부를 모든 저장소에 썼다. `PRINCIPLES.md`와 그 짝, `ci-pipeline.yml`, `release.yml`, bootstrap action, `config/layout.kit.yml`, `config/` 아래의 스키마, `.editorconfig`, `.claude/settings.json`이 그 안에 들었다. kit-inject-check가 바뀐 복사본을 실패시켰으므로, 복사본 파이프라인의 마지막 `required` job은 모든 저장소를 `kit-gates-*` gate를 포함한 파이프라인의 모든 job 결과에 묶었다. 이제 package는 이 파일을 예시로 담는다. 저장소는 원하는 것을 복사해 각 사본을 자기 것으로 가지며, 그 파이프라인과 그 job도 마찬가지다. kit은 어느 것도 쓰거나 비교하지 않는다. 그 파일에 대한 kit.owners의 owner 규칙, lint-ts와 rebuild-check의 사본 제외, 사본 편집에 대한 claude-hook의 거부, layout 규칙 `lint-cargo-lints`와 `config/cargo.schema.json`도 함께 사라졌다.
- **거부.** K1053 전까지 다음이 거부했다.
  - `.claude/settings.json`의 Claude hook(`claude-hook.mts`)은 모든 저장소의 세션에서 명령을 거부했고, `make link`와 `make hook`이 그것을 각 checkout과 workspace 폴더의 설정에 썼다.
  - `make hooks`가 쓴 git hook은 커밋을 거부했다. commit-msg hook과 staged-generated hook이며, `commit` target도 이것들을 실행했다. `make item-test`와 docs-check는 Claude hook이 거부하는 Verification 명령을 거부했다.
  - `ci-targets`, `owner-check`, 선택 없는 run-tests, runtime-targets의 suite, 전체 `parity-check`는 FINAL_RUN이 깨끗한 커밋 트리를 가리키지 않는 한 CI 밖에서의 실행을 거부했다.
  - `land`는 정적 gate나 커밋 규칙이 실패하는 branch를 거부했고, 자기가 고정한 gate가 저장소 `kit-gates`의 선행 조건에 들어 있기를 요구했다.
  - `item-state`는 changelog 줄 없는 완료와, Verification이 통과하지 않은 검증 중 또는 완료로의 이동을 거부했다.
  - `ci-setup`은 `kit-ci-setup`을 다시 실행하는 설정 target을 거부했다.
  - `run-tests --venv`는 Python이 checkout의 것이 아닌 환경을 거부했다.
- **Parity.** K1129 전까지 kit은 `config/parity.json`을 읽고 저장소의 구현들이 서로 어떻게 관계되는지 검사했다. 공유 unit, requirement 인용, test 이름과 id, public symbol, divergence, test marker(parity-check, parity-declarations-check, divergence-check, test-markers-check)이며, CI 파이프라인에 parity job이 있었다. parity 삭제: kit은 구현들이 서로 어떻게 관계되는지 검사하지 않으며, 각 저장소가 자기 테스트를 실행한다.
- **owner 거부.** K1131 전까지 owner-check는 저장소가 무엇을 선언하거나 넘기든, recipe 문장이 ci-targets를 시작하는 target과 make 변수 CHECK_TARGETS의 모든 target을 고르는 규칙을 각각 full suite로 보고 거부했다. 이제는 저장소 자신의 `fullSuite`가 적은 target만 거부한다.
- **Verification cell.** K1132 전까지 docs-check(verification.mts)는 Verification 열이 있는 checklist의 모든 열린 item이 거기에 backtick으로 command를 적기를 요구하고 pipeline을 거부했으며, 다른 checklist 규칙과 달리 저장소의 recipe가 뺄 수 있는 flag가 없었다. docs-check는 command를 요구하지 않으며, `make item-test`는 여전히 cell이 적은 command를 실행한다.
- **규칙 문장.** PRINCIPLES의 `Enforced by:` 줄은 이 검사들(S11, S12, S13, S15 등)을 적었고 각 삭제와 함께 바뀌었다. K1055 전까지 PRINCIPLES의 본문은 모든 저장소를 kit의 파이프라인(S12), kit의 gate(P31), kit에서만 하는 변경에도 묶었다. 이제 배포되는 PRINCIPLES는 kit이 더는 강제하지 않는 검사를 주장하지 않는다.

작동하는 부분은 kit에서 지우는 바로 그 변경에서 `docs/examples/`의 예제가 된다. 삭제는 kit의 새 패치 릴리즈로 나간다. 저장소는 자기가 설치하는 kit 릴리즈를 고정하므로, 새 릴리즈를 받을 때까지 지금 릴리즈를 유지하고, 받을 때 예제를 보고 자기 레시피를 쓴다.
