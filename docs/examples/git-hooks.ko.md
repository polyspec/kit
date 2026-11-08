<!-- doc-id: example-git-hooks -->
<!-- source-sha256: d2ab322ed7bf3a2945abb3b21618e2626f6b5b80bd419e7bfc5a508e48c8eebe -->
# 예제: Git hook

[English](git-hooks.md)

kit은 hook을 쓰지 않는다. commit 때 검사를 원하는 저장소는 자기 hook을 `.githooks` 아래에 두고, `config/checklist.json`에
나열하고, `make hooks`를 실행한다. `make hooks`는 `core.hooksPath`를 `.githooks`로 가리키고 나열된 hook을 각각 실행 가능하게
한다. 이 문서는 작동하는 방법 하나를 보여 준다. 복사하거나, 바꾸거나, 무시하면 된다.

## `config/checklist.json`

```json
{
  "schema": 1,
  "hooks": ["pre-commit", "commit-msg"],
  "idPattern": "K[0-9]+(?:[.-][0-9]+)*"
}
```

## `.githooks/pre-commit`

staged 경로에 대한 kit의 generated 파일 검사:

```sh
#!/bin/sh
cd "$(git rev-parse --show-toplevel)" || exit 1
exec var/tools/bin/node node_modules/@polyspec/kit/dist/generated-files.mjs staged --binary ELF --binary Mach-O --binary PE
```

## `.githooks/commit-msg`

commit되는 메시지에 대한 kit의 메시지 규칙:

```sh
#!/bin/sh
cd "$(git rev-parse --show-toplevel)" || exit 1
exec var/tools/bin/node node_modules/@polyspec/kit/dist/check-commits.mjs --message "$1"
```

kit 자신의 checkout에서는 소스가 `scripts/kit/generated-files.mts`와 `scripts/kit/check-commits.mts`다.
