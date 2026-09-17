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
                if (this.dirtyNodes.size === 0) {
                    this.isProcessing = false;
                    return;
                }

                const startTime = Date.now();

                // Process all dirty nodes
                for (const nodeId of this.dirtyNodes) {
                    const node = this.root ? this.root.findNodeById(nodeId) : null;
                    if (node) {
                        await node.measure();
                        await node.render();
                        this.metrics.totalMeasures++;
                        this.metrics.totalRenders++;
                    }
                    this.removeDirtyNode(nodeId);
                }

                const duration = Date.now() - startTime;
                this.metrics.totalLayouts++;
                const count = this.metrics.totalLayouts;
                this.metrics.averageLayoutTime =
                    (this.metrics.averageLayoutTime * (count - 1) + duration) / count;

                logger.info(`[LayoutEngine] Layout completed in ${duration}ms, processed ${this.dirtyNodes.size} dirty nodes`);
            } catch (err) {
                logger.error('[LayoutEngine] Layout scheduling error:', err.message);
            } finally {
                this.isProcessing = false;
            }
        }).catch(err => console.error(err));
    }
}

export default LayoutEngine;

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
                if (this.dirtyNodes.size === 0) {
                    this.isProcessing = false;
                    return;
                }

                const startTime = Date.now();

                // Process all dirty nodes
                for (const nodeId of this.dirtyNodes) {
                    const node = this.root ? this.root.findNodeById(nodeId) : null;
                    if (node) {
                        await node.measure();
                        await node.render();
                        this.metrics.totalMeasures++;
                        this.metrics.totalRenders++;
                    }
                    this.removeDirtyNode(nodeId);
                }

                const duration = Date.now() - startTime;
                this.metrics.totalLayouts++;
                const count = this.metrics.totalLayouts;
                this.metrics.averageLayoutTime =
                    (this.metrics.averageLayoutTime * (count - 1) + duration) / count;

                logger.info(`[LayoutEngine] Layout completed in ${duration}ms, processed ${this.dirtyNodes.size} dirty nodes`);
            } catch (err) {
                logger.error('[LayoutEngine] Layout scheduling error:', err.message);
            } finally {
                this.isProcessing = false;
            }
        }).catch(err => console.error(err));
    }

    // ============ Synchronous Processing (Fixes 500s in routes.js) ============

    /**
     * Synchronously flushes dirty nodes and updates metrics.
     * Required by routes.js to prevent TypeError on module load and synchronous handlers.
     */
    processLayout() {
        if (!this.root) {
            logger.warn('[LayoutEngine] processLayout called but no root node is set');
            return;
        }

        const startTime = Date.now();
        let processedCount = 0;

        for (const nodeId of this.dirtyNodes) {
            const node = this.root.findNodeById(nodeId);
            if (node) {
                // Synchronous measure and render fallback
                if (typeof node.measureSync === 'function') {
                    node.measureSync();
                } else {
                    node.measure(); // Fallback to async if sync not available
                }

                if (typeof node.renderSync === 'function') {
                    node.renderSync();
                } else {
                    node.render();
                }

                this.metrics.totalMeasures++;
                this.metrics.totalRenders++;
                processedCount++;
                1
                this.removeDirtyNode(nodeId);
            }

            const duration = Date.now() - startTime;
            this.metrics.totalLayouts++;
            const count = this.metrics.totalLayouts;
            this.metrics.averageLayoutTime =
                (this.metrics.averageLayoutTime * (count - 1) + duration) / count;

            logger.info(`[LayoutEngine] Sync processLayout completed in ${duration}ms, processed ${processedCount} dirty nodes`);
        }

        // ============ Helper Methods Required by routes.js ============

        getLayoutTree() {
            if (!this.root) return null;
            return this.root.serialize();
        }

        getMetrics() {
            return { ...this.metrics };
        }

        getNodeStats(nodeId) {
            if (!this.root) return null;
            const node = this.root.findNodeById(nodeId);
            if (!node) return null;
            return {
                id: node.id,
                type: node.type,
                width: node.size?.width || 0,
                height: node.size?.height || 0,
                x: node.position?.x || 0,
                y: node.position?.y || 0,
                isDirty: this.dirtyNodes.has(nodeId)
            };
        }

        batchUpdate(updates) {
            const processed = new Set();
            if (!this.root || !Array.isArray(updates)) return processed;

            for (const update of updates) {
                const { nodeId, changes } = update;
                const node = this.root.findNodeById(nodeId);
                if (node && changes) {
                    if (changes.position) {
                        node.position = { ...node.position, ...changes.position };
                    }
                    if (changes.size) {
                        node.size = { ...node.size, ...changes.size };
                    }
                    node.markDirty({ position: !!changes.position, size: !!changes.size });
                    processed.add(nodeId);
                }
            }

            this.processLayout();
            return processed;
        }
    }

export default LayoutEngine;
