import type { DependencyState } from "@video-quick-editor/shared";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import type {
  EditorDraft,
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
  operation: "trim" | "combine";
  combineClipIds: string[];
  clips: ClipSpec[];
  selectedClipId: string | null;
  mode: ExportRequest["mode"];
  modeManual: boolean;
  outputProfile: "source" | "mp4-compatible";
  watermark: WatermarkSpec;
  output: OutputSelection | null;
  videoCodec: ExportRequest["videoCodec"];
  normalize: ExportRequest["normalize"];
  jobs: ExportJob[];
  settings: Settings | null;
  dependencies: DependencyState;
  busy: "probing" | null;
  error: string | null;
}

interface Store extends EditorState {
  taskClips: ClipSpec[];
  assetCount: number;
  setOperation: (operation: "trim" | "combine") => void;
  toggleCombine: (id: string) => void;
  selectAllCombine: (all: boolean) => void;
  moveCombine: (id: string, delta: number) => void;
  selectedClip: ClipSpec | null;
  selectedAsset: AssetView | null;
  importWithDialog: () => Promise<void>;
  importLocalPaths: (paths: string[]) => Promise<boolean>;
  importForAgent: (paths: string[]) => Promise<AssetView[]>;
  importDropped: (files: File[]) => Promise<void>;
  updateClip: (id: string, update: Partial<ClipSpec>) => void;
  selectClip: (id: string) => void;
  moveClip: (id: string, delta: number) => void;
  reorderClip: (sourceId: string, targetId: string) => void;
  duplicateClip: (id: string) => void;
  removeClip: (id: string) => void;
  setOutputProfile: (profile: "source" | "mp4-compatible") => void;
  setMode: (mode: ExportRequest["mode"]) => void;
  setWatermark: (update: Partial<WatermarkSpec>) => void;
  setOutput: (output: OutputSelection | null) => void;
  setVideoCodec: (codec: ExportRequest["videoCodec"]) => void;
  setNormalize: (update: Partial<ExportRequest["normalize"]>) => void;
  setSettings: (settings: Settings) => void;
  setError: (error: string | null) => void;
  createRequest: () => Promise<ExportRequest>;
}

const Context = createContext<Store | null>(null);

const initialWatermark: WatermarkSpec = {
  enabled: false,
  text: "",
  fontId: null,
  position: "bottom-left",
  fontSize: 24,
  borderWidth: 1,
  margin: 24,
};

