import FrameBuffer from './FrameBuffer.js';
import logger from '../../api/src/middleware/logger.js';

class DirtyRenderer {
    constructor(width = 80, height = 24) {
        this.width = width;
        this.height = height;
        this.currentFrame = new FrameBuffer(width, height);
        this.previousFrame = new FrameBuffer(width, height);
        this.dirtyRects = [];
        this.outputQueue = [];
        this.isEnabled = true;
        
        // Statistics
        this.stats = {
            frames: 0,
            dirtyFrames: 0,
            fullFrames: 0,
            totalCharsWritten: 0,
            totalRects: 0,
            avgRectsPerFrame: 0
        };
        
        logger.info(`✅ DirtyRenderer initialized: ${width}x${height}`);
    }
    
    setPixel(x, y, char, fg = null, bg = null, style = null) {
        if (!this.isEnabled) {
            this.currentFrame.setPixel(x, y, char, fg, bg, style);
            return true;
        }
        
        const changed = this.currentFrame.setPixel(x, y, char, fg, bg, style);
        if (changed) {
            this.markDirty(x, y, 1, 1);
        }
        return changed;
    }
    
    setRow(y, rowData) {
        if (!this.isEnabled) {
            this.currentFrame.setRow(y, rowData);
            return true;
        }
        
        const changed = this.currentFrame.setRow(y, rowData);
        if (changed) {
            this.markDirty(0, y, this.width, 1);
        }
        return changed;
    }
    
    setRegion(x, y, width, height, data) {
        if (!this.isEnabled) {
            this.currentFrame.setRegion(x, y, width, height, data);
            return true;
        }
        
        const changed = this.currentFrame.setRegion(x, y, width, height, data);
        if (changed) {
            this.markDirty(x, y, width, height);
        }
        return changed;
    }
    
    markDirty(x, y, width, height) {
        // Ensure coordinates are within bounds
        x = Math.max(0, x);
        y = Math.max(0, y);
        width = Math.min(width, this.width - x);
        height = Math.min(height, this.height - y);
        
        if (width <= 0 || height <= 0) return;
        
        // Add to dirty rects
        const rect = { x, y, width, height };
        this.dirtyRects.push(rect);
    }
    
    clear(character = ' ') {
        const changed = this.currentFrame.clear(character);
        if (changed) {
            this.markDirty(0, 0, this.width, this.height);
        }
        return changed;
    }
    
    fill(character, fg = null, bg = null, style = null) {
        const changed = this.currentFrame.fill(character, fg, bg, style);
        if (changed) {
            this.markDirty(0, 0, this.width, this.height);
        }
        return changed;
    }
    
    render() {
        this.stats.frames++;
        
        // Merge dirty rects
        const mergedRects = this.mergeDirtyRects();
        
        // Generate output
        let output = '';
        let totalChars = 0;
        
        if (mergedRects.length === 0) {
            // No changes
            return output;
        }
        
        if (this.shouldFullRender()) {
            // Full render
            output = this.renderFullFrame();
            this.stats.fullFrames++;
            totalChars = output.length;
        } else {
            // Partial render (dirty rects only)
            output = this.renderDirtyRects(mergedRects);
            this.stats.dirtyFrames++;
            totalChars = output.length;
        }
        
        // Update stats
        this.stats.totalCharsWritten += totalChars;
        this.stats.totalRects += mergedRects.length;
        this.stats.avgRectsPerFrame = this.stats.totalRects / this.stats.frames;
        
        // Store current frame as previous
        this.previousFrame = this.currentFrame.clone();
        
        // Clear dirty rects
        this.dirtyRects = [];
        this.currentFrame.clearDirtyRects();
        
        return output;
    }
    
    shouldFullRender() {
        // Full render if:
        // - First frame
        if (this.stats.frames === 0) return true;
        
        // - Too many dirty rects (> 20)
        if (this.dirtyRects.length > 20) return true;
        
        // - Dirty rects cover > 50% of screen
        let totalArea = 0;
        for (const rect of this.dirtyRects) {
            totalArea += rect.width * rect.height;
        }
        const screenArea = this.width * this.height;
        if (totalArea > screenArea * 0.5) return true;
        
        return false;
    }
    
    mergeDirtyRects() {
        if (this.dirtyRects.length === 0) return [];
        
        let rects = [...this.dirtyRects];
        let merged = true;
        
        while (merged) {
            merged = false;
            const newRects = [];
            
            for (let i = 0; i < rects.length; i++) {
                let mergedRect = rects[i];
                let hasMerged = false;
                
                for (let j = i + 1; j < rects.length; j++) {
                    if (this.rectsOverlap(mergedRect, rects[j])) {
                        mergedRect = this.mergeRects(mergedRect, rects[j]);
                        hasMerged = true;
                        merged = true;
                        break;
                    }
                }
                
                if (!hasMerged) {
                    newRects.push(mergedRect);
                } else {
                    // Re-check from start
                    break;
                }
            }
            
            if (merged) {
                rects = newRects;
            }
        }
        
        // Limit number of rects
        if (rects.length > 20) {
            // Combine all rects into one
            const combined = this.combineRects(rects);
            return [combined];
        }
        
        return rects;
    }
    
