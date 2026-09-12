# Video Quick Editor

**English** | [简体中文](README.zh-CN.md)

A local video editor for macOS. Trim clips, combine videos in order, add text watermarks, or describe your edits in chat.

**[Download the app](https://github.com/GrahamQuan/video-quick-editor/releases)** · For Apple Silicon Macs (M-series chips)

## Install and get started

1. Open **Assets** on a GitHub Release and download the file ending in `mac-arm64.dmg`. Versions marked **Pre-release** contain newer features and may be less stable.
2. Open the DMG, drag **Video Quick Editor.app** into **Applications**, then launch it.
3. The app requires **FFmpeg and ffprobe** installed on your Mac; neither is included in the installer. If they are missing, choose existing tool paths in Settings, then select **Save and check again**.
4. Choose **English** or **简体中文** in **Settings → Language**.

Current packages are not notarized by Apple. If macOS says Apple cannot check the app for malicious software, confirm you downloaded it from this repository, then go to **System Settings → Privacy & Security → Open Anyway**.

## Trim a video

1. Use the add button or drag a file into the window. Supported inputs are **MP4, MOV and MKV**.
2. Select the video and drag the two ends of the time ruler to choose the portion to keep. You can also enter the start and end times directly.
3. Play the selected range to check it. Arrow keys adjust the ruler by 0.1 seconds; hold Shift to adjust by 1 second.
4. Optionally add a watermark, choose an output location, then submit the export.
5. Open **Exports** to follow progress and open the finished video or reveal it in Finder.

The default output is a broadly compatible **MP4**, saved to **Downloads**. Names look like `2026_09_07--22_30_45.mp4`; a suffix is added when needed to avoid overwriting an existing file.

## Combine videos

Import multiple videos and open **Combine**. Confirm which clips to include, arrange their order, and set the range to keep from each one. Then submit the combined export.

Different video sizes are scaled proportionally, with black padding when needed. You can keep editing after submitting an export: each submitted task retains its original settings, and tasks run one at a time.

## Add a text watermark

Select a clip, enable its text watermark, and enter your text.

- The default position is **bottom left**, with a font size of **24**.
- An available system font is selected automatically, so extra font installation is usually unnecessary. You can also choose a font manually.
- Adjust the position, size, margin and black outline. Set the outline to 0 to turn it off.
- Each clip has its own watermark settings. Duplicating a clip copies those settings too.

The player overlay is an approximate preview. Use **Preview exported frame** to check the actual result. If characters are missing or the text does not fit, choose another font, reduce its size or shorten the text.

## Edit with AI chat

Manual editing does not require an API key. To use AI, add a model in **Settings → Models**, enter your provider's **Base URL, Model ID and API key**, save and test the connection, then open the chat panel at the top right.

Describe what you want:

> Keep the first video from 5 to 20 seconds and the first 10 seconds of the second video. Combine them, add “Travel notes” as a watermark, and export.

You can also include local paths in your editing request:

```text
Edit and combine these videos:
1. "/Users/you/Movies/a.mp4": keep seconds 1 to 3.
2. "/Users/you/Movies/b.mp4": keep seconds 5 to 10.
Combine the clips and export the result.
```

Replace the example paths with your own. Keep quotes around paths containing spaces. The app imports the files before continuing with the requested edits.

- To import files without AI, paste their paths and select **Import paths**. No model configuration is needed.
- Folder paths import only top-level videos, in natural filename order, with a limit of 100 videos per import.
- Save multiple models and switch between them at the top of chat. Changes take effect on the next reply.
- **Stop reply** stops further AI actions. Cancel already submitted exports separately on the Exports page.
- **Clear chat** removes messages and conversation context while keeping your edits, model settings and export tasks.

Video processing stays on your Mac. Online models receive text instructions, display filenames and necessary media information, never video, audio or preview images. API keys are stored encrypted locally.

## Update the app

Go to **Settings → App updates → Check for updates**. Stable versions check for stable releases by default; select **Include prereleases** to try development builds.

When a newer version is available, select **Open GitHub download page** and download its DMG. Finish your exports, quit the app, then replace the old copy in Applications. Settings and model profiles are preserved.

The app does not download or install updates automatically. If your older version has no update controls, visit [GitHub Releases](https://github.com/GrahamQuan/video-quick-editor/releases) directly.

## Common questions

| Problem                                    | What to do                                                                                                                                |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| FFmpeg / ffprobe is missing                | Install the tools or select existing executables in Settings, then check again. If a capability is missing, use a build that includes it. |
| A video will not preview                   | Try generating a preview copy. Exports still use the original video.                                                                      |
| I want faster exports                      | Fast copy mode skips re-encoding, but does not support watermarks and may shift cut boundaries. Keep the default mode for most edits.     |
| HDR, 10-bit or rotated video cannot export | Re-encoding these inputs is not currently supported. Convert them to standard SDR video first.                                            |
| Tasks or chat disappear after quitting     | Editing, chat and the export queue last for the current session only. Complete needed exports before quitting.                            |

Intel Macs, Windows and Linux are not supported. The app does not offer multitrack editing, transitions or subtitle editing. Additional audio tracks, subtitles and chapters are not retained in exports.

## Run from source

Developers need Node.js 22.12+ and pnpm 10.33.0:

```bash
pnpm install
pnpm dev
```

Use `pnpm package` to build an installer. See [AGENTS.md](AGENTS.md) and the [specification](specs/agent-video-editing.md) for implementation and development guidance.
