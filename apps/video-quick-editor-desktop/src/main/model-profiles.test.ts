import { mkdtemp, readFile, writeFile, rm, readdir, mkdir, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { it, expect, vi } from "vitest";
vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(s).reverse(),
    decryptString: (b: Buffer) => Buffer.from(b).reverse().toString(),
  },
}));
import { ModelStore } from "./model.js";
import { safeStorage } from "electron";
const config = {
  baseURL: "https://one.example/prefix",
  modelId: "mock",
  name: "Model A",
  apiKey: "key-a",
};
it("isolates profiles, serializes revisions, persists selection and preserves immutable snapshots", async () => {
  const dir = await mkdtemp(join(tmpdir(), "profiles-"));
  try {
    const store = new ModelStore(dir);
    await store.load();
    let view = await store.saveProfile({ ...config, expectedRevision: 0 });
    const a = view.profiles[0]!;
    view = await store.saveProfile({
      ...config,
      name: "Model B",
      baseURL: "https://two.example/prefix",
      apiKey: "key-b",
      expectedRevision: view.revision,
    });
    const b = view.profiles[1]!;
    expect(view.selectedProfileId).toBe(a.id);
    const snapshot = store.snapshot();
    const [first, second] = await Promise.allSettled([
      store.selectProfile(b.id, view.revision),
      store.selectProfile(a.id, view.revision),
    ]);
    expect(first.status).toBe("fulfilled");
    expect(second.status).toBe("rejected");
    view = store.list();
    await store.deleteProfile(a.id, view.revision);
    expect(snapshot.profile).toEqual({ id: a.id, name: a.name, modelId: a.modelId });
    expect(snapshot.config.baseURL).toBe(config.baseURL);
    const reloaded = new ModelStore(dir);
    await reloaded.load();
    expect(reloaded.list().selectedProfileId).toBe(b.id);
    expect(reloaded.view()?.hasApiKey).toBe(true);
    expect(JSON.stringify(store.list())).not.toMatch(/credentialRef|key-a|key-b/);
    const json = await readFile(join(dir, "model.json"), "utf8");
    expect(json).not.toMatch(/key-a|key-b/);
    expect((await readdir(dir)).filter((f) => f.endsWith(".credential"))).toHaveLength(1);
    await reloaded.deleteProfile(b.id, reloaded.list().revision);
    expect(reloaded.list().selectedProfileId).toBeNull();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
it("migrates legacy credentials atomically and refuses damaged or future collections", async () => {
  const dir = await mkdtemp(join(tmpdir(), "migration-"));
  try {
    const ref = randomUUID();
    const file = join(dir, "model.json");
    await writeFile(join(dir, `${ref}.credential`), Buffer.from("legacy-key").reverse());
    await writeFile(
      file,
      JSON.stringify({
        config: {
          baseURL: config.baseURL,
          modelId: config.modelId,
          contextBudget: 16384,
          provider: "openai-compatible",
        },
        credentialRef: ref,
      }),
    );
    const store = new ModelStore(dir);
    await store.load();
    const id = store.list().selectedProfileId;
    expect(store.view()?.hasApiKey).toBe(true);
    const again = new ModelStore(dir);
    await again.load();
    expect(again.list().selectedProfileId).toBe(id);
    expect(await readFile(file, "utf8")).toContain(ref);
    await writeFile(file, '{"version":99}');
    const future = new ModelStore(dir);
    await future.load();
    expect(future.list().error).toBeTruthy();
    await expect(future.saveProfile({ ...config, expectedRevision: 0 })).rejects.toThrow();
    expect(await readFile(file, "utf8")).toBe('{"version":99}');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
it("keeps old collection and credentials when atomic replacement fails", async () => {
  const dir = await mkdtemp(join(tmpdir(), "model-write-"));
  try {
    const store = new ModelStore(dir);
    let view = await store.saveProfile({ ...config, expectedRevision: 0 });
    const before = store.list();
    const file = join(dir, "model.json");
    await rm(file);
    await mkdir(file);
    await expect(
      store.saveProfile({
        ...config,
        id: view.profiles[0]!.id,
        apiKey: "replacement",
        expectedRevision: view.revision,
      }),
    ).rejects.toThrow();
    expect(store.list()).toEqual(before);
    expect((await readdir(dir)).filter((f) => f.endsWith(".credential"))).toHaveLength(1);
    await rm(file, { recursive: true });
    view = await store.saveProfile({
      ...config,
      name: "B",
      baseURL: "https://two.example",
      expectedRevision: view.revision,
    });
    await expect(
      store.saveProfile({
        ...config,
        id: view.profiles[0]!.id,
        baseURL: "https://one.example/changed",
        apiKey: "",
        expectedRevision: view.revision,
      }),
    ).rejects.toThrow("new key");
    vi.spyOn(safeStorage, "decryptString").mockImplementationOnce(() => {
      throw new Error("secret should never leak");
    });
    const unavailable = store.list();
    expect(unavailable.profiles[0]?.hasApiKey).toBe(false);
    expect(unavailable.profiles[1]?.hasApiKey).toBe(true);
    vi.restoreAllMocks();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it("pins a reserved SDK tool loop across switching and deleting the original profile", async () => {
  const dir = await mkdtemp(join(tmpdir(), "profile-loop-"));
  try {
    const { AgentRunner } = await import("./agent.js");
    const { EditorService } = await import("./editor-service.js");

    const store = new ModelStore(dir);
    let view = await store.saveProfile({ ...config, expectedRevision: 0 });
    const a = view.profiles[0]!;
    view = await store.saveProfile({
      ...config,
      name: "B",
      baseURL: "https://two.example/prefix",
      apiKey: "key-b",
      expectedRevision: view.revision,
    });
    const b = view.profiles[1]!;
    const editor = new EditorService({
      assets: () => [],
      fontAvailable: () => false,
      output: () => null,
      plan: async () => {
        throw new Error("not used");
      },
      start: async () => {
        throw new Error("not used");
      },
      jobs: () => [],
      cancel: () => {},
      preview: async () => "",
      emit: () => {},
    });
    const runner = new AgentRunner(editor, store, () => {});
    const reservation = runner.reserve();
    await store.selectProfile(b.id, view.revision);
    await store.deleteProfile(a.id, store.list().revision);
    const calls: { url: string; key: string }[] = [];
    let previousToolCalls = 0;
    vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
      if (typeof init?.body !== "string") throw new Error("Expected JSON body");
      const body = JSON.parse(init.body);
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const key = new Headers(init?.headers).get("authorization") ?? "";
      calls.push({ url, key });
      const callTool = previousToolCalls++ === 0;
      const delta = callTool
        ? {
            tool_calls: [
              {
                index: 0,
                id: "read-context",
                type: "function",
                function: { name: "get_editor_context", arguments: "{}" },
              },
            ],
          }
        : { content: "Done" };
      const chunks = [
        { choices: [{ index: 0, delta, finish_reason: null }] },
        { choices: [{ index: 0, delta: {}, finish_reason: callTool ? "tool_calls" : "stop" }] },
      ];
      expect(JSON.stringify(body)).not.toContain("key-a");
      return new Response(
        chunks
          .map(
            (chunk) =>
              `data: ${JSON.stringify({ id: "mock", model: "mock", created: 1, ...chunk })}\n\n`,
          )
          .join("") + "data: [DONE]\n\n",
        { headers: { "content-type": "text/event-stream" } },
      );
    });
    // createModel captures global fetch when snapshotted; create a fresh A for the SDK mock.
    runner.release(reservation.token);
    view = await store.saveProfile({ ...config, expectedRevision: store.list().revision });
    const newA = view.profiles.at(-1)!;
    await store.selectProfile(newA.id, view.revision);
    const pinned = runner.reserve();
    await store.selectProfile(b.id, store.list().revision);
    await store.deleteProfile(newA.id, store.list().revision);
    await runner.send("Read editor context", undefined, pinned.token);
    expect(calls).toHaveLength(2);
    expect(
      calls.every(
        (call) =>
          call.url === "https://one.example/prefix/chat/completions" && call.key === "Bearer key-a",
      ),
    ).toBe(true);
    expect(runner.snapshot().messages.at(-1)).toMatchObject({
      text: "Done",
      model: { id: newA.id, name: "Model A" },
    });
    await runner.send("Say done");
    expect(calls.at(-1)).toEqual({
      url: "https://two.example/prefix/chat/completions",
      key: "Bearer key-b",
    });
    await store.saveProfile({
      ...b,
      name: "Renamed B",
      contextBudget: 8192,
      expectedRevision: store.list().revision,
    });
    const callCount = calls.length;
    await expect(runner.send("x".repeat(5000))).rejects.toThrow(/budget/);
    expect(calls).toHaveLength(callCount);
    expect(runner.snapshot().messages.at(-1)?.model?.name).toBe("B");
    expect(editor.context().draft.request.clips).toHaveLength(0);
    await runner.clear();
    expect(store.list().selectedProfileId).toBe(b.id);
  } finally {
    vi.unstubAllGlobals();
    await rm(dir, { recursive: true, force: true });
  }
});

it("preserves the legacy file on migration write failure and recovers invalid selections", async () => {
  const dir = await mkdtemp(join(tmpdir(), "migration-failure-"));
  try {
    const file = join(dir, "model.json");
    const legacy = JSON.stringify({
      config: { baseURL: config.baseURL, modelId: config.modelId },
      credentialRef: null,
    });
    await writeFile(file, legacy);
    await chmod(dir, 0o500);
    const store = new ModelStore(dir);
    await store.load();
    expect(store.list().error).toBeTruthy();
    expect(await readFile(file, "utf8")).toBe(legacy);
    await chmod(dir, 0o700);
    await store.load();
    expect(store.list().error).toBeNull();
    expect(store.list().profiles).toHaveLength(1);
    const persisted = JSON.parse(await readFile(file, "utf8"));
    persisted.selectedProfileId = randomUUID();
    await writeFile(file, JSON.stringify(persisted));
    const restored = new ModelStore(dir);
    await restored.load();
    expect(restored.list().selectedProfileId).toBe(store.list().profiles[0]!.id);
    expect(restored.list().revision).toBe(persisted.revision + 1);
  } finally {
    await chmod(dir, 0o700);
    await rm(dir, { recursive: true, force: true });
  }
});

it("a new unsaved connection test cannot inherit another profile key or alter selection", async () => {
  const dir = await mkdtemp(join(tmpdir(), "profile-test-"));
  try {
    const store = new ModelStore(dir);
    await store.saveProfile({ ...config, expectedRevision: 0 });
    const before = store.list();
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    expect(
      await store.testProfile({ baseURL: config.baseURL, modelId: "different" }),
    ).toMatchObject({ ok: false });
    expect(fetcher).not.toHaveBeenCalled();
    expect(store.list()).toEqual(before);
  } finally {
    vi.unstubAllGlobals();
    await rm(dir, { recursive: true, force: true });
  }
});
