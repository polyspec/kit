<!-- doc-id: adoption -->
# Working in a repository that adopts kit

[한국어](adoption.ko.md)

This is the procedure of an agent or a person who works in a repository that takes kit, with the rules it rests on in
[PRINCIPLES.md](../../PRINCIPLES.md). It states no rule of its own: each step names the rule and the tool that holds it.

## At every item boundary

1. `make kit-sync` copies the files of the installed kit (P30: the installed kit of a development checkout is a link to the local
   kit, so a landing of kit reaches the repository this way, with no relay).
2. Each provider that the repository consumes through links is built by its own targets ([local-links.md](local-links.md)); link
   builds nothing (K856).
3. `make install-tools` installs the tools of `mise.toml`.
4. Every gate of `kit-gates` runs. A gate that fails is the next item of the plan of the repository, with its own red and green.

## Scope

- A contract behaviour exists in every implementation (S6, S10) and is implemented with its tests (P32).
- A language- or runtime-native integration is written once as a neutral rule in `docs/spec`; each implementation binds its
  native form (P32).
- A test of the internals of one implementation is a plain package test that no parity unit names and that cites no
  requirement; a symbol that is public by accident becomes non-public (P32).
- A rule the work needs and `docs/spec` lacks is written there first. A unit is never dropped, a requirement is never cited
  without a test, and nothing is renamed to escape a check (P33).
- Repeated code is restructured, a tool source is classified and generated output is untracked except a tracked generated source that a consumer installs as the tagged tree itself, declared in config/generated.json (P34).

## Providers

A repository consumes the others only through links (P30). A finding that looks blocked by a release is a defect of the link
tooling: it is reported as a kit defect with its file and line (P35), and only the re-resolution of a committed lock waits for
the decision to release. No tag, version bump or release workflow run happens before the development of every repository is
complete ([local-links.md](local-links.md)).

## Questions

A question goes to the conductor only for a defect of kit, with its file and line, or for two rules that contradict each other
(P23). A rule that is missing is made in kit first.

## Never

No polling loop, no deferral, no run of a full suite, no push, tag or release, and no tool but the utilities of kit for plans,
items and commits (P18, P24 to P28, P31).
