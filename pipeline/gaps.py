"""Find research gaps between related clusters.

Example:
    python -m pipeline.gaps --field "ml-climate"

A gap is a pair of similar clusters with an empty stretch between them: few
papers bridge the two topics. All geometry here uses the 384-number embeddings,
not the 2D map: UMAP keeps nearby papers together, but distances between
faraway clusters on the map don't mean much.

Steps:
1. Neighbours: link each cluster to its most similar clusters (cosine
   similarity of their average embeddings).
2. Emptiness: walk along the path between the two clusters' average embeddings,
   find the spot with the fewest papers nearby, and compare it with how crowded
   it is around a typical clustered paper.
   1.0 = no papers at all there, 0.0 = as crowded as inside a cluster.
3. Relatedness: cosine similarity of the two clusters' average embeddings.
4. Base score = relatedness x emptiness.
5. Validation (pipeline/validation.py): re-rank so each gap pairs one method
   with one problem, sits in the literature "Goldilocks zone" and has a
   plausible funding domain. Keep the best gaps and write a proposal for each.

Run after pipeline.embed_cluster. Re-running replaces the field's gaps.
"""

import argparse
import json
import logging
from itertools import combinations

import numpy as np
import pandas as pd
from sqlalchemy import delete, update
from sqlmodel import Session, select

import llm
from db import Cluster, Gap, Paper, engine, init_db
from pipeline import console_progress, validation

NEIGHBOURS_PER_TOPIC = 5  # each topic is paired with its 5 most similar topics
CROWDING_K = 10  # "nearby" = closer than a typical paper's 10th-nearest neighbour
SAMPLES_ALONG_LINE = 21  # points checked between two cluster centres
MAX_GAPS_PER_CLUSTER = 3  # keeps the gap list varied


def paper_link(title: str, arxiv_id: str) -> str:
    """Markdown link to the paper. Square brackets in titles would break the link."""
    safe = title.replace("[", "(").replace("]", ")")
    return f"[{safe}](https://arxiv.org/abs/{arxiv_id})"


def _unit(m: np.ndarray) -> np.ndarray:
    """Scale rows to length 1, so dot products are cosine similarities."""
    return m / np.maximum(np.linalg.norm(m, axis=-1, keepdims=True), 1e-12)


def candidate_pairs(
    vectors: np.ndarray,
    cluster_of: np.ndarray,
    cluster_ids: list[int],
    centres_2d: np.ndarray,
    neighbours: int = NEIGHBOURS_PER_TOPIC,
    crowding_k: int = CROWDING_K,
) -> list[validation.CandidatePair]:
    """Steps 1-4 for every linked pair of clusters (no database needed).

    vectors: one embedding per paper; cluster_of: each paper's cluster id (-1 = noise);
    cluster_ids: the clusters, in the same order as centres_2d (their 2D map centres,
    used only to place the gap's star on the picture).
    """
    units = _unit(np.asarray(vectors, dtype=float))
    clustered = cluster_of != -1
    if len(cluster_ids) < 2 or clustered.sum() < 2:
        return []

    # "Nearby" radius, adapted to this map: the typical distance (1 - cosine)
    # from a clustered paper to its k-th nearest neighbour.
    k = min(crowding_k, len(units) - 1)
    sims = units[clustered] @ units.T
    kth_sim = -np.partition(-sims, k, axis=1)[:, k]  # index 0 is the paper itself
    min_sim = 1 - float(np.median(1 - kth_sim))

    def papers_near(points: np.ndarray) -> np.ndarray:
        return ((points @ units.T) >= min_sim).sum(axis=1)

    # How crowded it is around a typical clustered paper: our "full" level.
    typical_crowding = max(float(np.median((sims >= min_sim).sum(axis=1))), 1.0)

    # Average embedding direction of each cluster.
    topic = _unit(np.array([units[cluster_of == cid].mean(axis=0) for cid in cluster_ids]))
    similarity = topic @ topic.T

    # Step 1: link each cluster to its most similar clusters.
    if len(cluster_ids) <= 3:
        links = set(combinations(range(len(cluster_ids)), 2))  # too few to choose: link them all
    else:
        links = set()
        np.fill_diagonal(similarity, -np.inf)
        for i in range(len(cluster_ids)):
            for j in np.argsort(similarity[i])[::-1][:neighbours]:
                links.add((min(i, int(j)), max(i, int(j))))

    t = np.linspace(0, 1, SAMPLES_ALONG_LINE)
    middle = t[(t >= 0.2) & (t <= 0.8)]  # skip the ends, which sit inside the clusters
    candidates = []
    for i, j in sorted(links):
        # Step 2: emptiest spot on the path between the two average embeddings.
        path = _unit((1 - middle)[:, None] * topic[i] + middle[:, None] * topic[j])
        crowding = papers_near(path)
        spot = int(np.argmin(crowding))
        emptiness = 1 - min(crowding[spot] / typical_crowding, 1)

        # Steps 3 and 4.
        relatedness = float(topic[i] @ topic[j])
        score = relatedness * emptiness
        if score > 0:
            # The star goes at the same fraction of the way along the 2D line
            # between the two clusters, so it sits on the link drawn in the UI.
            x, y = centres_2d[i] + middle[spot] * (centres_2d[j] - centres_2d[i])
            candidates.append(validation.CandidatePair(
                cluster_a=cluster_ids[i], cluster_b=cluster_ids[j], base_score=float(score),
                relatedness=relatedness, emptiness=float(emptiness), x=float(x), y=float(y),
            ))
    return candidates


