from . import gnn_routes as _gnn_routes


async def _build_graph(nodes, edges):
    if not nodes:
        raise _gnn_routes.HTTPException(
            status_code=422,
            detail="At least one node is required to build a graph",
        )

    def _build_graph_summary(node_rows, edge_rows):
        request_builder = _gnn_routes.GraphNetworkBuilder()
        graph = request_builder.build_road_network(node_rows, edge_rows)
        return {
            "nodes": len(graph.nodes),
            "edges": len(graph.edges),
            "is_connected": _gnn_routes.nx.is_weakly_connected(graph),
        }

    try:
        summary = await _gnn_routes.run_inference(
            _build_graph_summary,
            [node.dict() for node in nodes],
            [edge.dict() for edge in edges],
        )
        return {
            "success": True,
            "data": summary,
            "timestamp": _gnn_routes.datetime.now().isoformat(),
        }
    except _gnn_routes.HTTPException:
        raise
    except Exception as exc:
        _gnn_routes.logger.error(f"Graph building failed: {exc}")
        raise _gnn_routes.HTTPException(
            status_code=500, detail="Internal server error"
        )


async def _optimize_route(request):
    _gnn_routes.validate_route_objectives(request.objectives)

    def _optimize_route_sync(
        start_node, end_node, nodes, edges, objectives, constraints
    ):
        request_builder = _gnn_routes.GraphNetworkBuilder()
        request_builder.build_road_network(nodes, edges)
        graph_data = request_builder.get_pytorch_data()
        return _gnn_routes.optimizer.optimize_route(
            start_node,
            end_node,
            graph_data,
            objectives,
            constraints,
        )

    try:
        result = await _gnn_routes.run_inference(
            _optimize_route_sync,
            request.start_node,
            request.end_node,
            [node.dict() for node in request.nodes],
            [edge.dict() for edge in request.edges],
            request.objectives,
            request.constraints,
        )
        if result:
            return {
                "success": True,
                "data": result,
                "timestamp": _gnn_routes.datetime.now().isoformat(),
            }
        return {
            "success": False,
            "error": "Route optimization failed",
            "timestamp": _gnn_routes.datetime.now().isoformat(),
        }
    except _gnn_routes.HTTPException:
        raise
    except Exception as exc:
        _gnn_routes.logger.error(f"Route optimization failed: {exc}")
        raise _gnn_routes.HTTPException(
            status_code=500, detail="Internal server error"
        )


async def _multi_objective_optimize(request):
    _gnn_routes.validate_route_objectives(request.objectives)

    def _multi_objective_sync(
        start_node, end_node, nodes, edges, objectives, constraints
    ):
        request_builder = _gnn_routes.GraphNetworkBuilder()
        request_builder.build_road_network(nodes, edges)
        graph_data = request_builder.get_pytorch_data()
        return _gnn_routes._multi_objective_optimization(
            start_node,
            end_node,
            graph_data,
            objectives=objectives,
            constraints=constraints,
        )

    try:
        result = await _gnn_routes.run_inference(
            _multi_objective_sync,
            request.start_node,
            request.end_node,
            [node.dict() for node in request.nodes],
            [edge.dict() for edge in request.edges],
            request.objectives,
            request.constraints,
        )
        if result:
            return {
                "success": True,
                "data": result,
                "timestamp": _gnn_routes.datetime.now().isoformat(),
            }
        return {
            "success": False,
            "error": "Multi-objective route optimization failed",
            "timestamp": _gnn_routes.datetime.now().isoformat(),
        }
    except _gnn_routes.HTTPException:
        raise
    except Exception as exc:
        _gnn_routes.logger.error(f"Multi-objective optimization failed: {exc}")
        raise _gnn_routes.HTTPException(
            status_code=500, detail="Internal server error"
        )


async def _update_route(request):
    _gnn_routes.validate_route_objectives(request.objectives)

    def _update_route_sync(
        route, nodes, edges, traffic_data, objectives, constraints
    ):
        request_builder = _gnn_routes.GraphNetworkBuilder()
        request_builder.build_road_network(nodes, edges)
        graph_data = request_builder.get_pytorch_data()
        return _gnn_routes.optimizer.real_time_update(
            route,
            traffic_data,
            graph_data=graph_data,
            objectives=objectives,
            constraints=constraints,
        )

    try:
        start = request.route[0].get("from") if request.route else None
        end = request.route[-1].get("to") if request.route else None
        if start is None or end is None:
            raise _gnn_routes.HTTPException(
                status_code=422,
                detail="Route must contain at least one edge with 'from' and 'to' fields",
            )

        updated_route = await _gnn_routes.run_inference(
            _update_route_sync,
            request.route,
            [node.dict() for node in request.nodes],
            [edge.dict() for edge in request.edges],
            request.traffic_data,
            request.objectives,
            request.constraints,
        )
        return {
            "success": True,
            "data": updated_route,
            "timestamp": _gnn_routes.datetime.now().isoformat(),
        }
    except _gnn_routes.HTTPException:
        raise
    except Exception as exc:
        _gnn_routes.logger.error(f"Route update failed: {exc}")
        raise _gnn_routes.HTTPException(
            status_code=500, detail="Internal server error"
        )


_gnn_routes.build_graph = _build_graph
_gnn_routes.optimize_route = _optimize_route
_gnn_routes.multi_objective_optimize = _multi_objective_optimize
_gnn_routes.update_route = _update_route

_endpoint_map = {
    "/gnn/build-graph": _build_graph,
    "/gnn/optimize-route": _optimize_route,
    "/gnn/multi-objective": _multi_objective_optimize,
    "/gnn/update-route": _update_route,
}
for route in _gnn_routes.router.routes:
    endpoint = _endpoint_map.get(getattr(route, "path", None))
    if endpoint is not None:
        route.endpoint = endpoint
