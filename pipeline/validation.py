"""Validation layer: re-rank candidate gaps so they are feasible research topics.

pipeline.gaps scores each pair of neighbouring topics by relatedness x emptiness.
On its own that can pair two methods ("LLMs x GANs"), two problems with no
method, an already crowded combination, or something nobody would fund.
This module re-ranks those candidate pairs with three checks. Each check gives
a multiplier on the score plus a human-readable reason:

1. Taxonomy asymmetry (tool vs object): a good project applies exactly one
   METHOD (Methodological_Tool) to exactly one PROBLEM (Problem_Domain).
   Two tools or two problems are heavily penalised (or rejected with strict=True).
2. Literature density ("Goldilocks zone"): how many arXiv papers already
   mention both topics. >500 = saturated (penalty), 5-100 = sweet spot (boost),
   0 = speculative (flagged for a human to check).
3. Funding / utility proxy: does the pair touch a strategic funding domain
   (energy grids, semiconductors, materials, clinical biotech, ...)? No
   plausible funding vector = penalty.

final_score = base_score x taxonomy x literature x funding.
Every decision is logged and saved with the gap, so the frontends can show why.
"""

from __future__ import annotations

import logging
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import datetime, timezone
from enum import StrEnum
from typing import Protocol

import numpy as np
import pandas as pd
from sqlmodel import Session

import llm
from db import LiteratureCount, engine

log = logging.getLogger(__name__)

ProgressFn = Callable[[str, float | None], None]
Embedder = Callable[[Sequence[str]], np.ndarray]  # texts -> unit-length vectors, one row each


# --- 1. Taxonomy: is a topic a problem domain or a method? ------------------

class Category(StrEnum):
    PROBLEM = "Problem_Domain"
    TOOL = "Methodological_Tool"
    UNKNOWN = "Unclassified"


# Lexicons are checked first (predictable, easy to extend). Words are compared
# without a plural "s", so "network" also matches "networks".
TOOL_TERMS: frozenset[str] = frozenset({
    # architectures
    "transformer", "attention", "neural", "neural network", "deep learning", "cnn", "convolutional",
    "lstm", "rnn", "recurrent", "unet", "gan", "generative adversarial", "autoencoder", "vae",
    "diffusion model", "graph neural", "gnn", "large language", "llm", "language model",
    "foundation model", "mixture of expert", "moe", "implicit neural", "inr", "physics informed", "pinn",
    "neural operator", "operator learning", "operator", "koopman", "reservoir computing",
    # learning frameworks
    "reinforcement", "rl", "multi agent", "marl", "federated", "transfer learning", "meta learning",
    "active learning", "self supervised", "contrastive", "semi supervised", "few shot", "zero shot",
    "continual learning", "generative", "flow matching", "normalizing flow",
    # statistics, optimisation, maths
    "bayesian", "gaussian process", "kriging", "variational", "monte carlo", "mcmc", "optimization",
    "optimisation", "gradient", "convex", "tensor", "kernel", "sparse", "regression", "random forest",
    "xgboost", "boosting", "ensemble", "conformal", "uncertainty quantification", "causal discovery",
    "causal inference", "causality", "granger", "clustering", "anomaly detection", "dimensionality reduction",
    "topological data analysis", "tda", "persistent homology", "compression", "interpretability",
    "explainable", "xai", "shap", "data assimilation", "assimilation", "emulator", "emulation",
    "surrogate", "super resolution", "segmentation", "benchmark", "pde", "symbolic regression",
    "downscaling", "parameterization", "parameterisation", "imputation", "tracking", "arima", "sarima",
    "graphcast",
})