def find_gaps(
    field: str,
    top_n: int = 20,
    progress=console_progress,
    check_literature: bool = True,
    max_lookups: int = 30,
    strict_taxonomy: bool = False,
) -> pd.DataFrame:
    """Find, validate and save the best gaps.

    Returns every candidate pair as a DataFrame, best first, with the
    validation breakdown and reasons; the "selected" column marks the saved ones.
    check_literature=False skips the arXiv co-occurrence lookups (offline/fast).
    """
    progress("Looking for gaps between related topics...", 0.0)
    with Session(engine) as session:
        clusters = session.exec(select(Cluster).where(Cluster.field == field)).all()
        papers = session.exec(
            select(
                Paper.arxiv_id, Paper.title, Paper.abstract, Paper.x, Paper.y,
                Paper.cluster_id, Paper.embedding,
            ).where(Paper.field == field, Paper.x.is_not(None))
        ).all()
    if len(clusters) < 2:
        with Session(engine) as session:  # clear any old gaps so the frontends don't show stale ones
            session.exec(delete(Gap).where(Gap.field == field))
            session.commit()
        progress(f"Only {len(clusters)} topic(s) in '{field}': need at least 2 to find gaps.", 1.0)
        return pd.DataFrame()

    xy = np.array([[p.x, p.y] for p in papers])
    cluster_of = np.array([p.cluster_id if p.cluster_id is not None else -1 for p in papers])
    vectors = np.array([p.embedding for p in papers])
    centres = np.array([[c.centroid_x, c.centroid_y] for c in clusters])
    candidates = candidate_pairs(vectors, cluster_of, [c.id for c in clusters], centres)

    # Keywords for every cluster: used to classify topics and write proposals.
    texts_by_cluster = {
        c.id: [f"{p.title}. {p.abstract}" for p in papers if p.cluster_id == c.id] for c in clusters
    }
    keywords = llm.cluster_keywords(texts_by_cluster)

    # Step 5: validation layer (pipeline/validation.py) re-ranks the candidates:
    # one method + one problem, literature "Goldilocks zone", funding relevance.
    progress(f"Validating {len(candidates)} candidate gaps...", 0.1)
    profiles = validation.build_profiles(
        {c.id: c.label or "" for c in clusters}, keywords, embed=validation.default_embedder()
    )
    assessed = validation.validate_pairs(
        candidates, profiles,
        counter=validation.ArxivLiteratureCounter() if check_literature else None,
        max_lookups=max_lookups, strict_taxonomy=strict_taxonomy,
        progress=lambda message, fraction=None: progress(message, None if fraction is None else 0.1 + 0.85 * fraction),
    )

    # Best first, skipping rejected pairs, and letting each cluster appear in at
    # most MAX_GAPS_PER_CLUSTER gaps so one "hub" topic doesn't fill the list.
    chosen: list[int] = []
    uses: dict[int, int] = {}
    for i, row in assessed.iterrows():
        if row["status"] == "rejected":
            continue
        a, b = int(row["cluster_a"]), int(row["cluster_b"])
        if uses.get(a, 0) < MAX_GAPS_PER_CLUSTER and uses.get(b, 0) < MAX_GAPS_PER_CLUSTER:
            chosen.append(i)
            uses[a] = uses.get(a, 0) + 1
            uses[b] = uses.get(b, 0) + 1
        if len(chosen) == top_n:
            break
    if not assessed.empty:
        assessed["selected"] = assessed.index.isin(chosen)

    def closest_papers(cluster_id: int, point: np.ndarray, n: int = 3) -> list[str]:
        """Papers in this cluster nearest the gap: the best starting reading."""
        members = np.where(cluster_of == cluster_id)[0]
        nearest = members[np.argsort(np.linalg.norm(xy[members] - point, axis=1))][:n]
        return [paper_link(papers[k].title, papers[k].arxiv_id) for k in nearest]

    with Session(engine) as session:
        for c in clusters:  # remember each topic's category for the frontends
            session.exec(update(Cluster).where(Cluster.id == c.id).values(category=profiles[c.id].category.value))
        session.exec(delete(Gap).where(Gap.field == field))
        for i in chosen:
            row = assessed.loc[i]
            a, b = int(row["cluster_a"]), int(row["cluster_b"])
            point = np.array([row["x"], row["y"]])
            count = row["literature_count"]
            session.add(
                Gap(
                    field=field,
                    cluster_a=a,
                    cluster_b=b,
                    score=float(row["final_score"]),  # plain float: the database can't store numpy numbers
                    base_score=float(row["base_score"]),
                    literature_count=None if pd.isna(count) else int(count),
                    status=str(row["status"]),
                    reasons=json.dumps(row["reasons"]),
                    x=float(point[0]),
                    y=float(point[1]),
                    proposal=llm.write_proposal(
                        keywords[a], keywords[b], closest_papers(a, point), closest_papers(b, point),
                    ),
                )
            )
        session.commit()

    progress(f"Checked {len(candidates)} neighbouring topic pairs, saved the top {len(chosen)} gaps.", 1.0)
    return assessed