    rectsOverlap(a, b) {
        return !(a.x + a.width <= b.x || b.x + b.width <= a.x ||
                 a.y + a.height <= b.y || b.y + b.height <= a.y);
    }
    
    mergeRects(a, b) {
        return {
            x: Math.min(a.x, b.x),
            y: Math.min(a.y, b.y),
            width: Math.max(a.x + a.width, b.x + b.width) - Math.min(a.x, b.x),
            height: Math.max(a.y + a.height, b.y + b.height) - Math.min(a.y, b.y)
        };
    }
    
    combineRects(rects) {
        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;
        
        for (const rect of rects) {
            minX = Math.min(minX, rect.x);
            minY = Math.min(minY, rect.y);
            maxX = Math.max(maxX, rect.x + rect.width);
            maxY = Math.max(maxY, rect.y + rect.height);
        }
        
        return {
            x: minX,
            y: minY,
            width: maxX - minX,
            height: maxY - minY
        };
    }
    
    renderFullFrame() {
        let output = '';
        
        // Move cursor to home position
        output += '\x1b[H';
        
        // Render entire frame
        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
                const pixel = this.currentFrame.getPixel(x, y);
                if (pixel) {
                    output += this.getAnsiSequence(pixel);
                    output += pixel.char;
                }
            }
            if (y < this.height - 1) {
                output += '\n';
            }
        }
        
        return output;
    }
    
    renderDirtyRects(rects) {
        let output = '';
        
        for (const rect of rects) {
            output += this.renderRect(rect);
        }
        
        return output;
    }
    
    renderRect(rect) {
        let output = '';
        
        // Move cursor to rect position
        output += `\x1b[${rect.y + 1};${rect.x + 1}H`;
        
        // Render rect content
        for (let y = rect.y; y < rect.y + rect.height; y++) {
            if (y > rect.y) {
                output += '\x1b[1B'; // Move down one line
                output += `\x1b[${rect.x + 1}G`; // Move to rect start
            }
            
            for (let x = rect.x; x < rect.x + rect.width; x++) {
                const pixel = this.currentFrame.getPixel(x, y);
                if (pixel) {
                    // Check if pixel changed from previous frame
                    const prevPixel = this.previousFrame.getPixel(x, y);
                    if (!prevPixel || prevPixel.char !== pixel.char || 
                        prevPixel.fg !== pixel.fg || prevPixel.bg !== pixel.bg || 
                        prevPixel.style !== pixel.style) {
                        output += this.getAnsiSequence(pixel);
                        output += pixel.char;
                    } else {
                        // Skip unchanged pixel
                    }
                }
            }
        }
        
        return output;
    }
    
    getAnsiSequence(pixel) {
        let seq = '';
        
        // Foreground color
        if (pixel.fg !== null) {
            if (typeof pixel.fg === 'number') {
                seq += `\x1b[38;5;${pixel.fg}m`;
            } else {
                seq += `\x1b[${pixel.fg}m`;
            }
        }
        
        // Background color
        if (pixel.bg !== null) {
            if (typeof pixel.bg === 'number') {
                seq += `\x1b[48;5;${pixel.bg}m`;
            } else {
                seq += `\x1b[${pixel.bg}m`;
            }
        }
        
        // Style
        if (pixel.style !== null) {
            seq += `\x1b[${pixel.style}m`;
        }
        
        return seq;
    }
    
    getStats() {
        return {
            ...this.stats,
            width: this.width,
            height: this.height,
            dirtyRects: this.dirtyRects.length,
            currentFrameVersion: this.currentFrame.version,
            previousFrameVersion: this.previousFrame.version,
            efficiency: this.stats.dirtyFrames / this.stats.frames * 100 || 0,
            avgCharsPerFrame: this.stats.totalCharsWritten / this.stats.frames || 0
        };
    }
    
    resize(width, height) {
        this.width = width;
        this.height = height;
        this.currentFrame = new FrameBuffer(width, height);
        this.previousFrame = new FrameBuffer(width, height);
        this.dirtyRects = [];
        
        logger.info(`Renderer resized: ${width}x${height}`);
    }
    
    enable() {
        this.isEnabled = true;
        logger.info('Renderer enabled');
    }
    
    disable() {
        this.isEnabled = false;
        logger.info('Renderer disabled');
    }
}

export default DirtyRenderer;