PROBLEM_TERMS: frozenset[str] = frozenset({
    # earth & environment
    "ice", "sea ice", "glacier", "snow", "permafrost", "arctic", "antarctic", "ocean", "sea surface",
    "coral", "wildfire", "fire", "flood", "drought", "cyclone", "tropical cyclone", "hurricane", "typhoon",
    "landslide", "earthquake", "heatwave", "precipitation", "rainfall", "storm", "turbulence", "turbulent",
    "air quality", "pollution", "aerosol", "emission", "carbon", "methane", "plume", "contrail", "vegetation",
    "forest", "canopy", "biomass", "agb", "soil", "soil moisture", "species", "biodiversity", "ecosystem",
    "water", "hydrological", "groundwater", "river", "evacuation", "disaster", "tipping point",
    # food & agriculture
    "crop", "yield", "agricultural", "agriculture", "food security", "pest", "livestock", "irrigation",
    # energy & built environment
    "wind power", "wind turbine", "solar", "photovoltaic", "irradiance", "renewable", "energy", "electricity",
    "power grid", "grid", "battery", "hvac", "building", "thermal", "indoor", "urban", "traffic", "transport",
    # materials, hardware, engineering
    "material", "mof", "alloy", "catalyst", "polymer", "crystal", "semiconductor", "chip", "circuit", "vlsi",
    "lithography", "sensor", "robot", "drone", "uav", "satellite", "structural",
    # health & society
    "disease", "covid", "dengue", "malaria", "epidemic", "clinical", "patient", "health", "medical", "cancer",
    "protein", "drug", "genomic", "social media", "misinformation", "policy", "economic",
})

# Short descriptions used when no lexicon word matches (topics typed by users
# can be about anything): a keyword is compared to these with the same
# embedding model the pipeline already uses.
TOOL_PROTOTYPES: tuple[str, ...] = (
    "a machine learning model or neural network architecture",
    "a statistical or mathematical method",
    "an optimisation or search algorithm",
    "a data analysis or signal processing technique",
)
PROBLEM_PROTOTYPES: tuple[str, ...] = (
    "a physical, natural or environmental system",
    "a disease, medical condition or biological system",
    "an engineering system, hardware device or material",
    "an energy, infrastructure or industrial application",
    "a social, economic or policy problem",
)

CATEGORY_THRESHOLD = 0.15  # |score| below this = Unclassified
TAXONOMY_PENALTY = 0.25  # two tools or two problems
KEYWORDS_TO_CLASSIFY = 6  # top keywords per topic that vote (most distinctive first)
EMBEDDING_TRUST = 0.6  # embedding votes count less than lexicon matches


def _norm(text: str) -> str:
    """Lower-case and drop plural "s" from each word, so lexicon matching ignores plurals."""
    return " ".join(w[:-1] if w.endswith("s") and len(w) > 3 else w for w in text.lower().split())


_TOOL_NORM = frozenset(_norm(t) for t in TOOL_TERMS)
_PROBLEM_NORM = frozenset(_norm(t) for t in PROBLEM_TERMS)


def _contains_term(keyword: str, normalised_terms: frozenset[str]) -> list[str]:
    """Lexicon terms that appear in the keyword as whole words ("sea ice" contains "ice")."""
    padded = f" {_norm(keyword)} "
    return [t for t in normalised_terms if f" {t} " in padded]


@dataclass(frozen=True)
class TopicProfile:
    """What the validation layer knows about one cluster."""
    cluster_id: int
    label: str
    keywords: tuple[str, ...]
    category: Category
    confidence: float  # 0..1, how clearly it is a tool or a problem
    evidence: str  # e.g. "llms→tool, reasoning→?"
    funding: tuple[tuple[str, float], ...]  # matched (domain name, weight)
    abstract_terms: tuple[str, ...]  # matched "unapplied theory" words


