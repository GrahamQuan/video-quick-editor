import { randomUUID } from "node:crypto";
import {
  exportRequestSchema,
  type ExportJob,
  type ExportRequest,
} from "@video-quick-editor/shared";

/** Admission and execution are independently serialized: editing never waits for encoding. */
export class ExportQueue<Snapshot> {
  readonly jobs: ExportJob[] = [];
  private admissions = Promise.resolve();
  private execution = Promise.resolve();
  private requests = new Map<string, { fingerprint: string; result: Promise<ExportJob> }>();
  private controllers = new Map<string, AbortController>();
  private sequence = 0;
  private pendingAdmissions = 0;
  get hasUnfinished(): boolean {
    return this.pendingAdmissions > 0 || this.controllers.size > 0;
  }
  private closing = false;
  constructor(
    private deps: {
      accept: (
        request: ExportRequest,
        createdAt: Date,
      ) => Promise<{ snapshot: Snapshot; outputName: string; clipNames: string[] }>;
      execute: (
        snapshot: Snapshot,
        signal: AbortSignal,
        update: (value: Partial<ExportJob>) => void,
      ) => Promise<string>;
      finish?: (snapshot: Snapshot, job: ExportJob) => void;
      emit: () => void;
    },
  ) {}

  start(raw: unknown): Promise<ExportJob> {
    const request = exportRequestSchema.parse(raw);
    if (!request.modeWasManuallySelected)
      request.mode = request.clips.length === 1 ? "accurate" : "normalize";
    request.taskKind ??= request.clips.length === 1 ? "trim" : "combine";
    const fingerprint = JSON.stringify(request);
    const previous = request.requestId ? this.requests.get(request.requestId) : undefined;
    if (previous) {
      if (previous.fingerprint !== fingerprint)
        return Promise.reject(new Error("INVALID_ARGUMENT: requestId already used"));
      return previous.result.then((job) =>
        structuredClone(this.jobs.find((j) => j.id === job.id) ?? job),
      );
    }
    this.pendingAdmissions++;
    const result = this.admissions.then(async () => {
      if (this.closing) throw new Error("Application is closing");
      const createdAt = new Date();
      const accepted = await this.deps.accept(structuredClone(request), createdAt);
      const job: ExportJob = {
        id: randomUUID(),
        request,
        state: "queued",
        progress: null,
        phase: "等待中",
        resultPath: null,
        error: null,
        diagnostics: [],
        createdAt: createdAt.toISOString(),
        updatedAt: createdAt.toISOString(),
        queueSequence: ++this.sequence,
        outputName: accepted.outputName,
        clipNames: accepted.clipNames,
      };
      const controller = new AbortController();
      this.controllers.set(job.id, controller);
      this.jobs.push(job);
      this.deps.emit();
      const run = async () => {
        if (job.state === "cancelled") {
          this.deps.finish?.(accepted.snapshot, job);
          return;
        }
        this.update(job, { state: "validating", phase: "校验任务" });
        try {
          const resultPath = await this.deps.execute(
            accepted.snapshot,
            controller.signal,
            (value) => {
              if (job.state === "cancelling") return;
              this.update(job, value);
            },
          );
          // Publication is authoritative if cancellation raced with successful publication.
          this.update(job, {
            state: "completed",
            phase: "导出完成",
            progress: 1,
            resultPath,
            outputName: resultPath.split(/[\\/]/u).at(-1),
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.update(
            job,
            controller.signal.aborted
              ? { state: "cancelled", phase: "已中断", progress: null }
              : {
                  state: "failed",
                  phase: "导出失败",
                  error: message,
                  diagnostics: [message],
                  progress: null,
                },
          );
        } finally {
          this.controllers.delete(job.id);
          this.deps.finish?.(accepted.snapshot, job);
        }
      };
      this.execution = this.execution.then(run, run);
      return structuredClone(job);
    });
    this.admissions = result.then(
      () => {
        this.pendingAdmissions--;
      },
      () => {
        this.pendingAdmissions--;
      },
    );
    if (request.requestId) this.requests.set(request.requestId, { fingerprint, result });
    return result;
  }
  cancel(id: string): void {
    const job = this.jobs.find((j) => j.id === id);
    if (!job) throw new Error("Unknown job");
    const controller = this.controllers.get(id);
    if (!controller) return;
    controller.abort();
    if (job.state === "queued") {
      this.controllers.delete(id);
      this.update(job, { state: "cancelled", phase: "已中断", progress: null });
    } else if (job.state !== "cancelling") {
      this.update(job, { state: "cancelling", phase: "正在中断并清理半成品" });
    }
  }
  async close(): Promise<void> {
    this.closing = true;
    await this.admissions;
    for (const id of this.controllers.keys()) this.cancel(id);
    await this.execution;
  }
  async idle(): Promise<void> {
    await this.admissions;
    await this.execution;
  }
  private update(job: ExportJob, value: Partial<ExportJob>) {
    Object.assign(job, value, { updatedAt: new Date().toISOString() });
    this.deps.emit();
  }
}
