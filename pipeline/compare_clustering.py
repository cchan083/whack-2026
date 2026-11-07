"""Compare the saved (old) clustering with the new 5D clustering. READ-ONLY.

Example:
    python -m pipeline.compare_clustering --field wildfire
    python -m pipeline.compare_clustering --all

"Old" is what is in the database now (topics clustered on the 2D map, gaps
measured on the map). "New" is computed in memory with the current code
(5D clustering, gaps measured in embedding space). Nothing is written, so it
is safe to run on the shared database before deciding to rebuild.

Metrics (higher is better unless noted):
- topics / noise: number of topics and share of papers left unclustered.
- coherence: how close papers are to their own topic's average embedding
  (mean cosine, weighted by topic size). Catch-all topics score low.
- silhouette: cosine silhouette in the full embedding space (-1..1).
- map agreement: share of papers whose nearest topic centre on the 2D map is
  their own topic. Low means topics look scattered on the picture.
"""

import argparse

import numpy as np
from sklearn.metrics import silhouette_score
from sqlmodel import Session, select

import llm
from db import Cluster, Gap, Paper, engine
from pipeline import embed_cluster, gaps, run


def _unit(m: np.ndarray) -> np.ndarray:
    return m / np.maximum(np.linalg.norm(m, axis=-1, keepdims=True), 1e-12)


def metrics(units: np.ndarray, labels: np.ndarray, xy: np.ndarray, names: dict[int, str]) -> dict:
    """Quality numbers for one clustering. labels: -1 = noise."""
    ids = sorted(set(labels.tolist()) - {-1})
    clustered = labels != -1
    per_topic = {}
    centres_2d = {}
    for cid in ids:
        members = units[labels == cid]
        centre = _unit(members.mean(axis=0))
        per_topic[cid] = (float((members @ centre).mean()), len(members))
        centres_2d[cid] = np.median(xy[labels == cid], axis=0)
    sizes = np.array([n for _, n in per_topic.values()])
    coherence = float(np.average([c for c, _ in per_topic.values()], weights=sizes)) if ids else 0.0

    sil = float("nan")
    if len(ids) >= 2:
        sample = min(int(clustered.sum()), 2000)
        sil = float(silhouette_score(units[clustered], labels[clustered], metric="cosine",
                                     sample_size=sample, random_state=0))

    order = np.array(ids)
    centre_xy = np.array([centres_2d[c] for c in ids])
    nearest = order[np.argmin(((xy[clustered][:, None, :] - centre_xy[None]) ** 2).sum(axis=2), axis=1)]
    agreement = float((nearest == labels[clustered]).mean()) if ids else 0.0

    worst = sorted(per_topic.items(), key=lambda kv: kv[1][0])[:3]
    return {
        "topics": len(ids),
        "noise": float((~clustered).mean()),
        "coherence": coherence,
        "silhouette": sil,
        "agreement": agreement,
        "worst": [(names.get(cid, str(cid)), round(c, 3), n) for cid, (c, n) in worst],
    }


def compare(field: str) -> None:
    with Session(engine) as session:
        papers = session.exec(
            select(Paper.title, Paper.abstract, Paper.x, Paper.y, Paper.cluster_id, Paper.embedding)
            .where(Paper.field == field, Paper.x.is_not(None))
        ).all()
        clusters = session.exec(select(Cluster).where(Cluster.field == field)).all()
        saved_gaps = session.exec(
            select(Gap).where(Gap.field == field).order_by(Gap.base_score.desc())
        ).all()
    if not clusters:
        print(f"\n=== {field}: not built, skipped")
        return

    units = _unit(np.array([p.embedding for p in papers], dtype=float))
    texts = [embed_cluster.paper_text(p.title, p.abstract) for p in papers]
    old_xy = np.array([[p.x, p.y] for p in papers])
    old_labels = np.array([p.cluster_id if p.cluster_id is not None else -1 for p in papers])
    old_names = {c.id: c.label for c in clusters}

    quiet = lambda *_args, **_kw: None  # noqa: E731
    new_xy, new_labels = embed_cluster.layout_and_cluster(
        units, embed_cluster.auto_min_cluster_size(len(papers)), progress=quiet
    )
    new_ids = sorted(set(new_labels.tolist()) - {-1})
    keywords = llm.cluster_keywords({c: [t for t, lab in zip(texts, new_labels) if lab == c] for c in new_ids})
    new_names = {c: llm.make_label(keywords[c]) for c in new_ids}

    old = metrics(units, old_labels, old_xy, old_names)
    new = metrics(units, new_labels, new_xy, new_names)

    print(f"\n=== {field}  ({len(papers)} papers)")
    print(f"{'':14}{'old (2D)':>12}{'new (5D)':>12}")
    for key, fmt in [("topics", "{:d}"), ("noise", "{:.0%}"), ("coherence", "{:.3f}"),
                     ("silhouette", "{:.3f}"), ("agreement", "{:.0%}")]:
        print(f"{key:14}{fmt.format(old[key]):>12}{fmt.format(new[key]):>12}")
    print("least coherent topics (cosine, size):")
    print("  old:", "; ".join(f"{n} ({c}, {s})" for n, c, s in old["worst"]))
    print("  new:", "; ".join(f"{n} ({c}, {s})" for n, c, s in new["worst"]))

    # Where did the old least-coherent topic's papers go?
    worst_old = min(set(old_labels.tolist()) - {-1},
                    key=lambda cid: float((units[old_labels == cid] @ _unit(units[old_labels == cid].mean(0))).mean()))
    moved = new_labels[old_labels == worst_old]
    spread = sorted(((int((moved == c).sum()), new_names.get(c, "unclustered")) for c in set(moved.tolist())),
                    reverse=True)
    print(f"old '{old_names[worst_old]}' papers now in:",
          "; ".join(f"{name} ({n})" for n, name in spread[:5]))

    # Top gaps by map score (before validation, no arXiv lookups).
    print("top gaps by map score:")
    print("  old (saved):", "; ".join(
        f"{old_names[g.cluster_a].split(' · ')[0]} × {old_names[g.cluster_b].split(' · ')[0]} ({g.base_score:.2f})"
        for g in saved_gaps[:5]))
    centres = np.array([np.median(new_xy[new_labels == c], axis=0) for c in new_ids])
    pairs = sorted(gaps.candidate_pairs(units, new_labels, new_ids, centres), key=lambda p: -p.base_score)
    print("  new:        ", "; ".join(
        f"{new_names[p.cluster_a].split(' · ')[0]} × {new_names[p.cluster_b].split(' · ')[0]} ({p.base_score:.2f})"
        for p in pairs[:5]))
    emptiness = np.array([p.emptiness for p in pairs]) if pairs else np.array([0.0])
    print(f"  new candidates: {len(pairs)}, emptiness median {np.median(emptiness):.2f}, "
          f"share > 0.5: {(emptiness > 0.5).mean():.0%}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Compare saved vs new clustering (read-only).")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--field", help='Dataset label, e.g. "wildfire"')
    group.add_argument("--all", action="store_true", help="Every built topic")
    args = parser.parse_args()
    fields = [t["field"] for t in run.list_topics() if t["clusters"] > 0] if args.all else [args.field]
    for field in fields:
        compare(field)


if __name__ == "__main__":
    main()