def classify_keywords(keywords: Sequence[str], embed: Embedder | None = None) -> tuple[Category, float, str]:
    """Classify a topic from its keywords. Each of the top keywords votes
    +1 (tool) or -1 (problem); more distinctive keywords count more.
    Keywords not in either lexicon are judged by embedding similarity, if available."""
    top = list(keywords[:KEYWORDS_TO_CLASSIFY])
    if not top:
        return Category.UNKNOWN, 0.0, "no keywords"
    weights = np.arange(len(top), 0, -1, dtype=float)  # 6, 5, ... 1

    votes = np.zeros(len(top))
    evidence: list[str] = []
    unmatched: list[int] = []
    for i, kw in enumerate(top):
        is_tool = bool(_contains_term(kw, _TOOL_NORM))
        is_problem = bool(_contains_term(kw, _PROBLEM_NORM))
        if is_tool and not is_problem:
            votes[i] = 1.0
            evidence.append(f"{kw}→tool")
        elif is_problem and not is_tool:
            votes[i] = -1.0
            evidence.append(f"{kw}→problem")
        else:
            unmatched.append(i)

    if embed is not None and unmatched:
        vectors = embed([top[i] for i in unmatched] + list(TOOL_PROTOTYPES) + list(PROBLEM_PROTOTYPES))
        kw_vecs = vectors[: len(unmatched)]
        tool_vecs = vectors[len(unmatched): len(unmatched) + len(TOOL_PROTOTYPES)]
        problem_vecs = vectors[len(unmatched) + len(TOOL_PROTOTYPES):]
        margin = (kw_vecs @ tool_vecs.T).max(axis=1) - (kw_vecs @ problem_vecs.T).max(axis=1)
        for idx, m in zip(unmatched, margin):
            votes[idx] = float(np.clip(m * 5, -1, 1)) * EMBEDDING_TRUST  # ~0.2 margin = full vote
            evidence.append(f"{top[idx]}→{'tool' if m > 0 else 'problem'}~")

    score = float((weights * votes).sum() / weights.sum())  # -1 (problem) .. +1 (tool)
    if score >= CATEGORY_THRESHOLD:
        category = Category.TOOL
    elif score <= -CATEGORY_THRESHOLD:
        category = Category.PROBLEM
    else:
        category = Category.UNKNOWN
    return category, round(abs(score), 3), ", ".join(evidence)


def taxonomy_check(a: TopicProfile, b: TopicProfile, strict: bool) -> tuple[float, str, bool]:
    """(multiplier, reason, rejected) for the tool-vs-object rule."""
    cats = {a.category, b.category}
    if cats == {Category.PROBLEM, Category.TOOL}:
        problem, tool = (a, b) if a.category == Category.PROBLEM else (b, a)
        return 1.0, f"Valid: method '{tool.label}' applied to problem '{problem.label}'", False
    if Category.UNKNOWN in cats:
        unclear = a if a.category == Category.UNKNOWN else b
        return 0.7, f"Uncertain: couldn't tell if '{unclear.label}' is a method or a problem domain", False
    kind = "tools" if a.category == Category.TOOL else "problem domains"
    missing = "problem to apply them to" if kind == "tools" else "method"
    action = "Rejected" if strict else "Demoted"
    return TAXONOMY_PENALTY, f"{action}: two {kind} paired, no {missing}", strict


# --- 2. Literature density ---------------------------------------------------

SATURATED_ABOVE = 500
SWEET_SPOT = (5, 100)


class LiteratureCounter(Protocol):
    """Anything that can count papers mentioning both terms (None = unknown)."""
    def count(self, term_a: str, term_b: str) -> int | None: ...


