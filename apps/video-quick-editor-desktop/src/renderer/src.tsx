import { AppUpdateSettings } from "./app-updates.js";
import { TrimRange } from "./trim-range.js";
import { AgentChat } from "./agent.js";
import { ModelSettings } from "./model-profiles.js";
import { DependencyBanner } from "./dependency-banner.js";
import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Link,
  Outlet,
  RouterProvider,
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { I18nProvider } from "@videojs/react/i18n";
import { Video, VideoPlayer, VideoSkin } from "@videojs/react/video";
import { timestampOutputName } from "@video-quick-editor/shared";
import type { ClipSpec, ExportJob, ExportRequest, Language } from "@video-quick-editor/shared";
import { copyFor } from "./i18n.js";
import { formatProgress, isTerminalJob, jobKind, jobPhaseLabel, jobStateLabel } from "./jobs.js";
import { StoreProvider, useStore } from "./store.js";
import "@videojs/react/video/skin.css";
import "./styles.css";

const rootRoute = createRootRoute({ component: Shell });
const editorRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: EditorPage,
});
const exportsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/exports",
  component: ExportsPage,
});
const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: SettingsPage,
});
const routeTree = rootRoute.addChildren([editorRoute, exportsRoute, settingsRoute]);
const router = createRouter({ routeTree, history: createHashHistory() });

const panelClass = "min-w-0 border-r border-white/[0.06] p-6 max-[1200px]:p-[18px] last:border-r-0";
const panelTitleClass =
  "mb-[18px] flex items-center justify-between [&_h2]:mt-[5px] [&_h2]:mb-0 [&_h2]:max-w-[380px] [&_h2]:overflow-hidden [&_h2]:text-[17px] [&_h2]:text-ellipsis [&_h2]:whitespace-nowrap [&_h2_b]:ml-[5px] [&_h2_b]:rounded-full [&_h2_b]:bg-secondary [&_h2_b]:px-[7px] [&_h2_b]:py-[3px] [&_h2_b]:text-[11px] [&_h2_b]:text-primary";
const eyebrowClass = "text-[9px] font-extrabold tracking-[0.16em] text-primary";
const fieldLabelClass = "mb-[13px] block text-[10px] font-bold tracking-[0.04em] text-[#7f8c99]";
const fieldControlClass =
  "mt-[6px] block w-full resize-none rounded-lg border border-white/[0.07] bg-[#101720] p-[9px] text-[#e5eaee] outline-none focus:border-primary";
const primaryButtonClass =
  "rounded-[10px] border-0 bg-primary px-[18px] py-3 font-extrabold text-on-primary shadow-[0_8px_30px_var(--color-secondary)] transition-colors enabled:hover:bg-primary-hover disabled:opacity-45 disabled:grayscale [&_b]:pl-[18px]";
const secondaryButtonClass =
  "rounded-lg border border-primary-border bg-secondary px-[11px] py-2 text-[10px] text-primary enabled:hover:bg-primary/25 disabled:cursor-default disabled:opacity-40";
const dangerButtonClass =
  "rounded-lg border border-[#6f3138] bg-[#32171a] px-[11px] py-2 text-[#ff9ca5] disabled:cursor-default disabled:opacity-40";
const warningClass =
  "mt-[10px] rounded-[9px] border border-[#6a5024] bg-[#35270f] px-[11px] py-[9px] text-[11px] text-[#d9bc79] [&_button]:border-0 [&_button]:bg-transparent [&_button]:text-primary [&_button]:underline";
const progressClass =
  "h-1 overflow-hidden rounded-full bg-secondary [&_i]:block [&_i]:h-full [&_i]:bg-primary";
const surfaceCardClass = "rounded-2xl border border-white/[0.06] bg-panel p-7 text-[#81909c]";

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

function Shell(): React.JSX.Element {
  const { jobs, settings } = useStore();
  const language = settings?.language ?? "en";
  const copy = copyFor(language);
  const activeJob = jobs.find((job) => !isTerminalJob(job));
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);
  return (
    <div className="min-h-screen min-w-[760px] bg-[radial-gradient(circle_at_50%_-20%,#19374b_0,transparent_38%),#090c11] font-sans text-[#e9eef5]">
      <header className="sticky top-0 z-20 flex h-[72px] items-center border-b border-white/[0.07] bg-[#0c1118dd] px-7 backdrop-blur-[18px]">
        <Link
          to="/"
          className="flex items-center gap-3 font-bold tracking-[-0.02em] text-white no-underline"
        >
          <span className="grid h-9 w-9 place-items-center rounded-[10px] bg-primary text-on-primary shadow-[0_0_24px_var(--color-secondary)]">
            ▶
          </span>
          <span>
            Video Quick Editor
            <small className="mt-0.5 block text-[10px] tracking-[0.08em] text-[#788797] uppercase">
              {copy.brandSubtitle}
            </small>
          </span>
        </Link>
        <nav className="m-auto flex gap-2">
          <Link
            to="/"
            className="relative rounded-[10px] px-4 py-[9px] text-sm text-[#8793a1] no-underline"
            activeProps={{ className: "bg-secondary text-primary" }}
          >
            {copy.edit}
          </Link>
          <Link
            to="/exports"
            className="relative rounded-[10px] px-4 py-[9px] text-sm text-[#8793a1] no-underline"
            activeProps={{ className: "bg-secondary text-primary" }}
          >
            {copy.exports}
            {activeJob && (
              <span className="ml-2 font-mono text-[9px] font-bold text-primary">
                {jobKind(activeJob, language)} {formatProgress(activeJob.progress)}
              </span>
            )}
          </Link>
          <Link
            to="/settings"
            className="relative rounded-[10px] px-4 py-[9px] text-sm text-[#8793a1] no-underline"
            activeProps={{ className: "bg-secondary text-primary" }}
          >
            {copy.settings}
          </Link>
        </nav>
        <span className="rounded-full border border-primary-border bg-secondary px-[10px] py-[7px] text-[11px] text-primary">
          {copy.localOnly}
        </span>
        <AgentChat />
      </header>
      <main className="editor-main min-h-[calc(100vh-72px)]">
        <DependencyBanner />
        <Outlet />
      </main>
    </div>
  );
}

