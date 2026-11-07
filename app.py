"""Research Gap Finder: Streamlit + Plotly UI.

Run with:
    streamlit run app.py

Type any topic to build its map (about a minute for a new topic), or pick one
already built. Shows the papers as a 2D map, marks the gaps between related
topics, and shows a dissertation idea for the selected gap.
"""

import json
import textwrap

import pandas as pd
import plotly.graph_objects as go
import streamlit as st
from sqlmodel import Session, select

from db import Cluster, Gap, Paper, engine
from pipeline import run

st.set_page_config(page_title="Research Gap Finder", layout="wide")

# Colours for light and dark mode. Only the two selected topics and the gaps
# get strong colours; everything else stays grey so the gaps stand out.
PALETTES = {
    "light": {"a": "#2a78d6", "b": "#eb6834", "gap": "#1baf7a", "papers": "#898781",
              "noise": "#c3c2b7", "ink": "#0b0b0b", "muted": "#52514e", "ring": "#fcfcfb"},
    "dark": {"a": "#3987e5", "b": "#d95926", "gap": "#199e70", "papers": "#898781",
             "noise": "#52514e", "ink": "#f0efec", "muted": "#c3c2b7", "ring": "#1a1a19"},
}

# The map always has these traces in this order, so a click on trace 5 is a gap.
GAP_TRACE = 5


# --- Data -------------------------------------------------------------------

@st.cache_data(ttl=300)  # re-read the database at most every 5 minutes
def load_topics() -> list[dict]:
    return run.list_topics()


@st.cache_data(ttl=300)
def load_field(field: str) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    with Session(engine) as session:
        papers = session.exec(
            select(Paper.arxiv_id, Paper.title, Paper.published, Paper.x, Paper.y, Paper.cluster_id)
            .where(Paper.field == field, Paper.x.is_not(None))
        ).all()
        clusters = session.exec(select(Cluster).where(Cluster.field == field)).all()
        gaps = session.exec(select(Gap).where(Gap.field == field).order_by(Gap.score.desc())).all()
    return (
        pd.DataFrame([p._asdict() for p in papers]),
        pd.DataFrame([c.model_dump() for c in clusters]),
        pd.DataFrame([g.model_dump() for g in gaps]),
    )


def short_name(label: str) -> str:
    """First keyword of a cluster label: "sea ice · arctic · sic" -> "sea ice"."""
    return label.split(" · ")[0]


# --- Map --------------------------------------------------------------------

def paper_trace(df: pd.DataFrame, name: str, colour: str, size: int, opacity: float, labels: dict) -> go.Scattergl:
    # Hover text: wrapped title, year and topic.
    hover = pd.DataFrame({
        "title": df["title"].map(lambda t: "<br>".join(textwrap.wrap(t, 60))),
        "year": df["published"].map(lambda d: d.year),
        "topic": df["cluster_id"].map(lambda c: labels.get(c, "Unclustered")),
    })
    return go.Scattergl(
        x=df["x"], y=df["y"], mode="markers", name=name,
        marker=dict(size=size, color=colour, opacity=opacity),
        customdata=hover.values,
        hovertemplate="<b>%{customdata[0]}</b><br>%{customdata[1]} · %{customdata[2]}<extra></extra>",
    )


