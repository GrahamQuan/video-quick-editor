# Video Quick Editor Desktop

**English** | [简体中文](README.zh-CN.md)

A local video trimming, combining, and text watermarking tool for macOS. This standalone **Turborepo + pnpm workspace** uses Electron, React, TypeScript, TanStack Router, and Vite. The Electron main process calls locally installed FFmpeg/ffprobe directly, without Python, WASM, an HTTP service, or a legacy application.

## Toolchain

- Vite 8 uses the Rust-based Rolldown bundler for the renderer, main process, preload, and workspace libraries.
- TypeScript 7 provides strict type checking and declaration emit.
- Oxlint + `oxlint-tsgolint` provide type-aware linting, without ESLint.
- Oxfmt formats the repository, without Prettier.
- React Compiler uses the Oxc Rust backend in `@vitejs/plugin-react`.
- Tailwind CSS 4 integrates directly through the official `@tailwindcss/vite` plugin, without legacy PostCSS configuration.
- The main preview player uses the `VideoPlayer`, `VideoSkin`, and `Video` preset from `@videojs/react`. Its controls follow the application's language setting.
- All packages declare `"type": "module"`. Source code, configuration, and ESM output use `.js`, not `.mjs`. The Electron sandbox preload and electron-builder packaging hook use CommonJS. For the preload, the bundler emits CommonJS while keeping the filename `index.js`, as required by Electron's sandbox runtime.

UI colors are centralized in renderer/styles.css: `--color-primary` is the green accent and `--color-secondary` uses that green at 16% opacity for selections and secondary controls. Borders, hover and focus states derive from the same primary color.

## Repository structure

```text
apps/video-quick-editor-desktop/   Electron main / preload / React renderer
packages/shared/                 IPC schemas and shared types (Zod runtime validation)
packages/media-core/             Probing, planning, FFmpeg runner, validation, and output protection
```

Start with `packages/shared/src/index.ts`, then read `packages/media-core/src/planner.ts` and `runner.ts`, followed by the IPC boundaries in `apps/video-quick-editor-desktop/src/main/index.ts` and the renderer.

## Install on macOS

The installer targets **Apple Silicon (arm64)**. Open `Video-Quick-Editor-<version>-mac-arm64.dmg`, drag **Video Quick Editor.app** to **Applications**, then launch it from Finder. The installed application includes Electron and needs neither Node.js nor pnpm. Replacing the app preserves its existing settings and encrypted model profiles; chat and editing projects are still session-only.

FFmpeg and ffprobe are external dependencies: they are **not bundled, downloaded or installed by the app**. Install both separately, or select existing executables in Settings. Required encoders are `libx264`, `libx265` and `aac`; required filters include drawtext, video scaling/concatenation/timing, and audio trimming/resampling/silence. The app reports exactly which capabilities are missing.

Discovery checks `/opt/homebrew/bin`, `/usr/local/bin`, `/usr/bin`, then PATH, without requiring an interactive shell. An explicitly configured path takes precedence; if it stops working, the app reports the failure instead of silently selecting another binary.

A global bilingual banner reports detection, missing executables, permission/startup failures, timeout, or missing capabilities. **Choose executable**, **Open settings** and **Check again** restore availability without restarting. While unavailable, media import, proxy/frame generation, planning and exports are blocked in both UI and main-process APIs. Model configuration, connection tests, text chat and existing draft editing remain available. Every media operation rechecks the toolchain; recovery does not replay blocked actions. Queued jobs fail if tools are unavailable when execution begins; running jobs retain their original executable paths.

Builds without a Developer ID use a local ad-hoc signature and are **not notarized**. This does not guarantee a warning-free launch after downloading. Public distribution signing, notarization and downloaded-app acceptance remain separate release work.

## Automated main releases

