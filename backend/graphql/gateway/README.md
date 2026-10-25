# Experimental GraphQL Gateway (Quarantined)

This gateway remains experimental and excluded from default production manifests and compose setups.

It composes the schemas exposed by the three implemented subgraphs using Apollo IntrospectAndCompose:

| Subgraph | Configurable URL | Default |
| --- | --- | --- |
| order | ORDER_SERVICE_URL | http://localhost:4001/graphql |
| driver | DRIVER_SERVICE_URL | http://localhost:4002/graphql |
| trip | TRIP_SERVICE_URL | http://localhost:4004/graphql |

The GraphQL launcher starts those services before loading the gateway. Composition refreshes every ten seconds. The API schema follows the service schemas, including logisticsRoute/logisticsRoutes from the trip service. Payment/user services and their unimplemented fields are not advertised.

Production adoption still requires independent deployment and authorization review. This repair does not enable production deployment.
