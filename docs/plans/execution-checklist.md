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
| K3.1 | Record every tracked Cargo.lock with its sha256 in the review record | `scripts/kit/dependency-state.mjs` | `make kit-test` | [ ] |
| K3.2 | Install the cargo-audit of config/toolchain.json into var/tools, skipping an installed release | `scripts/kit/install-cargo-audit.mjs` | `make kit-test` | [ ] |
| K3.3 | Record the advisories of each Cargo.lock from cargo-audit and the RustSec database in the review only | `scripts/kit/dependency-review.mjs` | `make kit-test` | [ ] |
| K4.1 | Review the direct dependencies of every go.mod against the latest stable release | `scripts/kit/dependency-review.mjs` | `make kit-test` | [ ] |
| K4.2 | Record Go advisories from govulncheck installed into var/tools | `scripts/kit/install-tools.mjs` | `make kit-test` | [ ] |
| K5.1 | Merge the release tools of template, crudui, hyper, ordered-json and orm into one release tool read from config/release.json | `scripts/kit/release.mjs` | `make kit-test` | [ ] |
| K5.2 | Name archives <package>-<language>-<version>.<ext> and rename the npm pack output | `scripts/kit/release.mjs` | `make kit-test` | [ ] |
| K5.3 | Require the Go module tag go/vX.Y.Z of each declared Go module in release verification | `scripts/kit/release.mjs` | `make kit-test` | [ ] |
| K6.1 | Merge push-gate, full-run, git-hooks and holder-lock, reading the checklist from config/checklist.json | `scripts/kit/push-gate.mjs, full-run.mjs, git-hooks.mjs, holder-lock.mjs` | `make kit-test` | [ ] |
| K7.1 | Merge the document checks (translation pairs, revisions, fences, links, status fields) for table and list checklists | `scripts/kit/check-documents.mjs` | `make kit-test` | [ ] |
| K8.1 | Merge owner-check, run-tests, target-report, ci-targets and ci-passed | `scripts/kit/` | `make kit-test` | [ ] |
| K8.2 | Install npm, Go, the Python lint environment, cargo-audit and govulncheck into var/tools | `scripts/kit/install-tools.mjs` | `make kit-test` | [ ] |
| K9 | Write the schemas of release, toolchain, checklist, owner-checks and the dependency files | `scripts/kit/schema/` | `make kit-test` | [ ] |
| K10 | Give kit its AGENTS.md, README, CI and the tag of each completed version | `AGENTS.md(.ko), README.md(.ko), .github/workflows/ci.yml` | `make kit-test` | [ ] |
