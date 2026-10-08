"""Compatibility import for the retired GNN endpoint monkeypatch.

Typed handlers in gnn_routes now dispatch through app.execution directly.
Mutating APIRoute.endpoint after construction loses dependency/body metadata
when FastAPI clones the router. Keep this module importable for old registries
without replacing the registered handlers.
"""
