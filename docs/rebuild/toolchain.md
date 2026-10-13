<!-- doc-id: rebuild-toolchain -->
# Rebuild record: toolchain

[한국어](toolchain.ko.md)

Verdict: **replace** the release installers with mise and its lock (K127, deferred: until it lands kit installs the releases itself); **none fits** for the npm bootstrap
and the verification of the toolchains that a repository does not install. This record covers the part that stays. Measured
on 2026-10-13.

## Covers

- `scripts/kit/bootstrap/bootstrap-npm.mts`
- `scripts/kit/bootstrap/install-npm.mts`
- `scripts/kit/bootstrap/toolchain-declared.mts`
- `scripts/kit/check-toolchain.mts`

## Requirement

| Item | Requirement |
|---|---|
| P1 | every downloaded tool is pinned to an exact release with the sha256 of each platform's archive, and the install refuses another archive |
| P2 | the npm of `packageManager` (with its sha512) is installed before `npm ci`, since another npm can rewrite or refuse the lock (S4) |
| P3 | the toolchains that a repository only verifies (Node.js, Rust, PHP) run at their declared versions, checked offline |
| P4 | Go installs on a checkout that has no Go, at the pinned release, and the go directive of each `go.mod` agrees with it |

## Tools evaluated

| Tool | State | Verdict |
|---|---|---|
| mise with `mise.lock` | 2026.9.16 (2026-09-28); the lock page no longer marks it experimental | P1 for node, go, python, uv, ruff, alint and cargo-audit: `mise lock` wrote the sha256 of each platform archive; the uv digests equal kit's pins. Gaps: govulncheck (`go:` backend) and `npm:npm` record the version only; the `http:` Composer entry has no checksum unless declared; for macos-arm64 the aqua entry of cargo-audit is the x86_64 binary; the python build is the newest python-build-standalone build (20261009), not the one uv 0.12.24 names. **Replace** the release installers, with these gaps declared |
| mise for P2 | the `npm:` backend installs with npm | circular: it needs an npm before the pinned npm |
| asdf | plugins, no checksums in a lock | out |
| proto | `.prototools`, checksums for its own plugins | covers fewer of the tools above than mise |

## Why none fits

P2 is a bootstrap: the pinned npm must exist before any package, mise included, is installed by npm. P3 compares the running
tools with their declarations; mise installs tools and does not verify tools it does not manage. For P4, kit installs the Go
of its pin from the official archive with the sha256 that it pins next to the release, so no Go and no reader of go.mod is
needed before Go is installed; `go mod edit -json` of the installed Go then reads each go.mod for toolchain-check.

## Retry condition

Revisit P2 when npm or corepack installs the `packageManager` release with its digest, and P3 when mise verifies unmanaged
tools against a declaration.
