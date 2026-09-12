import { expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { ExportQueue } from "./export-queue.js";
import { EditorService } from "./editor-service.js";
import { exportRequestSchema, type ExportRequest } from "@video-quick-editor/shared";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
function request(id: string): ExportRequest {
  const service = new EditorService({} as never);
  return {
    ...service.draft.request,
    requestId: id,
    taskKind: "trim",
    clips: [{ id: randomUUID(), assetId: randomUUID(), startUs: 0, endUs: 1_000_000 }],
  };
}
it("validates explicit type, legacy requests and independent repeated-source clip IDs", () => {
  const trim = request("schema");
  expect(exportRequestSchema.safeParse({ ...trim, taskKind: "combine" }).success).toBe(false);
  const clips = [trim.clips[0]!, { ...trim.clips[0]!, id: randomUUID() }];
  expect(exportRequestSchema.safeParse({ ...trim, clips }).success).toBe(false);
  expect(exportRequestSchema.safeParse({ ...trim, clips, taskKind: "combine" }).success).toBe(true);
  expect(exportRequestSchema.safeParse({ ...trim, clips, taskKind: undefined }).success).toBe(true);
  expect(
    exportRequestSchema.safeParse({ ...trim, clips: [clips[0], clips[0]], taskKind: "combine" })
      .success,
  ).toBe(false);
});
it("serializes the full lifecycle, cancels waiting jobs immediately, freezes snapshots and deduplicates concurrent admission", async () => {
  const gate = deferred();
  const started: string[] = [];
  let active = 0,
    peak = 0;
  const accept = vi.fn(async (r: ExportRequest) => ({
    snapshot: r,
    outputName: "test.mp4",
    clipNames: ["A"],
  }));
  const queue = new ExportQueue({
    accept,
    emit: () => {},
    execute: async (r, signal, update) => {
      active++;
      peak = Math.max(peak, active);
      started.push(r.requestId!);
      update({ state: "verifying" });
      if (r.requestId === "a") await gate.promise;
      active--;
      signal.throwIfAborted();
      return "/test.mp4";
    },
  });
  const a = request("a");
  const [first, same] = await Promise.all([queue.start(a), queue.start(a)]);
  expect(first.id).toBe(same.id);
  expect(accept).toHaveBeenCalledTimes(1);
  const b = await queue.start(request("b"));
  const cInput = request("c");
  const c = await queue.start(cInput);
  cInput.clips[0]!.endUs = 5_000_000;
  expect(queue.jobs.find((j) => j.id === c.id)!.request.clips[0]!.endUs).toBe(1_000_000);
  expect(queue.jobs.find((j) => j.id === b.id)!.state).toBe("queued");
  queue.cancel(b.id);
  queue.cancel(b.id);
  expect(queue.jobs.find((j) => j.id === b.id)!.state).toBe("cancelled");
  queue.cancel(first.id);
  expect(queue.jobs[0]!.state).toBe("cancelling");
  expect(started).toEqual(["a"]);
  gate.resolve();
  await queue.idle();
  expect(started).toEqual(["a", "c"]);
  expect(peak).toBe(1);
  expect(queue.jobs.map((j) => j.state)).toEqual(["cancelled", "cancelled", "completed"]);
  await expect(
    queue.start({ ...a, clips: [{ ...a.clips[0]!, endUs: 2_000_000 }] }),
  ).rejects.toThrow("requestId");
});
it("failed validation creates no record and execution failure does not block FIFO", async () => {
  const order: string[] = [];
  const queue = new ExportQueue({
    emit: () => {},
    accept: async (r) => {
      if (r.requestId === "invalid") throw new Error("TOOLS_UNAVAILABLE");
      return { snapshot: r, outputName: "test.mp4", clipNames: [] };
    },
    execute: async (r) => {
      order.push(r.requestId!);
      if (r.requestId === "fail") throw new Error("Source changed");
      return "/ok.mp4";
    },
  });
  await expect(queue.start(request("invalid"))).rejects.toThrow("TOOLS_UNAVAILABLE");
  expect(queue.jobs).toHaveLength(0);
  await Promise.all([queue.start(request("fail")), queue.start(request("ok"))]);
  await queue.idle();
  expect(order).toEqual(["fail", "ok"]);
  expect(queue.jobs.map((j) => j.state)).toEqual(["failed", "completed"]);
});
it("shutdown waits for active cleanup and prevents queued execution", async () => {
  const cleanup = deferred();
  const began = deferred();
  const execute = vi.fn(async (_r: ExportRequest, signal: AbortSignal) => {
    began.resolve();
    await cleanup.promise;
    signal.throwIfAborted();
    return "/ok.mp4";
  });
  const queue = new ExportQueue({
    emit: () => {},
    accept: async (r) => ({ snapshot: r, outputName: "a", clipNames: [] }),
    execute,
  });
  await queue.start(request("first"));
  await began.promise;
  await queue.start(request("waiting"));
  let closed = false;
  const closing = queue.close().then(() => {
    closed = true;
  });
  await vi.waitFor(() => expect(queue.jobs[1]!.state).toBe("cancelled"));
  expect(closed).toBe(false);
  cleanup.resolve();
  await closing;
  expect(execute).toHaveBeenCalledTimes(1);
  expect(queue.jobs[0]!.state).toBe("cancelled");
  await expect(queue.start(request("late"))).rejects.toThrow("closing");
});