class ArxivLiteratureCounter:
    """Counts arXiv papers whose abstracts mention both terms, using the arXiv
    API's total-results number (no papers are downloaded). Results are cached
    in the database, and uncached queries wait `delay_seconds` apart, as
    arXiv's API rules ask."""

    API_URL = "https://export.arxiv.org/api/query"
    _TOTAL = re.compile(r"<opensearch:totalResults[^>]*>(\d+)</opensearch:totalResults>")

    RETRY_WAITS = (10.0, 30.0)  # seconds to wait after "too many requests" before retrying
    GIVE_UP_AFTER = 3  # consecutive failed lookups before skipping the rest of this run

    def __init__(self, delay_seconds: float = 3.0, timeout: float = 20.0) -> None:
        self.delay_seconds = delay_seconds
        self.timeout = timeout
        self._last_request = 0.0
        self._failures_in_a_row = 0

    @staticmethod
    def query_for(term_a: str, term_b: str) -> str:
        clean = lambda t: t.replace('"', " ").strip()  # noqa: E731 - quotes would break the phrase search
        return f'abs:"{clean(term_a)}" AND abs:"{clean(term_b)}"'

    def count(self, term_a: str, term_b: str) -> int | None:
        query = self.query_for(term_a, term_b)
        with Session(engine) as session:
            cached = session.get(LiteratureCount, query)
            if cached is not None:
                return cached.count

        if self._failures_in_a_row >= self.GIVE_UP_AFTER:
            return None  # arXiv is unreachable or rate-limiting us: don't keep trying this run

        body = self._fetch(query)
        match = self._TOTAL.search(body) if body is not None else None
        if match is None:
            self._failures_in_a_row += 1
            if self._failures_in_a_row == self.GIVE_UP_AFTER:
                log.warning("arXiv lookups failed %d times in a row; skipping the rest for this run.",
                            self.GIVE_UP_AFTER)
            return None
        self._failures_in_a_row = 0
        total = int(match.group(1))
        with Session(engine) as session:
            session.merge(LiteratureCount(query=query, count=total, checked_at=datetime.now(timezone.utc)))
            session.commit()
        return total


    def _fetch(self, query: str) -> str | None:
        """One API request (with polite spacing and retries). Returns the response text or None."""
        # max_results=1: we only need the total, but arXiv answers max_results=0 with a server error.
        url = f"{self.API_URL}?{urllib.parse.urlencode({'search_query': query, 'max_results': 1})}"
        request = urllib.request.Request(url, headers={"User-Agent": "research-gap-finder/0.1"})
        for attempt in range(len(self.RETRY_WAITS) + 1):
            wait = self.delay_seconds - (time.monotonic() - self._last_request)
            if wait > 0:
                time.sleep(wait)
            try:
                with urllib.request.urlopen(request, timeout=self.timeout) as response:
                    return response.read().decode("utf-8", errors="replace")
            except urllib.error.HTTPError as error:
                if error.code == 429 and attempt < len(self.RETRY_WAITS):  # too many requests: back off
                    log.info("arXiv rate limit hit; waiting %.0f s before retrying", self.RETRY_WAITS[attempt])
                    time.sleep(self.RETRY_WAITS[attempt])
                    continue
                log.warning("Literature lookup failed for %s: %s", query, error)
                return None
            except OSError as error:  # network down, timeout
                log.warning("Literature lookup failed for %s: %s", query, error)
                return None
            finally:
                self._last_request = time.monotonic()
        return None


class MockLiteratureCounter:
    """Offline stand-in for tests and demos: counts come from a dictionary keyed
    by the two terms in either order; unknown pairs get `default`."""

    def __init__(self, counts: dict[tuple[str, str], int], default: int | None = None) -> None:
        self._counts = {frozenset(pair): n for pair, n in counts.items()}
        self.default = default

    def count(self, term_a: str, term_b: str) -> int | None:
        return self._counts.get(frozenset((term_a, term_b)), self.default)


def literature_check(count: int | None) -> tuple[float, str, bool]:
    """(multiplier, reason, needs_human_review) for the Goldilocks rule."""
    low, high = SWEET_SPOT
    if count is None:
        return 1.0, "Not checked: literature count unavailable", False
    if count == 0:
        return 0.5, "Flagged: 0 papers mention both, speculative (needs human validation)", True
    if count < low:
        return 1.1, f"Emerging: only {count} papers mention both", False
    if count <= high:
        return 1.5, f"Promoted: Literature Goldilocks Zone ({count} papers)", False
    if count <= SATURATED_ABOVE:
        return 0.85, f"Established: {count} papers already mention both", False
    return 0.3, f"Demoted: Saturated ({count:,} papers already mention both)", False


# --- 3. Funding / utility proxy ---------------------------------------------

@dataclass(frozen=True)
class FundingDomain:
    name: str
    weight: float  # multiplier when a pair touches this domain
    terms: frozenset[str]


