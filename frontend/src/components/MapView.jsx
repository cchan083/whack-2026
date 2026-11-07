import { useEffect, useMemo, useRef, useState } from "react";
import Plotly from "plotly.js-dist-min";
import { COLOURS, FONT_MONO, FONT_UI, shortName } from "../theme.js";
import { boundsOf, currentRanges, flyTo, zoomBy } from "../lib/mapNav.js";
import { DOT_SCALES, MAP_STYLE, dotSizes, zoomGrowth } from "../lib/mapStyle.js";
import { byYear, countUpTo, yearOf } from "../lib/timeline.js";
import { Icon, IconButton, StarGlyph } from "./ui.jsx";
import PaperCard, { arxivUrl } from "./PaperCard.jsx";

// Traces are always in this order, so updates can target them by index.
const T = {
  NOISE: 0, OTHERS: 1, HALO_A: 2, HALO_B: 3, A: 4, B: 5,
  LINK: 6, STARS: 7, RING: 8, SELECTED: 9, PAPER: 10, NEW: 11,
};
// Traces whose papers are filtered by the timeline.
const TIMED = [T.NOISE, T.OTHERS, T.HALO_A, T.HALO_B, T.A, T.B, T.NEW];
// Paper traces whose marker size follows the dot-size setting and zoom.
const SIZED = [T.NOISE, T.OTHERS, T.HALO_A, T.HALO_B, T.A, T.B, T.NEW];
const sizesFor = (s) => [s.noise, s.others, s.halo, s.halo, s.pair, s.pair, s.newcomer];

/** Truncate to ~80 characters, then wrap into lines for the hover box. */
function hoverTitle(text, max = 80, width = 46) {
  const short = text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
  const lines = [""];
  for (const word of short.split(" ")) {
    const last = lines.length - 1;
    if (lines[last] && (lines[last] + " " + word).length > width) lines.push(word);
    else lines[last] = lines[last] ? `${lines[last]} ${word}` : word;
  }
  return lines.join("<br>");
}

const xyc = (papers) => ({
  x: papers.map((p) => p.x),
  y: papers.map((p) => p.y),
  customdata: papers.map((p) => p.hover),
});

const PAPER_HOVER =
  "<b>%{customdata[0]}</b><br><span style='color:#a09e98'>%{customdata[1]} · %{customdata[2]}</span>" +
  "<br><span style='color:#3cc795'>Click for details and the arXiv link</span><extra></extra>";
// Traces whose points are papers (clicking one opens its card).
const PAPER_TRACES = new Set([T.NOISE, T.OTHERS, T.A, T.B]);

function paperTrace(points, { size, color, opacity, uid, line, halo = false }) {
  return {
    type: "scattergl", // WebGL: fast with thousands of points
    mode: "markers",
    uid,
    ...xyc(points),
    marker: { size, color, opacity, ...(line ? { line } : {}) },
    ...(halo ? { hoverinfo: "skip" } : { hovertemplate: PAPER_HOVER }),
  };
}

/** Everything that depends only on the topic's data (computed once per topic). */
function prepare(data) {
  const byId = Object.fromEntries(data.clusters.map((c) => [c.id, c]));
  const papers = data.papers.map((p) => ({
    ...p,
    year: yearOf(p),
    hover: [
      hoverTitle(p.title),
      p.year,
      p.cluster_id == null ? "Unclustered" : shortName(byId[p.cluster_id]?.label),
      p.arxiv_id, // [3]: which paper a click refers to
    ],
  }));
  const scores = data.gaps.map((g) => g.score);
  const lo = Math.min(...scores);
  const hi = Math.max(...scores);
  return {
    byId,
    papers,
    byArxiv: Object.fromEntries(papers.map((p) => [p.arxiv_id, p])),
    // Sorted by year, so the timeline's "papers up to year Y" is a prefix of each list.
    noise: byYear(papers.filter((p) => p.cluster_id == null)),
    clustered: byYear(papers.filter((p) => p.cluster_id != null)),
    full: boundsOf(papers, 0.04),
    // Star size scales with score: 9-15px.
    starSizes: scores.map((s) => (hi > lo ? 9 + (6 * (s - lo)) / (hi - lo) : 12)),
  };
}

