import numpy as np

class FederatedAveragingServer:
    """
    FedAvg Aggregator Server. Aggregates encrypted/compressed local model weight updates from Driver Apps.
    """
    def __init__(self, num_weights: int = 10):
        self.num_weights = num_weights
        self.global_weights = np.zeros(num_weights)

    def aggregate_updates(self, client_updates: list) -> np.ndarray:
        """
        client_updates: List of dicts containing {"weights": np.ndarray, "num_samples": int}
        """
        if not client_updates:
            return self.global_weights

        total_samples = sum(c["num_samples"] for c in client_updates)
        weighted_sum = np.zeros(self.num_weights)

        for client in client_updates:
            weight = client["num_samples"] / total_samples
            weighted_sum += client["weights"] * weight

        self.global_weights = weighted_sum
        return self.global_weights

fl_server = FederatedAveragingServer()
