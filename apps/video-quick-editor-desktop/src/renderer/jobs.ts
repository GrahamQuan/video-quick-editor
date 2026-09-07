import type { ExportJob } from "@video-quick-editor/shared";

const terminalStates = new Set<ExportJob["state"]>(["completed", "failed", "cancelled"]);

export function isTerminalJob(job: ExportJob): boolean {
  return terminalStates.has(job.state);
}

export function jobKind(job: ExportJob): "裁剪" | "组合" {
  return job.request.clips.length > 1 ? "组合" : "裁剪";
}

export function jobStateLabel(job: ExportJob): string {
  if (job.state === "completed") return "已完成";
  if (job.state === "failed") return "失败";
  if (job.state === "cancelled") return "已中断";
  if (job.state === "cancelling") return "正在中断";
  return `正在${jobKind(job)}`;
}

export function formatProgress(progress: number | null): string {
  if (progress === null) return "--";
  const percent = Math.min(100, Math.max(0, progress * 100));
  if (percent === 0 || percent === 100) return `${percent}%`;
  return `${percent.toFixed(1)}%`;
}
