import express from 'express';
import GlobalStore from './Globalreq.store.js';
import logger from '../api/src/middleware/logger.js';
import { authenticate } from '../api/src/middleware/auth.js';

const router = express.Router();

// Per-tenant store instances so a caller only ever touches their own
// namespace (prevents cross-tenant leak/tamper, issue #13966).
const tenantStores = new Map();
function getTenantStore(userId) {
    if (!tenantStores.has(userId)) {
        tenantStores.set(userId, new GlobalStore({
            user: null,
            settings: {},
            notifications: [],
            data: {}
        }));
    }
    return tenantStores.get(userId);
}

// Require an authenticated session on every store route. Anonymous callers are
// rejected before they can read or mutate any tenant's state.
router.use(authenticate);
router.use((req, res, next) => {
    if (!req.user || !req.user.id) {
        return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    req.store = getTenantStore(req.user.id);
    next();
});

// ============ State Routes ============

// Get state
router.get('/store/state', (req, res) => {
    try {
        const { key } = req.query;
        const value = key ? req.store.get(key) : req.store.get();
        res.json({
            success: true,
            data: value,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Get state error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Set state
router.post('/store/state', (req, res) => {
    try {
        const { key, value } = req.body;
        if (key === undefined) {
            return res.status(400).json({
                success: false,
                error: 'key required'
            });
        }
        
        req.store.set(key, value);
        res.json({
            success: true,
            data: { key, value },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Set state error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Update state
router.post('/store/update', (req, res) => {
    try {
        const { updates } = req.body;
        if (!updates) {
            return res.status(400).json({
                success: false,
                error: 'updates required'
            });
        }
        
        req.store.update(updates);
        res.json({
            success: true,
            data: updates,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Update state error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Atomic update
router.post('/store/atomic', (req, res) => {
    try {
        const { updates } = req.body;
        if (!updates) {
            return res.status(400).json({
                success: false,
                error: 'updates required'
            });
        }
        
        req.store.atomic(updates);
        res.json({
            success: true,
            data: updates,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Atomic update error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============ Transaction Routes ============

// Execute transaction
router.post('/store/transaction', async (req, res) => {
    try {
        const { operations } = req.body;
        if (!operations || !Array.isArray(operations)) {
            return res.status(400).json({
                success: false,
                error: 'operations array required'
            });
        }
        
        const result = await req.store.transactionAsync(async (tx) => {
            for (const op of operations) {
                if (op.type === 'set') {
                    tx.addOperation(() => req.store.set(op.key, op.value));
                } else if (op.type === 'update') {
                    tx.addOperation(() => req.store.update(op.updates));
                } else if (op.type === 'custom') {
                    tx.addOperation(op.fn);
                }
            }
            return tx.execute();
        });
        
        res.json({
            success: true,
            data: result,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Transaction error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Simple transaction
router.post('/store/transaction/simple', async (req, res) => {
    try {
        const { operations } = req.body;
        if (!operations) {
            return res.status(400).json({
                success: false,
                error: 'operations required'
            });
        }
        
        const result = await req.store.transactionAsync(async (tx) => {
            for (const op of operations) {
                if (op.set) {
                    await tx.execute(() => req.store.set(op.key, op.value));
                } else if (op.update) {
                    await tx.execute(() => req.store.update(op.updates));
                } else if (op.custom) {
                    await tx.execute(op.custom);
                }
            }
        });
        
        res.json({
            success: true,
            data: result,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Simple transaction error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============ Undo/Redo ============

// Undo
router.post('/store/undo', (req, res) => {
    try {
        const success = req.store.undo();
        res.json({
            success,
            data: { undone: success },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Undo error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Redo
router.post('/store/redo', (req, res) => {
    try {
        const success = req.store.redo();
        res.json({
            success,
            data: { redone: success },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Redo error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Can undo/redo
router.get('/store/undo/status', (req, res) => {
    try {
        res.json({
            success: true,
            data: {
                canUndo: req.store.canUndo(),
                canRedo: req.store.canRedo()
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Undo status error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============ History ============

// Get history
router.get('/store/history', (req, res) => {
    try {
        const history = req.store.getHistory();
        res.json({
            success: true,
            data: history,
            count: history.length,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Get history error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get transaction history
router.get('/store/transactions', (req, res) => {
    try {
        const history = req.store.getTransactionHistory();
        res.json({
            success: true,
            data: history,
            count: history.length,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Get transactions error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============ Snapshot ============

// Create snapshot
router.post('/store/snapshot/create', (req, res) => {
    try {
        const snapshot = req.store.createSnapshot();
        res.json({
            success: true,
            data: snapshot,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Create snapshot error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Restore snapshot
router.post('/store/snapshot/restore', (req, res) => {
    try {
        const { snapshot } = req.body;
        if (!snapshot) {
            return res.status(400).json({
                success: false,
                error: 'snapshot required'
            });
        }
        
        req.store.restoreSnapshot(snapshot);
        res.json({
            success: true,
            data: { restored: true },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Restore snapshot error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============ Stats ============

// Get stats
router.get('/store/stats', (req, res) => {
    try {
        const stats = req.store.getStats();
        res.json({
            success: true,
            data: stats,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Get stats error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============ Control ============

// Control store
router.post('/store/control', (req, res) => {
    try {
        const { action } = req.body;
        
        switch (action) {
            case 'enableTracking':
                req.store.enableTracking();
                break;
            case 'disableTracking':
                req.store.disableTracking();
                break;
            case 'reset':
                req.store.reset();
                break;
            default:
                return res.status(400).json({
                    success: false,
                    error: 'Invalid action'
                });
        }
        
        res.json({
            success: true,
            data: { action },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Control error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

export default router;