import { useCallback, useEffect, useMemo, useState } from "react";
import { buildTopic, getCategories, getJob, getTopicMap, getTopics } from "./api.js";
import { COLOURS } from "./theme.js";
import { readHash, writeHash } from "./lib/hash.js";
import { useLayout } from "./lib/hooks.js";
import TopicSearch from "./components/TopicSearch.jsx";
import TopicSwitcher from "./components/TopicSwitcher.jsx";
import StatPills from "./components/StatPills.jsx";
import MapView from "./components/MapView.jsx";
import GapList from "./components/GapList.jsx";
import GapDetail from "./components/GapDetail.jsx";
import GapTable from "./components/GapTable.jsx";
import { Dialog, IconButton, Skeleton, StarGlyph, Switch } from "./components/ui.jsx";

export default function App() {
  const layout = useLayout();

  const [topics, setTopics] = useState([]); // every topic in the database
  const [categories, setCategories] = useState([]);
  const [field, setField] = useState(() => readHash().field); // the topic being shown
  const [mapData, setMapData] = useState(null); // papers, clusters and gaps for `field`
  const [loadingMap, setLoadingMap] = useState(false);
  const [selected, setSelected] = useState(0); // index of the selected gap
  const [showNoise, setShowNoise] = useState(true);
  const [showAllNames, setShowAllNames] = useState(false);
  const [job, setJob] = useState(null); // topic currently being built, if any
  const [error, setError] = useState(null);

  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [detailCollapsed, setDetailCollapsed] = useState(false);
  const [panelTab, setPanelTab] = useState("detail"); // medium/narrow layouts: "gaps" | "detail"

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
    writeHash(field);
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

  // Cmd/Ctrl+K opens the topic switcher.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSwitcherOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const clustersById = useMemo(
    () => Object.fromEntries((mapData?.clusters ?? []).map((c) => [c.id, c])),
    [mapData],
  );
  const hasGaps = mapData && mapData.gaps.length > 0;
  const selectGap = useCallback((i) => setSelected(i), []);

  const gapList = hasGaps && (
    <GapList
      gaps={mapData.gaps}
      clustersById={clustersById}
      selected={selected}
      onSelect={selectGap}
      onCompare={() => setCompareOpen(true)}
    />
  );
  const gapDetail = hasGaps && (
    <GapDetail gaps={mapData.gaps} clustersById={clustersById} selected={selected} colours={COLOURS} />
  );

  return (
    <div className="app">
      <a className="skip-link" href="#map-heading">Skip to map</a>
      <header className="topbar">
        <h1 className="wordmark">
          <StarGlyph size={14} className="wordmark-star" />
          <span>Research Gap Finder</span>
        </h1>
        <TopicSwitcher
          topics={mapped}
          field={field}
          onSelect={setField}
          open={switcherOpen}
          onOpenChange={setSwitcherOpen}
        />
        <div className="topbar-search">
          <TopicSearch
            categories={categories}
            busy={Boolean(job)}
            onBuild={handleBuild}
            compact={layout !== "wide"}
          />
        </div>
        {layout === "wide" && <StatPills data={mapData} loading={loadingMap} />}
      </header>

      {(job || error) && (
        <div className="banners">
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
              <button type="button" className="btn btn-subtle btn-sm" onClick={() => setError(null)}>Dismiss</button>
            </div>
          )}
        </div>
      )}

      <main
        className={`workspace layout-${layout} ${layout === "wide" && detailCollapsed ? "detail-collapsed" : ""}`}
      >
        {layout === "wide" && hasGaps && <aside className="panel rail">{gapList}</aside>}

        <section className="map-area" aria-labelledby="map-heading">
          {mapData ? (
            <>
              <div className="map-toolbar float">
                <h2 id="map-heading" tabIndex={-1}>{mapData.name}</h2>
                <Switch checked={showAllNames} onChange={setShowAllNames}>Show every topic name</Switch>
                <Switch checked={showNoise} onChange={setShowNoise}>Show unclustered papers</Switch>
              </div>
              {hasGaps ? (
                <MapView
                  data={mapData}
                  selected={selected}
                  onSelectGap={selectGap}
                  showNoise={showNoise}
                  showAllNames={showAllNames}
                  colours={COLOURS}
                />
              ) : (
                <p className="empty">No gaps found for this topic. Try a broader search.</p>
              )}
              {layout === "wide" && detailCollapsed && hasGaps && (
                <button
                  type="button"
                  className="btn btn-ghost btn-md float show-detail"
                  onClick={() => setDetailCollapsed(false)}
                >
                  Show gap details
                </button>
              )}
            </>
          ) : loadingMap ? (
            <Skeleton className="map-skeleton" />
          ) : (
            !job && <p className="empty">No maps yet. Type a topic above and click <strong>Build map</strong>.</p>
          )}
        </section>

        {layout === "wide" && hasGaps && !detailCollapsed && (
          <aside className="panel detail" aria-label="Selected gap">
            <div className="panel-head">
              <h2>Gap <span className="num">#{mapData.gaps[selected].rank}</span></h2>
              <IconButton icon="panelRight" label="Hide details panel" onClick={() => setDetailCollapsed(true)} />
            </div>
            {gapDetail}
          </aside>
        )}

        {layout !== "wide" && hasGaps && (
          <aside className="panel side-panel" aria-label="Gaps and details">
            {layout === "narrow" && <span className="sheet-handle" aria-hidden="true" />}
            <div className="segmented" role="tablist" aria-label="Panel">
              {[["gaps", "Gaps"], ["detail", "Detail"]].map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  id={`tab-${key}`}
                  aria-selected={panelTab === key}
                  aria-controls="side-tabpanel"
                  className="seg-btn"
                  onClick={() => setPanelTab(key)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div id="side-tabpanel" role="tabpanel" aria-labelledby={`tab-${panelTab}`} className="side-content">
              <StatPills data={mapData} loading={loadingMap} />
              {panelTab === "gaps" ? gapList : gapDetail}
            </div>
          </aside>
        )}
      </main>

      {hasGaps && (
        <Dialog
          open={compareOpen}
          onClose={() => setCompareOpen(false)}
          title="Compare all gaps"
          variant="drawer"
        >
          <GapTable
            gaps={mapData.gaps}
            clustersById={clustersById}
            selected={selected}
            onSelect={(i) => {
              setSelected(i);
              setCompareOpen(false);
            }}
          />
          <MapNotes data={mapData} />
        </Dialog>
      )}
    </div>
  );
}

/** Secondary info kept from the original page: every topic, and how gaps are found. */
function MapNotes({ data }) {
  return (
    <div className="map-notes">
      <details>
        <summary>All {data.clusters.length} topics in this map</summary>
        <div className="table-scroll">
          <table>
            <thead><tr><th scope="col">Topic</th><th scope="col">Papers</th></tr></thead>
            <tbody>
              {[...data.clusters].sort((x, y) => y.size - x.size).map((c) => (
                <tr key={c.id}><td>{c.label}</td><td className="num">{c.size}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      <details>
        <summary>How gaps are found</summary>
        <HowGapsAreFound />
      </details>
    </div>
  );
}

export function HowGapsAreFound() {
  return (
    <ol className="how-list">
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
  );
}
