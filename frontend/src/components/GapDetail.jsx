import { memo, useEffect, useMemo, useRef } from "react";
import Markdown from "react-markdown";

const arxivIdOf = (href = "") => href.match(/arxiv\.org\/abs\/([^?#]+)/)?.[1] ?? null;

/**
 * Paper links open in a new tab (so the map stays open), show the paper's year,
 * highlight the paper's dot on the map on hover/focus, and are dimmed when the
 * timeline is set to a year before the paper was published.
 */
function paperLinkParts(yearOf, onHoverPaper) {
  return {
    a: ({ node, children, ...props }) => {
      const id = arxivIdOf(props.href);
      const year = id ? yearOf[id] : undefined;
      const hl = id && onHoverPaper ? { onMouseEnter: () => onHoverPaper(id), onMouseLeave: () => onHoverPaper(null),
        onFocus: () => onHoverPaper(id), onBlur: () => onHoverPaper(null) } : {};
      return (
        <span className="paper-link" data-year={year ?? ""}>
          <a {...props} {...hl} target="_blank" rel="noreferrer">{children}</a>
          {year != null && (
            <span className="year-tag num">
              {year}
              <span className="visually-hidden later-note" hidden> (published after the timeline year)</span>
            </span>
          )}
        </span>
      );
    },
  };
}

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
export default function GapDetail({ gaps, clustersById, selected, colours, onHoverPaper, playhead = null, papers = [] }) {
  const gap = gaps[selected];
  const yearOf = useMemo(() => Object.fromEntries(papers.map((p) => [p.arxiv_id, p.year])), [papers]);
  const parts = useMemo(() => paperLinkParts(yearOf, onHoverPaper), [yearOf, onHoverPaper]);
  const proposalRef = useRef(null);
  // Dim papers published after the timeline year. Done on the DOM so scrubbing
  // doesn't re-parse the proposal's Markdown on every year change.
  useEffect(() => {
    proposalRef.current?.querySelectorAll(".paper-link").forEach((el) => {
      const later = playhead != null && el.dataset.year !== "" && Number(el.dataset.year) > playhead;
      el.classList.toggle("is-later", later);
      const note = el.querySelector(".later-note");
      if (note) note.hidden = !later;
    });
  }, [playhead, gap, parts]);
  const bestScore = Math.max(...gaps.map((g) => g.score), 1e-9); // bars are relative to the best gap

  return (
    <section className="gap-detail" aria-labelledby="gap-heading">
      <h2 id="gap-heading" className="visually-hidden">Selected research gap</h2>
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

      <div className="proposal" aria-live="polite" ref={proposalRef}>
        <ProposalText text={gap.proposal || "_No proposal written yet._"} parts={parts} />
      </div>
    </section>
  );
}

/** Parsed only when the text or link renderer changes (not on every timeline step). */
const ProposalText = memo(function ProposalText({ text, parts }) {
  return <Markdown components={parts}>{text}</Markdown>;
});
