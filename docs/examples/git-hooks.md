<!-- doc-id: example-git-hooks -->
# Example: Git hooks

[한국어](git-hooks.ko.md)

kit writes no hook and fixes no hooks folder, merge or driver (K1099). A repository that wants a check at commit keeps its own
hooks in a folder of its choice, such as `.githooks`, and names the folder and the hooks to `git-hooks.mts` in its own recipe,
which points `core.hooksPath` at the folder and makes each named hook executable. This page shows one working way; copy it,
change it, or ignore it.

## The `hooks` recipe of the Makefile

```make
HOOK_DECLARATION := --hooks-path .githooks --hook pre-commit --hook commit-msg
hooks:
	$(NODE) $(KIT)/git-hooks.$(KIT_EXT) install $(HOOK_DECLARATION)
hooks-check:
	$(NODE) $(KIT)/git-hooks.$(KIT_EXT) check $(HOOK_DECLARATION)
```

A repository that wants the merge drivers of its changelogs and checklists adds `--merge '<pattern>=<driver>'` and
`--driver '<name>=<command>'`, as the `HOOK_DECLARATION` of kit's `scripts/kit/kit.mk` does.

## `.githooks/pre-commit`

The generated-file check of kit on the staged paths:

```sh
#!/bin/sh
cd "$(git rev-parse --show-toplevel)" || exit 1
exec var/tools/bin/node node_modules/@polyspec/kit/dist/generated-files.mjs staged --binary ELF --binary Mach-O --binary PE
```

## `.githooks/commit-msg`

The message rules of kit on the message being committed:

```sh
#!/bin/sh
cd "$(git rev-parse --show-toplevel)" || exit 1
exec var/tools/bin/node node_modules/@polyspec/kit/dist/check-commits.mjs --message "$1" --rules commit-ai-footer,commit-ai-identity
```

In the checkout of kit itself the sources are `scripts/kit/generated-files.mts` and `scripts/kit/check-commits.mts`.
