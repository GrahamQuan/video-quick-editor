import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { parseImportPathText } from "@video-quick-editor/shared";
import type { AgentSession, ModelView } from "@video-quick-editor/shared";
import { parseImportInstruction } from "./import-instruction.js";
import { ChatMarkdown } from "./chat-markdown.js";
import { copyFor } from "./i18n.js";
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
  const [model, setModel] = useState<ModelView | null>(null);
  const [error, setError] = useState("");
  const [clearing, setClearing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => {
    const refresh = () => {
      void window.videoQuickEditor.getModel().then(setModel);
    };
    window.addEventListener("model-settings-changed", refresh);
    return () => window.removeEventListener("model-settings-changed", refresh);
  }, []);
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
      void window.videoQuickEditor.getModel().then(setModel);
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
    try {
      let instruction = text;
      if (request) {
        if (!(await window.videoQuickEditor.getModel())?.hasApiKey)
          throw new Error(copy.chatImportNeedsModel);
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
      await window.videoQuickEditor.sendAgent(instruction, request?.instruction);
    } catch (e) {
      setInput(text);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
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
              <button onClick={() => void importWithDialog()}>
                {zh ? "导入视频" : "Import videos"}
              </button>
            )}
            {session.messages.map((m, index) => (
              <article key={m.id} className={`chat-message ${m.role}`}>
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
              <button disabled={!input.trim() || clearing || !!busy || submitting}>
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
export function ModelSettings(): React.JSX.Element {
  const { settings } = useStore();
  const zh = settings?.language === "zh-CN";
  const [baseURL, setURL] = useState("https://api.deepseek.com"),
    [modelId, setId] = useState("deepseek-v4-flash"),
    [key, setKey] = useState(""),
    [hasKey, setHasKey] = useState(false),
    [budget, setBudget] = useState(16384),
    [status, setStatus] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    void window.videoQuickEditor.getModel().then((m) => {
      if (m) {
        setURL(m.baseURL);
        setId(m.modelId);
        window.dispatchEvent(new Event("model-settings-changed"));
        setHasKey(m.hasApiKey);
        setBudget(m.contextBudget);
      }
    });
  }, []);
  async function action(test: boolean, deleteKey = false) {
    setBusy(true);
    setStatus("");
    const input = {
      provider: "openai-compatible" as const,
      baseURL,
      modelId,
      contextBudget: budget,
      ...(key ? { apiKey: key } : {}),
      deleteKey,
    };
    setKey("");
    try {
      if (test) {
        const result = await window.videoQuickEditor.testModel(input);
        setStatus(result.message);
      } else {
        const m = await window.videoQuickEditor.saveModel(input);
        window.dispatchEvent(new Event("model-settings-changed"));
        setHasKey(m.hasApiKey);
        setURL(m.baseURL);
        setStatus(zh ? "已保存；尚未验证" : "Saved; not verified");
      }
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="model-settings">
      <h2>{zh ? "模型" : "Model"}</h2>
      <p>OpenAI-compatible · Chat Completions</p>
      <p>
        {zh
          ? "启用后会发送指令、文件名和媒体参数；不上传媒体。"
          : "Enabling sends instructions, filenames and media metadata; media stays local."}
      </p>
      <button
        onClick={() => {
          setURL("https://api.deepseek.com");
          setId("deepseek-v4-flash");
          setStatus("");
        }}
      >
        {zh ? "DeepSeek 预设" : "DeepSeek preset"}
      </button>
      <label>
        Base URL
        <input
          value={baseURL}
          onChange={(e) => {
            setURL(e.target.value);
            setStatus("");
          }}
        />
      </label>
      <label>
        Model ID
        <input
          value={modelId}
          onChange={(e) => {
            setId(e.target.value);
            setStatus("");
          }}
        />
      </label>
      <label>
        API key {hasKey ? (zh ? "（已设置，留空保留）" : "(saved; blank keeps key)") : ""}
        <input
          type="password"
          autoComplete="off"
          value={key}
          onChange={(e) => setKey(e.target.value)}
        />
      </label>
      <label>
        {zh ? "上下文预算" : "Context budget"}
        <input
          type="number"
          min="8192"
          max="262144"
          value={budget}
          onChange={(e) => setBudget(Number(e.target.value))}
        />
      </label>
      <div className="model-actions">
        <button disabled={busy} onClick={() => void action(true)}>
          {zh ? "测试连接" : "Test connection"}
        </button>
        <button disabled={busy} onClick={() => void action(false)}>
          {zh ? "保存" : "Save"}
        </button>
        <button disabled={busy || !hasKey} onClick={() => void action(false, true)}>
          {zh ? "删除密钥" : "Delete key"}
        </button>
      </div>
      <p role="status">{status}</p>
    </section>
  );
}
