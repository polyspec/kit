<!-- doc-id: agents -->
<!-- source-sha256: 3ce3a7f8cb70ee4dd8446d2a541fd2f38a8e6f67f11a5d783033a157a30e4cd6 -->
# 개발

[English](AGENTS.md)

## 목적

kit은 모든 polyspec 저장소가 공유하는 도구를 담습니다. release, 의존성, push-gate, 문서, 설치 도구입니다. 저장소는 `scripts/kit/`와
`tests/kit/`(`kit.json`에 나열)의 사본을 byte 단위로 같게 두며, 사본은 `make kit-sync`가 씁니다. 저장소끼리 다른 것은
`config/*.json`뿐입니다. kit은 어느 저장소에도 의존하지 않습니다.

## 규칙

- 영어 문서가 정본입니다. 모든 문서에는 같은 정보를 담은 `.ko.md` 파일이 있으며, 두 파일을 한 변경에서 함께 고칩니다. 한국어 파일의
  개정 표식 `source-sha256`은 영어 파일의 sha256입니다. 한국어 문서는 기술 용어를 영어로 씁니다.
- 도구는 Node 내장 모듈(`node:`)과 같은 디렉터리의 파일만 import합니다. fixture와 `tests/kit/isolation.test.mjs`를 뺀 어떤 도구나 테스트도
  다른 저장소의 이름을 쓰지 않습니다. 저장소마다 다른 값은 `config/<name>.json`의 데이터이며, schema는 `scripts/kit/schema/`에 있습니다.
  schema 검증기는 자신이 나열한 키워드만 지원합니다.
- vendored 파일은 kit에서 고치고 `make kit-sync KIT_TAG=<tag>`로 복사합니다. 저장소에서 직접 고치지 않으며, 고치면 `make kit-check`가
  바뀐 파일, 빠진 파일, 예상하지 못한 파일로 실패합니다.
- 두 도구가 필요로 하는 함수나 상수는 둘 다 import하는 `scripts/kit/`의 module 하나에 둡니다. `tests/kit/duplication.test.mjs`는 서로 다른 두 파일이
  6줄 이상의 같은 함수를 가지면 실패합니다.
- 테스트는 `tests/kit/`에 있고, stub 명령과 fixture `tests/kit/fixture`로 오프라인에서 실행하며, 각 테스트는 동작이 깨지면 실패합니다. 결함은
  재현하는 실패 테스트를 먼저 추가하고, 고치고, 테스트를 유지합니다.
- Python을 실행하는 consumer는 config/toolchain.json에 `pythonBuild`를 선언하고 `make install-tools`로 Python을 설치합니다. wheel을
  배포하는 consumer는 `pythonBackend`도 선언합니다. vendored test는 consumer의 선언을 이 규칙으로만 검사합니다. kit 자신의 실제
  Python과 wheel 경로 test는 `tests/source`에 있습니다. kit-sync가 vendor하지 않으며, `make source-test`가 실행하고 CI는
  `make kit-test` 뒤에 실행합니다.
- 모든 검사는 같은 tree에 같은 결과를 냅니다. 도구는 임시 파일과 rename으로 쓰고, 단계마다 한 줄을 출력하며, 시간 제한이 없습니다. 테스트
  case는 자기 timeout을 가집니다. 네트워크 조회는 `dependency-review`, `kit-sync`, 설치 도구만 하고, 결과는 commit된 기록입니다.
- 하위 호환성은 유지하지 않습니다: 호환 layer, fallback, migration을 더하지 않고 옛 경로를 제거합니다.
- 현재 요구를 완전히 충족하는 가장 단순한 구현을 씁니다. 불확실한 미래를 위한 추상화, 설정, 간접 계층을 두지 않습니다.
- 각 관심사를 자기 module에 분명히 분리한 modular component로 만듭니다.
- architecture는 장기적으로 정합니다: 지금은 동작하지만 나중에 교체해야 하는 임시방편은 받아들이지 않습니다.
- 주석, 문서, commit message는 동작과 그 대상을 밝히는 직접적인 표현으로 씁니다.

## 체크리스트

`docs/plans/execution-checklist.ko.md`가 유일한 체크리스트입니다. 작업은 `[ ]` 대기, `[~]` 진행 중, `[o]` 완료, `[!] cause: <cause>; retry: <condition>`
우회, `[-] cause: <cause>` 불가입니다. 작업은 그것을 끝내는 commit에서, 소유 명령이 통과한 뒤 `[o]`가 됩니다. commit message는 `type(scope): Subject (#task)`이며
subject는 50자 이하, body는 72자로 줄바꿈하고, type은 `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`입니다.

## 릴리스

kit은 `main`의 commit 중 `ci` 실행이 success로 끝난 commit에 tag `vX.Y.Z`를 붙여 릴리스합니다. `kit.json`이 tree의 버전을 가집니다. 저장소는
`make kit-sync KIT_TAG=vX.Y.Z`로 릴리스를 채택합니다.

릴리스 tag는 annotated tag입니다: `git tag -a vX.Y.Z -m vX.Y.Z`로 만듭니다. `release-verify`는 object 종류
(`git cat-file -t <tag>`)가 `tag`가 아닌 tag를 거부하고, tag 이름과 그 종류를 적은 줄을 출력합니다(lightweight tag는 `commit`).
이미 게시된 tag는 옮기지 않으며, 검사는 릴리스되는 tag에만 실행합니다.

kind `wheel` package(`pyproject.toml`을 가진 Python package)는 PEP 427 wheel `<distribution>-<version>-py3-none-any.whl`로 릴리스되며,
이 파일 이름을 pip이 파싱합니다. `release-assets`는 tag된 commit에서 이 wheel을 만들고, build backend는 config/release.json의
`buildBackend`가 정확한 requirement와 wheel의 sha256으로 고정합니다. `make release-backend`는 그 wheel을 digest를 확인하며
`var/tools/wheels`에 받고, 어떤 build도 network를 읽지 않습니다. `Requires-Dist`가 plain `name==version`이 아닌 wheel(URL, git source,
범위, marker)은 거부합니다. 같은 형식의 npm 또는 Composer manifest를 거부하는 것과 같습니다. `release-consumer`는 wheel을
`pip install --no-index --require-hashes --no-deps`로 깨끗한 virtual environment에 설치하고 그 smoke command를 실행합니다.
Python package는 git tag로 릴리스하지 않습니다.