/** Per-selection pieces: who is in A, B or neither. */
function pairOf(prep, gap) {
  const a = prep.byId[gap.cluster_a];
  const b = prep.byId[gap.cluster_b];
  const inA = [], inB = [], others = [];
  for (const p of prep.clustered) {
    if (p.cluster_id === a.id) inA.push(p);
    else if (p.cluster_id === b.id) inB.push(p);
    else others.push(p);
  }
  return { a, b, inA, inB, others }; // each stays sorted by year (prep.clustered is)
}

/** What the timeline lets through: each group cut to papers published up to `playhead`. */
function visibleOf(prep, pair, playhead, showNoise) {
  const upTo = (list) => list.slice(0, countUpTo(list, playhead));
  const v = { noise: upTo(prep.noise), others: upTo(pair.others), inA: upTo(pair.inA), inB: upTo(pair.inB) };
  // Papers published in the current year get a ring (only while scrubbing).
  v.newcomers = playhead == null ? [] : [
    ...(showNoise ? v.noise : []), ...v.others, ...v.inA, ...v.inB,
  ].filter((p) => p.year === playhead);
  return v;
}

/** One batched restyle payload for every timeline-filtered trace. */
function timedUpdate(v) {
  const groups = [v.noise, v.others, v.inA, v.inB, v.inA, v.inB, v.newcomers];
  const halo = (i) => i === 2 || i === 3 || i === 6; // halos and rings have no hover
  return {
    x: groups.map((g) => g.map((p) => p.x)),
    y: groups.map((g) => g.map((p) => p.y)),
    customdata: groups.map((g, i) => (halo(i) ? [] : g.map((p) => p.hover))),
  };
}

const LABEL_FONT = { family: FONT_UI, size: 12, color: COLOURS.ink };

function pairLabel(cluster, letter, colour, yshift = 18) {
  return {
    x: cluster.x, y: cluster.y, showarrow: false, yshift,
    text: `<b>${letter}</b>  ${shortName(cluster.label)}`,
    font: LABEL_FONT,
    bgcolor: COLOURS.raised, bordercolor: colour, borderwidth: 1, borderpad: 5,
  };
}

/**
 * Topic labels: the selected pair always; with "show every topic name", other
 * topics too, dropping any that would overlap a bigger topic's label
 * (simple greedy pass in screen pixels, recomputed after zooming).
 */
function labelAnnotations(gd, prep, pair, showAll) {
  const xa = gd?._fullLayout?.xaxis;
  const ya = gd?._fullLayout?.yaxis;
  if (!xa || !ya) return [pairLabel(pair.a, "A", COLOURS.a), pairLabel(pair.b, "B", COLOURS.b)];

  const box = (c, text, yshift) => {
    const w = text.length * 7 + 14;
    const h = 24;
    const cx = xa.l2p(c.x);
    const cy = ya.l2p(c.y) - yshift;
    return { x0: cx - w / 2, x1: cx + w / 2, y0: cy - h / 2, y1: cy + h / 2 };
  };
  const hit = (r, o) => r.x0 < o.x1 && r.x1 > o.x0 && r.y0 < o.y1 && r.y1 > o.y0;
  const textA = `A  ${shortName(pair.a.label)}`;
  const textB = `B  ${shortName(pair.b.label)}`;
  // If the pair's own labels collide, put the upper one above its centre and the lower one below.
  let shiftA = 18, shiftB = 18;
  if (hit(box(pair.a, textA, shiftA), box(pair.b, textB, shiftB))) {
    const aHigher = ya.l2p(pair.a.y) <= ya.l2p(pair.b.y);
    shiftA = aHigher ? 20 : -20;
    shiftB = aHigher ? -20 : 20;
  }
  const out = [pairLabel(pair.a, "A", COLOURS.a, shiftA), pairLabel(pair.b, "B", COLOURS.b, shiftB)];
  if (!showAll) return out;
  const boxes = [box(pair.a, textA, shiftA), box(pair.b, textB, shiftB)];
  const overlaps = (r) => boxes.some((o) => hit(r, o));

  const [px0, px1] = [0, xa._length];
  const [py0, py1] = [0, ya._length];
  const rest = Object.values(prep.byId)
    .filter((c) => c.id !== pair.a.id && c.id !== pair.b.id)
    .sort((x, y) => y.size - x.size);
  for (const c of rest) {
    const text = shortName(c.label);
    const r = box(c, text, 0);
    if (r.x1 < px0 || r.x0 > px1 || r.y1 < py0 || r.y0 > py1) continue; // off screen
    if (overlaps(r)) continue;
    boxes.push(r);
    out.push({
      x: c.x, y: c.y, showarrow: false, text,
      font: { ...LABEL_FONT, color: COLOURS.muted },
      bgcolor: "rgba(26,26,25,0.85)", bordercolor: COLOURS.hairline, borderwidth: 1, borderpad: 4,
    });
  }
  return out;
}