def build_map(papers, clusters, gaps, selected, colours, show_noise, show_all_names) -> go.Figure:
    labels = dict(zip(clusters["id"], clusters["label"]))
    gap = gaps.iloc[selected]
    a, b = gap["cluster_a"], gap["cluster_b"]

    noise = papers[papers["cluster_id"].isna()] if show_noise else papers.iloc[0:0]
    clustered = papers[papers["cluster_id"].notna()]
    in_a = clustered[clustered["cluster_id"] == a]
    in_b = clustered[clustered["cluster_id"] == b]
    others = clustered[~clustered["cluster_id"].isin([a, b])]
    centre = clusters.set_index("id")[["centroid_x", "centroid_y"]]

    fig = go.Figure()
    # Traces 0-4: papers and the link line. Always added (even if empty) so the
    # gap trace keeps the same position: see GAP_TRACE.
    fig.add_trace(paper_trace(noise, "Unclustered paper", colours["noise"], 5, 0.5, labels))
    fig.add_trace(paper_trace(others, "Paper in another topic", colours["papers"], 5, 0.45, labels))
    fig.add_trace(paper_trace(in_a, f"Topic A: {short_name(labels[a])}", colours["a"], 7, 0.9, labels))
    fig.add_trace(paper_trace(in_b, f"Topic B: {short_name(labels[b])}", colours["b"], 7, 0.9, labels))
    fig.add_trace(go.Scatter(  # dashed line: topic A centre -> gap -> topic B centre
        x=[centre.loc[a, "centroid_x"], gap["x"], centre.loc[b, "centroid_x"]],
        y=[centre.loc[a, "centroid_y"], gap["y"], centre.loc[b, "centroid_y"]],
        mode="lines", line=dict(color=colours["ink"], width=2, dash="dot"),
        opacity=0.6, hoverinfo="skip", showlegend=False,
    ))

    # Trace 5: gaps, numbered by rank. The selected one is bigger.
    gap_hover = [
        f"<b>Gap #{i + 1}</b><br>{short_name(labels[g.cluster_a])} ↔ {short_name(labels[g.cluster_b])}"
        f"<br>Score {g.score:.2f}<br><i>Click to open</i>"
        for i, g in enumerate(gaps.itertuples())
    ]
    fig.add_trace(go.Scatter(
        x=gaps["x"], y=gaps["y"], mode="markers+text", name="Research gap (click one)",
        text=[str(i + 1) for i in range(len(gaps))], textposition="top center",
        textfont=dict(color=colours["ink"], size=12),
        marker=dict(
            symbol="star", color=colours["gap"],
            size=[26 if i == selected else 15 for i in range(len(gaps))],
            line=dict(color=[colours["ink"] if i == selected else colours["ring"] for i in range(len(gaps))], width=2),
        ),
        hovertext=gap_hover, hovertemplate="%{hovertext}<extra></extra>",
    ))

    # Topic names on the map: always for A and B, optionally for every topic.
    names = clusters if show_all_names else clusters[clusters["id"].isin([a, b])]
    for row in names.itertuples():
        highlighted = row.id in (a, b)
        fig.add_annotation(
            x=row.centroid_x, y=row.centroid_y, text=short_name(row.label), showarrow=False,
            font=dict(size=13 if highlighted else 10, color=colours["ink"] if highlighted else colours["muted"]),
            bgcolor=colours["ring"] if highlighted else None, opacity=0.95 if highlighted else 0.8,
        )

    # The map's x/y have no units (UMAP), so hide the axes entirely.
    hidden_axis = dict(showgrid=False, zeroline=False, showticklabels=False, title=None)
    fig.update_layout(
        height=680, margin=dict(l=0, r=0, t=40, b=0),
        legend=dict(orientation="h", yanchor="bottom", y=1.0, x=0),
        xaxis=hidden_axis, yaxis={**hidden_axis, "scaleanchor": "x"},  # keep the map's proportions
        hoverlabel=dict(align="left"),
    )
    return fig


def on_map_click() -> None:
    """When a gap star is clicked, select that gap in the dropdown."""
    points = st.session_state["map"]["selection"]["points"]
    gap_points = [p for p in points if p.get("curve_number") == GAP_TRACE]
    if gap_points:
        st.session_state["gap_pick"] = gap_points[0]["point_index"]


# --- Page -------------------------------------------------------------------

theme = getattr(getattr(st.context, "theme", None), "type", None) or "light"
colours = PALETTES.get(theme, PALETTES["light"])

st.title("Research Gap Finder")
st.caption(
    "Every dot is a research paper; similar papers sit close together. "
    "Stars mark unexplored territory between related topics: possible dissertation ideas."
)