function EditorPage(): React.JSX.Element {
  const store = useStore();
  const language = store.settings?.language ?? "en";
  const copy = copyFor(language);
  const [dragId, setDragId] = useState<string | null>(null);
  const [playerError, setPlayerError] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [realFrame, setRealFrame] = useState<string | null>(null);
  const [action, setAction] = useState<"proxy" | "frame" | "validating" | null>(null);
  const player = useRef<HTMLVideoElement>(null);
  const selected = store.selectedClip;
  const asset = store.selectedAsset;
  const isCombine = store.clips.length > 1;
  const activeJob = store.jobs.find((job) => !isTerminalJob(job));
  const totalUs = store.clips.reduce((total, clip) => total + clip.endUs - clip.startUs, 0);

  useEffect(() => {
    setPlayerError(false);
    setPreviewUrl(null);
    setRealFrame(null);
  }, [asset?.id]);

  useEffect(() => setRealFrame(null), [selected?.id, store.watermark]);

  function resetPreviewRange(video: HTMLVideoElement): void {
    if (!selected) return;
    const start = selected.startUs / 1_000_000;
    const end = selected.endUs / 1_000_000;
    if (video.currentTime < start || video.currentTime >= end) video.currentTime = start;
  }

  function enforcePreviewRange(video: HTMLVideoElement): void {
    if (!selected || video.paused) return;
    const start = selected.startUs / 1_000_000;
    const end = selected.endUs / 1_000_000;
    if (video.currentTime >= end) {
      video.pause();
      video.currentTime = end;
    } else if (video.currentTime < start) {
      video.currentTime = start;
    }
  }

  useEffect(() => {
    const video = player.current;
    if (!video || !selected || video.readyState < 1) return;
    const start = selected.startUs / 1_000_000;
    const end = selected.endUs / 1_000_000;
    if (video.currentTime < start || video.currentTime >= end) video.currentTime = start;
  }, [selected?.id, selected?.startUs, selected?.endUs]);

  async function proxy(): Promise<void> {
    if (!asset) return;
    setAction("proxy");
    try {
      setPreviewUrl(await window.videoQuickEditor.createProxy(asset.id));
      setPlayerError(false);
    } catch (error) {
      store.setError(message(error));
    }
    setAction(null);
  }

  async function frame(): Promise<void> {
    if (!asset || !selected) return;
    setAction("frame");
    try {
      setRealFrame(
        await window.videoQuickEditor.previewFrame({
          assetId: asset.id,
          atUs: Math.max(
            selected.startUs,
            Math.round((player.current?.currentTime ?? 0) * 1_000_000),
          ),
          watermark: store.watermark,
        }),
      );
    } catch (error) {
      store.setError(message(error));
    }
    setAction(null);
  }

  async function exportVideo(): Promise<void> {
    store.setError(null);
    setAction("validating");
    try {
      await window.videoQuickEditor.planExport(store.createRequest());
      await window.videoQuickEditor.startExport(store.createRequest());
      await router.navigate({ to: "/exports" });
    } catch (error) {
      store.setError(message(error));
    }
    setAction(null);
  }

  return (
    <div className="grid min-h-[calc(100vh-72px)] grid-cols-[340px_minmax(440px,1fr)_340px] pb-[86px] max-[1200px]:grid-cols-[300px_minmax(400px,1fr)_300px]">
      {store.error && (
        <div className="fixed top-[82px] left-1/2 z-50 flex max-w-[720px] -translate-x-1/2 gap-5 rounded-[10px] border border-[#803139] bg-[#491e22] px-4 py-3 text-[#ffd6d9] shadow-[0_15px_50px_#000] [&_button]:border-0 [&_button]:bg-transparent [&_button]:text-lg [&_button]:text-inherit">
          <span>{store.error}</span>
          <button onClick={() => store.setError(null)}>×</button>
        </div>
      )}
      <section className={panelClass}>
        <div className={panelTitleClass}>
          <div>
            <span className={eyebrowClass}>
              01 · {isCombine ? copy.combineOrder : copy.trimMedia}
            </span>
            <h2>
              {isCombine ? copy.combineTimeline : copy.clipToTrim} <b>{store.clips.length}</b>
            </h2>
          </div>
          <button
            className="h-[34px] w-[34px] rounded-[9px] border border-white/[0.09] bg-white/[0.03] text-[19px] text-white"
            disabled={store.dependencies.status !== "ready"}
            onClick={() => void store.importWithDialog()}
          >
            ＋
          </button>
        </div>
        <div className="mb-3 grid grid-cols-2 gap-2">
          <div
            className={`flex min-w-0 flex-col gap-[3px] rounded-[10px] border p-[10px] ${
              !isCombine
                ? "border-primary-border bg-secondary text-primary"
                : "border-white/[0.05] bg-[#0d131a] text-[#65727e]"
            }`}
          >
            <b className="text-[11px]">✂ {copy.trim}</b>
            <small className="text-[8px] leading-[1.4] text-[#6f7e89]">
              {copy.trimDescription}
            </small>
          </div>
          <div
            className={`flex min-w-0 flex-col gap-[3px] rounded-[10px] border p-[10px] ${
              isCombine
                ? "border-primary-border bg-secondary text-primary"
                : "border-white/[0.05] bg-[#0d131a] text-[#65727e]"
            }`}
          >
            <b className="text-[11px]">⧉ {copy.combine}</b>
            <small className="text-[8px] leading-[1.4] text-[#6f7e89]">
              {copy.combineDescription}
            </small>
          </div>
        </div>
        <button
          className="flex h-[105px] w-full flex-col items-center justify-center gap-[5px] rounded-[13px] border border-dashed border-primary-border bg-secondary text-[#ccd8dd] [&>small]:text-[10px] [&>small]:text-[#71808c] [&>span]:text-xl [&>span]:text-primary [&>strong]:text-[13px]"
          disabled={store.dependencies.status !== "ready"}
          onClick={() => void store.importWithDialog()}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            if (store.dependencies.status === "ready")
              void store.importDropped([...event.dataTransfer.files]);
          }}
        >
          <span>＋</span>
          <strong>
            {store.clips.length === 0
              ? copy.addLocalVideo
              : isCombine
                ? copy.continueCombination
                : copy.startCombination}
          </strong>
          <small>{copy.supportedFormats}</small>
        </button>
        {store.busy && (
          <div className="mt-3 rounded-[9px] bg-white/[0.03] p-3 text-xs text-[#9ba8b3]">
            {copy.probingMedia}
          </div>
        )}
        {isCombine && (
          <p className="mx-0.5 mt-3 -mb-[7px] text-[9px] text-primary">{copy.sequenceNote}</p>
        )}
        <div className="mt-4 flex max-h-[calc(100vh-282px)] flex-col gap-[9px] overflow-auto pr-1">
          {store.clips.map((clip, index) => {
            const clipAsset = store.assets.find((item) => item.id === clip.assetId)!;
            return (
              <article
                key={clip.id}
                draggable
                onDragStart={() => setDragId(clip.id)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => {
                  if (dragId) store.reorderClip(dragId, clip.id);
                  setDragId(null);
                }}
                className={`group relative grid grid-cols-[22px_70px_minmax(0,1fr)] items-center gap-[10px] rounded-xl border p-[9px] ${
                  clip.id === store.selectedClipId
                    ? "border-primary bg-secondary shadow-[0_0_0_1px_var(--color-secondary)]"
                    : "border-white/[0.05] bg-[#10161e]"
                } ${
                  isCombine && index < store.clips.length - 1
                    ? "after:absolute after:bottom-[-15px] after:left-[18px] after:z-[2] after:font-mono after:text-[10px] after:font-bold after:text-primary after:content-['↓']"
                    : ""
                }`}
                onClick={() => store.selectClip(clip.id)}
              >
                <div className="font-mono text-[10px] font-semibold text-[#63717f] [writing-mode:vertical-rl]">
                  {String(index + 1).padStart(2, "0")}
                </div>
                <video
                  className="h-12 w-[70px] rounded-[7px] bg-[#05070a] object-cover"
                  src={clipAsset.previewUrl}
                  muted
                  preload="metadata"
                />
                <div className="flex min-w-0 flex-col gap-1">
                  <strong
                    className="overflow-hidden text-xs text-ellipsis whitespace-nowrap"
                    title={clipAsset.fileName}
                  >
                    {clipAsset.fileName}
                  </strong>
                  <span className="font-mono text-[9px] text-[#8c9aa8]">
                    {formatUs(clip.startUs)} → {formatUs(clip.endUs)}
                  </span>
                  <small className="font-mono text-[9px] text-primary">
                    {formatUs(clip.endUs - clip.startUs)} {copy.selected}
                  </small>
                </div>
                <div className="absolute top-[3px] right-1 hidden rounded-[7px] bg-[#10161eee] group-hover:flex [&_button]:border-0 [&_button]:bg-transparent [&_button]:p-1 [&_button]:text-[#b6c0c8]">
                  <button
                    title={copy.moveUp}
                    onClick={(event) => {
                      event.stopPropagation();
                      store.moveClip(clip.id, -1);
                    }}
                  >
                    ↑
                  </button>
                  <button
                    title={copy.moveDown}
                    onClick={(event) => {
                      event.stopPropagation();
                      store.moveClip(clip.id, 1);
                    }}
                  >
                    ↓
                  </button>
                  <button
                    title={copy.duplicate}
                    onClick={(event) => {
                      event.stopPropagation();
                      store.duplicateClip(clip.id);
                    }}
                  >
                    ⧉
                  </button>
                  <button
                    title={copy.delete}
                    onClick={(event) => {
                      event.stopPropagation();
                      store.removeClip(clip.id);
                    }}
                  >
                    ×
                  </button>
                </div>
              </article>
            );
          })}
        </div>
        {store.clips.length > 0 && (
          <button
            className="mt-[10px] w-full rounded-[9px] border border-dashed border-primary-border bg-secondary p-[9px] text-[10px] text-primary"
            disabled={store.dependencies.status !== "ready"}
            onClick={() => void store.importWithDialog()}
          >
            {copy.addNextClip}
          </button>
        )}
      </section>

      <section className="min-w-0 border-r border-white/[0.06] px-[30px] py-6 max-[1200px]:px-[22px] max-[1200px]:py-[18px]">
        <div className={panelTitleClass}>
          <div>
            <span className={eyebrowClass}>02 · {copy.precisionStep}</span>
            <h2>{asset?.fileName ?? copy.previewCanvas}</h2>
          </div>
          {asset && (
            <span className="rounded-full bg-[#151d26] px-[9px] py-1.5 font-mono text-[9px] text-[#9ca9b4]">
              {asset.video.codec.toUpperCase()} · {asset.video.displayWidth}×
              {asset.video.displayHeight}
            </span>
          )}
        </div>
        <div className="relative aspect-video w-full overflow-hidden rounded-2xl border border-white/[0.06] bg-[#030507] shadow-[0_20px_60px_#0008] [&_video]:h-full [&_video]:w-full [&_video]:object-contain">
          {asset ? (
            <>
              <VideoPlayer>
                <I18nProvider locale={language}>
                  <VideoSkin className="h-full w-full">
                    <Video
                      key={previewUrl ?? asset.previewUrl}
                      ref={player}
                      className="h-full w-full object-contain"
                      src={previewUrl ?? asset.previewUrl}
                      playsInline
                      preload="metadata"
                      onLoadedMetadata={(event) => resetPreviewRange(event.currentTarget)}
                      onPlay={(event) => resetPreviewRange(event.currentTarget)}
                      onTimeUpdate={(event) => enforcePreviewRange(event.currentTarget)}
                      onSeeking={(event) => enforcePreviewRange(event.currentTarget)}
                      onError={() => setPlayerError(true)}
                    />
                  </VideoSkin>
                </I18nProvider>
              </VideoPlayer>
              {store.watermark.enabled && !realFrame && (
                <div
                  className={`pointer-events-none absolute max-w-[80%] overflow-hidden leading-none text-white whitespace-nowrap [paint-order:stroke_fill] ${
                    {
                      "top-left": "top-0 left-0",
                      "top-right": "top-0 right-0",
                      "bottom-left": "bottom-0 left-0",
                      "bottom-right": "right-0 bottom-0",
                    }[store.watermark.position]
                  }`}
                  style={{
                    fontSize: `${Math.max(10, store.watermark.fontSize / 2)}px`,
                    WebkitTextStroke: `${(2 * store.watermark.borderWidth * Math.max(10, store.watermark.fontSize / 2)) / store.watermark.fontSize}px black`,
                    margin: `${Math.max(6, store.watermark.margin / 2)}px`,
                  }}
                >
                  {store.watermark.text || copy.watermarkPreview}
                </div>
              )}
              {realFrame && (
                <div
                  className="absolute inset-0 z-[5] grid place-items-center bg-[#000d]"
                  onClick={() => setRealFrame(null)}
                >
                  <img
                    className="max-h-[90%] max-w-[96%]"
                    src={realFrame}
                    alt={copy.exportedFrameAlt}
                  />
                  <span className="absolute bottom-2 text-[10px] text-[#9da9b2]">
                    {copy.exportedFrameClose}
                  </span>
                </div>
              )}
            </>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-[#596674]">
              <span className="text-[30px] text-[#233440]">▶</span>
              <strong className="text-sm text-[#8a96a1]">{copy.addVideoToStart}</strong>
              <small className="text-[11px]">{copy.mediaStaysLocal}</small>
            </div>
          )}
        </div>
        {playerError && (
          <div className={warningClass}>
            {copy.playerUnsupported}
            <button disabled={store.dependencies.status !== "ready"} onClick={() => void proxy()}>
              {copy.generateProxy}
            </button>
          </div>
        )}
        {selected && asset && (
          <ClipEditor
            clip={selected}
            durationUs={asset.durationUs}
            currentUs={() => Math.round((player.current?.currentTime ?? 0) * 1_000_000)}
            seek={(us) => {
              if (player.current) player.current.currentTime = us / 1_000_000;
            }}
            language={language}
          />
        )}
        <div className="mt-[18px] flex items-center justify-between border-t border-white/[0.05] pt-[15px] text-[10px] text-[#64717d]">
          <span>{copy.overlayNote}</span>
          <button
            className={secondaryButtonClass}
            disabled={!asset || action !== null || store.dependencies.status !== "ready"}
            onClick={() => void frame()}
          >
            {copy.previewExport}
          </button>
        </div>
        {asset?.warnings.map((warning) => (
          <div className={warningClass} key={warning}>
            {warning}
          </div>
        ))}
      </section>

      <section
        className={`${panelClass} border-r-0 bg-[#0b0f15] [&_fieldset]:m-0 [&_fieldset]:border-0 [&_fieldset]:p-0 [&_fieldset:disabled]:opacity-40 [&_hr]:my-[18px] [&_hr]:border-0 [&_hr]:border-t [&_hr]:border-white/[0.05] [&_label]:mb-[13px] [&_label]:block [&_label]:text-[10px] [&_label]:font-bold [&_label]:tracking-[0.04em] [&_label]:text-[#7f8c99] [&_input:not([type='checkbox'])]:mt-1.5 [&_input:not([type='checkbox'])]:block [&_input:not([type='checkbox'])]:w-full [&_input:not([type='checkbox'])]:rounded-lg [&_input:not([type='checkbox'])]:border [&_input:not([type='checkbox'])]:border-white/[0.07] [&_input:not([type='checkbox'])]:bg-[#101720] [&_input:not([type='checkbox'])]:p-[9px] [&_input:not([type='checkbox'])]:text-[#e5eaee] [&_select]:mt-1.5 [&_select]:block [&_select]:w-full [&_select]:rounded-lg [&_select]:border [&_select]:border-white/[0.07] [&_select]:bg-[#101720] [&_select]:p-[9px] [&_select]:text-[#e5eaee] [&_textarea]:mt-1.5 [&_textarea]:block [&_textarea]:w-full [&_textarea]:resize-none [&_textarea]:rounded-lg [&_textarea]:border [&_textarea]:border-white/[0.07] [&_textarea]:bg-[#101720] [&_textarea]:p-[9px] [&_textarea]:text-[#e5eaee]`}
      >
        <div className={panelTitleClass}>
          <div>
            <span className={eyebrowClass}>03 · {copy.outputStyle}</span>
            <h2>{isCombine ? copy.outputHeadingCombine : copy.outputHeadingTrim}</h2>
          </div>
        </div>
        <label className="!mb-[15px] !flex items-center justify-between">
          <span className="flex flex-col gap-[3px]">
            <strong className="text-xs text-[#dce5ea]">{copy.textWatermark}</strong>
            <small className="text-[9px] font-normal text-[#697783]">
              {copy.watermarkDescription}
            </small>
          </span>
          <input
            className="relative h-5 w-9 appearance-none rounded-full bg-[#28313b] checked:bg-primary after:absolute after:top-[3px] after:left-[3px] after:h-3.5 after:w-3.5 after:rounded-full after:bg-white after:transition-all after:content-[''] checked:after:left-[19px]"
            type="checkbox"
            checked={store.watermark.enabled}
            onChange={(event) => store.setWatermark({ enabled: event.target.checked })}
          />
        </label>
        <fieldset disabled={!store.watermark.enabled}>
          <label className={fieldLabelClass}>
            {copy.text}
            <textarea
              className={fieldControlClass}
              rows={3}
              placeholder={copy.textPlaceholder}
              value={store.watermark.text}
              onChange={(event) => store.setWatermark({ text: event.target.value })}
            />
          </label>
          <div className="grid grid-cols-2 gap-[10px]">
            <label>
              {copy.position}
              <select
                value={store.watermark.position}
                onChange={(event) =>
                  store.setWatermark({
                    position: event.target.value as typeof store.watermark.position,
                  })
                }
              >
                <option value="top-left">{copy.topLeft}</option>
                <option value="top-right">{copy.topRight}</option>
                <option value="bottom-left">{copy.bottomLeft}</option>
                <option value="bottom-right">{copy.bottomRight}</option>
              </select>
            </label>
            <label>
              {copy.fontSize}
              <input
                type="number"
                min="8"
                max="512"
                value={store.watermark.fontSize}
                onChange={(event) => store.setWatermark({ fontSize: Number(event.target.value) })}
              />
            </label>
          </div>
          <label>
            {copy.borderWidth}
            <input
              type="number"
              min="0"
              max="20"
              step="1"
              value={store.watermark.borderWidth}
              onChange={(event) => store.setWatermark({ borderWidth: Number(event.target.value) })}
            />
          </label>
          <div className="grid grid-cols-2 gap-[10px]">
            <label>
              {copy.margin}
              <input
                type="number"
                min="0"
                value={store.watermark.margin}
                onChange={(event) => store.setWatermark({ margin: Number(event.target.value) })}
              />
            </label>
            <label>
              {copy.font}
              <button
                className="mt-1.5 w-full rounded-lg border border-white/[0.07] bg-[#101720] p-[9px] text-left text-[11px] text-[#bdc7cf]"
                onClick={() =>
                  void window.videoQuickEditor
                    .chooseFont()
                    .then(async (font) => {
                      if (font) {
                        store.setWatermark({ fontId: font.id });
                        store.setSettings(await window.videoQuickEditor.getSettings());
                      }
                    })
                    .catch((error: unknown) => store.setError(message(error)))
                }
              >
                {store.watermark.fontId
                  ? `${store.watermark.fontId === store.settings?.defaultFontId ? (store.settings.defaultFontName ?? copy.fontSelected) : copy.fontSelected} · ${copy.changeFont}`
                  : copy.chooseFont}
              </button>
            </label>
          </div>
        </fieldset>
        <hr />
        <label>
          {copy.exportMode}
          <select
            value={store.mode}
            onChange={(event) => store.setMode(event.target.value as ExportRequest["mode"])}
          >
            <option value="accurate" disabled={isCombine}>
              {copy.accurateMode}
            </option>
            <option value="normalize">{copy.normalizeMode}</option>
            <option value="copy">{copy.copyMode}</option>
          </select>
        </label>
        <p className="-mt-[7px] mb-[14px] text-[10px] leading-[1.5] text-[#6e7c87]">
          {store.mode === "copy"
            ? copy.copyHelp
            : store.mode === "normalize"
              ? copy.normalizeHelp
              : copy.accurateHelp}
        </p>
        {store.mode === "normalize" && (
          <div className="grid grid-cols-3 gap-[10px]">
            <label>
              {copy.width}
              <input
                placeholder={copy.firstClip}
                type="number"
                value={store.normalize.width ?? ""}
                onChange={(e) =>
                  store.setNormalize({ width: e.target.value ? Number(e.target.value) : null })
                }
              />
            </label>
            <label>
              {copy.height}
              <input
                placeholder={copy.firstClip}
                type="number"
                value={store.normalize.height ?? ""}
                onChange={(e) =>
                  store.setNormalize({ height: e.target.value ? Number(e.target.value) : null })
                }
              />
            </label>
            <label>
              FPS
              <input
                placeholder={copy.automatic}
                value={store.normalize.fps ?? ""}
                onChange={(e) => store.setNormalize({ fps: e.target.value || null })}
              />
            </label>
          </div>
        )}
        {store.mode !== "copy" && (
          <label>
            <span>{language === "zh-CN" ? "输出格式" : "Output profile"}</span>
            <select
              aria-label="Output profile"
              value={store.outputProfile}
              onChange={(e) =>
                store.setOutputProfile(e.target.value as "source" | "mp4-compatible")
              }
            >
              <option value="mp4-compatible">MP4 · H.264</option>
              <option value="source">Source</option>
            </select>
            {copy.videoCodec}
            <select
              value={store.videoCodec ?? ""}
              onChange={(e) =>
                store.setVideoCodec((e.target.value || null) as ExportRequest["videoCodec"])
              }
            >
              <option value="">{copy.inheritCodec}</option>
              <option value="h264">H.264 / libx264</option>
              <option value="hevc">HEVC / libx265</option>
            </select>
          </label>
        )}
        <label>
          {copy.outputLocation}
          <button
            className="mt-1.5 flex w-full justify-between gap-[7px] rounded-lg border border-white/[0.07] bg-[#101720] p-[9px] text-left text-[11px] text-[#bdc7cf] disabled:cursor-default disabled:opacity-40 [&_b]:text-primary [&_span]:overflow-hidden [&_span]:text-ellipsis [&_span]:whitespace-nowrap"
            disabled={!asset}
            onClick={() =>
              asset &&
              void window.videoQuickEditor
                .chooseOutput(timestampOutputName(asset.fileName, store.outputProfile))
                .then((output) => store.setOutput(output))
            }
          >
            <span>{store.output?.displayPath ?? copy.downloadsLocation}</span>
            <b>{copy.choose}</b>
          </button>
        </label>
      </section>

      <footer className="fixed right-0 bottom-0 left-0 z-10 flex h-[76px] items-center gap-[30px] border-t border-white/[0.07] bg-[#0b1016eb] px-7 backdrop-blur-[18px]">
        <div className="flex flex-col">
          <strong className="text-[17px]">{store.clips.length}</strong>
          <span className="text-[9px] text-[#71808c]">{copy.clips}</span>
        </div>
        <div className="flex flex-col">
          <strong className="text-[17px]">{formatUs(totalUs)}</strong>
          <span className="text-[9px] text-[#71808c]">{copy.totalSelectedDuration}</span>
        </div>
        {activeJob ? (
          <>
            <div className="flex flex-1 flex-col gap-[7px]">
              <span className="text-[9px] text-[#71808c]">
                {jobStateLabel(activeJob, language)} · {jobPhaseLabel(activeJob.phase, language)}
              </span>
              <div className={progressClass}>
                <i style={{ width: `${(activeJob.progress ?? 0) * 100}%` }} />
              </div>
            </div>
            <strong className="min-w-14 text-right font-mono text-[15px] font-bold text-primary">
              {formatProgress(activeJob.progress)}
            </strong>
            <button
              className={`${secondaryButtonClass} border-[#6f3138] bg-[#32171a] text-[#ff9ca5]`}
              disabled={activeJob.state === "cancelling"}
              onClick={() =>
                void window.videoQuickEditor
                  .cancelExport(activeJob.id)
                  .catch((error: unknown) => store.setError(message(error)))
              }
            >
              {copy.cancel}
            </button>
            <button
              className={primaryButtonClass}
              onClick={() => void router.navigate({ to: "/exports" })}
            >
              {copy.viewProgress} <b>→</b>
            </button>
          </>
        ) : (
          <>
            <div className="flex flex-1 flex-col">
              <span className="text-[9px] text-[#71808c]">
                {action
                  ? {
                      proxy: copy.generatingProxy,
                      frame: copy.renderingFrame,
                      validating: copy.validatingExport,
                    }[action]
                  : (store.output?.displayPath ?? copy.defaultDownloads)}
              </span>
            </div>
            <button
              className={primaryButtonClass}
              disabled={
                !store.clips.length || action !== null || store.dependencies.status !== "ready"
              }
              onClick={() => void exportVideo()}
            >
              {isCombine ? copy.startCombine : copy.startTrim} <b>→</b>
            </button>
          </>
        )}
      </footer>
    </div>
  );
}

