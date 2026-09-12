import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { ExportRequest, VideoQuickEditorApi, WatermarkSpec } from "@video-quick-editor/shared";

function subscribe<T>(channel: string, listener: (value: T) => void): () => void {
  const wrapped = (_event: Electron.IpcRendererEvent, value: T) => listener(value);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
}
const api: VideoQuickEditorApi = {
  getAppUpdate: async () => await ipcRenderer.invoke("app:update-get"),
  checkAppUpdate: async (includePrereleases) =>
    await ipcRenderer.invoke("app:update-check", includePrereleases),
  openAppUpdate: async () => await ipcRenderer.invoke("app:update-open"),
  subscribeAppUpdate: (listener) => subscribe("app:update-state", listener),
  getAssets: async () => await ipcRenderer.invoke("assets:get"),
  retryExport: async (jobId, requestId) =>
    await ipcRenderer.invoke("export:retry", { jobId, requestId }),
  getDraft: async () => await ipcRenderer.invoke("editor:get"),
  updateDraft: async (input) => await ipcRenderer.invoke("editor:update", input),
  subscribeDraft: (listener) => subscribe("editor:draft", listener),
  getDependencies: async () => await ipcRenderer.invoke("dependencies:get"),
  subscribeDependencies: (listener) => subscribe("dependencies:state", listener),
  listModelProfiles: async () => await ipcRenderer.invoke("model:profiles"),
  saveModelProfile: async (input) => await ipcRenderer.invoke("model:save-profile", input),
  deleteModelProfile: async (input) => await ipcRenderer.invoke("model:delete-profile", input),
  selectModelProfile: async (input) => await ipcRenderer.invoke("model:select-profile", input),
  testModelProfile: async (input) => await ipcRenderer.invoke("model:test-profile", input),
  subscribeModelProfiles: (listener) => subscribe("model:profiles", listener),
  beginAgentTurn: async () => await ipcRenderer.invoke("agent:reserve"),
  releaseAgentTurn: async (token) => await ipcRenderer.invoke("agent:release", token),
  getModel: async () => await ipcRenderer.invoke("model:get"),
  saveModel: async (input) => await ipcRenderer.invoke("model:save", input),
  testModel: async (input) => await ipcRenderer.invoke("model:test", input),
  getAgentSession: async () => await ipcRenderer.invoke("agent:get"),
  sendAgent: async (text, displayText, reservationToken) =>
    await ipcRenderer.invoke("agent:send", text, displayText, reservationToken),
  stopAgent: async () => await ipcRenderer.invoke("agent:stop"),
  clearAgent: async () => await ipcRenderer.invoke("agent:clear"),
  subscribeAgent: (listener) => subscribe("agent:session", listener),
  chooseAssets: async () => await ipcRenderer.invoke("assets:choose"),
  importLocalPaths: async (paths) => await ipcRenderer.invoke("assets:import-paths", paths),
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
