from . import models as _models

GNN_ROAD_TYPES = ("highway", "arterial", "collector", "local", "street")

_BaseGNNRouteModel = _models.GNNRouteModel
_BaseGraphNetworkBuilder = _models.GraphNetworkBuilder


class GNNRouteModel(_BaseGNNRouteModel):
    """Preserve the current model while rejecting invalid edge dimensions."""

    def __init__(
        self,
        input_dim=_models.GNN_NODE_FEATURE_DIM,
        hidden_dim=128,
        output_dim=32,
        edge_dim=_models.GNN_EDGE_FEATURE_DIM,
        in_channels=None,
        hidden_channels=None,
        out_channels=None,
    ):
        if edge_dim is not None and edge_dim <= 0:
            raise ValueError("edge_dim must be a positive integer when provided")
        super().__init__(
            input_dim=input_dim,
            hidden_dim=hidden_dim,
            output_dim=output_dim,
            edge_dim=edge_dim,
            in_channels=in_channels,
            hidden_channels=hidden_channels,
            out_channels=out_channels,
        )


class GraphNetworkBuilder(_BaseGraphNetworkBuilder):
    """Validate road types and numeric node features before graph construction."""

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
                try:
                    numeric_value = float(value)
                except (TypeError, ValueError) as exc:
                    raise ValueError(
                        f"Node '{node_id}' has invalid {field}: {value!r}"
                    ) from exc
                if not __import__("math").isfinite(numeric_value):
                    raise ValueError(
                        f"Node '{node_id}' has non-finite {field}: {value!r}"
                    )

            if not -90 <= float(values["lat"]) <= 90:
                raise ValueError(
                    f"Node '{node_id}' latitude must be between -90 and 90"
                )
            if not -180 <= float(values["lng"]) <= 180:
                raise ValueError(
                    f"Node '{node_id}' longitude must be between -180 and 180"
                )
            if not 0 <= float(values["traffic"]) <= 100:
                raise ValueError(
                    f"Node '{node_id}' traffic must be between 0 and 100"
                )
            if float(values["speed_limit"]) < 0:
                raise ValueError(
                    f"Node '{node_id}' speed_limit cannot be negative"
                )

            road_type = node.get("road_type", "local")
            if road_type not in GNN_ROAD_TYPES:
                raise ValueError(
                    f"Unsupported road type '{road_type}'; expected one of {GNN_ROAD_TYPES}"
                )

        return super().build_road_network(nodes, edges)

    def _road_type_encoding(self, road_type):
        if road_type not in GNN_ROAD_TYPES:
            raise ValueError(
                f"Unsupported road type '{road_type}'; expected one of {GNN_ROAD_TYPES}"
            )
        return super()._road_type_encoding(road_type)


_models.GNN_ROAD_TYPES = GNN_ROAD_TYPES
_models.GNNRouteModel = GNNRouteModel
_models.RouteGNN = GNNRouteModel
_models.GraphNetworkBuilder = GraphNetworkBuilder
