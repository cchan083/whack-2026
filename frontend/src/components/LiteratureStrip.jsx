import { GOLDILOCKS, SATURATED_ABOVE } from "../lib/score.js";

const MIN = 1;
const MAX = 20000;
const pos = (n) => (Math.log10(Math.min(MAX, Math.max(MIN, n))) / Math.log10(MAX)) * 100;

function zone(count) {
  if (count == null) return "not checked";
  if (count === 0) return "none yet";
  if (count < GOLDILOCKS.low) return "emerging";
  if (count <= GOLDILOCKS.high) return "Goldilocks zone";
  if (count <= SATURATED_ABOVE) return "established";
  return "saturated";
}

/**
 * "Papers on both" on a log scale (1 to 20,000) with the Goldilocks band shaded.
 * Text always states the count and zone, so the strip itself is decorative.
 */
export default function LiteratureStrip({ count, compact = false }) {
  const label = count == null ? "Not checked" : count.toLocaleString();
  return (
    <div className={`lit ${compact ? "lit-compact" : ""}`}>
      <div className="lit-strip" aria-hidden="true">
        <span
          className="lit-band"
          style={{ left: `${pos(GOLDILOCKS.low)}%`, width: `${pos(GOLDILOCKS.high) - pos(GOLDILOCKS.low)}%` }}
        />
        <span className="lit-saturated" style={{ left: `${pos(SATURATED_ABOVE)}%` }} />
        {count != null && <span className="lit-marker" style={{ left: `${count === 0 ? 0 : pos(count)}%` }} />}
      </div>
      <span className="lit-text">
        <span className="num">{label}</span>
        <span className="lit-zone">{zone(count)}</span>
      </span>
      {!compact && (
        <div className="lit-scale num" aria-hidden="true">
          <span style={{ left: 0 }}>1</span>
          <span style={{ left: `${pos(GOLDILOCKS.low)}%` }}>{GOLDILOCKS.low}</span>
          <span style={{ left: `${pos(GOLDILOCKS.high)}%` }}>{GOLDILOCKS.high}</span>
          <span style={{ left: `${pos(SATURATED_ABOVE)}%` }}>{SATURATED_ABOVE}</span>
          <span style={{ left: "100%" }}>20k</span>
        </div>
      )}
    </div>
  );
}
