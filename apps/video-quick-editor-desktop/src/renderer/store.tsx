import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
import type {
  AssetView,
  ClipSpec,
  ExportJob,
  ExportRequest,
  OutputSelection,
  Settings,
  WatermarkSpec,
} from "@video-quick-editor/shared";

interface EditorState {
  assets: AssetView[];
  clips: ClipSpec[];
  selectedClipId: string | null;
  mode: ExportRequest["mode"];
  modeManual: boolean;
  watermark: WatermarkSpec;
  output: OutputSelection | null;
  videoCodec: ExportRequest["videoCodec"];
  normalize: ExportRequest["normalize"];
  jobs: ExportJob[];
  settings: Settings | null;
  busy: string | null;
  error: string | null;
}

interface Store extends EditorState {
  selectedClip: ClipSpec | null;
  selectedAsset: AssetView | null;
  importWithDialog: () => Promise<void>;
  importDropped: (files: File[]) => Promise<void>;
  updateClip: (id: string, update: Partial<ClipSpec>) => void;
  selectClip: (id: string) => void;
  moveClip: (id: string, delta: number) => void;
  reorderClip: (sourceId: string, targetId: string) => void;
  duplicateClip: (id: string) => void;
  removeClip: (id: string) => void;
  setMode: (mode: ExportRequest["mode"]) => void;
  setWatermark: (update: Partial<WatermarkSpec>) => void;
  setOutput: (output: OutputSelection | null) => void;
  setVideoCodec: (codec: ExportRequest["videoCodec"]) => void;
  setNormalize: (update: Partial<ExportRequest["normalize"]>) => void;
  setSettings: (settings: Settings) => void;
  setError: (error: string | null) => void;
  createRequest: () => ExportRequest;
}

const Context = createContext<Store | null>(null);

const initialWatermark: WatermarkSpec = {
  enabled: false,
  text: "",
  fontId: null,
  position: "bottom-right",
  fontSize: 32,
  margin: 24,
};

