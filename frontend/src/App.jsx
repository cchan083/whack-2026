import { useCallback, useEffect, useMemo, useState } from "react";
import { buildTopic, getCategories, getJob, getTopicMap, getTopics } from "./api.js";
import { PALETTES, useColorScheme } from "./theme.js";
import TopicSearch from "./components/TopicSearch.jsx";
import MapView from "./components/MapView.jsx";
import GapDetail from "./components/GapDetail.jsx";
import GapTable from "./components/GapTable.jsx";

// The selected topic is kept in the URL (#wildfire), so links can be shared.
const fieldFromUrl = () => decodeURIComponent(window.location.hash.slice(1)) || null;

export default function App() {
  const colours = PALETTES[useColorScheme()];

  const [topics, setTopics] = useState([]); // every topic in the database
  const [categories, setCategories] = useState([]);
  const [field, setField] = useState(fieldFromUrl); // the topic being shown
  const [mapData, setMapData] = useState(null); // papers, clusters and gaps for `field`
  const [loadingMap, setLoadingMap] = useState(false);
  const [selected, setSelected] = useState(0); // index of the selected gap
  const [showNoise, setShowNoise] = useState(true);
  const [showAllNames, setShowAllNames] = useState(false);
  const [job, setJob] = useState(null); // topic currently being built, if any
  const [error, setError] = useState(null);

  const mapped = topics.filter((t) => t.clusters > 0);

  const refreshTopics = useCallback(
    () => getTopics().then(setTopics).catch((e) => setError(e.message)),
    [],
  );

  // On first load: fetch the topic list and categories.
  useEffect(() => {
    refreshTopics();
    getCategories().then(setCategories).catch(() => {});
  }, [refreshTopics]);

  // No topic chosen yet: show the biggest one.
  useEffect(() => {
    if (!field && mapped.length > 0) setField(mapped[0].field);
  }, [field, mapped]);

  // Whenever the topic changes, load its map.
  useEffect(() => {
    if (!field) return;
    window.history.replaceState(null, "", `#${encodeURIComponent(field)}`);
    let cancelled = false; // ignore the answer if the user switched topic meanwhile
    setLoadingMap(true);
    getTopicMap(field)
      .then((data) => {
        if (cancelled) return;
        setMapData(data);
        setSelected(0);
      })
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoadingMap(false));
    return () => {
      cancelled = true;
    };
  }, [field]);

  // Start building a topic (or open it straight away if it already exists).
  async function handleBuild(topic, category, maxPapers) {
    setError(null);
    try {
      const result = await buildTopic(topic, category, maxPapers);
      if (result.status === "ready") {
        await refreshTopics();
        setField(result.field);
      } else {
        setJob({ id: result.job_id, topic, progress: 0, message: "Starting…" });
      }
    } catch (e) {
      setError(e.message);
    }
  }

  // While a topic is building, ask the server for progress every second.
  useEffect(() => {
    if (!job) return;
    const timer = setInterval(async () => {
      try {
        const status = await getJob(job.id);
        if (status.status === "running") {
          setJob((current) => current && { ...current, progress: status.progress, message: status.message });
          return;
        }
        clearInterval(timer);
        setJob(null);
        if (status.status === "done") {
          await refreshTopics();
          setField(status.field);
        } else {
          setError(status.error);
        }
      } catch (e) {
        clearInterval(timer);
        setJob(null);
        setError(e.message);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [job?.id, refreshTopics]); // eslint-disable-line react-hooks/exhaustive-deps

  const clustersById = useMemo(
    () => Object.fromEntries((mapData?.clusters ?? []).map((c) => [c.id, c])),
    [mapData],
  );
  const years = mapData?.papers.map((p) => p.year) ?? [];

  return (
    <>
      <header className="site-header">
        <div className="wrap">
          <h1>Research Gap Finder</h1>
          <p className="tagline">
            Map any research field, find the unexplored territory between related topics, and turn it into a
            dissertation idea.
          </p>
        </div>
      </header>

      <main className="wrap">
        <section className="card search-card" aria-label="Choose a topic">
          <TopicSearch categories={categories} busy={Boolean(job)} onBuild={handleBuild} />

          {job && (
            <div className="progress" role="status" aria-live="polite">
              <p><strong>Building a map for “{job.topic}”</strong>: {job.message}</p>
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${Math.round((job.progress || 0) * 100)}%` }} />
              </div>
            </div>
          )}

          {error && (
            <div className="alert" role="alert">
              <span>{error}</span>
              <button type="button" className="link-button" onClick={() => setError(null)}>Dismiss</button>
            </div>
          )}

          {mapped.length > 0 && (
            <div className="chips" role="group" aria-label="Mapped topics">
              <span className="chips-label">Mapped topics:</span>
              {mapped.map((t) => (
                <button
                  key={t.field}
                  type="button"
                  className="chip"
                  aria-pressed={t.field === field}
                  onClick={() => setField(t.field)}
                >
                  {t.name} <span className="chip-count">{t.papers.toLocaleString()}</span>
                </button>
              ))}
            </div>
          )}
        </section>

        {loadingMap && !mapData && <p className="loading">Loading map…</p>}
        {!loadingMap && mapped.length === 0 && !job && (
          <p className="empty">No maps yet. Type a topic above and click <strong>Build map</strong>.</p>
        )}

        {mapData && (
          <>
            <dl className="stats" aria-busy={loadingMap}>
              <div><dt>Papers</dt><dd>{mapData.papers.length.toLocaleString()}</dd></div>
              <div><dt>Topics</dt><dd>{mapData.clusters.length}</dd></div>
              <div><dt>Gaps found</dt><dd>{mapData.gaps.length}</dd></div>
              <div><dt>Published</dt><dd>{Math.min(...years)}–{Math.max(...years)}</dd></div>
            </dl>

            {mapData.gaps.length === 0 ? (
              <p className="empty">No gaps found for this topic. Try a broader search.</p>
            ) : (
              <>
                <div className="explore">
                  <section className="card map-card" aria-labelledby="map-heading">
                    <div className="map-toolbar">
                      <h2 id="map-heading">{mapData.name}</h2>
                      <label className="check">
                        <input type="checkbox" checked={showAllNames} onChange={(e) => setShowAllNames(e.target.checked)} />
                        Show every topic name
                      </label>
                      <label className="check">
                        <input type="checkbox" checked={showNoise} onChange={(e) => setShowNoise(e.target.checked)} />
                        Show unclustered papers
                      </label>
                    </div>
                    <MapView
                      data={mapData}
                      selected={selected}
                      onSelectGap={setSelected}
                      showNoise={showNoise}
                      showAllNames={showAllNames}
                      colours={colours}
                    />
                    <p className="hint">
                      Every dot is a paper; similar papers sit close together. Stars mark gaps between related
                      topics: click one, or pick from the list. Scroll to zoom, drag to pan.
                    </p>
                  </section>

                  <GapDetail
                    gaps={mapData.gaps}
                    clustersById={clustersById}
                    selected={selected}
                    onSelect={setSelected}
                    colours={colours}
                  />
                </div>

                <GapTable gaps={mapData.gaps} clustersById={clustersById} selected={selected} onSelect={setSelected} />
              </>
            )}

            <details className="card">
              <summary>All {mapData.clusters.length} topics in this map</summary>
              <div className="table-scroll">
                <table>
                  <thead><tr><th scope="col">Topic</th><th scope="col">Papers</th></tr></thead>
                  <tbody>
                    {[...mapData.clusters].sort((x, y) => y.size - x.size).map((c) => (
                      <tr key={c.id}><td>{c.label}</td><td>{c.size}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>

            <details className="card">
              <summary>How gaps are found</summary>
              <ol>
                <li>Each paper's title and abstract become a list of numbers (an embedding), then papers are placed on a 2D map so similar ones sit together.</li>
                <li>Groups of nearby papers become <strong>topics</strong>.</li>
                <li>For each pair of neighbouring topics we measure how <strong>related</strong> they are and how <strong>empty</strong> the space between them is.</li>
                <li>Map score = relatedness × emptiness: two related topics that few papers connect.</li>
                <li>
                  Each candidate is then <strong>validated</strong>: it should apply one <em>method</em> to one{" "}
                  <em>problem domain</em>; it is boosted if 5–100 arXiv papers already mention both (a viable
                  niche) and demoted if over 500 do (saturated); pairs with no papers are flagged for a human to
                  check; and pairs touching a strategic funding area (energy, materials, health, climate risk…) rank
                  higher.
                </li>
              </ol>
            </details>
          </>
        )}
      </main>
    </>
  );
}
