import { forwardRef, useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon, Popover } from "./ui.jsx";

const PAPER_OPTIONS = [300, 600, 1000, 1500];
const DEFAULT_PAPERS = 600;

/** Build stage from the server's real progress fraction (see pipeline/run.py run_topic). */
function stageOf(job) {
  const f = job?.progress ?? 0;
  if (f < 0.6) return { n: 1, label: "Downloading papers" };
  if (f < 0.8) return { n: 2, label: "Mapping" };
  return { n: 3, label: "Literature check" };
}

const clock = (seconds) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

/**
 * Search form for the floating island. Same fields and validation as before:
 * topic (required, max 100 chars), arXiv category and paper count (in a Filters
 * popover). Focusing the input lists mapped topics that match (Enter opens one;
 * otherwise Enter builds a new map). While building, the island shows the stage,
 * elapsed time and the server's progress. `collapsible` shows only a search icon
 * until the user opens it.
 */
const TopicSearch = forwardRef(function TopicSearch(
  { categories, job, onBuild, topics, onOpenTopic, anchorRef, collapsible = false },
  ref,
) {
  const busy = Boolean(job);
  const [topic, setTopic] = useState("");
  const [category, setCategory] = useState("");
  const [maxPapers, setMaxPapers] = useState(DEFAULT_PAPERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [expanded, setExpanded] = useState(false);
  const input = useRef(null);
  const form = useRef(null);
  const listId = useId();

  useImperativeHandle(ref, () => ({
    focus() {
      // Visible input: focus now, so no keystrokes are lost. Collapsed: expand, then focus.
      if (input.current?.offsetParent) input.current.focus();
      else {
        setExpanded(true);
        requestAnimationFrame(() => input.current?.focus());
      }
    },
  }));

  const matches = useMemo(() => {
    const q = topic.trim().toLowerCase();
    const list = q ? topics.filter((t) => t.name.toLowerCase().includes(q)) : topics;
    return list.slice(0, 8);
  }, [topics, topic]);

  useEffect(() => setActive(-1), [topic]);

  function close() {
    setListOpen(false);
    setActive(-1);
  }

  function openExisting(field) {
    close();
    setTopic("");
    input.current?.blur();
    setExpanded(false);
    onOpenTopic(field);
  }

  function handleSubmit(event) {
    event.preventDefault(); // stop the browser reloading the page
    if (listOpen && active >= 0 && matches[active]) {
      openExisting(matches[active].field);
      return;
    }
    if (!topic.trim()) return;
    setFiltersOpen(false);
    close();
    input.current?.blur();
    onBuild(topic.trim(), category, maxPapers);
  }

  function onKeyDown(e) {
    if (e.key === "Escape") {
      close();
      input.current?.blur();
      setExpanded(false);
      e.preventDefault();
      return;
    }
    if (!listOpen || matches.length === 0) return;
    if (e.key === "Enter" && active >= 0) {
      // Open the highlighted mapped topic (before form validation, which needs text).
      e.preventDefault();
      openExisting(matches[active].field);
      return;
    }
    if (e.key === "ArrowDown") setActive((i) => Math.min(matches.length - 1, i + 1));
    else if (e.key === "ArrowUp") setActive((i) => Math.max(-1, i - 1));
    else return;
    e.preventDefault();
    e.stopPropagation();
  }

  // Collapse again when focus leaves the whole form (and nothing was typed).
  function onBlur(e) {
    if (form.current?.contains(e.relatedTarget)) return;
    close();
    if (!topic.trim()) setExpanded(false);
  }

  const activeFilters = [category, maxPapers !== DEFAULT_PAPERS && `${maxPapers.toLocaleString()} papers`].filter(Boolean);
  const stage = stageOf(job);
  const collapsed = collapsible && !expanded && !busy;

  return (
    <form
      ref={form}
      role="search"
      aria-label="Map a new topic"
      className={`cmdbar ${collapsed ? "is-collapsed" : ""} ${busy ? "is-building" : ""}`}
      onSubmit={handleSubmit}
      onBlur={onBlur}
    >
      <fieldset disabled={busy}>
        {collapsed && (
          <button
            type="button"
            className="btn btn-icon cmdbar-expand"
            aria-label="Map a topic"
            aria-expanded="false"
            onClick={() => {
              setExpanded(true);
              requestAnimationFrame(() => input.current?.focus());
            }}
          >
            <Icon name="search" />
          </button>
        )}
        <div className="cmdbar-field" hidden={collapsed || busy}>
          <label htmlFor="topic" className="visually-hidden">Map any research topic</label>
          <Icon name="search" className="cmdbar-icon" />
          <input
            ref={input}
            id="topic"
            type="text"
            value={topic}
            onChange={(e) => {
              setTopic(e.target.value);
              setListOpen(true);
            }}
            onFocus={() => setListOpen(true)}
            onKeyDown={onKeyDown}
            placeholder="Map a topic, e.g. protein folding"
            maxLength={100}
            required
            autoComplete="off"
            role="combobox"
            aria-expanded={listOpen && matches.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={listOpen && active >= 0 ? `${listId}-${active}` : undefined}
          />
        </div>
        {busy && (
          <div className="build-status">
            <span className="build-stage" role="status">
              Step {stage.n} of 3: {stage.label}
            </span>
            <BuildClock started={job.startedAt} />
          </div>
        )}
        {!collapsed && !busy && (
          <Popover
            open={filtersOpen}
            onOpenChange={setFiltersOpen}
            align="end"
            label="Search filters"
            className="cmdbar-filters"
            trigger={(props) => (
              <button type="button" className="btn btn-subtle btn-sm" {...props}>
                <Icon name="sliders" />
                <span className="cmdbar-filters-label">Filters</span>
                {activeFilters.length > 0 && (
                  <span className="filter-count num" aria-label={`(${activeFilters.join(", ")})`}>
                    {activeFilters.length}
                  </span>
                )}
              </button>
            )}
          >
            <div className="filter-grid">
              <div className="field">
                <label htmlFor="category">arXiv category</label>
                <select id="category" className="select" value={category} onChange={(e) => setCategory(e.target.value)}>
                  <option value="">Any</option>
                  {categories.map((c) => (
                    <option key={c.code} value={c.code}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="max-papers">Papers</label>
                <select
                  id="max-papers"
                  className="select"
                  value={maxPapers}
                  onChange={(e) => setMaxPapers(Number(e.target.value))}
                >
                  {PAPER_OPTIONS.map((n) => (
                    <option key={n} value={n}>{n.toLocaleString()}</option>
                  ))}
                </select>
              </div>
            </div>
            <p className="hint">
              New topics take about 2 minutes for 600 papers (download, mapping and a literature check of the top
              gaps). Topics already mapped open instantly.
            </p>
          </Popover>
        )}
        {!collapsed && (
          <button type="submit" className="btn btn-primary btn-sm cmdbar-submit">
            {busy ? "Building…" : "Build map"}
          </button>
        )}
      </fieldset>
      {busy && (
        <span className="build-bar" aria-hidden="true">
          <span style={{ width: `${Math.round((job.progress || 0) * 100)}%` }} />
        </span>
      )}
      <Suggestions
        open={listOpen && !busy && !collapsed && matches.length > 0}
        anchorRef={anchorRef}
        id={listId}
        matches={matches}
        active={active}
        typed={topic.trim()}
        onPick={openExisting}
        onHover={setActive}
      />
    </form>
  );
});
export default TopicSearch;

function BuildClock({ started }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <span className="build-clock num" aria-hidden="true">
      {clock(Math.max(0, Math.round((now - (started ?? now)) / 1000)))}
    </span>
  );
}

/** Mapped topics matching the input, in a popover portalled to <body> under the island. */
function Suggestions({ open, anchorRef, id, matches, active, typed, onPick, onHover }) {
  const [rect, setRect] = useState(null);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => setRect(anchorRef.current?.getBoundingClientRect() ?? null);
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open, anchorRef]);
  if (!open || !rect) return null;
  const width = Math.min(Math.max(rect.width, 320), window.innerWidth - 16);
  const left = Math.min(Math.max(8, rect.left + rect.width / 2 - width / 2), window.innerWidth - width - 8);
  return createPortal(
    <div className="suggest" style={{ top: rect.bottom + 8, left, width }}>
      <p className="suggest-head">Mapped topics</p>
      <ul id={id} role="listbox" aria-label="Mapped topics">
        {matches.map((t, i) => (
          <li
            key={t.field}
            id={`${id}-${i}`}
            role="option"
            aria-selected={i === active}
            className="suggest-option"
            onMouseDown={(e) => e.preventDefault()} // keep focus in the input
            onPointerMove={() => onHover(i)}
            onClick={() => onPick(t.field)}
          >
            <span className="suggest-name">{t.name}</span>
            <span className="num muted">{t.papers.toLocaleString()} papers</span>
          </li>
        ))}
      </ul>
      <p className="suggest-foot">
        {typed ? <>Press <kbd className="kbd">↵</kbd> to build a new map for “{typed}”</> : "Type a new topic to build its map"}
      </p>
    </div>,
    document.body,
  );
}
