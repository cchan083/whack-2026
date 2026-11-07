const STATUS_NAMES = { promoted: "Promoted", neutral: "Neutral", demoted: "Demoted", needs_review: "Review" };

/** Every gap in a table: the accessible, colour-free view of the map's stars. */
export default function GapTable({ gaps, clustersById, selected, onSelect }) {
  const bestScore = Math.max(...gaps.map((g) => g.score), 1e-9); // bars are relative to the best gap
  return (
    <section className="card">
      <h2>All gaps</h2>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th scope="col">Rank</th>
              <th scope="col">Topic A</th>
              <th scope="col">Topic B</th>
              <th scope="col">Score</th>
              <th scope="col">Papers on both</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {gaps.map((g, i) => (
              <tr key={g.id} className={i === selected ? "selected" : undefined}>
                <td>
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => onSelect(i)}
                    aria-pressed={i === selected}
                    aria-label={`Show gap ${g.rank}`}
                  >
                    #{g.rank}
                  </button>
                </td>
                <td>{clustersById[g.cluster_a]?.label}</td>
                <td>{clustersById[g.cluster_b]?.label}</td>
                <td className="score-cell">
                  <span className="mini-track" aria-hidden="true">
                    <span className="mini-fill" style={{ width: `${(g.score / bestScore) * 100}%` }} />
                  </span>
                  {g.score.toFixed(2)}
                </td>
                <td className="score-cell">{g.literature_count != null ? g.literature_count.toLocaleString() : "–"}</td>
                <td>
                  {g.status && <span className={`status status-${g.status}`}>{STATUS_NAMES[g.status] ?? g.status}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
