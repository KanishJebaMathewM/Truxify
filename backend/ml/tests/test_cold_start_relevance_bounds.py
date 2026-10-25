import numpy as np
import pytest

from app.models.collaborative_filter import CollaborativeFilter


@pytest.fixture
def recommender():
    model = CollaborativeFilter()
    model.user_ids = ["known"]
    model.load_ids = [f"load-{i}" for i in range(50)]
    model.truck_ids = [f"truck-{i}" for i in range(30)]
    model.user_load_approx = np.full((1, 50), 4.0)
    model.user_truck_approx = np.full((1, 30), 4.0)
    model._popular_loads = np.arange(50)
    model._popular_trucks = np.arange(30)
    return model


@pytest.mark.parametrize("entity", ["load", "truck"])
@pytest.mark.parametrize("exclude_first", [False, True])
def test_large_cold_start_results_remain_bounded_and_ranked(
    recommender, entity, exclude_first
):
    method = getattr(recommender, f"recommend_{entity}s")
    ids = getattr(recommender, f"{entity}_ids")
    history = [{f"{entity}_id": ids[0]}] if exclude_first else []
    rows = method("unknown", history, top_n=50)["recommendations"]

    expected_ids = ids[1:] if exclude_first else ids
    assert [row[f"{entity}_id"] for row in rows] == expected_ids
    scores = [row["relevance_score"] for row in rows]
    assert all(0 <= score <= 1 for score in scores)
    assert scores == sorted(scores, reverse=True)
    # Preserve the established first twenty scores and the requested count.
    assert scores[:20] == [round(1 - rank * 0.05, 4) for rank in range(20)]
    assert scores[20:] == [0.0] * (len(scores) - 20)


@pytest.mark.parametrize("entity", ["load", "truck"])
def test_known_user_scores_are_unchanged(recommender, entity):
    rows = getattr(recommender, f"recommend_{entity}s")(
        "known", [], top_n=50
    )["recommendations"]
    assert all(row["relevance_score"] == 0.8 for row in rows)
