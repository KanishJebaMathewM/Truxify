# 🔒 Truxify Consul Dynamic Service Mesh & mTLS Security

This module configures a HashiCorp Consul service mesh with Envoy sidecar proxies across Truxify backend microservices.

## Architectural Enforcement
- Mandatory mutual TLS (mTLS) certificate verification between Node.js API and FastAPI ML Engine.
- Automatic Envoy proxy sidecar injection.
- Zero-code network encryption and Consul service intentions access policy.
