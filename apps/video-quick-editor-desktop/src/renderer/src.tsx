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
import type { ClipSpec, ExportJob, ExportRequest } from "@video-quick-editor/shared";
import { formatProgress, isTerminalJob, jobKind, jobStateLabel } from "./jobs.js";
import { StoreProvider, useStore } from "./store.js";
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

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

function Shell(): React.JSX.Element {
  const { jobs } = useStore();
  const activeJob = jobs.find((job) => !isTerminalJob(job));
  return (
    <div className="app-shell">
      <header>
        <Link to="/" className="brand">
          <span className="brand-mark">▶</span>
          <span>
            Video Quick Editor<small>本地视频工作台</small>
          </span>
        </Link>
        <nav>
          <Link to="/" activeProps={{ className: "active" }}>
            编辑
          </Link>
          <Link to="/exports" activeProps={{ className: "active" }}>
            导出
            {activeJob && (
              <span className="nav-progress">
                {jobKind(activeJob)} {formatProgress(activeJob.progress)}
              </span>
            )}
          </Link>
          <Link to="/settings" activeProps={{ className: "active" }}>
            设置
          </Link>
        </nav>
        <span className="local-pill">● 仅在本机处理</span>
      </header>
      <main>
        <Outlet />
      </main>
    </div>
  );
}

