import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { ExportRequest, VideoQuickEditorApi, WatermarkSpec } from "@video-quick-editor/shared";

const api: VideoQuickEditorApi = {
  chooseAssets: async () => await ipcRenderer.invoke("assets:choose"),
  importDroppedFiles: async (files: File[]) =>
    await ipcRenderer.invoke(
      "assets:import-paths",
      files.map((file) => webUtils.getPathForFile(file)),
    ),
  chooseFont: async () => await ipcRenderer.invoke("font:choose"),
  chooseTool: async (kind) => await ipcRenderer.invoke("settings:choose-tool", kind),
  chooseOutput: async (suggestedName: string) =>
    await ipcRenderer.invoke("output:choose", suggestedName),
  getSettings: async () => await ipcRenderer.invoke("settings:get"),
  updateSettings: async (update) => await ipcRenderer.invoke("settings:update", update),
  checkTools: async () => await ipcRenderer.invoke("settings:check-tools"),
  createProxy: async (assetId: string) => await ipcRenderer.invoke("preview:proxy", assetId),
  previewFrame: async (input: { assetId: string; atUs: number; watermark: WatermarkSpec }) =>
    await ipcRenderer.invoke("preview:frame", input),
  planExport: async (request: ExportRequest) => await ipcRenderer.invoke("export:plan", request),
  startExport: async (request: ExportRequest) => await ipcRenderer.invoke("export:start", request),
  cancelExport: async (jobId: string) => await ipcRenderer.invoke("export:cancel", jobId),
  deleteJobs: async (jobIds: string[]) => await ipcRenderer.invoke("export:delete-jobs", jobIds),
  getJobs: async () => await ipcRenderer.invoke("export:get-jobs"),
  subscribeJobs(listener) {
    const wrapped = (
      _event: Electron.IpcRendererEvent,
      jobs: Parameters<typeof listener>[0],
    ): void => listener(jobs);
    ipcRenderer.on("export:jobs", wrapped);
    return () => ipcRenderer.removeListener("export:jobs", wrapped);
  },
  revealOutput: async (jobId: string) => await ipcRenderer.invoke("output:reveal", jobId),
  openOutput: async (jobId: string) => await ipcRenderer.invoke("output:open", jobId),
};

contextBridge.exposeInMainWorld("videoQuickEditor", api);
