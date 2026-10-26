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
