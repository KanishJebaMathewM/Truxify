/**
 * Root and fallback responses for the API gateway.
 */

export function getRoot(req, res) {
  const wsHost = req.hostname || process.env.WS_HOST || 'localhost';
  const wsPort = process.env.PORT || process.env.WS_PORT || 5000;

  res.send(`<h1>Truxify Backend API is running.</h1><p>Use WebSockets at <code>ws://${wsHost}:${wsPort}/ws/tracking</code></p>`);
}

export function notFound(req, res) {
  res.status(404).json({ error: 'Endpoint resource not found.' });
}

// Keep the newer name for callers that adopted it while the controller was
// temporarily split. Both names refer to the same handler.
export const getRootStatus = getRoot;