function ClipEditor({
  clip: sourceClip,
  durationUs,
  currentUs,
  seek,
  language,
}: {
  clip: ClipSpec;
  durationUs: number;
  currentUs: () => number;
  seek: (us: number) => void;
  language: Language;
}): React.JSX.Element {
  const store = useStore();
  const copy = copyFor(language);
  const [pending, setPending] = useState<Pick<ClipSpec, "id" | "startUs" | "endUs"> | null>(null);
  useEffect(() => setPending(null), [sourceClip.id, sourceClip.startUs, sourceClip.endUs]);
  const clip = pending?.id === sourceClip.id ? { ...sourceClip, ...pending } : sourceClip;
  return (
    <div className="mt-[22px] grid grid-cols-[minmax(100px,1fr)_auto_minmax(100px,1fr)] items-end gap-[14px]">
      <div className="col-span-3">
        <TrimRange
          key={clip.id}
          value={clip}
          durationUs={durationUs}
          language={language}
          onPreview={(range, edge) => {
            setPending({ id: clip.id, ...range });
            seek(edge === "start" ? range.startUs : Math.max(range.startUs, range.endUs - 1));
          }}
          onCommit={(range) => store.updateClip(clip.id, range)}
          onCancel={() => setPending(null)}
        />
      </div>
      <div>
        <label className="block text-[10px] font-bold tracking-[0.04em] text-[#7f8c99]">
          {copy.startPoint}
        </label>
        <input
          className="my-1.5 w-full rounded-lg border border-white/[0.08] bg-[#0c1219] p-2 font-mono text-[10px] text-white outline-none focus:border-primary"
          aria-label={copy.startPoint}
          key={`s-${clip.id}-${clip.startUs}`}
          defaultValue={formatUs(clip.startUs)}
          onBlur={(e) =>
            commitTime(
              e.currentTarget,
              clip.startUs,
              (value) => store.updateClip(clip.id, { startUs: value }),
              0,
              clip.endUs - 1,
            )
          }
        />
        <button
          className="border-0 bg-transparent p-0 text-[9px] text-primary"
          onClick={() =>
            store.updateClip(clip.id, { startUs: clamp(currentUs(), 0, clip.endUs - 1) })
          }
        >
          {copy.setStartPoint}
        </button>
      </div>
      <div className="pb-5 text-center text-[10px] text-[#82968d]">
        <span className="block">{copy.selected}</span>
        <strong className="font-mono text-primary">{formatUs(clip.endUs - clip.startUs)}</strong>
      </div>
      <div>
        <label className="block text-[10px] font-bold tracking-[0.04em] text-[#7f8c99]">
          {copy.endPoint}
        </label>
        <input
          className="my-1.5 w-full rounded-lg border border-white/[0.08] bg-[#0c1219] p-2 font-mono text-[10px] text-white outline-none focus:border-primary"
          aria-label={copy.endPoint}
          key={`e-${clip.id}-${clip.endUs}`}
          defaultValue={formatUs(clip.endUs)}
          onBlur={(e) =>
            commitTime(
              e.currentTarget,
              clip.endUs,
              (value) => store.updateClip(clip.id, { endUs: value }),
              clip.startUs + 1,
              durationUs,
            )
          }
        />
        <button
          className="border-0 bg-transparent p-0 text-[9px] text-primary"
          onClick={() =>
            store.updateClip(clip.id, { endUs: clamp(currentUs(), clip.startUs + 1, durationUs) })
          }
        >
          {copy.setEndPoint}
        </button>
      </div>
    </div>
  );
}

