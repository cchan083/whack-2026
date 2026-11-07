"""Text for clusters and gaps, written WITHOUT an AI model (free, offline).

- Cluster names come from each cluster's most distinctive keywords
  (the words common in that cluster but rare in the others).
- Gap proposals are filled-in templates plus example papers from each side.

If we later get an API key, an AI version can replace these functions:
keep the same inputs and outputs and nothing else needs to change.
"""

import zlib

import numpy as np
from sklearn.feature_extraction.text import ENGLISH_STOP_WORDS, CountVectorizer

# Words common in almost every abstract that would make useless labels.
FILLER_WORDS = {
    "paper", "papers", "propose", "proposed", "proposes", "present", "presents",
    "approach", "approaches", "method", "methods", "result", "results", "show",
    "shows", "using", "use", "used", "based", "novel", "new", "existing", "work",
    "study", "studies", "framework", "performance", "problem", "problems", "task",
    "tasks", "state", "art", "et", "al", "arxiv", "also", "however", "significantly",
    "demonstrate", "demonstrates", "achieve", "achieves", "furthermore", "via",
    # Generic machine-learning words: true of nearly every paper in this field.
    "model", "models", "modeling", "modelling", "learning", "machine", "deep",
    "neural", "network", "networks", "training", "trained", "data", "benchmark",
}
STOP_WORDS = list(ENGLISH_STOP_WORDS | FILLER_WORDS)


def _roots(term: str) -> set[str]:
    """Words in a term with a plural 's' removed, so "floods" matches "flood"."""
    return {w[:-1] if w.endswith("s") and len(w) > 3 else w for w in term.split()}


def cluster_keywords(texts_by_cluster: dict[int, list[str]], top_n: int = 10) -> dict[int, list[str]]:
    """Return the most distinctive keywords for each cluster.

    texts_by_cluster maps cluster id -> list of "title + abstract" strings.
    Leave out HDBSCAN's noise group (-1); it isn't a real topic.
    """
    ids = list(texts_by_cluster)
    # Treat each cluster as one big document.
    docs = [" ".join(texts_by_cluster[i]) for i in ids]

    # Count single words and two-word phrases (e.g. "climate", "sea ice").
    # token_pattern keeps words of 2+ letters only, so numbers are ignored.
    vectorizer = CountVectorizer(
        stop_words=STOP_WORDS, ngram_range=(1, 2), token_pattern=r"(?u)\b[a-zA-Z][a-zA-Z]+\b"
    )
    counts = vectorizer.fit_transform(docs).toarray().astype(float)
    vocab = vectorizer.get_feature_names_out()

    # Class-based TF-IDF: score = how often a word appears in this cluster
    # x how rare it is across all clusters. High score = typical of this cluster only.
    tf = counts / np.maximum(counts.sum(axis=1, keepdims=True), 1)
    avg_words_per_cluster = counts.sum() / len(ids)
    rarity = np.log(1 + avg_words_per_cluster / np.maximum(counts.sum(axis=0), 1))
    scores = tf * rarity

    # Words found in most clusters ("climate" in a climate dataset) describe the
    # whole field, not one cluster, so never use them in labels.
    if len(ids) >= 5:
        share_of_clusters = (counts > 0).mean(axis=0)
        scores[:, share_of_clusters > 0.5] = 0

    result = {}
    for row, cluster_id in enumerate(ids):
        picked: list[str] = []
        for idx in scores[row].argsort()[::-1]:  # best score first
            if scores[row, idx] <= 0:
                break  # only filtered-out or absent words left
            term = vocab[idx]
            # Terms sharing a word with one already picked ("flood" vs "floods").
            overlap = [p for p in picked if _roots(term) & _roots(p)]
            if not overlap:
                picked.append(term)
            elif (
                len(overlap) == 1
                and " " in term
                and " " not in overlap[0]
                and counts[row, idx] >= 0.3 * counts[row, vectorizer.vocabulary_[overlap[0]]]
            ):
                # A common two-word phrase is more specific than its single word:
                # replace "flow" with "flow matching".
                picked[picked.index(overlap[0])] = term
            # Otherwise it's a near-duplicate of something picked: skip it.
            if len(picked) == top_n:
                break
        result[cluster_id] = picked
    return result


def make_label(keywords: list[str], n: int = 3) -> str:
    """Short cluster name, e.g. "flood forecasting · rainfall · lstm"."""
    return " · ".join(keywords[:n]) if keywords else "unnamed topic"


# Several phrasings so proposals don't all read the same.
QUESTION_TEMPLATES = [
    "How could ideas from {a} be applied to {b}?",
    "What happens when {a} and {b} are combined?",
    "Can {a} improve current approaches to {b}?",
    "Which open problems in {b} could {a} help solve?",
]


def topic_phrase(keywords: list[str], other: list[str], fallback: str) -> str:
    """Top keyword for the research question, skipping words the other cluster
    also has, so we never get "Can climate improve ... climate?"."""
    other_roots = set().union(*[_roots(k) for k in other[:3]])
    distinct = [k for k in keywords if not (_roots(k) & other_roots)]
    if distinct:
        return distinct[0]
    return keywords[0] if keywords else fallback


def write_proposal(
    keywords_a: list[str],
    keywords_b: list[str],
    titles_a: list[str],
    titles_b: list[str],
    n_papers: int = 3,
) -> str:
    """Markdown dissertation idea for the gap between cluster A and cluster B.

    keywords_* come from cluster_keywords(); titles_* are example paper titles
    from each cluster (closest to the gap first, ideally).
    """
    a = topic_phrase(keywords_a, keywords_b, "area A")
    b = topic_phrase(keywords_b, keywords_a, "area B")
    # crc32 gives the same template for the same pair every run (Python's hash() doesn't).
    template = QUESTION_TEMPLATES[zlib.crc32(f"{a}|{b}".encode()) % len(QUESTION_TEMPLATES)]

    lines = [
        f"### Dissertation idea: {a} × {b}",
        "",
        "These two research areas sit close together on the map, but few papers connect them.",
        "",
        f"**Possible research question:** {template.format(a=a, b=b)}",
        "",
        f"**Area A: {make_label(keywords_a)}**",
        *[f"- {t}" for t in titles_a[:n_papers]],
        "",
        f"**Area B: {make_label(keywords_b)}**",
        *[f"- {t}" for t in titles_b[:n_papers]],
    ]
    return "\n".join(lines)
