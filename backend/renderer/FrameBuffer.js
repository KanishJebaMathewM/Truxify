import logger from '../../api/src/middleware/logger.js';

class FrameBuffer {
    constructor(width = 80, height = 24) {
        this.width = width;
        this.height = height;
        this.buffer = this.createBuffer(width, height);
        this.dirtyRects = [];
        this.version = 0;
        
        logger.debug(`✅ FrameBuffer created: ${width}x${height}`);
    }
    
    createBuffer(width, height) {
        const buffer = [];
        for (let y = 0; y < height; y++) {
            const row = [];
            for (let x = 0; x < width; x++) {
                row.push({
                    char: ' ',
                    fg: null,
                    bg: null,
                    style: null
                });
            }
            buffer.push(row);
        }
        return buffer;
    }
    
    setPixel(x, y, char, fg = null, bg = null, style = null) {
        if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
            return false;
        }
        
        const pixel = this.buffer[y][x];
        let changed = false;
        
        if (pixel.char !== char) {
            pixel.char = char;
            changed = true;
        }
        if (pixel.fg !== fg) {
            pixel.fg = fg;
            changed = true;
        }
        if (pixel.bg !== bg) {
            pixel.bg = bg;
            changed = true;
        }
        if (pixel.style !== style) {
            pixel.style = style;
            changed = true;
        }
        
        if (changed) {
            this.addDirtyRect(x, y, 1, 1);
            this.version++;
        }
        
        return changed;
    }
    
    setRow(y, rowData) {
        if (y < 0 || y >= this.height) return false;
        
        let changed = false;
        for (let x = 0; x < Math.min(rowData.length, this.width); x++) {
            const data = typeof rowData[x] === 'string' ? { char: rowData[x] } : rowData[x];
            if (this.setPixel(x, y, data.char, data.fg, data.bg, data.style)) {
                changed = true;
            }
        }
        return changed;
    }
    
    setRegion(x, y, width, height, data) {
        let changed = false;
        for (let row = 0; row < height; row++) {
            for (let col = 0; col < width; col++) {
                const rowData = data[row] ? data[row][col] : null;
                if (rowData) {
                    const char = typeof rowData === 'string' ? rowData : rowData.char;
                    if (this.setPixel(x + col, y + row, char, rowData.fg, rowData.bg, rowData.style)) {
                        changed = true;
                    }
                }
            }
        }
        return changed;
    }
    
    addDirtyRect(x, y, width, height) {
        const rect = { x, y, width, height };
        
        // Merge with existing rects
        let merged = false;
        for (const existing of this.dirtyRects) {
            if (this.rectsOverlap(existing, rect)) {
                this.mergeRects(existing, rect);
                merged = true;
                break;
            }
        }
        
        if (!merged) {
            this.dirtyRects.push(rect);
        }
    }
    
    rectsOverlap(a, b) {
        return !(a.x + a.width <= b.x || b.x + b.width <= a.x ||
                 a.y + a.height <= b.y || b.y + b.height <= a.y);
    }
    
    mergeRects(a, b) {
        a.x = Math.min(a.x, b.x);
        a.y = Math.min(a.y, b.y);
        a.width = Math.max(a.x + a.width, b.x + b.width) - a.x;
        a.height = Math.max(a.y + a.height, b.y + b.height) - a.y;
    }
    
    getDirtyRects() {
        return this.dirtyRects;
    }
    
    clearDirtyRects() {
        this.dirtyRects = [];
    }
    
    getPixel(x, y) {
        if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
            return null;
        }
        return this.buffer[y][x];
    }
    
    getRow(y) {
        if (y < 0 || y >= this.height) return null;
        return this.buffer[y];
    }
    
    getRegion(x, y, width, height) {
        const region = [];
        for (let row = y; row < Math.min(y + height, this.height); row++) {
            const rowData = [];
            for (let col = x; col < Math.min(x + width, this.width); col++) {
                rowData.push(this.buffer[row][col]);
            }
            region.push(rowData);
        }
        return region;
    }
    
    clear(character = ' ') {
        let changed = false;
        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
                if (this.buffer[y][x].char !== character) {
                    this.buffer[y][x].char = character;
                    changed = true;
                }
                this.buffer[y][x].fg = null;
                this.buffer[y][x].bg = null;
                this.buffer[y][x].style = null;
            }
        }
        
        if (changed) {
            this.addDirtyRect(0, 0, this.width, this.height);
            this.version++;
        }
        
        return changed;
    }
    
    fill(character, fg = null, bg = null, style = null) {
        let changed = false;
        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
                const pixel = this.buffer[y][x];
                if (pixel.char !== character || pixel.fg !== fg || pixel.bg !== bg || pixel.style !== style) {
                    pixel.char = character;
                    pixel.fg = fg;
                    pixel.bg = bg;
                    pixel.style = style;
                    changed = true;
                }
            }
        }
        
        if (changed) {
            this.addDirtyRect(0, 0, this.width, this.height);
            this.version++;
        }
        
        return changed;
    }
    
    diff(other) {
        const differences = [];
        const maxWidth = Math.max(this.width, other.width);
        const maxHeight = Math.max(this.height, other.height);
        
        for (let y = 0; y < maxHeight; y++) {
            for (let x = 0; x < maxWidth; x++) {
                const a = this.getPixel(x, y);
                const b = other.getPixel(x, y);
                
                if (!a || !b || a.char !== b.char || a.fg !== b.fg || a.bg !== b.bg || a.style !== b.style) {
                    differences.push({ x, y, a, b });
                }
            }
        }
        
        return differences;
    }
    
    clone() {
        const clone = new FrameBuffer(this.width, this.height);
        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
                const pixel = this.buffer[y][x];
                clone.buffer[y][x] = { ...pixel };
            }
        }
        clone.version = this.version;
        return clone;
    }
    
    getStats() {
        return {
            width: this.width,
            height: this.height,
            totalPixels: this.width * this.height,
            dirtyRects: this.dirtyRects.length,
            version: this.version
        };
    }
}

export default FrameBuffer;