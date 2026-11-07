import { useState } from "react";

const PAPER_OPTIONS = [300, 600, 1000, 1500];

/** Form for mapping a new topic. Calls onBuild(topic, category, maxPapers). */
export default function TopicSearch({ categories, busy, onBuild }) {
  const [topic, setTopic] = useState("");
  const [category, setCategory] = useState("");
  const [maxPapers, setMaxPapers] = useState(600);

  function handleSubmit(event) {
    event.preventDefault(); // stop the browser reloading the page
    if (topic.trim()) onBuild(topic.trim(), category, maxPapers);
  }

  return (
    <form className="topic-search" onSubmit={handleSubmit}>
      <div className="field grow">
        <label htmlFor="topic">Map any research topic</label>
        <input
          id="topic"
          type="text"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="e.g. wildfire, protein folding, quantum error correction"
          maxLength={100}
          required
        />
      </div>
      <div className="field">
        <label htmlFor="category">arXiv category</label>
        <select id="category" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">Any</option>
          {categories.map((c) => (
            <option key={c.code} value={c.code}>{c.name}</option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="max-papers">Papers</label>
        <select id="max-papers" value={maxPapers} onChange={(e) => setMaxPapers(Number(e.target.value))}>
          {PAPER_OPTIONS.map((n) => (
            <option key={n} value={n}>{n.toLocaleString()}</option>
          ))}
        </select>
      </div>
      <button type="submit" className="primary" disabled={busy}>
        {busy ? "Building…" : "Build map"}
      </button>
      <p className="hint full">
        New topics take about a minute per 600 papers. Topics already mapped open instantly.
      </p>
    </form>
  );
}
