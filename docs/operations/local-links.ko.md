<!-- doc-id: local-links -->
<!-- source-sha256: 881d6ce026cad7a6422ead394cf33e0c93db73d3a9f4a67852affad558a9e56c -->
# 0.0.x 개발의 로컬 링크

[English](local-links.md)

## 상태와 범위

소유자가 2026-10-15에 결정했고 지금 적용 중이다. 범위는 polyspec 버전이 0.0.x인 동안 한 workspace 폴더 안에 나란히 있는 `polyspec/`과 `consumer/`, 곧 polyspec 저장소들과 consumer의 모든 개발 checkout이다.

## 결정

개발은 각 polyspec 저장소의 최신 소스를 대상으로 한다. 모든 저장소의 개발이 끝나기 전에는 아무것도 릴리스하지 않는다: kit을 포함해 어떤 저장소에서도 tag, 버전 올림, release workflow 실행을 하지 않는다. push는 백업이며 아무것도 게시하지 않는다. kit의 변경은 `make build` 뒤에 링크를 통해 다른 checkout에서 보인다.

- 설치된 polyspec 패키지를 그 패키지를 제공하는 저장소의 소스에 링크한다. 링크는 설치된 릴리스 버전으로 간주한다.
- 릴리스는 개발이 끝난 뒤 의존 순서대로 한 번에 한다: kit → ordered-json → orm, template → crudui → hyper → fsm, template-benchmark.
- 빌드, CI, 일괄 릴리스는 릴리스된 버전을 쓴다. 링크는 로컬 checkout에만 있고 커밋하지 않는다.

이유: 각 저장소가 다른 저장소의 릴리스를 기다리고, 그 저장소가 또 다른 저장소의 릴리스를 기다리면서 개발이 멈췄다. 모든 패키지를 소스에 링크하면 한 변경이 모든 소비자에게 바로 보인다.

## 검증

`make link-state-check`(K305-1, P30)는 모든 저장소의 gate이다. link가 설치된 릴리스 버전으로 간주되고 버전은 설치할 때만 검사하므로 version도 요구사항도 비교하지 않는다. link가 있는 동안 0.0.x에 고정된 설치된 polyspec 패키지가 link들 사이의 사본이거나, link가 그 이름의 패키지(npm `package.json`, Composer `composer.json`)로 풀리지 않거나, Composer 패키지가 릴리스 archive 설치 위의 link이거나(`installed.json`의 기록이 `dist` type `path`가 아님), `go.work`의 `use` 폴더에 `go.mod`가 없으면 ecosystem과 패키지를 적어 실패한다. link가 없는 checkout은 통과하므로 릴리스된 패키지를 설치하는 CI는 영향을 받지 않는다. pre-push gate는 link 기록을 계속 거부한다. Composer project가 link된 동안(`composer.link.lock`이 있는 동안) `make dependency-policy-check`는 그 project의 platform과 `composer validate`를 `composer.link.json`과 `composer.link.lock`에서 판단하고, link lock이 다른 dist로 가진 path repository의 polyspec 패키지는 실패시키며, 추적되는 `composer.lock`의 review hash는 일괄 release의 검사에 맡긴다(K326). 연결된 패키지(link lock의 path dist, `node_modules`의 심볼릭 링크)는 `make dependency-review`와 policy 검사에서 registry의 최신 release와 비교하지 않고 외부 패키지는 여전히 비교한다(K328). Composer는 `repositories`를 root manifest에서만 읽으므로, 같은 검사는 polyspec package를 require하는 root `composer.json`에 그 package의 `composer.json`이 선언한 repository(fork 등)가 없으면 둘의 이름과 함께 실패하고, link는 linked package가 선언한 repositories를 `composer.link.json`에 쓴다(K330).

## 방식

링크는 kit 도구 `scripts/kit/link.mts`(K201, K201-1)가 만들고, 각 생태계가 허용하는 가장 단순한 방식을 쓴다. 0.0.x로 고정된 패키지만 링크한다: 버전은 각 도구 자신의 기록(npm query, Composer의 `installed.json`, `uv pip list`, `go mod edit -json`의 requirement)에서 읽고, 다른 고정은 `NOT linked (pinned <version>, not 0.0.x)`로 보고하며 실패한다.

