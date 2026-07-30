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
        Promise.resolve().then(() => {
        .catch(err => console.error(err))