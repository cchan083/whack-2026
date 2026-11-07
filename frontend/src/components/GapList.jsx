import { shortName } from "../theme.js";
import { Button, StatusPill } from "./ui.jsx";

/** Ranked list of gaps (the rail). Each row is a button; the selected one has aria-current. */
export default function GapList({ gaps, clustersById, selected, onSelect, onCompare, listRef, onKeyDown, notice }) {
  const best = Math.max(...gaps.map((g) => g.score), 1e-9);
  return (
    <nav className="gap-list" aria-label="Ranked research gaps">
      <div className="panel-head">
        <h2>
          Gaps <span className="num muted">{gaps.length}</span>
        </h2>
        {onCompare && (
          <Button size="sm" variant="subtle" icon="table" onClick={onCompare}>
            Compare all
          </Button>
        )}
      </div>
      {notice}
      <ol className="gap-rows" ref={listRef} onKeyDown={onKeyDown}>
        {gaps.map((g, i) => {
          const a = shortName(clustersById[g.cluster_a]?.label);
          const b = shortName(clustersById[g.cluster_b]?.label);
          const current = i === selected;
          return (
            <li key={g.id}>
              <button
                type="button"
                className="gap-row"
                data-index={i}
                aria-current={current ? "true" : undefined}
                tabIndex={current ? 0 : -1}
                onClick={() => onSelect(i)}
              >
                <span className="gap-rank num" aria-label={`Rank ${g.rank}`}>{g.rank}</span>
                <span className="gap-names">
                  <span className="gap-name">
                    <span className="dot dot-a" aria-hidden="true" />
                    {a}
                  </span>
                  <span className="gap-arrow" aria-hidden="true">↔</span>
                  <span className="visually-hidden"> and </span>
                  <span className="gap-name">
                    <span className="dot dot-b" aria-hidden="true" />
                    {b}
                  </span>
                </span>
                <span className="gap-meta">
                  <span className="mini-track" aria-hidden="true">
                    <span className="mini-fill" style={{ width: `${(g.score / best) * 100}%` }} />
                  </span>
                  <span className="num gap-score">
                    <span className="visually-hidden">score </span>
                    {g.score.toFixed(2)}
                  </span>
                  <StatusPill status={g.status} compact />
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