| 생태계 | 링크 |
|---|---|
| npm | 소비자의 npm 프로젝트에서 `npm query`가 `node_modules` 아래에 나열한 각 사본을 제공자 패키지 폴더를 가리키는 심볼릭 링크로 바꾼다. `npm query`가 나열하지 않은 사본은 이미 그 링크일 때만 링크로 두고, 아니면 `NOT linked (not recorded by npm query: <folder>)`로 보고한다. 버전을 추측하지 않는다. |
| Composer | 소비자의 각 Composer 프로젝트의 vendor는 `composer config vendor-dir`이 주는 것이다(`COMPOSER_VENDOR_DIR`가 둔 것 포함). Composer가 연결된 패키지를 스스로 설치한다(K304-1): link는 git이 무시하는 `composer.link.json`(추적되는 `composer.json`의 사본이며, 연결된 패키지마다 `{ "type": "path", "url": <제공자 폴더>, "options": { "symlink": true, "versions": { <이름>: <lock의 릴리스> } } }` path repository를 repositories 앞에 둔다. 그래서 폴더가 릴리스 archive보다 우선한다)과 `composer.link.lock`(없을 때만 `composer.lock`에서 쓰고 그 뒤에는 유지하므로, `UPDATE`가 link lock에 적용한 것은 relink 뒤에도 남는다, K392)을 쓰고, 둘을 `.git/info/exclude`로 Git에서 빼며, `COMPOSER=composer.link.json composer update <연결된 polyspec 패키지와 프로젝트의 path 패키지> --with-dependencies --no-scripts --no-plugins` (K331)를 실행한다. 그 패키지만 자기 폴더에서 resolve되고, 다른 패키지는 lock의 릴리스 그대로이며, 각 설치 폴더는 심볼릭 링크이고, Composer가 쓰는 `installed.json`, autoload 규칙, platform check는 폴더의 `composer.json`에서 나오므로 Composer가 그 설치 시점에 폴더의 버전을 검사한다. 추적되는 `composer.json`과 `composer.lock`은 바뀌지 않는다. `unlink`는 두 link 파일을 지우고 `composer install`을 실행한다. `installed.json`이 없는 vendor는 `NOT linked (not installed in <vendor>)`로, `install-path`가 없는 기록은 `NOT linked`로 보고하고, 소비자의 `composer.json`의 `require`, `require-dev`에 있는 각 `polyspec/*` 이름은 연결된 기록이 없으면 마찬가지로 `NOT linked`로 보고한다. |
| Python | 선언된 각 polyspec 패키지와 그 아래의 각 polyspec 패키지는 link가 `var/link/python`에 쓰는 editable wheel로 환경마다 설치된다(K398). sync는 하지 않는다(K239): 소비자의 install이 이미 환경을 sync했고, lock의 sync는 다른 패키지를 lock의 source에서 다시 설치하므로 link는 sync를 하지 않는다. `uv pip install --reinstall-package <이름> --constraints <파일> --overrides <파일> <wheel>`이 연결된 각 provider의 wheel을 `--no-deps` 없이 설치하므로 각 checkout의 dependency가 잠긴 release로 설치되고, uv가 그 설치 시점에 console script를 쓰고 `Requires-Python`을 검사한다. 환경의 각 프로젝트(소비자 자신과 각 workspace member, polyspec이든 아니든 `[project]` 이름으로)도 같은 방식으로 editable wheel에서 `--no-deps`로 설치되며, 그 dependency는 소비자의 lock sync가 제공한다(K280, K224). link는 프로젝트 폴더에 아무것도 쓰지 않으므로 읽기 전용 프로젝트도 링크된다(K398-1). wheel은 link가 쓰고 build backend는 실행하지 않는다. METADATA는 provider `pyproject.toml`의 `[project]` 표(이름, version, `Requires-Python`, dependency마다 한 `Requires-Dist`)이고, entry point는 `[project.scripts]`이며, `.pth` 하나가 import root를 가리킨다. import root는 `package-dir`의 `""`, 없으면 폴더의 `src`(있을 때), 없으면 폴더다. metadata를 build backend가 계산하는 provider나 프로젝트는 link가 `NOT linked`와 이유를 보고하며 거부한다: 동적 `version`, `dependencies`, `requires-python`, `""`가 아닌 `package-dir`, 코드를 컴파일하는 backend(maturin, scikit-build-core, meson-python, setuptools `ext-modules`). 이런 provider나 프로젝트를 `uv pip install -e`로 대신하지 않는다. 설치 후 link는 배포판의 PEP 610 `direct_url.json`을 `{"url": "file://<폴더>", "dir_info": {"editable": true}}`로 쓴다. 폴더의 editable install을 기록한 것이므로 아래의 상태 확인은 그대로 읽힌다. constraints 파일은 연결된 패키지를 뺀 lock의 `uv export --frozen --all-groups --no-emit-workspace`이므로 잠긴 모든 버전이 유지된다(K237). overrides 파일은 연결된 각 provider를 wheel로 지정하므로 다른 연결된 패키지를 릴리스 URL로 요구하는 패키지와 충돌하지 않고, 프로젝트도 wheel로 지정한다. 환경에 없는 선언된 polyspec 패키지(install recipe의 sync는 polyspec 패키지를 빼고 이전 link의 editable을 제거한다)도 같은 방식으로 폴더의 버전으로 설치하므로 link는 idempotent이다(K316-2). 상태는 환경 자신(PEP 610 `direct_url.json`: 폴더와 `dir_info.editable`)과 `uv pip check`에서 얻는다. 요구사항은 PEP 508과 PEP 735가 정의하는 대로 읽는다. 환경은 `VENV`, 없으면 `uv workspace dir`이 출력하는 workspace root의 uv project 환경(`UV_PROJECT_ENVIRONMENT`, 없으면 `.venv`)이다. |
| Go | 각 Go 모듈 root에 git이 무시하는 `go.work`를 두고, 그 안에 모듈과 제공자 모듈의 `use` 줄을 쓴다. go가 스스로 읽으므로 변수를 설정하지 않는다. `kit.mk`는 릴리스 target과 `dependency-review`에 `GOWORK=off`를 준다. 이 둘은 릴리스된 버전을 쓴다. `unlink`가 파일을 지운다. |
| Rust | `link.mjs cargo <dir> <cargo args>`가 cargo 명령 하나를, 각 제공자가 `config/release.json`에 선언한 URL에 대한 `--config` `[patch]`와, 실행마다 새로 만드는 `var/link/cargo` 아래 추적 lock 사본을 가리키는 `resolver.lockfile-path`로 실행한다. 전역에는 아무것도 쓰지 않는다. |

