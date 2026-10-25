from types import SimpleNamespace

from app.scoring import judge_score, probability_score


def review(evidence: int, jurisprudence: int) -> SimpleNamespace:
    return SimpleNamespace(score_evidence=evidence, score_jurisprudence=jurisprudence)


def test_judge_score_is_the_mean_of_both_criteria():
    assert judge_score(8, 6) == 7.0


def test_no_reviews_means_no_score():
    assert probability_score([]) is None


def test_score_is_mean_of_judge_scores_times_ten():
    assert probability_score([review(8, 6), review(9, 7)]) == 75.0


def test_score_is_rounded_to_one_decimal():
    assert probability_score([review(8, 7), review(6, 6), review(5, 5)]) == 61.7


def test_score_bounds():
    assert probability_score([review(0, 0)]) == 0.0
    assert probability_score([review(10, 10)]) == 100.0
