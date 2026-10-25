<!-- doc-id: operations-release-structure -->
# Release structure

[한국어](release-structure.ko.md)

The review of K194: how kit reaches the repositories that use it, what a change of kit costs them, and the structure that each
part takes from now on. It reads the state of kit 0.0.54 after the completion push of 2026-10-23.

## What a change of kit costs today

kit is one npm package, `@polyspec/kit`, with one version for its rules, tools, configurations and bootstrap. At 0.0.x every
repository links the package to the kit checkout beside it (`make link`, docs/operations/local-links.md), so a change of a tool
or a rule reaches every repository at once through `dist/`, with no release. Two kinds of change still cost every repository a
step:

- a change of a file that `make kit-sync` copies into each repository (`kit.copies` of package.json): every repository needs a
  kit-sync row, or kit-check fails there; on 2026-10-23 one line of `scripts/kit/bootstrap/install-mise.mts` (K532) cost seven
  kit-sync rows;
- a change of a file that a consumer extends or names by path, when the path changes: the seven `api-extractor.json` files of
  crudui extended the retired copy `config/api-extractor.kit.json` until C17.11 and C17.11-1.

K514 already moved the lint configurations out of the copies: each lint reads its configuration from the package
(`kitFile`), so a change of a lint configuration costs no repository anything.

## The copies, by whether a tool needs them in the repository

| Copy | Needed in the repository | Structure |
| --- | --- | --- |
| `scripts/kit/kit-bootstrap.mk`, `scripts/kit/bootstrap/*.mts` (9 files) | yes: they run before the package is installed (`make install-tools TOOLS=npm`, `make install-packages`) | the stable bootstrap layer |
| `.github/workflows/gates.yml`, `.github/workflows/release.yml` | yes: GitHub reads a workflow from the repository | a caller of a reusable workflow of kit |
| `.claude/settings.json` | yes: Claude Code reads it from the repository | a copy |
| `.editorconfig` | yes: an editor reads it from the root of the repository | a copy |
| `PRINCIPLES.md`, `PRINCIPLES.ko.md` | no: a document that a reader follows by a link | a link document to the package |
| `config/layout.kit.yml`, `config/commit-identity.json` | no: only the tools of kit read them | read from the package, as K514 |
| `config/pyproject.schema.json`, `config/composer.schema.json`, `config/cargo.schema.json` | no: only the layout check of kit reads them | read from the package, as K514 |
| `config/php-lint/composer.json`, `composer.lock` | no: install-tools reads them to install the PHP lint into var/tools | read from the package, as K514 |

## The structure that each part takes

1. **The stable bootstrap layer.** The bootstrap copies stay copies, since they run before the package exists, and they change
   only with a release: a change of them is batched into the release of a wave and synced once per repository in that wave, never
   per change. A fix that the bootstrap needs between releases goes into the package's own tools wherever the bootstrap can call
   them after install, so the copy keeps its content.
2. **Configurations by reference.** Every file that only a tool of kit reads is read from the package, as K514 does for the lints:
   `config/layout.kit.yml`, `config/commit-identity.json`, the three manifest schemas and the PHP lint project. A consumer that
   extends a configuration names the package (`@polyspec/kit/config/...`), never a copy (C17.11-1).
3. **Copies only where a tool requires them.** The remaining copies are those of the table that a tool reads from the repository:
   the bootstrap layer, `.claude/settings.json` and `.editorconfig`. The two workflows become thin callers of reusable workflows of
   kit (`uses: polyspec/kit/.github/workflows/<name>.yml@<tag>`), so their steps change with a release of kit and not with a sync.
   `PRINCIPLES.md` and its twin become a link document to the package.
4. **Batched releases.** Development changes reach the repositories through the links, with no release. A release is cut once a
   wave of rows is closed, in the order of the dependencies (kit, ordered-json, orm, template, crudui, hyper, fsm, ssr), and each
   repository takes the release and the sync of the bootstrap layer in one row (K438). A repository never pins a release while it
   is linked at 0.0.x.

## The rows that this review opens

The moves of points 2 and 3 are each a kit row of its own, after K438, since each changes what kit-sync writes and so takes the
batched sync of the next release: reading the four kinds of kit-only configuration from the package, the reusable workflows with
their callers, and the link document of the principles. Point 1 is a rule of the release procedure (docs/operations/release.md).

## What K614 did

On 2026-10-25 the user approved the removal of the kit-sync copies, and K614 carries it out, with the plain symbolic links of a
local development checkout:

- The bootstrap layer is no copy: a repository includes `../kit/scripts/kit/kit-bootstrap.mk`, which runs the installer of
  `scripts/kit/bootstrap` beside it.
- The PHP lint project `config/php-lint` is read from the kit that runs.
- `config/commit-identity.json` is a declaration of each repository, a plain file of it that kit-check no longer compares, as the
  workflows are.
- `PRINCIPLES.md`, its twin, `.editorconfig` and `.claude/settings.json` are tracked symbolic links to the files of `../kit`.
- The two workflows stay plain files of each repository, since GitHub follows no symbolic link, and kit-check no longer compares
  them.
- `config/layout.kit.yml` and the three manifest schemas that it names stay copies, which kit-check compares: alint 0.18.2 refuses
  every way to read them from kit. An `extends:` outside the repository fails with "`extends:` target … resolves to … which is
  outside the lint root", a symbolic link to the file fails with the same error, and a second `--config` fails with "`--config`
  may be given at most once".
