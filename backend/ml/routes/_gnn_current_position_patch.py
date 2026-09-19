from datetime import datetime

from pydantic import BaseModel
from fastapi import HTTPException

from . import gnn_routes as _routes


class RouteUpdateRequestWithCurrentNode(_routes.RouteUpdateRequest):
    current_node: str


async def update_route(request: RouteUpdateRequestWithCurrentNode):
    """Update route with real-time traffic and reroute from the current vehicle node."""
    try:
        request_builder = _routes.GraphNetworkBuilder()
        request_builder.build_road_network(
            [node.dict() for node in request.nodes],
            [edge.dict() for edge in request.edges],
        )
        graph_data = request_builder.get_pytorch_data()

        if request.current_node not in request_builder.graph:
            raise HTTPException(
                status_code=422,
                detail=(
                    f"Current vehicle node '{request.current_node}' is not present "
                    "in the routing graph"
                ),
            )

        end = request.route[-1].get('to') if request.route else None
        if end is None:
            raise HTTPException(
                status_code=422,
                detail="Route must contain at least one edge with 'from' and 'to' fields",
            )

        updated_route = _routes.optimizer.real_time_update(
            request.route,
            request.traffic_data,
            graph_data=graph_data,
            objectives=request.objectives,
            constraints=request.constraints,
            current_node=request.current_node,
        )

        return {
            'success': True,
            'data': updated_route,
            'timestamp': datetime.now().isoformat(),
        }
    except HTTPException:
        raise
    except Exception as exc:
        _routes.logger.error(f"Route update failed: {exc}")
        _routes.logger.error(f"Internal error: {exc}")
        raise HTTPException(status_code=500, detail="Internal server error")


# Replace the original route definition before the router is registered.
for _route in list(_routes.router.routes):
    if getattr(_route, 'path', None) == '/update-route' and 'POST' in getattr(_route, 'methods', set()):
        _routes.router.routes.remove(_route)

_routes.router.add_api_route(
    '/update-route',
    update_route,
    methods=['POST'],
)
