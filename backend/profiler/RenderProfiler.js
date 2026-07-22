import { EventEmitter } from 'events';
import logger from '../../api/src/middleware/logger.js';

class RenderProfile {
    constructor(widgetName) {
        this.widgetName = widgetName;
        this.renders = [];
        this.layouts = [];
        this.paints = [];
        this.metrics = {
            totalRenders: 0,
            totalRenderTime: 0,
            averageRenderTime: 0,
            maxRenderTime: 0,
            minRenderTime: Infinity,
            totalLayoutTime: 0,
            averageLayoutTime: 0,
            totalPaintTime: 0,
            averagePaintTime: 0,
            memoryUsage: [],
            reRenderCauses: {}
        };
        this.startTime = Date.now();
        this.isActive = true;
    }
    
    startRender() {
        return new RenderTiming(this);
    }
    
    startLayout() {
        return new LayoutTiming(this);
    }
    
    startPaint() {
        return new PaintTiming(this);
    }
    
    addRender(render) {
        this.renders.push(render);
        this.metrics.totalRenders++;
        this.metrics.totalRenderTime += render.duration;
        this.metrics.averageRenderTime = this.metrics.totalRenderTime / this.metrics.totalRenders;
        this.metrics.maxRenderTime = Math.max(this.metrics.maxRenderTime, render.duration);
        this.metrics.minRenderTime = Math.min(this.metrics.minRenderTime, render.duration);
    }
    
    addLayout(layout) {
        this.layouts.push(layout);
        this.metrics.totalLayoutTime += layout.duration;
        this.metrics.averageLayoutTime = this.metrics.totalLayoutTime / this.layouts.length;
    }
    
    addPaint(paint) {
        this.paints.push(paint);
        this.metrics.totalPaintTime += paint.duration;
        this.metrics.averagePaintTime = this.metrics.totalPaintTime / this.paints.length;
    }
    
    addMemoryUsage(memory) {
        this.metrics.memoryUsage.push(memory);
    }
    
    addReRenderCause(cause) {
        if (!this.metrics.reRenderCauses[cause]) {
            this.metrics.reRenderCauses[cause] = 0;
        }
        this.metrics.reRenderCauses[cause]++;
    }
    
    getStats() {
        return {
            widgetName: this.widgetName,
            metrics: this.metrics,
            duration: Date.now() - this.startTime,
            renderCount: this.renders.length,
            layoutCount: this.layouts.length,
            paintCount: this.paints.length,
            isActive: this.isActive,
            timestamp: new Date().toISOString()
        };
    }
    
    stop() {
        this.isActive = false;
        return this.getStats();
    }
}

class RenderTiming {
    constructor(profile) {
        this.profile = profile;
        this.start = performance.now();
        this.end = null;
        this.duration = null;
        this.cause = null;
        this.metadata = {};
    }
    
    finish(cause = 'unknown', metadata = {}) {
        this.end = performance.now();
        this.duration = this.end - this.start;
        this.cause = cause;
        this.metadata = metadata;
        this.profile.addRender(this);
        this.profile.addReRenderCause(cause);
        return this.duration;
    }
}

class LayoutTiming {
    constructor(profile) {
        this.profile = profile;
        this.start = performance.now();
        this.end = null;
        this.duration = null;
        this.type = null;
    }
    
    finish(type = 'full') {
        this.end = performance.now();
        this.duration = this.end - this.start;
        this.type = type;
        this.profile.addLayout(this);
        return this.duration;
    }
}

class PaintTiming {
    constructor(profile) {
        this.profile = profile;
        this.start = performance.now();
        this.end = null;
        this.duration = null;
        this.region = null;
    }
    
    finish(region = 'full') {
        this.end = performance.now();
        this.duration = this.end - this.start;
        this.region = region;
        this.profile.addPaint(this);
        return this.duration;
    }
}

class RenderProfiler extends EventEmitter {
    constructor() {
        super();
        this.profiles = new Map();
        this.activeProfiles = new Map();
        this.globalMetrics = {
            totalRenders: 0,
            totalRenderTime: 0,
            totalLayouts: 0,
            totalLayoutTime: 0,
            totalPaints: 0,
            totalPaintTime: 0,
            startTime: Date.now(),
            widgetCount: 0,
            memoryStart: null,
            memoryPeak: null
        };
        this.isEnabled = true;
        this.samplingInterval = null;
        this.memorySamples = [];
        
        // Start memory monitoring
        this.startMemoryMonitoring();
        
        logger.info('✅ RenderProfiler initialized');
    }
    
    // ============ Profile Management ============
    
