import Markdown from "react-markdown";
import { shortName } from "../theme.js";

// Open paper links in a new tab so the map stays open.
const markdownParts = {
  a: ({ node, ...props }) => <a {...props} target="_blank" rel="noreferrer" />,
};

/** Side panel: gap picker, the two topics, score and the dissertation idea. */
export default function GapDetail({ gaps, clustersById, selected, onSelect, colours }) {
  const gap = gaps[selected];
  const labelA = clustersById[gap.cluster_a]?.label;
  const labelB = clustersById[gap.cluster_b]?.label;

  return (
    <section className="card gap-detail" aria-labelledby="gap-heading">
      <h2 id="gap-heading" className="visually-hidden">Selected research gap</h2>
      <div className="field">
        <label htmlFor="gap-select">Research gap (ranked by score)</label>
        <select id="gap-select" value={selected} onChange={(e) => onSelect(Number(e.target.value))}>
          {gaps.map((g, i) => (
            <option key={g.id} value={i}>
              #{g.rank} {shortName(clustersById[g.cluster_a]?.label)} ↔ {shortName(clustersById[g.cluster_b]?.label)}
            </option>
          ))}
        </select>
      </div>

      {/* Coloured dots match the map; the text itself stays in normal ink. */}
      <ul className="topic-pair">
        <li><span className="dot" style={{ background: colours.a }} aria-hidden="true" /><strong>Topic A:</strong> {labelA}</li>
        <li><span className="dot" style={{ background: colours.b }} aria-hidden="true" /><strong>Topic B:</strong> {labelB}</li>
      </ul>

      <div className="score">
        <div className="score-track" aria-hidden="true">
          <div className="score-fill" style={{ width: `${Math.min(gap.score, 1) * 100}%` }} />
        </div>
        <p><strong>Gap score {gap.score.toFixed(2)}</strong> <span className="hint">related topics × empty space between them</span></p>
      </div>

      <div className="proposal" aria-live="polite">
        <Markdown components={markdownParts}>{gap.proposal || "_No proposal written yet._"}</Markdown>
      </div>
    </section>
  );
}
