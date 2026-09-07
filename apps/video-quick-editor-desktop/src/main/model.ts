import { randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { safeStorage } from "electron";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText, streamText, tool, stepCountIs } from "ai";
import { z } from "zod";
import {
  modelUpdateSchema,
  modelConfigSchema,
  type ModelConfig,
  type ModelUpdate,
  type ModelView,
} from "@video-quick-editor/shared";

export function normalizeBaseURL(value: string): string {
  const url = new URL(value.trim());
  if (url.username || url.password || url.search || url.hash)
    throw new Error(
      "URL must not contain credentials, query or fragment / 地址不能包含账号、查询或片段",
    );
  if (/\/(chat\/completions|responses)\/*$/u.test(url.pathname))
    throw new Error("Enter the API root, without /chat/completions / 请填写 API 根地址");
  if (
    url.protocol !== "https:" &&
    !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
  )
    throw new Error("HTTPS required except loopback / 非本机地址必须使用 HTTPS");
  return url.toString().replace(/\/+$/u, "");
}
export function modelError(error: unknown): string {
  const status =
    typeof error === "object" && error !== null && "statusCode" in error
      ? Number(error.statusCode)
      : 0;
  if (status === 401 || status === 403) return "Authentication failed / 认证失败";
  if (status === 404) return "Model or API route not found / 模型或接口不存在";
  if (status === 429) return "Rate limited / 请求限流";
  if (error instanceof Error && /abort|timeout/i.test(error.name))
    return "Request stopped or timed out / 请求已停止或超时";
  return "Connection or tool calling failed / 连接或工具调用失败";
}
export function createModel(config: ModelConfig, key: string, fetcher: typeof fetch = fetch) {
  const origin = new URL(config.baseURL).origin;
  return createOpenAICompatible({
    name: "configured",
    baseURL: config.baseURL,
    apiKey: key,
    fetch: async (input, init) => {
      const url = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
      );
      if (url.origin !== origin) throw new Error("Cross-origin request rejected");
      // Disable DeepSeek thinking until reasoning/tool message round trips are verified.
      let body = init?.body;
      if (url.hostname === "api.deepseek.com" && typeof body === "string")
        body = JSON.stringify({ ...JSON.parse(body), thinking: { type: "disabled" } });
      return fetcher(input, {
        ...init,
        ...(body !== undefined ? { body } : {}),
        redirect: "error",
      });
    },
  }).chatModel(config.modelId);
}
export class ModelStore {
  private config: ModelConfig | null = null;
  private encrypted: string | null = null;
  private credentialRef: string | null = null;
  constructor(private directory: string) {}
  async load() {
    try {
      const data = JSON.parse(await readFile(join(this.directory, "model.json"), "utf8"));
      this.config = modelConfigSchema.parse(data.config);
      this.config.baseURL = normalizeBaseURL(this.config.baseURL);
      this.credentialRef = data.credentialRef ? z.string().uuid().parse(data.credentialRef) : null;
      this.encrypted = this.credentialRef
        ? (await readFile(join(this.directory, `${this.credentialRef}.credential`))).toString(
            "base64",
          )
        : null;
    } catch {
      /* unconfigured */
    }
  }
  view(): ModelView | null {
    return this.config ? { ...this.config, hasApiKey: !!this.encrypted } : null;
  }
  private key() {
    if (!this.encrypted) return "";
    if (!safeStorage.isEncryptionAvailable())
      throw new Error("System secure storage unavailable / 系统安全存储不可用");
    return safeStorage.decryptString(Buffer.from(this.encrypted, "base64"));
  }
  private prepare(raw: ModelUpdate) {
    const input = modelUpdateSchema.parse(raw);
    const config = modelConfigSchema.parse(input);
    config.baseURL = normalizeBaseURL(config.baseURL);
    const changed = this.config?.baseURL !== config.baseURL;
    if (changed && !input.apiKey && !input.deleteKey && this.encrypted)
      throw new Error("Enter a new key for the changed endpoint / 更换地址后请明确输入密钥");
    return {
      input,
      config,
      key: input.deleteKey ? "" : input.apiKey || (!changed ? this.key() : ""),
    };
  }
  async save(raw: ModelUpdate) {
    const { config, key } = this.prepare(raw);
    if (key && !safeStorage.isEncryptionAvailable())
      throw new Error("System secure storage unavailable / 系统安全存储不可用");
    const encrypted = key ? safeStorage.encryptString(key).toString("base64") : null;
    await mkdir(this.directory, { recursive: true });
    const credentialRef = encrypted ? randomUUID() : null;
    if (credentialRef)
      await writeFile(
        join(this.directory, `${credentialRef}.credential`),
        Buffer.from(encrypted!, "base64"),
        { mode: 0o600 },
      );
    const temporary = join(this.directory, `model-${randomUUID()}.tmp`);
    await writeFile(temporary, JSON.stringify({ config, credentialRef }), { mode: 0o600 });
    await rename(temporary, join(this.directory, "model.json"));
    if (this.credentialRef)
      await rm(join(this.directory, `${this.credentialRef}.credential`), { force: true });
    this.credentialRef = credentialRef;
    this.config = config;
    this.encrypted = encrypted;
    return this.view()!;
  }
  snapshot() {
    if (!this.config) throw new Error("Configure a model in Settings / 请先配置模型");
    const key = this.key();
    if (!key) throw new Error("API key required / 请设置 API key");
    return { config: { ...this.config }, model: createModel({ ...this.config }, key) };
  }
  async test(raw: ModelUpdate) {
    try {
      let prepared;
      try {
        prepared = this.prepare(raw);
      } catch {
        return {
          ok: false,
          message: "Invalid configuration or endpoint key missing / 配置无效，或新地址尚未提供密钥",
        };
      }
      const { config, key } = prepared;
      if (!key) return { ok: false, message: "API key required / 请设置 API key" };
      const model = createModel(config, key);
      const abortSignal = AbortSignal.timeout(30000);
      const text = await generateText({
        model,
        prompt: "Reply with OK.",
        maxOutputTokens: 32,
        maxRetries: 0,
        abortSignal,
      });
      if (!text.text) throw new Error("No text");
      let called = false;
      const result = streamText({
        model,
        onError: () => {},
        prompt: "Call connection_ping with value OK, then say OK.",
        tools: {
          connection_ping: tool({
            inputSchema: z.object({ value: z.literal("OK") }),
            execute: async () => {
              called = true;
              return { ok: true };
            },
          }),
        },
        toolChoice: "auto",
        stopWhen: stepCountIs(3),
        maxOutputTokens: 128,
        maxRetries: 0,
        abortSignal,
      });
      let output = "";
      for await (const part of result.fullStream) {
        if (part.type === "text-delta") output += part.text;
        if (part.type === "error") throw part.error;
      }
      if (!called || !output)
        return {
          ok: false,
          message: "Tool calling / streaming incompatible / 工具调用或流式响应不兼容",
        };
      return {
        ok: true,
        message:
          "Text, streaming and tool loop passed this test / 本次文本、流式和工具循环测试通过",
      };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof TypeError ? "Invalid address / 地址无效" : modelError(error),
      };
    }
  }
}
