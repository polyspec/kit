<!-- doc-id: rebuild-holder-lock -->
# Rebuild record: holder-lock

[한국어](holder-lock.ko.md)

Verdict: **none fits.** kit keeps `holder-lock.mts`. Measured on 2026-10-13.

## Covers

- `scripts/kit/holder-lock.mts`

## Requirement

| Item | Requirement |
|---|---|
| L1 | the lock appears atomically with its whole record: checkout, process, its start time, time taken, command, token |
| L2 | the holder is identified by its process ID and the start time of that process, so a reused ID is not the holder |
| L3 | the lock of a running holder is never taken, also while the holder is stopped or slow |
| L4 | the lock of an ended holder stays and is reported until `clear` removes it after a check |
| L5 | only the holder releases the lock, checked by its token |

## Tools evaluated

| Tool | State | Verdict |
|---|---|---|
| proper-lockfile (npm) | 4.1.2, last release 2021 | a directory lock that the holder keeps fresh with a timer; another process takes a lock whose mtime is older than `stale`. Measured: a holder stopped with SIGSTOP lost its lock to a second process after 2 s (`stale: 2000`) while it still existed, against L3; no record (L1) and no start time (L2) |
| lockfile (npm) | deprecated by its author | out |
| `flock` | not in Node.js; needs a native addon | out |

## Why none fits

The Node.js lock libraries decide liveness by a heartbeat and take a stale lock themselves. kit's holders are long runs
(the full suite, a server on fixed ports) that can be stopped without ending, so liveness must come from the process itself,
and an ended holder's lock must stay for a person to check.

## Retry condition

Revisit when a maintained lock library identifies the holder by its process and start time, or Node.js gains a file lock.