FUNDING_DOMAINS: tuple[FundingDomain, ...] = (
    FundingDomain("Semiconductor / EDA automation", 1.3, frozenset({
        "semiconductor", "chip", "circuit", "vlsi", "eda", "lithography", "fpga", "transistor", "wafer"})),
    FundingDomain("Renewable power grids & energy", 1.3, frozenset({
        "power grid", "grid", "renewable", "solar", "photovoltaic", "wind power", "wind turbine", "battery",
        "electricity", "load forecasting", "energy", "irradiance"})),
    FundingDomain("Clinical biotech & health", 1.3, frozenset({
        "clinical", "patient", "disease", "covid", "dengue", "malaria", "epidemic", "cancer", "drug",
        "protein", "genomic", "medical", "health"})),
    FundingDomain("Structural & functional materials", 1.25, frozenset({
        "material", "mof", "alloy", "catalyst", "polymer", "crystal", "structural", "composite"})),
    FundingDomain("Climate risk & disaster resilience", 1.25, frozenset({
        "flood", "wildfire", "fire", "drought", "cyclone", "tropical cyclone", "hurricane", "landslide",
        "heatwave", "extreme", "evacuation", "disaster", "risk"})),
    FundingDomain("Decarbonisation & emissions", 1.2, frozenset({
        "emission", "carbon", "methane", "carbon footprint", "contrail", "plume"})),
    FundingDomain("Agriculture & food security", 1.2, frozenset({
        "crop", "yield", "soil", "agricultural", "agriculture", "food security", "pest", "irrigation"})),
    FundingDomain("Water resources", 1.15, frozenset({
        "water", "hydrological", "groundwater", "river", "rainfall", "precipitation"})),
    FundingDomain("Built environment & mobility", 1.15, frozenset({
        "building", "hvac", "urban", "thermal", "indoor", "traffic", "transport"})),
    FundingDomain("Robotics & autonomous systems", 1.15, frozenset({"robot", "drone", "uav", "autonomous"})),
    FundingDomain("Earth observation & remote sensing", 1.1, frozenset({
        "satellite", "remote sensing", "lidar", "radar", "sar", "imagery"})),
    FundingDomain("Oceans, ice & weather prediction", 1.1, frozenset({
        "ocean", "sea ice", "ice", "arctic", "weather", "forecasting", "subseasonal", "sea surface"})),
    FundingDomain("Ecosystems & biodiversity", 1.1, frozenset({
        "vegetation", "forest", "canopy", "biomass", "species", "biodiversity", "ecosystem"})),
)

# Signs of unapplied theory: penalised when nothing applied is attached.
ABSTRACT_TERMS: frozenset[str] = frozenset({
    "conjecture", "axiom", "axiomatic", "lemma", "theorem", "category theory", "string theory",
    "quantum gravity", "abstract algebra", "formal proof",
})
NO_FUNDING_PENALTY = 0.75
ABSTRACT_PENALTY = 0.8

_FUNDING_NORM = tuple((d, frozenset(_norm(t) for t in d.terms)) for d in FUNDING_DOMAINS)
_ABSTRACT_NORM = frozenset(_norm(t) for t in ABSTRACT_TERMS)


def funding_matches(keywords: Sequence[str]) -> tuple[tuple[tuple[str, float], ...], tuple[str, ...]]:
    """Funding domains and abstract-theory words found in a topic's keywords."""
    domains: dict[str, float] = {}
    abstract: set[str] = set()
    for kw in keywords:
        for domain, terms in _FUNDING_NORM:
            if _contains_term(kw, terms):
                domains[domain.name] = domain.weight
        abstract.update(_contains_term(kw, _ABSTRACT_NORM))
    return tuple(sorted(domains.items(), key=lambda d: -d[1])), tuple(sorted(abstract))


def funding_check(a: TopicProfile, b: TopicProfile) -> tuple[float, str]:
    """(multiplier, reason) for the funding/utility proxy."""
    domains = dict(a.funding) | dict(b.funding)
    abstract = sorted(set(a.abstract_terms) | set(b.abstract_terms))
    if not domains:
        if abstract:
            return NO_FUNDING_PENALTY * ABSTRACT_PENALTY, (
                f"Demoted: abstract theory ({', '.join(abstract)}) with no funding vector")
        return NO_FUNDING_PENALTY, "Demoted: no plausible industry or grant-funding vector"
    name, weight = max(domains.items(), key=lambda d: d[1])
    multiplier, reason = weight, f"Promoted: strategic funding domain '{name}' (x{weight:.2f})"
    if abstract:
        multiplier *= ABSTRACT_PENALTY
        reason += f"; partly abstract theory ({', '.join(abstract)})"
    return multiplier, reason