function EditorPage(): React.JSX.Element {
  const store = useStore();
  const [dragId, setDragId] = useState<string | null>(null);
  const [playerError, setPlayerError] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [realFrame, setRealFrame] = useState<string | null>(null);
  const [action, setAction] = useState<string | null>(null);
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

  async function proxy(): Promise<void> {
    if (!asset) return;
    setAction("生成预览副本…");
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
    setAction("渲染真实单帧…");
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
    setAction("正在校验导出计划…");
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
    <div className="editor-page">
      {store.error && (
        <div className="toast error">
          <span>{store.error}</span>
          <button onClick={() => store.setError(null)}>×</button>
        </div>
      )}
      <section className="clips-panel panel">
        <div className="panel-title">
          <div>
            <span className="eyebrow">01 · {isCombine ? "组合顺序" : "裁剪素材"}</span>
            <h2>
              {isCombine ? "组合时间线" : "待裁剪片段"} <b>{store.clips.length}</b>
            </h2>
          </div>
          <button className="icon-button" onClick={() => void store.importWithDialog()}>
            ＋
          </button>
        </div>
        <div className="workflow-indicator">
          <div className={!isCombine ? "active" : ""}>
            <b>✂ 裁剪</b>
            <small>一个片段，精确选择起止点</small>
          </div>
          <div className={isCombine ? "active" : ""}>
            <b>⧉ 组合</b>
            <small>两个以上片段，按顺序合并</small>
          </div>
        </div>
        <button
          className="drop-zone"
          onClick={() => void store.importWithDialog()}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            void store.importDropped([...event.dataTransfer.files]);
          }}
        >
          <span>＋</span>
          <strong>
            {store.clips.length === 0
              ? "添加本地视频"
              : isCombine
                ? "继续添加组合片段"
                : "添加第二段视频，开始组合"}
          </strong>
          <small>MP4 · MOV · MKV · 多选后按选择顺序组合</small>
        </button>
        {store.busy && <div className="status-card shimmer">{store.busy}</div>}
        {isCombine && <p className="sequence-note">从上到下依次播放 · 拖动卡片调整顺序</p>}
        <div className={`clip-list ${isCombine ? "combine" : ""}`}>
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
                className={`clip-card ${clip.id === store.selectedClipId ? "selected" : ""}`}
                onClick={() => store.selectClip(clip.id)}
              >
                <div className="order">{String(index + 1).padStart(2, "0")}</div>
                <video className="thumb" src={clipAsset.previewUrl} muted preload="metadata" />
                <div className="clip-info">
                  <strong title={clipAsset.fileName}>{clipAsset.fileName}</strong>
                  <span>
                    {formatUs(clip.startUs)} → {formatUs(clip.endUs)}
                  </span>
                  <small>{formatUs(clip.endUs - clip.startUs)} 已选</small>
                </div>
                <div className="clip-actions">
                  <button
                    title="上移"
                    onClick={(event) => {
                      event.stopPropagation();
                      store.moveClip(clip.id, -1);
                    }}
                  >
                    ↑
                  </button>
                  <button
                    title="下移"
                    onClick={(event) => {
                      event.stopPropagation();
                      store.moveClip(clip.id, 1);
                    }}
                  >
                    ↓
                  </button>
                  <button
                    title="复制"
                    onClick={(event) => {
                      event.stopPropagation();
                      store.duplicateClip(clip.id);
                    }}
                  >
                    ⧉
                  </button>
                  <button
                    title="删除"
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
          <button className="add-combine" onClick={() => void store.importWithDialog()}>
            ＋ 添加下一个组合片段
          </button>
        )}
      </section>

      <section className="preview-panel panel">
        <div className="panel-title">
          <div>
            <span className="eyebrow">02 · 精确选段</span>
            <h2>{asset?.fileName ?? "预览画面"}</h2>
          </div>
          {asset && (
            <span className="codec-pill">
              {asset.video.codec.toUpperCase()} · {asset.video.displayWidth}×
              {asset.video.displayHeight}
            </span>
          )}
        </div>
        <div className="stage">
          {asset ? (
            <>
              <video
                key={previewUrl ?? asset.previewUrl}
                ref={player}
                src={previewUrl ?? asset.previewUrl}
                controls
                onError={() => setPlayerError(true)}
              />
              {store.watermark.enabled && !realFrame && (
                <div
                  className={`watermark-preview ${store.watermark.position}`}
                  style={{
                    fontSize: `${Math.max(10, store.watermark.fontSize / 2)}px`,
                    margin: `${Math.max(6, store.watermark.margin / 2)}px`,
                  }}
                >
                  {store.watermark.text || "水印预览"}
                </div>
              )}
              {realFrame && (
                <div className="frame-modal" onClick={() => setRealFrame(null)}>
                  <img src={realFrame} alt="真实导出单帧预览" />
                  <span>真实导出单帧 · 点击关闭</span>
                </div>
              )}
            </>
          ) : (
            <div className="empty-stage">
              <span>▶</span>
              <strong>从左侧添加视频开始</strong>
              <small>素材不会离开你的设备</small>
            </div>
          )}
        </div>
        {playerError && (
          <div className="inline-warning">
            Chromium 无法播放此原片。
            <button onClick={() => void proxy()}>生成 H.264/AAC 预览副本</button>
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
          />
        )}
        <div className="preview-note">
          <span>快速 overlay 是近似效果，FFmpeg 单帧才代表导出画面。</span>
          <button
            className="secondary"
            disabled={!asset || action !== null}
            onClick={() => void frame()}
          >
            ◫ 预览导出画面
          </button>
        </div>
        {asset?.warnings.map((warning) => (
          <div className="inline-warning" key={warning}>
            {warning}
          </div>
        ))}
      </section>

      <section className="settings-panel panel">
        <div className="panel-title">
          <div>
            <span className="eyebrow">03 · 输出样式</span>
            <h2>水印与{isCombine ? "组合" : "裁剪"}</h2>
          </div>
        </div>
        <label className="toggle-row">
          <span>
            <strong>文字水印</strong>
            <small>白字黑色描边，覆盖完整输出</small>
          </span>
          <input
            type="checkbox"
            checked={store.watermark.enabled}
            onChange={(event) => store.setWatermark({ enabled: event.target.checked })}
          />
        </label>
        <fieldset disabled={!store.watermark.enabled}>
          <label>
            文案
            <textarea
              rows={3}
              placeholder="输入单行水印文案"
              value={store.watermark.text}
              onChange={(event) => store.setWatermark({ text: event.target.value })}
            />
          </label>
          <div className="split">
            <label>
              位置
              <select
                value={store.watermark.position}
                onChange={(event) =>
                  store.setWatermark({
                    position: event.target.value as typeof store.watermark.position,
                  })
                }
              >
                <option value="top-left">左上</option>
                <option value="top-right">右上</option>
                <option value="bottom-left">左下</option>
                <option value="bottom-right">右下</option>
              </select>
            </label>
            <label>
              字号
              <input
                type="number"
                min="8"
                max="512"
                value={store.watermark.fontSize}
                onChange={(event) => store.setWatermark({ fontSize: Number(event.target.value) })}
              />
            </label>
          </div>
          <div className="split">
            <label>
              边距
              <input
                type="number"
                min="0"
                value={store.watermark.margin}
                onChange={(event) => store.setWatermark({ margin: Number(event.target.value) })}
              />
            </label>
            <label>
              字体
              <button
                className="field-button"
                onClick={() =>
                  void window.videoQuickEditor
                    .chooseFont()
                    .then((font) => font && store.setWatermark({ fontId: font.id }))
                    .catch((error: unknown) => store.setError(message(error)))
                }
              >
                {store.watermark.fontId ? "已选择 · 更换" : "选择字体…"}
              </button>
            </label>
          </div>
        </fieldset>
        <hr />
        <label>
          导出模式
          <select
            value={store.mode}
            onChange={(event) => store.setMode(event.target.value as ExportRequest["mode"])}
          >
            <option value="accurate" disabled={isCombine}>
              Accurate · 精确裁剪
            </option>
            <option value="normalize">Normalize · 标准化后组合</option>
            <option value="copy">Copy · 快速裁剪 / 组合</option>
          </select>
        </label>
        <p className="help">
          {store.mode === "copy"
            ? "不重编码；边界受关键帧影响，不能加水印。"
            : store.mode === "normalize"
              ? "统一尺寸、帧率和音频参数，适合多片段。"
              : "精确单片段剪辑并重编码。"}
        </p>
        {store.mode === "normalize" && (
          <div className="split three">
            <label>
              宽
              <input
                placeholder="首段"
                type="number"
                value={store.normalize.width ?? ""}
                onChange={(e) =>
                  store.setNormalize({ width: e.target.value ? Number(e.target.value) : null })
                }
              />
            </label>
            <label>
              高
              <input
                placeholder="首段"
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
                placeholder="自动"
                value={store.normalize.fps ?? ""}
                onChange={(e) => store.setNormalize({ fps: e.target.value || null })}
              />
            </label>
          </div>
        )}
        {store.mode !== "copy" && (
          <label>
            视频 Codec
            <select
              value={store.videoCodec ?? ""}
              onChange={(e) =>
                store.setVideoCodec((e.target.value || null) as ExportRequest["videoCodec"])
              }
            >
              <option value="">继承首段并映射</option>
              <option value="h264">H.264 / libx264</option>
              <option value="hevc">HEVC / libx265</option>
            </select>
          </label>
        )}
        <label>
          输出位置
          <button
            className="output-picker"
            disabled={!asset}
            onClick={() =>
              asset &&
              void window.videoQuickEditor
                .chooseOutput(defaultName(asset.fileName, store.clips.length))
                .then((output) => store.setOutput(output))
            }
          >
            <span>{store.output?.displayPath ?? "macOS Downloads（自动防重名）"}</span>
            <b>选择…</b>
          </button>
        </label>
      </section>

      <footer className="export-bar">
        <div>
          <strong>{store.clips.length}</strong>
          <span>个片段</span>
        </div>
        <div>
          <strong>{formatUs(totalUs)}</strong>
          <span>总选中时长</span>
        </div>
        {activeJob ? (
          <>
            <div className="grow inline-task">
              <span>
                {jobStateLabel(activeJob)} · {activeJob.phase}
              </span>
              <div className="progress">
                <i style={{ width: `${(activeJob.progress ?? 0) * 100}%` }} />
              </div>
            </div>
            <strong className="inline-percent">{formatProgress(activeJob.progress)}</strong>
            <button
              className="secondary danger"
              disabled={activeJob.state === "cancelling"}
              onClick={() =>
                void window.videoQuickEditor
                  .cancelExport(activeJob.id)
                  .catch((error: unknown) => store.setError(message(error)))
              }
            >
              中断
            </button>
            <button className="primary" onClick={() => void router.navigate({ to: "/exports" })}>
              查看进度 <b>→</b>
            </button>
          </>
        ) : (
          <>
            <div className="grow">
              <span>{action ?? store.output?.displayPath ?? "默认导出到 Downloads"}</span>
            </div>
            <button
              className="primary"
              disabled={
                !store.clips.length || action !== null || !store.settings?.toolStatus.available
              }
              onClick={() => void exportVideo()}
            >
              开始{isCombine ? "组合" : "裁剪"} <b>→</b>
            </button>
          </>
        )}
      </footer>
    </div>
  );
}

