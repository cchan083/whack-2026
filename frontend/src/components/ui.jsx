import { useEffect, useId, useRef } from "react";

/* Small shared primitives. Styles live in styles.css under "Primitives". */

// --- Icons (inline SVG, 16px, stroke = currentColor) -----------------------

const PATHS = {
  chevronDown: "M4 6l4 4 4-4",
  search: "M7 12.5a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11zM11 11l3.5 3.5",
  sliders: "M2 4h7M12 4h2M2 12h2M7 12h7M9 2.5v3M5 10.5v3",
  plus: "M8 3v10M3 8h10",
  minus: "M3 8h10",
  reset: "M2.5 6V2.5H6M13.5 10v3.5H10M2.5 2.5l4 4M13.5 13.5l-4-4M13.5 6V2.5H10M2.5 10v3.5H6",
  close: "M4 4l8 8M12 4l-8 8",
  external: "M9 2.5h4.5V7M13.5 2.5L7.5 8.5M11.5 9.5v3a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3",
  copy: "M5.5 5.5v-2a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-2M3.5 5.5h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-6a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1z",
  bookmark: "M4 2.5h8v11L8 10.5l-4 3z",
  keyboard: "M1.5 4h13v8h-13zM4 6.5h1M7 6.5h1M10 6.5h1M5 9.5h6",
  panelRight: "M2 2.5h12v11H2zM10 2.5v11",
  table: "M2 3h12v10H2zM2 6.5h12M2 10h12M6 3v10",
  link: "M6.5 9.5l3-3M7 4.5l1-1a2.5 2.5 0 0 1 3.5 3.5l-1 1M9 11.5l-1 1A2.5 2.5 0 0 1 4.5 9l1-1",
  check: "M3 8.5l3 3 7-7",
  layers: "M8 2l6 3-6 3-6-3zM2 8l6 3 6-3M2 11l6 3 6-3",
  trash: "M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.5 9h6l.5-9",
  alert: "M8 2l6.5 11.5h-13zM8 6.5v3M8 11.5v.01",
};

export function Icon({ name, size = 16, className }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

/** Gap star glyph (matches the map marker). */
export function StarGlyph({ size = 12, className }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M8 1l2.1 4.6 5 .5-3.8 3.4 1.1 5L8 12l-4.4 2.5 1.1-5L.9 6.1l5-.5z" />
    </svg>
  );
}

// --- Buttons ---------------------------------------------------------------

/** variant: "primary" | "ghost" | "subtle". */
export function Button({ variant = "ghost", size = "md", icon, children, className = "", ...props }) {
  return (
    <button type="button" className={`btn btn-${variant} btn-${size} ${className}`} {...props}>
      {icon && <Icon name={icon} />}
      {children}
    </button>
  );
}

/** Square icon-only button. `label` is required: it becomes the accessible name and tooltip. */
export function IconButton({ icon, label, className = "", children, ...props }) {
  return (
    <button type="button" className={`btn btn-icon ${className}`} aria-label={label} title={label} {...props}>
      {icon ? <Icon name={icon} /> : children}
    </button>
  );
}

// --- Pills -----------------------------------------------------------------

export function Pill({ children, className = "", ...props }) {
  return (
    <span className={`pill ${className}`} {...props}>
      {children}
    </span>
  );
}

const STATUS = {
  promoted: { label: "Promoted", glyph: "↑" },
  demoted: { label: "Demoted", glyph: "↓" },
  rejected: { label: "Rejected", glyph: "↓" },
  neutral: { label: "Neutral", glyph: "–" },
  needs_review: { label: "Needs review", glyph: "!" },
};

/** Ranking status with an icon and text, so it never relies on colour. `compact` shows the icon only (with an accessible name). */
export function StatusPill({ status, compact = false }) {
  if (!status) return null;
  const s = STATUS[status] ?? { label: status, glyph: "·" };
  return (
    <span className={`status status-${status} ${compact ? "status-compact" : ""}`} title={compact ? s.label : undefined}>
      <span className="status-glyph" aria-hidden="true">{s.glyph}</span>
      {compact ? <span className="visually-hidden">{s.label}</span> : s.label}
    </span>
  );
}
export const statusLabel = (status) => STATUS[status]?.label ?? status;

// --- Layout bits -----------------------------------------------------------

export function Card({ as: Tag = "section", raised = false, className = "", ...props }) {
  return <Tag className={`card ${raised ? "card-raised" : ""} ${className}`} {...props} />;
}

export function Kbd({ children }) {
  return <kbd className="kbd">{children}</kbd>;
}

export function Skeleton({ className = "", style }) {
  return <div className={`skeleton ${className}`} style={style} aria-hidden="true" />;
}

/** A checkbox styled as a switch. Keeps native checkbox semantics plus role="switch". */
export function Switch({ checked, onChange, children }) {
  return (
    <label className="switch">
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch-track" aria-hidden="true">
        <span className="switch-thumb" />
      </span>
      <span className="switch-label">{children}</span>
    </label>
  );
}

// --- Popover ---------------------------------------------------------------

/**
 * Non-modal popover anchored to its trigger button.
 * Closes on Escape (focus returns to the trigger) and on clicks outside.
 */
export function Popover({ open, onOpenChange, trigger, children, align = "start", className = "", label }) {
  const id = useId();
  const root = useRef(null);
  const button = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => root.current && !root.current.contains(e.target) && onOpenChange(false);
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onOpenChange(false);
        button.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onDown);
    root.current?.addEventListener("keydown", onKey);
    const node = root.current;
    return () => {
      document.removeEventListener("pointerdown", onDown);
      node?.removeEventListener("keydown", onKey);
    };
  }, [open, onOpenChange]);

  return (
    <div className={`popover-root ${className}`} ref={root}>
      {trigger({
        ref: button,
        "aria-expanded": open,
        "aria-controls": id,
        onClick: () => onOpenChange(!open),
      })}
      <div id={id} className={`popover popover-${align}`} hidden={!open} role="group" aria-label={label}>
        {children}
      </div>
    </div>
  );
}

// --- Modal dialog / drawer (native <dialog>: focus trap, Esc, inert page) ---

export function Dialog({ open, onClose, title, variant = "modal", children, className = "", headerExtra }) {
  const ref = useRef(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={`dialog dialog-${variant} ${className}`}
      aria-labelledby={titleId}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => e.target === ref.current && onClose()} // click on the backdrop
    >
      {open && (
        <div className="dialog-body">
          <header className="dialog-header">
            <h2 id={titleId}>{title}</h2>
            {headerExtra}
            <IconButton icon="close" label="Close" onClick={onClose} />
          </header>
          {children}
        </div>
      )}
    </dialog>
  );
}
