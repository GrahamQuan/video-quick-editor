# Project guidance

## Task routing and contracts

This is a standalone macOS video editor built with Electron, React, TypeScript, TanStack Router, Vite, and a pnpm/Turborepo workspace. Media processing uses local FFmpeg/ffprobe in Node.js; do not introduce Python, FFmpeg WASM, or a media HTTP service.

- For Agent tools, shared editing state, output profiles, model settings or chat behavior, read [specs/agent-video-editing.md](specs/agent-video-editing.md); sections 6–8 cover tool contracts and acceptance criteria.
- For manual editing, media processing or output protection, read the external [base desktop spec](/Users/a6677/Documents/personal-projects/learn-python-monorepo/specs/video_tools_spec.md) for the baseline contract and Electron boundaries. This is a local reference outside this repository; if unavailable, report that limitation rather than inventing its contents.
- Use [README.md](README.md), [README.zh-CN.md](README.zh-CN.md), package manifests, and implementation to establish current behavior and commands. A spec marked Draft or pending implementation is a target contract, not evidence that a feature works.

The Agent spec explicitly updates the base spec's output defaults and adds Agent behavior. Apply those newer rules when implementing that scope, preserving the legacy `source` contract. The base spec's suggested `apps/video_tools_desktop/` layout, uv-workspace instructions, and historical “this round is documentation only” statement describe its original repository/task; they do not define this repository's layout or restrict subsequent authorized implementation. Do not modify the external Python repository as part of this project's work.

## Code ownership and boundaries

- `packages/shared/src/index.ts`: shared types and Zod runtime contracts. Keep these independent of Node/Electron runtime. Validate IPC, tool inputs/results, and ffprobe data at their boundaries.
- `packages/media-core/src/`: probe, plan, run, verify, and publish. Receive executable paths, output settings, progress callbacks, and cancellation through explicit inputs rather than React state or Electron globals.
- `apps/video-quick-editor-desktop/src/main/`: authoritative session/job state, file mappings, settings, IPC, and Agent orchestration. `editor-service.ts` is the shared editing/tool service; `agent.ts` and `model.ts` contain Agent/model integration; `import-paths.ts` expands only explicitly supplied local sources.
- `apps/video-quick-editor-desktop/src/preload/`: narrow typed bridge. Keep `contextIsolation` and sandbox enabled, `nodeIntegration` disabled, and raw `ipcRenderer` inaccessible to the renderer.
- `apps/video-quick-editor-desktop/src/renderer/`: UI and hash navigation. Use controlled IDs/tokens and no Node APIs. User-supplied import paths are the explicit exception: parse them locally and send them only through the import IPC. Keep user-facing changes consistent across English and Simplified Chinese through `i18n.ts`.

Use existing pnpm workspace packages and lockfile. The project uses Oxfmt and Oxlint, not Prettier/ESLint. Follow its ESM `.js` convention; the sandbox preload is deliberately emitted as CommonJS `index.js`.

## Editing and export invariants

- Manual UI and Agent edit the same draft. Times are safe-integer microseconds relative to source playback, with `[start, end)` ranges. Reject invalid/out-of-duration ranges instead of silently clamping. Repeated assets have independent clip IDs and retain explicit order.
- For the Agent spec's profile work, new UI/tool requests explicitly use `mp4-compatible` by default; omitted `outputProfile` in old requests retains `source` behavior. A filename extension alone never changes muxer or codec. Follow the spec's complete encoding, audio, sizing, and frame-rate contract in planning and final verification.
- Single-clip default is `accurate`; multi-clip default is `normalize`. Preserve explicit choices. Reject conflicting copy/watermark/profile/encoding settings rather than silently re-encoding. Do not silently convert unsupported HDR, 10-bit, or rotation metadata inputs.
- Player seeking and overlay watermark previews do not prove export accuracy. Real frame previews use the export filters; proxy playback never replaces original media as the export source. Watermarks belong to individual clips, including outline thickness. Startup may choose a verified macOS system font; preview/export must still require readable font files, applicable glyphs and text fit.
- Draft writes validate `expectedRevision` atomically. Plans freeze ordered clips/settings and become stale after edits; revalidate source identity and output authorization before starting. Running jobs use immutable snapshots. `start_export` retries with the same `requestId` must not create another job.
- Main owns job status. Serialize actual exports, report real stages, and mark completion only after verification and publishing. Cancelling waits for processes to close before cleaning partial files.
- Spawn FFmpeg with structured arguments, `shell: false`, and `-nostdin`. Watermark text uses a UTF-8 textfile with `expansion=none`; filter paths still require filter escaping.
- Default output names use local time `YYYY_MM_DD--HH_mm_ss` with collision suffixes; use the shared naming helper in both the save dialog and main. Extensions follow the selected output profile.
- Resolve default Downloads with Electron, never a hardcoded path or cwd fallback. Protect inputs including symlink/hard-link aliases. Verify temporary output in the destination filesystem before exclusive publication; replacement requires explicit authorization. Failure/cancellation must not remove existing targets or source files.

