<!-- doc-id: local-links -->
<!-- source-sha256: b52e815db2c5ba17c3063afe72b77a59df54079493f2094bb406b5a470b1792a -->
# 0.0.x 개발의 로컬 링크

[English](local-links.md)

## 상태와 범위

소유자가 2026-10-15에 결정했고 지금 적용 중이다. 범위는 polyspec 버전이 0.0.x인 동안 한 workspace 폴더 안에 나란히 있는 `polyspec/`과 `consumer/`, 곧 polyspec 저장소들과 consumer의 모든 개발 checkout이다.

## 결정

개발은 각 polyspec 저장소의 최신 소스를 대상으로 하고, 그 사이에 릴리스하지 않는다.

- 설치된 polyspec 패키지를 그 패키지를 제공하는 저장소의 소스에 링크한다. 링크는 설치된 릴리스 버전으로 간주한다.
- 릴리스는 개발이 끝난 뒤 의존 순서대로 한 번에 한다: kit → ordered-json → orm, template → crudui → hyper → fsm, template-benchmark.
- 빌드, CI, 일괄 릴리스는 릴리스된 버전을 쓴다. 링크는 로컬 checkout에만 있고 커밋하지 않는다.

이유: 각 저장소가 다른 저장소의 릴리스를 기다리고, 그 저장소가 또 다른 저장소의 릴리스를 기다리면서 개발이 멈췄다. 모든 패키지를 소스에 링크하면 한 변경이 모든 소비자에게 바로 보인다.

## 방식

링크는 kit 도구 `scripts/kit/link.mts`(K201, K201-1)가 만들고, 각 생태계가 허용하는 가장 단순한 방식을 쓴다. 0.0.x로 고정된 패키지만 링크한다: 버전은 각 도구 자신의 기록(npm query, Composer의 `installed.json`, `uv pip list`, `go mod edit -json`의 requirement)에서 읽고, 다른 고정은 `NOT linked (pinned <version>, not 0.0.x)`로 보고하며 실패한다.

| 생태계 | 링크 |
|---|---|
| npm | 소비자의 npm 프로젝트에서 `npm query`가 `node_modules` 아래에 나열한 각 사본을 제공자 패키지 폴더를 가리키는 심볼릭 링크로 바꾼다. `npm query`가 나열하지 않은 사본은 이미 그 링크일 때만 링크로 두고, 아니면 `NOT linked (not recorded by npm query: <folder>)`로 보고한다. 버전을 추측하지 않는다. |
| Composer | 소비자의 각 Composer 프로젝트의 vendor는 `composer config vendor-dir`이 주는 것이다(`COMPOSER_VENDOR_DIR`가 둔 것 포함). 그 `composer/installed.json`이 `install-path`로 나열한 각 사본을 제공자 패키지 폴더를 가리키는 심볼릭 링크로 바꾸고, 링크 여부와 관계없이 `link` 실행마다(`check`는 제외) 그런 프로젝트마다 `composer dump-autoload`를 한 번 실행한다. `installed.json`이 없는 vendor는 `NOT linked (not installed in <vendor>)`로 보고하고, `install-path`가 없는 기록은 `NOT linked`다. 소비자 `composer.json`의 `require`와 `require-dev`에 있는 `polyspec/*` 이름 중 링크된 기록이 없는 것도 `NOT linked`로 보고한다. |
| Python | 각 선언된 polyspec 패키지, 그 아래의 각 polyspec 패키지, 환경의 각 프로젝트(소비자 자신과 polyspec 의존 여부와 무관한 각 workspace member, `[project]` 이름)를 editable wheel(K222, K224)로 설치한다. 환경마다 sync를 하지 않는다(K239). 소비자의 설치가 이미 환경을 sync했고, lock을 sync하면 다른 패키지를 lock의 source에서 다시 설치하기 때문이다. 모든 wheel을 설치 전에 먼저 확인하므로, 하나라도 없으면 환경은 그대로 둔다. 그 뒤 연결된 provider의 wheel들로 `uv pip install --reinstall-package <name> --constraints <file>`을 하고 `--no-deps`는 쓰지 않아 각 checkout의 dependency가 설치된다. 이어서 환경의 프로젝트 wheel들로 `uv pip install --no-deps --reinstall-package <name>`을 한 번 더 한다. 그 dependency는 소비자의 lock sync가 제공한다(K280). 파일은 잠금 파일을 `uv export --frozen --all-groups --no-emit-workspace`로 내보내고 연결된 패키지를 뺀 것이라 잠긴 버전이 모두 유지된다(K237). 없는 wheel은 패키지 폴더(checkout이 아니라 폴더, K224)가 쓰기 가능한 곳에서만 만든다. checkout의 `pyproject.toml` `[build-system]`의 backend로, 격리된 env에서 `uv run --no-project --isolated --with <requires> python -c`가 `build_editable`을 부른다. fingerprint의 wheel이 없는 읽기 전용 폴더는 `NOT linked (stale prebuilt wheel <name> (fingerprint <fp>): run kit link on the host)`로 보고하고 실패한다. 상태는 `uv pip list --format json`(고정, 존재)과 `uv pip freeze`(wheel의 `name @ file:`, PEP 610)에서 읽는다. requirement는 PEP 508과 PEP 735대로 읽는다. 환경은 `VENV`, 없으면 `uv workspace dir`이 출력한 workspace root의 uv 프로젝트 환경(`UV_PROJECT_ENVIRONMENT`, 없으면 `.venv`)이다. |
| Go | 각 Go 모듈 root에 git이 무시하는 `go.work`를 두고, 그 안에 모듈과 제공자 모듈의 `use` 줄을 쓴다. go가 스스로 읽으므로 변수를 설정하지 않는다. `kit.mk`는 릴리스 target과 `dependency-review`에 `GOWORK=off`를 준다. 이 둘은 릴리스된 버전을 쓴다. `unlink`가 파일을 지운다. |
| Rust | `link.mjs cargo <dir> <cargo args>`가 cargo 명령 하나를, 각 제공자가 `config/release.json`에 선언한 URL에 대한 `--config` `[patch]`와, 실행마다 새로 만드는 `var/link/cargo` 아래 추적 lock 사본을 가리키는 `resolver.lockfile-path`로 실행한다. 전역에는 아무것도 쓰지 않는다. |

