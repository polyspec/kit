<!-- doc-id: rebuild-git-hooks -->
# Rebuild record: git-hooks

[한국어](git-hooks.ko.md)

Verdict: **none fits.** kit keeps `git-hooks.mts`. Measured on 2026-10-13.

## Covers

- `scripts/kit/git-hooks.mts`

## Requirement

| Item | Requirement |
|---|---|
| H1 | Git runs the tracked hooks of `.githooks` (`core.hooksPath`), with no step a developer can forget |
| H2 | the hooks of kit have the content kit writes, the same in every repository |
| H3 | the other hooks that config/checklist.json lists are executable |
| H4 | `make hooks-check` fails while a hook is missing, changed or not executable, or `core.hooksPath` is not set |

## Tools evaluated

| Tool | State | Verdict |
|---|---|---|
| lefthook (npm) | 2.1.14 | H1: installs into `.git/hooks`, not a tracked directory, and added a `prepare-commit-msg` hook of its own; H4: `lefthook check-install` exited 0 after the installed `pre-push` was removed |
| husky (npm) | 9.1.7 | H1: sets `core.hooksPath` to `.husky/_` in the npm `prepare` script; no check (H4) and no shared content (H2) |

## Why none fits

What the tools add is the one `git config core.hooksPath` call, which kit.mk already makes on every make invocation of a
checkout that tracks `.githooks/pre-commit`. H2 and
H4, the content of the gate hook and the check that it is in place, are not their concern, so kit would keep both and add a
dependency.

## Retry condition

Revisit when a hook manager checks that its hooks are installed and unchanged (H4) and reads a tracked hook directory.
