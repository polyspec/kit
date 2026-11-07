<!-- doc-id: example-shared-files -->
# Example: shared files

[한국어](shared-files.ko.md)

The package `@polyspec/kit` ships files that kit uses for itself and that a repository may take. kit writes none of them into a repository and compares no copy (K1052): a repository copies the ones it wants from `node_modules/@polyspec/kit/`, commits each copy as its own file and changes it as it needs.

| File of the package | Where a repository puts its copy | What it does |
|---|---|---|
| `workflows/ci-pipeline.yml` | `.github/workflows/ci-pipeline.yml` | the CI pipeline that a repository's `ci.yml` calls as a job; its closing `required` job fails when a job that the plan selected does not succeed |
| `workflows/release.yml` | `.github/workflows/release.yml` | the release workflow that starts after a green CI run on `main` |
| `actions/kit-bootstrap/action.yml` | `.github/actions/kit-bootstrap/action.yml` | the bootstrap of a CI job: Node.js of `mise.toml`, the locked kit, the npm of var/tools and the packages |
| `config/layout.kit.yml`, `config/composer.schema.json` | `config/` | the common alint rules, which `config/layout.yml` extends |
| `.editorconfig` | `.editorconfig` | the editor settings of kit |
| `PRINCIPLES.md`, `PRINCIPLES.ko.md` | the root | the working principles, which the repository's AGENTS.md links |

A copy is the repository's file: it takes a later change of an example when it chooses to, for instance with `cp` and a commit of the difference:

```sh
cp node_modules/@polyspec/kit/workflows/release.yml .github/workflows/release.yml
git diff .github/workflows/release.yml
```

The workflows name the make targets that they run (`kit-ci-plan`, `kit-ci-setup`, `ci-targets`, `kit-gates-*`, `release-*`); a repository that copies a workflow defines those targets or changes the workflow.