function buildTraces(prep, gaps, selected, pair, v, showNoise, sizes) {
  const gap = gaps[selected];
  const { noise, others, pair: focus, halo, pairOutline, newcomer } = MAP_STYLE;
  return [
    { ...paperTrace(v.noise, { size: sizes.noise, color: noise.color, opacity: noise.opacity, uid: "noise" }), visible: showNoise },
    paperTrace(v.others, { size: sizes.others, color: others.color, opacity: others.opacity, uid: "others" }),
    paperTrace(v.inA, { size: sizes.halo, color: COLOURS.a, opacity: halo.opacity, uid: "halo-a", halo: true }),
    paperTrace(v.inB, { size: sizes.halo, color: COLOURS.b, opacity: halo.opacity, uid: "halo-b", halo: true }),
    paperTrace(v.inA, { size: sizes.pair, color: COLOURS.a, opacity: focus.opacity, uid: "topic-a", line: pairOutline }),
    paperTrace(v.inB, { size: sizes.pair, color: COLOURS.b, opacity: focus.opacity, uid: "topic-b", line: pairOutline }),
    { // dashed link: topic A centre -> gap -> topic B centre
      type: "scatter", mode: "lines", uid: "link",
      x: [pair.a.x, gap.x, pair.b.x], y: [pair.a.y, gap.y, pair.b.y],
      line: { color: COLOURS.gap, width: 1.5, dash: "dash" }, opacity: 0.85,
      hoverinfo: "skip",
    },
    { // every gap, numbered by rank, sized by score
      type: "scatter", mode: "markers+text", uid: "stars",
      x: gaps.map((g) => g.x), y: gaps.map((g) => g.y),
      text: gaps.map((g) => String(g.rank)), textposition: "top center",
      textfont: { family: FONT_MONO, size: 10, color: gaps.map((_, i) => (i === selected ? "rgba(0,0,0,0)" : COLOURS.muted)) },
      marker: { symbol: "star", color: COLOURS.gap, size: prep.starSizes, line: { width: 1, color: COLOURS.card } },
      customdata: gaps.map((g) => [g.rank, shortName(prep.byId[g.cluster_a]?.label), shortName(prep.byId[g.cluster_b]?.label), g.score.toFixed(2)]),
      hovertemplate: "<b>Gap #%{customdata[0]}</b><br>%{customdata[1]} ↔ %{customdata[2]}<br><span style='color:#a09e98'>Score</span> %{customdata[3]}<extra></extra>",
    },
    { // pulsing ring behind the selected star (animation in CSS)
      type: "scatter", mode: "markers", uid: "selring", x: [gap.x], y: [gap.y],
      marker: { symbol: "circle-open", size: 34, color: COLOURS.gap, line: { width: 1.5, color: COLOURS.gap } },
      hoverinfo: "skip",
    },
    { // the selected star, bigger and glowing (glow in CSS)
      type: "scatter", mode: "markers+text", uid: "selstar", x: [gap.x], y: [gap.y],
      text: [String(gap.rank)], textposition: "top center",
      textfont: { family: FONT_MONO, size: 12, color: COLOURS.ink },
      marker: { symbol: "star", size: 24, color: COLOURS.gap, line: { width: 1.5, color: COLOURS.ink } },
      hoverinfo: "skip",
    },
    { // paper highlighted from a reading-list card
      type: "scatter", mode: "markers", uid: "paper-hl", x: [], y: [],
      marker: { size: 16, color: "rgba(240,239,236,0.25)", line: { width: 2, color: COLOURS.ink } },
      hoverinfo: "skip",
    },
    { // timeline: ring around papers published in the current year
      ...paperTrace(v.newcomers, { size: sizes.newcomer, color: newcomer.color, opacity: 0.9, uid: "newcomers", halo: true }),
      marker: { symbol: "circle-open", size: sizes.newcomer, color: newcomer.color, opacity: 0.9, line: { width: newcomer.width } },
    },
  ];
}

