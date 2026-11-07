"""Tests for the clustering and gap geometry (pipeline/embed_cluster.py,
pipeline/gaps.py). Synthetic embeddings, no network; importing the pipeline
reads DATABASE_URL from .env but never connects.

Run with:  pytest tests
"""

import numpy as np

from pipeline.embed_cluster import layout_and_cluster
from pipeline.gaps import candidate_pairs

DIMS = 384
RNG = np.random.default_rng(0)


def unit(m: np.ndarray) -> np.ndarray:
    return m / np.linalg.norm(m, axis=-1, keepdims=True)


def blob(centre: np.ndarray, n: int, spread: float = 0.35) -> np.ndarray:
    """n unit vectors scattered around a direction."""
    return unit(centre + spread * RNG.normal(size=(n, DIMS)) / np.sqrt(DIMS))


def two_topics(bridge: int) -> tuple[np.ndarray, np.ndarray]:
    """Two related topics (cosine ~0.7 between centres), plus `bridge` papers
    spread along the path between them (cluster id -1: unclustered)."""
    shared = RNG.normal(size=DIMS)
    a = unit(shared + 0.65 * RNG.normal(size=DIMS) * np.linalg.norm(shared) / np.sqrt(DIMS))
    b = unit(shared + 0.65 * RNG.normal(size=DIMS) * np.linalg.norm(shared) / np.sqrt(DIMS))
    parts = [blob(a, 60), blob(b, 60)]
    labels = [np.full(60, 1), np.full(60, 2)]
    if bridge:
        t = np.linspace(0.15, 0.85, bridge)[:, None]
        path = (1 - t) * a + t * b  # points evenly along the way from A to B
        parts.append(unit(path + 0.2 * RNG.normal(size=(bridge, DIMS)) / np.sqrt(DIMS)))
        labels.append(np.full(bridge, -1))
    return np.vstack(parts), np.concatenate(labels)


def emptiness(vectors: np.ndarray, labels: np.ndarray) -> float:
    pairs = candidate_pairs(vectors, labels, [1, 2], np.array([[0.0, 0.0], [1.0, 0.0]]))
    return pairs[0].emptiness if pairs else 0.0  # no candidate = score 0 = not empty


def test_empty_path_scores_high_and_bridged_path_scores_low() -> None:
    empty = emptiness(*two_topics(bridge=0))
    bridged = emptiness(*two_topics(bridge=200))
    assert empty > 0.8, empty
    assert bridged < 0.3, bridged
    assert empty > bridged


def test_star_sits_on_the_2d_link() -> None:
    vectors, labels = two_topics(bridge=0)
    (pair,) = candidate_pairs(vectors, labels, [1, 2], np.array([[0.0, 0.0], [10.0, 0.0]]))
    assert pair.y == 0.0 and 2.0 <= pair.x <= 8.0  # within the middle 20-80% of the line


def test_links_are_mutual_nearest_neighbours() -> None:
    # Seven topics in a tight family plus one far-away outlier topic.
    family = RNG.normal(size=DIMS)
    centres = [unit(family + 0.8 * RNG.normal(size=DIMS)) for _ in range(7)] + [unit(RNG.normal(size=DIMS))]
    vectors = np.vstack([blob(c, 30) for c in centres])
    labels = np.repeat(np.arange(8), 30)
    pairs = candidate_pairs(vectors, labels, list(range(8)), RNG.normal(size=(8, 2)))
    linked = {frozenset((p.cluster_a, p.cluster_b)) for p in pairs}
    # The outlier's 5 most similar topics don't have it in their own top 5.
    assert not any(7 in link for link in linked)
    assert all(len(link) == 2 for link in linked)


def test_5d_clustering_recovers_separate_topics() -> None:
    centres = [unit(RNG.normal(size=DIMS)) for _ in range(3)]
    vectors = np.vstack([blob(c, 80) for c in centres])
    quiet = lambda *_a, **_k: None  # noqa: E731
    coords, labels = layout_and_cluster(vectors, min_cluster_size=15, progress=quiet)
    assert coords.shape == (240, 2)
    found = set(labels.tolist()) - {-1}
    assert len(found) == 3
    # Each true topic maps (almost) entirely to one cluster.
    for k in range(3):
        mine = labels[k * 80:(k + 1) * 80]
        mine = mine[mine != -1]
        assert (mine == np.bincount(mine).argmax()).mean() > 0.95
