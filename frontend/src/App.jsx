import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildTopic, getCategories, getJob, getTopicMap, getTopics } from "./api.js";
import { COLOURS, prefersReducedMotion, shortName } from "./theme.js";
import { readHash, writeHash } from "./lib/hash.js";
import { isTypingTarget, useLayout, useMediaQuery } from "./lib/hooks.js";
import TopicSearch from "./components/TopicSearch.jsx";
import TopicSwitcher from "./components/TopicSwitcher.jsx";
import StatPills from "./components/StatPills.jsx";
import MapView from "./components/MapView.jsx";
import GapList from "./components/GapList.jsx";
import GapDetail from "./components/GapDetail.jsx";
import GapTable from "./components/GapTable.jsx";
import VerdictNotice from "./components/VerdictNotice.jsx";
import DotSizeControl from "./components/DotSizeControl.jsx";
import Timeline from "./components/Timeline.jsx";
import { DEFAULT_DOT_SIZE, DOT_SCALES } from "./lib/mapStyle.js";
import { readPref, writePref } from "./lib/prefs.js";
import { Dialog, Icon, IconButton, Skeleton, StarGlyph, Switch } from "./components/ui.jsx";

export default function App() {
  const layout = useLayout();
  const wideSearch = useMediaQuery("(min-width: 1100px)"); // narrower: the search collapses to an icon
  const islandRef = useRef(null);
  const searchRef = useRef(null);

  const [topics, setTopics] = useState([]); // every topic in the database
  const [categories, setCategories] = useState([]);
  const [field, setField] = useState(() => readHash().field); // the topic being shown
  const [mapData, setMapData] = useState(null); // papers, clusters and gaps for `field`
  const [loadingMap, setLoadingMap] = useState(false);
  const [selected, setSelected] = useState(0); // index of the selected gap (shared by map, list, table)
  const pendingGapRank = useRef(readHash().gapRank); // ?gap=N from the URL, applied once the map loads
  const pendingYear = useRef(readHash().year); // ?year=Y from the URL, applied once the map loads
  const [playhead, setPlayhead] = useState(null); // timeline year, or null = all time
  const listRef = useRef(null);
  const [showNoise, setShowNoise] = useState(true);
  const [showAllNames, setShowAllNames] = useState(false);
  const [job, setJob] = useState(null); // topic currently being built, if any
  const [error, setError] = useState(null);

  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [detailCollapsed, setDetailCollapsed] = useState(false);
  const [panelTab, setPanelTab] = useState("detail"); // medium/narrow layouts: "gaps" | "detail"
  const [interacted, setInteracted] = useState(false); // hide the map hint after the first selection
  const [verdictDismissed, setVerdictDismissed] = useState(null); // field whose "no clear gaps" card was closed
  const [toastField, setToastField] = useState(null); // field whose "few promising gaps" toast is showing
  const toastSeen = useRef(new Set()); // the toast shows at most once per topic per visit
  const [dotSize, setDotSize] = useState(() => {
    const saved = readPref("dotSize");
    return saved in DOT_SCALES ? saved : DEFAULT_DOT_SIZE;
  });
  useEffect(() => writePref("dotSize", dotSize), [dotSize]);
  const [highlightPaper, setHighlightPaper] = useState(null); // arXiv id hovered in the reading list

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
    let cancelled = false; // ignore the answer if the user switched topic meanwhile
    setLoadingMap(true);
    getTopicMap(field)
      .then((data) => {
        if (cancelled) return;
        setMapData(data);
        const fromUrl = data.gaps.findIndex((g) => g.rank === pendingGapRank.current);
        pendingGapRank.current = null;
        // New topic: the timeline starts at "All time" unless the URL asks for a year in range.
        const years = data.papers.map((p) => p.year).filter(Number.isFinite);
        const y = pendingYear.current;
        pendingYear.current = null;
        setPlayhead(y != null && y >= Math.min(...years) && y < Math.max(...years) ? y : null);
        setSelected(fromUrl >= 0 ? fromUrl : 0);
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
        setJob({ id: result.job_id, topic, progress: 0, message: "Starting…", startedAt: Date.now() });
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

  // Cmd/Ctrl+K opens the topic switcher; "/" focuses the search.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSwitcherOpen(true);
      } else if (e.key === "/" && !isTypingTarget(e.target) && !document.querySelector("dialog[open]")) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const selectGap = useCallback((i) => {
    setSelected(i);
    setInteracted(true);
  }, []);

  // Keep the URL in sync: #field, plus ?gap=N (not #1) and &year=Y (timeline position).
  const selectedRank = mapData?.field === field ? mapData.gaps[selected]?.rank : null;
  const urlYear = mapData?.field === field ? playhead : null;
  useEffect(() => {
    if (field) writeHash(field, selectedRank, urlYear);
  }, [field, selectedRank, urlYear]);

  // Follow manual URL edits and back/forward.
  const latest = useRef({ field, mapData });
  useEffect(() => {
    latest.current = { field, mapData };
  });
  useEffect(() => {
    const onHash = () => {
      const { field: f, gapRank, year } = readHash();
      if (!f) return;
      if (f !== latest.current.field) {
        pendingGapRank.current = gapRank;
        pendingYear.current = year;
        setField(f);
        return;
      }
      setPlayhead(year);
      const i = latest.current.mapData?.gaps.findIndex((g) => g.rank === (gapRank ?? 1)) ?? -1;
      if (i >= 0) setSelected(i);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // j/k (and arrows when nothing else has focus) move through the ranked gaps.
  const gapCount = mapData?.gaps.length ?? 0;
  const moveSelection = useCallback(
    (to) => setSelected((i) => Math.max(0, Math.min(gapCount - 1, typeof to === "function" ? to(i) : to))),
    [gapCount],
  );
  useEffect(() => {
    if (!gapCount) return;
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return;
      if (document.querySelector("dialog[open]")) return;
      const idle = e.target === document.body || e.target.closest?.(".map-area");
      if (e.key === "j" || (idle && e.key === "ArrowDown")) moveSelection((i) => i + 1);
      else if (e.key === "k" || (idle && e.key === "ArrowUp")) moveSelection((i) => i - 1);
      else return;
      setInteracted(true);
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [gapCount, moveSelection]);

  // Arrow keys / Home / End inside the list move selection and focus together (roving tabindex).
  const onListKeyDown = useCallback(
    (e) => {
      const keys = { ArrowDown: (i) => i + 1, ArrowUp: (i) => i - 1, Home: () => 0, End: () => gapCount - 1 };
      const move = keys[e.key];
      if (!move) return;
      e.preventDefault();
      e.stopPropagation();
      const from = Number(e.target.closest("[data-index]")?.dataset.index ?? selected);
      const next = Math.max(0, Math.min(gapCount - 1, move(from)));
      selectGap(next);
      listRef.current?.querySelector(`[data-index="${next}"]`)?.focus();
    },
    [gapCount, selected, selectGap],
  );

  // Keep the selected row visible.
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${selected}"]`)
      ?.scrollIntoView({ block: "nearest", behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }, [selected, panelTab, layout]);

  // "Few promising gaps" toast: once per topic, gone after about 8 s (the rail banner stays).
  useEffect(() => {
    const f = mapData?.field;
    if (!f || mapData.assessment?.verdict !== "limited" || toastSeen.current.has(f)) return;
    toastSeen.current.add(f);
    setToastField(f);
  }, [mapData]);
  useEffect(() => setToastField(null), [field]); // leaving a topic ends its toast
  useEffect(() => {
    if (!toastField) return;
    const t = setTimeout(() => setToastField(null), 8000);
    return () => clearTimeout(t);
  }, [toastField]);

  const clustersById = useMemo(
    () => Object.fromEntries((mapData?.clusters ?? []).map((c) => [c.id, c])),
    [mapData],
  );
  const hasGaps = mapData && mapData.gaps.length > 0;

  const openCompare = useCallback(() => setCompareOpen(true), []);
  const assessment = mapData?.assessment;
  const listNotice = useMemo(() => <VerdictNotice assessment={assessment} variant="inline" />, [assessment]);
  const gapList = hasGaps && (
    <GapList
      gaps={mapData.gaps}
      clustersById={clustersById}
      selected={selected}
      onSelect={selectGap}
      onCompare={openCompare}
      listRef={listRef}
      onKeyDown={onListKeyDown}
      notice={listNotice}
    />
  );
  // The selected gap's two topics, for the timeline's stacked bars.
  const selectedGap = hasGaps ? mapData.gaps[selected] : null;
  const pairIds = useMemo(
    () => (selectedGap ? [selectedGap.cluster_a, selectedGap.cluster_b] : null),
    [selectedGap],
  );
  const pairNames = selectedGap
    ? `Topic A (${shortName(clustersById[selectedGap.cluster_a]?.label)}), Topic B (${shortName(clustersById[selectedGap.cluster_b]?.label)}), other topics and unclustered papers`
    : null;

  const gapDetail = hasGaps && (
    <GapDetail
      gaps={mapData.gaps}
      clustersById={clustersById}
      selected={selected}
      colours={COLOURS}
      onHoverPaper={setHighlightPaper}
      playhead={playhead}
      papers={mapData.papers}
    />
  );

  return (
    <div className="app">
      <a className="skip-link" href="#map-heading">Skip to map</a>
      <header className="topbar">
        <h1 className="wordmark" aria-label="eXpand">
          <span aria-hidden="true">e<span className="wordmark-x">X</span>pand</span>
        </h1>
        <div className={`island floating-surface ${job ? "is-building" : ""}`} ref={islandRef}>
          <StarGlyph size={14} className="island-star" />
          <TopicSwitcher
            topics={mapped}
            field={field}
            onSelect={setField}
            open={switcherOpen}
            onOpenChange={setSwitcherOpen}
          />
          <span className="island-sep" aria-hidden="true" />
          <TopicSearch
            ref={searchRef}
            categories={categories}
            job={job}
            onBuild={handleBuild}
            topics={mapped}
            onOpenTopic={setField}
            anchorRef={islandRef}
            collapsible={!wideSearch}
          />
        </div>
        <div className="topbar-stats">
          {layout === "wide" && <StatPills data={mapData} loading={loadingMap} variant="text" playhead={playhead} />}
        </div>
      </header>

      {error && (
        <div className="banners">
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
              {hasGaps ? (
                <MapView
                  data={mapData}
                  selected={selected}
                  onSelectGap={selectGap}
                  showNoise={showNoise}
                  showAllNames={showAllNames}
                  highlightPaper={highlightPaper}
                  showHint={!interacted}
                  dotSize={dotSize}
                  toolbar={
                    <div className="map-toolbar float">
                      <h2 id="map-heading" tabIndex={-1}>{mapData.name}</h2>
                      <Switch checked={showAllNames} onChange={setShowAllNames}>Show every topic name</Switch>
                      <Switch checked={showNoise} onChange={setShowNoise}>Show unclustered papers</Switch>
                      <DotSizeControl value={dotSize} onChange={setDotSize} />
                      {playhead != null && (
                        <span className="year-chip">
                          Showing papers up to <span className="num">{playhead}</span>
                          <button type="button" aria-label="Show all years" onClick={() => setPlayhead(null)}>
                            <Icon name="close" size={12} />
                          </button>
                        </span>
                      )}
                    </div>
                  }
                  playhead={playhead}
                  overlay={
                    <Timeline
                      papers={mapData.papers}
                      pairIds={pairIds}
                      pairNames={pairNames}
                      playhead={playhead}
                      onChange={setPlayhead}
                    />
                  }
                />
              ) : (
                <div className="empty">
                  <h2 id="map-heading" className="empty-title">{mapData.name}</h2>
                  <p>
                    {mapData.assessment?.message ??
                      "No gaps found for this topic. Try a broader search."}
                  </p>
                  <button type="button" className="btn btn-primary btn-md" onClick={() => setSwitcherOpen(true)}>
                    Try another topic
                  </button>
                </div>
              )}
              {hasGaps && mapData.assessment?.verdict === "none" && verdictDismissed !== mapData.field && (
                <VerdictNotice
                  assessment={mapData.assessment}
                  onTryAnother={() => setSwitcherOpen(true)}
                  onDismiss={() => setVerdictDismissed(mapData.field)}
                />
              )}
              {hasGaps && mapData.assessment?.verdict === "limited" && toastField === mapData.field && (
                <VerdictNotice assessment={mapData.assessment} onDismiss={() => setToastField(null)} />
              )}
              {loadingMap && <Skeleton className="map-skeleton map-loading" />}
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
              <StatPills data={mapData} loading={loadingMap} playhead={playhead} />
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
