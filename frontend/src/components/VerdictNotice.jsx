import { Button, Icon, IconButton } from "./ui.jsx";

const TITLES = {
  none: "No clear research gaps in this topic",
  limited: "Few promising gaps in this topic",
};

/**
 * The API's verdict on a map (assessment.verdict: "clear" | "limited" | "none").
 * "none" is a prominent card over the map; "limited" is a compact, dismissible note.
 * Nothing is shown for "clear" or when the backend doesn't send an assessment.
 */
export default function VerdictNotice({ assessment, onTryAnother, onDismiss, variant = "map" }) {
  const verdict = assessment?.verdict;
  if (!verdict || verdict === "clear") return null;

  if (variant === "inline") {
    // Short version for the top of the gap list.
    return (
      <p className={`verdict-inline verdict-inline-${verdict}`}>
        <Icon name="alert" />
        <span>
          {verdict === "none"
            ? "None of these gaps is a strong lead."
            : `Only ${assessment.strong_gaps} of ${assessment.total_gaps} gaps ${assessment.strong_gaps === 1 ? "is" : "are"} promising.`}
        </span>
      </p>
    );
  }

  return (
    <div className={`verdict float verdict-${verdict}`} role="status">
      <Icon name="alert" className="verdict-icon" />
      <div className="verdict-body">
        <p className="verdict-title">{TITLES[verdict]}</p>
        <p className="verdict-text">{assessment.message}</p>
        {verdict === "none" && onTryAnother && (
          <div className="verdict-actions">
            <Button variant="primary" size="sm" onClick={onTryAnother}>Try another topic</Button>
            {onDismiss && <Button variant="subtle" size="sm" onClick={onDismiss}>Explore the map anyway</Button>}
          </div>
        )}
      </div>
      {verdict === "limited" && onDismiss && (
        <IconButton icon="close" label="Dismiss" className="verdict-close" onClick={onDismiss} />
      )}
    </div>
  );
}