- Python editable wheel(K222): 제공자의 fingerprint는 checkout의 해석된 절대 경로, `pyproject.toml` 바이트, 그 아래 정렬된 디렉터리를 sha256한 값의 앞 12자리 hex다. 경로를 넣는 이유: editable wheel은 가리키는 경로에 묶이므로, 한 checkout용으로 만든 wheel을 다른 checkout에서 재사용하면 안 된다. 호스트와 컨테이너는 같은 경로를 마운트하므로 같은 wheel을 공유한다. 빌드가 쓰는 것(숨김 폴더, `build`, `dist`, `__pycache__`, `*.egg-info`)은 뺀다. wheel은 소비자의 git-ignored 폴더 `var/link/wheels/<name>/<fingerprint>/`에 둔다. fingerprint는 파일 이름이 아니라 폴더다. wheel 파일 이름은 유효한 PEP 427 이름이어야 하기 때문이다(build tag는 숫자로 시작해야 하고, `name-<hex>.whl`은 Python tag가 없어 uv가 거부한다). `check`는 설치된 wheel의 fingerprint가 현재 checkout의 것과 다르면 실패한다. 이유: setuptools의 PEP 660 빌드는 source tree에 `<name>.egg-info`를 쓰고 그것에 `os.utime`을 부른다. 테스트 컨테이너는 polyspec checkout을 읽기 전용으로 마운트하며, uid 295로 쓰는데 디렉터리는 uid 501 소유에 모드 755라서, 컨테이너 안에서 빌드하는 editable `-e` 설치는 EACCES로 실패한다. 그래서 wheel은 checkout이 쓰기 가능한 곳(호스트)에서 만들고, 컨테이너는 설치만 한다. `-e` 줄과 `--overrides` 파일은 없어졌다. 환경의 각 프로젝트도 같은 종류의 패키지다(K224). fingerprint는 그 폴더 위에서 계산하고, wheel은 `var/link/wheels/<그 이름>/<fingerprint>/`에 둔다. `check`는 그 설치된 wheel을 제공자와 같이 검사한다. sync는 프로젝트를 빌드하지 않는다. `--no-install-project` 없이 `uv sync`를 하면 프로젝트를 제자리에서 빌드하고, 읽기 전용 소비자에서 같은 `os.utime` 이유로 실패하기 때문이다. unlink는 만든 wheel을 남긴다. 캐시이기 때문이다.
- 선언: 변수가 아니라 인자로 준다. `link`와 `check`는 패키지를 제공하는 각 polyspec 저장소의 main checkout을 받는다(`kit link <checkout>...`). `--project <dir>`는 소비자를 밝히고, 없으면 작업 디렉터리 전체 트리가 소비자다. checkout이 없으면 아무것도 링크하지 않고 설치는 lock된 릴리스 그대로다. 어떤 변수도 모드를 고르지 않으므로 빌드와 검사는 링크 여부와 같다.
- 제공자: 인자로 준 main checkout에 있는 패키지의 각 추적 manifest가 제공하는 것을 밝힌다(private 여부와 관계없는 패키지의 `package.json` `name`(private는 게시만 막고 링크는 막지 않는다), `composer.json` `name`, `pyproject.toml` `project.name`, `go.mod` `module`). 연결된 worktree는 제공자가 아니고, 공통 Git 디렉터리로 식별한 소비자 자신의 저장소의 패키지는 그 worktree에서도 링크하지 않는다. 한 이름을 제공하는 패키지 폴더가 둘이면 둘 다 밝히며 실패한다. 서로 다른 checkout의 저장소 root가 둘이어도 마찬가지다. 패키지 폴더 옆의 저장소 root는 개발 프로젝트이므로 양보한다. tests, examples, benchmarks, 문서, config/, .mise, fixture는 아무것도 제공하지 않고 링크하지 않는다. release-consumer 프로젝트는 test다.
- 사본 없음: 제공자를 복사하지 않는다. `node_modules`나 vendor에서 도구의 기록이 나열하지 않는 polyspec 폴더는 plain copy이며 그 경로와 함께 `NOT linked`로 보고한다. `file:` tarball로 설치한 패키지도 다른 설치처럼 링크한다.
- 빌드 없음: `link`는 링크만 한다. 제공자는 `link.mjs rebuild <repository>...`나 그 자신의 target으로, 그 Makefile에서 릴리스가 빌드하는 target(`release-assets`의 prerequisite. 없는 prerequisite이면 make의 오류와 함께 실패한다), 없으면 `build`로 빌드한다. 링크된 npm 제공자는 그 `package.json`이 가리키는 출력이 없거나, 입력이 가장 오래된 출력보다 새롭고 입력이 마지막 rebuild 뒤 기록한 digest(제공자의 `var/link/built/`)와 다르면 STALE이고, `check`는 실패한다.
- 쓰기: 도구가 저장소에 쓰는 각 파일(소비자의 `var/link`, 제공자의 `var/link/built`, 각 Go 모듈의 `go.work`와 `go.work.sum`, Cargo lock 사본)과 설치 폴더를 대신하는 각 링크는 그곳에서 git이 무시하는 것이다(`git check-ignore`). 소비자는 `var/link`, `go.work`, `go.work.sum`을 무시해야 한다. git이 무시하지 않는 경로는 이름과 함께 실패하며, 소비자 밖의 공유 폴더는 없다(K205가 K203의 대체 폴더를 없앴다).
- kit checkout의 명령: `make link CHECKOUTS="<checkout>..."`, `make link-check CHECKOUTS="..."`, `make unlink`이며 각각 `PROJECT=<dir>`로 소비자를 밝힌다(없으면 checkout 전체 트리). `make install-packages`는 빌드도 링크도 하지 않는다(K205). 설치 뒤에는 `make link`를 다시 실행하고 `make link-check`로 확인한다.
- `--project`(S-426): `link`, `check`, `unlink`에 `--project`를 주면 각 `<dir>` 바로 아래의 매니페스트(package.json, composer.json, pyproject.toml, go.mod)만 다루고 중첩 프로젝트는 다루지 않는다. 주지 않으면 `<dir>` 아래 트리 전체를 다룬다. `kit-bootstrap.mk`의 설치 recipe가 이것을 주므로, 설치는 설치한 프로젝트만 정확히 링크한다. 이름을 준 프로젝트가 설치되어 있지 않으면 여전히 실패한다. `--project`일 때 Composer 프로젝트는 `<dir>` 자신이다. 그 vendor는 `<dir>`에서 `composer config vendor-dir`가 주는 것이고, `<dir>`에 composer.json이 없으면 Composer는 관여하지 않으며, `<dir>` 위의 vendor는 절대 취하지 않는다(K201-3).
- 저장소 변수: Git hook은 자기 저장소의 변수(GIT_DIR, GIT_INDEX_FILE 등)를 내보내므로, `link`가 제공자 checkout 같은 다른 저장소에서 실행하는 모든 git 명령과 make는 `git rev-parse --local-env-vars`가 나열한 변수 없이 실행한다. git이 submodule에 들어갈 때와 같다(K201-4).
- kit이 없는 곳(consumer 등)의 명령: `node <kit checkout>/dist/link.mjs link|check [--project <dir>] <checkout>...`, `unlink [--project <dir>]`, `rebuild <repository>...`, `packages <dir> python|npm`(선언된 polyspec 패키지를 한 줄에 하나씩), `cargo [--checkout <checkout>]... <dir> <cargo args>`. 도구는 recipe가 주면 `NPM`, `COMPOSER_BIN`, `UV`, `GO`, `CARGO`이고, 없으면 소비자의 도구(`var/tools/bin/npm`, mise shim, `mise.toml`의 Composer, rustup의 cargo)다. 없는 도구는 그 원인과 함께 실패한다. kit checkout은 한 번 빌드한다(그곳의 `make build`).
- lock에서 설치하는 recipe는 설치 직후 같은 recipe 안에서 링크를 실행한다. 예: make할 때마다 `uv sync --frozen`이 도는 `$(PYTHON)` 규칙. 환경을 lock과 비교하는 검사(`uv sync --frozen --check` 등)는 root가 선언된 동안 polyspec 패키지를 빼고 외부 패키지만 정확히 검사한다: `uv sync --frozen --check --inexact`에 `link.mjs packages <dir> python`이 출력한 이름마다 `--no-install-package <name>`을 준다. 링크는 `link.mjs check`가 검사한다.
- `check`는 모든 설치 사본과 선언된 모든 polyspec 의존을 linked, NOT linked, STALE, own(이 저장소)으로 나열한다. NOT linked와 STALE이 있으면 실패한다.
- `unlink`는 각 도구 자신의 설치(`npm ci`, 링크를 지운 뒤 그 프로젝트에서 `composer install`, `uv sync --locked`)로 checkout을 되돌리고, 링크가 그 소비자를 위해 쓴 파일(`go.work`, `go.work.sum`, Cargo lock 사본)만 지운 뒤(만든 Python wheel은 `var/link/wheels`에 남는다) 비게 된 폴더를 지운다. 폴더를 재귀적으로 지우지 않으므로 중첩된 소비자의 파일은 남으며, 건너뛴 복원을 모두 보고하고 실패한다.

