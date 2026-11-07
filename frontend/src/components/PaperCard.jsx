import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { shortName } from "../theme.js";
import { Icon, IconButton } from "./ui.jsx";

export const arxivUrl = (id) => `https://arxiv.org/abs/${encodeURIComponent(id).replace(/%2F/g, "/")}`;

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const GAP = 14; // px between the clicked dot and the card

/**
 * Small card pinned next to a clicked paper dot: title, year, topic, arXiv id
 * and an "Open on arXiv" link (new tab). Closes on Esc, the close button, or a
 * pointer press anywhere else (which also lets the next dot click open a new card).
 */
export default function PaperCard({ paper, topic, group, x, y, bounds, onClose }) {
  const ref = useRef(null);
  const link = useRef(null);
  const titleId = useId();
  const [pos, setPos] = useState({ left: x + GAP, top: y + GAP });

  // Keep the card inside the map: flip left/up when it would overflow.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !bounds) return;
    const w = el.offsetWidth, h = el.offsetHeight;
    let left = x + GAP, top = y + GAP;
    if (left + w > bounds.width - 8) left = Math.max(8, x - GAP - w);
    if (top + h > bounds.height - 8) top = Math.max(8, y - GAP - h);
    setPos({ left, top });
  }, [x, y, bounds, paper]);

  useEffect(() => {
    link.current?.focus({ preventScroll: true });
    const onKey = (e) => e.key === "Escape" && onClose();
    const onDown = (e) => ref.current && !ref.current.contains(e.target) && onClose();
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown, true);
    };
  }, [paper, onClose]);

  const topicName = paper.cluster_id == null ? "Unclustered" : shortName(topic?.label);
  return (
    <div
      ref={ref}
      className="paper-card"
      role="dialog"
      aria-labelledby={titleId}
      style={{ left: pos.left, top: pos.top }}
    >
      <div className="paper-card-head">
        <p id={titleId} className="paper-card-title">{paper.title}</p>
        <IconButton icon="close" label="Close paper details" className="paper-card-close" onClick={onClose} />
      </div>
      <p className="paper-card-meta">
        <span className="num">{paper.year}</span>
        <span aria-hidden="true">·</span>
        {group && <span className={`dot dot-${group}`} aria-hidden="true" />}
        <span>
          {group ? <b>Topic {group.toUpperCase()}: </b> : null}
          {topicName}
        </span>
      </p>
      <div className="paper-card-actions">
        <a ref={link} className="btn btn-primary btn-sm" href={arxivUrl(paper.arxiv_id)} target="_blank" rel="noreferrer">
          Open on arXiv
          <Icon name="external" size={14} />
          <span className="visually-hidden"> (opens in a new tab)</span>
        </a>
        <span className="paper-card-id num">arXiv:{paper.arxiv_id}</span>
      </div>
      <p className="paper-card-hint">{isMac ? "⌘" : "Ctrl"}-click a dot to open arXiv directly</p>
    </div>
  );
}
