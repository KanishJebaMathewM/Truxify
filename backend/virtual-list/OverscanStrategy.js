import { EventEmitter } from 'events';
import logger from '../../api/src/middleware/logger.js';

class OverscanStrategy extends EventEmitter {
    constructor(config = {}) {
        super();
        
        // Base configuration
        this.minOverscan = config.minOverscan || 2;
        this.maxOverscan = config.maxOverscan || 20;
        this.defaultOverscan = config.defaultOverscan || 5;
        this.itemHeight = config.itemHeight || 50;
        this.viewportHeight = config.viewportHeight || 600;
        
        // Velocity tracking
        this.velocity = 0;
        this.velocityHistory = [];
        this.maxVelocityHistory = 10;
        this.lastScrollPosition = 0;
        this.lastScrollTime = Date.now();
        
        // Current state
        this.currentOverscan = this.defaultOverscan;
        this.targetOverscan = this.defaultOverscan;
        this.smoothFactor = config.smoothFactor || 0.3;
        this.updateInterval = config.updateInterval || 50;
        
        // Adaptive parameters
        this.velocityThresholds = {
            slow: config.slowThreshold || 50,      // pixels per second
            medium: config.mediumThreshold || 200,
            fast: config.fastThreshold || 500
        };
        
        // Overscan multipliers
        this.multipliers = {
            slow: config.slowMultiplier || 0.5,
            medium: config.mediumMultiplier || 1.0,
            fast: config.fastMultiplier || 1.5,
            veryFast: config.veryFastMultiplier || 2.5
        };
        
        // Performance tracking
        this.renderTimes = [];
        this.maxRenderTimes = 20;
        this.performanceHistory = [];
        
        // Start monitoring
        this.startMonitoring();
        
        logger.info(`✅ OverscanStrategy initialized (min: ${this.minOverscan}, max: ${this.maxOverscan})`);
    }
    
    // ============ Update Methods ============
    
    updateScrollPosition(scrollTop) {
        const currentTime = Date.now();
        const deltaTime = currentTime - this.lastScrollTime;
        
        if (deltaTime > 0) {
            const deltaPosition = scrollTop - this.lastScrollPosition;
            this.velocity = Math.abs(deltaPosition) / (deltaTime / 1000); // pixels per second
            
            // Update velocity history
            this.velocityHistory.push(this.velocity);
            if (this.velocityHistory.length > this.maxVelocityHistory) {
                this.velocityHistory.shift();
            }
        }
        
        this.lastScrollPosition = scrollTop;
        this.lastScrollTime = currentTime;
        
        // Calculate new overscan
        this.calculateOverscan();
    }
    
    calculateOverscan() {
        // Get average velocity
        const avgVelocity = this.getAverageVelocity();
        
        // Determine speed category
        const speedCategory = this.getSpeedCategory(avgVelocity);
        
        // Calculate base overscan
        let overscan = this.defaultOverscan;
        
        switch (speedCategory) {
            case 'veryFast':
                overscan = this.defaultOverscan * this.multipliers.veryFast;
                break;
            case 'fast':
                overscan = this.defaultOverscan * this.multipliers.fast;
                break;
            case 'medium':
                overscan = this.defaultOverscan * this.multipliers.medium;
                break;
            case 'slow':
                overscan = this.defaultOverscan * this.multipliers.slow;
                break;
            default:
                overscan = this.defaultOverscan;
        }
        
        // Apply performance adjustments
        overscan = this.adjustForPerformance(overscan);
        
        // Clamp values
        this.targetOverscan = Math.max(this.minOverscan, Math.min(this.maxOverscan, Math.round(overscan)));
        
        // Smooth transition
        this.currentOverscan += (this.targetOverscan - this.currentOverscan) * this.smoothFactor;
        this.currentOverscan = Math.max(this.minOverscan, Math.min(this.maxOverscan, Math.round(this.currentOverscan)));
        
        // Emit update event
        if (this.currentOverscan !== this.targetOverscan || this.lastEmitted !== this.currentOverscan) {
            this.lastEmitted = this.currentOverscan;
            this.emit('overscanUpdated', {
                overscan: this.currentOverscan,
                target: this.targetOverscan,
                velocity: avgVelocity,
                speedCategory: speedCategory,
                timestamp: Date.now()
            });
        }
    }
    
    // ============ Velocity Analysis ============
    
    getAverageVelocity() {
        if (this.velocityHistory.length === 0) {
            return 0;
        }
        
        // Weight recent velocities more heavily
        let weightedSum = 0;
        let weightSum = 0;
        
        for (let i = 0; i < this.velocityHistory.length; i++) {
            const weight = i + 1;
            weightedSum += this.velocityHistory[i] * weight;
            weightSum += weight;
        }
        
        return weightedSum / weightSum;
    }
    
