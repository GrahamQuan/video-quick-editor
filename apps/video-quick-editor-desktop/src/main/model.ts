import { randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { safeStorage } from "electron";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText, streamText, tool, stepCountIs } from "ai";
import { z } from "zod";
import {
  modelUpdateSchema,
  modelProfilesSchema,
  modelProfileSchema,
  saveModelProfileSchema,
  testModelProfileSchema,
  type ModelProfiles,
  type SaveModelProfile,
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

const storedProfile = modelConfigSchema.extend({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(80),
  credentialRef: z.string().uuid().nullable(),
});
const storedCollection = z
  .object({
    version: z.literal(1),
    revision: z.number().int().nonnegative(),
    profiles: z.array(storedProfile).max(50),
    selectedProfileId: z.string().uuid().nullable(),
  })
  .superRefine((value, ctx) => {
    if (new Set(value.profiles.map((p) => p.id)).size !== value.profiles.length)
      ctx.addIssue({ code: "custom", message: "Duplicate profile ID" });
  });
type Stored = z.infer<typeof storedCollection>;
export class ModelStore {
  private state: Stored = { version: 1, revision: 0, profiles: [], selectedProfileId: null };
  private encrypted = new Map<string, Buffer>();
  private loadError: string | null = null;
  private writes: Promise<unknown> = Promise.resolve();
  constructor(
    private directory: string,
    private emit: (view: ModelProfiles) => void = () => {},
  ) {}
  private async persist(next: Stored) {
    await mkdir(this.directory, { recursive: true });
    const temporary = join(this.directory, `model-${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, JSON.stringify(next), { mode: 0o600 });
      await rename(temporary, join(this.directory, "model.json"));
    } finally {
      await rm(temporary, { force: true }).catch(() => {});
    }
  }
  async load() {
    this.loadError = null;
    try {
      let data;
      try {
        data = JSON.parse(await readFile(join(this.directory, "model.json"), "utf8"));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
        throw error;
      }
      let next: Stored;
      let rewrite = false;
      if (data.version === undefined && data.config) {
        const legacy = z
          .object({ config: modelConfigSchema, credentialRef: z.string().uuid().nullable() })
          .parse(data);
        const id = randomUUID();
        next = {
          version: 1,
          revision: 1,
          profiles: [
            {
              ...legacy.config,
              baseURL: normalizeBaseURL(legacy.config.baseURL),
              id,
              name: legacy.config.modelId,
              credentialRef: legacy.credentialRef,
            },
          ],
          selectedProfileId: id,
        };
        rewrite = true;
      } else next = storedCollection.parse(data);
      next.profiles.forEach((p) => {
        p.baseURL = normalizeBaseURL(p.baseURL);
      });
      if (!next.profiles.some((p) => p.id === next.selectedProfileId)) {
        const selected = next.profiles[0]?.id ?? null;
        if (selected !== next.selectedProfileId) {
          next.selectedProfileId = selected;
          next.revision++;
          rewrite = true;
        }
      }
      if (rewrite) await this.persist(next);
      const encrypted = new Map<string, Buffer>();
      for (const profile of next.profiles)
        if (profile.credentialRef) {
          try {
            encrypted.set(
              profile.credentialRef,
              await readFile(join(this.directory, `${profile.credentialRef}.credential`)),
            );
          } catch {
            /* only this profile loses availability */
          }
        }
      this.state = next;
      this.encrypted = encrypted;
    } catch {
      this.loadError =
        "Model configuration could not be loaded; original file preserved. Retry after repairing the file / 模型配置读取失败，原文件已保留，请修复后重试";
    }
  }
  list(): ModelProfiles {
    return modelProfilesSchema.parse({
      ...this.state,
      error: this.loadError,
      profiles: this.state.profiles.map((p) => {
        // Listing profiles must never unlock Keychain. Presence is not a
        // guarantee of decryptability; execution validates the selected key.
        const hasApiKey = !!p.credentialRef && !!this.encrypted.get(p.credentialRef)?.length;
        return modelProfileSchema.parse({ ...p, hasApiKey });
      }),
    });
  }
  view(): ModelView | null {
    return this.list().profiles.find((p) => p.id === this.state.selectedProfileId) ?? null;
  }
  private key(id?: string): string {
    const profile = this.state.profiles.find((p) => p.id === id);
    if (!profile?.credentialRef) return "";
    if (!safeStorage.isEncryptionAvailable())
      throw new Error("System secure storage unavailable / 系统安全存储不可用");
    try {
      const bytes = this.encrypted.get(profile.credentialRef);
      if (!bytes) throw new Error();
      return safeStorage.decryptString(bytes);
    } catch {
      throw new Error(
        "Credential unavailable; replace this profile key / 此配置凭证不可用，请重新设置密钥",
      );
    }
  }
  private prepare(raw: ModelUpdate, id?: string, readStoredKey = false) {
    const input = modelUpdateSchema.parse(raw);
    const config = modelConfigSchema.parse(input);
    config.baseURL = normalizeBaseURL(config.baseURL);
    const existing = this.state.profiles.find((p) => p.id === id);
    if (id && !existing) throw new Error("Unknown model profile / 模型配置不存在");
    const changed = !!existing && existing.baseURL !== config.baseURL;
    if (changed && existing.credentialRef && !input.apiKey && !input.deleteKey)
      throw new Error(
        "Enter a new key or clear the key for the changed endpoint / 更换地址后请输入新密钥或删除密钥",
      );
    return {
      input,
      config,
      existing,
      key: input.deleteKey ? "" : input.apiKey || (readStoredKey && !changed ? this.key(id) : ""),
    };
  }
  private mutate(expectedRevision: number, operation: () => Promise<Stored>) {
    const result = this.writes.then(async () => {
      if (this.loadError) throw new Error(this.loadError);
      if (expectedRevision !== this.state.revision)
        throw new Error(
          "STALE_REVISION: Model settings changed; reload and retry / 模型配置已更新，请刷新后重试",
        );
      const previous = this.state;
      const next = await operation();
      next.revision = previous.revision + 1;
      await this.persist(storedCollection.parse(next));
      this.state = next;
      const used = new Set(next.profiles.map((p) => p.credentialRef));
      for (const profile of previous.profiles)
        if (profile.credentialRef && !used.has(profile.credentialRef)) {
          this.encrypted.delete(profile.credentialRef);
          await rm(join(this.directory, `${profile.credentialRef}.credential`), {
            force: true,
          }).catch(() => {});
        }
      const view = this.list();
      this.emit(view);
      return view;
    });
    this.writes = result.catch(() => {});
    return result;
  }
  async saveProfile(raw: SaveModelProfile) {
    const input = saveModelProfileSchema.parse(raw);
    // Credentials are created only inside the serialized revision-checked write.
    const created: { id: string | null } = { id: null };
    try {
      return await this.mutate(input.expectedRevision, async () => {
        const { config, key, existing } = this.prepare(input, input.id);
        if (!existing && this.state.profiles.length >= 50)
          throw new Error("Maximum 50 model profiles / 最多 50 个模型配置");
        let credentialRef = existing?.credentialRef ?? null;
        if (input.apiKey || input.deleteKey) {
          credentialRef = null;
          if (key) {
            if (!safeStorage.isEncryptionAvailable())
              throw new Error("System secure storage unavailable / 系统安全存储不可用");
            let bytes: Buffer;
            try {
              bytes = safeStorage.encryptString(key);
            } catch {
              throw new Error("Credential encryption failed / 凭证加密失败");
            }
            created.id = credentialRef = randomUUID();
            await mkdir(this.directory, { recursive: true });
            await writeFile(join(this.directory, `${credentialRef}.credential`), bytes, {
              mode: 0o600,
            });
            this.encrypted.set(credentialRef, bytes);
          }
        }
        const profile = {
          ...config,
          id: existing?.id ?? randomUUID(),
          name: input.name,
          credentialRef,
        };
        return {
          ...this.state,
          profiles: existing
            ? this.state.profiles.map((p) => (p.id === existing.id ? profile : p))
            : [...this.state.profiles, profile],
          selectedProfileId: this.state.selectedProfileId ?? profile.id,
        };
      });
    } catch (error) {
      if (created.id) {
        this.encrypted.delete(created.id);
        await rm(join(this.directory, `${created.id}.credential`), { force: true }).catch(() => {});
      }
      throw error;
    }
  }
  deleteProfile(id: string, expectedRevision: number) {
    return this.mutate(expectedRevision, async () => {
      if (!this.state.profiles.some((p) => p.id === id))
        throw new Error("Unknown model profile / 模型配置不存在");
      const profiles = this.state.profiles.filter((p) => p.id !== id);
      return {
        ...this.state,
        profiles,
        selectedProfileId:
          this.state.selectedProfileId === id
            ? (profiles[0]?.id ?? null)
            : this.state.selectedProfileId,
      };
    });
  }
  selectProfile(id: string, expectedRevision: number) {
    return this.mutate(expectedRevision, async () => {
      if (!this.state.profiles.some((p) => p.id === id))
        throw new Error("Unknown model profile / 模型配置不存在");
      return { ...this.state, selectedProfileId: id };
    });
  }
  async save(raw: ModelUpdate) {
    const id = this.state.selectedProfileId ?? undefined;
    const input = modelUpdateSchema.parse(raw);
    const result = await this.saveProfile({
      ...input,
      id,
      name: this.state.profiles.find((p) => p.id === id)?.name ?? input.modelId,
      expectedRevision: this.state.revision,
    });
    return result.profiles.find((p) => p.id === result.selectedProfileId)!;
  }
  snapshot() {
    if (this.loadError) throw new Error(this.loadError);
    const profile = this.state.profiles.find((p) => p.id === this.state.selectedProfileId);
    if (!profile) throw new Error("Configure a model in Settings / 请先配置模型");
    const key = this.key(profile.id);
    if (!key) throw new Error("API key required / 请设置 API key");
    const config = modelConfigSchema.parse(profile);
    return {
      config,
      profile: { id: profile.id, name: profile.name, modelId: profile.modelId },
      model: createModel(config, key),
    };
  }
  async testProfile(raw: z.input<typeof testModelProfileSchema>) {
    const input = testModelProfileSchema.parse(raw);
    // An unsaved new profile must never inherit the selected profile's credential.
    return this.test({ ...input }, true);
  }
  async test(raw: ModelUpdate & { id?: string | undefined }, exactProfile = false) {
    try {
      let prepared;
      try {
        prepared = this.prepare(
          raw,
          raw.id ?? (exactProfile ? undefined : (this.state.selectedProfileId ?? undefined)),
          true,
        );
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
