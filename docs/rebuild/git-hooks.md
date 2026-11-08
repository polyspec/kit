<!-- doc-id: rebuild-git-hooks -->
# Rebuild record: git-hooks

[한국어](git-hooks.ko.md)

Verdict: **none fits.** kit keeps `git-hooks.mts`. Measured on 2026-10-13. Since K1053 kit writes no hook of its own, so H2 is gone.

## Covers

- `scripts/kit/git-hooks.mts`

## Requirement

| Item | Requirement |
|---|---|
| H1 | Git runs the tracked hooks of the folder that the caller names with `--hooks-path` (`core.hooksPath`) |
| H3 | the hooks that the caller names with `--hook` are executable |
| H4 | `make hooks-check` fails while a listed hook is missing or not executable, or `core.hooksPath` is not set |

## Tools evaluated

| Tool | State | Verdict |
|---|---|---|
| lefthook (npm) | 2.1.14 | H1: installs into `.git/hooks`, not a tracked directory, and added a `prepare-commit-msg` hook of its own; H4: `lefthook check-install` exited 0 after the installed `pre-push` was removed |
| husky (npm) | 9.1.7 | H1: sets `core.hooksPath` to `.husky/_` in the npm `prepare` script; no check (H4) |

## Why none fits

What the tools add is the one `git config core.hooksPath` call, which `make hooks` makes. H4, the check that the listed hooks
are in place, is not their concern, so kit would keep it and add a dependency.

## Retry condition

Revisit when a hook manager checks that its hooks are installed and unchanged (H4) and reads a tracked hook directory.
