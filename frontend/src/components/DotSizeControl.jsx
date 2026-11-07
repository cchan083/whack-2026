import { DOT_SCALES } from "../lib/mapStyle.js";

const NAMES = { S: "Small", M: "Medium", L: "Large" };

/** S / M / L segmented control for the map's dot size (a radio group). */
export default function DotSizeControl({ value, onChange }) {
  const keys = Object.keys(DOT_SCALES);
  function onKeyDown(e) {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    e.stopPropagation(); // don't also step through gaps
    const next = keys[(keys.indexOf(value) + step + keys.length) % keys.length];
    onChange(next);
    e.currentTarget.querySelector(`[data-size="${next}"]`)?.focus();
  }
  return (
    <div className="dot-size" role="radiogroup" aria-label="Dot size" onKeyDown={onKeyDown}>
      <span className="dot-size-label" aria-hidden="true">Dots</span>
      {keys.map((k) => (
        <button
          key={k}
          type="button"
          role="radio"
          data-size={k}
          aria-checked={value === k}
          aria-label={NAMES[k]}
          title={`${NAMES[k]} dots`}
          tabIndex={value === k ? 0 : -1}
          className="dot-size-btn"
          onClick={() => onChange(k)}
        >
          {k}
        </button>
      ))}
    </div>
  );
}
