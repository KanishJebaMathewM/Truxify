import LayoutNode from './LayoutNode.js';
import logger from '../../api/src/middleware/logger.js';

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
            this.processLayout();
        });
    }
    
    // ============ Layout Processing ============
    
    processLayout() {
        const startTime = Date.now();
        const processedNodes = new Set();
        
        try {
            // Collect dirty nodes and their ancestors
            const nodesToProcess = new Set();
            
            for (const nodeId of this.dirtyNodes) {
                const node = this.root.findNodeById(nodeId);
                if (node) {
                    // Add node and its ancestors
                    let current = node;
                    while (current) {
                        nodesToProcess.add(current.id);
                        current = current.parent;
                    }
                }
            }
            
            // Process nodes in order (children first)
            const sortedNodes = this.topologicalSort(nodesToProcess);
            
            for (const nodeId of sortedNodes) {
                const node = this.root.findNodeById(nodeId);
                if (node) {
                    this.processNode(node);
                    processedNodes.add(nodeId);
                }
            }
            
            // Clear dirty nodes
            this.dirtyNodes.clear();
            
            // Update metrics
            const duration = Date.now() - startTime;
            this.metrics.totalLayouts++;
            this.metrics.averageLayoutTime = 
                (this.metrics.averageLayoutTime * (this.metrics.totalLayouts - 1) + duration) / this.metrics.totalLayouts;
            
            logger.debug(`Layout processed ${processedNodes.size} nodes in ${duration}ms`);
            
        } catch (error) {
            logger.error('Layout processing failed:', error);
        } finally {
            this.isProcessing = false;
        }
        
        return processedNodes;
    }
    
    processNode(node) {
        // Measure first
        node.measure();
        
        // Compute layout
        node.computeLayout();
        
        // Mark for render
        node.needsRender = true;
        
        // Update metrics
        this.metrics.totalMeasures++;
        this.metrics.totalRenders++;
    }
    
    // ============ Topological Sort ============
    
    topologicalSort(nodeIds) {
        const sorted = [];
        const visited = new Set();
        const nodeSet = new Set(nodeIds);
        
        // Get all nodes to process
        const nodesToProcess = [];
        for (const id of nodeIds) {
            const node = this.root.findNodeById(id);
            if (node) {
                nodesToProcess.push(node);
            }
        }
        
        // Sort by depth (children first)
        const depthMap = new Map();
        for (const node of nodesToProcess) {
            const depth = this.getNodeDepth(node);
            depthMap.set(node.id, depth);
        }
        
        // Sort by depth descending (children first)
        nodesToProcess.sort((a, b) => {
            const depthA = depthMap.get(a.id) || 0;
            const depthB = depthMap.get(b.id) || 0;
            return depthB - depthA;
        });
        
        return nodesToProcess.map(node => node.id);
    }
    
    getNodeDepth(node) {
        let depth = 0;
        let current = node;
        while (current.parent) {
            depth++;
            current = current.parent;
        }
        return depth;
    }
    
    // ============ Batch Operations ============
    
    batchUpdate(updates) {
        // Clear dirty nodes
        this.dirtyNodes.clear();
        
        // Perform updates
        for (const update of updates) {
            const node = this.root.findNodeById(update.nodeId);
            if (node) {
                if (update.type === 'position') {
                    node.position.x = update.x;
                    node.position.y = update.y;
                    node.markDirty({ position: true });
                } else if (update.type === 'size') {
                    node.size.width = update.width;
                    node.size.height = update.height;
                    node.markDirty({ size: true });
                } else if (update.type === 'addChild') {
                    const child = new LayoutNode(update.childConfig);
                    node.addChild(child);
                } else if (update.type === 'removeChild') {
                    node.removeChild(update.childId);
                }
            }
        }
        
        // Process layout
        return this.processLayout();
    }
    
    // ============ Metrics ============
    
    getMetrics() {
        return {
            ...this.metrics,
            dirtyNodeCount: this.dirtyNodes.size,
            isProcessing: this.isProcessing,
            rootNodeCount: this.root ? this.root.getTotalNodes() : 0,
            timestamp: new Date().toISOString()
        };
    }
    
    getNodeStats(nodeId) {
        const node = this.root.findNodeById(nodeId);
        if (node) {
            return node.getStatistics();
        }
        return null;
    }
    
    // ============ Debug ============
    
    getLayoutTree() {
        if (!this.root) return null;
        
        const serializeNode = (node) => {
            return {
                id: node.id,
                type: node.type,
                position: node.position,
                size: node.size,
                isDirty: node.isDirty,
                needsLayout: node.needsLayout,
                needsMeasure: node.needsMeasure,
                needsRender: node.needsRender,
                children: node.children.map(child => serializeNode(child))
            };
        };
        
        return serializeNode(this.root);
    }
    
    // ============ Reset ============
    
    reset() {
        this.root = null;
        this.dirtyNodes.clear();
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
        
        logger.info('Layout Engine reset');
    }
}

export default LayoutEngine;