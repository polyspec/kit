<!-- doc-id: example-git-hooks -->
<!-- source-sha256: 6f937084a96c7943d7e19c7f26d7f6fcaff7fc2474cd2be9fda220f6cc086081 -->
# 예제: Git hook

[English](git-hooks.md)

kit은 hook을 쓰지 않고 hook 폴더, merge, driver도 고정하지 않는다(K1099). commit 때 검사를 원하는 저장소는 자기 hook을
`.githooks` 같은 원하는 폴더에 두고, 자기 레시피에서 그 폴더와 hook을 `git-hooks.mts`에 넘긴다. 그러면 `core.hooksPath`가 그
폴더를 가리키고 넘긴 hook이 각각 실행 가능해진다. 이 문서는 작동하는 방법 하나를 보여 준다. 복사하거나, 바꾸거나, 무시하면 된다.

## Makefile의 `hooks` 레시피

```make
HOOK_DECLARATION := --hooks-path .githooks --hook pre-commit --hook commit-msg
hooks:
	$(NODE) $(KIT)/git-hooks.$(KIT_EXT) install $(HOOK_DECLARATION)
hooks-check:
	$(NODE) $(KIT)/git-hooks.$(KIT_EXT) check $(HOOK_DECLARATION)
```

changelog와 checklist의 merge driver를 원하는 저장소는 kit의 `scripts/kit/kit.mk`의 `HOOK_DECLARATION`처럼
`--merge '<pattern>=<driver>'`와 `--driver '<name>=<command>'`를 더한다.

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
exec var/tools/bin/node node_modules/@polyspec/kit/dist/check-commits.mjs --message "$1" --rules commit-ai-footer,commit-ai-identity
```

kit 자신의 checkout에서는 소스가 `scripts/kit/generated-files.mts`와 `scripts/kit/check-commits.mts`다.
