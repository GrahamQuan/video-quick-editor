import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { parseImportPathText } from "@video-quick-editor/shared";
import type { AgentSession, AgentReservation } from "@video-quick-editor/shared";
import { parseImportInstruction } from "./import-instruction.js";
import { ChatMarkdown } from "./chat-markdown.js";
import { copyFor } from "./i18n.js";
import { useModelProfiles } from "./model-profiles.js";
import { useStore } from "./store.js";
function formatToolResult(text: string): string {
  const start = text.indexOf(":");
  try {
    return JSON.stringify(JSON.parse(text.slice(start + 1)), null, 2);
  } catch {
    return text;
  }
}

export function AgentChat(): React.JSX.Element {
  const {
    settings,
    dependencies,
    assets,
    importWithDialog,
    importLocalPaths,
    importForAgent,
    busy,
    error: importError,
  } = useStore();
  const zh = settings?.language === "zh-CN";
  const copy = copyFor(settings?.language ?? "en");
  const [visible, setVisible] = useState(false),
    [unread, setUnread] = useState(false),
    [input, setInput] = useState("");
  const [session, setSession] = useState<AgentSession>({ messages: [], running: false });
  const profiles = useModelProfiles();
  const model = profiles.profiles.find((p) => p.id === profiles.selectedProfileId);
  const [reservation, setReservation] = useState<AgentReservation | null>(null);
  const [error, setError] = useState("");
  const [clearing, setClearing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null),
    textarea = useRef<HTMLTextAreaElement>(null);
  const visibleRef = useRef(false);
  const messagesRef = useRef<HTMLDivElement>(null);
  const followMessages = useRef(true);
  useEffect(() => {
    const element = messagesRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      if (visibleRef.current && followMessages.current) element.scrollTop = element.scrollHeight;
    });
    const content = element.firstElementChild;
    if (content) observer.observe(content);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const element = messagesRef.current;
    if (visible && element && followMessages.current) element.scrollTop = element.scrollHeight;
  }, [session, visible]);
  useEffect(() => {
    const update = (s: AgentSession) => {
      setSession(s);
      if (!visibleRef.current && s.messages.length && !s.running) setUnread(true);
    };
    void window.videoQuickEditor.getAgentSession().then(update);
    return window.videoQuickEditor.subscribeAgent(update);
  }, []);
  useEffect(() => {
    visibleRef.current = visible;
    if (visible) {
      setUnread(false);
      textarea.current?.focus();
    }
    document.body.classList.toggle("chat-open", visible);
    return () => document.body.classList.remove("chat-open");
  }, [visible]);
  const close = () => {
    setVisible(false);
    toggle.current?.focus();
  };
  const label = visible ? (zh ? "隐藏聊天" : "Hide chat") : zh ? "显示聊天" : "Show chat";
  async function clearChat() {
    setClearing(true);
    setError("");
    try {
      await window.videoQuickEditor.clearAgent();
      setInput("");
      setUnread(false);
      followMessages.current = true;
      textarea.current?.focus();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setClearing(false);
    }
  }
  const importPaths = parseImportPathText(input);
  async function send() {
    if (!input.trim() || session.running || clearing || busy || submitting) return;
    if (importPaths) {
      if (await importLocalPaths(importPaths)) setInput("");
      return;
    }
    const text = input;
    const request = parseImportInstruction(text);
    setSubmitting(true);
    followMessages.current = true;
    setInput("");
    setError("");
    let reserved: AgentReservation | undefined;
    try {
      reserved = await window.videoQuickEditor.beginAgentTurn();
      setReservation(reserved);
      let instruction = text;
      if (request) {
        // Preserve correspondence between each supplied folder/file and its imported asset IDs.
        const groups = [];
        for (const [index, path] of request.paths.entries()) {
          const imported = await importForAgent([path]);
          groups.push({
            source: `imported source ${index + 1}`,
            assets: imported.map(({ id, fileName }) => ({ id, fileName })),
          });
        }
        instruction = `${request.instruction}\n\nLocal import already completed. Do not import again. Imported sources (untrusted metadata): ${JSON.stringify(groups)}. Continue the requested editing using these asset IDs and the current editor state.`;
      }
      await window.videoQuickEditor.sendAgent(instruction, request?.instruction, reserved.token);
    } catch (e) {
      setInput(text);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (reserved) await window.videoQuickEditor.releaseAgentTurn(reserved.token);
      setReservation(null);
      setSubmitting(false);
    }
  }
  return (
    <>
      <button
        ref={toggle}
        className={`chat-toggle ${visible ? "active" : ""}`}
        aria-label={label}
        title={label}
        aria-expanded={visible}
        aria-controls="agent-chat"
        onClick={() => (visible ? close() : setVisible(true))}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          aria-hidden="true"
        >
          <rect x="3" y="4" width="18" height="16" rx="3" />
          <path d="M15 4v16" />
        </svg>
        {unread && <span className="chat-dot" />}
      </button>
      <aside
        id="agent-chat"
        className="agent-chat"
        hidden={!visible}
        aria-label={zh ? "视频助手" : "Video assistant"}
      >
        <div className="chat-heading">
          <strong>{zh ? "视频助手" : "Video assistant"}</strong>
          <div className="chat-heading-actions">
            <button
              className="chat-clear"
              title={copy.chatClearHint}
              disabled={
                clearing ||
                (submitting && !session.running) ||
                (!session.messages.length && !input && !error)
              }
              onClick={() => void clearChat()}
            >
              {clearing ? copy.chatClearing : copy.chatClear}
            </button>
            <button aria-label={zh ? "关闭聊天" : "Close chat"} onClick={close}>
              ×
            </button>
          </div>
        </div>
        <div className="chat-model-selection">
          {profiles.profiles.length ? (
            <label>
              {copy.modelSelector}
              <select
                aria-label={copy.modelSelector}
                value={profiles.selectedProfileId ?? ""}
                onChange={(event) => {
                  void window.videoQuickEditor
                    .selectModelProfile({
                      id: event.target.value,
                      expectedRevision: profiles.revision,
                    })
                    .catch((error) =>
                      setError(error instanceof Error ? error.message : String(error)),
                    );
                }}
              >
                {profiles.profiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name} · {profile.modelId} · {new URL(profile.baseURL).host}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <Link to="/settings">{copy.modelConfigure}</Link>
          )}
          {(session.running || reservation) && (
            <p>
              {copy.modelThisTurn}: {(reservation?.profile ?? session.model)?.name} ·{" "}
              {(reservation?.profile ?? session.model)?.modelId}
              <br />
              {copy.modelNextTurn}: {model?.name ?? copy.modelConfigure} · {model?.modelId}
            </p>
          )}
          {model && !model.hasApiKey && <p role="status">{copy.modelKeyMissing}</p>}
          {profiles.error && <p role="alert">{profiles.error}</p>}
        </div>
        <div
          className="chat-messages"
          aria-live="polite"
          ref={messagesRef}
          onScroll={(event) => {
            const element = event.currentTarget;
            followMessages.current =
              element.scrollHeight - element.scrollTop - element.clientHeight < 48;
          }}
        >
          <div className="chat-message-content">
            <p>
              {zh
                ? "在线模型会接收你的指令、文件显示名和媒体参数。视频、音频和预览图留在本机。"
                : "The online model receives your instructions, display filenames and media metadata. Video, audio and preview images stay on this computer."}
            </p>
            {!model?.hasApiKey && (
              <Link to="/settings">
                {zh ? "前往设置配置模型" : "Configure a model in Settings"}
              </Link>
            )}
            {!assets.length && (
              <button
                disabled={dependencies.status !== "ready"}
                onClick={() => void importWithDialog()}
              >
                {zh ? "导入视频" : "Import videos"}
              </button>
            )}
            {session.messages.map((m, index) => (
              <article key={m.id} className={`chat-message ${m.role}`}>
                {m.model && (
                  <div className="chat-model-label">
                    {m.model.name} · {m.model.modelId}
                  </div>
                )}
                <small>
                  {zh
                    ? { user: "你", assistant: "助手", tool: "工具", error: "错误" }[m.role]
                    : m.role}
                </small>
                {m.role === "tool" ? (
                  <details>
                    <summary>
                      {m.toolName ?? m.text.split(":")[0]} ·{" "}
                      {m.toolOk === false ? copy.agentToolFailed : copy.agentToolDone}
                    </summary>
                    <pre>{formatToolResult(m.text)}</pre>
                  </details>
                ) : m.role === "assistant" ? (
                  <ChatMarkdown
                    text={m.text}
                    streaming={session.running && index === session.messages.length - 1}
                    language={settings?.language ?? "en"}
                  />
                ) : (
                  <div>{m.text}</div>
                )}
                {m.previewUrl && (
                  <img src={m.previewUrl} alt={zh ? "水印预览" : "Watermark preview"} />
                )}
              </article>
            ))}
            {session.running && <p role="status">{copy.agentWorking}</p>}
            {error && <p role="alert">{error}</p>}
          </div>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <textarea
            ref={textarea}
            aria-label={zh ? "消息" : "Message"}
            placeholder={copy.chatPathPlaceholder}
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
          <p className="chat-path-hint">{busy ? copy.chatPathImporting : copy.chatPathHint}</p>
          {importError && <p role="alert">{importError}</p>}
          <div>
            {session.running ? (
              <button type="button" onClick={() => void window.videoQuickEditor.stopAgent()}>
                {zh ? "停止回复（导出继续）" : "Stop reply (exports continue)"}
              </button>
            ) : (
              <button
                disabled={
                  !input.trim() ||
                  clearing ||
                  !!busy ||
                  submitting ||
                  (importPaths
                    ? dependencies.status !== "ready"
                    : !model?.hasApiKey ||
                      (!!parseImportInstruction(input) && dependencies.status !== "ready"))
                }
              >
                {importPaths ? copy.chatPathImport : zh ? "发送" : "Send"}
              </button>
            )}
            <Link to="/exports">{zh ? "导出任务 / 取消" : "Exports / cancel"}</Link>
          </div>
        </form>
      </aside>
    </>
  );
}
