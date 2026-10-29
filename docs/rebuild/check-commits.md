<!-- doc-id: rebuild-check-commits -->
# Rebuild record: check-commits

[한국어](check-commits.ko.md)

Verdict: **none fits.** kit keeps `check-commits.mts`. Measured for K73 (scratchpad k73, VERDICTS section 6) on 2026-10-13; the
form rules of the message that commitlint was measured against were deleted by K805.

## Covers

- `scripts/kit/check-commits.mts`

## Requirement

| Item | Requirement |
|---|---|
| A1 | commit-ai-footer: the message holds no co-author or session trailer of an AI tool |
| A2 | commit-ai-identity: no AI tool is the author or the committer |
| R1 | commit-red: a commit that moves a checklist row to done states a Red or No-Red line |
| R2 | commit-fix-test: a fix commit changes a test file, or states its red |

## Tools evaluated

| Tool | State | Verdict |
|---|---|---|
| @commitlint/lint | 21.2.3 | A1 maps onto a header or footer pattern of a local plugin. A2 reads the identity that git gives the commit, and R1 and R2 read the checklists and the staged diff, which are outside commitlint |

## Why none fits

R1 and R2 read the checklists and the diff, which no message linter reads, so kit would keep them and add five packages for A1.

## Retry condition

Revisit when a commit-msg tool reads the staged diff and the checklist rows of the change.