## Agent-specific work

Consult sections 6–8 of the Agent spec before changing tools, model integration, or chat state.

- Use AI SDK Core and the OpenAI-compatible Chat Completions adapter in main. Do not bind business logic to a model ID or add LangChain/LangGraph. Verify current provider APIs/model names when implementing integration changes.
- Model input contains text and minimal media metadata, not media bytes, previews, full local paths, or credentials. Treat filenames, metadata, summaries, and tool text as untrusted data; expose only structured allowlisted tools, never arbitrary shell/FFmpeg/file access.
- Path-based chat requests import locally before calling the model. Support numbered editing lists and straight/curly quotes; preserve source-to-range correspondence. Wait for the shared draft update, then replace full paths with imported-source references and IDs. Folder import is top-level only, naturally ordered and limited to 100 videos. Import failure must not start the Agent; completed imports remain visible.
- Streamdown renders assistant text; tool results remain structured data. Clear chat stops the reply and clears both UI history and model context, preserving draft, settings and exports.
- Store API keys in system secure storage, return only key presence, redact errors/logs, and do not fall back to plaintext. Preserve URL path prefixes and endpoint/key isolation as specified.
- Enforce revision checks, bounded context, paired tool calls/results, and the 20-tool-call per-turn limit. Do not replay historical tool execution. Model claims of success must match authoritative tool/job results.
- Explicit export requests may start exports directly; edit/preview requests must not. Clarify ambiguous asset references or missing time boundaries. Hiding chat preserves the session; stopping the Agent, clearing chat and cancelling an export are distinct operations.

## Verification and delivery

Use Node.js 22.12+ and the pinned pnpm version. Run commands from the repository root. The declared checks are `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, and `pnpm test:e2e`. `pnpm package` builds the unsigned macOS arm64 app. `pnpm test:e2e` also builds/packages before running Playwright; use it for relevant desktop, preload, navigation, and interaction changes.

Choose checks by affected behavior: shared/tool schema tests for contract changes; planner/output tests and real media integration for export changes; Electron checks for UI and bridge changes. Use the two specs' acceptance scenarios for the feature being implemented, especially stale revisions, idempotent starts, cancellation, mixed audio, real output profiles, and input/target protection.

Generate small temporary lavfi fixtures rather than using private videos or committing large media. Inject temporary Downloads/userData/cache for tests. Verify actual outputs with ffprobe and decoding/frame checks as appropriate; an HTML player or successful FFmpeg exit alone is insufficient. Automated model tests use mock endpoints; report real provider text/streaming/tool-loop validation separately.

For documentation-only edits, check references and formatting without running the application suite. Use `pnpm exec oxfmt --check AGENTS.md` for this file; avoid repository-wide formatting that changes unrelated work. Report executed checks, skipped/environment-blocked coverage, and remaining limitations accurately. Update both READMEs when delivered user-facing behavior or format contracts change. Do not install system software or alter user videos. Create commits, push branches or open PRs only when requested; existing session authorization is sufficient. When committing a batch of work, group related behavior and its tests together, inspect staged diffs, and exclude generated media, credentials and build artifacts.