    getSpeedCategory(velocity) {
        if (velocity > this.velocityThresholds.fast) {
            return 'veryFast';
        } else if (velocity > this.velocityThresholds.medium) {
            return 'fast';
        } else if (velocity > this.velocityThresholds.slow) {
            return 'medium';
        } else if (velocity > 0) {
            return 'slow';
        }
        return 'idle';
    }
    
    // ============ Performance Adaptation ============
    
    adjustForPerformance(overscan) {
        // Check recent render performance
        const avgRenderTime = this.getAverageRenderTime();
        
        if (avgRenderTime > 50) {
            // Slow renders - reduce overscan
            overscan *= 0.8;
        } else if (avgRenderTime > 30) {
            // Moderate renders - slight reduction
            overscan *= 0.9;
        } else if (avgRenderTime < 10 && overscan < this.maxOverscan) {
            // Fast renders - allow more overscan
            overscan *= 1.1;
        }
        
        return overscan;
    }
    
    getAverageRenderTime() {
        if (this.renderTimes.length === 0) {
            return 0;
        }
        
        const sum = this.renderTimes.reduce((a, b) => a + b, 0);
        return sum / this.renderTimes.length;
    }
    
    recordRenderTime(time) {
        this.renderTimes.push(time);
        if (this.renderTimes.length > this.maxRenderTimes) {
            this.renderTimes.shift();
        }
    }
    
    // ============ Monitoring ============
    
    startMonitoring() {
        this.monitoringInterval = setInterval(() => {
            this.checkIdle();
        }, 1000);
    }
    
    checkIdle() {
        // If velocity has been 0 for a while, reset to default
        const avgVelocity = this.getAverageVelocity();
        if (avgVelocity < 1 && this.currentOverscan > this.defaultOverscan) {
            // Gradually reduce overscan when idle
            this.currentOverscan = Math.max(
                this.defaultOverscan,
                this.currentOverscan - 1
            );
        }
    }
    
    stopMonitoring() {
        if (this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
            this.monitoringInterval = null;
        }
    }
    
    // ============ Getters ============
    
    getOverscan() {
        return Math.round(this.currentOverscan);
    }
    
    getVisibleRange(viewportStart, viewportEnd) {
        const overscan = this.getOverscan();
        const start = Math.max(0, viewportStart - overscan);
        const end = viewportEnd + overscan;
        
        return { start, end, overscan };
    }
    
    getVisibleItems(viewportStart, viewportEnd, totalItems) {
        const { start, end } = this.getVisibleRange(viewportStart, viewportEnd);
        const items = [];
        
        for (let i = start; i <= Math.min(end, totalItems - 1); i++) {
            items.push(i);
        }
        
        return items;
    }
    
    getStats() {
        return {
            currentOverscan: this.currentOverscan,
            targetOverscan: this.targetOverscan,
            minOverscan: this.minOverscan,
            maxOverscan: this.maxOverscan,
            defaultOverscan: this.defaultOverscan,
            velocity: this.getAverageVelocity(),
            speedCategory: this.getSpeedCategory(this.getAverageVelocity()),
            renderTime: this.getAverageRenderTime(),
            itemHeight: this.itemHeight,
            viewportHeight: this.viewportHeight,
            visibleItems: Math.ceil(this.viewportHeight / this.itemHeight),
            overscanItems: Math.round(this.currentOverscan),
            totalVisible: Math.ceil(this.viewportHeight / this.itemHeight) + Math.round(this.currentOverscan) * 2
        };
    }
    
    // ============ Configuration ============
    
    setConfig(config) {
        if (config.minOverscan !== undefined) {
            this.minOverscan = config.minOverscan;
        }
        if (config.maxOverscan !== undefined) {
            this.maxOverscan = config.maxOverscan;
        }
        if (config.defaultOverscan !== undefined) {
            this.defaultOverscan = config.defaultOverscan;
            this.currentOverscan = this.defaultOverscan;
        }
        if (config.itemHeight !== undefined) {
            this.itemHeight = config.itemHeight;
        }
        if (config.viewportHeight !== undefined) {
            this.viewportHeight = config.viewportHeight;
        }
        if (config.smoothFactor !== undefined) {
            this.smoothFactor = config.smoothFactor;
        }
        
        this.emit('configUpdated', this.getStats());
    }
    
    // ============ Reset ============
    
    reset() {
        this.velocity = 0;
        this.velocityHistory = [];
        this.lastScrollPosition = 0;
        this.currentOverscan = this.defaultOverscan;
        this.targetOverscan = this.defaultOverscan;
        this.renderTimes = [];
        
        this.emit('reset', this.getStats());
        logger.debug('Overscan strategy reset');
    }
    
    destroy() {
        this.stopMonitoring();
        this.removeAllListeners();
        logger.debug('Overscan strategy destroyed');
    }
}

export default OverscanStrategy;