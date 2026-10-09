<!-- doc-id: execution-checklist -->
# Execution checklist

[한국어](execution-checklist.ko.md)

A task is `[ ]` waiting, `[~]` in progress, `[o]` done, `[!]` bypassed with its cause and retry condition, or `[-]` impossible with its cause. A task becomes `[o]` in the commit that completes it, after its owning command passes.

## Tool unification

| ID | Task | Deliverables | Verification | State |
|---|---|---|---|---|
| K1 | List the shared tools of the five repositories with their sizes and the base implementation of kit | `docs/tool-inventory.md(.ko)` | `make kit-test` | [o] |
| K2.1 | Take npm workspaces, tagged packages, npm range satisfaction and duplicate detection from crudui into the dependency state | `scripts/kit/dependency-state.mjs` | `make kit-test` | [o] |
| K2.2 | Keep the Composer platform rule of template and read crudui's composer manifest through it | `scripts/kit/check-dependency-policy.mjs` | `make kit-test` | [o] |
| K2.3 | Fix the policy shape (composerPlatforms, pythonManifests, exceptions) and its schema | `scripts/kit/schema/dependency-policy.schema.json` | `make kit-test` | [o] |
| K2.4 | Cover the dependency tools with a fixture of two npm workspaces, tagged packages, Composer and PyPI, and the mutation check | `tests/kit/` | `make kit-test` | [o] |
| K3.1 | Record every tracked Cargo.lock with its sha256 in the review record | `scripts/kit/dependency-state.mjs` | `make kit-test` | [o] |
| K3.2 | Install the cargo-audit of config/toolchain.json into var/tools, skipping an installed release | `scripts/kit/install-cargo-audit.mjs` | `make kit-test` | [o] |
| K3.3 | Record the advisories of each Cargo.lock from cargo-audit and the RustSec database in the review only | `scripts/kit/dependency-review.mjs` | `make kit-test` | [o] |
| K4.1 | Review the direct dependencies of every go.mod against the latest stable release | `scripts/kit/dependency-review.mjs` | `make kit-test` | [o] |
| K4.2 | Record Go advisories from govulncheck installed into var/tools | `scripts/kit/install-tools.mjs` | `make kit-test` | [o] |
| K5.1 | Merge the release tools of template, crudui, hyper, ordered-json and orm into one release tool read from config/release.json | `scripts/kit/release.mjs` | `make kit-test` | [o] |
| K5.2 | Name archives <package>-<language>-<version>.<ext> and rename the npm pack output | `scripts/kit/release.mjs` | `make kit-test` | [o] |
| K5.3 | Require the Go module tag go/vX.Y.Z of each declared Go module in release verification | `scripts/kit/release.mjs` | `make kit-test` | [o] |
| K5.4 | Install all archives of a tag in clean npm and Composer consumer projects from committed locks and run the smoke command of each package | `scripts/kit/release-consumer.mjs`, `scripts/kit/release-consumer-config.mjs` | `make kit-test` | [o] |
| K5.5 | Prove a released tag from outside the repository: the release assets, the consumer installs, the git-tag installs and the Go modules | `scripts/kit/release-proof.mjs` | `make kit-test` | [o] |
| K6.1 | Merge push-gate, full-run, git-hooks and holder-lock, reading the checklist from config/checklist.json | `scripts/kit/push-gate.mjs, full-run.mjs, git-hooks.mjs, holder-lock.mjs` | `make kit-test` | [o] |
| K6.1-1 | Read the trackers (table, list, translation) and the hooks from config/checklist.json | `scripts/kit/checklist.mjs, schema/checklist.schema.json` | `make kit-test` | [o] |
| K6.1-2 | Merge the holder locks: start time against reused process IDs, safe removal of a lock whose holder ended | `scripts/kit/holder-lock.mjs` | `make kit-test` | [o] |
| K6.1-3 | Install the Git hooks idempotently and check them | `scripts/kit/git-hooks.mjs` | `make kit-test` | [o] |
| K6.1-4 | Merge the push gates: the pre-push hook and the commit check refuse an item in the active state | `scripts/kit/push-gate.mjs` | `make kit-test` | [o] |
| K6.1-5 | Merge the guards of the full run with the record of the tree, the lock and the rerun of failed targets | `scripts/kit/full-run.mjs, target-run.mjs` | `make kit-test` | [o] |
| K6.1-6 | Add the make targets of the gates and record the merge in the inventory | `scripts/kit/kit.mk, docs/tool-inventory.md(.ko)` | `make kit-test` | [o] |
| K7.1 | Merge the document checks (translation pairs, revisions, fences, links, status fields) for table and list checklists | `scripts/kit/check-documents.mjs` | `make kit-test` | [o] |
| K7.2 | Read table and list checklists with one function at a lenient and a strict level from one config/checklist.json; remove checklist-rows.mjs and the private lock of ci-targets | `scripts/kit/checklist.mjs, check-documents.mjs, ci-targets.mjs, schema/checklist.schema.json, schema/documents.schema.json` | `make kit-test` | [o] |
| K8.1 | Merge owner-check, run-tests, target-report, ci-targets and ci-passed | `scripts/kit/` | `make kit-test` | [o] |
| K8.1-1 | Merge the owner-check of template, crudui and hyper and the owner map of ordered-json into one tool read from config/owner-checks.json | `scripts/kit/owner-check.mjs` | `make kit-test` | [o] |
| K8.1-2 | Merge the test runners with their progress reporters, per-test timeouts and the failing run without tests | `scripts/kit/run-tests.mjs` | `make kit-test` | [o] |
| K8.1-3 | Merge the target report, ci-targets and ci-passed of template, crudui, hyper, ordered-json and orm | `scripts/kit/ci-targets.mjs, target-report.mjs, ci-passed.mjs` | `make kit-test` | [o] |
| K8.1-4 | Take the commit subject check and the changelog sections of orm as shared git hygiene | `scripts/kit/check-commits.mjs` | `make kit-test` | [o] |
| K8.2 | Install npm, Go, the Python lint environment, cargo-audit and govulncheck into var/tools | `scripts/kit/install-tools.mjs` | `make kit-test` | [o] |
| K8.2-1 | Declare the toolchains in config/toolchain.json with its schema and read them from their files | `scripts/kit/toolchain-declared.mjs`, `scripts/kit/schema/toolchain.schema.json` | `make kit-test` | [o] |
| K8.2-2 | Install npm, Go, ruff and Composer into var/tools with wrappers and no symbolic link | `scripts/kit/install-tools.mjs` | `make kit-test` | [o] |
| K8.2-3 | Install cargo-audit and govulncheck through install-tools and add the make target | `scripts/kit/install-tools.mjs`, `scripts/kit/kit.mk` | `make kit-test` | [o] |
| K8.2-4 | Check the running Node.js, npm, Go, Rust, PHP, Python, Composer, ruff and audit tools against the declarations | `scripts/kit/check-toolchain.mjs` | `make kit-test` | [o] |
| K8.2-5 | Record the merged and dropped toolchain behaviors in the tool inventory | `docs/tool-inventory.md(.ko)` | `make kit-test` | [o] |
| K8.3 | Check that the crates of every Cargo.lock are downloaded before a check runs cargo offline, and download them with --fetch | `scripts/kit/check-cargo-downloads.mjs` | `make kit-test` | [o] |
| K8.4 | Lint and format-check the Python package that config/toolchain.json names with the ruff of var/tools | `scripts/kit/lint-python.mjs` | `make kit-test` | [o] |
| K9 | Write the schemas of release, toolchain, checklist, owner-checks and the dependency files | `scripts/kit/schema/` | `make kit-test` | [o] |
| K10 | Give kit its AGENTS.md, README, CI and the tag of each completed version | `AGENTS.md(.ko), README.md(.ko), .github/workflows/ci.yml` | `make kit-test` | [o] |
| K11 | Move every function and constant that several modules of scripts/kit repeat into one shared module, and fail a second copy in a test | `scripts/kit/, tests/kit/duplication.test.mjs` | `make kit-test` | [o] |
| K11-1 | Merge runMakeTarget of full-run and runLogged of ci-targets into one runner with one log format | `scripts/kit/target-report.mjs, full-run.mjs, ci-targets.mjs` | `make kit-test` | [o] |
| K12 | Read an npm lock entry that npm installed as a copy (`resolved: file:<directory>`, no `link`) as a package of the repository | `scripts/kit/dependency-state.mjs, tests/kit/dependency-state.test.mjs` | `make kit-test` | [o] |
| K12-1 | Write the `source-sha256` of the Korean documents from the English files with `make documents-stamp` | `scripts/kit/documents-stamp.mjs, tests/kit/documents-stamp.test.mjs` | `make kit-test` | [o] |
| K12-2 | Accept the composer.json at the root of a repository as a Composer manifest of the dependency policy | `scripts/kit/schema/dependency-policy.schema.json, tests/kit/schema.test.mjs` | `make kit-test` | [o] |
| K12-3 | Accept a local npm package required as `file:<its directory>` in the dependency gate | `scripts/kit/check-dependency-policy.mjs, tests/kit/dependency-state.test.mjs` | `make kit-test` | [o] |
| K12-4 | Select the tools of install-tools by name, apply the mutation check to the ecosystems of the repository, pass TAG to the release recipes as a quoted variable and accept a root pyproject.toml in the policy; keep the fixture out of vendor/ | `scripts/kit/install-tools.mjs, check-dependency-policy-mutation.mjs, kit.mk, schema/dependency-policy.schema.json` | `make kit-test` | [o] |
| K12-5 | Read the VitePress slug and the `{#id}` of a heading when `siteLinks` is set, and skip the dependencies that the root `overrides` install from a URL in the registry review | `scripts/kit/markdown.mjs, check-documents.mjs, dependency-state.mjs` | `make kit-test` | [o] |
| K12-6 | Remove the temporary folders of the npm stub of the consumer tests, and test that none stays in TMPDIR | `tests/kit/release-consumer-sandbox.mjs, release-consumer.test.mjs` | `make kit-test` | [o] |
| K12-7 | The release commands take `TAG=latest` for the newest root release tag reachable from HEAD: `scripts/kit/release.mjs` exports `latestTag`, and the release, consumer and proof mains resolve `latest` before they parse the tag, so a release task and its retry name no version. Verification: `node --test tests/kit/release.test.mjs`. | `node --test tests/kit/release.test.mjs` | [o] The release 0.0.11 publishes it. |
| K12-8 | The nested consumer run of the TMPDIR case of the consumer tests sets NO_COLOR and FORCE_COLOR=0, so the summary line that the case matches carries no color of a colored parent environment. Cause: the case matched `ℹ tests 2` in the standard output of the nested `node --test`, a colored parent environment (an agent shell with FORCE_COLOR) colored the nested output and the match failed, while the CI of the tag, which colors nothing, passed. Verification: `node --test tests/kit/release-consumer.test.mjs`. | `node --test tests/kit/release-consumer.test.mjs` | [o] |
| K13 | Read the impossible state at both levels: the lenient reading accepts it as a state of its own, the strict reading requires a cause on its list items and accepts the cause in a table state cell, and the marker scan reports it outside a task | `scripts/kit/checklist.mjs, tests/kit/checklist.test.mjs` | `node --test tests/kit/checklist.test.mjs` | [o] |