export function StoreProvider({ children }: PropsWithChildren): React.JSX.Element {
  const [state, setState] = useState<EditorState>({
    assets: [],
    clips: [],
    selectedClipId: null,
    mode: "accurate",
    modeManual: false,
    watermark: initialWatermark,
    output: null,
    videoCodec: null,
    normalize: { width: null, height: null, fps: null },
    jobs: [],
    settings: null,
    busy: null,
    error: null,
  });

  useEffect(() => {
    let active = true;
    void Promise.all([window.videoQuickEditor.getJobs(), window.videoQuickEditor.getSettings()])
      .then(([jobs, settings]) => {
        if (active)
          setState((current) => ({
            ...current,
            jobs,
            settings,
            watermark: { ...current.watermark, fontId: settings.defaultFontId },
          }));
      })
      .catch(
        (error: unknown) =>
          active && setState((current) => ({ ...current, error: message(error) })),
      );
    const unsubscribe = window.videoQuickEditor.subscribeJobs((jobs) =>
      setState((current) => ({ ...current, jobs })),
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const appendAssets = useCallback((assets: AssetView[]) => {
    setState((current) => {
      const newClips = assets.map((asset) => ({
        id: crypto.randomUUID(),
        assetId: asset.id,
        startUs: 0,
        endUs: asset.durationUs,
      }));
      const clips = [...current.clips, ...newClips];
      const enteredCombine = clips.length > 1 && current.mode === "accurate";
      return {
        ...current,
        assets: [...current.assets, ...assets],
        clips,
        selectedClipId: current.selectedClipId ?? newClips[0]?.id ?? null,
        mode:
          enteredCombine || (!current.modeManual && clips.length > 1) ? "normalize" : current.mode,
        modeManual: enteredCombine ? false : current.modeManual,
        busy: null,
        error: null,
      };
    });
  }, []);

  const runImport = useCallback(
    async (getAssets: () => Promise<AssetView[]>) => {
      setState((current) => ({ ...current, busy: "正在探测媒体…", error: null }));
      try {
        appendAssets(await getAssets());
      } catch (error) {
        setState((current) => ({ ...current, busy: null, error: message(error) }));
      }
    },
    [appendAssets],
  );

  const store = useMemo<Store>(() => {
    const selectedClip = state.clips.find((clip) => clip.id === state.selectedClipId) ?? null;
    const selectedAsset = selectedClip
      ? (state.assets.find((asset) => asset.id === selectedClip.assetId) ?? null)
      : null;
    return {
      ...state,
      selectedClip,
      selectedAsset,
      importWithDialog: async () => await runImport(() => window.videoQuickEditor.chooseAssets()),
      importDropped: async (files) =>
        await runImport(() => window.videoQuickEditor.importDroppedFiles(files)),
      updateClip(id, update) {
        setState((current) => ({
          ...current,
          clips: current.clips.map((clip) => (clip.id === id ? { ...clip, ...update } : clip)),
        }));
      },
      selectClip(id) {
        setState((current) => ({ ...current, selectedClipId: id }));
      },
      moveClip(id, delta) {
        setState((current) => {
          const from = current.clips.findIndex((clip) => clip.id === id);
          const to = from + delta;
          if (from < 0 || to < 0 || to >= current.clips.length) return current;
          const clips = [...current.clips];
          const [clip] = clips.splice(from, 1);
          clips.splice(to, 0, clip!);
          return { ...current, clips };
        });
      },
      reorderClip(sourceId, targetId) {
        setState((current) => {
          const from = current.clips.findIndex((clip) => clip.id === sourceId);
          const to = current.clips.findIndex((clip) => clip.id === targetId);
          if (from < 0 || to < 0 || from === to) return current;
          const clips = [...current.clips];
          const [clip] = clips.splice(from, 1);
          clips.splice(to, 0, clip!);
          return { ...current, clips };
        });
      },
      duplicateClip(id) {
        setState((current) => {
          const index = current.clips.findIndex((clip) => clip.id === id);
          if (index < 0) return current;
          const copy = { ...current.clips[index]!, id: crypto.randomUUID() };
          const clips = [...current.clips];
          clips.splice(index + 1, 0, copy);
          const enteredCombine = current.mode === "accurate";
          return {
            ...current,
            clips,
            selectedClipId: copy.id,
            mode: enteredCombine || !current.modeManual ? "normalize" : current.mode,
            modeManual: enteredCombine ? false : current.modeManual,
          };
        });
      },
      removeClip(id) {
        setState((current) => {
          const index = current.clips.findIndex((clip) => clip.id === id);
          const clips = current.clips.filter((clip) => clip.id !== id);
          const selectedClipId =
            current.selectedClipId === id
              ? (clips[Math.min(index, clips.length - 1)]?.id ?? null)
              : current.selectedClipId;
          return {
            ...current,
            clips,
            selectedClipId,
            mode: !current.modeManual && clips.length <= 1 ? "accurate" : current.mode,
          };
        });
      },
      setMode(mode) {
        setState((current) => ({ ...current, mode, modeManual: true }));
      },
      setWatermark(update) {
        setState((current) => ({ ...current, watermark: { ...current.watermark, ...update } }));
      },
      setOutput(output) {
        setState((current) => ({ ...current, output }));
      },
      setVideoCodec(videoCodec) {
        setState((current) => ({ ...current, videoCodec }));
      },
      setNormalize(update) {
        setState((current) => ({ ...current, normalize: { ...current.normalize, ...update } }));
      },
      setSettings(settings) {
        setState((current) => ({ ...current, settings }));
      },
      setError(error) {
        setState((current) => ({ ...current, error }));
      },
      createRequest: () => ({
        clips: state.clips,
        mode: state.mode,
        modeWasManuallySelected: state.modeManual,
        watermark: state.watermark,
        output: state.output,
        videoCodec: state.videoCodec,
        normalize: state.normalize,
      }),
    };
  }, [state, runImport]);

  return <Context.Provider value={store}>{children}</Context.Provider>;
}

export function useStore(): Store {
  const store = useContext(Context);
  if (!store) throw new Error("StoreProvider missing");
  return store;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
