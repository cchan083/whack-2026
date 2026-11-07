"""Find research gaps between related clusters.

Example:
    python -m pipeline.gaps --field "ml-climate"

A gap is a pair of neighbouring clusters whose topics are similar, but with an
empty stretch of map between them: few papers bridge the two topics.

Steps:
1. Neighbours: link each cluster to the clusters around it (a Delaunay
   triangulation of the cluster centres), dropping the longest links.
2. Emptiness: walk along the line between the two clusters, find the spot with
   the fewest papers nearby, and compare it with how crowded clusters usually are.
   1.0 = no papers at all there, 0.0 = as crowded as inside a cluster.
3. Relatedness: cosine similarity of the two clusters' average embeddings.
4. Score = relatedness x emptiness. Keep the best gaps and write a proposal for each.

Run after pipeline.embed_cluster. Re-running replaces the field's gaps.
"""

import argparse

import numpy as np
from scipy.spatial import Delaunay, cKDTree
from sqlalchemy import delete
from sqlmodel import Session, select

import llm
from db import Cluster, Gap, Paper, engine, init_db

RADIUS_FRACTION = 0.04  # "nearby" = within 4% of the map's width
MAX_LINK_PERCENTILE = 75  # ignore the longest 25% of neighbour links
SAMPLES_ALONG_LINE = 21  # points checked between two cluster centres
MAX_GAPS_PER_CLUSTER = 3  # keeps the gap list varied


def paper_link(title: str, arxiv_id: str) -> str:
    """Markdown link to the paper. Square brackets in titles would break the link."""
    safe = title.replace("[", "(").replace("]", ")")
    return f"[{safe}](https://arxiv.org/abs/{arxiv_id})"


def find_gaps(field: str, top_n: int) -> None:
    with Session(engine) as session:
        clusters = session.exec(select(Cluster).where(Cluster.field == field)).all()
        papers = session.exec(
            select(
                Paper.arxiv_id, Paper.title, Paper.abstract, Paper.x, Paper.y,
                Paper.cluster_id, Paper.embedding,
            ).where(Paper.field == field, Paper.x.is_not(None))
        ).all()
    if len(clusters) < 3:
        print(f"Only {len(clusters)} clusters in '{field}'. Run pipeline.embed_cluster first.")
        return

    xy = np.array([[p.x, p.y] for p in papers])
    cluster_of = np.array([p.cluster_id if p.cluster_id is not None else -1 for p in papers])
    vectors = np.array([p.embedding for p in papers])
    centres = np.array([[c.centroid_x, c.centroid_y] for c in clusters])

    # cKDTree makes "how many papers are within this radius?" fast.
    tree = cKDTree(xy)
    radius = RADIUS_FRACTION * np.ptp(xy, axis=0).max()

    def papers_near(points: np.ndarray) -> np.ndarray:
        return np.array([len(found) for found in tree.query_ball_point(points, radius)])

    # How crowded it is around a typical clustered paper: our "full" level.
    typical_crowding = np.median(papers_near(xy[cluster_of != -1]))

    # Average embedding direction of each cluster, for relatedness.
    topic_vector = {}
    for c in clusters:
        v = vectors[cluster_of == c.id].mean(axis=0)
        topic_vector[c.id] = v / np.linalg.norm(v)

    # Step 1: neighbour links between cluster centres (pairs of indices into `clusters`).
    links = set()
    for triangle in Delaunay(centres).simplices:
        for k in range(3):
            i, j = sorted((int(triangle[k]), int(triangle[(k + 1) % 3])))
            links.add((i, j))
    length = {link: np.linalg.norm(centres[link[0]] - centres[link[1]]) for link in links}
    max_length = np.percentile(list(length.values()), MAX_LINK_PERCENTILE)

    candidates = []
    t = np.linspace(0, 1, SAMPLES_ALONG_LINE)
    middle = (t >= 0.2) & (t <= 0.8)  # skip the ends, which sit inside the clusters
    for i, j in links:
        if length[(i, j)] > max_length:
            continue
        a, b = clusters[i], clusters[j]

        # Step 2: emptiest spot on the line between the two centres.
        line = centres[i] + t[:, None] * (centres[j] - centres[i])
        crowding = papers_near(line).astype(float)
        crowding[~middle] = np.inf
        spot = int(np.argmin(crowding))
        emptiness = 1 - min(crowding[spot] / typical_crowding, 1)

        # Step 3 and 4.
        relatedness = float(topic_vector[a.id] @ topic_vector[b.id])
        score = relatedness * emptiness
        if score > 0:
            candidates.append((score, a, b, line[spot]))

    # Best first, but let each cluster appear in at most MAX_GAPS_PER_CLUSTER
    # gaps, so one "hub" topic doesn't fill the whole list.
    candidates.sort(key=lambda item: item[0], reverse=True)
    best, uses = [], {}
    for item in candidates:
        a, b = item[1].id, item[2].id
        if uses.get(a, 0) < MAX_GAPS_PER_CLUSTER and uses.get(b, 0) < MAX_GAPS_PER_CLUSTER:
            best.append(item)
            uses[a] = uses.get(a, 0) + 1
            uses[b] = uses.get(b, 0) + 1
        if len(best) == top_n:
            break

    # Keywords for every cluster, for the proposals.
    texts_by_cluster = {
        c.id: [f"{p.title}. {p.abstract}" for p in papers if p.cluster_id == c.id] for c in clusters
    }
    keywords = llm.cluster_keywords(texts_by_cluster)

    def closest_papers(cluster_id: int, point: np.ndarray, n: int = 3) -> list[str]:
        """Papers in this cluster nearest the gap: the best starting reading."""
        members = np.where(cluster_of == cluster_id)[0]
        nearest = members[np.argsort(np.linalg.norm(xy[members] - point, axis=1))][:n]
        return [paper_link(papers[k].title, papers[k].arxiv_id) for k in nearest]

    with Session(engine) as session:
        session.exec(delete(Gap).where(Gap.field == field))
        for score, a, b, point in best:
            session.add(
                Gap(
                    field=field,
                    cluster_a=a.id,
                    cluster_b=b.id,
                    score=round(float(score), 4),  # plain float: the database can't store numpy numbers
                    x=float(point[0]),
                    y=float(point[1]),
                    proposal=llm.write_proposal(
                        keywords[a.id], keywords[b.id],
                        closest_papers(a.id, point), closest_papers(b.id, point),
                    ),
                )
            )
        session.commit()

    print(f"Checked {len(candidates)} neighbouring cluster pairs, saved the top {len(best)} gaps:")
    for rank, (score, a, b, _) in enumerate(best, start=1):
        print(f"  {rank:2d}. {score:.2f}  {a.label}  <->  {b.label}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Find research gaps between related clusters.")
    parser.add_argument("--field", required=True, help='Dataset label, e.g. "ml-climate"')
    parser.add_argument("--top", type=int, default=20, help="How many gaps to keep")
    args = parser.parse_args()
    init_db()
    find_gaps(args.field, args.top)


if __name__ == "__main__":
    main()
