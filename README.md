# polyspec/kit

The tools that every polyspec repository shares: the dependency gate and review, the release checks, and the
vendoring of this tree into a repository.

## Layout

- `scripts/kit/` — the tools. A repository holds a copy of this directory at the same path; it is never edited there.
- `scripts/kit/schema/` — the JSON Schema of each configuration file `config/<name>.json` that a repository declares.
- `scripts/kit/kit.mk` — the make targets `kit-sync`, `kit-check` and `kit-test`, included by a repository's Makefile.
- `tests/kit/` — the tests of the tools; `tests/kit/fixture/` is the fixture of the dependency tests.
- `kit.json` — the directories that a repository vendors (`vendored`) and the version of this tree.

## Use in a repository

```sh
make kit-sync KIT_TAG=v0.0.1   # copy the vendored files at the tag and write .kit/kit.lock.json (online)
make kit-check                 # compare the files with the lock and the configuration with the schemas (offline)
make kit-test                  # run the vendored tests (offline)
```

A repository includes `scripts/kit/kit.mk` in its Makefile. `kit-sync` at the same tag changes nothing.
