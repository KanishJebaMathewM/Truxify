import { EventEmitter } from 'events';
import OverscanStrategy from './OverscanStrategy.js';
import logger from '../../api/src/middleware/logger.js';

class VirtualList extends EventEmitter {
    constructor(config = {}) {
        super();
        
        this.items = config.items || [];
        this.itemHeight = config.itemHeight || 50;
        this.viewportHeight = config.viewportHeight || 600;
        this.scrollPosition = config.scrollPosition || 0;
        
        // Initialize overscan strategy
        this.overscanStrategy = new OverscanStrategy({
            itemHeight: this.itemHeight,
            viewportHeight: this.viewportHeight,
            minOverscan: config.minOverscan || 2,
            maxOverscan: config.maxOverscan || 20,
            defaultOverscan: config.defaultOverscan || 5
        });
        
        // Listen for overscan updates
        this.overscanStrategy.on('overscanUpdated', (data) => {
            this.emit('overscanUpdated', data);
            this.updateVisibleRange();
        });
        
        // State
        this.visibleRange = { start: 0, end: 0 };
        this.renderedItems = [];
        this.renderCount = 0;
        this.lastRenderTime = 0;
        this.isRendering = false;
        
        // Performance metrics
        this.metrics = {
            totalRenders: 0,
            totalRenderTime: 0,
            averageRenderTime: 0,
            maxRenderTime: 0,
            minRenderTime: Infinity
        };
        
        // Update initial visible range
        this.updateVisibleRange();
        
        logger.info(`✅ VirtualList initialized (${this.items.length} items, ${this.viewportHeight}px)`);
    }
    
    // ============ Scroll Handling ============
    
    scrollTo(position) {
        this.scrollPosition = Math.max(0, Math.min(position, this.getTotalHeight() - this.viewportHeight));
        this.overscanStrategy.updateScrollPosition(this.scrollPosition);
        this.updateVisibleRange();
        this.emit('scroll', { position: this.scrollPosition });
        
        return this.scrollPosition;
    }
    
    scrollBy(delta) {
        return this.scrollTo(this.scrollPosition + delta);
    }
    
    scrollToIndex(index) {
        const position = index * this.itemHeight;
        return this.scrollTo(position);
    }
    
    // ============ Range Calculation ============
    
    updateVisibleRange() {
        const startIndex = Math.floor(this.scrollPosition / this.itemHeight);
        const endIndex = Math.min(
            startIndex + Math.ceil(this.viewportHeight / this.itemHeight),
            this.items.length - 1
        );
        
        const overscan = this.overscanStrategy.getOverscan();
        
        const renderStart = Math.max(0, startIndex - overscan);
        const renderEnd = Math.min(this.items.length - 1, endIndex + overscan);
        
        this.visibleRange = {
            start: renderStart,
            end: renderEnd,
            viewportStart: startIndex,
            viewportEnd: endIndex,
            overscan: overscan
        };
        
        this.emit('rangeUpdated', this.visibleRange);
        
        return this.visibleRange;
    }
    
    // ============ Rendering ============
    
    render() {
        if (this.isRendering) {
            return null;
        }
        
        this.isRendering = true;
        const startTime = performance.now();
        
        const { start, end } = this.visibleRange;
        const visibleItems = [];
        
        for (let i = start; i <= end && i < this.items.length; i++) {
            visibleItems.push({
                index: i,
                item: this.items[i],
                position: i * this.itemHeight,
                height: this.itemHeight,
                isVisible: i >= this.visibleRange.viewportStart && i <= this.visibleRange.viewportEnd
            });
        }
        
        this.renderedItems = visibleItems;
        this.renderCount++;
        
        const renderTime = performance.now() - startTime;
        this.lastRenderTime = renderTime;
        
        // Record render time for performance adaptation
        this.overscanStrategy.recordRenderTime(renderTime);
        
        // Update metrics
        this.metrics.totalRenders++;
        this.metrics.totalRenderTime += renderTime;
        this.metrics.averageRenderTime = this.metrics.totalRenderTime / this.metrics.totalRenders;
        this.metrics.maxRenderTime = Math.max(this.metrics.maxRenderTime, renderTime);
        this.metrics.minRenderTime = Math.min(this.metrics.minRenderTime, renderTime);
        
        this.isRendering = false;
        
        this.emit('rendered', {
            items: visibleItems,
            count: visibleItems.length,
            renderTime: renderTime,
            overscan: this.overscanStrategy.getOverscan()
        });
        
        return visibleItems;
    }
    
    // ============ Item Management ============
    
    setItems(items) {
        this.items = items;
        this.updateVisibleRange();
        this.emit('itemsUpdated', { count: items.length });
        return this.render();
    }
    
    addItem(item) {
        this.items.push(item);
        this.updateVisibleRange();
        this.emit('itemAdded', { index: this.items.length - 1 });
        return this.render();
    }
    
    insertItem(index, item) {
        this.items.splice(index, 0, item);
        this.updateVisibleRange();
        this.emit('itemInserted', { index });
        return this.render();
    }
    
    removeItem(index) {
        if (index >= 0 && index < this.items.length) {
            this.items.splice(index, 1);
            this.updateVisibleRange();
            this.emit('itemRemoved', { index });
            return this.render();
        }
        return null;
    }
    
    updateItem(index, item) {
        if (index >= 0 && index < this.items.length) {
            this.items[index] = item;
            this.updateVisibleRange();
            this.emit('itemUpdated', { index });
            return this.render();
        }
        return null;
    }
    
    clearItems() {
        this.items = [];
        this.updateVisibleRange();
        this.emit('itemsCleared');
        return this.render();
    }
    
    // ============ Queries ============
    
    getTotalHeight() {
        return this.items.length * this.itemHeight;
    }
    
    getVisibleItems() {
        return this.renderedItems;
    }
    
    getVisibleRange() {
        return this.visibleRange;
    }
    
    getItemAt(index) {
        if (index >= 0 && index < this.items.length) {
            return this.items[index];
        }
        return null;
    }
    
    getIndexAtPosition(position) {
        return Math.floor(position / this.itemHeight);
    }
    
    getPositionAtIndex(index) {
        return index * this.itemHeight;
    }
    
    getRenderStats() {
        return {
            totalItems: this.items.length,
            visibleItems: this.renderedItems.length,
            viewportItems: this.visibleRange.viewportEnd - this.visibleRange.viewportStart + 1,
            overscan: this.overscanStrategy.getOverscan(),
            renderCount: this.renderCount,
            lastRenderTime: this.lastRenderTime,
            scrollPosition: this.scrollPosition,
            metrics: this.metrics
        };
    }
    
    getOverscanStats() {
        return this.overscanStrategy.getStats();
    }
    
    // ============ Control ============
    
    reset() {
        this.scrollPosition = 0;
        this.overscanStrategy.reset();
        this.updateVisibleRange();
        this.renderCount = 0;
        this.lastRenderTime = 0;
        this.metrics = {
            totalRenders: 0,
            totalRenderTime: 0,
            averageRenderTime: 0,
            maxRenderTime: 0,
            minRenderTime: Infinity
        };
        this.emit('reset');
        return this.render();
    }
    
    destroy() {
        this.overscanStrategy.destroy();
        this.removeAllListeners();
        logger.debug('VirtualList destroyed');
    }
}

export default VirtualList;