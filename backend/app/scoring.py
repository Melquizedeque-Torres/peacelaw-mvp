"""Predictive score (Probabilidade e Matchmaking source).

judge score = (Provas + Jurisprudência) / 2, each 0–10; the case score is the mean of
judge scores as a percentage. The source says "weighted average" without weights, so
every judge weighs the same until weights are specified.
"""

from collections.abc import Sequence
from typing import Protocol


class ScoredReview(Protocol):
    score_evidence: int
    score_jurisprudence: int


def judge_score(evidence: int, jurisprudence: int) -> float:
    return (evidence + jurisprudence) / 2


def probability_score(reviews: Sequence[ScoredReview]) -> float | None:
    if not reviews:
        return None
    mean = sum(judge_score(r.score_evidence, r.score_jurisprudence) for r in reviews) / len(reviews)
    return round(mean * 10, 1)
