import pytest

pytest.importorskip("torch_geometric")
from gnn.models import GraphNetworkBuilder, RouteOptimizer


def _build_directed_network():
    builder=GraphNetworkBuilder(); builder.build_road_network([{"id":"A","lat":12.97,"lng":77.59},{"id":"B","lat":12.98,"lng":77.60}],[{"source":"A","target":"B","distance":10.0,"time":10.0,"cost":20.0}]); return builder,builder.get_pytorch_data()


def test_reverse_traffic_update_does_not_change_declared_direction():
    builder,graph_data=_build_directed_network(); optimizer=RouteOptimizer(); optimizer._reoptimize=lambda *args,**kwargs:None
    route=[{"from":"A","to":"B","distance":10.0,"time":10.0,"cost":20.0,"fuel":0,"congestion":0}]
    updated=optimizer.real_time_update(route,{"B-A":{"time":99.0,"cost":199.0}},graph_data=graph_data,objectives=["time"])
    assert updated==route; assert builder.graph["A"]["B"]["time"]==10.0; assert builder.graph["A"]["B"]["cost"]==20.0; assert not builder.graph.has_edge("B","A")


def test_explicit_reverse_edge_receives_its_own_traffic_update():
    builder=GraphNetworkBuilder(); builder.build_road_network([{"id":"A","lat":12.97,"lng":77.59},{"id":"B","lat":12.98,"lng":77.60}],[{"source":"A","target":"B","distance":10.0,"time":10.0,"cost":20.0},{"source":"B","target":"A","distance":11.0,"time":11.0,"cost":22.0}]); graph_data=builder.get_pytorch_data(); optimizer=RouteOptimizer(); optimizer._reoptimize=lambda *args,**kwargs:None
    route=[{"from":"B","to":"A","distance":11.0,"time":11.0,"cost":22.0,"fuel":0,"congestion":0}]
    updated=optimizer.real_time_update(route,{"B-A":{"time":7.0,"cost":14.0}},graph_data=graph_data,objectives=["time"])
    assert updated[0]["time"]==7.0; assert updated[0]["cost"]==14.0; assert builder.graph["A"]["B"]["time"]==10.0; assert builder.graph["A"]["B"]["cost"]==20.0
