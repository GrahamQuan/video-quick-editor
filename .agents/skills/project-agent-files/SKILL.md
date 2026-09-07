---
name: project-agent-files
description:
  Create or optimize a project's AGENTS.md, task-specific skills, and related coding-agent instructions. Use for
  agent-file setup or instruction audits, not ordinary feature implementation.
---

# Project Agent Files

Turn project evidence into a small, coherent instruction system that helps coding agents complete the user's work.
Support both English and Chinese requests; preserve existing file language and use English for new project files unless
requested otherwise.

## Select the work

- **Optimize / 优化** existing instructions: read [references/optimize.md](references/optimize.md).
- **Create / 创建** instructions for a new or unconfigured project: read [references/create.md](references/create.md).
- A mixed project may need both, scoped to the relevant directories. Infer the mode from the request and existing files.
  Ask only if choosing would materially change the result.
- “Audit”, “review”, or “draft only” means report or propose content without writing. A request to create or optimize
  files authorizes relevant edits subject to the target workspace's rules. Do not make application changes merely to
  justify generated instructions.

Establish the target root from the request or workspace. Do not assume the current vault or unrelated directory is the
project being configured. With no identifiable target, draft in chat and ask for the project path. Read applicable
instruction files before edits; this skill does not override protected-note workflows or other workspace restrictions.

## Design decisions

Keep only instructions that change a useful decision: verified project facts, non-obvious constraints, task routing, and
actionable completion criteria. Avoid generic coding advice and broad “always use this skill” triggers.

Place enduring, widely relevant guidance in AGENTS.md; place directory-specific constraints at their actual scope; place
repeatable task workflows in skills; place substantial conditional detail in linked references. Use scripts only where
deterministic behavior or repeated mechanics justify maintenance. Do not populate every possible agent file or copy the
same rules across tools.

Treat the article's model observations as motivation to reassess instructions, not proof that a project's tests or
safeguards are obsolete. Preserve real requirements and explicit user boundaries. Never infer permission to deploy,
publish, access production, or relax approval controls from permission to improve instructions. Where a boundary causes
unnecessary stopping, propose a specific replacement with its rationale; changing an explicit authorization boundary
needs the user's authorization.

Write completion in observable terms, including relevant verification and fixing failures caused by the requested
change. Preserve a requested review checkpoint. Allow continued work only within the authorized task; do not prescribe
unlimited retries or unrelated cleanup. Claim a workflow is isolated, disposable, or safe only when project evidence
supports it.

## Finish

Check changed files for valid formats, real paths, accurate commands, reachable references, conflicting instructions,
and leftover scaffold text. Validate changed skills with the available skill validator; if unavailable, inspect
frontmatter and references directly. Review representative task behavior using the selected mode's scenarios. Do not run
the entire application suite solely for prose edits; validate any executable helper you actually add or change.

Deliver the files or exact proposed content, explain material behavioral changes, and state what was verified or remains
unknown. For audits, report actionable findings with file locations and proposed fixes. Do not claim model performance
gains from word-count reduction alone.

## Basis

Adapted from eric provencher's
[Rethinking skills and prompts for GPT-6 Astra](https://x.com/pvncher/article/2095991462416490862), read directly on
2026-09-07. Its central lessons are narrow skill discovery, conditional detail, lean persistent instructions, and
deliberate completion and permission boundaries. The two operating modes and verification procedures here are
implementation choices for this skill, not quotations or additional claims by the author.

For runtime-specific format or discovery questions, inspect the target environment and consult current vendor
documentation when needed. Codex references: [Skills](https://learn.chatgpt.com/docs/build-skills) and
[AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md). Do not require web research during every
invocation.
