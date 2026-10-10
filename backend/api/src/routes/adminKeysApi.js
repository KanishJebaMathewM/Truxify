import express from 'express';
import { keyRepo } from '../services/keyRepository.js';
import { metrics } from '../services/metricsService.js';
import { generateSecureApiKey } from '../utils/cryptoUtils.js';

// Express Router for managing API keys dynamically.
export const createAdminApiRouter = () => {
  const router = express.Router();

  // Create a new key dynamically
  router.post('/keys', (req, res) => {
    const { name, scopes, rateLimit, expiresInDays, ipWhitelist } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Bad Request: "name" is required' });
    }

    const rawKey = generateSecureApiKey();
    const expiresAt = expiresInDays ? Date.now() + expiresInDays * 86400000 : null;

    const record = keyRepo.registerKey({
      key: rawKey,
      name,
      scopes: scopes || ['*'],
      rateLimit: rateLimit || 100,
      expiresAt,
      ipWhitelist: ipWhitelist || [],
    });

    res.status(201).json({
      message: "API Key created successfully. Store raw key safely - it won't be shown again.",
      apiKey: rawKey,
      metadata: record,
    });
  });

  // Revoke an API key
  router.delete('/keys/:id', (req, res) => {
    const { id } = req.params;
    const success = keyRepo.revoke(id);

    if (!success) {
      return res.status(404).json({ error: 'Key ID not found' });
    }

    res.json({ message: `API Key ${id} has been revoked successfully` });
  });

  // Get metrics
  router.get('/metrics', (req, res) => {
    res.json(metrics.getMetrics());
  });

  return router;
};