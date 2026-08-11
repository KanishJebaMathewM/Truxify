import numpy as np

class HighwayGraphDatasetLoader:
    """
    Loads spatial highway network graph nodes (junctions/toll plazas) and edges (highway corridors).
    """
    def load_highway_graph(self) -> dict:
        # 5 highway junction nodes with [avg_speed, vehicle_density, toll_wait_time_mins]
        node_features = np.array([
            [60.0, 120.0, 2.0],
            [25.0, 450.0, 15.0],  # Congested Toll Plaza
            [55.0, 150.0, 3.0],
            [40.0, 280.0, 8.0],
            [70.0, 90.0, 1.0],
        ])
        
        # Directed edges connecting nodes
        edge_index = np.array([
            [0, 1, 1, 2, 2, 3, 3, 4],
            [1, 0, 2, 1, 3, 2, 4, 3]
        ])

        return {
            "node_features": node_features,
            "edge_index": edge_index,
            "num_nodes": 5
        }

graph_loader = HighwayGraphDatasetLoader()
