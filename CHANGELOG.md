<!-- doc-id: changelog -->
# Changelog

[한국어](CHANGELOG.ko.md)

Each release `vX.Y.Z` of kit has a section `## X.Y.Z`; its text is the notes of the GitHub Release, which carries the npm asset
`polyspec-kit-npm-X.Y.Z.tgz` of `@polyspec/kit`.

## Unreleased

- Each release tag publishes the npm asset `polyspec-kit-npm-<version>.tgz` of `@polyspec/kit`, which holds `scripts/kit`; a
  consumer imports a module as `@polyspec/kit/<module>.mjs` (K55).
- `installPython`, `makeVenv` and `venvProblem` take the install prefix, the wrapper file and the interpreter's home from the caller
  as absolute paths; kit's own targets pass `checkoutPython(root)` (K56).
- `lockRequirements` takes an optional map from the archive URL of a lock entry to a local file and renders each polyspec archive as
  `name @ file:///<path> --hash=sha256:<hex>`, checked against the sha256 of the lock (K57).
