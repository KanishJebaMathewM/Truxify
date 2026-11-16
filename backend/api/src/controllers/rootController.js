// backend/api/src/controllers/rootController.js (Excerpt)

export function getRootStatus(req, res) {
  const wsHost = process.env.WS_HOST || 'localhost';
  const wsPort = process.env.WS_PORT || '5000';

  // ✅ Fixed: Replaced single/double quotes with backticks for proper template interpolation
  res.send(`<h1>Truxify Backend API is running.</h1><p>Use WebSockets at <code>ws://${wsHost}:${wsPort}/ws/tracking</code></p>`);
}
