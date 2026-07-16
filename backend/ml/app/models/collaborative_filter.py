"""Collaborative Filter – personalised load & truck recommendations via SVD.

Uses truncated SVD (``numpy.linalg.svd``) on user–item interaction matrices
to learn latent factors.  Cold-start users receive popularity-based
recommendations.

NOTE: This module currently trains on synthetic interaction data as a
placeholder.  Replace ``_generate_synthetic_data`` with a real data pipeline
to make predictions meaningful.
"""

import logging
from typing import Dict, List, Optional, Any

import numpy as np

from .base import save_model, load_model, model_exists

logger = logging.getLogger(__name__)

MODEL_NAME = "collaborative_filter"

# ---------------------------------------------------------------------------
# Synthetic data generation
# ---------------------------------------------------------------------------

N_USERS = 100
N_LOADS = 50
N_TRUCKS = 30
LATENT_K = 10  # number of latent factors to keep


def _generate_synthetic_data() -> dict:
    """Build sparse user-item interaction matrices with random ratings 1-5.

    Returns
    -------
    dict
        ``user_load_matrix``  – shape (N_USERS, N_LOADS)
        ``user_truck_matrix`` – shape (N_USERS, N_TRUCKS)
        ``user_ids``          – list of synthetic user-id strings
        ``load_ids``          – list of synthetic load-id strings
        ``truck_ids``         – list of synthetic truck-id strings
    """
    np.random.seed(42)

    user_ids = [f"user_{i:03d}" for i in range(N_USERS)]
    load_ids = [f"load_{i:03d}" for i in range(N_LOADS)]
    truck_ids = [f"truck_{i:03d}" for i in range(N_TRUCKS)]

    # ~20% density – most cells are 0 (no interaction)
    ul = np.zeros((N_USERS, N_LOADS), dtype=np.float64)
    for i in range(N_USERS):
        n_interactions = np.random.randint(1, max(2, int(N_LOADS * 0.3)))
        cols = np.random.choice(N_LOADS, size=n_interactions, replace=False)
        ul[i, cols] = np.random.randint(1, 6, size=n_interactions).astype(np.float64)

    ut = np.zeros((N_USERS, N_TRUCKS), dtype=np.float64)
    for i in range(N_USERS):
        n_interactions = np.random.randint(1, max(2, int(N_TRUCKS * 0.3)))
        cols = np.random.choice(N_TRUCKS, size=n_interactions, replace=False)
        ut[i, cols] = np.random.randint(1, 6, size=n_interactions).astype(np.float64)

    return {
        "user_load_matrix": ul,
        "user_truck_matrix": ut,
        "user_ids": user_ids,
        "load_ids": load_ids,
        "truck_ids": truck_ids,
    }


# ---------------------------------------------------------------------------
# SVD helpers
# ---------------------------------------------------------------------------


def _svd_reconstruct(matrix: np.ndarray, k: int) -> np.ndarray:
    """Return the rank-*k* approximation of *matrix* via truncated SVD."""
    U, s, Vt = np.linalg.svd(matrix, full_matrices=False)
    k = min(k, len(s))
    return (U[:, :k] * s[:k]) @ Vt[:k, :]


def _popularity_ranking(matrix: np.ndarray) -> np.ndarray:
    """Return item indices sorted by total interaction score (descending)."""
    totals = matrix.sum(axis=0)
    return np.argsort(-totals)


# ---------------------------------------------------------------------------
# Main class
# ---------------------------------------------------------------------------