def main() -> None:
    parser = argparse.ArgumentParser(description="Find research gaps between related clusters.")
    parser.add_argument("--field", required=True, help='Dataset label, e.g. "ml-climate"')
    parser.add_argument("--top", type=int, default=20, help="How many gaps to keep")
    parser.add_argument("--no-literature", action="store_true", help="Skip arXiv co-occurrence lookups")
    parser.add_argument("--max-lookups", type=int, default=30, help="Pairs to check against the literature")
    parser.add_argument("--strict", action="store_true", help="Reject (not just demote) two-tool/two-problem pairs")
    parser.add_argument("--verbose", action="store_true", help="Log every topic and pair decision")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO if args.verbose else logging.WARNING, format="%(message)s")

    init_db()
    assessed = find_gaps(args.field, args.top, check_literature=not args.no_literature,
                         max_lookups=args.max_lookups, strict_taxonomy=args.strict)
    if assessed.empty:
        return
    for rank, row in enumerate(assessed[assessed["selected"]].itertuples(), start=1):
        print(f"\n{rank:2d}. {row.final_score:.2f} (base {row.base_score:.2f}, {row.status})  "
              f"{row.label_a} [{row.category_a}]  <->  {row.label_b} [{row.category_b}]")
        for reason in row.reasons:
            print(f"      - {reason}")


if __name__ == "__main__":
    main()
