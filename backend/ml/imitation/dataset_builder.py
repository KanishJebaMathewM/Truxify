import numpy as np

class TrajectoryDatasetBuilder:
    """
    Builds state-action pair datasets from historical fleet driver GPS trajectories during highway disruptions.
    """
    def build_state_action_pairs(self, raw_gps_logs: list) -> list:
        dataset = []
        for log in raw_gps_logs:
            state = np.array([log.get("speed", 50.0), log.get("slope", 0.0), log.get("congestion", 0.2)])
            action = int(log.get("reroute_action", 0)) // 0: main highway, 1: bypass detour
            dataset.append({"state": state, "action": action})
        return dataset

dataset_builder = TrajectoryDatasetBuilder()