    createProfile(widgetName) {
        if (!this.isEnabled) return null;
        
        if (this.profiles.has(widgetName)) {
            const profile = this.profiles.get(widgetName);
            if (profile.isActive) {
                return profile;
            }
            // Reactivate old profile
            profile.isActive = true;
            profile.startTime = Date.now();
            return profile;
        }
        
        const profile = new RenderProfile(widgetName);
        this.profiles.set(widgetName, profile);
        this.activeProfiles.set(widgetName, profile);
        this.globalMetrics.widgetCount++;
        
        this.emit('profileCreated', { widgetName });
        logger.debug(`Profile created for: ${widgetName}`);
        
        return profile;
    }
    
    getProfile(widgetName) {
        return this.profiles.get(widgetName);
    }
    
    getActiveProfiles() {
        return Array.from(this.activeProfiles.values());
    }
    
    getInactiveProfiles() {
        return Array.from(this.profiles.values())
            .filter(p => !p.isActive);
    }
    
    getProfiles() {
        return Array.from(this.profiles.values());
    }
    
    stopProfile(widgetName) {
        const profile = this.profiles.get(widgetName);
        if (profile) {
            const stats = profile.stop();
            this.activeProfiles.delete(widgetName);
            this.emit('profileStopped', { widgetName, stats });
            logger.debug(`Profile stopped for: ${widgetName}`);
            return stats;
        }
        return null;
    }
    
    stopAllProfiles() {
        const results = [];
        for (const [widgetName, profile] of this.activeProfiles) {
            results.push(this.stopProfile(widgetName));
        }
        return results;
    }
    
    deleteProfile(widgetName) {
        const profile = this.profiles.get(widgetName);
        if (profile) {
            if (profile.isActive) {
                this.stopProfile(widgetName);
            }
            this.profiles.delete(widgetName);
            this.emit('profileDeleted', { widgetName });
            logger.debug(`Profile deleted: ${widgetName}`);
            return true;
        }
        return false;
    }
    
    clearProfiles() {
        this.stopAllProfiles();
        this.profiles.clear();
        this.memorySamples = [];
        this.emit('profilesCleared');
        logger.info('All profiles cleared');
    }
    
    // ============ Rendering Metrics ============
    
    profileRender(widgetName, renderFn, cause = 'unknown', metadata = {}) {
        if (!this.isEnabled) {
            return renderFn();
        }
        
        const profile = this.createProfile(widgetName);
        if (!profile) {
            return renderFn();
        }
        
        const renderTiming = profile.startRender();
        try {
            const result = renderFn();
            const duration = renderTiming.finish(cause, metadata);
            
            // Update global metrics
            this.globalMetrics.totalRenders++;
            this.globalMetrics.totalRenderTime += duration;
            
            this.emit('renderComplete', { widgetName, duration, cause, metadata });
            
            return result;
        } catch (error) {
            renderTiming.finish('error', { error: error.message });
            throw error;
        }
    }
    
    profileLayout(widgetName, layoutFn, type = 'full') {
        if (!this.isEnabled) {
            return layoutFn();
        }
        
        const profile = this.createProfile(widgetName);
        if (!profile) {
            return layoutFn();
        }
        
        const layoutTiming = profile.startLayout();
        try {
            const result = layoutFn();
            const duration = layoutTiming.finish(type);
            
            this.globalMetrics.totalLayouts++;
            this.globalMetrics.totalLayoutTime += duration;
            
            this.emit('layoutComplete', { widgetName, duration, type });
            
            return result;
        } catch (error) {
            layoutTiming.finish('error');
            throw error;
        }
    }
    
    profilePaint(widgetName, paintFn, region = 'full') {
        if (!this.isEnabled) {
            return paintFn();
        }
        
        const profile = this.createProfile(widgetName);
        if (!profile) {
            return paintFn();
        }
        
        const paintTiming = profile.startPaint();
        try {
            const result = paintFn();
            const duration = paintTiming.finish(region);
            
            this.globalMetrics.totalPaints++;
            this.globalMetrics.totalPaintTime += duration;
            
            this.emit('paintComplete', { widgetName, duration, region });
            
            return result;
        } catch (error) {
            paintTiming.finish('error');
            throw error;
        }
    }
    
    // ============ Memory Monitoring ============
    
    startMemoryMonitoring() {
        if (this.samplingInterval) return;
        
        this.globalMetrics.memoryStart = process.memoryUsage();
        
        this.samplingInterval = setInterval(() => {
            this.captureMemorySample();
        }, 5000);
        
        logger.debug('Memory monitoring started');
    }
    
    stopMemoryMonitoring() {
        if (this.samplingInterval) {
            clearInterval(this.samplingInterval);
            this.samplingInterval = null;
            logger.debug('Memory monitoring stopped');
        }
    }
    
