<!-- doc-id: plan-common-standard -->
# Common standard

[한국어](plan.ko.md)

## Goal

Every polyspec repository follows one standard for its folders, its plans and checklists, its tests and its commands.
kit holds the standard: PRINCIPLES.md states each rule once, a kit tool enforces it, and a repository keeps only the
data that truly differs between repositories (`config/*.json`) and the rules of its own product (AGENTS.md).

## Source-link and bootstrap handoff (2026-10-26)

The implementation and deployment states are separate. K657 and K664 delegate source installation to native npm, Composer, uv, Go and Cargo. Applications own declarations and compatible development locks; routine application changes do not require a kit change. The current operating contract is [local links](../../operations/local-links.md).

K671 replaces the mandatory sibling checkout and tracked shared-file links introduced by K614 and the K670 workaround. Consumers include the installed package bootstrap; kit-sync writes regular shared copies. Native `npm link ../kit` remains optional local development. Kit runs its own sources without installing its own published package. Restoring a sibling clone in CI would reintroduce the removed dependency.

K670-1 retains PHP tokenizer configuration. K670-3 permits release manifest metadata without permitting implementation under a release chore. K670-4 skips unrelated Python projects. The proposed blanket `--legacy-peer-deps` and already-linked shortcut were not adopted in K671: lock reading alone fixed the demonstrated npm failure. K673 and K674 subsequently add and refine idempotent source recognition; their evidence belongs to those later changes, not to the earlier CI.

### Release state and next actions