export function StoreProvider({ children }: PropsWithChildren): React.JSX.Element {
  const [state, setState] = useState<EditorState>({
    assets: [],
    operation: "trim",
    combineClipIds: [],
    clips: [],
    selectedClipId: null,
    mode: "accurate",
    modeManual: false,
    outputProfile: "mp4-compatible",
    watermark: initialWatermark,
    output: null,
    videoCodec: null,
    normalize: { width: null, height: null, fps: null },
    jobs: [],
    settings: null,
    dependencies: { status: "checking", generation: 0, tools: [] },
    busy: null,
    error: null,
  });
  const draftRef = useRef<EditorDraft | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const receive = useCallback((draft: EditorDraft) => {
    if (draftRef.current && draft.revision < draftRef.current.revision) return;
    draftRef.current = draft;
    setState((s) => ({
      ...s,
      ...draft.request,
      selectedClipId: draft.selectedClipId,
      operation: draft.operation,
      combineClipIds: draft.combineClipIds,
      modeManual: draft.request.modeWasManuallySelected,
    }));
  }, []);
  const mutate = useCallback(
    (change: (draft: EditorDraft) => void) => {
      queue.current = queue.current
        .then(async () => {
          const before = draftRef.current ?? (await window.videoQuickEditor.getDraft());
          const draft = structuredClone(before);
          change(draft);
          receive(
            await window.videoQuickEditor.updateDraft({
              expectedRevision: before.revision,
              request: draft.request,
              selectedClipId: draft.selectedClipId,
              operation: draft.operation,
              combineClipIds: draft.combineClipIds,
              combineInitialized: draft.combineInitialized,
              combineOrderCustomized: draft.combineOrderCustomized,
            }),
          );
        })
        .catch(async (error: unknown) => {
          setState((s) => ({ ...s, error: message(error) }));
          receive(await window.videoQuickEditor.getDraft());
        });
    },
    [receive],
  );
  useEffect(() => {
    const updateDependencies = (dependencies: DependencyState) =>
      setState((s) =>
        dependencies.generation < s.dependencies.generation ? s : { ...s, dependencies },
      );
    void window.videoQuickEditor.getDependencies().then(updateDependencies);
    const unDependencies = window.videoQuickEditor.subscribeDependencies(updateDependencies);
    const unDraft = window.videoQuickEditor.subscribeDraft(receive);
    const unJobs = window.videoQuickEditor.subscribeJobs((jobs) =>
      setState((s) => ({ ...s, jobs })),
    );
    void Promise.all([
      window.videoQuickEditor.getDraft(),
      window.videoQuickEditor.getJobs(),
      window.videoQuickEditor.getSettings(),
      window.videoQuickEditor.getAssets(),
    ])
      .then(([draft, jobs, settings, assets]) => {
        receive(draft);
        setState((s) => ({ ...s, jobs, settings, assets }));
        if (!draft.request.watermark.fontId && settings.defaultFontId)
          mutate((d) => {
            d.request.watermark.fontId = settings.defaultFontId;
          });
      })
      .catch((e: unknown) => setState((s) => ({ ...s, error: message(e) })));
    return () => {
      unDependencies();
      unDraft();
      unJobs();
    };
  }, [receive, mutate]);
  const runImport = useCallback(
    async (getAssets: () => Promise<AssetView[]>) => {
      setState((s) => ({ ...s, busy: "probing", error: null }));
      try {
        const assets = await getAssets();
        setState((s) => ({ ...s, assets: [...s.assets, ...assets], busy: null }));
        mutate((d) => {
          d.request.clips.push(
            ...assets.map((a) => ({
              id: crypto.randomUUID(),
              assetId: a.id,
              startUs: 0,
              endUs: a.durationUs,
            })),
          );
          d.selectedClipId = d.selectedClipId ?? d.request.clips[0]?.id ?? null;
          if (!d.request.modeWasManuallySelected)
            d.request.mode = d.request.clips.length > 1 ? "normalize" : "accurate";
        });
        return true;
      } catch (e) {
        setState((s) => ({ ...s, busy: null, error: message(e) }));
        return false;
      }
    },
    [mutate],
  );
  useEffect(() => {
    if (state.clips.some((c) => !state.assets.some((a) => a.id === c.assetId)))
      void window.videoQuickEditor
        .getAssets()
        .then((assets) => setState((s) => ({ ...s, assets })));
  }, [state.clips, state.assets]);
  const store = useMemo<Store>(() => {
    const selectedClip = state.clips.find((c) => c.id === state.selectedClipId) ?? null;
    const move = (sourceId: string, targetId: string) =>
      mutate((d) => {
        const from = d.request.clips.findIndex((c) => c.id === sourceId),
          to = d.request.clips.findIndex((c) => c.id === targetId);
        if (from < 0 || to < 0) return;
        const [clip] = d.request.clips.splice(from, 1);
        d.request.clips.splice(to, 0, clip!);
      });
    return {
      ...state,
      assetCount: new Set(state.clips.map((c) => c.assetId)).size,
      taskClips:
        state.operation === "trim"
          ? selectedClip
            ? [selectedClip]
            : []
          : state.combineClipIds.flatMap((id) => {
              const c = state.clips.find((c) => c.id === id);
              return c ? [c] : [];
            }),
      setOperation: (operation) =>
        mutate((d) => {
          if (operation === "combine" && new Set(d.request.clips.map((c) => c.assetId)).size < 2)
            return;
          d.operation = operation;
          if (operation === "combine" && !d.combineInitialized) {
            d.combineInitialized = true;
            if (new Set(d.request.clips.map((c) => c.assetId)).size === 2)
              d.combineClipIds = d.request.clips
                .filter(
                  (c, index, clips) =>
                    clips.findIndex((other) => other.assetId === c.assetId) === index,
                )
                .map((c) => c.id);
          }
        }),
      toggleCombine: (id) =>
        mutate((d) => {
          if (d.combineClipIds.includes(id)) d.combineOrderCustomized = true;
          d.combineClipIds = d.combineClipIds.includes(id)
            ? d.combineClipIds.filter((c) => c !== id)
            : [...d.combineClipIds, id];
          if (!d.combineOrderCustomized)
            d.combineClipIds.sort(
              (a, b) =>
                d.request.clips.findIndex((c) => c.id === a) -
                d.request.clips.findIndex((c) => c.id === b),
            );
        }),
      selectAllCombine: (all) =>
        mutate((d) => {
          if (!all) d.combineOrderCustomized = false;
          d.combineClipIds = all
            ? [
                ...d.combineClipIds,
                ...d.request.clips.filter((c) => !d.combineClipIds.includes(c.id)).map((c) => c.id),
              ]
            : [];
          if (!d.combineOrderCustomized)
            d.combineClipIds.sort(
              (a, b) =>
                d.request.clips.findIndex((c) => c.id === a) -
                d.request.clips.findIndex((c) => c.id === b),
            );
        }),
      moveCombine: (id, delta) =>
        mutate((d) => {
          const from = d.combineClipIds.indexOf(id),
            to = from + delta;
          if (from < 0 || to < 0 || to >= d.combineClipIds.length) return;
          d.combineOrderCustomized = true;
          d.combineClipIds.splice(from, 1);
          d.combineClipIds.splice(to, 0, id);
        }),
      selectedClip,
      watermark: selectedClip?.watermark ?? state.watermark,
      selectedAsset: state.assets.find((a) => a.id === selectedClip?.assetId) ?? null,
      importWithDialog: async () => {
        await runImport(() => window.videoQuickEditor.chooseAssets());
      },
      importLocalPaths: async (paths) =>
        await runImport(() => window.videoQuickEditor.importLocalPaths(paths)),
      importForAgent: async (paths) => {
        let imported: AssetView[] = [];
        const ok = await runImport(async () => {
          imported = await window.videoQuickEditor.importLocalPaths(paths);
          return imported;
        });
        if (!ok)
          throw new Error("Import failed; no Agent request sent / 导入失败，未发送 Agent 请求");
        await queue.current;
        const draft = await window.videoQuickEditor.getDraft();
        if (
          !imported.every((asset) => draft.request.clips.some((clip) => clip.assetId === asset.id))
        )
          throw new Error(
            "The timeline changed during import; review the editor before continuing / 导入期间时间线已变更，请检查后继续",
          );
        return imported;
      },
      importDropped: async (files) => {
        await runImport(() => window.videoQuickEditor.importDroppedFiles(files));
      },
      updateClip: (id, update) =>
        mutate((d) => {
          d.request.clips = d.request.clips.map((c) => (c.id === id ? { ...c, ...update } : c));
        }),
      selectClip: (id) =>
        mutate((d) => {
          d.selectedClipId = id;
        }),
      moveClip: (id, delta) => {
        const index = state.clips.findIndex((c) => c.id === id);
        const target = state.clips[index + delta];
        if (target) move(id, target.id);
      },
      reorderClip: move,
      duplicateClip: (id) =>
        mutate((d) => {
          const index = d.request.clips.findIndex((c) => c.id === id);
          if (index < 0) return;
          const clip = { ...d.request.clips[index]!, id: crypto.randomUUID() };
          d.request.clips.splice(index + 1, 0, clip);
          d.selectedClipId = clip.id;
          if (!d.request.modeWasManuallySelected) d.request.mode = "normalize";
        }),
      removeClip: (id) =>
        mutate((d) => {
          d.request.clips = d.request.clips.filter((c) => c.id !== id);
          if (!d.request.modeWasManuallySelected)
            d.request.mode = d.request.clips.length > 1 ? "normalize" : "accurate";
        }),
      setMode: (mode) =>
        mutate((d) => {
          d.request.mode = mode;
          d.request.modeWasManuallySelected = true;
        }),
      setOutputProfile: (profile) =>
        mutate((d) => {
          d.request.outputProfile = profile;
        }),
      setWatermark: (update) => {
        const clipId = state.selectedClipId;
        mutate((d) => {
          const clip = d.request.clips.find((item) => item.id === clipId);
          if (clip) clip.watermark = { ...(clip.watermark ?? d.request.watermark), ...update };
        });
      },
      setOutput: (output) =>
        mutate((d) => {
          d.request.output = output;
        }),
      setVideoCodec: (codec) =>
        mutate((d) => {
          d.request.videoCodec = codec;
        }),
      setNormalize: (update) =>
        mutate((d) => {
          d.request.normalize = { ...d.request.normalize, ...update };
        }),
      setSettings: (settings) => setState((s) => ({ ...s, settings })),
      setError: (error) => setState((s) => ({ ...s, error })),
      createRequest: async () => {
        await queue.current;
        const draft = await window.videoQuickEditor.getDraft();
        const ids = draft.operation === "trim" ? [draft.selectedClipId] : draft.combineClipIds;
        const clips = ids.flatMap((id) => {
          const c = draft.request.clips.find((c) => c.id === id);
          return c ? [c] : [];
        });
        return {
          ...draft.request,
          clips,
          taskKind: draft.operation,
          requestId: crypto.randomUUID(),
          mode: draft.request.modeWasManuallySelected
            ? draft.request.mode
            : clips.length === 1
              ? "accurate"
              : "normalize",
        };
      },
    };
  }, [state, mutate, runImport]);
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
