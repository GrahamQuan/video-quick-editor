import { beforeEach, describe, it, expect, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(s).reverse(),
    decryptString: (b: Buffer) => Buffer.from(b).reverse().toString(),
  },
}));
import { ModelStore, normalizeBaseURL, createModel, modelError } from "./model.js";
import { generateText } from "ai";
import { buildContext } from "./agent.js";
beforeEach(() => vi.restoreAllMocks());
describe("model boundary", () => {
  it("normalizes prefixes and rejects unsafe endpoints", () => {
    expect(normalizeBaseURL(" https://example.com/proxy/v2/// ")).toBe(
      "https://example.com/proxy/v2",
    );
    for (const url of [
      "http://example.com",
      "https://user:pass@example.com",
      "https://example.com/?key=x",
      "https://example.com/#x",
      "https://example.com/chat/completions",
    ])
      expect(() => normalizeBaseURL(url)).toThrow();
    expect(normalizeBaseURL("http://127.0.0.1:9999/v1")).toBe("http://127.0.0.1:9999/v1");
  });
  it("uses the configured prefix, Chat Completions and rejects redirects", async () => {
    let received = "";
    let redirect = "";
    const f = vi.fn(async (input: unknown, init?: RequestInit) => {
      received = String(input);
      redirect = init?.redirect ?? "";
      return new Response(
        JSON.stringify({
          id: "test",
          object: "chat.completion",
          created: 1,
          model: "test",
          choices: [
            { index: 0, message: { role: "assistant", content: "OK" }, finish_reason: "stop" },
          ],
        }),
        { headers: { "content-type": "application/json" } },
      );
    });
    const model = createModel(
      {
        provider: "openai-compatible",
        baseURL: "https://example.com/prefix",
        modelId: "test",
        contextBudget: 16384,
      },
      "secret",
      f as typeof fetch,
    );
    expect((await generateText({ model, prompt: "hello", maxRetries: 0 })).text).toBe("OK");
    expect(received).toBe("https://example.com/prefix/chat/completions");
    expect(redirect).toBe("error");
  });
  it("persists encrypted credentials, isolates endpoint changes and deletes keys", async () => {
    const dir = await mkdtemp(join(tmpdir(), "model-test-"));
    try {
      const store = new ModelStore(dir);
      const config = { baseURL: "https://example.com", modelId: "test", apiKey: "secret-value" };
      await store.save(config);
      expect(await readFile(join(dir, "model.json"), "utf8")).not.toContain("secret-value");
      expect(JSON.stringify(store.view())).not.toContain("secret-value");
      await expect(
        store.save({ ...config, baseURL: "https://other.example", apiKey: "" }),
      ).rejects.toThrow("new key");
      const next = new ModelStore(dir);
      await next.load();
      expect(next.view()?.hasApiKey).toBe(true);
      expect(
        (await next.save({ baseURL: config.baseURL, modelId: "new", deleteKey: true })).hasApiKey,
      ).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  it("classifies errors without provider text and bounds history without splitting tools", () => {
    expect(modelError({ statusCode: 401, message: "secret" })).toContain("Authentication");
    expect(modelError({ statusCode: 429 })).toContain("Rate");
    expect(modelError({ message: "/private/key" })).not.toContain("private");
    const history = [
      [
        { role: "user" as const, content: "keep watermark" },
        { role: "assistant" as const, content: "x".repeat(10000) },
      ],
    ];
    const context = buildContext(history, ["keep watermark"], { revision: 8 }, "export", 8192);
    expect(JSON.stringify(context)).toContain("keep watermark");
    expect(JSON.stringify(context)).toContain("revision");
    expect(JSON.stringify(context)).not.toContain("x".repeat(100));
  });
});

it("connection test exercises text, streamed tool call and result without media tools or saving", async () => {
  const requests: Array<Record<string, unknown>> = [];
  const mockFetch = vi.fn(async (_input: unknown, init?: RequestInit) => {
    if (typeof init?.body !== "string") throw new Error("Expected JSON body");
    const request = JSON.parse(init.body);
    requests.push(request);
    if (!request.stream)
      return new Response(
        JSON.stringify({
          id: "text",
          object: "chat.completion",
          created: 1,
          model: "mock",
          choices: [
            { index: 0, message: { role: "assistant", content: "OK" }, finish_reason: "stop" },
          ],
        }),
        { headers: { "content-type": "application/json" } },
      );
    const complete = request.messages.some((m: { role: string }) => m.role === "tool");
    const delta = complete
      ? { content: "OK" }
      : {
          tool_calls: [
            {
              index: 0,
              id: "ping",
              type: "function",
              function: { name: "connection_ping", arguments: '{"value":"OK"}' },
            },
          ],
        };
    const events = [
      { choices: [{ index: 0, delta, finish_reason: null }] },
      { choices: [{ index: 0, delta: {}, finish_reason: complete ? "stop" : "tool_calls" }] },
    ];
    return new Response(
      events
        .map(
          (e) =>
            `data: ${JSON.stringify({ id: "s", object: "chat.completion.chunk", created: 1, model: "mock", ...e })}\n\n`,
        )
        .join("") + "data: [DONE]\n\n",
      { headers: { "content-type": "text/event-stream" } },
    );
  });
  vi.stubGlobal("fetch", mockFetch);
  try {
    const store = new ModelStore("/unused-connection-test");
    expect(
      await store.test({
        baseURL: "https://example.com/prefix",
        modelId: "mock",
        apiKey: "secret",
      }),
    ).toMatchObject({ ok: true });
    expect(requests).toHaveLength(3);
    expect(JSON.stringify(requests)).not.toContain("set_timeline");
    expect(store.view()).toBeNull();
  } finally {
    vi.unstubAllGlobals();
  }
});

it("does not fall back to plaintext when system secure storage is unavailable", async () => {
  const { safeStorage } = await import("electron");
  vi.spyOn(safeStorage, "isEncryptionAvailable").mockReturnValue(false);
  const store = new ModelStore("/unused-secure-storage-test");
  await expect(
    store.save({ baseURL: "https://example.com", modelId: "test", apiKey: "must-not-persist" }),
  ).rejects.toThrow("secure storage unavailable");
  expect(store.view()).toBeNull();
});