- K655, version 0.0.55: preparation and owning checks are recorded in CHANGELOG.md; publication is pending. [CI run 40313948359](https://github.com/polyspec/kit/actions/runs/40313948359) covers through K672-1. Its kit tests report 1398 passes and four failures. Collect the remaining source tests and gates before classifying every failure; do not cancel this run or treat its owning-test results as complete CI acceptance.
- K673 and K674 are later local main commits, outside that CI. K677 tracks a subsequent 0.0.56 release for accepted changes outside the published 0.0.55 tag. Until 0.0.55 is public, corrections can remain in its candidate; inspect the final candidate rather than assuming these local commits already belong to a published version. Each release needs successful CI for its own code and a successful consumer proof; 0.0.55 results cannot validate 0.0.56.
- A failed CI blocks its release. Fix the failed owners, run their selected tests, and push the corrected release candidate. While developing, do not repeat the full local suite. Use the [release procedure](../../operations/release.md) after the candidate's CI passes; do not claim a tag, draft or version bump is a public release.
- K676 records Cargo target-directory inheritance, which source-selection tests did not establish. K678 reviews repeated package-test preparation; native isolated install and package-consumption coverage remain required, and setup cost alone does not invalidate those tests.

K675 records this handoff. Checklist completion means the named implementation and evidence are complete; K655 and K677 remain open until their releases are public. Check Git, the CI run and the release before updating deployment state. The checklist remains tasks only, CHANGELOG.md holds actual changes and test evidence, and this section explains their relationship and remaining work.

## Checklist reconciliation (K679, 2026-10-26)

This audit covers all 31 non-complete items that existed across the three plan checklists before K675, including dropped items. It is a code and history review, not a fresh test pass. Do not resume an old task merely because its original text remains in the checklist: its current disposition below takes precedence. Historical task IDs and wording remain unchanged; replacement requirements have their own registered IDs.

Registration history is also explicit: K655, K657 and K664 were registered in plan commits before implementation. K671 first appeared in the same commit as its initial sync implementation, so it did not follow prior registration. Existing IDs are not retrospective proof that the work was planned. K675 records the initial handoff; K679 records this broader reconciliation separately.

| Existing item | Current disposition | Code or evidence inspected |
|---|---|---|
| K395 | Keep historical exclusion; native relinking remains available, not a new provider rewrite. | `npm-install.mts npmInstall/npmLink; K673/K674` |
| K399-2 | Superseded by existing Go workspace diagnostics; do not implement twice. | `link-state-check.mts goFindings; link-state-check.test.mts` |
| K410-1 | Superseded by current shipped owner declarations. | `package.json kit.owners; owner-check.mts ownerDeclaration; kit-sync.test.mts K410-1` |
| K437 | Later tests cover hanging cases and parent death; original process-cause evidence is still unverified. | `run-tests.test.mts K437/K437-1; test-exit-deadline.mts` |
| K438 | Retire the coupled prerequisite; use independent candidate acceptance in K655/K677. | `P35; local-links Decision; release procedure` |
| K443 | Superseded by K631 diagnostics; do not restore a new land blocker. | `land.mts mainRun; land.test.mts K631-1` |
| K444 | Superseded by K452-1 load preflight; literal extension_loaded coverage is not claimed. | `run-tests.mts probeExtensions; run-tests.test.mts K452-1` |
| K445 | Keep historical scope exclusion; generated-file filtering is not established by this work. | `lint-python.mts lintSteps still selects tracked Python sources` |
| K456 | Partially implemented; remaining command/result/elapsed visibility is K685. | `check-documents.mts; land.mts runGate; test-hooks.mts` |
| K461 | Replace the old build deadline requirement; remaining whole-build timeout is K682. | `AGENTS operation rule; run-tests.mts BUILD_MS/buildWatch; test-build-first.test.mts` |
| K466 | Old audit-removal rationale is obsolete; actual nested-copy attribution gap is K680. | `dependency-review.mts npm advisory collection ignores audit nodes` |
| K467 | Do not restore old recipes; verify online-review offline-environment behavior under K684. | `dependency-review.mts query/advisories; offline gate reads committed review` |
| K470 | Superseded: the stale sprintf-js exception was removed; do not restore it. | `K660; dependency-policy.json advisoryExceptions; current review` |
| K471 | Superseded: native npm owns overrides; copy-level advisory scope is K680. | `dependency policy advisoryExceptions and native npm overrides` |
| K472 | Keep exclusion: no kit-imposed latest-version or sibling-version convergence. | `K660 newer-only test; dependency-review CLI result policy` |
| K475 | Do not resume synthetic locks; active legacy review/update metadata rewriting is K681. | `dependency-review.mts providerEntries/composerEntries/runUpdateSteps` |
| K479-1 | Superseded: kit-generated composer.link manifests are retired. | `composer-install.mts selected COMPOSER; native Composer K664-2` |
| K480-1 | Redefine native dependency checks under K683; do not invent a cross-language resolver. | `composer-install.mts native update; uv-install.mts pip check; npm peer limits` |
| K483 | Split the intent: NO_DEV exists; rejecting release installs without a checkout must not be restored. | `composer-install.mts native fallback; link.test.mts NO_DEV; K683` |
| K573 | Keep cache exclusion; its old claim that main comparison disappeared is obsolete. | `land.mts mainRun; K603/K631/K580` |
| K589 | Keep exclusion: never hide stale application locks by copying synthetic link metadata. | `worktree-setup.mts native vendor/autoload; selected manifests remain app-owned` |
| K597 | Keep exclusion: K561 remains; do not remove bindingless-catch diagnostics. | `catch-check.mts bindinglessCatches; catch-check.test.mts K561` |
| K618 | Keep historical misdiagnosis exclusion; select the parser declared by each PHP generator. | `install-php-arginfo.mts; PHP tests K637/K652/K670-1` |
| K649 | Superseded by guarded FINAL_RUN=1 API in K654/K658; API existence does not authorize a forbidden local suite. | `ci-only.mts; ci-only.test.mts K654/K658; repository check rules` |
| K655 | Keep open: failed CI is not release acceptance; K686 collects and repairs failures. | `CI 40313948359; release-verify; public consumer proof` |
| K76-1 | Keep exclusion: do not introduce mandatory PR or CODEOWNERS approval gates. | `P10/P38; S8; remote protection settings were not inspected` |
| K111 | Keep the rejected dependency-cruiser mechanism excluded; native import-graph owner selection already exists. | `owner-check.mts importGraph; owner-check.test.mts K191` |
| K119 | Keep original misdiagnosis excluded; normal cleanup exists, exceptional cleanup is unverified. | `release-sandbox.mts cleanup after tar; no finally proof in this audit` |
| K55 | Superseded by current package exports and K71-2/K671; do not restore kit.json or obsolete API paths. | `release.json; package.test.mts; installed-hook-real.test.mts` |
| K56 | Keep exclusion: native uv owns Python environments; no custom installer prefix/home API. | `python-venv.mts makeVenv` |
| K57 | Keep exclusion: native local-wheel proof already exists; no extra consumer-specific archive mapping API. | `release-consumer.mts installWheelFiles; wheel-dependencies.mts lockRequirements` |

### Remaining implementation and execution order

The first priority is K686: let the current CI finish, collect every failed owner and correct the release candidate. K655 stays open until that candidate has successful CI and a public consumer-proved release. Later version work is K677; an unpublished failed candidate may still be corrected at its current version.

K681 is a real remaining ownership gap: the native installation path was migrated, but dependency-review still has providerEntries, scratch Composer manifests and version overrides. Do not claim every Composer metadata-synthesis path was removed. K680 similarly retains a real advisory attribution gap: native npm audit is used, but vulnerable nested copies can be labelled with the top-level version; this does not establish that the gate accepts those advisories.

K682 addresses the remaining whole-build timeout. K683 defines native source/release validation, including npm's source-only missing-checkout behavior and peer-validation limits. K684 first reproduces the offline-environment review risk; it is not yet a demonstrated false-green. K685 addresses partial operation progress visibility. These are registered requirements, not completed fixes or reasons to restore obsolete mechanisms.

P30 and P35 are aligned with native source installation, application-owned constraints and independent release locks. No source is disguised as an installed release version; kit does not synthesize development metadata. Current code that violates that boundary is tracked by K681. An accepted later rule replaces an obsolete instruction rather than silently changing what an old completed or dropped ID means.

## Cause

The repositories that take kit (orm, template, crudui, hyper, fsm, ordered-json) and flowmark were measured on
2026-10-19 at the head of their `main`:

- kit lets a repository configure what must be the same everywhere. `config/checklist.json` declares the states and the
  format of each checklist: four states in template, crudui, hyper and ordered-json, five in orm, kit, fsm and flowmark;
  the list format in orm and flowmark, the table format elsewhere.
- Every AGENTS.md restates the common rules in its own words (commit format, branches and worktrees, Red and Green,
  timeouts, Korean documents, symbolic links, the uncommitted range); the files hold 88 to 280 lines, and the wording
  diverges.
- Every AGENTS.md says that the repository has one checklist, while a checklist belongs to a plan. One checklist per
  repository grows without bound: 1.6 MB with 1269 items in orm, 179 KB to 262 KB in kit, template, crudui and hyper.
- The full-run guard allows `make check` when no item is waiting or active, which is the moment right after the work is
  done, while PRINCIPLES.md says that the full suite runs neither per fix, per item nor at the end. No tool stops an agent
  from running a full suite.
- Tests are selected and named per repository: only the targets `check` and `install` exist in six or more of the eight
  repositories; one task has the names `test-ts`, `test-js`, `test-node` and `test-npm`, another `ext`, `php-ext`,
  `php-extension` and `build-php-extension`.
- S5 allows both `packages/ts` and `packages/js` for TypeScript sources; ordered-json keeps an AGENTS.md, a CHANGELOG.md
  and a Makefile in each package; the documents are laid out in different folders; flowmark keeps its Go code in fifteen
  root folders.
- The PHP extensions follow five models: a `Native` namespace (orm, template), the class names of the PHP library
  (crudui, fsm), global functions that the PHP library calls (ordered-json); their stubs, builds and package names differ,
  crudui compiles without phpize, and crudui and hyper each build the extension of another repository with a script of
  their own.

## Rulings

1. A plan is the folder `docs/plans/<plan>/` with `plan.md` and `checklist.md` and their Korean pairs `plan.ko.md` and
   `checklist.ko.md`; the folder name is a slug that names the plan. kit discovers the checklists as
   `docs/plans/*/checklist.md`. A plan states its cause, its rulings, its order and its exit criteria; a checklist row
   states its task, its cause and its acceptance; Red and Green results are in CHANGELOG.md, not in a row. An item ID is
   unique among all checklists of a repository, and the parent of a sub-item (`K12-1` of `K12`) is an item of the same
   checklist. Grounding: one checklist per plan bounds the size of a checklist by its plan, and a plan in Markdown keeps
   the checks in kit's own tools, with no dependency of kit on another repository.
2. A checklist is a table with the five states `[ ]`, `[~]`, `[o]`, `[!]` and `[-]`. kit fixes both; a repository
   declares only its ID prefix.
3. The full suite runs only in CI. No local command runs it, and a Claude Code hook that kit vendors refuses a command
   that runs a suite or a whole runtime without a selection.
4. A test is unit, integration or conformance by its location. Locally only unit tests run, as `make test-<runtime>
   CASES=<pattern>`, which kit maps to the filter of the runner.
5. The common rules of work are stated once in PRINCIPLES.md; an AGENTS.md states only the rules of its repository.
6. The folder standard S5 names one folder per concern and one runtime name per source language, and holds the
   management files (AGENTS, CHANGELOG, Makefile, plans) at the repository root only.
7. kit fixes the names of the make targets; a repository provides their recipes.
8. A PHP extension registers the class names of the PHP library, so the same PHPUnit files test either implementation;
   one kit tool builds it with phpize and generates its arginfo with gen_stub.php.
9. Every rule is enforced at a point that cannot be skipped: a Git hook that make installs, the Claude Code hook that
   kit vendors, or the CI push-gate job; a rule that holds only as text is a defect that kit lists. Plans, items and
   commits are written by utilities that call the functions of those checks, so the right output is the one that the
   utility writes.

## Order

The checklist lists the items in their order. K240 comes first, because every later item runs under it; K248 and K249 follow, because every later item writes its rules in their form; K241 gives the
other items their place. After the kit items, each repository adopts the standard in a plan of its own.

## Exit criteria

Every item of the checklist is `[o]` or `[-]`, and each repository that takes kit has a plan that adopts the standard.
