from . import models as _models


_BaseGraphNetworkBuilder = _models.GraphNetworkBuilder
_BaseRouteOptimizer = _models.RouteOptimizer


class GraphNetworkBuilder(_BaseGraphNetworkBuilder):
    """Build directed multigraphs so parallel road segments remain distinct."""

    def __init__(self):
        self.graph = __import__("networkx").MultiDiGraph()
        self.node_features = {}
        self.edge_features = {}

    def build_road_network(self, nodes, edges):
        for node in nodes:
            self.graph.add_node(
                node["id"],
                lat=node["lat"],
                lng=node["lng"],
                traffic=node.get("traffic", 0),
                road_type=node.get("road_type", "local"),
                speed_limit=node.get("speed_limit", 50),
            )

        for edge in edges:
            edge_kwargs = {
                "distance": edge["distance"],
                "time": edge["time"],
                "cost": edge.get("cost", 0),
                "fuel": edge.get("fuel", 0),
                "congestion": edge.get("congestion", 0),
                "hazmat_allowed": edge.get("hazmat_allowed", True),
                "max_weight": edge.get("max_weight"),
                "max_height": edge.get("max_height"),
            }
            if edge.get("key") is not None:
                edge_kwargs["key"] = edge["key"]
            self.graph.add_edge(edge["source"], edge["target"], **edge_kwargs)

        return self.graph

    def extract_features(self):
        import torch

        node_features = []
        edge_indices = []
        edge_features = []
        node_map = {
            node: i for i, (node, _) in enumerate(self.graph.nodes(data=True))
        }

        for _, data in self.graph.nodes(data=True):
            node_features.append(
                [
                    data.get("lat", 0),
                    data.get("lng", 0),
                    data.get("traffic", 0) / 100,
                    *self._road_type_encoding(data.get("road_type", "local")),
                    data.get("speed_limit", 50) / 100,
                ]
            )

        for u, v, _, data in self.graph.edges(data=True, keys=True):
            edge_indices.append([node_map[u], node_map[v]])
            edge_features.append(
                [
                    data.get("distance", 0) / 100,
                    data.get("time", 0) / 100,
                    data.get("cost", 0) / 1000,
                    data.get("fuel", 0) / 100,
                    data.get("congestion", 0),
                ]
            )

        self.node_map = node_map

        if edge_indices:
            edge_index = torch.tensor(edge_indices, dtype=torch.long).t().contiguous()
            edge_attr = torch.tensor(edge_features, dtype=torch.float)
        else:
            edge_index = torch.empty((2, 0), dtype=torch.long)
            edge_attr = torch.empty((0, _models.GNN_EDGE_FEATURE_DIM), dtype=torch.float)

        return {
            "node_features": torch.tensor(node_features, dtype=torch.float).reshape(
                -1, _models.GNN_NODE_FEATURE_DIM
            ),
            "edge_indices": edge_index,
            "edge_features": edge_attr,
        }


