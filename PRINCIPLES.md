<!-- doc-id: principles -->
# Principles

[한국어](PRINCIPLES.ko.md)

These are the working principles of every polyspec repository. kit vendors this file byte for byte to each repository that
takes its tools, so each repository holds the same text and `make kit-check` fails on a difference. A repository's
AGENTS.md links here and states only the rules of its own. The principles come from the owner; a principle is changed only
in kit, with its grounding.

## Responsibility

- Everything is the responsibility of whoever works on it: the code, its tests, its documents, AGENTS and the memory. A task
  is not done while one of them is missing.
- A rule is followed because it is right, never because it exists. "It was there before" is no ground. A rule, a code path
  or a document found wrong is reported and corrected; a found oddity is reported at once, with the question whether a rule
  must be made or corrected, and it is fixed or confirmed convincingly before the work moves on.
- Rules first: development states logical rules and keeps them. Behaviour that follows no stated rule is a defect. When no
  rule exists for what the work needs, the rule is made, never skipped.
- A settled ruling is written into its specification, with its grounding, before work that depends on it. A ruling that
  lives only in a conversation, a commit message or an agent's report is not settled.

## Standards

- A standard is never lowered because it is hard to meet; lowering it while testing is betrayal of the standard. A standard
  that is wrong is raised as a problem and corrected, with the reason.
- No tricks, in any case. A goal reached by an abnormal method is not reached. When a requirement can be met only by a
  trick, that is stated exactly instead of done.
- Errors are never hidden: no fallback that turns a wrong input into a plausible one, no silent drop of an input or an
  output, no swallowed error. A fallback stands only where it is truly needed, with that need stated.
- Correct first; fast only when it stays correct.

## Design

- No backward compatibility before a release says otherwise: an old path is removed, never kept behind a compatibility
  layer, a fallback or a migration.
- The simplest implementation that fully meets the current requirements: no abstraction, setting or indirection for an
  uncertain future.
- What an outside ecosystem already provides is used as it is, never redeveloped: its standard tool, library or protocol.
- Components are modular, each concern clearly separated.
- Architecture is decided for the long term: a stopgap that works now and must be replaced later is not accepted. A
  problem is never solved by creating another problem.
- Recovery, apply and transformation are idempotent; a change is published as an event, never found by polling; paths are
  resolved declaratively from a declared root; and multi-platform is a hard requirement, met without platform tricks.

## Verification

- A defect starts as a test that reproduces it and fails for the intended reason; the fix follows; the same test passes.
  A test that cannot fail proves nothing, and a test that passes without running is a defect.
- A hard judgement or a new line of reasoning is verified adversarially, in rounds, until a round finds nothing. The scope
  of the review is fixed before the first round; a question beside it becomes its own item.
- Work handed to an agent carries everything the one handing it knows: the history, why earlier attempts were wrong, the
  measurements, these principles, the state of shared resources and the completion conditions. The agent first answers
  how it will judge right and wrong; the two agree before the work starts. An agent's report that something does not exist,
  is impossible or does not apply is checked in the code before it is accepted.

## Questions

- A question is asked only when it is needed: not already decided or evident, not asked by habit, not a way to leave
  something out, never confusing; and a needed question is never left out. A decision that a new milestone reopens is
  asked again.
