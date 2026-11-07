import { useEffect, useRef } from "react";
import Plotly from "plotly.js-dist-min";
import { shortName } from "../theme.js";

// Traces are always added in the same order, so trace 5 is always the gaps.
const GAP_TRACE = 5;

/** Split a long title into lines for the hover box. */
function wrap(text, width = 60) {
  const lines = [""];
  for (const word of text.split(" ")) {
    const last = lines.length - 1;
    if (lines[last] && (lines[last] + " " + word).length > width) lines.push(word);
    else lines[last] = lines[last] ? `${lines[last]} ${word}` : word;
  }
  return lines.join("<br>");
}

function paperTrace(papers, name, color, size, opacity, labelOf) {
  return {
    type: "scattergl", // WebGL: fast with thousands of points
    mode: "markers",
    name,
    x: papers.map((p) => p.x),
    y: papers.map((p) => p.y),
    marker: { size, color, opacity },
    customdata: papers.map((p) => [wrap(p.title), p.year, labelOf(p.cluster_id)]),
    hovertemplate: "<b>%{customdata[0]}</b><br>%{customdata[1]} · %{customdata[2]}<extra></extra>",
  };
}

/** The interactive map: papers as dots, gaps as numbered stars. */
export default function MapView({ data, selected, onSelectGap, showNoise, showAllNames, colours }) {
  const container = useRef(null);

  useEffect(() => {
    const { papers, clusters, gaps } = data;
    const byId = Object.fromEntries(clusters.map((c) => [c.id, c]));
    const labelOf = (id) => (id == null ? "Unclustered" : byId[id]?.label ?? "");
    const gap = gaps[selected];
    const a = byId[gap.cluster_a];
    const b = byId[gap.cluster_b];

    const noise = showNoise ? papers.filter((p) => p.cluster_id == null) : [];
    const inA = papers.filter((p) => p.cluster_id === a.id);
    const inB = papers.filter((p) => p.cluster_id === b.id);
    const others = papers.filter((p) => p.cluster_id != null && p.cluster_id !== a.id && p.cluster_id !== b.id);

    const traces = [
      paperTrace(noise, "Unclustered paper", colours.noise, 5, 0.5, labelOf),
      paperTrace(others, "Paper in another topic", colours.papers, 5, 0.45, labelOf),
      paperTrace(inA, `Topic A: ${shortName(a.label)}`, colours.a, 7, 0.9, labelOf),
      paperTrace(inB, `Topic B: ${shortName(b.label)}`, colours.b, 7, 0.9, labelOf),
      { // dotted line: topic A centre -> gap -> topic B centre
        type: "scatter", mode: "lines", x: [a.x, gap.x, b.x], y: [a.y, gap.y, b.y],
        line: { color: colours.ink, width: 2, dash: "dot" }, opacity: 0.6,
        hoverinfo: "skip", showlegend: false,
      },
      { // the gaps, numbered by rank; the selected one is bigger
        type: "scatter", mode: "markers+text", name: "Research gap (click one)",
        x: gaps.map((g) => g.x), y: gaps.map((g) => g.y),
        text: gaps.map((g) => String(g.rank)), textposition: "top center",
        textfont: { color: colours.ink, size: 12 },
        marker: {
          symbol: "star", color: colours.gap,
          size: gaps.map((_, i) => (i === selected ? 26 : 15)),
          line: { width: 2, color: gaps.map((_, i) => (i === selected ? colours.ink : colours.ring)) },
        },
        hovertext: gaps.map((g) =>
          `<b>Gap #${g.rank}</b><br>${shortName(byId[g.cluster_a].label)} ↔ ${shortName(byId[g.cluster_b].label)}` +
          `<br>Score ${g.score.toFixed(2)}<br><i>Click to open</i>`),
        hovertemplate: "%{hovertext}<extra></extra>",
      },
    ];

    // Topic names on the map: always for A and B, optionally for every topic.
    const named = showAllNames ? clusters : [a, b];
    const annotations = named.map((c) => {
      const highlighted = c.id === a.id || c.id === b.id;
      return {
        x: c.x, y: c.y, text: shortName(c.label), showarrow: false,
        font: { size: highlighted ? 13 : 10, color: highlighted ? colours.ink : colours.muted },
        bgcolor: highlighted ? colours.ring : undefined,
      };
    });

    // The map's x/y have no units, so hide the axes entirely.
    const hiddenAxis = { showgrid: false, zeroline: false, showticklabels: false };
    const layout = {
      autosize: true,
      margin: { l: 0, r: 0, t: 40, b: 0 },
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "rgba(0,0,0,0)",
      font: { family: "system-ui, -apple-system, 'Segoe UI', sans-serif", color: colours.ink },
      legend: { orientation: "h", yanchor: "bottom", y: 1.0, x: 0 },
      xaxis: hiddenAxis,
      yaxis: { ...hiddenAxis, scaleanchor: "x" }, // keep the map's proportions
      annotations,
      hoverlabel: { align: "left" },
      uirevision: data.field, // keep the user's zoom when only the selection changes
    };

    const config = { responsive: true, displaylogo: false, scrollZoom: true };
    Plotly.react(container.current, traces, layout, config).then((plot) => {
      plot.removeAllListeners("plotly_click");
      plot.on("plotly_click", (event) => {
        const point = event.points.find((p) => p.curveNumber === GAP_TRACE);
        if (point) onSelectGap(point.pointIndex);
      });
    });
  }, [data, selected, showNoise, showAllNames, colours, onSelectGap]);

  // Resize with the container (panels collapse/expand without a window resize),
  // and free Plotly's memory when the map is removed from the page.
  useEffect(() => {
    const element = container.current;
    const observer = new ResizeObserver(() => element.data && Plotly.Plots.resize(element));
    observer.observe(element);
    return () => {
      observer.disconnect();
      Plotly.purge(element);
    };
  }, []);

  return (
    <div
      ref={container}
      className="map"
      role="img"
      aria-label={`Map of ${data.papers.length} papers. Numbered stars mark research gaps; the gaps are also listed in the table below.`}
    />
  );
}
