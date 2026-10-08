# polyspec/kit

모든 polyspec 저장소가 공유하는 도구입니다. 의존성 게이트와 검토, 릴리즈 검사, 이 트리를 각 저장소에 복사하는 절차를 담습니다.

## 구조

- `scripts/kit/` — 도구입니다. 각 저장소는 같은 경로에 이 디렉터리의 사본을 둡니다. 사본은 편집하지 않습니다.
- `scripts/kit/schema/` — 각 저장소가 선언하는 설정 파일 `config/<name>.json`의 JSON Schema입니다.
- `scripts/kit/kit.mk` — 저장소의 Makefile이 include하는 `kit-sync`, `kit-check`, `kit-test` target입니다.
- `tests/kit/` — 도구의 테스트입니다. `tests/kit/fixture/`는 의존성 테스트의 픽스처입니다.
- `kit.json` — 저장소가 복사하는 디렉터리(`vendored`)와 이 트리의 버전입니다.

## 저장소에서 사용

```sh
make kit-sync KIT_TAG=v0.0.1   # tag의 vendored 파일을 복사하고 .kit/kit.lock.json을 씁니다(온라인)
make kit-check                 # 파일을 lock과, 설정을 schema와 비교합니다(오프라인)
make kit-test                  # vendored 테스트를 실행합니다(오프라인)
```

저장소는 Makefile에서 `scripts/kit/kit.mk`를 include합니다. 같은 tag로 `kit-sync`를 다시 실행하면 아무것도 바뀌지 않습니다.
