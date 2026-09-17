from . import models as _models

_BaseGraphNetworkBuilder = _models.GraphNetworkBuilder


class GraphNetworkBuilder(_BaseGraphNetworkBuilder):
    """Reject duplicate node IDs before mutating the road network graph."""

    def build_road_network(self, nodes, edges):
        node_ids = {node['id'] for node in nodes}
        duplicate_ids = []
        seen_ids = set()

        for node in nodes:
            node_id = node['id']
            if node_id in seen_ids and node_id not in duplicate_ids:
                duplicate_ids.append(node_id)
            seen_ids.add(node_id)

        if duplicate_ids:
            duplicates = ', '.join(duplicate_ids)
            raise ValueError(f"Duplicate node ID(s): {duplicates}")

        for edge in edges:
            source = edge['source']
            target = edge['target']
            missing_endpoints = [
                node_id for node_id in (source, target)
                if node_id not in node_ids
            ]
            if missing_endpoints:
                missing = ', '.join(dict.fromkeys(missing_endpoints))
                raise ValueError(f"Unknown edge endpoint(s): {missing}")

        return super().build_road_network(nodes, edges)


_models.GraphNetworkBuilder = GraphNetworkBuilder