function ClipEditor({
  clip,
  durationUs,
  currentUs,
  seek,
}: {
  clip: ClipSpec;
  durationUs: number;
  currentUs: () => number;
  seek: (us: number) => void;
}): React.JSX.Element {
  const store = useStore();
  return (
    <div className="clip-editor">
      <div className="time-field">
        <label>起点</label>
        <input
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
          onClick={() =>
            store.updateClip(clip.id, { startUs: clamp(currentUs(), 0, clip.endUs - 1) })
          }
        >
          设为起点
        </button>
      </div>
      <div className="range-track">
        <span
          style={{
            left: `${(clip.startUs / durationUs) * 100}%`,
            right: `${100 - (clip.endUs / durationUs) * 100}%`,
          }}
        />
        <input
          aria-label="定位"
          type="range"
          min="0"
          max={durationUs}
          value={Math.min(durationUs, currentUs())}
          onChange={(e) => seek(Number(e.target.value))}
        />
      </div>
      <div className="time-field">
        <label>终点</label>
        <input
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
          onClick={() =>
            store.updateClip(clip.id, { endUs: clamp(currentUs(), clip.startUs + 1, durationUs) })
          }
        >
          设为终点
        </button>
      </div>
    </div>
  );
}

function ExportsPage(): React.JSX.Element {
  const { jobs, setError } = useStore();
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
    <div className="route-page">
      <div className="route-heading">
        <span className="eyebrow">SESSION · 当前会话</span>
        <h1>导出任务队列</h1>
        <p>实时查看裁剪与组合进度。中断会终止 FFmpeg 并删除半成品。</p>
      </div>
      {jobs.length === 0 ? (
        <div className="empty-card">还没有导出任务。回到编辑页选择片段并开始导出。</div>
      ) : (
        <>
          <div className="queue-toolbar">
            <label>
              <input
                type="checkbox"
                checked={allSelected}
                disabled={deletableJobs.length === 0}
                onChange={() =>
                  setSelectedIds(allSelected ? [] : deletableJobs.map((job) => job.id))
                }
              />
              选择全部已结束任务
            </label>
            <span>删除任务只清理队列记录，不删除已导出视频</span>
            <button
              className="danger"
              disabled={selectedIds.length === 0}
              onClick={() => void deleteSelected()}
            >
              批量删除 {selectedIds.length > 0 ? `(${selectedIds.length})` : ""}
            </button>
          </div>
          <div className="jobs">
            {jobs.map((job) => (
              <article className="job-card" key={job.id}>
                <div className="job-select">
                  {isTerminalJob(job) && (
                    <input
                      aria-label={`选择${jobKind(job)}任务`}
                      type="checkbox"
                      checked={selectedIds.includes(job.id)}
                      onChange={() => toggleJob(job)}
                    />
                  )}
                </div>
                <div className={`job-state ${job.state}`}>{jobStateLabel(job)}</div>
                <div className="job-main">
                  <strong>
                    {jobKind(job)} · {job.request.clips.length} 个片段
                  </strong>
                  <span>{job.phase}</span>
                  {job.error && <p className="job-error">{job.error}</p>}
                  <div className="progress">
                    <i style={{ width: `${(job.progress ?? 0) * 100}%` }} />
                  </div>
                  <small className="job-percent">{formatProgress(job.progress)}</small>
                  {job.resultPath && <code>{job.resultPath}</code>}
                </div>
                <div className="job-actions">
                  {!["completed", "failed", "cancelled"].includes(job.state) && (
                    <button
                      disabled={job.state === "cancelling"}
                      onClick={() =>
                        void window.videoQuickEditor
                          .cancelExport(job.id)
                          .catch((error: unknown) => setError(message(error)))
                      }
                    >
                      中断
                    </button>
                  )}
                  {job.state === "completed" && (
                    <>
                      <button onClick={() => void window.videoQuickEditor.openOutput(job.id)}>
                        打开视频
                      </button>
                      <button onClick={() => void window.videoQuickEditor.revealOutput(job.id)}>
                        在 Finder 显示
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
  const { settings, setSettings, setError } = useStore();
  const [draft, setDraft] = useState({ ffmpegPath: "", ffprobePath: "" });
  useEffect(() => {
    if (settings) setDraft({ ffmpegPath: settings.ffmpegPath, ffprobePath: settings.ffprobePath });
  }, [settings]);
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
  return (
    <div className="route-page settings-route">
      <div className="route-heading">
        <span className="eyebrow">TOOLS · 能力检测</span>
        <h1>FFmpeg 设置</h1>
        <p>应用不自动下载工具；Finder 启动时也会探测 Homebrew 常见位置。</p>
      </div>
      <section className="settings-card">
        <div className={`health ${settings?.toolStatus.available ? "ok" : "bad"}`}>
          <b>{settings?.toolStatus.available ? "● 工具链可用" : "● 工具链不完整"}</b>
          <span>
            {settings?.toolStatus.missing.join(" · ") ||
              "libx264、libx265、AAC 与所需 filters 已就绪"}
          </span>
        </div>
        <label>
          FFmpeg executable
          <div className="path-field">
            <input
              value={draft.ffmpegPath}
              onChange={(e) => setDraft({ ...draft, ffmpegPath: e.target.value })}
            />
            <button onClick={() => void pick("ffmpeg")}>选择…</button>
          </div>
        </label>
        <label>
          ffprobe executable
          <div className="path-field">
            <input
              value={draft.ffprobePath}
              onChange={(e) => setDraft({ ...draft, ffprobePath: e.target.value })}
            />
            <button onClick={() => void pick("ffprobe")}>选择…</button>
          </div>
        </label>
        <button className="primary" onClick={() => void save()}>
          保存并重新检测
        </button>
        <div className="versions">
          <code>{settings?.toolStatus.ffmpegVersion ?? "FFmpeg 未检测"}</code>
          <code>{settings?.toolStatus.ffprobeVersion ?? "ffprobe 未检测"}</code>
        </div>
      </section>
      <section className="limit-card">
        <h3>第一期边界</h3>
        <p>
          重编码支持普通 SDR、8-bit、无旋转 metadata；HDR、10-bit 和旋转输入仅允许
          copy。预览副本只用于播放，最终导出始终读取原文件。
        </p>
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
function defaultName(fileName: string, count: number): string {
  const dot = fileName.lastIndexOf(".");
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
  const extension = dot > 0 ? fileName.slice(dot) : "";
  return `${stem}${count === 1 ? "_clip" : "_combined"}${extension}`;
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
