import { EventEmitter } from 'events';
import logger from '../../api/src/middleware/logger.js';

class LayoutNode extends EventEmitter {
    constructor(config = {}) {
        super();
        
        // Node properties
        this.id = config.id || `node_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        this.type = config.type || 'container';
        this.parent = config.parent || null;
        this.children = [];
        
        // Layout properties
        this.position = { x: config.x || 0, y: config.y || 0 };
        this.size = { width: config.width || 0, height: config.height || 0 };
        this.margin = config.margin || { top: 0, right: 0, bottom: 0, left: 0 };
        this.padding = config.padding || { top: 0, right: 0, bottom: 0, left: 0 };
        
        // Dirty flags
        this.isDirty = false;
        this.isPositionDirty = false;
        this.isSizeDirty = false;
        this.isChildrenDirty = false;
        
        // Cached measurements
        this.cachedLayout = null;
        this.cachedSize = null;
        this.cachedPosition = null;
        this.cacheVersion = 0;
        
        // Render flags
        this.needsRender = false;
        this.needsMeasure = false;
        this.needsLayout = false;
        
        // Child tracking
        this.childOrder = [];
        this.childMap = new Map();
        
        // Statistics
        this.layoutCount = 0;
        this.measureCount = 0;
        this.renderCount = 0;
        
        logger.debug(`✅ LayoutNode created: ${this.id}`);
    }
    
    // ============ Dirty Management ============
    
    markDirty(flags = {}) {
        this.isDirty = true;
        this.needsLayout = true;
        this.needsMeasure = true;
        
        if (flags.position) this.isPositionDirty = true;
        if (flags.size) this.isSizeDirty = true;
        if (flags.children) this.isChildrenDirty = true;
        
        this.cacheVersion++;
        this.emit('dirty', { nodeId: this.id, flags });
        logger.debug(`Node ${this.id} marked dirty`, flags);
    }
    
    markClean() {
        this.isDirty = false;
        this.isPositionDirty = false;
        this.isSizeDirty = false;
        this.isChildrenDirty = false;
        this.needsLayout = false;
        this.needsMeasure = false;
        this.needsRender = false;
        
        this.emit('clean', { nodeId: this.id });
        logger.debug(`Node ${this.id} marked clean`);
    }
    
    invalidateBranch() {
        this.markDirty({ position: true, size: true, children: true });
        
        for (const child of this.children) {
            child.invalidateBranch();
        }
    }
    
    // ============ Child Management ============
    
    addChild(child) {
        if (this.childMap.has(child.id)) {
            logger.warn(`Child ${child.id} already exists in node ${this.id}`);
            return false;
        }
        
        child.parent = this;
        this.children.push(child);
        this.childOrder.push(child.id);
        this.childMap.set(child.id, child);
        this.markDirty({ children: true });
        
        child.on('dirty', () => {
            this.markDirty({ children: true });
        });
        
        this.emit('childAdded', { parent: this.id, child: child.id });
        logger.debug(`Child ${child.id} added to ${this.id}`);
        return true;
    }
    
    removeChild(childId) {
        const index = this.children.findIndex(c => c.id === childId);
        if (index === -1) {
            logger.warn(`Child ${childId} not found in node ${this.id}`);
            return false;
        }
        
        const child = this.children[index];
        this.children.splice(index, 1);
        this.childOrder = this.childOrder.filter(id => id !== childId);
        this.childMap.delete(childId);
        
        child.parent = null;
        this.markDirty({ children: true });
        
        this.emit('childRemoved', { parent: this.id, child: childId });
        logger.debug(`Child ${childId} removed from ${this.id}`);
        return true;
    }
    
    getChild(childId) {
        return this.childMap.get(childId);
    }
    
    getChildren() {
        return this.children;
    }
    
    getChildCount() {
        return this.children.length;
    }
    
    // ============ Layout Computation ============
    
    computeLayout(force = false) {
        if (!this.needsLayout && !force) {
            return this.cachedLayout;
        }
        
        this.layoutCount++;
        const startTime = Date.now();
        
        // Compute own layout
        const layout = {
            position: { ...this.position },
            size: { ...this.size }
        };
        
        // Compute child layouts
        let totalWidth = 0;
        let totalHeight = 0;
        let maxChildHeight = 0;
        
        for (const child of this.children) {
            if (child.needsLayout || force) {
                child.computeLayout(force);
            }
            
            // Accumulate child sizes
            totalWidth += child.size.width + child.margin.left + child.margin.right;
            maxChildHeight = Math.max(maxChildHeight, child.size.height + child.margin.top + child.margin.bottom);
            
            // Position child relative to parent
            if (this.type === 'row') {
                child.position.x = this.position.x + this.padding.left + totalWidth - child.size.width - child.margin.right;
                child.position.y = this.position.y + this.padding.top + (this.size.height - child.size.height) / 2;
            } else if (this.type === 'column') {
                child.position.x = this.position.x + this.padding.left + (this.size.width - child.size.width) / 2;
                child.position.y = this.position.y + this.padding.top + totalHeight;
                totalHeight += child.size.height + child.margin.top + child.margin.bottom;
            } else {
                // container
                child.position.x = this.position.x + this.padding.left + child.margin.left;
                child.position.y = this.position.y + this.padding.top + child.margin.top;
            }
        }
        
        // Update own size based on children if not set
        if (this.size.width === 0 && this.type !== 'fixed') {
            this.size.width = totalWidth + this.padding.left + this.padding.right;
        }
        if (this.size.height === 0 && this.type !== 'fixed') {
            this.size.height = totalHeight + this.padding.top + this.padding.bottom;
        }
        
        this.cachedLayout = layout;
        this.markClean();
        
        const duration = Date.now() - startTime;
        this.emit('layoutComputed', { nodeId: this.id, duration });
        
        logger.debug(`Layout computed for ${this.id} in ${duration}ms`);
        return layout;
    }
    
    // ============ Measurement ============
    
    measure(force = false) {
        if (!this.needsMeasure && !force && this.cachedSize) {
            return this.cachedSize;
        }
        
        this.measureCount++;
        const startTime = Date.now();
        
        // Measure own size
        const size = {
            width: this.size.width,
            height: this.size.height
        };
        
        // Measure children
        for (const child of this.children) {
            if (child.needsMeasure || force) {
                child.measure(force);
            }
        }
        
        this.cachedSize = size;
        this.needsMeasure = false;
        
        const duration = Date.now() - startTime;
        this.emit('measured', { nodeId: this.id, duration });
        
        logger.debug(`Node ${this.id} measured in ${duration}ms`);
        return size;
    }
    
    // ============ Render ============
    
    render(context) {
        if (!this.needsRender && !context.force) {
            return this.cachedLayout;
        }
        
        this.renderCount++;
        const startTime = Date.now();
        
        // Compute layout first
        this.computeLayout(context.force);
        
        // Render children
        for (const child of this.children) {
            child.render(context);
        }
        
        this.needsRender = false;
        
        const duration = Date.now() - startTime;
        this.emit('rendered', { nodeId: this.id, duration });
        
        logger.debug(`Node ${this.id} rendered in ${duration}ms`);
        return this.cachedLayout;
    }
    
    // ============ Cache Management ============
    
    getCachedLayout() {
        return this.cachedLayout;
    }
    
    getCachedSize() {
        return this.cachedSize;
    }
    
    getCachedPosition() {
        return this.cachedPosition;
    }
    
    clearCache() {
        this.cachedLayout = null;
        this.cachedSize = null;
        this.cachedPosition = null;
        this.cacheVersion = 0;
        this.markDirty({ position: true, size: true });
    }
    
    // ============ Status ============
    
    getStatus() {
        return {
            id: this.id,
            type: this.type,
            isDirty: this.isDirty,
            needsLayout: this.needsLayout,
            needsMeasure: this.needsMeasure,
            needsRender: this.needsRender,
            childCount: this.children.length,
            layoutCount: this.layoutCount,
            measureCount: this.measureCount,
            renderCount: this.renderCount,
            cacheVersion: this.cacheVersion
        };
    }
    
    getStatistics() {
        return {
            layoutCount: this.layoutCount,
            measureCount: this.measureCount,
            renderCount: this.renderCount,
            childCount: this.children.length,
            totalNodes: this.getTotalNodes()
        };
    }
    
    getTotalNodes() {
        let count = 1;
        for (const child of this.children) {
            count += child.getTotalNodes();
        }
        return count;
    }
    
    // ============ Tree Operations ============
    
    findNodeById(id) {
        if (this.id === id) return this;
        
        for (const child of this.children) {
            const result = child.findNodeById(id);
            if (result) return result;
        }
        
        return null;
    }
    
    getAncestors() {
        const ancestors = [];
        let current = this.parent;
        while (current) {
            ancestors.push(current);
            current = current.parent;
        }
        return ancestors;
    }
    
    getPath() {
        const path = [];
        let current = this;
        while (current) {
            path.push(current.id);
            current = current.parent;
        }
        return path.reverse();
    }
}

export default LayoutNode;