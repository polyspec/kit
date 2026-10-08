<!-- doc-id: agents -->
<!-- source-sha256: 146d9cbb7e860d44b272d30b0c825d5f7f2e48ac3a5d1594ee83148844ace8e3 -->
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
- 모든 검사는 같은 tree에 같은 결과를 냅니다. 도구는 임시 파일과 rename으로 쓰고, 단계마다 한 줄을 출력하며, 시간 제한이 없습니다. 테스트
  case는 자기 timeout을 가집니다. 네트워크 조회는 `dependency-review`, `kit-sync`, 설치 도구만 하고, 결과는 commit된 기록입니다.
- 하위 호환성은 유지하지 않습니다. 현재 요구를 충족하는 가장 단순한 구현을 씁니다. 주석, 문서, commit message는 동작과 그 대상을 밝히는 직접적인
  표현으로 씁니다.

## 체크리스트

`docs/plans/execution-checklist.ko.md`가 유일한 체크리스트입니다. 작업은 `[ ]` 대기, `[~]` 진행 중, `[o]` 완료, `[!] cause: <cause>; retry: <condition>`
우회입니다. 작업은 그것을 끝내는 commit에서, 소유 명령이 통과한 뒤 `[o]`가 됩니다. commit message는 `type(scope): Subject (#task)`이며
subject는 50자 이하, body는 72자로 줄바꿈하고, type은 `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`입니다.

## 릴리스

kit은 `main`의 commit 중 `ci` 실행이 success로 끝난 commit에 tag `vX.Y.Z`를 붙여 릴리스합니다. `kit.json`이 tree의 버전을 가집니다. 저장소는
`make kit-sync KIT_TAG=vX.Y.Z`로 릴리스를 채택합니다.
