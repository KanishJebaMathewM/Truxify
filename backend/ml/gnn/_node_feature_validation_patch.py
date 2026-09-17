import math

from . import models as _models

_BaseGraphNetworkBuilder = _models.GraphNetworkBuilder


class GraphNetworkBuilder(_BaseGraphNetworkBuilder):
    """Reject physically invalid node values before graph construction."""

    def build_road_network(self, nodes, edges):
        for node in nodes:
            node_id = node.get("id", "<unknown>")
            values = {
                "lat": node.get("lat", 0),
                "lng": node.get("lng", 0),
                "traffic": node.get("traffic", 0),
                "speed_limit": node.get("speed_limit", 50),
            }

            for field, value in values.items():
                if value is None:
                    continue
                numeric_value = float(value)
                if not math.isfinite(numeric_value):
                    raise ValueError(
                        f"Node '{node_id}' has non-finite {field}: {value!r}"
                    )

            if not -90 <= float(values["lat"]) <= 90:
                raise ValueError(f"Node '{node_id}' latitude must be between -90 and 90")
            if not -180 <= float(values["lng"]) <= 180:
                raise ValueError(f"Node '{node_id}' longitude must be between -180 and 180")
            if not 0 <= float(values["traffic"]) <= 100:
                raise ValueError(f"Node '{node_id}' traffic must be between 0 and 100")
            if float(values["speed_limit"]) < 0:
                raise ValueError(f"Node '{node_id}' speed_limit cannot be negative")

        return super().build_road_network(nodes, edges)


_models.GraphNetworkBuilder = GraphNetworkBuilder
