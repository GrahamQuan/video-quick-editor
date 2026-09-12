import { useEffect, useRef, useState } from "react";
import { useStore } from "./store.js";
import { copyFor } from "./i18n.js";

export function QueueToasts() {
  const { jobs, settings } = useStore();
  const copy = copyFor(settings?.language ?? "en");
  const seen = useRef<Set<string> | null>(null);
  const [notices, setNotices] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    if (!settings) return;
    if (!seen.current) {
      seen.current = new Set(jobs.map((job) => job.id));
      return;
    }
    const added = jobs.filter((job) => !seen.current!.has(job.id));
    for (const job of jobs) seen.current.add(job.id);
    if (added.length)
      setNotices((previous) => [
        ...previous,
        ...added.map((job) => ({
          id: job.id,
          name: job.outputName ?? job.clipNames?.join(", ") ?? "",
        })),
      ]);
  }, [jobs, settings]);
  return (
    <div className="pointer-events-none fixed bottom-24 right-6 z-50 flex max-w-[min(380px,calc(100vw-48px))] flex-col gap-2">
      {notices.map((notice) => (
        <QueueToast
          key={notice.id}
          name={notice.name}
          label={copy.queuedNotice}
          dismissLabel={copy.dismissNotice}
          dismiss={() => setNotices((items) => items.filter((item) => item.id !== notice.id))}
        />
      ))}
    </div>
  );
}

function QueueToast({
  name,
  label,
  dismissLabel,
  dismiss,
}: {
  name: string;
  label: string;
  dismissLabel: string;
  dismiss: () => void;
}) {
  const dismissRef = useRef(dismiss);
  dismissRef.current = dismiss;
  useEffect(() => {
    const timer = window.setTimeout(() => dismissRef.current(), 3000);
    return () => window.clearTimeout(timer);
  }, []);
  return (
    <div
      data-testid="queue-toast"
      className="pointer-events-auto flex items-center gap-3 rounded-xl border border-primary-border bg-panel p-4 text-sm shadow-xl"
    >
      <span aria-hidden="true" className="text-primary">
        ✓
      </span>
      <div role="status" className="min-w-0">
        <p className="m-0 font-bold text-primary">{label}</p>
        <p className="m-0 mt-1 truncate text-xs text-slate-400">{name}</p>
      </div>
      <button
        type="button"
        aria-label={dismissLabel}
        onClick={dismiss}
        className="ml-auto rounded p-2 text-slate-300 hover:bg-secondary focus-visible:outline-primary"
      >
        ×
      </button>
    </div>
  );
}
