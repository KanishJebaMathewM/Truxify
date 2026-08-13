import express from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import rateLimit from 'express-rate-limit';
import logger from '../api/src/middleware/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORE_FILE = path.join(__dirname, 'data', 'alerts.json');

let alertsCache = null;

async function loadAlerts() {
    if (alertsCache !== null) {
        return alertsCache;
    }
    try {
        const raw = await fs.readFile(STORE_FILE, 'utf8');
        alertsCache = JSON.parse(raw);
    } catch {
        alertsCache = [];
    }
    return alertsCache;
}

async function saveAlerts(alerts) {
    await fs.mkdir(path.dirname(STORE_FILE), { recursive: true });
    await fs.writeFile(STORE_FILE, JSON.stringify(alerts, null, 2), 'utf8');
    alertsCache = alerts;
}

async function recordAlert({ type, description, severity = 'HIGH', file, process: proc, metadata }) {
    const alerts = await loadAlerts();
    const alert = {
        id: randomUUID(),
        type,
        description,
        file,
        process: proc,
        severity,
        metadata,
        timestamp: new Date().toISOString(),
        resolved: false
    };
    alerts.push(alert);
    await saveAlerts(alerts);
    return alert;
}

const router = express.Router();

// Rate limiters
const securityLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    message: { success: false, error: 'Too many requests' }
});

// Get alerts (persisted alert store)
router.get('/security/alerts', securityLimiter, async (req, res) => {
    try {
        const { severity, includeResolved } = req.query;
        const alerts = await loadAlerts();

        let filtered = alerts;
        if (severity) {
            filtered = filtered.filter((alert) => alert.severity === severity);
        }
        if (includeResolved !== 'true') {
            filtered = filtered.filter((alert) => !alert.resolved);
        }

        res.json({
            success: true,
            data: filtered,
            count: filtered.length,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Alerts error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Resolve alert (only for a real, persisted alert)
router.post('/security/alerts/:alertId/resolve', securityLimiter, async (req, res) => {
    try {
        const { alertId } = req.params;
        const { resolution } = req.body;

        const alerts = await loadAlerts();
        const alert = alerts.find((entry) => String(entry.id) === String(alertId));

        if (!alert) {
            return res.status(404).json({ success: false, error: `Alert ${alertId} not found` });
        }

        if (alert.resolved) {
            return res.status(409).json({ success: false, error: `Alert ${alertId} is already resolved` });
        }

        alert.resolved = true;
        alert.resolvedAt = new Date().toISOString();
        alert.resolution = resolution || 'Resolved';
        await saveAlerts(alerts);

        res.json({
            success: true,
            data: alert,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Resolve error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get threats (requires a real eBPF/threat source; not implemented)
router.get('/security/threats', securityLimiter, async (req, res) => {
    res.status(501).json({ success: false, error: 'Not implemented', message: 'Threat detection source is not wired up yet' });
});

// Get file integrity (requires a real integrity checker; not implemented)
router.get('/security/integrity', securityLimiter, async (req, res) => {
    res.status(501).json({ success: false, error: 'Not implemented', message: 'File integrity monitoring is not wired up yet' });
});

// Start monitoring (requires a real eBPF source; not implemented)
router.post('/security/monitor/start', securityLimiter, async (req, res) => {
    res.status(501).json({ success: false, error: 'Not implemented', message: 'eBPF monitoring is not wired up yet' });
});

// Stop monitoring (requires a real eBPF source; not implemented)
router.post('/security/monitor/stop', securityLimiter, async (req, res) => {
    res.status(501).json({ success: false, error: 'Not implemented', message: 'eBPF monitoring is not wired up yet' });
});

// Get stats (derived from the real store; not implemented)
router.get('/security/stats', securityLimiter, async (req, res) => {
    res.status(501).json({ success: false, error: 'Not implemented', message: 'Security statistics are not wired up yet' });
});

export default router;
export { recordAlert };
