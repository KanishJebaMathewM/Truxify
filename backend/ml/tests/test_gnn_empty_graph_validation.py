import asyncio

import pytest
from fastapi import HTTPException


torch_geometric = pytest.importorskip("torch_geometric")
from routes.gnn_routes import build_graph, Node, Edge


def test_build_graph_rejects_empty_nodes():
    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(build_graph([], []))

    assert exc_info.value.status_code == 422
    assert exc_info.value.detail == "At least one node is required to build a graph"


def test_build_graph_accepts_non_empty_graph():
    nodes = [Node(id="A", lat=12.97, lng=77.59)]
    result = asyncio.run(build_graph(nodes, []))

    assert result["success"] is True
    assert result["data"]["nodes"] == 1
    assert result["data"]["edges"] == 0
    assert result["data"]["is_connected"] is True
