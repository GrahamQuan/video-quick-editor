# Optimize existing project instructions

## Inspect selectively

Inventory AGENTS.md and scoped variants, skill entrypoints, their linked resources, and other agent instruction files in
the requested project. Include hidden configuration directories; exclude dependencies, generated output, and unrelated
checkouts. Honor scope restrictions. Inspect references only when needed to understand a candidate change or its
callers.

Use manifests, build scripts, CI configuration, and relevant source to check operational claims. Existing instructions
are evidence of user intent even when they look cumbersome. Distinguish factual drift from a deliberate workflow policy.

## Decide what each candidate needs

| Symptom                                | Useful change                                                      | Evidence to retain                                   |
| -------------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------- |
| Generic reminders or repeated rules    | Remove redundant guidance within authorized scope                  | The unique project constraint, if any                |
| Stale command, directory, or reference | Correct from current project evidence                              | Real command and its working directory               |
| Every edit requires extensive reading  | Route reading by affected task or subsystem                        | Required domain context where it matters             |
| A skill matches a whole technology     | Describe the actual workflow and trigger                           | A positive use case and adjacent non-use case        |
| Long multi-workflow entrypoint         | Extract conditional detail and link it at the branch               | Shared invariants and usable routing                 |
| Mandatory repeated broad tests         | Preserve required checks; scope discretionary checks to the change | CI/release requirements and relevant risks           |
| Early stop or approval loop            | Clarify completion or propose a bounded authorization change       | Explicit review checkpoints and authority boundaries |
| Conflicting or duplicated tool files   | Establish a compatible source of truth                             | Verified loading behavior and local conventions      |
| Highly prescriptive recipe             | Keep steps whose order affects correctness                         | Fragile prerequisites and recovery limits            |

Do not optimize to an arbitrary line count. A long compliance invariant can be necessary; a short ambiguous instruction
can be expensive. For each material finding, record the location, observed problem, expected behavior, and replacement
or disposition. Use keep, revise, move, or remove as useful internal labels, not a mandatory report for every sentence.

## Apply within scope

For an edit request, make focused patches and preserve user edits. For a review request, provide findings and exact
replacement text. Before moving or removing resources, inspect inbound references and entrypoints; changing a skill's
internal organization must not strand scripts or callers. Do not uninstall skills, change automatic invocation policy,
or alter user-wide settings as incidental cleanup.

If the cause or intent of a rule is unknown, retain it and identify the uncertainty rather than silently weakening it.
Continue with independent improvements when one policy decision requires user input.

## Behavior review

Mentally walk through tasks relevant to this project and report this as a walkthrough, not a model execution test:

- A typo fix should not load every architecture document or unrelated skill.
- A real domain workflow should still load its skill and preserve fragile ordering.
- A requested implementation should reach its agreed checks and fixes without an accidental first-pass stop.
- A production action should still encounter the existing authorization boundary.
- A task in a nested directory should receive the correct local constraints.

For a complex revision, behavioral execution can add confidence when authorized and available. Use isolated fixtures; do
not claim it happened unless it did.
