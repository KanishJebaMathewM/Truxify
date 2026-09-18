import numpy as np

from app.models.collaborative_filter import _prepare_svd_matrix, _svd_reconstruct


def test_missing_interactions_are_centered_to_neutral_user_baseline():
    matrix = np.array(
        [
            [5.0, 1.0, 0.0, 0.0],
            [4.0, 0.0, 0.0, 0.0],
        ],
        dtype=np.float64,
    )

    centered, user_means = _prepare_svd_matrix(matrix)

    assert user_means.tolist() == [3.0, 4.0]
    assert centered[0, 0] == 2.0
    assert centered[0, 1] == -2.0
    assert centered[0, 2] == 0.0
    assert centered[0, 3] == 0.0
    assert centered[1, 0] == 0.0
    assert centered[1, 1] == 0.0


def test_reconstruction_preserves_observed_rating_scale_for_sparse_matrix():
    matrix = np.array(
        [
            [5.0, 1.0, 0.0],
            [4.0, 0.0, 0.0],
            [1.0, 5.0, 0.0],
        ],
        dtype=np.float64,
    )

    reconstructed = _svd_reconstruct(matrix, k=2)

    assert reconstructed.shape == matrix.shape
    assert np.isfinite(reconstructed).all()
    assert np.all(reconstructed >= 0.0)
    assert abs(reconstructed[0, 0] - 5.0) < 1e-8
    assert abs(reconstructed[0, 1] - 1.0) < 1e-8
