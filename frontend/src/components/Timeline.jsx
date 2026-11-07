import { useEffect, useMemo, useRef, useState } from "react";
import { MS_PER_YEAR, SPEEDS, yearHistogram } from "../lib/timeline.js";
import { isTypingTarget } from "../lib/hooks.js";
import { Icon } from "./ui.jsx";

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * Papers-over-time dock: a histogram of papers per year (stacked by the selected
 * gap's Topic A / Topic B / other / unclustered) with a draggable, playable playhead.
 * playhead = a year (map shows papers up to it) or null ("All time", the default).
 */
export default function Timeline({ papers, pairIds, pairNames, playhead, onChange }) {
  const hist = useMemo(() => yearHistogram(papers, pairIds), [papers, pairIds]);
  const { rows, first, last, total } = hist;
  const n = rows.length;
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  const [hover, setHover] = useState(null); // year under the pointer
  const [announce, setAnnounce] = useState("");
  const track = useRef(null);
  const dock = useRef(null);
  const dragging = useRef(false);
  const playheadRef = useRef(playhead);
  useEffect(() => {
    playheadRef.current = playhead;
  });

  const rowOf = (y) => rows[y - first];
  const shown = playhead == null ? total : rowOf(playhead)?.cumulative ?? total;
  const papersText = (count) => `${count} paper${count === 1 ? "" : "s"}`;
  const describe = (y) => (y == null ? `All time, ${papersText(total)}` : `${y}, ${papersText(rowOf(y)?.cumulative ?? 0)}`);

  /** Move to a year; the last year means "All time" (null). Any manual move pauses. */
  function setYear(y, { pause = true } = {}) {
    if (pause) setPlaying(false);
    const next = y == null || y >= last ? null : clamp(y, first, last);
    playheadRef.current = next;
    onChange(next);
  }

  // Playback: requestAnimationFrame with accumulated time (no setInterval drift).
  // The map only updates when the year changes, so this stays cheap.
  useEffect(() => {
    if (!playing) return;
    let raf;
    let previous = performance.now();
    let acc = 0;
    const per = MS_PER_YEAR / SPEEDS[speed];
    const tick = (now) => {
      acc += now - previous;
      previous = now;
      if (acc >= per) {
        const steps = Math.floor(acc / per);
        acc -= steps * per;
        const y = (playheadRef.current ?? first) + steps;
        if (y >= last) {
          setYear(null);
          setAnnounce(`Reached ${last}: all ${total} papers shown.`);
          return;
        }
        playheadRef.current = y;
        onChange(y);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed]); // eslint-disable-line react-hooks/exhaustive-deps

  function togglePlay() {
    if (playing) {
      setPlaying(false);
      setAnnounce(`Paused at ${describe(playheadRef.current)}.`);
      return;
    }
    if (playheadRef.current == null || playheadRef.current >= last) setYear(first, { pause: false });
    setPlaying(true);
  }

  // Pointer: drag the playhead or click to jump (touch works: touch-action none).
  const yearAt = (clientX) => {
    const r = track.current.getBoundingClientRect();
    return first + clamp(Math.floor(((clientX - r.left) / r.width) * n), 0, n - 1);
  };
  function onPointerDown(e) {
    if (e.button !== 0) return;
    dragging.current = true;
    track.current.setPointerCapture(e.pointerId);
    track.current.focus({ preventScroll: true });
    setYear(yearAt(e.clientX));
  }
  function onPointerMove(e) {
    const y = yearAt(e.clientX);
    setHover(y);
    if (dragging.current && y !== playheadRef.current) setYear(y);
  }
  function onPointerUp(e) {
    dragging.current = false;
    track.current.releasePointerCapture?.(e.pointerId);
  }

  function onKeyDown(e) {
    const current = playheadRef.current ?? last;
    const big = e.shiftKey ? 5 : 1;
    const moves = {
      ArrowLeft: current - big, ArrowDown: current - big, ArrowRight: current + big, ArrowUp: current + big,
      PageDown: current - 5, PageUp: current + 5, Home: first, End: last,
    };
    if (e.key === " " || e.key === "Spacebar") {
      togglePlay();
    } else if (e.key in moves) {
      setYear(moves[e.key]);
    } else return;
    e.preventDefault();
    e.stopPropagation(); // never also step through gaps
  }

  // Horizontal wheel / trackpad (or Shift+wheel) over the dock scrubs by year.
  useEffect(() => {
    const el = dock.current;
    if (!el) return;
    let acc = 0;
    const onWheel = (e) => {
      const horizontal = Math.abs(e.deltaX) > Math.abs(e.deltaY);
      if (!horizontal && !e.shiftKey) return;
      e.preventDefault();
      acc += horizontal ? e.deltaX : e.deltaY;
      const steps = Math.trunc(acc / 40);
      if (!steps) return;
      acc -= steps * 40;
      setYear((playheadRef.current ?? last) + steps);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }); // re-bind each render: cheap, and always sees fresh values

  // Keep bottom-anchored map overlays above the dock: --map-bottom = dock height + gap.
  useEffect(() => {
    const el = dock.current;
    const host = el?.parentElement;
    if (!el || !host) return;
    const observer = new ResizeObserver(() => {
      // Distance from the dock's top edge to the bottom of the map area, plus a 12px gap.
      host.style.setProperty("--map-bottom", `${host.clientHeight - el.offsetTop + 12}px`);
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      host.style.removeProperty("--map-bottom");
    };
  }, []);

  // "t" focuses the timeline from anywhere (expanding it if needed).
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "t" || e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return;
      if (document.querySelector("dialog[open]")) return;
      e.preventDefault();
      if (track.current) track.current.focus();
      else {
        setCollapsed(false);
        requestAnimationFrame(() => track.current?.focus());
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (n === 0) return null;

  // Bars: sqrt scale so sparse early years stay visible; stacked by group.
  const maxCount = Math.max(...rows.map((r) => r.total), 1);
  const H = 100;
  const index = playhead == null ? n - 1 : playhead - first;
  const pct = (i) => ((i + 0.5) / n) * 100;
  const step = n <= 12 ? 2 : n <= 30 ? 5 : 10;
  const ticks = rows.filter((r) => r.year % step === 0 || r.year === first).map((r) => r.year);
  const tipRow = hover != null ? rowOf(hover) : null;
  const groups = pairIds
    ? [["a", "tl-a"], ["b", "tl-b"], ["other", "tl-other"], ["noise", "tl-noise"]]
    : [["total", "tl-other"]];
  const yearThis = playhead == null ? null : rowOf(playhead)?.total ?? 0;
  const note = `Map shows papers published up to ${playhead ?? last}. Gap scores are computed on the full dataset.`;

  return (
    <div
      ref={dock}
      className={`timeline floating-surface ${collapsed ? "is-collapsed" : ""}`}
      role="group"
      aria-label="Papers over time"
    >
      <div className="tl-top">
        <button
          type="button"
          className="btn btn-icon tl-play"
          aria-label={playing ? "Pause timeline" : "Play timeline"}
          onClick={togglePlay}
        >
          {playing ? <PauseGlyph /> : <PlayGlyph />}
        </button>
        <span className="tl-year num" aria-hidden="true">{playhead ?? "All time"}</span>
        <span className="tl-readout num" aria-hidden="true">
          {shown.toLocaleString()} / {total.toLocaleString()} papers
          {yearThis != null && <span className="tl-plus"> · +{yearThis} in {playhead}</span>}
        </span>
        <span className="tl-spacer" />
        {pairIds && !collapsed && (
          <span className="tl-key" aria-hidden="true">
            <i className="tl-a" /> A <i className="tl-b" /> B <i className="tl-other" /> other
          </span>
        )}
        <button
          type="button"
          className="btn btn-subtle btn-sm tl-speed num"
          aria-label={`Playback speed ${SPEEDS[speed]}×`}
          onClick={() => setSpeed((s) => (s + 1) % SPEEDS.length)}
        >
          {SPEEDS[speed]}×
        </button>
        <button
          type="button"
          className="btn btn-subtle btn-sm tl-all"
          onClick={() => setYear(null)}
          disabled={playhead == null}
        >
          All time
        </button>
        <span className="tl-info" tabIndex={0} title={note} aria-label={note} role="note">
          <Icon name="info" />
        </span>
        <button
          type="button"
          className="btn btn-icon tl-collapse"
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Show timeline" : "Hide timeline"}
          onClick={() => setCollapsed((c) => !c)}
        >
          <Icon name="chevronDown" />
        </button>
      </div>

      {!collapsed && (
        <>
          <div
            ref={track}
            className="tl-track"
            role="slider"
            tabIndex={0}
            aria-label="Show papers published up to year"
            aria-valuemin={first}
            aria-valuemax={last}
            aria-valuenow={playhead ?? last}
            aria-valuetext={describe(playhead)}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onPointerLeave={() => setHover(null)}
            onKeyDown={onKeyDown}
          >
            <svg className="tl-bars" viewBox={`0 0 ${n} ${H}`} preserveAspectRatio="none" aria-hidden="true">
              {rows.map((r, i) => {
                const height = (Math.sqrt(r.total) / Math.sqrt(maxCount)) * (H - 4);
                let y = H;
                const future = playhead != null && r.year > playhead;
                return (
                  <g key={r.year} className={future ? "tl-future" : undefined}>
                    {groups.map(([key, cls]) => {
                      const part = r.total ? (r[key] / r.total) * height : 0;
                      y -= part;
                      return part > 0 ? <rect key={key} className={cls} x={i + 0.14} width={0.72} y={y} height={part} /> : null;
                    })}
                  </g>
                );
              })}
              <polyline
                className="tl-cumulative"
                vectorEffect="non-scaling-stroke"
                points={rows.map((r, i) => `${i + 0.5},${H - (r.cumulative / total) * (H - 4)}`).join(" ")}
              />
            </svg>
            <span className={`tl-head ${playhead == null ? "is-all" : ""}`} style={{ left: `${pct(index)}%` }} aria-hidden="true">
              <span className="tl-grab" />
            </span>
            {tipRow && (
              <span className="tl-tip num" style={{ left: `${pct(hover - first)}%` }} aria-hidden="true">
                {tipRow.year}: {tipRow.total} paper{tipRow.total === 1 ? "" : "s"}
                {pairIds && ` (A ${tipRow.a}, B ${tipRow.b})`}
              </span>
            )}
          </div>
          <div className="tl-ticks num" aria-hidden="true">
            {ticks.map((y) => (
              <span key={y} style={{ left: `${pct(y - first)}%` }}>{y}</span>
            ))}
          </div>
        </>
      )}
      <span className="visually-hidden" role="status">{announce}</span>
      {pairNames && <span className="visually-hidden">Bars are split into {pairNames}.</span>}
    </div>
  );
}

const PlayGlyph = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M4 2.5v11l9-5.5z" /></svg>
);
const PauseGlyph = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M3.5 2.5h3v11h-3zM9.5 2.5h3v11h-3z" /></svg>
);
