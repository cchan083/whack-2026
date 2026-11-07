"""Build a research map for ANY topic: search arXiv, embed, cluster, find gaps.

Example:
    python -m pipeline.run --topic "coral reef monitoring" --max 600
    python -m pipeline.run --recluster --field wildfire   # redo topics + gaps, no download
    python -m pipeline.run --recluster --all

Both frontends (Streamlit app.py and the FastAPI backend) call run_topic().
A topic that was built before is not rebuilt (unless force=True).
"""

import argparse
import re
from contextlib import contextmanager

import arxiv
from sklearn.feature_extraction.text import ENGLISH_STOP_WORDS
from sqlalchemy import func, text
from sqlmodel import Session, select

from db import Cluster, Gap, Paper, engine, init_db
from pipeline import console_progress, embed_cluster, gaps, ingest

DEFAULT_MAX_PAPERS = 600  # about a minute for a new topic
MIN_PAPERS = 150  # fewer than this gives a meaningless map
LOCK_ID = 727001  # any fixed number: names "the pipeline" lock inside Postgres

# arXiv categories users can narrow a search to (display name -> arXiv code).
CATEGORIES = {
    "Machine learning (cs.LG)": "cs.LG",
    "Artificial intelligence (cs.AI)": "cs.AI",
    "Language & NLP (cs.CL)": "cs.CL",
    "Computer vision (cs.CV)": "cs.CV",
    "Robotics (cs.RO)": "cs.RO",
    "Computers & society (cs.CY)": "cs.CY",
    "Statistics ML (stat.ML)": "stat.ML",
    "Atmospheric & ocean physics (physics.ao-ph)": "physics.ao-ph",
    "Quantitative biology (q-bio.QM)": "q-bio.QM",
    "Econometrics (econ.EM)": "econ.EM",
    "Signal processing (eess.SP)": "eess.SP",
}


class PipelineError(Exception):
    """A problem the user can fix (e.g. too few papers). The message is shown to them."""


def field_for(topic: str, category: str | None = None) -> str:
    """Database label for a topic: "Coral reef monitoring" + cs.LG -> "coral-reef-monitoring__cs.LG"."""
    slug = re.sub(r"[^a-z0-9]+", "-", topic.lower()).strip("-")[:60]
    if not slug:
        raise PipelineError("Please enter a topic with at least one word.")
    return f"{slug}__{category}" if category else slug


def display_name(field: str) -> str:
    """Readable name for a field label: "coral-reef-monitoring__cs.LG" -> "coral reef monitoring (cs.LG)"."""
    slug, _, category = field.partition("__")
    name = slug.replace("-", " ")
    return f"{name} ({category})" if category else name


def build_query(topic: str, category: str | None = None) -> str:
    """arXiv search for a topic: every keyword must appear in the abstract.
    "coral reef monitoring" -> "abs:coral AND abs:reef AND abs:monitoring"."""
    words = [w for w in re.findall(r"[a-z0-9]+", topic.lower()) if w not in ENGLISH_STOP_WORDS]
    if not words:
        raise PipelineError("Please enter a topic with at least one keyword (not just words like 'the').")
    query = " AND ".join(f"abs:{w}" for w in words)
    return f"cat:{category} AND {query}" if category else query


def is_built(field: str) -> bool:
    with Session(engine) as session:
        return session.exec(select(func.count()).select_from(Cluster).where(Cluster.field == field)).one() > 0


def list_topics() -> list[dict]:
    """Every topic in the database with its paper, topic and gap counts, biggest first."""
    with Session(engine) as session:
        papers = dict(session.exec(select(Paper.field, func.count()).group_by(Paper.field)).all())
        clusters = dict(session.exec(select(Cluster.field, func.count()).group_by(Cluster.field)).all())
        gap_counts = dict(session.exec(select(Gap.field, func.count()).group_by(Gap.field)).all())
    topics = [
        {"field": f, "name": display_name(f), "papers": n,
         "clusters": clusters.get(f, 0), "gaps": gap_counts.get(f, 0)}
        for f, n in papers.items()
    ]
    return sorted(topics, key=lambda t: t["papers"], reverse=True)


@contextmanager
def pipeline_lock(progress):
    """Only build one topic at a time, because arXiv limits how fast we may download.
    A Postgres "advisory lock" works across processes, so Streamlit, the API and
    teammates' laptops all take turns."""
    with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
        if not conn.execute(text("SELECT pg_try_advisory_lock(:id)"), {"id": LOCK_ID}).scalar():
            progress("Another topic is being built. Waiting for it to finish...", None)
            conn.execute(text("SELECT pg_advisory_lock(:id)"), {"id": LOCK_ID})  # waits here
        try:
            yield
        finally:
            conn.execute(text("SELECT pg_advisory_unlock(:id)"), {"id": LOCK_ID})