## 알려진 영향

- `npm ci`, `composer install`, `uv sync`는 링크를 지운다. 설치 뒤에는 `link`를 다시 실행하고 `link-check`로 확인한다. `make install-packages`는 링크하지 않는다(K205).
- 패키지 관리자는 여전히 릴리스 버전을 기록한다(lock 파일, Composer의 `installed.json`). 설치본을 lock과 비교하는 검사는 링크 중에 실패하므로, 링크를 푼 뒤나 일괄 릴리스 뒤에 실행한다.
- npm은 링크된 패키지 자신의 의존을 제공자 checkout의 `node_modules`에서 찾는다. Composer는 소비자의 vendor에서 찾으므로, 제공자가 새로 요구하는 Composer 패키지는 소비자에도 설치되어 있어야 한다.
- PHP C 확장은 링크하지 않는다. 빌드된 공유 라이브러리가 필요하기 때문이다.
- 제공자에 더 이상 없는 버전에 고정된 의존(ssr의 ordered-json `=0.0.2`)은 링크할 수 없고, 통합 단계에서 버전을 옮긴다.

## 소유

세션 `link-owner`가 링크를 맡고 레지스트리 `polyspec/scratch/link/REGISTRY.md`를 유지한다. 레지스트리에는 각 세션과 그 폴더, 링크 상태를 적는다. 다른 세션은 자기 폴더에서 링크를 실행하고 `link.mjs check` 결과를 이 세션에 보고한다.

## 종료

개발이 끝나면 모든 checkout의 링크를 풀고, 각 저장소가 새 릴리스로 의존을 한 번 옮긴 뒤 이 문서를 닫는다.
