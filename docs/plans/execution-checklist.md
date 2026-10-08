<!-- doc-id: execution-checklist -->
# Execution checklist

[한국어](execution-checklist.ko.md)

A task is `[ ]` waiting, `[~]` in progress, `[o]` done, or `[!]` bypassed with its cause and retry condition. A task becomes `[o]` in the commit that completes it, after its owning command passes.

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
| K5.2 | Name archives <package>-<language>-<version>.<ext> and rename the npm pack output | `scripts/kit/release.mjs` | `make kit-test` | [ ] |
| K5.3 | Require the Go module tag go/vX.Y.Z of each declared Go module in release verification | `scripts/kit/release.mjs` | `make kit-test` | [ ] |
| K6.1 | Merge push-gate, full-run, git-hooks and holder-lock, reading the checklist from config/checklist.json | `scripts/kit/push-gate.mjs, full-run.mjs, git-hooks.mjs, holder-lock.mjs` | `make kit-test` | [ ] |
| K6.1-1 | Read the trackers (table, list, translation) and the hooks from config/checklist.json | `scripts/kit/checklist.mjs, schema/checklist.schema.json` | `make kit-test` | [o] |
| K6.1-2 | Merge the holder locks: start time against reused process IDs, safe removal of a lock whose holder ended | `scripts/kit/holder-lock.mjs` | `make kit-test` | [o] |
| K6.1-3 | Install the Git hooks idempotently and check them | `scripts/kit/git-hooks.mjs` | `make kit-test` | [o] |
| K6.1-4 | Merge the push gates: the pre-push hook and the commit check refuse an item in the active state | `scripts/kit/push-gate.mjs` | `make kit-test` | [o] |
| K6.1-5 | Merge the guards of the full run with the record of the tree, the lock and the rerun of failed targets | `scripts/kit/full-run.mjs, target-run.mjs` | `make kit-test` | [o] |
| K6.1-6 | Add the make targets of the gates and record the merge in the inventory | `scripts/kit/kit.mk, docs/tool-inventory.md(.ko)` | `make kit-test` | [o] |
| K7.1 | Merge the document checks (translation pairs, revisions, fences, links, status fields) for table and list checklists | `scripts/kit/check-documents.mjs` | `make kit-test` | [o] |
| K8.1 | Merge owner-check, run-tests, target-report, ci-targets and ci-passed | `scripts/kit/` | `make kit-test` | [o] |
| K8.1-1 | Merge the owner-check of template, crudui and hyper and the owner map of ordered-json into one tool read from config/owner-checks.json | `scripts/kit/owner-check.mjs` | `make kit-test` | [o] |
| K8.1-2 | Merge the test runners with their progress reporters, per-test timeouts and the failing run without tests | `scripts/kit/run-tests.mjs` | `make kit-test` | [o] |
| K8.1-3 | Merge the target report, ci-targets and ci-passed of template, crudui, hyper, ordered-json and orm | `scripts/kit/ci-targets.mjs, target-report.mjs, ci-passed.mjs` | `make kit-test` | [o] |
| K8.1-4 | Take the commit subject check and the changelog sections of orm as shared git hygiene | `scripts/kit/check-commits.mjs` | `make kit-test` | [o] |
| K8.2 | Install npm, Go, the Python lint environment, cargo-audit and govulncheck into var/tools | `scripts/kit/install-tools.mjs` | `make kit-test` | [ ] |
| K8.2-1 | Declare the toolchains in config/toolchain.json with its schema and read them from their files | `scripts/kit/toolchain-declared.mjs`, `scripts/kit/schema/toolchain.schema.json` | `make kit-test` | [o] |
| K8.2-2 | Install npm, Go, ruff and Composer into var/tools with wrappers and no symbolic link | `scripts/kit/install-tools.mjs` | `make kit-test` | [o] |
| K8.2-3 | Install cargo-audit and govulncheck through install-tools and add the make target | `scripts/kit/install-tools.mjs`, `scripts/kit/kit.mk` | `make kit-test` | [o] |
| K8.2-4 | Check the running Node.js, npm, Go, Rust, PHP, Python, Composer, ruff and audit tools against the declarations | `scripts/kit/check-toolchain.mjs` | `make kit-test` | [o] |
| K8.2-5 | Record the merged and dropped toolchain behaviors in the tool inventory | `docs/tool-inventory.md(.ko)` | `make kit-test` | [o] |
| K8.3 | Check that the crates of every Cargo.lock are downloaded before a check runs cargo offline, and download them with --fetch | `scripts/kit/check-cargo-downloads.mjs` | `make kit-test` | [o] |
| K9 | Write the schemas of release, toolchain, checklist, owner-checks and the dependency files | `scripts/kit/schema/` | `make kit-test` | [ ] |
| K10 | Give kit its AGENTS.md, README, CI and the tag of each completed version | `AGENTS.md(.ko), README.md(.ko), .github/workflows/ci.yml` | `make kit-test` | [ ] |
