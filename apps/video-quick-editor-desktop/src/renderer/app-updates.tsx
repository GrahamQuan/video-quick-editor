import { useEffect, useState } from "react";
import type { AppUpdate } from "@video-quick-editor/shared";
import { useStore } from "./store.js";
import { copyFor } from "./i18n.js";

export function AppUpdateSettings() {
  const copy = copyFor(useStore().settings?.language ?? "en");
  const [state, setState] = useState<AppUpdate | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let mounted = true;
    const receive = (next: AppUpdate) => {
      if (mounted) setState(next);
    };
    const unsubscribe = window.videoQuickEditor.subscribeAppUpdate(receive);
    void window.videoQuickEditor
      .getAppUpdate()
      .then(receive)
      .catch(() => {
        if (mounted) setFailed(true);
      });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);
  async function check(include: boolean) {
    setFailed(false);
    try {
      setState(await window.videoQuickEditor.checkAppUpdate(include));
    } catch {
      setFailed(true);
    }
  }
  async function open() {
    setFailed(false);
    try {
      await window.videoQuickEditor.openAppUpdate();
    } catch {
      setFailed(true);
    }
  }
  const busy = !state || state.status === "checking";
  const error =
    state?.error === "rate-limit"
      ? copy.updateRateLimit
      : state?.error === "invalid-response"
        ? copy.updateInvalid
        : copy.updateNetwork;
  return (
    <section
      aria-label={copy.appUpdates}
      className="mb-4 rounded-2xl border border-white/10 bg-panel p-7 text-sm text-slate-300"
    >
      <h2 className="m-0 text-base font-bold text-white">{copy.appUpdates}</h2>
      <p>
        {copy.currentVersion}: <span className="font-mono">{state?.currentVersion ?? "…"}</span>
      </p>
      <label className="mb-4 flex items-center gap-2">
        <input
          type="checkbox"
          checked={state?.includePrereleases ?? false}
          disabled={busy}
          onChange={(event) => void check(event.target.checked)}
        />
        {copy.includePrereleases}
      </label>
      <div className="flex flex-wrap gap-3">
        <button
          className="rounded-lg bg-primary px-4 py-2 font-bold text-black disabled:opacity-50"
          disabled={busy}
          onClick={() => void check(state?.includePrereleases ?? false)}
        >
          {state?.status === "checking" ? copy.checkingUpdate : copy.checkUpdate}
        </button>
        {state?.status === "available" && (
          <button
            className="rounded-lg bg-secondary px-4 py-2 text-primary"
            onClick={() => void open()}
          >
            {copy.updateDownload}
          </button>
        )}
      </div>
      <div role="status" className="mt-3 text-primary">
        {state?.status === "available"
          ? `${copy.updateAvailable}: ${state.latestVersion}`
          : state?.status === "current"
            ? copy.updateCurrent
            : ""}
      </div>
      {(failed || state?.status === "error") && (
        <p role="alert" className="text-red-300">
          {failed ? copy.updateOpenFailed : error}
        </p>
      )}
      <p className="mb-0 text-xs leading-relaxed text-slate-400">{copy.updateHint}</p>
    </section>
  );
}
