import { useState } from "react";
import { Icon, Popover } from "./ui.jsx";

const PAPER_OPTIONS = [300, 600, 1000, 1500];
const DEFAULT_PAPERS = 600;

/**
 * Command-bar form for mapping a new topic. Calls onBuild(topic, category, maxPapers).
 * Same fields and validation as before: topic (required, max 100 chars), arXiv
 * category and paper count (the last two live in a "Filters" popover).
 * `compact` (small screens) puts the whole form behind a "New map" button.
 */
export default function TopicSearch({ categories, busy, onBuild, compact = false, categoryField }) {
  const [topic, setTopic] = useState("");
  const [category, setCategory] = useState("");
  const [maxPapers, setMaxPapers] = useState(DEFAULT_PAPERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);

  function handleSubmit(event) {
    event.preventDefault(); // stop the browser reloading the page
    if (!topic.trim()) return;
    setFiltersOpen(false);
    setFormOpen(false);
    onBuild(topic.trim(), category, maxPapers);
  }

  const activeFilters = [category, maxPapers !== DEFAULT_PAPERS && `${maxPapers.toLocaleString()} papers`].filter(Boolean);

  const filters = (
    <Popover
      open={filtersOpen}
      onOpenChange={setFiltersOpen}
      align="end"
      label="Search filters"
      className="cmdbar-filters"
      trigger={(props) => (
        <button type="button" className="btn btn-subtle btn-sm" {...props}>
          <Icon name="sliders" />
          <span>Filters</span>
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
          {categoryField ? (
            categoryField({ id: "category", value: category, onChange: setCategory, categories })
          ) : (
            <select id="category" className="select" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">Any</option>
              {categories.map((c) => (
                <option key={c.code} value={c.code}>{c.name} ({c.code})</option>
              ))}
            </select>
          )}
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
        New topics take about 2 minutes for 600 papers (download, mapping and a literature check of the top gaps).
        Topics already mapped open instantly.
      </p>
    </Popover>
  );

  const form = (
    <form className="cmdbar" onSubmit={handleSubmit} aria-label="Map a new topic">
      <fieldset disabled={busy}>
        <label htmlFor="topic" className="visually-hidden">Map any research topic</label>
        <Icon name="search" className="cmdbar-icon" />
        <input
          id="topic"
          type="text"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="Map a topic, e.g. protein folding"
          maxLength={100}
          required
          autoComplete="off"
        />
        {filters}
        <button type="submit" className="btn btn-primary btn-sm">
          {busy ? "Building…" : "Build map"}
        </button>
      </fieldset>
    </form>
  );

  if (!compact) return form;
  return (
    <Popover
      open={formOpen}
      onOpenChange={setFormOpen}
      align="end"
      label="Map a new topic"
      className="cmdbar-compact"
      trigger={(props) => (
        <button type="button" className="btn btn-ghost btn-md" {...props}>
          <Icon name="plus" />
          <span>New map</span>
        </button>
      )}
    >
      {form}
    </Popover>
  );
}
