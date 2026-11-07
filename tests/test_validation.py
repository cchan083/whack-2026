"""Tests for the validation layer (pipeline/validation.py). No network or database needed.

Run with:  python -m tests.test_validation      (or: pytest tests)
"""

from pipeline import validation as v
from pipeline.validation import CandidatePair, Category, MockLiteratureCounter

# Small, readable topics: two methods and three problem domains.
LABELS = {1: "llms", 2: "gaussian process", 3: "sea ice", 4: "crop yield", 5: "conjecture"}
KEYWORDS = {
    1: ["large language", "llms", "reasoning"],
    2: ["gaussian process", "kernel", "bayesian"],
    3: ["sea ice", "arctic", "ocean"],
    4: ["crop", "yield prediction", "soil"],
    5: ["conjecture", "lemma", "manifold"],
}
PROFILES = v.build_profiles(LABELS, KEYWORDS, embed=None)


def pair(a: int, b: int, base: float = 0.5) -> CandidatePair:
    return CandidatePair(cluster_a=a, cluster_b=b, base_score=base, relatedness=0.8, emptiness=base / 0.8, x=0, y=0)


def test_classification() -> None:
    assert PROFILES[1].category == Category.TOOL
    assert PROFILES[2].category == Category.TOOL
    assert PROFILES[3].category == Category.PROBLEM
    assert PROFILES[4].category == Category.PROBLEM


def test_literature_bands() -> None:
    assert v.literature_check(1000)[0] < 1  # saturated
    assert v.literature_check(50)[0] > 1  # Goldilocks
    assert v.literature_check(0)[2] is True  # flagged for review
    assert v.literature_check(None)[0] == 1.0  # unknown: neutral


def test_two_tools_demoted_and_strict_rejects() -> None:
    df = v.validate_pairs([pair(1, 2)], PROFILES)
    assert df.loc[0, "status"] == "demoted"
    assert any("two tools paired" in r for r in df.loc[0, "reasons"])
    strict = v.validate_pairs([pair(1, 2)], PROFILES, strict_taxonomy=True)
    assert strict.loc[0, "status"] == "rejected" and strict.loc[0, "final_score"] == 0


def test_goldilocks_beats_saturated() -> None:
    counter = MockLiteratureCounter({
        (v.query_term(PROFILES[1], PROFILES[3]), v.query_term(PROFILES[3], PROFILES[1])): 40,   # sweet spot
        (v.query_term(PROFILES[2], PROFILES[4]), v.query_term(PROFILES[4], PROFILES[2])): 900,  # saturated
    })
    # The saturated pair starts with the higher base score but should end up second.
    df = v.validate_pairs([pair(2, 4, base=0.6), pair(1, 3, base=0.5)], PROFILES, counter=counter)
    assert (df.loc[0, "cluster_a"], df.loc[0, "cluster_b"]) == (1, 3)
    assert any("Goldilocks" in r for r in df.loc[0, "reasons"])
    assert any("Saturated" in r for r in df.loc[1, "reasons"])


def test_zero_papers_flagged() -> None:
    df = v.validate_pairs([pair(1, 3)], PROFILES, counter=MockLiteratureCounter({}, default=0))
    assert df.loc[0, "status"] == "needs_review"


def test_no_funding_vector_penalised() -> None:
    # "conjecture/lemma" topic: no funding domain and abstract theory.
    mult, reason = v.funding_check(PROFILES[1], PROFILES[5])
    assert mult < v.NO_FUNDING_PENALTY and "abstract theory" in reason


if __name__ == "__main__":
    tests = [f for name, f in dict(globals()).items() if name.startswith("test_")]
    for test in tests:
        test()
        print(f"ok  {test.__name__}")
    print(f"{len(tests)} tests passed")


def gaps(*rows: tuple[str, float]) -> list[dict]:
    return [{"status": status, "base_score": base} for status, base in rows]


def test_assessment_none_when_everything_demoted() -> None:
    result = v.assess_topic(gaps(("demoted", 0.7), ("demoted", 0.5)))
    assert result["verdict"] == "none" and result["strong_gaps"] == 0
    assert "2 of 2 candidate gaps were demoted" in result["message"]


def test_assessment_none_when_promoted_gaps_are_weak() -> None:
    result = v.assess_topic(gaps(("promoted", 0.07), ("demoted", 0.4)))
    assert result["verdict"] == "none"
    assert "weakly connected" in result["message"]


def test_assessment_none_without_gaps() -> None:
    assert v.assess_topic([])["verdict"] == "none"


def test_assessment_limited_and_clear() -> None:
    assert v.assess_topic(gaps(("promoted", 0.5), ("demoted", 0.5)))["verdict"] == "limited"
    clear = v.assess_topic(gaps(("promoted", 0.5), ("neutral", 0.3), ("promoted", 0.2), ("needs_review", 0.6)))
    assert clear["verdict"] == "clear" and clear["strong_gaps"] == 3