소비자는 Composer 프로젝트를 `composer install` 대신 `make composer-install DIR=<project>`로 설치한다. 형제 checkout이 그 프로젝트의 `composer.lock`이 가진 polyspec 패키지를 제공하면, link와 같이 `composer.link.json`과 `composer.link.lock`을 쓰고 그것으로 부분 update를 실행하므로, 제공되는 각 패키지는 자기 폴더에서 resolve되고 lock의 릴리스 metadata는 읽히지 않는다. 그런 형제가 없으면(CI처럼) 추적되는 lock의 `composer install`을 실행하며, 두 경로 중 어느 것을 택했는지 출력한다(K432). `installed.json`이 없는 vendor(새 checkout 등)는 `make link-check`에서 `composer.lock`의 polyspec 패키지를 설치를 실행할 때까지 NOT linked로 보고한다.

- 선언: 변수가 아니라 인자로 준다. `link`와 `check`는 패키지를 제공하는 각 polyspec 저장소의 main checkout을 받는다(`kit link <checkout>...`). `--project <dir>`는 소비자를 밝히고, 없으면 작업 디렉터리 전체 트리가 소비자다. checkout이 없으면 아무것도 링크하지 않고 설치는 lock된 릴리스 그대로다. 어떤 변수도 모드를 고르지 않으므로 빌드와 검사는 링크 여부와 같다.
- 제공자: 인자로 준 main checkout에 있는 패키지의 각 추적 manifest가 제공하는 것을 밝힌다(private 여부와 관계없는 패키지의 `package.json` `name`(private는 게시만 막고 링크는 막지 않는다), `composer.json` `name`, `pyproject.toml` `project.name`, `go.mod` `module`). 연결된 worktree는 다른 저장소의 제공자가 아니고, 공통 Git 디렉터리로 식별한 소비자 자신의 저장소의 패키지는 그 worktree에서도 링크하지 않는다. link를 실행하는 work tree(main checkout이나 worktree)가 자기 저장소의 패키지를 own으로 제공하고, 인자 가운데 그 저장소의 checkout은 아무것도 제공하지 않으므로 worktree는 main checkout의 source를 받지 않고 자기 저장소의 checkout을 밝히지 않는다(K385). 한 이름을 제공하는 패키지 폴더가 둘이면 둘 다 밝히며 실패한다. 서로 다른 checkout의 저장소 root가 둘이어도 마찬가지다. 패키지 폴더 옆의 저장소 root는 개발 프로젝트이므로 양보한다. tests, examples, benchmarks, 문서, config/, .mise, fixture는 아무것도 제공하지 않고 링크하지 않는다. release-consumer 프로젝트는 test다.
- 포크(K379): workspace 폴더 안, polyspec checkout들 옆의 `forks/` 아래 각 하위 폴더(`polyspec/kit` 옆의 `forks/json-schema`)가 main checkout(`.git` 디렉터리와 `HEAD`가 있는 것)이면 제공자이며, `link --siblings`가 main checkout과 함께 받는다. 폴더 이름은 패키지 이름이 아니고 origin은 검사하지 않는다. 포크의 origin은 그 포크의 저장소이므로 어떤 URL이어도 되며, `forks/json-schema`는 manifest가 밝힌 패키지(예: `composer.json` `name`인 `opis/json-schema`)를 제공하고 다른 제공자와 같은 manifest를 읽는다. 포크도 다른 제공자처럼 링크하며, 소비자의 고정(pin)은 바꾸지 않는다. 링크는 설치가 기록한 소비자의 버전을 그대로 두고 설치가 그 버전을 검사하며, 위의 0.0.x 고정 규칙은 포크에는 적용되지 않는다. 포크의 고정은 포크 자신의 버전(예: 2.6.0-p1)이며, 설치가 그것을 기록하고 검사하기 때문이다.
- 사본 없음: 제공자를 복사하지 않는다. `node_modules`나 vendor에서 도구의 기록이 나열하지 않는 polyspec 폴더는 plain copy이며 그 경로와 함께 `NOT linked`로 보고한다. `file:` tarball로 설치한 패키지도 다른 설치처럼 링크한다.
- Python wheel(K398): link는 provider나 프로젝트 폴더에 아무것도 쓰지 않으며, 폴더는 읽기 전용이어도 된다. provider의 wheel은 `pyproject.toml`에서 얻은 metadata와, 폴더(또는 `src`)를 가리키는 `.pth`만 담으므로 모든 import는 폴더 자신을 읽는다. 이것이 K316의 "아무것도 복사하지 않는다"는 규칙을 깨지 않는 이유는 다음과 같다. wheel은 source의 복사본이 아니고, metadata는 editable install이 어차피 폴더 밖(`*.dist-info`)에 두는 정보와 같다. `pyproject.toml`이 바뀌면 metadata는 모든 editable install의 metadata와 마찬가지로 낡아지며, link는 그 provider의 다음 설치 때 새 wheel을 쓴다.
- 빌드 없음: `link`는 링크만 한다. 제공자는 `link.mjs rebuild <repository>...`나 그 자신의 target으로, 그 Makefile에서 릴리스가 빌드하는 target(`release-assets`의 prerequisite. 없는 prerequisite이면 make의 오류와 함께 실패한다), 없으면 `build`로 빌드한다. 링크된 npm 제공자는 그 `package.json`이 가리키는 출력이 없거나, 입력이 가장 오래된 출력보다 새롭고 입력이 마지막 rebuild 뒤 기록한 digest(제공자의 `var/link/built/`)와 다르면 STALE이고, `check`는 실패한다.
- 쓰기: 도구가 저장소에 쓰는 각 파일(소비자의 `var/link`, 제공자의 `var/link/built`, 각 Go 모듈의 `go.work`와 `go.work.sum`, Cargo lock 사본)과 설치 폴더를 대신하는 각 링크는 그곳에서 git이 무시하는 것이다(`git check-ignore`). 소비자는 `var/link`, `go.work`, `go.work.sum`을 무시해야 한다. git이 무시하지 않는 경로는 이름과 함께 실패하며, 소비자 밖의 공유 폴더는 없다(K205가 K203의 대체 폴더를 없앴다).
- kit checkout의 명령: `make link CHECKOUTS="<checkout>..."`, `make link-check CHECKOUTS="..."`, `make unlink`이며 각각 `PROJECT=<dir>`로 소비자를 밝힌다(없으면 checkout 전체 트리). `make install-packages`는 설치만 하고(K205, K360-1), `make install`은 도구와, link가 읽는 환경을 설치하는 저장소의 단계 뒤에 `make install-link`로 마지막에 링크한다(K360-2). 다른 설치 뒤에는 `make link`를 다시 실행하고 `make link-check`로 확인한다.
- `--project`(S-426): `link`, `check`, `unlink`에 `--project`를 주면 각 `<dir>` 바로 아래의 매니페스트(package.json, composer.json, pyproject.toml, go.mod)만 다루고 중첩 프로젝트는 다루지 않는다. 주지 않으면 `<dir>` 아래 트리 전체를 다룬다. `kit-bootstrap.mk`의 설치 recipe가 이것을 주므로, 설치는 설치한 프로젝트만 정확히 링크한다. 이름을 준 프로젝트가 설치되어 있지 않으면 여전히 실패한다. `--project`일 때 Composer 프로젝트는 `<dir>` 자신이다. 그 vendor는 `<dir>`에서 `composer config vendor-dir`가 주는 것이고, `<dir>`에 composer.json이 없으면 Composer는 관여하지 않으며, `<dir>` 위의 vendor는 절대 취하지 않는다(K201-3).
- 저장소 변수: Git hook은 자기 저장소의 변수(GIT_DIR, GIT_INDEX_FILE 등)를 내보내므로, `link`가 제공자 checkout 같은 다른 저장소에서 실행하는 모든 git 명령과 make는 `git rev-parse --local-env-vars`가 나열한 변수 없이 실행한다. git이 submodule에 들어갈 때와 같다(K201-4).
- kit이 없는 곳(consumer 등)의 명령: `node <kit checkout>/dist/link.mjs link|check [--project <dir>] <checkout>...`, `unlink [--project <dir>]`, `rebuild <repository>...`, `packages <dir> python|npm`(선언된 polyspec 패키지를 한 줄에 하나씩), `cargo [--siblings] [--checkout <checkout>]... <dir> <cargo args>`; `--siblings`는 프로젝트 옆의 checkout을 쓰고, `make cargo-fetch DIR=<project>`는 `cargo --siblings <dir> fetch --locked`다 (K448-5).. 도구는 recipe가 주면 `NPM`, `COMPOSER_BIN`, `UV`, `GO`, `CARGO`이고, 없으면 소비자의 도구(`var/tools/bin/npm`, mise shim, `mise.toml`의 Composer, rustup의 cargo)다. 없는 도구는 그 원인과 함께 실패한다. kit checkout은 한 번 빌드한다(그곳의 `make build`).
- lock에서 설치하는 recipe는 링크할 수 있는 곳에서, install chain 밖에서 설치 직후 같은 recipe 안에서 링크를 실행한다(K349-2). 이 규칙은 저장소가 polyspec 의존성을 선언하는 ecosystem에 적용되며(kit은 선언하지 않는다), `make install`이 prerequisite나 `$(MAKE)` 호출로 이르는 recipe는 `install`의 마지막 `install-link` 하나가 다룬다(K360-2). lock에서 다시 설치하는 generator처럼 그 chain 밖의 recipe는 자기 직후에 링크한다. 예: make할 때마다 `uv sync --frozen`이 도는 `$(PYTHON)` 규칙. 환경을 lock과 비교하는 검사(`uv sync --frozen --check` 등)는 root가 선언된 동안 polyspec 패키지를 빼고 외부 패키지만 정확히 검사한다: `uv sync --frozen --check --inexact`에 `link.mjs packages <dir> python`이 출력한 이름마다 `--no-install-package <name>`을 준다. 링크는 `link.mjs check`가 검사한다.
- `check`는 모든 설치 사본과 선언된 모든 polyspec 의존을 linked, NOT linked, STALE, own(이 저장소)으로 나열한다. NOT linked와 STALE이 있으면 실패한다.
- `unlink`는 각 도구 자신의 설치(`npm ci`, 링크를 지운 뒤 그 프로젝트에서 `composer install`, `uv sync --locked`)로 checkout을 되돌리고, 링크가 그 소비자를 위해 쓴 파일(`go.work`, `go.work.sum`, Cargo lock 사본, `composer.link.json`, `composer.link.lock`)만 지운 뒤 비게 된 폴더를 지운다. 폴더를 재귀적으로 지우지 않으므로 중첩된 소비자의 파일은 남으며, 건너뛴 복원을 모두 보고하고 실패한다.

