export const getRoot = (req, res) => {
  const wsHost = req.hostname || 'localhost';
  const wsPort = process.env.PORT || 5000;
  res.send("<h1>Truxify Backend API is running.</h1><p>Use WebSockets at <code>ws://${wsHost}:${wsPort}/ws/tracking</code></p>");
};

export const notFound = (req, res) => {
  res.status(404).json({ error: 'Endpoint resource not found.' });
};