def _stage(progress, start: float, end: float):
    """Map a step's own 0..1 progress onto its slice of the overall bar."""
    def report(message: str, fraction: float | None = None) -> None:
        progress(message, None if fraction is None else start + (end - start) * fraction)
    return report


def run_topic(
    topic: str,
    category: str | None = None,
    max_papers: int = DEFAULT_MAX_PAPERS,
    progress=console_progress,
    force: bool = False,
) -> str:
    """Build (or reuse) the map for a topic. Returns its field label.
    Raises PipelineError with a user-friendly message if it can't."""
    field = field_for(topic, category)
    query = build_query(topic, category)
    init_db()
    if not force and is_built(field):
        progress("This topic is already mapped.", 1.0)
        return field

    with pipeline_lock(progress):
        if not force and is_built(field):  # someone else built it while we waited
            progress("This topic is already mapped.", 1.0)
            return field

        progress(f"Searching arXiv for: {query}", 0.0)
        try:
            ingest.ingest(field, query, max_papers, sort="relevance", progress=_stage(progress, 0.0, 0.6))
        except arxiv.ArxivError:
            # arXiv sometimes fails part-way; keep going with what we have.
            progress("arXiv stopped responding part-way. Continuing with the papers downloaded so far.", 0.6)

        with Session(engine) as session:
            n_papers = session.exec(select(func.count()).select_from(Paper).where(Paper.field == field)).one()
        if n_papers < MIN_PAPERS:
            raise PipelineError(
                f"Only {n_papers} papers on arXiv match '{topic}' (need at least {MIN_PAPERS}). "
                "Try fewer or broader words, or a different category."
            )

        embed_cluster.embed_missing(field, progress=_stage(progress, 0.6, 0.75))
        clusters = embed_cluster.map_and_cluster(field, progress=_stage(progress, 0.75, 0.8))
        if len(clusters) < 2:
            raise PipelineError(
                f"The {n_papers} papers for '{topic}' are too similar to split into topics. Try a broader topic."
            )
        # The gaps step checks the literature for the top 20 candidates (arXiv
        # asks for 3 s between requests, so about a minute). Cached afterwards.
        gaps.find_gaps(field, max_lookups=20, progress=_stage(progress, 0.8, 1.0))

    progress("Done!", 1.0)
    return field


def recluster(field: str, progress=console_progress) -> None:
    """Redo the topics and gaps of an already-downloaded field with the current
    code, without downloading papers again. arXiv literature counts are cached
    in the database, so this is quick. Replaces the field's topics and gaps."""
    with pipeline_lock(progress):
        embed_cluster.embed_missing(field, progress=_stage(progress, 0.0, 0.1))
        clusters = embed_cluster.map_and_cluster(field, progress=_stage(progress, 0.1, 0.5))
        if len(clusters) < 2:
            raise PipelineError(f"'{field}' has too few distinct topics to find gaps.")
        gaps.find_gaps(field, max_lookups=20, progress=_stage(progress, 0.5, 1.0))
    progress("Done!", 1.0)


def main() -> None:
    parser = argparse.ArgumentParser(description="Build a research gap map for any topic.")
    parser.add_argument("--topic", help='e.g. "coral reef monitoring"')
    parser.add_argument("--category", default=None, help="Optional arXiv category, e.g. cs.LG")
    parser.add_argument("--max", type=int, default=DEFAULT_MAX_PAPERS, help="Max papers to download")
    parser.add_argument("--force", action="store_true", help="Rebuild even if the topic exists")
    parser.add_argument("--recluster", action="store_true",
                        help="Redo topics and gaps of existing maps (no download); use with --field or --all")
    parser.add_argument("--field", help='Existing map to recluster, e.g. "topology__cs.LG"')
    parser.add_argument("--all", action="store_true", help="With --recluster: every built map")
    args = parser.parse_args()

    if args.recluster:
        if not (args.field or args.all):
            parser.error("--recluster needs --field or --all")
        fields = [t["field"] for t in list_topics() if t["clusters"] > 0] if args.all else [args.field]
        for field in fields:
            print(f"\n== {field}")
            try:
                recluster(field)
            except PipelineError as error:
                print(f"Couldn't recluster '{field}': {error}")
        return
    if not args.topic:
        parser.error("--topic is required (or use --recluster)")
    try:
        field = run_topic(args.topic, args.category, args.max, force=args.force)
        print(f"Ready: field '{field}'")
    except PipelineError as error:
        print(f"Couldn't build the map: {error}")


if __name__ == "__main__":
    main()