Download stable versions and development builds from [GitHub Releases](https://github.com/GrahamQuan/video-quick-editor/releases).

Every push to `main` triggers **Main prerelease**; it can also be run manually from Actions on `main`. The workflow uses a macOS arm64 runner, Node.js 24 and the pinned pnpm version, runs typecheck, lint, unit/media and packaged Electron tests, then builds a DMG. FFmpeg is installed only in the disposable CI runner for testing, never in the installer.

Each run publishes a separate prerelease such as `v0.1.0-main.12`, where `0.1.0` is the desktop package version and `12` is the workflow run number. CI changes the app version only in its checkout; it does not commit version bumps or overwrite the existing stable release. The DMG filename and app version match the release. The build job has read-only repository access; only the publishing job receives `contents: write` through `GITHUB_TOKEN`, with no additional secrets required.

Releases remain drafts until both the DMG and `SHA256SUMS.txt` have uploaded and GitHub reports matching sizes and SHA-256 digests. A failed upload can resume from the draft. A published release is left untouched on a retry; different content or a different source commit causes an error instead of replacement. CI artifacts are retained for 14 days. These automated packages remain ad-hoc signed and unnotarized; this workflow does not add automatic updates to the app.

## Development setup

- macOS Apple Silicon
- Node.js 22.12+ and the pinned pnpm 10.33.0
- External FFmpeg/ffprobe for media processing and integration tests

The interface defaults to English. Switch between English and 简体中文 in Settings. The selection is saved to Electron's `userData/settings.json` and persists across launches; older settings are automatically migrated to English.

```bash
pnpm install
pnpm dev
pnpm build
pnpm format
pnpm format:check
pnpm typecheck
pnpm lint
pnpm test
pnpm test:e2e
pnpm package
pnpm package:dir
```

`pnpm package` produces `apps/video-quick-editor-desktop/release/Video-Quick-Editor-0.1.0-mac-arm64.dmg` for the current version. `pnpm package:dir` produces only `apps/video-quick-editor-desktop/release/mac-arm64/Video Quick Editor.app`; `pnpm test:e2e` uses this directory packaging path without creating a DMG. The packaging hook repairs the local bundle signature before image creation; it does not provide Developer ID signing or notarization.

`pnpm dev` first verifies the development dependency's `Electron.app`. If its bundle seal in the pnpm cache is damaged, the script regenerates a local ad-hoc signature for that development dependency on macOS before starting Vite. Valid signatures are left intact.

## Workflow

1. Add or drag in MP4, MOV, or MKV files. One clip opens the trimming workflow; two or more clips open the combined timeline. Files play in the order received.
2. Select a clip and set its `[start, end)` range. When combining clips, you can add, duplicate, and drag them; the interface shows the output order from top to bottom.
3. Optionally apply a clip-specific text watermark with white lettering and a black outline. A verified macOS system font is selected automatically when available; actual watermark glyphs are checked before preview/export. You can change it with the font picker.
4. A single clip defaults to `accurate`, while multiple clips default to `normalize`. An explicitly selected `copy` mode is never silently changed back.
5. Choose an output location or use macOS Downloads. Default names use local time in `YYYY_MM_DD--HH_mm_ss` format (24-hour clock; filename-safe form of `YYYY/MM/DD hh:mm:ss`), with `_2`, `_3`, and so on added to resolve name conflicts.
6. View authoritative main-process status and progress to one decimal place on the Exports page. Cancel a job to automatically remove its partial output, or select multiple finished jobs to clear their queue entries in bulk (exported videos are retained).

Playback of the currently selected clip previews only its selected in/out range: it pauses at the out point and restarts from the in point when played again. Changing the range moves the playhead back to the in point if it is outside the new range. Preview timing is approximate; FFmpeg determines final export boundaries.

Watermark outline thickness defaults to 1 output pixel and can be adjusted from 0–20 pixels; 0 disables the black outline. The setting applies to overlay previews, FFmpeg frame previews, and exports.

Watermarks belong to the selected clip: enable, text, font, outline, position, size, and margin are independent. Switching clips restores its settings; combined exports draw each watermark only during its own clip. Duplicating a clip copies its settings, which can then be edited independently.

Watermark defaults: startup preserves a readable selected font, otherwise checks macOS PingFang / Heiti files and selects one after validating a Chinese/Latin glyph sample. No font installation or download is needed. The editor shows the actual font filename and allows replacement. Preview/export still validate every glyph in the actual text and its fit; manual selection is required only if no supported system font is available.

The trim ruler displays time ticks, not an audio waveform. Drag its left/right handles to set start/end; time inputs stay synchronized in both directions. Arrow keys adjust by 0.1 seconds, or 1 second with Shift.

## Format rules and limitations

- New drafts use `mp4-compatible`: real MP4 with faststart, H.264/libx264, medium, CRF 18, 8-bit yuv420p; audio becomes AAC, 48 kHz, stereo, 192 kb/s. MOV/MKV inputs also produce `.mp4`.
- `accurate`: Re-encodes one clip and preserves source timing. Non-AAC audio is supported with the compatible profile. Odd display dimensions are padded to even values.
- `normalize`: Trims each clip and normalizes dimensions, SAR, and frame rate. Scales proportionally with black padding. When audio is present, normalizes it to AAC 48 kHz stereo at 192 kb/s and pads missing or short audio with silence.
- `copy`: No re-encoding; watermark and encoder settings are unavailable. Cut boundaries depend on keyframes/packets. Multiple clips are first written to controlled temporary segments, then concatenated.
- `source` preserves the original container/codec rules (including the legacy AAC-only accurate restriction). Old IPC requests without `outputProfile` remain `source`. Select `source` explicitly before copy or HEVC; conflicts with `mp4-compatible` are errors. Changing an extension alone never transcodes.
- Normalize uses the first reliable frame rate; compatible VFR/unknown inputs fall back to 30 fps, disclosed in the plan.
- Re-encoding supports only standard SDR, 8-bit inputs without rotation metadata. HDR, 10-bit, and rotated inputs are explicitly blocked; `copy` preserves these properties.
- Only the first regular video track and first audio track are used. Additional tracks, subtitles, attachments, and chapters are not retained.

The player is for navigation and does not guarantee frame accuracy. When Chromium cannot play a file that FFmpeg can process, the application can generate a cached 720p H.264/AAC proxy. The cache key includes the source file's path, size, modification time, and settings; final exports still read the original file. The React watermark overlay is an approximate preview; the export-frame preview uses the actual FFmpeg drawtext filter.

The default output directory comes from Electron's `app.getPath('downloads')`, with no hardcoded username. Missing directories are created only for actual exports. Output is first written to a temporary directory within the destination, validated with ffprobe, and then published exclusively. Existing files are not overwritten without replacement authorization through the Save dialog. Input files and their symlink/hard-link aliases cannot be used as output destinations.

## Agent editing

Open the top-right side-chat button. In **Settings → Models**, add named OpenAI-compatible Chat Completions profiles, each with its own Base URL, Model ID, context budget and API key. Up to 50 profiles are supported, including different models on the same endpoint. The first saved profile becomes active; later additions preserve your choice. Select the active profile directly in chat; the selection survives navigation and restart. A profile can be saved without a key, but cannot send until one is supplied. The DeepSeek preset currently suggests `deepseek-v4-flash`; the ID remains editable. The connection test uses the current form snapshot and checks text, streaming and a harmless tool loop with no media tools. It neither saves the form nor changes the active selection. Saving alone does not mean the connection was verified.

Editing, deleting or changing the selected profile during a reply affects the next turn. The current turn retains its original endpoint, key, model and budget, including all tool steps. For a request that imports local paths, this snapshot is locked **before import**; missing configuration prevents that automatic import. Each turn displays its actual profile name and Model ID, which remain unchanged in history. Switching preserves messages, unsent text, draft and jobs. Deleting the active profile selects the first remaining entry, or no profile if the list is empty.

Existing single-model settings migrate atomically without re-entering the key. A damaged or newer configuration file is preserved and reported, not replaced by an empty list. Independent encrypted credentials prevent one damaged key from removing other profiles; replace that profile's key to recover. After repairing an unreadable configuration file, restart to retry loading it.

Example: “Keep A from 5–20 seconds and B's first 10 seconds, combine them, add ‘Travel notes’ and export.” If the selected font lacks any requested glyph, choose another font using the picker. For edits or previews alone, no export is requested. “Stop reply” stops subsequent Agent calls; cancel submitted exports separately from the Exports page.

The main process owns the shared versioned draft. Manual changes and Agent tools use that draft; stale writes/plans fail, exports use snapshots, and repeated request IDs do not create duplicate jobs. Multiple requested exports enter a serial queue. Hiding chat or navigating preserves the session, draft input and running work; narrow windows use an overlay.

Online models receive text instructions, display filenames and media parameters, never video/audio/preview images. Keys are encrypted with Electron `safeStorage` (macOS Keychain), stored in separate credential files, and never returned through settings IPC. Changed endpoints, including a different path prefix on the same host, require a new key or explicit key deletion. Blank key fields on unchanged endpoints retain only that profile’s existing credential. HTTPS is required except loopback; redirects are refused. No plaintext fallback exists. Model changes apply next turn. Unknown models use a configurable conservative context budget; whole tool turns remain grouped, and over-budget requests fail rather than silently discard user constraints. DeepSeek thinking is disabled pending a verified reasoning/tool round trip.

Real DeepSeek text/streaming/multistep acceptance requires a user-configured key and is not claimed by offline tests. Automatic tests use mock providers and temporary lavfi media.

Agent chat shows replies in execution order and collapses tool results into expandable details. Tool results automatically feed the next model step; output limits or missing final replies are reported explicitly.

Assistant replies use Streamdown for streaming Markdown, CJK emphasis, lists, tables, and copyable code blocks. Tool details remain collapsible structured data. Chat follows new replies unless you scroll up. Model-generated links are displayed as text and remote images are not loaded.

Use **Clear chat** to remove all messages, unsent text, and model conversation context in one click. An active reply stops before clearing; editor drafts, model settings, and export jobs are kept.

### Start with local paths

Paste absolute file/folder paths into the chat input (one per line), then click **Import paths**. This works without an API key and never sends these paths to the model. Quoted paths, `~/` and local `file://` URLs are supported. Folders import top-level MP4/MOV/MKV files in natural filename order, excluding hidden files, subfolders and directory-entry symlinks; each import is limited to 100 videos.

You can also send `Import "/path/video.mp4", then keep 2 to 5 seconds; do not export` (folders work too). The app imports locally, waits for the timeline update, replaces paths with imported-source references, then asks the configured model to continue. Quote paths containing spaces. If a later import fails, earlier imports remain and no model request is sent.

Paths are also recognized in numbered editing requests without an “Import” prefix, such as `Video editing: 1. "/path/a.mp4" trim 1–3 seconds; 2. "/path/b.mp4" trim 5–10 seconds; then combine`. Straight quotes, backticks, and either direction of curly quotes are supported. Each source retains its own reference and time-range instructions.

```text
Edit and combine these videos:
1. "/Users/you/Movies/a.mp4": keep 1 to 3 seconds
2. "/Users/you/Movies/b.mp4": keep 5 to 10 seconds
Combine the clips and export the video.
```

## Security boundaries

The renderer enables `contextIsolation` and sandboxing and disables `nodeIntegration`. The preload exposes only a typed API, not `ipcRenderer`. The main process revalidates IPC senders, payloads, media IDs, font IDs, output tokens, and file identity. Media URLs map only to files imported or generated in the current session. FFmpeg always runs with `spawn(executable, args, { shell: false })` and `-nostdin`.

## Testing

Vitest covers shared contracts, output profiles, watermark glyphs, path parsing, revision checks, idempotent jobs, and model configuration. Media integration tests generate temporary lavfi videos and verify real FFmpeg output; unavailable FFmpeg prerequisites are reported as skips. Playwright launches the packaged Electron app with temporary userData and checks bilingual settings, trim playback, path import, multistep Agent tools, Markdown, clearing chat, model switching during import/reply, and dependency blocking/recovery with a real watermarked MP4 export. Unit tests cover capability detection with temporary fake executables, stale checks, profile migration, independent credentials and atomic revision-checked writes. Tests do not use private videos; mock model endpoints do not substitute for real-provider acceptance.

Developer ID signing, notarization, automatic updates, cross-platform installers, professional multitrack timelines, transitions, subtitles, image watermarks, network media, project persistence, and crash recovery are not included.

Implementation contracts: [Agent editing](specs/agent-video-editing.md), [desktop installation and dependencies](specs/desktop-installation-dependencies.md), [multi-model chat](specs/multi-model-chat.md).
