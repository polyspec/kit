<!-- doc-id: rebuild-toolchain -->
# Rebuild record: toolchain

[한국어](toolchain.ko.md)

Verdict: **replaced** — mise with `mise.lock` installs every tool that kit installed with its own release installers (K127).
**None fits** for the three parts that stay with kit: the npm bootstrap, the install of mise itself, and the check of the
toolchains that a repository does not install. This record covers those parts. Measured on 2026-10-13 (K74) and 2026-10-14
(K127, mise 2026.10.8).

## Covers

- `scripts/kit/bootstrap/bootstrap.mts`
- `scripts/kit/bootstrap/install-mise.mts`
- `scripts/kit/bootstrap/install-npm.mts`
- `scripts/kit/bootstrap/install-tool.mts`
- `scripts/kit/bootstrap/tool-wrappers.mts`
- `scripts/kit/bootstrap/toolchain-declared.mts`
- `scripts/kit/check-toolchain.mts`

## Requirement

| Item | Requirement |
|---|---|
| P1 | every downloaded tool is pinned to an exact release with the sha256 of each platform's archive, and the install refuses another archive |
| P2 | the npm of `packageManager` (with its sha512) is installed before `npm ci`, since another npm can rewrite or refuse the lock (S4) |
| P3 | the toolchains that a repository only verifies (Node.js, Rust, PHP) run at their declared versions, checked offline |
| P4 | Go installs on a checkout that has no Go, at the pinned release, and the go directive of each `go.mod` agrees with it |
| P5 | nothing outside the checkout changes: the tools, their caches and their configuration stay under `var/tools` |

## Tools evaluated

| Tool | State | Verdict |
|---|---|---|
| mise with `mise.lock` | 2026.10.8; `mise.toml` declares the tools, `make toolchain-lock` runs `mise lock --global --platform linux-x64,linux-arm64,macos-arm64,macos-x64,windows-x64,windows-arm64`, after locking and installing the uv and the python that `mise.toml` declares, with `UV_PYTHON` set to that python (K836), `make install-tools` runs `mise install --locked` | **replaces** the release installers of Go, Python, uv, ruff, alint, golangci-lint, deadcode, govulncheck, cargo-audit, cargo-nextest, cargo-deny, Composer and vulture (P1, P4, P5); the gaps below are each decided |
| mise for P2 | the `npm:` backend installs with npm | circular: it needs an npm before the pinned npm |
| mise for itself | the npm package `@jdxcode/mise` holds no binary and fetches an unlocked platform package in a preinstall script | none fits: the bootstrap installs mise from its release archive by the sha256 of `config/toolchain.json` `mise` |
| asdf | plugins, no checksums in a lock | out |
| proto | `.prototools`, checksums for its own plugins | covers fewer of the tools above than mise |

The gaps that the measurement found, each with its decision:

- npm stays in the bootstrap, with the sha512 of `packageManager` (P2).
- Composer is one file, so `mise.toml` declares `checksum = "sha256:…"` on its `http:composer` entry, from the
  `composer.phar.sha256sum` of getcomposer.org, and `mise.lock` records it.
- cargo-audit is `"github:rustsec/rustsec" = { version, version_prefix = "cargo-audit/v" }`, which locks the native binaries of
  aarch64-apple-darwin and x86_64-linux with their checksums (the aqua entry gave macos-arm64 the x86_64 binary).
- cargo-nextest is `"github:nextest-rs/nextest" = { version, version_prefix = "cargo-nextest-" }` and cargo-deny is
  `cargo-deny`, the `aqua:EmbarkStudios/cargo-deny` of the registry of mise (K143). `mise lock` pinned the archive of each of
  the four platforms by its sha256, each a native binary (nextest ships one universal binary for both Macs, cargo-deny static
  musl binaries for Linux), measured with mise 2026.10.8 at nextest 0.9.146 and cargo-deny 0.20.2.
- govulncheck and deadcode are built by the `go:` backend, and `mise.lock` records their release only. Their integrity is that
  of Go, which checks every module against its checksum database (`GOSUMDB`, no module exempt) with `GOFLAGS=-mod=readonly`.
- Python: `mise.lock` pins the exact python-build-standalone build by its URL and sha256. uv no longer installs a Python:
  `UV_PYTHON_DOWNLOADS=never`, and the uv of kit runs on the Python of mise (`UV_PYTHON`). `pythonBuild` and `uv` left
  `config/toolchain.json`.
- vulture is a `pypi:` tool: `mise.lock` holds the digest of the uv lock that mise writes under `.mise/locks`. mise builds its
  environment in place, so its console script names the interpreter that exists (the move that broke the script of K77 does
  not occur).
- Rust stays with rustup: `rust-toolchain.toml` with rustup is the Rust ecosystem's own toolchain mechanism, and the rust
  backend of mise drives rustup itself, so a second layer would add nothing.

## Why none fits

P2 is a bootstrap: the pinned npm must exist before any package is installed by npm, and mise must exist before it installs
anything, so the bootstrap installs both from their release files by digest. P3 compares the running tools with their
declarations; mise installs tools and does not verify tools that it does not manage, so `check-toolchain.mts` stays: it runs
each tool of `mise.toml` from its shim, verifies Node.js, Rust and PHP, requires `mise.lock` to pin every tool, and compares
the go and python of `mise.toml` with the pins of kit.

## Retry condition

Revisit P2 when npm or corepack installs the `packageManager` release with its digest, the install of mise when mise ships a
locked package, P3 when mise verifies unmanaged tools against a declaration, and the exception of the `go:` tools when
`mise lock` records a checksum for them.
