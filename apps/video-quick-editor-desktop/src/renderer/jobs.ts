import type { ExportJob, Language } from "@video-quick-editor/shared";

const terminalStates = new Set<ExportJob["state"]>(["completed", "failed", "cancelled"]);

export function isTerminalJob(job: ExportJob): boolean {
  return terminalStates.has(job.state);
}

export function jobKind(job: ExportJob, language: Language = "en"): string {
  if (language === "zh-CN") return job.request.clips.length > 1 ? "组合" : "裁剪";
  return job.request.clips.length > 1 ? "Combine" : "Trim";
}

export function jobStateLabel(job: ExportJob, language: Language = "en"): string {
  if (language === "zh-CN") {
    if (job.state === "completed") return "已完成";
    if (job.state === "failed") return "失败";
    if (job.state === "cancelled") return "已中断";
    if (job.state === "cancelling") return "正在中断";
    return `正在${jobKind(job, language)}`;
  }
  if (job.state === "completed") return "Completed";
  if (job.state === "failed") return "Failed";
  if (job.state === "cancelled") return "Cancelled";
  if (job.state === "cancelling") return "Cancelling";
  return `${jobKind(job, language)} in progress`;
}

export function jobPhaseLabel(phase: string, language: Language): string {
  if (language === "zh-CN") return phase;
  const exact: Record<string, string> = {
    "拼接 copy 片段": "Concatenating copy-mode clips",
    精确剪辑并编码: "Trimming and encoding precisely",
    标准化并拼接: "Normalizing and combining",
    验证输出媒体: "Verifying output media",
    发布文件: "Publishing file",
    正在中断并清理半成品: "Cancelling and removing partial output",
  };
  if (exact[phase]) return exact[phase];
  const kind = phase.includes("组合") ? "combine" : "trim";
  if (phase.startsWith("校验")) return `Validating ${kind} job`;
  if (phase.startsWith("准备")) return `Preparing temporary ${kind} resources`;
  if (phase.endsWith("完成")) return `${kind === "combine" ? "Combine" : "Trim"} completed`;
  if (phase.endsWith("已中断")) return `${kind === "combine" ? "Combine" : "Trim"} cancelled`;
  if (phase.endsWith("失败")) return `${kind === "combine" ? "Combine" : "Trim"} failed`;
  return phase;
}

export function formatProgress(progress: number | null): string {
  if (progress === null) return "--";
  const percent = Math.min(100, Math.max(0, progress * 100));
  if (percent === 0 || percent === 100) return `${percent}%`;
  return `${percent.toFixed(1)}%`;
}
