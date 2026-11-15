## Problem

The KEDA route handlers in `backend/api/src/routes/kedaRoutes.js` return the raw caught error message in their 500 response. Prometheus and Kubernetes client errors include upstream URLs, namespaces, service names, and sometimes fragments of bearer tokens or query strings.

## Root cause

Each handler logs the error and then interpolates `error.message` into the response. There is no separation between internal diagnostics and the public error contract.

## Impact

- Unauthenticated or low-privilege callers can map internal services and namespaces from error text.
- Credentials or token fragments embedded in upstream URLs may be disclosed.
- Clients receive unstable provider-specific messages instead of a documented error shape.

## Proposed fix

- Log the full error with the request ID for operators.
- Return a fixed `Autoscaler metrics unavailable` message for all internal failures.
- Keep authentication, authorization, and success response shapes unchanged.

## Verification

- Mock a provider error containing a URL and token-like text and assert the response body does not contain it.
- Assert the error is still logged with the request ID.
- Run the KEDA route tests.

Request: @Senthil455 please assign this issue.
