"""Download papers from arXiv and save them to the database.

Example:
    python -m pipeline.ingest --field "ml-climate" --query "cat:cs.LG AND abs:climate" --max 3000

Safe to re-run: papers already in the database are skipped, and each batch is
saved as it goes, so an interrupted run keeps what it already downloaded.
"""

import argparse

import arxiv
from sqlalchemy.dialects.postgresql import insert
from sqlmodel import Session, select

from db import Paper, engine, init_db

BATCH_SIZE = 100  # papers saved to the database per insert


def clean(s: str) -> str:
    """arXiv titles/abstracts contain line breaks and double spaces; flatten them."""
    return " ".join(s.split())


def base_id(result: arxiv.Result) -> str:
    """'2301.01234v2' -> '2301.01234', so a new version of a paper isn't a duplicate."""
    return result.get_short_id().rsplit("v", 1)[0]


def save_batch(rows: list[dict]) -> None:
    if not rows:
        return
    # ON CONFLICT DO NOTHING: if a paper is somehow already there, skip it instead of failing.
    stmt = insert(Paper).values(rows).on_conflict_do_nothing(index_elements=["arxiv_id"])
    with Session(engine) as session:
        session.exec(stmt)
        session.commit()


def ingest(field: str, query: str, max_results: int) -> None:
    init_db()  # make sure the tables exist

    with Session(engine) as session:
        known_ids = set(session.exec(select(Paper.arxiv_id)).all())
    print(f"{len(known_ids)} papers already in the database.")

    # The arxiv package pages through results and waits between requests
    # (delay_seconds), which is what arXiv's API rules ask for.
    client = arxiv.Client(page_size=100, delay_seconds=3, num_retries=5)
    search = arxiv.Search(
        query=query,
        max_results=max_results,
        sort_by=arxiv.SortCriterion.SubmittedDate,
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
            print(f"\rDownloaded {seen}/{max_results} | new {added + len(batch)} | skipped {skipped}", end="")
    finally:
        # Save whatever is left, even if the download stopped part-way.
        save_batch(batch)
        added += len(batch)
        print(f"\nDone. Saved {added} new papers, skipped {skipped} already in the database.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Download arXiv papers into the database.")
    parser.add_argument("--field", required=True, help='Label for this dataset, e.g. "ml-climate"')
    parser.add_argument("--query", required=True, help='arXiv query, e.g. "cat:cs.LG AND abs:climate"')
    parser.add_argument("--max", type=int, default=3000, dest="max_results", help="Max papers to fetch")
    args = parser.parse_args()
    ingest(args.field, args.query, args.max_results)


if __name__ == "__main__":
    main()
