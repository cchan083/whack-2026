import { useCountUp } from "../lib/hooks.js";

function Stat({ label, value, format = (v) => v.toLocaleString() }) {
  const shown = useCountUp(value);
  return (
    <div className="stat">
      <dt>{label}</dt>
      <dd className="num">{shown == null ? "–" : format(shown)}</dd>
    </div>
  );
}

/** Compact stats for the current map. Keeps <dl> semantics and aria-busy while loading. */
export default function StatPills({ data, loading, variant = "pills", playhead = null }) {
  const years = data?.papers.map((p) => p.year) ?? [];
  // While the timeline is scrubbed, Papers reads "212/600".
  const visible = playhead == null ? null : years.filter((y) => y <= playhead).length;
  return (
    <dl className={`stats stats-${variant}`} aria-busy={loading} aria-label="Map statistics">
      {visible == null ? (
        <Stat label="Papers" value={data?.papers.length} />
      ) : (
        <div className="stat">
          <dt>Papers</dt>
          <dd className="num">{visible.toLocaleString()}/{data.papers.length.toLocaleString()}</dd>
        </div>
      )}
      <Stat label="Topics" value={data?.clusters.length} />
      <Stat label="Gaps" value={data?.gaps.length} />
      <div className="stat stat-years">
        <dt className={variant === "text" ? "visually-hidden" : undefined}>Published</dt>
        <dd className="num">{years.length ? `${Math.min(...years)}–${Math.max(...years)}` : "–"}</dd>
      </div>
    </dl>
  );
}
