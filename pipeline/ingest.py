"""Download papers from arXiv and save them to the database.

Example:
    python -m pipeline.ingest --field "ml-climate" --query "cat:cs.LG AND abs:climate" --max 3000

Safe to re-run: papers already in this field are skipped, and each batch is
saved as it goes, so an interrupted run keeps what it already downloaded.
"""

import argparse

import arxiv
from sqlalchemy.dialects.postgresql import insert
from sqlmodel import Session, select

from db import Paper, engine, init_db
from pipeline import console_progress

BATCH_SIZE = 100  # papers saved to the database per insert
REPORT_EVERY = 25  # papers between progress updates


def clean(s: str) -> str:
    """arXiv titles/abstracts contain line breaks and double spaces; flatten them."""
    return " ".join(s.split())


def base_id(result: arxiv.Result) -> str:
    """'2301.01234v2' -> '2301.01234', so a new version of a paper isn't a duplicate."""
    return result.get_short_id().rsplit("v", 1)[0]


def save_batch(rows: list[dict]) -> None:
    if not rows:
        return
    # ON CONFLICT DO NOTHING: if the paper is already in this field, skip it instead of failing.
    stmt = insert(Paper).values(rows).on_conflict_do_nothing(index_elements=["arxiv_id", "field"])
    with Session(engine) as session:
        session.exec(stmt)
        session.commit()


def ingest(field: str, query: str, max_results: int, sort: str = "date", progress=console_progress) -> int:
    """Download up to max_results papers matching query into field.

    sort="date" takes the newest papers; sort="relevance" takes the best matches
    (better for short topic searches). Returns how many new papers were saved.
    """
    init_db()  # make sure the tables exist

    with Session(engine) as session:
        known_ids = set(session.exec(select(Paper.arxiv_id).where(Paper.field == field)).all())
    progress(f"{len(known_ids)} papers already saved for '{field}'.", 0.0)

    # The arxiv package pages through results and waits between requests
    # (delay_seconds), which is what arXiv's API rules ask for.
    client = arxiv.Client(page_size=100, delay_seconds=3, num_retries=5)
    search = arxiv.Search(
        query=query,
        max_results=max_results,
        sort_by=arxiv.SortCriterion.Relevance if sort == "relevance" else arxiv.SortCriterion.SubmittedDate,
    )

    seen = added = skipped = 0
    batch: list[dict] = []
    try:
        for result in client.results(search):
            seen += 1
            arxiv_id = base_id(result)
            if arxiv_id in known_ids:
                skipped += 1
            else:
                known_ids.add(arxiv_id)  # also catches repeats within this run
                batch.append(
                    {
                        "arxiv_id": arxiv_id,
                        "title": clean(result.title),
                        "abstract": clean(result.summary),
                        "published": result.published.date(),
                        "field": field,
                    }
                )
                if len(batch) >= BATCH_SIZE:
                    save_batch(batch)
                    added += len(batch)
                    batch = []
            if seen % REPORT_EVERY == 0:
                progress(f"Downloaded {seen}/{max_results} papers ({skipped} already saved)", seen / max_results)
    finally:
        # Save whatever is left, even if the download stopped part-way.
        save_batch(batch)
        added += len(batch)
        progress(f"Saved {added} new papers, skipped {skipped} already saved.", 1.0)
    return added


def main() -> None:
    parser = argparse.ArgumentParser(description="Download arXiv papers into the database.")
    parser.add_argument("--field", required=True, help='Label for this dataset, e.g. "ml-climate"')
    parser.add_argument("--query", required=True, help='arXiv query, e.g. "cat:cs.LG AND abs:climate"')
    parser.add_argument("--max", type=int, default=3000, dest="max_results", help="Max papers to fetch")
    parser.add_argument("--relevance", action="store_true", help="Take best matches instead of newest papers")
    args = parser.parse_args()
    ingest(args.field, args.query, args.max_results, sort="relevance" if args.relevance else "date")


if __name__ == "__main__":
    main()
