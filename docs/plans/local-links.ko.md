<!-- doc-id: local-links -->
<!-- source-sha256: e820c77d7f48e9b5420a4da75e6de845faada42a900276a3bb61f053aebd08a6 -->
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

링크는 kit 도구 `scripts/kit/link.mts`(K201)가 만들고, 각 생태계가 허용하는 가장 단순한 방식을 쓴다.

| 생태계 | 링크 |
|---|---|
| npm | npm 자신의 기록, 곧 npm 프로젝트의 hidden lockfile `node_modules/.package-lock.json`이 나열한 각 사본을 제공자 패키지 폴더를 가리키는 심볼릭 링크로 바꾼다. |
| Composer | Composer 자신의 기록, 곧 소비자 아래 각 vendor(`COMPOSER_VENDOR_DIR`가 둔 것 포함)의 `<vendor>/composer/installed.json`이 `install-path`로 나열한 각 사본을 제공자 패키지 폴더를 가리키는 심볼릭 링크로 바꾼다. 제공자의 autoload 규칙이 설치본과 다르면 `composer dump-autoload`를 실행한다. |
| Python | 환경마다 의존을 포함한 `uv pip install`을 한 번 한다. 선언된 각 polyspec 패키지와 그 아래의 각 polyspec 패키지를 `-e`로 주고, `-e` 줄로 된 `--overrides` 파일을 주어 제공자가 릴리스 URL로 요구하는 형제 패키지도 editable 제공자로 풀리게 한다. 환경은 `VENV`, 없으면 `uv workspace dir`이 출력하는 workspace root의 uv project 환경(`UV_PROJECT_ENVIRONMENT`, 없으면 `.venv`)이다. |
| Go | 소비자의 `var/link/go.work`가 소비자 모듈과 제공자 모듈을 use한다. root가 선언된 동안 `kit.mk`가 그것을 `GOWORK`로 export한다. |
| Rust | `link.mjs cargo <dir> <cargo args>`가 cargo 명령 하나를 `--config` `[patch]`와 `var/link/cargo` 아래 lock 사본을 가리키는 `resolver.lockfile-path`로 실행한다. 전역에는 아무것도 쓰지 않는다. |

- 선언: 환경 변수 `POLYSPEC_CHECKOUTS`가 polyspec root, 곧 각 polyspec 저장소의 main checkout을 담은 폴더를 가리킨다. 없으면 모든 명령은 아무것도 하지 않고 설치는 lock된 릴리스 그대로다.
- 제공자: root 아래 main checkout에 있는 패키지의 각 추적 manifest가 제공하는 것을 밝힌다(private가 아닌 패키지의 `package.json` `name`, `composer.json` `name`, `pyproject.toml` `project.name`, `go.mod` `module`). 연결된 worktree는 제공자가 아니고, 공통 Git 디렉터리로 식별한 소비자 자신의 저장소의 패키지는 그 worktree에서도 링크하지 않는다.
- 빌드: 제공자 저장소는 링크 전에 자기 Makefile에서 릴리스가 빌드하는 target(`release-assets`의 prerequisite), 없으면 `build`로 빌드한다. `link.mjs rebuild <repository>...`는 다시 링크하지 않고 그 자리에서 다시 빌드한다. 링크된 npm 제공자는 그 `package.json`이 가리키는 출력이 없거나, 입력이 가장 오래된 출력보다 새롭고 입력이 마지막 빌드 뒤 기록한 digest(제공자의 `var/link/built/`)와 다르면 STALE이다.
- kit checkout의 명령: `make link`, `make link-check`, `make unlink`(`DIRS`로 다른 소비자 폴더를 지정한다). root가 선언된 동안 `make install-packages`가 끝에 링크하므로 다시 설치하면 스스로 다시 링크된다.
- kit이 없는 곳(consumer 등)의 명령: `node $(POLYSPEC_CHECKOUTS)/kit/dist/link.mjs link|check|unlink <dir>...`, `rebuild <repository>...`, `packages <dir> python|npm`(선언된 polyspec 패키지를 한 줄에 하나씩, root가 없으면 출력 없음), `cargo <dir> <cargo args>`. 도구는 recipe가 주면 `UV`, `GO`, `NPM`, `COMPOSER_BIN`이고, 없으면 소비자의 mise shim이나 `var/tools/bin`이다. root 아래 kit checkout은 한 번 빌드하고(`make build`), 그 뒤로는 이 도구가 `@polyspec/kit`의 제공자로서 kit을 다시 빌드한다.
- lock에서 설치하는 recipe는 설치 직후 같은 recipe 안에서 링크를 실행한다. 예: make할 때마다 `uv sync --frozen`이 도는 `$(PYTHON)` 규칙. 환경을 lock과 비교하는 검사(`uv sync --frozen --check` 등)는 root가 선언된 동안 polyspec 패키지를 빼고 외부 패키지만 정확히 검사한다: `uv sync --frozen --check --inexact`에 `link.mjs packages <dir> python`이 출력한 이름마다 `--no-install-package <name>`을 준다. 링크는 `link.mjs check`가 검사한다.
- `check`는 모든 설치 사본과 선언된 모든 polyspec 의존을 linked, NOT linked, STALE, own(이 저장소)으로 나열한다. NOT linked와 STALE이 있으면 실패한다.
- `unlink`는 각 도구 자신의 설치(`npm ci`, 링크를 지운 뒤 `composer install`, `uv sync --locked`)로 checkout을 되돌리고 `var/link`를 지운다.

## 알려진 영향

- `npm ci`, `composer install`, `uv sync`는 링크를 지운다. kit의 설치 target이나 설치 뒤 링크하는 recipe는 곧바로 다시 링크한다. 그 밖에서는 `link.mjs link`를 다시 실행하고 `link.mjs check`로 확인한다.
- 패키지 관리자는 여전히 릴리스 버전을 기록한다(lock 파일, Composer의 `installed.json`). 설치본을 lock과 비교하는 검사는 링크 중에 실패하므로, 링크를 푼 뒤나 일괄 릴리스 뒤에 실행한다.
- npm은 링크된 패키지 자신의 의존을 제공자 checkout의 `node_modules`에서 찾는다. Composer는 소비자의 vendor에서 찾으므로, 제공자가 새로 요구하는 Composer 패키지는 소비자에도 설치되어 있어야 한다.
- PHP C 확장은 링크하지 않는다. 빌드된 공유 라이브러리가 필요하기 때문이다.
- 제공자에 더 이상 없는 버전에 고정된 의존(ssr의 ordered-json `=0.0.2`)은 링크할 수 없고, 통합 단계에서 버전을 옮긴다.

## 소유

세션 `link-owner`가 링크를 맡고 레지스트리 `polyspec/scratch/link/REGISTRY.md`를 유지한다. 레지스트리에는 각 세션과 그 폴더, 링크 상태를 적는다. 다른 세션은 자기 폴더에서 링크를 실행하고 `link.mjs check` 결과를 이 세션에 보고한다.

## 종료

개발이 끝나면 모든 checkout의 링크를 풀고, 각 저장소가 새 릴리스로 의존을 한 번 옮긴 뒤 이 문서를 닫는다.