class RouteOptimizer(_BaseRouteOptimizer):
    """Route optimizer that evaluates and preserves individual parallel edges."""

    def _iter_outgoing_edges(self, graph, node):
        if graph.is_multigraph():
            yield from graph.out_edges(node, keys=True, data=True)
        else:
            for neighbor, data in graph[node].items():
                yield node, neighbor, None, data

    def _edge_weight(
        self,
        current,
        neighbor,
        edge_attrs,
        embeddings,
        objectives,
        graph_data,
        node_map,
        constraints,
    ):
        if hasattr(self, "_edge_is_feasible") and not self._edge_is_feasible(
            edge_attrs, constraints
        ):
            return None
        if hasattr(self, "_calculate_score"):
            return self._calculate_score(
                embeddings,
                current,
                neighbor,
                objectives,
                graph_data,
                node_map,
                edge_attrs,
            )
        return None

    def _calculate_score(
        self,
        embeddings,
        current,
        neighbor,
        objectives,
        graph_data,
        node_map=None,
        edge_data=None,
    ):
        import numpy as np

        score = 0.0
        edge_data = (
            edge_data
            if edge_data is not None
            else graph_data.graph[current][neighbor]
        )
        weights = {
            "time": 1.0,
            "cost": 0.5,
            "fuel": 0.3,
            "distance": 0.2,
            "congestion": 2.0,
        }

        for objective in objectives:
            if objective in edge_data:
                score += weights.get(objective, 1.0) * float(edge_data[objective])

        node_map = node_map if node_map is not None else getattr(graph_data, "node_map", None)
        if embeddings is not None and node_map and current in node_map and neighbor in node_map:
            try:
                score += 0.1 * float(
                    np.linalg.norm(
                        embeddings[node_map[current]] - embeddings[node_map[neighbor]]
                    )
                )
            except Exception:
                pass

        return max(score, 1e-6)

    def _find_optimal_route(
        self, start, end, embeddings, graph_data, objectives, constraints=None
    ):
        if not hasattr(graph_data, "graph"):
            return None

        graph = graph_data.graph
        if start not in graph or end not in graph:
            return None
        if start == end:
            return []

        constraints = constraints or {}
        node_map = getattr(graph_data, "node_map", None)
        max_time = constraints.get("max_time")
        if max_time is None:
            max_time = constraints.get("hos_limit")

        pq = [(0.0, 0.0, 0, start, (start,), ())]
        counter = 1
        best_score = {}
        nondominated = {}
        selected_edge_path = None

        while pq:
            curr_score, curr_time, _, current, node_path, edge_path = __import__(
                "heapq"
            ).heappop(pq)

            if current == end:
                selected_edge_path = edge_path
                break

            if max_time is None:
                if curr_score >= best_score.get(current, float("inf")):
                    continue
                best_score[current] = curr_score
            else:
                labels = nondominated.setdefault(current, [])
                if any(
                    score <= curr_score and elapsed <= curr_time
                    for score, elapsed in labels
                ):
                    continue
                nondominated[current] = [
                    (score, elapsed)
                    for score, elapsed in labels
                    if not (curr_score <= score and curr_time <= elapsed)
                ] + [(curr_score, curr_time)]

            for _, neighbor, edge_key, edge_attrs in self._iter_outgoing_edges(
                graph, current
            ):
                if neighbor in node_path:
                    continue

                edge_weight = self._edge_weight(
                    current,
                    neighbor,
                    edge_attrs,
                    embeddings,
                    objectives,
                    graph_data,
                    node_map,
                    constraints,
                )
                if edge_weight is None:
                    continue

                edge_time = float(edge_attrs.get("time", 0))
                new_time = curr_time + edge_time
                if max_time is not None and new_time > max_time:
                    continue

                __import__("heapq").heappush(
                    pq,
                    (
                        curr_score + edge_weight,
                        new_time,
                        counter,
                        neighbor,
                        node_path + (neighbor,),
                        edge_path
                        + ((current, neighbor, edge_key, dict(edge_attrs)),),
                    ),
                )
                counter += 1

        if selected_edge_path is None:
            return None

        return self._route_from_edges(selected_edge_path)

    @staticmethod
    def _route_from_edges(edge_path):
        route = []
        for u, v, key, data in edge_path:
            segment = {
                "from": u,
                "to": v,
                "distance": data.get("distance", 0),
                "time": data.get("time", 0),
                "cost": data.get("cost", 0),
                "fuel": data.get("fuel", 0),
                "congestion": data.get("congestion", 0),
            }
            if key is not None:
                segment["edge_key"] = key
            route.append(segment)
        return route

    def _route_result_for_path(self, path, graph_data, edge_path=None):
        if edge_path is None:
            edge_path = []
            for u, v in zip(path, path[1:]):
                if graph_data.graph.is_multigraph():
                    candidates = graph_data.graph.get_edge_data(u, v)
                    if not candidates:
                        return self._build_route_result([])
                    key, data = min(
                        candidates.items(),
                        key=lambda item: float(item[1].get("time", 0)),
                    )
                    edge_path.append((u, v, key, data))
                else:
                    edge_path.append((u, v, None, graph_data.graph[u][v]))

        return self._build_route_result(self._route_from_edges(edge_path))


_models.GraphNetworkBuilder = GraphNetworkBuilder
_models.RouteOptimizer = RouteOptimizer
