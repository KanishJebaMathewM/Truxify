import express from 'express';
import LayoutNode from './LayoutNode.js';
import LayoutEngine from './LayoutEngine.js';
import logger from '../../api/src/middleware/logger.js';

const router = express.Router();

// Initialize layout engine
const layoutEngine = new LayoutEngine();

// Create root node
const root = new LayoutNode({
    id: 'root',
    type: 'container',
    width: 1200,
    height: 800,
    padding: { top: 20, right: 20, bottom: 20, left: 20 }
});

layoutEngine.setRoot(root);

// Create some child nodes
const header = new LayoutNode({
    id: 'header',
    type: 'row',
    width: 1160,
    height: 60,
    margin: { bottom: 10 }
});

const sidebar = new LayoutNode({
    id: 'sidebar',
    type: 'column',
    width: 200,
    height: 500,
    margin: { right: 10 }
});

const content = new LayoutNode({
    id: 'content',
    type: 'container',
    width: 950,
    height: 500
});

root.addChild(header);
root.addChild(sidebar);
root.addChild(content);

// Add some widgets to sidebar
const widget1 = new LayoutNode({
    id: 'widget1',
    type: 'container',
    width: 180,
    height: 150,
    margin: { bottom: 10 }
});

const widget2 = new LayoutNode({
    id: 'widget2',
    type: 'container',
    width: 180,
    height: 150,
    margin: { bottom: 10 }
});

sidebar.addChild(widget1);
sidebar.addChild(widget2);

// Add some widgets to content
const chart1 = new LayoutNode({
    id: 'chart1',
    type: 'container',
    width: 930,
    height: 240,
    margin: { bottom: 10 }
});

const chart2 = new LayoutNode({
    id: 'chart2',
    type: 'container',
    width: 930,
    height: 240
});

content.addChild(chart1);
content.addChild(chart2);

// Initial layout
layoutEngine.processLayout();

// ============ Routes ============

// Get layout tree
router.get('/layout/tree', (req, res) => {
    try {
        const tree = layoutEngine.getLayoutTree();
        res.json({
            success: true,
            data: tree,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Get layout tree error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get layout metrics
router.get('/layout/metrics', (req, res) => {
    try {
        const metrics = layoutEngine.getMetrics();
        res.json({
            success: true,
            data: metrics,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Get metrics error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get node stats
router.get('/layout/node/:nodeId/stats', (req, res) => {
    try {
        const { nodeId } = req.params;
        const stats = layoutEngine.getNodeStats(nodeId);
        if (!stats) {
            return res.status(404).json({
                success: false,
                error: 'Node not found'
            });
        }
        res.json({
            success: true,
            data: stats,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Get node stats error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Update node position
router.post('/layout/node/:nodeId/position', (req, res) => {
    try {
        const { nodeId } = req.params;
        const { x, y } = req.body;
        
        const node = root.findNodeById(nodeId);
        if (!node) {
            return res.status(404).json({
                success: false,
                error: 'Node not found'
            });
        }
        
        node.position.x = x;
        node.position.y = y;
        node.markDirty({ position: true });
        
        layoutEngine.processLayout();
        
        res.json({
            success: true,
            data: { nodeId, position: node.position },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Update position error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Update node size
router.post('/layout/node/:nodeId/size', (req, res) => {
    try {
        const { nodeId } = req.params;
        const { width, height } = req.body;
        
        const node = root.findNodeById(nodeId);
        if (!node) {
            return res.status(404).json({
                success: false,
                error: 'Node not found'
            });
        }
        
        node.size.width = width;
        node.size.height = height;
        node.markDirty({ size: true });
        
        layoutEngine.processLayout();
        
        res.json({
            success: true,
            data: { nodeId, size: node.size },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Update size error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Add child node
router.post('/layout/node/:parentId/child', (req, res) => {
    try {
        const { parentId } = req.params;
        const { id, type, width, height, margin } = req.body;
        
        const parent = root.findNodeById(parentId);
        if (!parent) {
            return res.status(404).json({
                success: false,
                error: 'Parent node not found'
            });
        }
        
        const child = new LayoutNode({
            id,
            type,
            width: width || 100,
            height: height || 100,
            margin: margin || { top: 0, right: 0, bottom: 0, left: 0 }
        });
        
        parent.addChild(child);
        layoutEngine.processLayout();
        
        res.json({
            success: true,
            data: { parentId, childId: child.id },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Add child error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Remove child node
router.delete('/layout/node/:parentId/child/:childId', (req, res) => {
    try {
        const { parentId, childId } = req.params;
        
        const parent = root.findNodeById(parentId);
        if (!parent) {
            return res.status(404).json({
                success: false,
                error: 'Parent node not found'
            });
        }
        
        parent.removeChild(childId);
        layoutEngine.processLayout();
        
        res.json({
            success: true,
            data: { parentId, childId },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Remove child error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Batch update
router.post('/layout/batch-update', (req, res) => {
    try {
        const { updates } = req.body;
        if (!updates || !Array.isArray(updates)) {
            return res.status(400).json({
                success: false,
                error: 'Updates array required'
            });
        }
        
        const processed = layoutEngine.batchUpdate(updates);
        
        res.json({
            success: true,
            data: {
                processed: Array.from(processed),
                count: processed.size
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Batch update error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Force reflow (for testing)
router.post('/layout/reflow', (req, res) => {
    try {
        root.invalidateBranch();
        layoutEngine.processLayout();
        
        res.json({
            success: true,
            message: 'Reflow completed',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Reflow error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

export default router;