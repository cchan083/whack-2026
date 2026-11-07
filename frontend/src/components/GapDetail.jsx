import Markdown from "react-markdown";
import { shortName } from "../theme.js";

// Open paper links in a new tab so the map stays open.
const markdownParts = {
  a: ({ node, ...props }) => <a {...props} target="_blank" rel="noreferrer" />,
};

const CATEGORY_NAMES = {
  Problem_Domain: "problem domain",
  Methodological_Tool: "method",
  Unclassified: "unclassified",
};

const STATUS_NAMES = {
  promoted: "Promoted",
  neutral: "Neutral",
  demoted: "Demoted",
  needs_review: "Needs human review",
  rejected: "Rejected",
};

function TopicLine({ name, cluster, colour }) {
  return (
    <li>
      <span className="dot" style={{ background: colour }} aria-hidden="true" />
      <span>
        <strong>{name}:</strong> {cluster?.label}{" "}
        {cluster?.category && <span className="tag">{CATEGORY_NAMES[cluster.category] ?? cluster.category}</span>}
      </span>
    </li>
  );
}

/** Side panel: gap picker, the two topics, score, why it ranks here, and the dissertation idea. */
export default function GapDetail({ gaps, clustersById, selected, onSelect, colours }) {
  const gap = gaps[selected];
  const bestScore = Math.max(...gaps.map((g) => g.score), 1e-9); // bars are relative to the best gap

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
        <TopicLine name="Topic A" cluster={clustersById[gap.cluster_a]} colour={colours.a} />
        <TopicLine name="Topic B" cluster={clustersById[gap.cluster_b]} colour={colours.b} />
      </ul>

      <div className="score">
        <div className="score-track" aria-hidden="true">
          <div className="score-fill" style={{ width: `${(gap.score / bestScore) * 100}%` }} />
        </div>
        <p>
          <strong>Gap score {gap.score.toFixed(2)}</strong>{" "}
          {gap.base_score != null && <span className="hint">(map score {gap.base_score.toFixed(2)} before validation)</span>}
        </p>
      </div>

      {gap.reasons?.length > 0 && (
        <details className="why" open={gap.status === "needs_review"}>
          <summary>
            Why it ranks here{" "}
            {gap.status && <span className={`status status-${gap.status}`}>{STATUS_NAMES[gap.status] ?? gap.status}</span>}
          </summary>
          <ul>
            {gap.reasons.map((reason) => <li key={reason}>{reason}</li>)}
          </ul>
          {gap.literature_count != null && (
            <p className="hint">
              {gap.literature_count.toLocaleString()} arXiv papers already mention both topics.
            </p>
          )}
        </details>
      )}

      <div className="proposal" aria-live="polite">
        <Markdown components={markdownParts}>{gap.proposal || "_No proposal written yet._"}</Markdown>
      </div>
    </section>
  );
}