class CollaborativeFilter:
    """SVD-based collaborative filtering recommender."""

    def __init__(self) -> None:
        self.user_load_approx: Optional[np.ndarray] = None
        self.user_truck_approx: Optional[np.ndarray] = None
        self.user_ids: List[str] = []
        self.load_ids: List[str] = []
        self.truck_ids: List[str] = []
        self.user_load_matrix: Optional[np.ndarray] = None
        self.user_truck_matrix: Optional[np.ndarray] = None
        self._popular_loads: Optional[np.ndarray] = None
        self._popular_trucks: Optional[np.ndarray] = None

    # -- persistence --------------------------------------------------------

    def train(self) -> dict:
        """Generate synthetic data, compute SVD approximations, persist."""
        data = _generate_synthetic_data()

        self.user_ids = data["user_ids"]
        self.load_ids = data["load_ids"]
        self.truck_ids = data["truck_ids"]
        self.user_load_matrix = data["user_load_matrix"]
        self.user_truck_matrix = data["user_truck_matrix"]

        self.user_load_approx = _svd_reconstruct(self.user_load_matrix, LATENT_K)
        self.user_truck_approx = _svd_reconstruct(self.user_truck_matrix, LATENT_K)

        self._popular_loads = _popularity_ranking(self.user_load_matrix)
        self._popular_trucks = _popularity_ranking(self.user_truck_matrix)

        payload = {
            "user_load_approx": self.user_load_approx,
            "user_truck_approx": self.user_truck_approx,
            "user_load_matrix": self.user_load_matrix,
            "user_truck_matrix": self.user_truck_matrix,
            "user_ids": self.user_ids,
            "load_ids": self.load_ids,
            "truck_ids": self.truck_ids,
            "popular_loads": self._popular_loads,
            "popular_trucks": self._popular_trucks,
        }

        metrics = {
            "n_users": len(self.user_ids),
            "n_loads": len(self.load_ids),
            "n_trucks": len(self.truck_ids),
            "latent_k": LATENT_K,
        }

        save_model(payload, MODEL_NAME, metrics)
        logger.info(
            "Collaborative filter trained: %d users, %d loads, %d trucks",
            len(self.user_ids),
            len(self.load_ids),
            len(self.truck_ids),
        )
        return metrics

    def load(self) -> None:
        """Load persisted model; auto-train if none exists."""
        if not model_exists(MODEL_NAME):
            self.train()
            return

        payload = load_model(MODEL_NAME)
        if payload is None:
            self.train()
            return

        self.user_load_approx = payload["user_load_approx"]
        self.user_truck_approx = payload["user_truck_approx"]
        self.user_load_matrix = payload["user_load_matrix"]
        self.user_truck_matrix = payload["user_truck_matrix"]
        self.user_ids = payload["user_ids"]
        self.load_ids = payload["load_ids"]
        self.truck_ids = payload["truck_ids"]
        self._popular_loads = payload["popular_loads"]
        self._popular_trucks = payload["popular_trucks"]

    # -- helpers ------------------------------------------------------------

    def _ensure_loaded(self) -> None:
        if self.user_load_approx is None:
            self.load()

    def _user_index(self, user_id: str) -> Optional[int]:
        try:
            return self.user_ids.index(user_id)
        except ValueError:
            return None

    # -- private recommendation pipeline ------------------------------------

    def _recommend(
        self,
        user_id: str,
        entity_type: str,
        ids: List[str],
        popular: np.ndarray,
        approx: np.ndarray,
        booking_history: List[Dict[str, Any]],
        booking_key: str,
        top_n: int,
    ) -> Dict[str, Any]:
        """Shared recommendation pipeline for any entity type.

        Parameters
        ----------
        user_id : str
            Requesting user identifier (used for logging).
        entity_type : str
            ``"load"`` or ``"truck"`` (used for logging and output keys).
        ids : list[str]
            Entity IDs aligned with the columns of *approx*.
        popular : np.ndarray
            Popularity-sorted indices (cold-start fallback).
        approx : np.ndarray
            SVD-reconstructed user–entity score matrix.
        booking_history : list[dict]
            Past bookings used to filter already-seen entities.
        booking_key : str
            Key in each booking dict that holds the entity ID
            (``"load_id"`` or ``"truck_id"``).
        top_n : int
            Number of recommendations to return.

        Returns
        -------
        dict
            ``{"recommendations": [{entity_type + "_id": ..., "relevance_score": ...}, ...]}``
        """
        idx = self._user_index(user_id)

        # Cold-start fallback
        if idx is None:
            logger.info(
                "Cold start for user '%s'; returning popular %ss.", user_id, entity_type,
            )
            recs = []
            for rank, ei in enumerate(popular[:top_n]):
                recs.append({
                    f"{entity_type}_id": ids[int(ei)],
                    "relevance_score": round(1.0 - rank * 0.05, 4),
                })
            return {"recommendations": recs}

        scores = approx[idx]

        # Exclude already-booked entities
        booked_ids = {b.get(booking_key) for b in booking_history if booking_key in b}
        masked_scores = scores.copy()
        for i, eid in enumerate(ids):
            if eid in booked_ids:
                masked_scores[i] = -np.inf

        top_indices = np.argsort(-masked_scores)[:top_n]
        recs = []
        for i in top_indices:
            if masked_scores[i] == -np.inf:
                continue
            recs.append({
                f"{entity_type}_id": ids[i],
                "relevance_score": round(float(np.clip(masked_scores[i] / 5.0, 0, 1)), 4),
            })

        return {"recommendations": recs}

    # -- public API ---------------------------------------------------------

    def recommend_loads(
        self,
        user_id: str,
        booking_history: List[Dict[str, Any]],
        rated_drivers: List[Dict[str, Any]],
        top_n: int = 5,
    ) -> Dict[str, Any]:
        """Return personalised load recommendations for *user_id*.

        Parameters
        ----------
        user_id : str
            Identifier for the requesting user.
        booking_history : list[dict]
            Past bookings (used for filtering already-seen loads).
        rated_drivers : list[dict]
            Drivers the user has rated (contextual signal, reserved for future use).
        top_n : int
            Number of recommendations to return.

        Returns
        -------
        dict
            ``recommendations`` – list of ``{load_id, relevance_score}``.
        """
        self._ensure_loaded()
        return self._recommend(
            user_id, "load", self.load_ids, self._popular_loads,
            self.user_load_approx, booking_history, "load_id", top_n,
        )

    def recommend_trucks(
        self,
        user_id: str,
        booking_history: List[Dict[str, Any]],
        rated_loads: List[Dict[str, Any]],
        top_n: int = 5,
    ) -> Dict[str, Any]:
        """Return personalised truck recommendations for *user_id*.

        Parameters
        ----------
        user_id : str
            Identifier for the requesting user.
        booking_history : list[dict]
            Past bookings (used for filtering already-seen trucks).
        rated_loads : list[dict]
            Loads the user has rated (contextual signal, reserved for future use).
        top_n : int
            Number of recommendations to return.

        Returns
        -------
        dict
            ``recommendations`` – list of ``{truck_id, relevance_score}``.
        """
        self._ensure_loaded()
        return self._recommend(
            user_id, "truck", self.truck_ids, self._popular_trucks,
            self.user_truck_approx, booking_history, "truck_id", top_n,
        )


# Module-level singleton
collaborative_filter = CollaborativeFilter()
