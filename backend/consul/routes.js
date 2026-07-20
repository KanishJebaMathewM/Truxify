import express from 'express';
import consulService from './consul.service.js';
import logger from '../../api/src/middleware/logger.js';

const router = express.Router();

// Register service
router.post('/consul/register', async (req, res) => {
    try {
        const result = await consulService.registerService(req.body);
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('Register error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Deregister service
router.delete('/consul/deregister/:serviceId', async (req, res) => {
    try {
        const { serviceId } = req.params;
        const result = await consulService.deregisterService(serviceId);
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('Deregister error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Discover service
router.get('/consul/discover/:serviceName', async (req, res) => {
    try {
        const { serviceName } = req.params;
        const { healthy } = req.query;
        const services = await consulService.discoverService(
            serviceName,
            healthy !== 'false'
        );
        res.json({ success: true, data: services });
    } catch (error) {
        logger.error('Discover error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get service address
router.get('/consul/address/:serviceName', async (req, res) => {
    try {
        const { serviceName } = req.params;
        const address = await consulService.getServiceAddress(serviceName);
        res.json({ success: true, data: { address } });
    } catch (error) {
        logger.error('Address error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get service health
router.get('/consul/health/:serviceId', async (req, res) => {
    try {
        const { serviceId } = req.params;
        const health = await consulService.getServiceHealth(serviceId);
        res.json({ success: true, data: health });
    } catch (error) {
        logger.error('Health error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// KV operations
router.post('/consul/kv', async (req, res) => {
    try {
        const { key, value } = req.body;
        if (!key) {
            return res.status(400).json({ success: false, error: 'key required' });
        }
        const result = await consulService.setKV(key, value);
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('KV set error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/consul/kv/:key', async (req, res) => {
    try {
        const { key } = req.params;
        const result = await consulService.getKV(key);
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('KV get error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Register multi-cloud service
router.post('/consul/multi-cloud', async (req, res) => {
    try {
        const { cloud, serviceConfig } = req.body;
        if (!cloud || !serviceConfig) {
            return res.status(400).json({
                success: false,
                error: 'cloud and serviceConfig required'
            });
        }
        const result = await consulService.registerMultiCloudService(
            cloud,
            serviceConfig
        );
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('Multi-cloud register error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get stats
router.get('/consul/stats', async (req, res) => {
    try {
        const stats = await consulService.getConsulStats();
        res.json({ success: true, data: stats });
    } catch (error) {
        logger.error('Stats error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

export default router;