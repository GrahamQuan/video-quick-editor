import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { Language } from "@video-quick-editor/shared";
import { copyFor } from "./i18n.js";

export interface TrimRangeValue {
  startUs: number;
  endUs: number;
}
type Edge = "start" | "end";
export function trimBoundary(
  value: TrimRangeValue,
  edge: Edge,
  atUs: number,
  durationUs: number,
): TrimRangeValue {
  const at = Math.round(atUs);
  return edge === "start"
    ? { ...value, startUs: Math.max(0, Math.min(value.endUs - 1, at)) }
    : { ...value, endUs: Math.min(durationUs, Math.max(value.startUs + 1, at)) };
}
function stamp(us: number): string {
  const seconds = us / 1_000_000;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${(seconds % 60).toFixed(seconds % 1 ? 2 : 0).padStart(seconds % 1 ? 5 : 2, "0")}`;
}
export function TrimRange({
  value,
  durationUs,
  language,
  onPreview,
  onCommit,
  onCancel,
}: {
  value: TrimRangeValue;
  durationUs: number;
  language: Language;
  onPreview: (value: TrimRangeValue, edge: Edge) => void;
  onCommit: (value: TrimRangeValue) => void;
  onCancel: () => void;
}): React.JSX.Element {
  const copy = copyFor(language),
    track = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    pointerId: number;
    edge: Edge;
    initial: TrimRangeValue;
    offset: number;
  } | null>(null);
  const [width, setWidth] = useState(600);
  useEffect(() => {
    const node = track.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const majorUs = (() => {
    const target = durationUs / Math.max(2, Math.floor(width / 90));
    const power = 10 ** Math.floor(Math.log10(Math.max(1, target)));
    return ([1, 2, 5, 10].find((n) => n * power >= target) ?? 10) * power;
  })();
  const minorUs = Math.max(1, majorUs / 5);
  const ticks = Array.from({ length: Math.floor(durationUs / minorUs) + 1 }, (_, i) => ({
    at: i * minorUs,
    major: i % 5 === 0,
  }));
  function atPointer(event: PointerEvent<HTMLButtonElement>): TrimRangeValue | null {
    const active = drag.current,
      rect = track.current?.getBoundingClientRect();
    if (!active || active.pointerId !== event.pointerId || !rect?.width) return null;
    return trimBoundary(
      active.initial,
      active.edge,
      ((event.clientX - active.offset - rect.left) / rect.width) * durationUs,
      durationUs,
    );
  }
  function begin(event: PointerEvent<HTMLButtonElement>, edge: Edge) {
    if (event.button !== 0 || drag.current) return;
    const rect = track.current?.getBoundingClientRect();
    if (!rect) return;
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    const position = edge === "start" ? value.startUs : value.endUs;
    drag.current = {
      pointerId: event.pointerId,
      edge,
      initial: { ...value },
      offset: event.clientX - (rect.left + (position / durationUs) * rect.width),
    };
  }
  function cancel() {
    if (drag.current) {
      drag.current = null;
      onCancel();
    }
  }
  function key(event: KeyboardEvent<HTMLButtonElement>, edge: Edge) {
    if (event.key === "Escape") {
      cancel();
      return;
    }
    const current = edge === "start" ? value.startUs : value.endUs;
    const step = event.shiftKey ? 1_000_000 : 100_000;
    const next = {
      ArrowLeft: current - step,
      ArrowDown: current - step,
      ArrowRight: current + step,
      ArrowUp: current + step,
      Home: 0,
      End: durationUs,
    }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    const range = trimBoundary(value, edge, next, durationUs);
    onPreview(range, edge);
    onCommit(range);
  }
  return (
    <div className="trim-ruler" role="group" aria-label={copy.trimRange}>
      <div className="trim-ruler-track" ref={track} data-testid="trim-ruler-track">
        <svg className="trim-ruler-ticks" width="100%" height="84" aria-hidden="true">
          {ticks.map(({ at, major }) => (
            <g key={at}>
              <line
                x1={`${(at / durationUs) * 100}%`}
                x2={`${(at / durationUs) * 100}%`}
                y1={major ? 27 : 39}
                y2="68"
                className={major ? "major" : "minor"}
              />
              {major && at < durationUs - majorUs * 0.4 && (
                <text
                  x={`${(at / durationUs) * 100}%`}
                  y="15"
                  textAnchor={at === 0 ? "start" : "middle"}
                >
                  {stamp(at)}
                </text>
              )}
            </g>
          ))}
          <text x="100%" y="15" textAnchor="end">
            {stamp(durationUs)}
          </text>
        </svg>
        <div
          className="trim-ruler-selection"
          data-testid="trim-selection"
          style={{
            left: `${(value.startUs / durationUs) * 100}%`,
            width: `${((value.endUs - value.startUs) / durationUs) * 100}%`,
          }}
        />
        {(["start", "end"] as const).map((edge) => {
          const at = edge === "start" ? value.startUs : value.endUs;
          return (
            <button
              key={edge}
              type="button"
              role="slider"
              className={`trim-ruler-handle ${edge}`}
              aria-label={edge === "start" ? copy.startPoint : copy.endPoint}
              aria-orientation="horizontal"
              aria-valuemin={edge === "start" ? 0 : (value.startUs + 1) / 1_000_000}
              aria-valuemax={(edge === "start" ? value.endUs - 1 : durationUs) / 1_000_000}
              aria-valuenow={at / 1_000_000}
              aria-valuetext={stamp(at)}
              title={`${edge === "start" ? copy.startPoint : copy.endPoint} ${stamp(at)}`}
              style={{ left: `${(at / durationUs) * 100}%` }}
              onPointerDown={(e) => begin(e, edge)}
              onPointerMove={(e) => {
                const next = atPointer(e);
                if (next) onPreview(next, edge);
              }}
              onPointerUp={(e) => {
                const next = atPointer(e);
                if (!next) return;
                drag.current = null;
                onPreview(next, edge);
                onCommit(next);
                e.currentTarget.releasePointerCapture(e.pointerId);
              }}
              onPointerCancel={cancel}
              onLostPointerCapture={cancel}
              onKeyDown={(e) => key(e, edge)}
            >
              <span aria-hidden="true" />
            </button>
          );
        })}
      </div>
      <p>{copy.trimRangeHint}</p>
    </div>
  );
}