## Worktree

- worktree가 필요한 row는 main checkout에서 `make worktree-setup NAME=<name> ID=<id> [TYPE=<type>]`로 그것을 얻는다(K348). `main`에서 branch `<type>/<name>-<id>`의 worktree `../<repository>-<name>-<id>`를 만들고(P10), 자기 source로 `make install`(도구와 패키지, 저장소의 단계, 그다음 링크)을 실행해 설치하고, `make link-state-check`로 검사한다. 같은 worktree에서 다시 실행하면 다시 설치하고 검사하므로 실행 결과는 같은 상태이다.
- kit checkout `../kit` 옆의 checkout에서는 bootstrap이 첫 make부터 link가 설치하는 provider인 `../kit/dist`를 `KIT`로 쓰므로 새 worktree는 `npm ci` 전에 `kit.mk`를 읽고 자신이 개발하는 kit의 도구로 설치한다. build되지 않은 kit checkout이면 `make build in ../kit`과 함께 실패한다(K348-1). 없으면 CI처럼 `KIT`는 설치된 package이다.
- 여유 disk가 30 GB 미만이면 worktree를 만들지 않는다(`scripts/kit/worktree-setup.mts`의 `WORKTREE_DISK_FLOOR`).
- worktree의 install directory(`node_modules`, `vendor`, `.venv`, `target`, `var`)는 자기 것이며 다른 checkout으로의 symbolic link가 아니므로 그 test는 자기 source를 실행한다(K375). mise의 도구는 그런 install이 아니다. worktree는 그 저장소의 main checkout이 설치한 mise의 도구를 읽으므로(`MISE_SHARED_INSTALL_DIRS`) main checkout에 없는 도구만 설치하며, data dir, state, shim, wrapper는 자기 것으로 남는다(K387).
- `main`에는 commit하지 않는다. `make hooks`가 쓰는 commit-msg hook이 `HEAD`가 `main`인 동안의 commit을 거부하므로(K404), 등록, 닫기, gate 수정도 그 row의 branch에서 commit하고, `make land`는 commit을 만들지 않는 fast-forward로 branch를 merge한다. `main`을 만드는 저장소의 첫 commit만 예외이다.
- worktree와 branch는 branch가 `main`에 merge되면 바로 지운다. `make land`는 land한 branch를 지우고, `make worktree-prune`은 자기 commit(reflog가 기록한 생성 지점 이후의 commit)이 모두 `main`에 있는 branch를 모두 지우며, 그 worktree에 commit하지 않은 변경이 없으면 worktree도 지운다. 자기 commit이 없는 새 branch는 남긴다. merge된 branch가 남아 있는 동안 `make link-state-check`는 실패한다(K381).

