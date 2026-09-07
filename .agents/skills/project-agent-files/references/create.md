# Create project agent instructions

## Gather enough facts

Use the user's brief and any existing project files to establish the purpose, target agent tooling, implementation
stack, non-obvious conventions, available checks, and intended workflow. An empty repository is valid: do not invent
commands, directories, infrastructure, or business rules. Ask for a blocking choice only when useful content depends on
it; put nonblocking unknowns in the handoff rather than persisting speculative rules.

Creating agent instructions does not also authorize scaffolding the application, choosing its product scope, installing
dependencies, or connecting services.

## Choose the smallest useful set

| Artifact                     | Create when                                                                              |
| ---------------------------- | ---------------------------------------------------------------------------------------- |
| Root AGENTS.md               | Stable project-wide guidance changes agent decisions                                     |
| Scoped AGENTS.md             | A real subdirectory has distinct, durable constraints and the runtime supports the scope |
| A project skill              | A recurring task needs non-obvious guidance beyond the root instructions                 |
| Skill references             | Significant detail applies only to a branch of the workflow                              |
| Skill scripts                | Repeated operations benefit from deterministic implementation                            |
| Other tool instruction files | That tool is requested or already used, and its format is verified                       |
| A reusable task prompt       | The user needs repeated task framing with outcomes and stopping conditions               |

A root AGENTS.md alone may be the right result. Do not create empty skill folders or generic testing, debugging, and
review skills just to supply a collection. If the user requests skills but no concrete recurring workflow is
identifiable, explain this and ask for one rather than inventing domain procedures.

Follow the target runtime's verified project skill location or established repository convention. Do not confuse the
personal installation location of this meta-skill with where the project's generated skills belong. Resolve naming
conflicts by inspecting existing content and switching that artifact to the optimize workflow.

## Author concrete content

For AGENTS.md, choose only useful sections: brief purpose, unusual boundaries, verified commands with working
directories, conditional documentation pointers, and the user's completion expectations. Omit empty sections. Link
existing maintained documentation instead of duplicating it.

For each skill, provide a lowercase hyphenated name and a concise description that identifies when it helps. Include the
outcome, necessary domain constraints, useful routing, and relevant verification. Add references or scripts only for an
actual use. Maintain a single source for each rule. Optional UI metadata must match the entrypoint and target runtime.

For a repeated task prompt, specify the desired observable outcome, scope, relevant checks, permitted follow-through,
and stopping condition. Keep one-off task details out of always-loaded files.

Use the user's chosen agent/model environment. If contributors use different models, favor stable project facts over
assumptions about one model's intelligence; add model-specific tuning only when justified and requested. Do not change
model settings as part of file generation.

## Verify the proposed system

Check that every created file has a reason to exist, all commands and paths have evidence, and every linked resource is
present or clearly an external reference. An empty project must not acquire fictitious npm commands or claims about
production isolation.

Walk through a small local edit and one intended recurring workflow. Confirm the first does not load unnecessary detail
and the second can find its instructions and completion criteria. If review-only or protected by workspace rules,
provide complete file contents in chat and clearly distinguish drafted from written files.