# --- Putting it together -----------------------------------------------------

@dataclass(frozen=True)
class CandidatePair:
    """One pair of neighbouring clusters as scored by pipeline.gaps."""
    cluster_a: int
    cluster_b: int
    base_score: float  # relatedness x emptiness
    relatedness: float
    emptiness: float
    x: float  # gap position on the map
    y: float


def build_profiles(
    labels: dict[int, str], keywords: dict[int, list[str]], embed: Embedder | None = None
) -> dict[int, TopicProfile]:
    """Classify every cluster and find its funding domains."""
    profiles = {}
    for cluster_id, kws in keywords.items():
        category, confidence, evidence = classify_keywords(kws, embed)
        funding, abstract = funding_matches(kws)
        profiles[cluster_id] = TopicProfile(
            cluster_id=cluster_id, label=labels[cluster_id], keywords=tuple(kws), category=category,
            confidence=confidence, evidence=evidence, funding=funding, abstract_terms=abstract,
        )
        log.info("Topic '%s' -> %s (%.2f) [%s]", labels[cluster_id], category.value, confidence, evidence)
    return profiles


def query_term(profile: TopicProfile, other: TopicProfile) -> str:
    """The term searched for in the literature: the topic's most distinctive
    keyword that the other topic doesn't share, skipping 1-2 letter acronyms."""
    usable = [k for k in profile.keywords if len(k) >= 3] or list(profile.keywords)
    return llm.topic_phrase(usable, list(other.keywords), profile.label)


def validate_pairs(
    candidates: Sequence[CandidatePair],
    profiles: dict[int, TopicProfile],
    counter: LiteratureCounter | None = None,
    max_lookups: int = 30,
    strict_taxonomy: bool = False,
    progress: ProgressFn | None = None,
) -> pd.DataFrame:
    """Apply the three checks and return every pair, best first.

    Literature lookups are slow (arXiv asks for 3 s between requests), so only
    the `max_lookups` best pairs after the cheap checks are looked up.
    Rejected pairs stay in the table (final_score 0) so the decision is visible.
    """
    rows: list[dict] = []
    for pair in candidates:
        a, b = profiles[pair.cluster_a], profiles[pair.cluster_b]
        tax_mult, tax_reason, rejected = taxonomy_check(a, b, strict_taxonomy)
        fund_mult, fund_reason = funding_check(a, b)
        rows.append({
            "cluster_a": pair.cluster_a, "cluster_b": pair.cluster_b,
            "label_a": a.label, "label_b": b.label,
            "category_a": a.category.value, "category_b": b.category.value,
            "term_a": query_term(a, b), "term_b": query_term(b, a),
            "relatedness": round(pair.relatedness, 4), "emptiness": round(pair.emptiness, 4),
            "base_score": round(pair.base_score, 4),
            "taxonomy_multiplier": tax_mult, "funding_multiplier": round(fund_mult, 3),
            "literature_count": None, "literature_multiplier": 1.0,
            "rejected": rejected, "needs_review": False,
            "reasons": [tax_reason, fund_reason],
            "x": pair.x, "y": pair.y,
        })
    if not rows:
        return pd.DataFrame()

    df = pd.DataFrame(rows)
    df["interim_score"] = df["base_score"] * df["taxonomy_multiplier"] * df["funding_multiplier"]
    df = df.sort_values("interim_score", ascending=False, ignore_index=True)

    # Literature lookups for the most promising pairs only. Results are
    # collected in plain lists, then written to the table in one go.
    reasons: list[list[str]] = df["reasons"].tolist()
    counts: list[int | None] = [None] * len(df)
    lit_mult: list[float] = [1.0] * len(df)
    review: list[bool] = [False] * len(df)
    to_check = list(df.index[~df["rejected"]][: max_lookups if counter is not None else 0])
    for n, i in enumerate(to_check, start=1):
        if progress:
            progress(f"Checking the literature for gap {n}/{len(to_check)}...", n / len(to_check))
        counts[i] = counter.count(df.at[i, "term_a"], df.at[i, "term_b"])
        lit_mult[i], reason, review[i] = literature_check(counts[i])
        reasons[i].append(reason)
    for i in set(df.index) - set(to_check):
        reasons[i].append("Not checked: rejected" if df.at[i, "rejected"] else "Not checked: outside the top candidates")
    df["literature_count"] = pd.array(counts, dtype="Int64")  # Int64 allows missing values
    df["literature_multiplier"] = lit_mult
    df["needs_review"] = review
    df["reasons"] = reasons

    df["final_score"] = (df["interim_score"] * df["literature_multiplier"]).where(~df["rejected"], 0.0).round(4)
    net = df["final_score"] / df["base_score"]
    df["status"] = np.select(
        [df["rejected"], df["needs_review"], net >= 1.1, net <= 0.9],
        ["rejected", "needs_review", "promoted", "demoted"],
        default="neutral",
    )
    df = df.sort_values("final_score", ascending=False, ignore_index=True).drop(columns="interim_score")

    for row in df.itertuples():
        log.info("%-9s %.3f -> %.3f  %s <-> %s | %s", row.status, row.base_score, row.final_score,
                 row.label_a, row.label_b, " | ".join(row.reasons))
    return df


