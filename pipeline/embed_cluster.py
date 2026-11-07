"""Embed, map and cluster the papers for one field.

Example:
    python -m pipeline.embed_cluster --field "ml-climate"

Steps:
1. Embed: turn each paper's title + abstract into 384 numbers (fastembed).
   Only papers without an embedding are processed, so re-runs are quick.
2. Map: squash those 384 numbers down to 2 (x, y) with UMAP, keeping similar
   papers close together.
3. Cluster: group papers that sit close together on the map with HDBSCAN.
   Papers that don't fit any group are "noise" and get cluster_id = None.
4. Save: replace this field's clusters (named with keywords from llm.py) and
   update every paper's x, y and cluster_id.

Re-running redoes steps 2-4 from scratch. The field's old gaps are deleted,
because they point at the old clusters (re-run pipeline.gaps afterwards).
"""

import argparse

import numpy as np
import umap
from fastembed import TextEmbedding
from sklearn.cluster import HDBSCAN
from sqlalchemy import delete, update
from sqlmodel import Session, select

import llm
from db import Cluster, Gap, Paper, engine, init_db

MODEL_NAME = "sentence-transformers/all-MiniLM-L6-v2"
SAVE_EVERY = 200  # embeddings saved to the database per round trip


def paper_text(title: str, abstract: str) -> str:
    return f"{title}. {abstract}"


def save_paper_updates(rows: list[dict]) -> None:
    """Update many papers at once. Each dict needs "id" plus the columns to change."""
    if rows:
        with Session(engine) as session:
            session.exec(update(Paper), params=rows)
            session.commit()


def embed_missing(field: str) -> None:
    """Step 1: embed every paper in this field that has no embedding yet."""
    with Session(engine) as session:
        rows = session.exec(
            select(Paper.id, Paper.title, Paper.abstract).where(
                Paper.field == field, Paper.embedding.is_(None)
            )
        ).all()
    if not rows:
        print("All papers already have embeddings.")
        return

    print(f"Embedding {len(rows)} papers (first run downloads the model, about 90 MB)...")
    model = TextEmbedding(MODEL_NAME)
    texts = [paper_text(title, abstract) for _, title, abstract in rows]

    pending: list[dict] = []
    done = 0
    for (paper_id, _, _), vector in zip(rows, model.embed(texts, batch_size=64)):
        pending.append({"id": paper_id, "embedding": vector.tolist()})
        if len(pending) >= SAVE_EVERY:
            save_paper_updates(pending)
            done += len(pending)
            pending = []
            print(f"\rEmbedded {done}/{len(rows)}", end="")
    save_paper_updates(pending)
    print(f"\rEmbedded {len(rows)}/{len(rows)}")


def map_and_cluster(field: str, min_cluster_size: int, min_samples: int) -> None:
    """Steps 2-4: 2D map, clusters, and save."""
    with Session(engine) as session:
        rows = session.exec(
            select(Paper.id, Paper.title, Paper.abstract, Paper.embedding).where(Paper.field == field)
        ).all()
    if len(rows) < min_cluster_size * 2:
        print(f"Only {len(rows)} papers in '{field}': too few to cluster.")
        return

    paper_ids = [r[0] for r in rows]
    texts = [paper_text(r[1], r[2]) for r in rows]
    vectors = np.array([r[3] for r in rows])

    print(f"Mapping {len(rows)} papers to 2D with UMAP...")
    # metric="cosine": compare embeddings by direction, the usual choice for text.
    # random_state makes the map come out the same every run.
    coords = umap.UMAP(
        n_neighbors=15, min_dist=0.05, metric="cosine", random_state=42, n_jobs=1
    ).fit_transform(vectors)

    print("Clustering with HDBSCAN...")
    # min_cluster_size: smallest group that counts as a topic.
    # min_samples: higher = stricter, more papers left out as noise.
    labels = HDBSCAN(min_cluster_size=min_cluster_size, min_samples=min_samples, copy=True).fit_predict(coords)
    cluster_numbers = sorted(set(labels) - {-1})  # -1 means noise

    texts_by_cluster = {c: [t for t, lab in zip(texts, labels) if lab == c] for c in cluster_numbers}
    keywords = llm.cluster_keywords(texts_by_cluster)

    # Save everything in one transaction, so the database never has half-old,
    # half-new clusters if something fails part-way.
    with Session(engine) as session:
        session.exec(delete(Gap).where(Gap.field == field))
        session.exec(delete(Cluster).where(Cluster.field == field))

        new_clusters = {}
        for c in cluster_numbers:
            members = coords[labels == c]
            new_clusters[c] = Cluster(
                field=field,
                label=llm.make_label(keywords[c]),
                size=len(members),
                centroid_x=float(members[:, 0].mean()),
                centroid_y=float(members[:, 1].mean()),
            )
            session.add(new_clusters[c])
        session.flush()  # sends the inserts so each Cluster gets its database id

        paper_rows = [
            {
                "id": paper_id,
                "x": float(x),
                "y": float(y),
                "cluster_id": new_clusters[lab].id if lab != -1 else None,
            }
            for paper_id, (x, y), lab in zip(paper_ids, coords, labels)
        ]
        session.exec(update(Paper), params=paper_rows)
        session.commit()

        summary = sorted(new_clusters.values(), key=lambda cl: cl.size, reverse=True)
        noise = int((labels == -1).sum())
        print(f"\n{len(summary)} clusters, {noise} papers left as noise ({noise / len(labels):.0%}).")
        for cl in summary:
            print(f"  {cl.size:4d}  {cl.label}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Embed, map and cluster papers for one field.")
    parser.add_argument("--field", required=True, help='Dataset label used in ingest, e.g. "ml-climate"')
    # Defaults tuned on ml-climate (~2,100 papers): ~40 clusters, ~17% noise.
    parser.add_argument("--min-cluster-size", type=int, default=20, help="Smallest group that counts as a topic")
    parser.add_argument("--min-samples", type=int, default=2, help="Higher = stricter clusters, more noise")
    args = parser.parse_args()

    init_db()
    embed_missing(args.field)
    map_and_cluster(args.field, args.min_cluster_size, args.min_samples)


if __name__ == "__main__":
    main()