## 알려진 영향

- `npm ci`, `composer install`, `uv sync`는 링크를 지운다. 설치 뒤에는 `link`를 다시 실행하고 `link-check`로 확인한다. `make install`은 저장소 옆에 polyspec checkout이 있으면 도구와 저장소의 단계 뒤의 마지막 단계 `make install-link`로 설치한 패키지를 그것에 링크하고(`link --siblings`, K349, K360-1, K360-2), 옆에 kit checkout이 있으면 그 link를 쓴다(K360). `CHECKOUTS` 없는 `make link`와 `make link-check`도 worktree에서까지 그 checkout을 쓴다(K383). lock에서 설치하는 recipe에 그 뒤의 link 단계가 없거나 linked vendor의 platform check가 `.php-version`보다 새 PHP를 요구하면 `make link-state-check`가 실패한다(K384).
- 패키지 관리자는 여전히 릴리스 버전을 기록한다(lock 파일, Composer의 `installed.json`). 설치본을 lock과 비교하는 검사는 링크 중에 실패하므로, 링크를 푼 뒤나 일괄 릴리스 뒤에 실행한다.
- npm은 링크된 패키지 자신의 의존을 제공자 checkout의 `node_modules`에서 찾는다. Composer는 소비자의 vendor에서 찾으므로, 제공자가 새로 요구하는 Composer 패키지는 소비자에도 설치되어 있어야 한다.
- PHP C 확장은 링크하지 않는다. 빌드된 공유 라이브러리가 필요하기 때문이다.
- 제공자에 더 이상 없는 버전에 고정된 의존(ssr의 ordered-json `=0.0.2`)은 링크할 수 없고, 통합 단계에서 버전을 옮긴다.

## 소유

세션 `link-owner`가 링크를 맡고 레지스트리 `polyspec/scratch/link/REGISTRY.md`를 유지한다. 레지스트리에는 각 세션과 그 폴더, 링크 상태를 적는다. 다른 세션은 자기 폴더에서 링크를 실행하고 `link.mjs check` 결과를 이 세션에 보고한다.

## 종료

개발이 끝나면 모든 checkout의 링크를 풀고, 각 저장소가 새 릴리스로 의존을 한 번 옮긴 뒤 이 문서를 닫는다.