# --- Is this topic worth exploring? ------------------------------------------

STRONG_STATUSES = frozenset({"promoted", "neutral"})  # survived validation without a penalty
MIN_STRONG_BASE_SCORE = 0.15  # weaker map scores mean the two topics barely form a gap
MIN_STRONG_GAPS = 3  # fewer strong gaps than this = limited opportunities


def assess_topic(gaps: Sequence[dict]) -> dict:
    """Overall verdict for a map, from its saved gaps (dicts with "status" and "base_score").

    A gap is "strong" when validation didn't penalise it (promoted or neutral)
    and its map score shows a real gap between two related topics.
    verdict: "clear" (enough strong gaps), "limited" (one or two) or "none".
    """
    strong = [g for g in gaps
              if g.get("status") in STRONG_STATUSES and (g.get("base_score") or 0) >= MIN_STRONG_BASE_SCORE]
    penalised = sum(g.get("status") in ("demoted", "rejected") for g in gaps)
    review = sum(g.get("status") == "needs_review" for g in gaps)
    n, total = len(strong), len(gaps)

    if total == 0:
        verdict = "none"
        message = ("No research gaps were found: the papers on this topic don't split into related "
                   "areas with unexplored space between them. Try a broader or different topic.")
    elif n == 0:
        verdict = "none"
        details = [f"{penalised} of {total} candidate gaps were demoted"] if penalised else []
        if review:
            details.append(f"{review} {'needs' if review == 1 else 'need'} a human to check "
                           f"{'it' if review == 1 else 'them'}")
        weak = total - penalised - review
        if weak > 0:
            details.append(f"{weak} {'is' if weak == 1 else 'are'} only weakly connected")
        message = ("This topic doesn't look feasible for finding a research gap: no pair of topics shows a "
                   f"strong, unexplored connection ({'; '.join(details)}). Try a broader or different topic.")
    elif n < MIN_STRONG_GAPS:
        verdict = "limited"
        message = (f"Only {n} of {total} gaps {'is' if n == 1 else 'are'} promising; the rest were demoted, need "
                   "review or are weakly connected. There may be little room to expand research here.")
    else:
        verdict = "clear"
        message = f"{n} of {total} gaps are promising."
    return {"verdict": verdict, "strong_gaps": n, "total_gaps": total, "message": message}


def default_embedder() -> Embedder:
    """Embedding function using the pipeline's model (loaded once per process)."""
    from pipeline.embed_cluster import embedding_model  # local import: heavy, only needed here

    def embed(texts: Sequence[str]) -> np.ndarray:
        vectors = np.array(list(embedding_model().embed(list(texts))))
        return vectors / np.linalg.norm(vectors, axis=1, keepdims=True)

    return embed
