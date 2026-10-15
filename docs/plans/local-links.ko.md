<!-- doc-id: local-links -->
<!-- source-sha256: bb0cc6fb9c89a89104ee9724d638638daffcd27212fb0a01d49ea876a40151c5 -->
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

각 생태계가 허용하는 가장 단순한 방식을 쓴다.

| 생태계 | 링크 |
|---|---|
| npm | 설치 폴더 `node_modules/@polyspec/<pkg>`를 제공자 패키지 폴더를 가리키는 심볼릭 링크로 바꾼다. 제공자의 `dist`가 빌드되어 있어야 한다. |
| Composer | 설치 폴더 `<vendor-dir>/polyspec/<pkg>`를 제공자 패키지 폴더를 가리키는 심볼릭 링크로 바꾼다. `vendor-dir`은 그 vendor를 가진 Composer 프로젝트의 것이다. |
| Python | 저장소 자신의 설치가 만든 가상 환경에 `uv pip install -e <제공자 패키지>`를 한다. |
| Go | 저장소 밖에 둔 `go.work`를 `GOWORK`로 지정하고, 소비자 모듈과 제공자 모듈을 use한다. |
| Rust | cargo 명령마다 `--config`로 `[patch]`와 lock 사본을 가리키는 `resolver.lockfile-path`를 준다. 전역에는 아무것도 쓰지 않는다. |

- 각 패키지의 이름과 제공자 폴더는 제공자 manifest(`package.json`의 `name`, `composer.json`의 `name`, `pyproject.toml`의 `project.name`, `go.mod`의 `module`)에서 읽는다.
- 스크립트: `polyspec/scratch/link/link.sh <dir>...`, `link.sh --check <dir>...`, `unlink.sh <dir>...`, `cargo-linked.sh <dir> <cargo args>`.
- `--check`는 모든 추적 manifest가 선언한 polyspec 의존을 빠짐없이 linked 또는 not linked로 보고한다.
- `unlink.sh`는 각 도구 자신의 설치(`npm ci`, `composer install`, `uv sync`)로 checkout을 되돌린다.

## 알려진 영향

- `npm ci`, `composer install`, `uv sync`를 실행하면(그것을 실행하는 make target 포함) 링크가 풀린다. `link.sh`를 다시 실행하고 `--check`로 확인한다.
- 패키지 관리자는 여전히 릴리스 버전을 기록한다(lock 파일, Composer의 `installed.json`). 설치본을 lock과 비교하는 검사는 링크 중에 실패하므로, 링크를 푼 뒤나 일괄 릴리스 뒤에 실행한다.
- 제공자가 새로 추가한 외부 의존은 소비자에도 설치되어 있어야 한다.
- PHP C 확장은 링크하지 않는다. 빌드된 공유 라이브러리가 필요하기 때문이다.
- 제공자에 더 이상 없는 버전에 고정된 의존(ssr의 ordered-json `=0.0.2`)은 링크할 수 없고, 통합 단계에서 버전을 옮긴다.

## 소유

세션 `link-owner`가 링크를 맡고 레지스트리 `polyspec/scratch/link/REGISTRY.md`를 유지한다. 레지스트리에는 각 세션과 그 폴더, 링크 상태를 적는다. 다른 세션은 자기 폴더에서 `link.sh`를 실행하고 `--check` 결과를 이 세션에 보고한다.

## 종료

개발이 끝나면 모든 checkout의 링크를 풀고, 각 저장소가 새 릴리스로 의존을 한 번 옮긴 뒤 이 문서를 닫는다.
