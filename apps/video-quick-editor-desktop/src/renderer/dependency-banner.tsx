import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useStore } from "./store.js";
import { copyFor } from "./i18n.js";
export function DependencyBanner() {
  const { dependencies, settings, setError, setSettings } = useStore();
  const copy = copyFor(settings?.language ?? "en");
  const [checking, setChecking] = useState(false);
  if (dependencies.status === "ready") return null;
  async function choose(tool: "ffmpeg" | "ffprobe") {
    try {
      const path = await window.videoQuickEditor.chooseTool(tool);
      if (path)
        setSettings(await window.videoQuickEditor.updateSettings({ [`${tool}Path`]: path }));
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    }
  }
  async function check() {
    setChecking(true);
    try {
      await window.videoQuickEditor.checkTools();
    } catch (error) {
      setError(String(error));
    } finally {
      setChecking(false);
    }
  }
  return (
    <section className="dependency-banner" role="status" aria-label={copy.dependencyTitle}>
      <strong>
        {dependencies.status === "checking" ? copy.dependencyChecking : copy.dependencyMissing}
      </strong>
      {dependencies.tools
        .filter((tool) => tool.failures.length)
        .map((tool) => (
          <span key={tool.tool}>
            {tool.tool}:{" "}
            {tool.failures.map((failure) => copy.dependencyFailures[failure]).join(" · ")}
            {[...tool.missingEncoders, ...tool.missingFilters].length > 0 &&
              ` (${[...tool.missingEncoders, ...tool.missingFilters].join(", ")})`}
          </span>
        ))}
      <span>{copy.dependencyHint}</span>
      <div>
        <Link to="/settings">{copy.dependencySettings}</Link>
        <button onClick={() => void choose("ffmpeg")}>{copy.dependencyChoose} FFmpeg</button>
        <button onClick={() => void choose("ffprobe")}>{copy.dependencyChoose} ffprobe</button>
        <button disabled={checking} onClick={() => void check()}>
          {copy.dependencyCheck}
        </button>
      </div>
    </section>
  );
}