function ExportsPage(): React.JSX.Element {
  const { jobs, settings, setError } = useStore();
  const language = settings?.language ?? "en";
  const copy = copyFor(language);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const deletableJobs = jobs.filter(isTerminalJob);
  const allSelected =
    deletableJobs.length > 0 && deletableJobs.every((job) => selectedIds.includes(job.id));

  useEffect(() => {
    setSelectedIds((current) =>
      current.filter((id) => jobs.some((job) => job.id === id && isTerminalJob(job))),
    );
  }, [jobs]);

  async function deleteSelected(): Promise<void> {
    if (selectedIds.length === 0) return;
    try {
      await window.videoQuickEditor.deleteJobs(selectedIds);
      setSelectedIds([]);
    } catch (error) {
      setError(message(error));
    }
  }

  function toggleJob(job: ExportJob): void {
    setSelectedIds((current) =>
      current.includes(job.id) ? current.filter((id) => id !== job.id) : [...current, job.id],
    );
  }

  return (
    <div className="mx-auto max-w-[1100px] px-8 py-[58px]">
      <div>
        <span className={eyebrowClass}>{copy.currentSession}</span>
        <h1 className="my-2 text-4xl tracking-[-0.04em]">{copy.exportQueue}</h1>
        <p className="mt-0 mb-[35px] text-[#778592]">{copy.exportQueueDescription}</p>
      </div>
      {jobs.length === 0 ? (
        <div className={surfaceCardClass}>{copy.noJobs}</div>
      ) : (
        <>
          <div className="mb-[14px] grid grid-cols-[auto_1fr_auto] items-center gap-[18px] rounded-xl border border-white/[0.06] bg-[#0d131a] px-[14px] py-3">
            <label className="flex items-center gap-2 text-[11px] text-[#cbd5dc]">
              <input
                className="accent-primary"
                type="checkbox"
                checked={allSelected}
                disabled={deletableJobs.length === 0}
                onChange={() =>
                  setSelectedIds(allSelected ? [] : deletableJobs.map((job) => job.id))
                }
              />
              {copy.selectFinished}
            </label>
            <span className="text-[9px] text-[#687681]">{copy.deleteJobsNote}</span>
            <button
              className={dangerButtonClass}
              disabled={selectedIds.length === 0}
              onClick={() => void deleteSelected()}
            >
              {copy.batchDelete} {selectedIds.length > 0 ? `(${selectedIds.length})` : ""}
            </button>
          </div>
          <div className="flex flex-col gap-3">
            {jobs.map((job) => (
              <article
                className="grid grid-cols-[22px_105px_1fr_auto] gap-4 rounded-[14px] border border-white/[0.06] bg-panel p-5"
                key={job.id}
              >
                <div>
                  {isTerminalJob(job) && (
                    <input
                      className="accent-primary"
                      aria-label={`${copy.edit} ${jobKind(job, language)} ${copy.job}`}
                      type="checkbox"
                      checked={selectedIds.includes(job.id)}
                      onChange={() => toggleJob(job)}
                    />
                  )}
                </div>
                <div
                  className={`font-mono text-[10px] uppercase ${
                    job.state === "completed"
                      ? "text-primary"
                      : job.state === "failed"
                        ? "text-[#ff7b86]"
                        : "text-[#e0b360]"
                  }`}
                >
                  {jobStateLabel(job, language)}
                </div>
                <div className="flex flex-col gap-[7px]">
                  <strong>
                    {jobKind(job, language)} · {job.request.clips.length} {copy.clips}
                  </strong>
                  <span className="text-[11px] text-[#7b8994]">
                    {jobPhaseLabel(job.phase, language)}
                  </span>
                  {job.error && <p className="text-[11px] text-[#ff9da5]">{job.error}</p>}
                  <div className={progressClass}>
                    <i style={{ width: `${(job.progress ?? 0) * 100}%` }} />
                  </div>
                  <small className="font-mono text-sm font-bold text-primary">
                    {formatProgress(job.progress)}
                  </small>
                  {job.resultPath && (
                    <code className="mt-[5px] text-[10px] text-[#aeb9c1]">{job.resultPath}</code>
                  )}
                </div>
                <div className="flex items-start gap-[7px] [&_button]:rounded-lg [&_button]:border [&_button]:border-white/[0.08] [&_button]:bg-[#151d26] [&_button]:px-[11px] [&_button]:py-2 [&_button]:text-[#d3dbe1] [&_button:disabled]:cursor-default [&_button:disabled]:opacity-40">
                  {!["completed", "failed", "cancelled"].includes(job.state) && (
                    <button
                      disabled={job.state === "cancelling"}
                      onClick={() =>
                        void window.videoQuickEditor
                          .cancelExport(job.id)
                          .catch((error: unknown) => setError(message(error)))
                      }
                    >
                      {copy.cancel}
                    </button>
                  )}
                  {job.state === "completed" && (
                    <>
                      <button onClick={() => void window.videoQuickEditor.openOutput(job.id)}>
                        {copy.openVideo}
                      </button>
                      <button onClick={() => void window.videoQuickEditor.revealOutput(job.id)}>
                        {copy.revealInFinder}
                      </button>
                    </>
                  )}
                </div>
              </article>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function SettingsPage(): React.JSX.Element {
  const { settings, dependencies, setSettings, setError } = useStore();
  const language = settings?.language ?? "en";
  const copy = copyFor(language);
  const [draft, setDraft] = useState({ ffmpegPath: "", ffprobePath: "" });
  useEffect(() => {
    if (settings) setDraft({ ffmpegPath: settings.ffmpegPath, ffprobePath: settings.ffprobePath });
  }, [settings?.ffmpegPath, settings?.ffprobePath]);
  async function pick(kind: "ffmpeg" | "ffprobe"): Promise<void> {
    const path = await window.videoQuickEditor.chooseTool(kind);
    if (path) setDraft((current) => ({ ...current, [`${kind}Path`]: path }));
  }
  async function save(): Promise<void> {
    try {
      setSettings(await window.videoQuickEditor.updateSettings(draft));
    } catch (error) {
      setError(message(error));
    }
  }
  async function changeLanguage(language: Language): Promise<void> {
    try {
      setSettings(await window.videoQuickEditor.updateSettings({ language }));
    } catch (error) {
      setError(message(error));
    }
  }
  return (
    <div className="mx-auto max-w-[800px] px-8 py-[58px]">
      <div>
        <span className={eyebrowClass}>{copy.toolsEyebrow}</span>
        <h1 className="my-2 text-4xl tracking-[-0.04em]">{copy.ffmpegSettings}</h1>
        <p className="mt-0 mb-[35px] text-[#778592]">{copy.settingsDescription}</p>
      </div>
      <ModelSettings />
      <AppUpdateSettings />
      <section className="mb-4 flex items-center justify-between gap-8 rounded-2xl border border-white/10 bg-panel p-7">
        <div>
          <h2 className="m-0 text-base font-bold text-white">{copy.language}</h2>
          <p className="mt-1 mb-0 text-xs text-slate-500">{copy.languageDescription}</p>
        </div>
        <select
          aria-label={copy.language}
          className="min-w-44 rounded-lg border border-white/10 bg-[#090e14] px-3 py-2 text-sm text-slate-100 outline-none focus:border-primary"
          value={language}
          onChange={(event) => void changeLanguage(event.target.value as Language)}
        >
          <option value="en">{copy.english}</option>
          <option value="zh-CN">{copy.chinese}</option>
        </select>
      </section>
      <section
        className={`${surfaceCardClass} flex flex-col gap-[18px] text-[#d9e0e5] [&>label]:block [&>label]:text-[10px] [&>label]:font-bold [&>label]:tracking-[0.04em] [&>label]:text-[#7f8c99]`}
      >
        <div
          className={`flex flex-col gap-[5px] rounded-[10px] p-[14px] ${
            dependencies.status === "ready"
              ? "bg-secondary text-primary"
              : "bg-[#382321] text-[#ff9f98]"
          }`}
        >
          <b>{dependencies.status === "ready" ? copy.toolsAvailable : copy.toolsIncomplete}</b>
          <span className="text-[10px] text-[#84918f]">
            {dependencies.status === "ready" ? copy.codecsReady : copy.dependencyHint}
          </span>
        </div>
        <label>
          FFmpeg executable
          <div className="mt-[7px] flex gap-2">
            <input
              className="flex-1 rounded-lg border border-white/[0.07] bg-[#090e14] p-[10px] font-mono text-[11px] text-[#cbd5dc] outline-none focus:border-primary"
              value={draft.ffmpegPath}
              onChange={(e) => setDraft({ ...draft, ffmpegPath: e.target.value })}
            />
            <button
              className="rounded-lg border border-white/[0.08] bg-[#151d26] px-[11px] py-2 text-[#d3dbe1]"
              onClick={() => void pick("ffmpeg")}
            >
              {copy.choose}
            </button>
          </div>
        </label>
        <label>
          ffprobe executable
          <div className="mt-[7px] flex gap-2">
            <input
              className="flex-1 rounded-lg border border-white/[0.07] bg-[#090e14] p-[10px] font-mono text-[11px] text-[#cbd5dc] outline-none focus:border-primary"
              value={draft.ffprobePath}
              onChange={(e) => setDraft({ ...draft, ffprobePath: e.target.value })}
            />
            <button
              className="rounded-lg border border-white/[0.08] bg-[#151d26] px-[11px] py-2 text-[#d3dbe1]"
              onClick={() => void pick("ffprobe")}
            >
              {copy.choose}
            </button>
          </div>
        </label>
        <button className={primaryButtonClass} onClick={() => void save()}>
          {copy.saveAndCheck}
        </button>
        <div className="flex flex-col gap-[7px] border-t border-white/[0.06] pt-4 [&_code]:text-[9px] [&_code]:text-[#71808c]">
          <code>
            {dependencies.tools.find((t) => t.tool === "ffmpeg")?.version ??
              `FFmpeg ${copy.notDetected}`}
          </code>
          <code>
            {dependencies.tools.find((t) => t.tool === "ffprobe")?.version ??
              `ffprobe ${copy.notDetected}`}
          </code>
        </div>
      </section>
      <section
        className={`${surfaceCardClass} mt-4 [&_h3]:mt-0 [&_h3]:text-[#d9e0e5] [&_p]:mb-0 [&_p]:text-xs [&_p]:leading-[1.7]`}
      >
        <h3>{copy.currentLimits}</h3>
        <p>{copy.limitsDescription}</p>
      </section>
    </div>
  );
}

function formatUs(us: number): string {
  const h = Math.floor(us / 3_600_000_000);
  const m = Math.floor((us % 3_600_000_000) / 60_000_000);
  const s = (us % 60_000_000) / 1_000_000;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${s.toFixed(3).padStart(6, "0")}`;
}
function parseUs(value: string): number {
  const match = /^(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$/u.exec(value.trim());
  if (!match) throw new Error("时间格式应为 HH:MM:SS[.fraction]");
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  if (minutes >= 60 || seconds >= 60) throw new Error("分钟和秒必须小于 60");
  const us = Math.round((Number(match[1]) * 3600 + minutes * 60 + seconds) * 1_000_000);
  if (!Number.isSafeInteger(us)) throw new Error("时间超出安全范围");
  return us;
}
function commitTime(
  input: HTMLInputElement,
  fallback: number,
  commit: (value: number) => void,
  min: number,
  max: number,
): void {
  try {
    const value = parseUs(input.value);
    if (value < min || value > max) throw new Error("时间超出片段范围");
    commit(value);
  } catch {
    input.value = formatUs(fallback);
  }
}
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StoreProvider>
      <RouterProvider router={router} />
    </StoreProvider>
  </StrictMode>,
);
