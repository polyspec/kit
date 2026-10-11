<!-- doc-id: changelog -->
# Changelog

[한국어](CHANGELOG.ko.md)

Each release `vX.Y.Z` of kit has a section `## X.Y.Z`; its text is the notes of the GitHub Release, which carries the npm asset
`polyspec-kit-npm-X.Y.Z.tgz` of `@polyspec/kit`.

## Unreleased

- kit declares the MIT License in `LICENSE` and in `package.json` of `@polyspec/kit` (K59).
- The parity check reports a case that one run reports twice as an R3 finding. The parsers of the node:test, unittest, PHPUnit, cargo
  and go outputs move into `test-output.mjs`, which run-tests and the parity check share, and a suite unit declares `admit`, the
  implementations that admit each case. phpunit becomes an install-tools tool (K47).
- A wheel names a sibling, another wheel package of the same release, by its release asset without a hash; the check refuses a sibling
  with a #sha256 fragment, as name==version, at another version or repository, with another file name or in the wheel's lock, and
  release-proof checks each sibling URL against the published asset (K52).
- `make dependency-review` names the packages of each Go module to govulncheck instead of `./...`, which walked the Go toolchain in
  var/tools and failed (K53).
- Each release tag publishes the npm asset `polyspec-kit-npm-<version>.tgz` of `@polyspec/kit`, which holds `scripts/kit`; a
  consumer imports a module as `@polyspec/kit/<module>.mjs` (K55).
- `installPython`, `makeVenv` and `venvProblem` take the install prefix, the wrapper file and the interpreter's home from the caller
  as absolute paths; kit's own targets pass `checkoutPython(root)` (K56).
- `lockRequirements` takes an optional map from the archive URL of a lock entry to a local file and renders each polyspec archive as
  `name @ file:///<path> --hash=sha256:<hex>`, checked against the sha256 of the lock (K57).
- No module of the package acts when it is imported: `check-dependency-policy-mutation.mjs` runs its check only as the command, and
  the exports map refuses the run-tests preload `test-load-check.mjs`, which the package holds for run-tests (K58).
