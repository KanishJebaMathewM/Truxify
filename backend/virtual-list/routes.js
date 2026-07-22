import express from 'express';
import VirtualList from './VirtualList.js';
import logger from '../../api/src/middleware/logger.js';

const router = express.Router();

// Generate sample items
function generateItems(count) {
    const items = [];
    for (let i = 0; i < count; i++) {
        items.push({
            id: i,
            title: `Item ${i}`,
            description: `Description for item ${i}`,
            value: Math.random() * 1000
        });
    }
    return items;
}

// Initialize virtual list
const list = new VirtualList({
    items: generateItems(1000),
    itemHeight: 50,
    viewportHeight: 600,
    minOverscan: 2,
    maxOverscan: 20,
    defaultOverscan: 5
});

// ============ Routes ============

// Get list stats
router.get('/virtual-list/stats', (req, res) => {
    try {
        const stats = {
            renderStats: list.getRenderStats(),
            overscanStats: list.getOverscanStats(),
            totalHeight: list.getTotalHeight(),
            visibleRange: list.getVisibleRange()
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

// Get visible items
router.get('/virtual-list/visible', (req, res) => {
    try {
        const items = list.getVisibleItems();
        res.json({
            success: true,
            data: items,
            count: items.length,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Visible items error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Scroll
router.post('/virtual-list/scroll', (req, res) => {
    try {
        const { position, delta, index } = req.body;
        let newPosition;
        
        if (position !== undefined) {
            newPosition = list.scrollTo(position);
        } else if (delta !== undefined) {
            newPosition = list.scrollBy(delta);
        } else if (index !== undefined) {
            newPosition = list.scrollToIndex(index);
        } else {
            return res.status(400).json({
                success: false,
                error: 'position, delta, or index required'
            });
        }
        
        // Render after scroll
        const items = list.render();
        
        res.json({
            success: true,
            data: {
                position: newPosition,
                items: items,
                count: items.length,
                overscan: list.overscanStrategy.getOverscan()
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Scroll error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Render
router.post('/virtual-list/render', (req, res) => {
    try {
        const items = list.render();
        res.json({
            success: true,
            data: {
                items: items,
                count: items.length,
                overscan: list.overscanStrategy.getOverscan()
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Render error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Update items
router.post('/virtual-list/items', (req, res) => {
    try {
        const { items, count } = req.body;
        
        if (items) {
            list.setItems(items);
        } else if (count) {
            list.setItems(generateItems(count));
        } else {
            return res.status(400).json({
                success: false,
                error: 'items or count required'
            });
        }
        
        const rendered = list.render();
        res.json({
            success: true,
            data: {
                totalItems: list.items.length,
                rendered: rendered.length
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Update items error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Add item
router.post('/virtual-list/item', (req, res) => {
    try {
        const { index, item } = req.body;
        let result;
        
        if (index !== undefined) {
            result = list.insertItem(index, item || { title: `Item ${index}` });
        } else {
            result = list.addItem(item || { title: `Item ${list.items.length}` });
        }
        
        res.json({
            success: true,
            data: {
                totalItems: list.items.length,
                rendered: result ? result.length : 0
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Add item error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Remove item
router.delete('/virtual-list/item/:index', (req, res) => {
    try {
        const { index } = req.params;
        const result = list.removeItem(parseInt(index));
        
        res.json({
            success: true,
            data: {
                removed: !!result,
                totalItems: list.items.length
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Remove item error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Update overscan config
router.post('/virtual-list/overscan/config', (req, res) => {
    try {
        const config = req.body;
        list.overscanStrategy.setConfig(config);
        
        // Re-render with new config
        const items = list.render();
        
        res.json({
            success: true,
            data: {
                config: list.overscanStrategy.getStats(),
                rendered: items.length
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Update overscan config error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Reset list
router.post('/virtual-list/reset', (req, res) => {
    try {
        const items = list.reset();
        res.json({
            success: true,
            data: {
                items: items.length,
                totalItems: list.items.length
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Reset error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

export default router;