import LayoutNode from './LayoutNode.js';
import logger from '../api/src/middleware/logger.js';

class LayoutEngine {
    constructor() {
        this.root = null;
        this.dirtyNodes = new Set();
        this.layoutQueue = [];
        this.isProcessing = false;
        this.metrics = {
            totalLayouts: 0,
            totalMeasures: 0,
            totalRenders: 0,
            averageLayoutTime: 0,
            averageMeasureTime: 0,
            averageRenderTime: 0
        };
        
        logger.info('✅ Layout Engine initialized');
    }
    
    // ============ Root Management ============
    
    setRoot(root) {
        if (this.root) {
            this.root.removeAllListeners();
        }
        
        this.root = root;
        
        // Listen for dirty events
        root.on('dirty', (data) => {
            this.addDirtyNode(data.nodeId);
        });
        
        logger.info(`Root node set: ${root.id}`);
    }
    
    getRoot() {
        return this.root;
    }
    
    // ============ Dirty Management ============
    
    addDirtyNode(nodeId) {
        this.dirtyNodes.add(nodeId);
        this.scheduleLayout();
    }
    
    removeDirtyNode(nodeId) {
        this.dirtyNodes.delete(nodeId);
    }
    
    getDirtyNodes() {
        return Array.from(this.dirtyNodes);
    }
    
    clearDirtyNodes() {
        this.dirtyNodes.clear();
    }
    
    // ============ Layout Scheduling ============

    scheduleLayout() {
        if (this.isProcessing) return;

        this.isProcessing = true;

        // Use microtask for immediate scheduling
        Promise.resolve().then(async () => {
            try {
                if (!this.root) return;

                const dirtyIds = Array.from(this.dirtyNodes);
                if (dirtyIds.length === 0) return;

                this.dirtyNodes.clear();

                const start = Date.now();
                for (const nodeId of dirtyIds) {
                    const node = this.root.findNode ? this.root.findNode(nodeId) : null;
                    if (node && typeof node.measure === 'function') {
                        node.measure();
                    }
                }

                this.metrics.totalLayouts += 1;
                this.metrics.averageLayoutTime =
                    (this.metrics.averageLayoutTime * (this.metrics.totalLayouts - 1) + (Date.now() - start)) /
                    this.metrics.totalLayouts;

                logger.info(`Layout scheduled for ${dirtyIds.length} nodes in ${Date.now() - start}ms`);
            } catch (err) {
                logger.error({ err }, '[LayoutEngine] Layout scheduling failed');
            } finally {
                this.isProcessing = false;
            }
        }).catch(err => {
            this.isProcessing = false;
            logger.error({ err }, '[LayoutEngine] Unexpected error in layout microtask');
        });
    }
}