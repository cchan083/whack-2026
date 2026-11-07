import { useMemo, useState } from "react";
import { StatusPill, statusLabel } from "./ui.jsx";
import LiteratureStrip from "./LiteratureStrip.jsx";

const SORTS = {
  rank: { label: "Rank", key: (g) => g.rank, defaultDir: "asc" },
  score: { label: "Score", key: (g) => g.score, defaultDir: "desc" },
  papers: { label: "Papers on both", key: (g) => g.literature_count ?? -1, defaultDir: "asc" },
};

/** Every gap in a sortable, filterable table: the colour-free view of the map's stars. */
export default function GapTable({ gaps, clustersById, selected, onSelect }) {
  const [sort, setSort] = useState({ by: "rank", dir: "asc" });
  const [status, setStatus] = useState("all");
  const best = Math.max(...gaps.map((g) => g.score), 1e-9);
  const statuses = [...new Set(gaps.map((g) => g.status).filter(Boolean))];

  const rows = useMemo(() => {
    const list = gaps.map((g, i) => ({ g, i })).filter(({ g }) => status === "all" || g.status === status);
    const key = SORTS[sort.by].key;
    const sign = sort.dir === "asc" ? 1 : -1;
    return list.sort((x, y) => sign * (key(x.g) - key(y.g)) || x.g.rank - y.g.rank);
  }, [gaps, sort, status]);

  function toggleSort(by) {
    setSort((s) => (s.by === by ? { by, dir: s.dir === "asc" ? "desc" : "asc" } : { by, dir: SORTS[by].defaultDir }));
  }

  const SortHeader = ({ by }) => {
    const active = sort.by === by;
    return (
      <th scope="col" aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
        <button type="button" className="th-sort" onClick={() => toggleSort(by)}>
          {SORTS[by].label}
          <span aria-hidden="true" className="sort-glyph">{active ? (sort.dir === "asc" ? "▲" : "▼") : "↕"}</span>
        </button>
      </th>
    );
  };

  return (
    <div className="gap-table">
      <div className="table-tools" role="group" aria-label="Filter by status">
        <span className="muted">Status</span>
        {["all", ...statuses].map((s) => (
          <button
            key={s}
            type="button"
            className="seg-btn"
            aria-pressed={status === s}
            onClick={() => setStatus(s)}
          >
            {s === "all" ? "All" : statusLabel(s)}
            <span className="num muted">{s === "all" ? gaps.length : gaps.filter((g) => g.status === s).length}</span>
          </button>
        ))}
      </div>
      <div className="table-scroll">
        <table>
          <caption className="visually-hidden">All research gaps, {rows.length} shown</caption>
          <thead>
            <tr>
              <SortHeader by="rank" />
              <th scope="col">Topic A</th>
              <th scope="col">Topic B</th>
              <SortHeader by="score" />
              <SortHeader by="papers" />
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ g, i }) => (
              <tr key={g.id} className={i === selected ? "selected" : undefined}>
                <td>
                  <button
                    type="button"
                    className="rank-btn num"
                    onClick={() => onSelect(i)}
                    aria-current={i === selected ? "true" : undefined}
                    aria-label={`Show gap ${g.rank}`}
                  >
                    #{g.rank}
                  </button>
                </td>
                <td><span className="dot dot-a" aria-hidden="true" /> {clustersById[g.cluster_a]?.label}</td>
                <td><span className="dot dot-b" aria-hidden="true" /> {clustersById[g.cluster_b]?.label}</td>
                <td className="score-cell num">
                  <span className="mini-track" aria-hidden="true">
                    <span className="mini-fill" style={{ width: `${(g.score / best) * 100}%` }} />
                  </span>
                  {g.score.toFixed(2)}
                </td>
                <td className="papers-cell">
                  <LiteratureStrip count={g.literature_count} compact />
                </td>
                <td><StatusPill status={g.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
