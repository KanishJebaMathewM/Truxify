import express from 'express';
import cors from 'cors';
import http from 'http';
import dotenv from 'dotenv';
import path from 'path';

// Pre-load DB config to execute client setups
import './config/db.js';
import { initWebSocketServer } from './sockets/tracker.js';

// Load REST routes
import orderRoutes from './routes/orderRoutes.js';
import driverRoutes from './routes/driverRoutes.js';

// Configuration load from root folder is handled in db.js


const app = express();
const server = http.createServer(app);

// Enable CORS for frontend clients (Flutter Web, mobile, etc.)
app.use(cors({
  origin: '*', // Allow all origins for development; tighten in production
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-user-id', 'x-user-role', 'x-user-name']
}));

app.use(express.json());

// ============================================================================
// REST API ROUTING
// ============================================================================
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date(),
    service: 'Truxify API',
    uptime: process.uptime(),
    env: {
      bypass_auth: process.env.BYPASS_AUTH === 'true',
      node_version: process.version
    }
  });
});

app.use('/api/orders', orderRoutes);
app.use('/api/driver', driverRoutes);

// Root route
app.get('/', (req, res) => {
  res.send('<h1>Truxify Backend API is running.</h1><p>Use WebSockets at <code>ws://localhost:5000/ws/tracking</code></p>');
});

// Handling 404 Route Not Found
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint resource not found.' });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled express exception:', err);
  res.status(500).json({ error: 'Critical Internal Server Error.' });
});

// ============================================================================
// WEBSOCKET SERVER INIT
// ============================================================================
initWebSocketServer(server);

// ============================================================================
// START SERVER
// ============================================================================
const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`================================================================`);
  console.log(`🚀 Truxify Node.js server is listening on PORT: ${PORT}`);
  console.log(`🔗 REST API Root: http://localhost:${PORT}`);
  console.log(`🔌 WebSocket URL: ws://localhost:${PORT}/ws/tracking`);
  console.log(`================================================================`);
});
