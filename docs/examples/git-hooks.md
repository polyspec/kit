<!-- doc-id: example-git-hooks -->
# Example: Git hooks

[한국어](git-hooks.ko.md)

kit writes no hook. A repository that wants a check at commit keeps its own hooks under `.githooks`, lists them in
`config/checklist.json`, and runs `make hooks`, which points `core.hooksPath` at `.githooks` and makes each listed hook
executable. This page shows one working way; copy it, change it, or ignore it.

## `config/checklist.json`

```json
{
  "schema": 1,
  "hooks": ["pre-commit", "commit-msg"],
  "idPattern": "K[0-9]+(?:[.-][0-9]+)*"
}
```

## `.githooks/pre-commit`

The generated-file check of kit on the staged paths:

```sh
#!/bin/sh
cd "$(git rev-parse --show-toplevel)" || exit 1
exec var/tools/bin/node node_modules/@polyspec/kit/dist/generated-files.mjs staged
```

## `.githooks/commit-msg`

The message rules of kit on the message being committed:

```sh
#!/bin/sh
cd "$(git rev-parse --show-toplevel)" || exit 1
exec var/tools/bin/node node_modules/@polyspec/kit/dist/check-commits.mjs --message "$1"
```

In the checkout of kit itself the sources are `scripts/kit/generated-files.mts` and `scripts/kit/check-commits.mts`.
