import type { VideoQuickEditorApi } from "@video-quick-editor/shared";

declare global {
  interface Window {
    videoQuickEditor: VideoQuickEditorApi;
  }
}

export {};
