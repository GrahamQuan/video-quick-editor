import { describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { EditorService } from "./editor-service.js";
import type { AssetView, ExportJob } from "@video-quick-editor/shared";
const asset = {
  id: randomUUID(),
  durationUs: 30_000_000,
  fileName: "A.mov",
  previewUrl: "media://asset/test",
} as AssetView;
function setup() {
  const start = vi.fn(
    async (request) => ({ id: randomUUID(), request, state: "validating" }) as ExportJob,
  );
  const service = new EditorService({
    assets: () => [asset],
    fontAvailable: () => false,
    output: () => null,
    plan: async () => ({
      expectedDurationUs: 15_000_000,
      outputPath: "/private/A.mp4",
      changes: [],
      warnings: [],
    }),
    start,
    jobs: () => [],
    cancel: () => {},
    preview: async () => "media://frame/id",
    emit: () => {},
  });
  const clip = { id: randomUUID(), assetId: asset.id, startUs: 5_000_000, endUs: 20_000_000 };
  service.update(0, { ...service.draft.request, clips: [clip] });
  return { service, start, clip };
}
describe("versioned editor tools", () => {
  it("rejects stale/invalid atomic edits and does not disclose output paths", async () => {
    const { service, clip } = setup();
    const before = service.snapshot();
    expect(await service.call("set_timeline", { expectedRevision: 0, clips: [] })).toMatchObject({
      ok: false,
      error: { code: "STALE_REVISION" },
    });
    expect(
      await service.call("set_timeline", {
        expectedRevision: 1,
        clips: [{ ...clip, endUs: 99_000_000 }],
      }),
    ).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENT" } });
    expect(service.snapshot()).toEqual(before);
    expect(JSON.stringify(service.context())).not.toContain("media://");
  });
  it("expires plans on edits; started snapshots and request IDs are immutable", async () => {
    const { service, start, clip } = setup();
    const p = await service.call("plan_export", { revision: 1, clipIds: [clip.id] });
    if (!p.ok) throw Error();
    const planId = (p.data as { planId: string }).planId;
    const [a, b] = await Promise.all([
      service.call("start_export", { planId, requestId: "one" }),
      service.call("start_export", { planId, requestId: "one" }),
    ]);
    expect(a).toEqual(b);
    expect(start).toHaveBeenCalledTimes(1);
    service.update(1, { ...service.draft.request, clips: [] });
    expect(start.mock.calls[0]?.[0].clips).toHaveLength(1);
    expect(await service.call("start_export", { planId, requestId: "one" })).toEqual(a);
    expect(await service.call("start_export", { planId, requestId: "two" })).toMatchObject({
      ok: false,
      error: { code: "PLAN_EXPIRED" },
    });
  });
  it("checks preview source range and rejects forged output tokens", async () => {
    const { service, clip } = setup();
    expect(
      await service.call("preview_frame", { revision: 1, clipId: clip.id, atUs: 20_000_000 }),
    ).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENT" } });
    expect(
      await service.call("set_output", {
        expectedRevision: 1,
        outputProfile: "source",
        outputToken: randomUUID(),
      }),
    ).toMatchObject({ ok: false, error: { code: "OUTPUT_CONFLICT" } });
  });
});

it("watermark tools only change the selected clip and timeline edits preserve it", async () => {
  const { service, clip } = setup();
  const second = { ...clip, id: randomUUID() };
  service.update(
    service.draft.revision,
    { ...service.draft.request, clips: [clip, second] },
    clip.id,
  );
  const watermark = { ...service.draft.request.watermark, text: "First only" };
  expect(
    await service.call("set_watermark", { expectedRevision: service.draft.revision, watermark }),
  ).toMatchObject({ ok: true });
  expect(service.draft.request.clips[0]?.watermark?.text).toBe("First only");
  expect(service.draft.request.clips[1]?.watermark).toBeUndefined();
  expect(service.draft.request.watermark.text).toBe("");
  expect(
    await service.call("set_timeline", {
      expectedRevision: service.draft.revision,
      clips: [second, clip],
    }),
  ).toMatchObject({ ok: true });
  expect(service.draft.request.clips[1]?.watermark?.text).toBe("First only");
});

it("returns repairable dependency errors from media tools while context and draft editing remain available", async () => {
  let ready = true;
  const unavailable = async () => {
    if (!ready) throw new Error("TOOLS_UNAVAILABLE: ffprobe not-found; check Settings");
  };
  const service = new EditorService({
    assets: () => [asset],
    fontAvailable: () => false,
    output: () => null,
    plan: async () => {
      await unavailable();
      return {
        expectedDurationUs: 1000000,
        outputPath: "/private/output.mp4",
        changes: [],
        warnings: [],
      };
    },
    start: async () => {
      await unavailable();
      throw new Error("No job should be created");
    },
    jobs: () => [],
    cancel: () => {},
    preview: async () => {
      await unavailable();
      return "";
    },
    emit: () => {},
  });
  const clip = { id: randomUUID(), assetId: asset.id, startUs: 0, endUs: 1000000 };
  service.update(0, { ...service.draft.request, clips: [clip] });
  const plan = await service.call("plan_export", { revision: 1, clipIds: [clip.id] });
  if (!plan.ok) throw new Error();
  ready = false;
  for (const [name, input] of [
    ["plan_export", { revision: 1, clipIds: [clip.id] }],
    ["preview_frame", { revision: 1, clipId: clip.id, atUs: 0 }],
    ["start_export", { planId: (plan.data as { planId: string }).planId, requestId: "blocked" }],
  ] as const)
    expect(await service.call(name, input)).toMatchObject({
      ok: false,
      error: { code: "TOOLS_UNAVAILABLE" },
    });
  expect((await service.call("get_editor_context", {})).ok).toBe(true);
  expect(
    (
      await service.call("set_timeline", {
        expectedRevision: 1,
        clips: [{ ...clip, endUs: 2000000 }],
      })
    ).ok,
  ).toBe(true);
});

it("selection revisions preserve unrelated edits and Agent plans use explicit IDs independently of UI members", async () => {
  const sources = ["A", "B", "C", "D"].map((fileName) => ({
    ...asset,
    id: randomUUID(),
    fileName,
  }));
  const clips = sources.map((a) => ({
    id: randomUUID(),
    assetId: a.id,
    startUs: 0,
    endUs: 2_000_000,
  }));
  const start = vi.fn(
    async (request) => ({ id: randomUUID(), request, state: "queued" }) as ExportJob,
  );
  const plan = vi.fn(async () => ({
    expectedDurationUs: 2_000_000,
    outputPath: "/private/output.mp4",
    changes: [],
    warnings: [],
  }));
  const jobs: ExportJob[] = [];
  const service = new EditorService({
    assets: () => sources,
    fontAvailable: () => false,
    output: () => null,
    plan,
    start: async (request) => {
      const job = await start(request);
      jobs.push(job);
      return job;
    },
    jobs: () => jobs,
    cancel: (id) => {
      jobs.find((j) => j.id === id)!.state = "cancelled";
    },
    preview: async () => "",
    emit: () => {},
  });
  service.update(0, { ...service.draft.request, clips });
  expect(service.draft.operation).toBe("trim");
  service.update(1, service.draft.request, clips[0]!.id, {
    operation: "combine",
    combineClipIds: [clips[3]!.id, clips[1]!.id],
    combineInitialized: true,
  });
  const saved = structuredClone(service.draft.request.clips);
  service.update(2, service.draft.request, clips[2]!.id);
  expect(service.draft.combineClipIds).toEqual([clips[3]!.id, clips[1]!.id]);
  expect(service.draft.request.clips).toEqual(saved);
  expect(() => service.update(2, service.draft.request, null, { combineClipIds: [] })).toThrow(
    "editor changed",
  );
  for (const ids of [[clips[0]!.id], [clips[2]!.id], [clips[3]!.id, clips[1]!.id]]) {
    const result = await service.call("plan_export", {
      revision: service.draft.revision,
      clipIds: ids,
    });
    if (!result.ok) throw Error("Plan failed");
    const accepted = await service.call("start_export", {
      planId: (result.data as { planId: string }).planId,
      requestId: randomUUID(),
    });
    expect(accepted).toMatchObject({ ok: true, data: { state: "queued" } });
  }
  expect(jobs.map((j) => j.request.taskKind)).toEqual(["trim", "trim", "combine"]);
  expect(jobs.map((j) => j.request.clips.map((c) => c.id))).toEqual([
    [clips[0]!.id],
    [clips[2]!.id],
    [clips[3]!.id, clips[1]!.id],
  ]);
  expect(await service.call("cancel_export", { jobId: jobs[1]!.id })).toMatchObject({
    ok: true,
    data: [{ state: "cancelled" }],
  });
  service.update(service.draft.revision, { ...service.draft.request, clips: [clips[0]!] });
  expect(service.draft.operation).toBe("trim");
  expect(service.draft.combineClipIds).toEqual([]);
  expect(jobs[2]!.request.clips).toHaveLength(2);
});