    captureMemorySample() {
        const memory = process.memoryUsage();
        
        // Update global metrics
        if (!this.globalMetrics.memoryPeak) {
            this.globalMetrics.memoryPeak = memory;
        } else {
            for (const [key, value] of Object.entries(memory)) {
                if (this.globalMetrics.memoryPeak[key] < value) {
                    this.globalMetrics.memoryPeak[key] = value;
                }
            }
        }
        
        this.memorySamples.push({
            timestamp: Date.now(),
            memory
        });
        
        // Keep last 100 samples
        if (this.memorySamples.length > 100) {
            this.memorySamples.shift();
        }
        
        // Update active profiles
        for (const profile of this.activeProfiles.values()) {
            profile.addMemoryUsage(memory);
        }
    }
    
    // ============ Statistics ============
    
    getGlobalStats() {
        const stats = {
            ...this.globalMetrics,
            activeProfiles: this.activeProfiles.size,
            totalProfiles: this.profiles.size,
            memorySamples: this.memorySamples.length,
            isEnabled: this.isEnabled,
            uptime: Date.now() - this.globalMetrics.startTime,
            memoryCurrent: process.memoryUsage()
        };
        
        // Calculate averages
        if (this.globalMetrics.totalRenders > 0) {
            stats.averageRenderTime = this.globalMetrics.totalRenderTime / this.globalMetrics.totalRenders;
        }
        if (this.globalMetrics.totalLayouts > 0) {
            stats.averageLayoutTime = this.globalMetrics.totalLayoutTime / this.globalMetrics.totalLayouts;
        }
        if (this.globalMetrics.totalPaints > 0) {
            stats.averagePaintTime = this.globalMetrics.totalPaintTime / this.globalMetrics.totalPaints;
        }
        
        return stats;
    }
    
    getWidgetStats(widgetName) {
        const profile = this.getProfile(widgetName);
        if (profile) {
            return profile.getStats();
        }
        return null;
    }
    
    getAllWidgetStats() {
        const stats = {};
        for (const [widgetName, profile] of this.profiles) {
            stats[widgetName] = profile.getStats();
        }
        return stats;
    }
    
    getSlowestWidgets(limit = 10) {
        const widgets = [];
        for (const [widgetName, profile] of this.profiles) {
            if (profile.metrics.totalRenders > 0) {
                widgets.push({
                    name: widgetName,
                    averageRenderTime: profile.metrics.averageRenderTime,
                    totalRenders: profile.metrics.totalRenders,
                    totalRenderTime: profile.metrics.totalRenderTime
                });
            }
        }
        
        widgets.sort((a, b) => b.averageRenderTime - a.averageRenderTime);
        return widgets.slice(0, limit);
    }
    
    getMostRenderedWidgets(limit = 10) {
        const widgets = [];
        for (const [widgetName, profile] of this.profiles) {
            widgets.push({
                name: widgetName,
                renders: profile.metrics.totalRenders,
                averageRenderTime: profile.metrics.averageRenderTime,
                totalRenderTime: profile.metrics.totalRenderTime
            });
        }
        
        widgets.sort((a, b) => b.renders - a.renders);
        return widgets.slice(0, limit);
    }
    
    // ============ Control ============
    
    enable() {
        this.isEnabled = true;
        this.startMemoryMonitoring();
        this.emit('enabled');
        logger.info('Profiler enabled');
    }
    
    disable() {
        this.isEnabled = false;
        this.stopMemoryMonitoring();
        this.emit('disabled');
        logger.info('Profiler disabled');
    }
    
    reset() {
        this.clearProfiles();
        this.globalMetrics = {
            totalRenders: 0,
            totalRenderTime: 0,
            totalLayouts: 0,
            totalLayoutTime: 0,
            totalPaints: 0,
            totalPaintTime: 0,
            startTime: Date.now(),
            widgetCount: 0,
            memoryStart: null,
            memoryPeak: null
        };
        this.memorySamples = [];
        this.emit('reset');
        logger.info('Profiler reset');
    }
    
    // ============ Report ============
    
    generateReport() {
        const globalStats = this.getGlobalStats();
        const slowest = this.getSlowestWidgets();
        const mostRendered = this.getMostRenderedWidgets();
        const allWidgets = this.getAllWidgetStats();
        
        const report = {
            summary: {
                totalWidgets: this.profiles.size,
                activeWidgets: this.activeProfiles.size,
                totalRenders: globalStats.totalRenders,
                totalRenderTime: globalStats.totalRenderTime,
                averageRenderTime: globalStats.averageRenderTime,
                totalLayouts: globalStats.totalLayouts,
                totalLayoutTime: globalStats.totalLayoutTime,
                totalPaints: globalStats.totalPaints,
                totalPaintTime: globalStats.totalPaintTime,
                memoryUsage: globalStats.memoryCurrent
            },
            slowestWidgets: slowest,
            mostRenderedWidgets: mostRendered,
            allWidgets: allWidgets,
            timestamp: new Date().toISOString()
        };
        
        this.emit('reportGenerated', { report });
        return report;
    }
    
    async exportReport() {
        const report = this.generateReport();
        return {
            data: report,
            timestamp: new Date().toISOString()
        };
    }
}

export default RenderProfiler;