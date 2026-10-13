<!-- doc-id: rebuild-test-output -->
# Rebuild record: test-output

[한국어](test-output.ko.md)

Verdict: **none fits** for the libtest, unittest and TeamCity readers. Measured on 2026-10-13. No tool of kit reads TAP: the
node runner of parity reports through `parity-node-reporter.mts`, a node:test reporter (K75), so the tap-parser reader of
K125 was removed.

## Covers

- `scripts/kit/test-output.mts`

## Requirement

run-tests prints each test as it starts, keeps running and ends, and parity reads the outcome of each test. Both need the
events of a run as they happen, from the standard runners of S3.

| Item | Format | Requirement |
|---|---|---|
| T2 | `go test -json` | the events of each test and package |
| T3 | cargo test (libtest) text | the start and the result of each test, as they happen |
| T4 | unittest verbose text | the start and the outcome of each test, as they happen |
| T5 | PHPUnit TeamCity messages | the start, the result and the failure text of each test |

## Tools evaluated

| Tool | State | Verdict |
|---|---|---|
| `JSON.parse` per line | Node.js | T2 is one JSON object per line; kit already reads it so, and the event handling is the progress of run-tests |
| teamcity-service-messages (npm) | 0.2.0 | writes TeamCity messages, does not read them (T5); no reader of TeamCity messages was found on npm |
| cargo test `--format json` | nightly only (`-Z unstable-options`) | T3 not on the pinned stable Rust |
| JUnit XML of each runner (gotestsum, nextest, unittest-xml-reporting, `--log-junit`) | various | written when the run ends, not as it runs; the start events of T3–T5 are lost |

## Why none fits

For T3–T5 the runners write no machine format as they run, and no library reads their text or TeamCity output. kit reads the
lines that the standard runners print.

## Retry condition

Revisit T3 when stable cargo test writes JSON, T4 when unittest has a machine format, and T5 when a maintained TeamCity
message reader exists.
