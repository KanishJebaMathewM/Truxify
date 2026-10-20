import numpy as np
import pytest

from app.models.collaborative_filter import CollaborativeFilter


@pytest.fixture
def loaded_filter():
    model = CollaborativeFilter()
    model.user_ids = ["user_001"]
    model.load_ids = ["load_001"]
    model.truck_ids = ["truck_001"]
    model.user_load_approx = np.array([[4.0]])
    model.user_truck_approx = np.array([[4.0]])
    model._popular_loads = np.array([0])
    model._popular_trucks = np.array([0])
    return model


@pytest.mark.parametrize("top_n", [-1, 0, 51])
def test_recommend_loads_rejects_invalid_top_n(loaded_filter, top_n):
    with pytest.raises(ValueError, match="top_n must be between 1 and 50"):
        loaded_filter.recommend_loads("user_001", [], top_n=top_n)


@pytest.mark.parametrize("top_n", [-1, 0, 51])
def test_recommend_trucks_rejects_invalid_top_n(loaded_filter, top_n):
    with pytest.raises(ValueError, match="top_n must be between 1 and 50"):
        loaded_filter.recommend_trucks("user_001", [], top_n=top_n)


@pytest.mark.parametrize("top_n", [1, 50])
def test_valid_top_n_preserves_recommendation_behavior(loaded_filter, top_n):
    loads = loaded_filter.recommend_loads("user_001", [], top_n=top_n)
    trucks = loaded_filter.recommend_trucks("user_001", [], top_n=top_n)

    assert len(loads["recommendations"]) == 1
    assert len(trucks["recommendations"]) == 1