/** The interactive map: papers as dots, gaps as numbered stars. */
export default function MapView({
  data, selected, onSelectGap, showNoise, showAllNames, highlightPaper, toolbar, showHint, dotSize = "M",
  playhead = null, overlay,
}) {
  const container = useRef(null);
  const plotted = useRef(null); // { field, selected } currently drawn
  const ready = useRef(Promise.resolve());
  const latest = useRef({});
  const [dragmode, setDragmode] = useState("pan");
  const [card, setCard] = useState(null); // { id, x, y }: the paper card pinned where its dot was clicked
  const [legendOpen, setLegendOpen] = useState(() => window.innerWidth >= 768);

  const prep = useMemo(() => prepare(data), [data]);
  const pair = useMemo(() => pairOf(prep, data.gaps[selected] ?? data.gaps[0]), [prep, data, selected]);
  useEffect(() => {
    latest.current = {
      prep, pair, showAllNames, onSelectGap, dotScale: DOT_SCALES[dotSize] ?? 1, playhead, showNoise,
    };
  });

  // Marker sizes = dot-size setting x a modest zoom growth (one batched restyle).
  const appliedSize = useRef(null);
  const applySizes = useRef(() => {});
  applySizes.current = () => {
    const gd = container.current;
    const r = currentRanges(gd);
    if (!r) return;
    const { prep: p, dotScale } = latest.current;
    const scale = dotScale * zoomGrowth(p.full.x[1] - p.full.x[0], r.x[1] - r.x[0]);
    if (appliedSize.current && Math.abs(appliedSize.current - scale) < 0.02) return;
    appliedSize.current = scale;
    return Plotly.restyle(gd, { "marker.size": sizesFor(dotSizes(scale)) }, SIZED);
  };

  // Re-place labels (after zooming, or when the toggle changes).
  const refreshLabels = useRef(() => {});
  refreshLabels.current = () => {
    const gd = container.current;
    if (!gd?._fullLayout) return;
    const { prep: p, pair: pr, showAllNames: all } = latest.current;
    Plotly.relayout(gd, { annotations: labelAnnotations(gd, p, pr, all) });
  };

  // 1. New topic: draw the whole figure once.
  useEffect(() => {
    const gd = container.current;
    const layout = {
      autosize: true,
      margin: { l: 0, r: 0, t: 0, b: 0 },
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "rgba(0,0,0,0)",
      font: { family: FONT_UI, color: COLOURS.ink },
      showlegend: false,
      dragmode,
      hovermode: "closest",
      hoverlabel: {
        bgcolor: COLOURS.raised, bordercolor: "#3a3a37",
        font: { family: FONT_UI, size: 12, color: COLOURS.ink }, align: "left",
      },
      // The map's x/y have no units, so hide the axes entirely.
      xaxis: { visible: false, range: prep.full.x },
      yaxis: { visible: false, range: prep.full.y, scaleanchor: "x" }, // keep the map's proportions
      annotations: [],
    };
    const config = { displayModeBar: false, displaylogo: false, scrollZoom: true, responsive: true, doubleClick: false };
    const scale = DOT_SCALES[dotSize] ?? 1;
    appliedSize.current = scale;
    const traces = buildTraces(
      prep, data.gaps, selected, pair, visibleOf(prep, pair, playhead, showNoise), showNoise, dotSizes(scale),
    );
    plotted.current = { field: data.field, selected };
    drawnPlayhead.current = `${playhead}|${showNoise}`;

    let timer;
    ready.current = Plotly.newPlot(gd, traces, layout, config).then(() => {
      gd.removeAllListeners?.("plotly_click");
      gd.removeAllListeners?.("plotly_relayout");
      gd.on("plotly_click", (event) => {
        const star = event.points.find((p) => p.curveNumber === T.STARS);
        if (star) {
          latest.current.onSelectGap(star.pointIndex);
          return;
        }
        const point = event.points.find((p) => PAPER_TRACES.has(p.curveNumber));
        const id = point?.customdata?.[3];
        if (!id) return;
        const e = event.event;
        if (e?.metaKey || e?.ctrlKey) {
          // Cmd/Ctrl-click: straight to arXiv, no card.
          window.open(arxivUrl(id), "_blank", "noopener,noreferrer");
          return;
        }
        const r = gd.getBoundingClientRect();
        Plotly.Fx.unhover(gd); // the card replaces the hover box (which lingers after a tap)
        setCard({ id, x: e.clientX - r.left, y: e.clientY - r.top });
      });
      gd.on("plotly_relayout", (event) => {
        const zoomed = Object.keys(event).some((k) => k.startsWith("xaxis.range") || k.startsWith("yaxis.range"));
        if (!zoomed) return;
        setCard(null); // the card is pinned to a screen position: close it on pan/zoom
        if (gd.__flying) return;
        clearTimeout(timer);
        timer = setTimeout(() => {
          refreshLabels.current();
          applySizes.current();
        }, 120);
      });
      refreshLabels.current();
    });
    return () => clearTimeout(timer);
    // Only a new topic redraws everything; the effects below update in place.
  }, [prep]); // eslint-disable-line react-hooks/exhaustive-deps

  // 2. Selection changed: restyle the affected traces in place, then fly to the pair.
  useEffect(() => {
    const gd = container.current;
    const drawn = plotted.current;
    if (!drawn || drawn.field !== data.field || drawn.selected === selected) return;
    plotted.current = { field: data.field, selected };
    const gap = data.gaps[selected];
    ready.current = ready.current.then(async () => {
      const { playhead: ph, showNoise: sn } = latest.current;
      await Plotly.restyle(gd, timedUpdate(visibleOf(prep, pair, ph, sn)), TIMED);
      await Plotly.restyle(
        gd,
        {
          x: [[pair.a.x, gap.x, pair.b.x], [gap.x], [gap.x]],
          y: [[pair.a.y, gap.y, pair.b.y], [gap.y], [gap.y]],
          text: [undefined, undefined, [String(gap.rank)]],
        },
        [T.LINK, T.RING, T.SELECTED],
      );
      await Plotly.restyle(
        gd,
        { "textfont.color": [data.gaps.map((_, i) => (i === selected ? "rgba(0,0,0,0)" : COLOURS.muted))] },
        [T.STARS],
      );
      refreshLabels.current();
      await flyTo(gd, boundsOf([...pair.inA, ...pair.inB, gap], 0.15), 600);
      refreshLabels.current();
      await applySizes.current();
    });
  }, [selected, pair, data, prep]);

  // 3. Toggles and highlights: small in-place updates.
  useEffect(() => {
    ready.current = ready.current.then(() => Plotly.restyle(container.current, { visible: showNoise }, [T.NOISE]));
  }, [showNoise]);
  useEffect(() => {
    ready.current = ready.current.then(() => refreshLabels.current());
  }, [showAllNames]);
  // 4. Timeline: show only papers published up to the playhead (one batched restyle).
  // Axis ranges stay fixed, so the camera never moves while scrubbing.
  const drawnPlayhead = useRef(`${playhead}|${showNoise}`);
  useEffect(() => {
    const key = `${playhead}|${showNoise}`; // newcomer rings include unclustered papers only when shown
    if (drawnPlayhead.current === key) return;
    drawnPlayhead.current = key;
    ready.current = ready.current.then(() => {
      const { prep: p, pair: pr, showNoise: sn } = latest.current;
      return Plotly.restyle(container.current, timedUpdate(visibleOf(p, pr, playhead, sn)), TIMED);
    });
  }, [playhead, showNoise]);

  useEffect(() => {
    const id = highlightPaper ?? card?.id; // reading-list hover wins, else the open card's paper
    const found = id ? prep.byArxiv[id] : null;
    // A paper hidden by the timeline isn't highlighted.
    const p = found && (playhead == null || found.year <= playhead) ? found : null;
    ready.current = ready.current.then(() =>
      Plotly.restyle(container.current, { x: [p ? [p.x] : []], y: [p ? [p.y] : []] }, [T.PAPER]),
    );
  }, [highlightPaper, card, prep, playhead]);

  // Close the card when the topic, selected gap or timeline year changes.
  useEffect(() => setCard(null), [prep, selected, playhead]);
  useEffect(() => {
    ready.current = ready.current.then(() => Plotly.relayout(container.current, { dragmode }));
  }, [dragmode]);
  useEffect(() => {
    ready.current = ready.current.then(() => applySizes.current());
  }, [dotSize]);

  // Resize with the container (panels collapse/expand without a window resize),
  // and free Plotly's memory when the map is removed from the page.
  useEffect(() => {
    const element = container.current;
    let frame;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => element.data && Plotly.Plots.resize(element));
    });
    observer.observe(element);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      Plotly.purge(element);
    };
  }, []);

  const gd = () => container.current;
  const gap = data.gaps[selected];

  return (
    <>
      <div
        ref={container}
        className="map"
        role="img"
        aria-label={
          `Map of ${data.papers.length} papers in ${data.clusters.length} topics. ` +
          `Numbered stars mark research gaps; gap ${gap.rank} (${shortName(pair.a.label)} and ${shortName(pair.b.label)}) is selected. ` +
          "The same gaps are listed in the Gaps panel and in Compare all gaps. " +
          (playhead == null
            ? "The timeline below the map can show how the map grew year by year."
            : `Timeline: showing only papers published up to ${playhead}.`)
        }
      />

      <div className="map-overlay-tl">
        {toolbar}
        <div className="legend float">
          <button
            type="button"
            className="legend-toggle"
            aria-expanded={legendOpen}
            onClick={() => setLegendOpen((o) => !o)}
          >
            <Icon name="layers" />
            <span>Legend</span>
            <Icon name="chevronDown" className="legend-chevron" />
          </button>
          {legendOpen && (
            <ul className="legend-items">
              <li><span className="lg-dot lg-a" aria-hidden="true" /><b>A</b> {shortName(pair.a.label)}</li>
              <li><span className="lg-dot lg-b" aria-hidden="true" /><b>B</b> {shortName(pair.b.label)}</li>
              <li><StarGlyph size={12} className="lg-star" />Research gap</li>
              <li><span className="lg-dot lg-other" aria-hidden="true" />Other papers</li>
              {showNoise && <li><span className="lg-dot lg-noise" aria-hidden="true" />Unclustered</li>}
            </ul>
          )}
        </div>
      </div>

      {showHint && (
        <p className="map-hint float" aria-hidden="true">
          <StarGlyph size={12} className="lg-star" /> Click a star or pick a gap
        </p>
      )}

      <div className="map-controls float" role="toolbar" aria-label="Map view">
        <IconButton icon="plus" label="Zoom in" onClick={() => zoomBy(gd(), 0.6)} />
        <IconButton icon="minus" label="Zoom out" onClick={() => zoomBy(gd(), 1 / 0.6)} />
        <IconButton icon="reset" label="Reset view" onClick={() => flyTo(gd(), prep.full, 600)} />
        <span className="map-controls-sep" aria-hidden="true" />
        <IconButton
          icon={dragmode === "pan" ? "move" : "box"}
          label={dragmode === "pan" ? "Drag mode: pan (switch to box zoom)" : "Drag mode: box zoom (switch to pan)"}
          aria-pressed={dragmode === "zoom"}
          onClick={() => setDragmode((m) => (m === "pan" ? "zoom" : "pan"))}
        />
      </div>
      {overlay}
      {card && prep.byArxiv[card.id] && (
        <PaperCard
          paper={prep.byArxiv[card.id]}
          topic={prep.byId[prep.byArxiv[card.id].cluster_id]}
          group={
            prep.byArxiv[card.id].cluster_id === pair.a.id ? "a"
              : prep.byArxiv[card.id].cluster_id === pair.b.id ? "b" : null
          }
          x={card.x}
          y={card.y}
          bounds={container.current?.getBoundingClientRect()}
          onClose={() => setCard(null)}
        />
      )}
    </>
  );
}
