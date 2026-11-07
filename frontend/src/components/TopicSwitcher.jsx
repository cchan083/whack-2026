import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Dialog, Icon, Kbd } from "./ui.jsx";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
export const MOD_KEY = isMac ? "⌘" : "Ctrl";

/** Current topic as a pill; opens a searchable list of mapped topics (also Cmd/Ctrl+K). */
export default function TopicSwitcher({ topics, field, onSelect, open, onOpenChange }) {
  const current = topics.find((t) => t.field === field);
  return (
    <>
      <button
        type="button"
        className="switcher-pill"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => onOpenChange(true)}
        title={`Switch topic (${MOD_KEY}+K)`}
      >
        <span className="switcher-label">{current ? current.name : "Choose a topic"}</span>
        {current && <span className="num switcher-count">{current.papers.toLocaleString()}</span>}
        <Icon name="chevronDown" />
        <span className="visually-hidden">, switch topic</span>
      </button>
      <Dialog open={open} onClose={() => onOpenChange(false)} title="Switch topic" className="switcher-dialog">
        <SwitcherList
          topics={topics}
          field={field}
          onSelect={(f) => {
            onOpenChange(false);
            onSelect(f);
          }}
        />
      </Dialog>
    </>
  );
}

function SwitcherList({ topics, field, onSelect }) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listId = useId();
  const input = useRef(null);
  const list = useRef(null);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? topics.filter((t) => t.name.toLowerCase().includes(q) || t.field.includes(q)) : topics;
  }, [topics, query]);

  useEffect(() => input.current?.focus(), []);
  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function onKeyDown(e) {
    if (e.key === "ArrowDown") setActive((i) => Math.min(matches.length - 1, i + 1));
    else if (e.key === "ArrowUp") setActive((i) => Math.max(0, i - 1));
    else if (e.key === "Home") setActive(0);
    else if (e.key === "End") setActive(matches.length - 1);
    else if (e.key === "Enter" && matches[active]) onSelect(matches[active].field);
    else return;
    e.preventDefault();
  }

  return (
    <div className="switcher">
      <div className="switcher-search">
        <Icon name="search" />
        <input
          ref={input}
          type="text"
          role="combobox"
          aria-label="Search mapped topics"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={matches[active] ? `${listId}-${active}` : undefined}
          aria-autocomplete="list"
          placeholder="Search mapped topics…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />
      </div>
      <ul className="switcher-list" role="listbox" id={listId} ref={list} aria-label="Mapped topics">
        {matches.map((t, i) => (
          <li
            key={t.field}
            id={`${listId}-${i}`}
            role="option"
            aria-selected={i === active}
            data-index={i}
            className="switcher-option"
            onPointerMove={() => setActive(i)}
            onClick={() => onSelect(t.field)}
          >
            <span className="switcher-name">{t.name}</span>
            {t.field === field && <span className="pill">Current</span>}
            <span className="num switcher-count">{t.papers.toLocaleString()} papers</span>
          </li>
        ))}
        {matches.length === 0 && <li className="switcher-empty">No mapped topic matches “{query}”.</li>}
      </ul>
      <footer className="switcher-foot">
        <span><Kbd>↑</Kbd><Kbd>↓</Kbd> move</span>
        <span><Kbd>↵</Kbd> open</span>
        <span><Kbd>Esc</Kbd> close</span>
      </footer>
    </div>
  );
}