topics = load_topics()
built = {t["field"]: t for t in topics if t["clusters"] > 0}  # only topics with a finished map
if "pending_field" in st.session_state:  # a map was just built: show it
    st.session_state["field"] = st.session_state.pop("pending_field")
    st.session_state["gap_pick"] = 0
if st.session_state.get("field") not in built:  # e.g. first visit
    st.session_state.pop("field", None)

with st.sidebar:
    st.header("Map a new topic")
    with st.form("new_topic"):
        new_topic = st.text_input("Topic", placeholder="e.g. wildfire, protein folding, quantum error correction")
        category_name = st.selectbox("arXiv category (optional)", ["Any"] + list(run.CATEGORIES))
        max_papers = st.slider(
            "Papers to download", 200, 1500, run.DEFAULT_MAX_PAPERS, step=100,
            help="More papers give a richer map but take longer: about 2 minutes for 600 new papers, "
                 "including a literature check of the top gaps.",
        )
        build_clicked = st.form_submit_button("Build map", type="primary")

    st.header("Explore")
    field = None
    if built:
        field = st.selectbox(
            "Mapped topic", list(built), key="field",
            format_func=lambda f: f"{built[f]['name']} ({built[f]['papers']:,} papers)",
            on_change=lambda: st.session_state.update(gap_pick=0),  # start at gap #1 in a new topic
        )
    show_all_names = st.toggle("Show every topic name", value=False)
    show_noise = st.toggle("Show unclustered papers", value=True)
    with st.expander("How gaps are found"):
        st.markdown(
            "1. Papers are turned into vectors from their title and abstract, then "
            "placed on a 2D map so similar papers sit together.\n"
            "2. Groups of nearby papers become **topics**.\n"
            "3. For each pair of neighbouring topics we check how **related** they are "
            "and how **empty** the space between them is.\n"
            "4. Map score = relatedness × emptiness: two related topics that few papers connect.\n"
            "5. Each candidate is then **validated**: it should apply one *method* to one *problem "
            "domain*; it's boosted if 5–100 arXiv papers already mention both (a viable niche) and "
            "demoted if over 500 do (saturated); pairs with no papers are flagged for a human to "
            "check; and pairs touching a strategic funding area rank higher."
        )

# Build a new topic: runs the whole pipeline here, with a progress bar.
if build_clicked and new_topic.strip():
    with st.status(f"Building a map for '{new_topic.strip()}'...", expanded=True) as status:
        bar = st.progress(0.0, text="Starting...")
        last = {"fraction": 0.0}

        def show_progress(message: str, fraction: float | None = None) -> None:
            if fraction is not None:
                last["fraction"] = min(max(fraction, 0.0), 1.0)
            bar.progress(last["fraction"], text=message)

        try:
            new_field = run.run_topic(
                new_topic, run.CATEGORIES.get(category_name), max_papers, progress=show_progress
            )
        except run.PipelineError as error:
            status.update(label="Couldn't build this map", state="error")
            st.error(str(error))
        except Exception as error:  # network problems etc.: show it rather than crash the page
            status.update(label="Something went wrong", state="error")
            st.error(f"Something went wrong while building the map ({type(error).__name__}: {error}).")
        else:
            status.update(label="Map ready!", state="complete")
            load_topics.clear()
            load_field.clear()
            # The topic dropdown is already drawn, so it can't change now: hand
            # the new topic to the next run, which selects it before drawing.
            st.session_state["pending_field"] = new_field
            st.rerun()
elif build_clicked:
    st.warning("Type a topic first.")

if field is None:
    st.info("No maps yet. Type a topic in the sidebar and click **Build map**.")
    st.stop()

papers, clusters, gaps = load_field(field)
if clusters.empty or gaps.empty:
    st.info(f"'{built[field]['name']}' has no gaps yet. Try rebuilding it or picking another topic.")
    st.stop()

