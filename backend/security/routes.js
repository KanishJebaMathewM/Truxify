import express from 'express';
<<<<<<< HEAD
import { exec } from 'child_process';
import { promisify } from 'util';
import rateLimit from 'express-rate-limit';
import logger from '../api/src/middleware/logger.js';

const execAsync = promisify(exec);
=======
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

>>>>>>> upstream/main
const router = express.Router();

// Rate limiters
const securityLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    message: { success: false, error: 'Too many requests' }
});

<<<<<<< HEAD
// Get threats
router.get('/security/threats', securityLimiter, async (req, res) => {
    try {
        const threats = [
            {
                type: 'suspicious_file',
                file: '/etc/passwd',
                pid: 1234,
                timestamp: new Date().toISOString(),
                severity: 'HIGH'
            },
            {
                type: 'suspicious_process',
                process: '/bin/sh',
                pid: 5678,
                timestamp: new Date().toISOString(),
                severity: 'MEDIUM'
            }
        ];
        
        res.json({
            success: true,
            data: threats,
            count: threats.length,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Threats error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get alerts
router.get('/security/alerts', securityLimiter, async (req, res) => {
    try {
        const { severity } = req.query;
        
        const alerts = [
            {
                id: 1,
                type: 'file_access',
                description: 'Sensitive file accessed',
                file: '/etc/passwd',
                severity: 'CRITICAL',
                timestamp: new Date().toISOString(),
                resolved: false
            },
            {
                id: 2,
                type: 'process_execution',
                description: 'Suspicious process executed',
                process: 'nc -l -p 4444',
                severity: 'HIGH',
                timestamp: new Date().toISOString(),
                resolved: false
            }
        ];
        
        const filtered = severity ? alerts.filter(a => a.severity === severity) : alerts;
        
=======
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

>>>>>>> upstream/main
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

<<<<<<< HEAD
// Resolve alert
=======
// Resolve alert (only for a real, persisted alert)
>>>>>>> upstream/main
router.post('/security/alerts/:alertId/resolve', securityLimiter, async (req, res) => {
    try {
        const { alertId } = req.params;
        const { resolution } = req.body;
<<<<<<< HEAD
        
        res.json({
            success: true,
            data: {
                alertId,
                resolution: resolution || 'Resolved',
                resolvedAt: new Date().toISOString()
            },
=======

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
>>>>>>> upstream/main
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Resolve error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

<<<<<<< HEAD
// Get file integrity
router.get('/security/integrity', securityLimiter, async (req, res) => {
    try {
        const files = [
            {
                path: '/etc/passwd',
                hash: 'abc123',
                modified: false,
                lastCheck: new Date().toISOString()
            },
            {
                path: '/etc/sudoers',
                hash: 'def456',
                modified: false,
                lastCheck: new Date().toISOString()
            }
        ];
        
        res.json({
            success: true,
            data: files,
            count: files.length,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Integrity error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Start monitoring
router.post('/security/monitor/start', securityLimiter, async (req, res) => {
    try {
        // In production: start eBPF monitoring
        res.json({
            success: true,
            message: 'Security monitoring started',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Start monitoring error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Stop monitoring
router.post('/security/monitor/stop', securityLimiter, async (req, res) => {
    try {
        // In production: stop eBPF monitoring
        res.json({
            success: true,
            message: 'Security monitoring stopped',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Stop monitoring error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get stats
router.get('/security/stats', async (req, res) => {
    try {
        const stats = {
            threats_detected: 42,
            alerts_active: 5,
            alerts_resolved: 37,
            files_monitored: 150,
            monitoring_active: true,
            timestamp: new Date().toISOString()
        };
        
        res.json({
            success: true,
            data: stats,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Stats error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

export default router;
=======
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
>>>>>>> upstream/main