labels = dict(zip(clusters["id"], clusters["label"]))
gap_names = [
    f"#{i + 1}  {short_name(labels[g.cluster_a])} ↔ {short_name(labels[g.cluster_b])}"
    for i, g in enumerate(gaps.itertuples())
]
if st.session_state.get("gap_pick", 0) >= len(gaps):  # e.g. after switching field
    st.session_state["gap_pick"] = 0

m1, m2, m3, m4 = st.columns(4)
m1.metric("Papers", f"{len(papers):,}")
m2.metric("Topics", len(clusters))
m3.metric("Gaps found", len(gaps))
m4.metric("Published", f"{papers['published'].min().year}–{papers['published'].max().year}")

map_col, detail_col = st.columns([3, 2], gap="large")

with detail_col:
    selected = st.selectbox(
        "Research gap", range(len(gaps)), format_func=lambda i: gap_names[i], key="gap_pick",
        help="Ranked by score. You can also click a star on the map.",
    )
    gap = gaps.iloc[selected]
    category = dict(zip(clusters["id"], clusters["category"])) if "category" in clusters else {}
    kind = {"Problem_Domain": "problem domain", "Methodological_Tool": "method", "Unclassified": "unclassified"}

    def topic_line(name: str, cluster_id: int, colour: str) -> str:
        tag = f" `{kind.get(category.get(cluster_id), '')}`" if category.get(cluster_id) else ""
        return f"<span style='color:{colour}; font-size:1.2em'>●</span> **{name}:** {labels[cluster_id]}{tag}"

    # Coloured dots match the map; the text itself stays in normal ink.
    st.markdown(
        topic_line("Topic A", gap["cluster_a"], colours["a"]) + "<br>"
        + topic_line("Topic B", gap["cluster_b"], colours["b"]),
        unsafe_allow_html=True,
    )
    best_score = max(float(gaps["score"].max()), 1e-9)  # bar is relative to the best gap
    base = gap.get("base_score")
    st.progress(
        min(float(gap["score"]) / best_score, 1.0),
        text=f"Gap score {gap['score']:.2f}" + (f" (map score {base:.2f} before validation)" if pd.notna(base) else ""),
    )
    if isinstance(gap.get("reasons"), str):
        status = {"promoted": "Promoted", "demoted": "Demoted", "neutral": "Neutral",
                  "needs_review": "Needs human review"}.get(gap.get("status"), gap.get("status"))
        with st.expander(f"Why it ranks here: {status}", expanded=gap.get("status") == "needs_review"):
            st.markdown("\n".join(f"- {r}" for r in json.loads(gap["reasons"])))
            if pd.notna(gap.get("literature_count")):
                st.caption(f"{int(gap['literature_count']):,} arXiv papers already mention both topics.")
    with st.container(border=True):
        st.markdown(gap["proposal"] or "_No proposal written yet._")

with map_col:
    fig = build_map(papers, clusters, gaps, selected, colours, show_noise, show_all_names)
    st.plotly_chart(
        fig, width="stretch", key="map",
        on_select=on_map_click, selection_mode="points",
        config={"displaylogo": False, "scrollZoom": True},
    )

st.subheader("All gaps")
table = pd.DataFrame({
    "Rank": range(1, len(gaps) + 1),
    "Topic A": gaps["cluster_a"].map(labels),
    "Topic B": gaps["cluster_b"].map(labels),
    "Score": gaps["score"],
    "Papers on both": gaps.get("literature_count"),
    "Status": gaps.get("status"),
})
st.dataframe(
    table, hide_index=True, width="stretch",
    column_config={"Score": st.column_config.ProgressColumn(
        "Score", min_value=0, max_value=float(gaps["score"].max()), format="%.2f")},
)

with st.expander(f"All {len(clusters)} topics"):
    topics = clusters.sort_values("size", ascending=False)[["label", "size"]]
    st.dataframe(topics.rename(columns={"label": "Topic", "size": "Papers"}), hide_index=True, width="stretch")
