import { EventEmitter } from 'events';
import crypto from 'crypto';
import logger from '../api/src/middleware/logger.js';

class LayoutNode extends EventEmitter {
    constructor(config = {}) {
        super();

        // ============ Node Properties ============

        this.id =
            config.id ||
            `node_${crypto.randomBytes(8).toString('hex')}`;

        this.type = config.type ?? 'container';
        this.parent = config.parent ?? null;
        this.children = [];

        // ============ Layout Properties ============

        this.position = {
            x: Number.isFinite(config.x) ? config.x : 0,
            y: Number.isFinite(config.y) ? config.y : 0
        };

        this.size = {
            width: Number.isFinite(config.width) ? config.width : 0,
            height: Number.isFinite(config.height) ? config.height : 0
        };

        this.margin = {
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            ...(config.margin || {})
        };

        this.padding = {
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            ...(config.padding || {})
        };

        // ============ Dirty Flags ============

        this.isDirty = false;
        this.isPositionDirty = false;
        this.isSizeDirty = false;
        this.isChildrenDirty = false;

        // ============ Cached Measurements ============

        this.cachedLayout = null;
        this.cachedSize = null;
        this.cachedPosition = null;
        this.cacheVersion = 0;

        // ============ Render Flags ============

        this.needsRender = false;
        this.needsMeasure = false;
        this.needsLayout = false;

        // ============ Child Tracking ============

        this.childOrder = [];
        this.childMap = new Map();

        // Keep references to listeners so they can be removed safely.
        this.childListeners = new Map();

        // ============ Statistics ============

        this.layoutCount = 0;
        this.measureCount = 0;
        this.renderCount = 0;

        logger.debug(`LayoutNode created: ${this.id}`);
    }

    // ============================================================
    // DIRTY MANAGEMENT
    // ============================================================

    markDirty(flags = {}) {
        this.isDirty = true;
        this.needsLayout = true;
        this.needsMeasure = true;
        this.needsRender = true;

        if (flags.position) {
            this.isPositionDirty = true;
        }

        if (flags.size) {
            this.isSizeDirty = true;
        }

        if (flags.children) {
            this.isChildrenDirty = true;
        }

        this.cacheVersion++;

        this.emit('dirty', {
            nodeId: this.id,
            flags
        });

        logger.debug(`Node ${this.id} marked dirty`, flags);
    }

    markClean() {
        this.isDirty = false;
        this.isPositionDirty = false;
        this.isSizeDirty = false;
        this.isChildrenDirty = false;

        this.needsLayout = false;
        this.needsMeasure = false;

        this.emit('clean', {
            nodeId: this.id
        });

        logger.debug(`Node ${this.id} marked clean`);
    }

    invalidateBranch() {
        this.markDirty({
            position: true,
            size: true,
            children: true
        });

        for (const child of this.children) {
            child.invalidateBranch();
        }
    }

    // ============================================================
    // CHILD MANAGEMENT
    // ============================================================

    addChild(child) {
        if (!child || typeof child.id !== 'string') {
            throw new TypeError(
                'addChild expects a valid LayoutNode'
            );
        }

        if (child === this) {
            throw new Error(
                'A LayoutNode cannot be added as its own child'
            );
        }

        if (this.childMap.has(child.id)) {
            logger.warn(
                `Child ${child.id} already exists in node ${this.id}`
            );

            return false;
        }

        // Prevent circular hierarchy.
        let ancestor = this;

        while (ancestor) {
            if (ancestor === child) {
                throw new Error(
                    'Cannot create a circular layout hierarchy'
                );
            }

            ancestor = ancestor.parent;
        }

        // Detach from previous parent first.
        if (child.parent && child.parent !== this) {
            child.parent.removeChild(child.id);
        }

        child.parent = this;

        this.children.push(child);
        this.childOrder.push(child.id);
        this.childMap.set(child.id, child);

        // Store the listener so it can be removed later.
        const dirtyListener = () => {
            this.markDirty({
                children: true
            });
        };

        child.on('dirty', dirtyListener);

        this.childListeners.set(
            child.id,
            dirtyListener
        );

        this.markDirty({
            children: true
        });

        this.emit('childAdded', {
            parent: this.id,
            child: child.id
        });

        logger.debug(
            `Child ${child.id} added to ${this.id}`
        );

        return true;
    }

    removeChild(childId) {
        const index = this.children.findIndex(
            child => child.id === childId
        );

        if (index === -1) {
            logger.warn(
                `Child ${childId} not found in node ${this.id}`
            );

            return false;
        }

        const child = this.children[index];

        // Remove dirty listener to avoid memory leaks.
        const listener = this.childListeners.get(
            childId
        );

        if (listener) {
            child.removeListener(
                'dirty',
                listener
            );

            this.childListeners.delete(childId);
        }

        this.children.splice(index, 1);

        this.childOrder = this.childOrder.filter(
            id => id !== childId
        );

        this.childMap.delete(childId);

        child.parent = null;

        this.markDirty({
            children: true
        });

        this.emit('childRemoved', {
            parent: this.id,
            child: childId
        });

        logger.debug(
            `Child ${childId} removed from ${this.id}`
        );

        return true;
    }

    getChild(childId) {
        return this.childMap.get(childId) || null;
    }

    getChildren() {
        return [...this.children];
    }

    getChildCount() {
        return this.children.length;
    }

    // ============================================================
    // LAYOUT COMPUTATION
    // ============================================================

    computeLayout(force = false) {
        if (
            !force &&
            !this.needsLayout &&
            this.cachedLayout
        ) {
            return this.cachedLayout;
        }

        this.layoutCount++;

        const startTime = Date.now();

        // Make sure children are laid out first.
        for (const child of this.children) {
            if (force || child.needsLayout) {
                child.computeLayout(force);
            }
        }

        const contentWidth =
            Math.max(0, this.size.width) -
            this.padding.left -
            this.padding.right;

        const contentHeight =
            Math.max(0, this.size.height) -
            this.padding.top -
            this.padding.bottom;

        let cursorX = this.position.x + this.padding.left;
        let cursorY = this.position.y + this.padding.top;

        let totalWidth = 0;
        let totalHeight = 0;

        let maxChildWidth = 0;
        let maxChildHeight = 0;

        // --------------------------------------------------------
        // ROW LAYOUT
        // --------------------------------------------------------

        if (this.type === 'row') {
            for (const child of this.children) {
                const childWidth = Math.max(
                    0,
                    child.size.width
                );

                const childHeight = Math.max(
                    0,
                    child.size.height
                );

                const marginLeft =
                    Number(child.margin.left) || 0;

                const marginRight =
                    Number(child.margin.right) || 0;

                const marginTop =
                    Number(child.margin.top) || 0;

                const marginBottom =
                    Number(child.margin.bottom) || 0;

                const outerWidth =
                    childWidth +
                    marginLeft +
                    marginRight;

                const availableHeight =
                    contentHeight -
                    marginTop -
                    marginBottom;

                child.position.x =
                    cursorX + marginLeft;

                child.position.y =
                    this.position.y +
                    this.padding.top +
                    marginTop +
                    Math.max(
                        0,
                        (availableHeight - childHeight) / 2
                    );

                cursorX += outerWidth;

                totalWidth += outerWidth;

                maxChildHeight = Math.max(
                    maxChildHeight,
                    childHeight +
                    marginTop +
                    marginBottom
                );
            }

            totalHeight = maxChildHeight;
        }

        // --------------------------------------------------------
        // COLUMN LAYOUT
        // --------------------------------------------------------

        else if (this.type === 'column') {
            for (const child of this.children) {
                const childWidth = Math.max(
                    0,
                    child.size.width
                );

                const childHeight = Math.max(
                    0,
                    child.size.height
                );

                const marginLeft =
                    Number(child.margin.left) || 0;

                const marginRight =
                    Number(child.margin.right) || 0;

                const marginTop =
                    Number(child.margin.top) || 0;

                const marginBottom =
                    Number(child.margin.bottom) || 0;

                const outerHeight =
                    childHeight +
                    marginTop +
                    marginBottom;

                const availableWidth =
                    contentWidth -
                    marginLeft -
                    marginRight;

                child.position.x =
                    this.position.x +
                    this.padding.left +
                    marginLeft +
                    Math.max(
                        0,
                        (availableWidth - childWidth) / 2
                    );

                child.position.y =
                    cursorY + marginTop;

                cursorY += outerHeight;

                totalHeight += outerHeight;

                maxChildWidth = Math.max(
                    maxChildWidth,
                    childWidth +
                    marginLeft +
                    marginRight
                );
            }

            totalWidth = maxChildWidth;
        }

        // --------------------------------------------------------
        // CONTAINER / ABSOLUTE-LIKE LAYOUT
        // --------------------------------------------------------

        else {
            for (const child of this.children) {
                const childWidth = Math.max(
                    0,
                    child.size.width
                );

                const childHeight = Math.max(
                    0,
                    child.size.height
                );

                const marginLeft =
                    Number(child.margin.left) || 0;

                const marginTop =
                    Number(child.margin.top) || 0;

                const marginRight =
                    Number(child.margin.right) || 0;

                const marginBottom =
                    Number(child.margin.bottom) || 0;

                child.position.x =
                    this.position.x +
                    this.padding.left +
                    marginLeft;

                child.position.y =
                    this.position.y +
                    this.padding.top +
                    marginTop;

                totalWidth = Math.max(
                    totalWidth,
                    childWidth +
                    marginLeft +
                    marginRight
                );

                totalHeight = Math.max(
                    totalHeight,
                    childHeight +
                    marginTop +
                    marginBottom
                );
            }
        }

        // --------------------------------------------------------
        // AUTO SIZE
        // --------------------------------------------------------

        if (
            this.size.width === 0 &&
            this.type !== 'fixed'
        ) {
            this.size.width =
                totalWidth +
                this.padding.left +
                this.padding.right;
        }

        if (
            this.size.height === 0 &&
            this.type !== 'fixed'
        ) {
            this.size.height =
                totalHeight +
                this.padding.top +
                this.padding.bottom;
        }

        // Cache current position separately.
        this.cachedPosition = {
            x: this.position.x,
            y: this.position.y
        };

        // Cache current size.
        this.cachedSize = {
            width: this.size.width,
            height: this.size.height
        };

        // Cache the final layout AFTER all calculations.
        this.cachedLayout = {
            position: {
                x: this.position.x,
                y: this.position.y
            },
            size: {
                width: this.size.width,
                height: this.size.height
            },
            children: this.children.map(child => ({
                id: child.id,
                position: {
                    x: child.position.x,
                    y: child.position.y
                },
                size: {
                    width: child.size.width,
                    height: child.size.height
                }
            })),
            version: this.cacheVersion
        };

        this.markClean();

        const duration =
            Date.now() - startTime;

        this.emit('layoutComputed', {
            nodeId: this.id,
            duration
        });

        logger.debug(
            `Layout computed for ${this.id} in ${duration}ms`
        );

        return this.cachedLayout;
    }

    // ============================================================
    // MEASUREMENT
    // ============================================================

    measure(force = false) {
        if (
            !force &&
            !this.needsMeasure &&
            this.cachedSize
        ) {
            return this.cachedSize;
        }

        this.measureCount++;

        const startTime = Date.now();

        let measuredWidth =
            Math.max(0, this.size.width);

        let measuredHeight =
            Math.max(0, this.size.height);

        let childrenWidth = 0;
        let childrenHeight = 0;

        for (const child of this.children) {
            const childSize =
                child.measure(force);

            const outerWidth =
                childSize.width +
                (Number(child.margin.left) || 0) +
                (Number(child.margin.right) || 0);

            const outerHeight =
                childSize.height +
                (Number(child.margin.top) || 0) +
                (Number(child.margin.bottom) || 0);

            if (this.type === 'row') {
                childrenWidth += outerWidth;
                childrenHeight = Math.max(
                    childrenHeight,
                    outerHeight
                );
            } else if (this.type === 'column') {
                childrenHeight += outerHeight;
                childrenWidth = Math.max(
                    childrenWidth,
                    outerWidth
                );
            } else {
                childrenWidth = Math.max(
                    childrenWidth,
                    outerWidth
                );

                childrenHeight = Math.max(
                    childrenHeight,
                    outerHeight
                );
            }
        }

        if (
            this.size.width === 0 &&
            this.type !== 'fixed'
        ) {
            measuredWidth =
                childrenWidth +
                this.padding.left +
                this.padding.right;
        }

        if (
            this.size.height === 0 &&
            this.type !== 'fixed'
        ) {
            measuredHeight =
                childrenHeight +
                this.padding.top +
                this.padding.bottom;
        }

        this.cachedSize = {
            width: measuredWidth,
            height: measuredHeight
        };

        this.cachedPosition = {
            x: this.position.x,
            y: this.position.y
        };

        this.needsMeasure = false;

        const duration =
            Date.now() - startTime;

        this.emit('measured', {
            nodeId: this.id,
            duration
        });

        logger.debug(
            `Node ${this.id} measured in ${duration}ms`
        );

        return this.cachedSize;
    }

    // ============================================================
    // RENDER
    // ============================================================

    render(context = {}) {
        const force = Boolean(context.force);

        if (
            !force &&
            !this.needsRender &&
            this.cachedLayout
        ) {
            return this.cachedLayout;
        }

        this.renderCount++;

        const startTime = Date.now();

        // Make sure measurement happens first.
        this.measure(force);

        // Compute layout.
        this.computeLayout(force);

        // Render children.
        for (const child of this.children) {
            child.render(context);
        }

        this.needsRender = false;

        const duration =
            Date.now() - startTime;

        this.emit('rendered', {
            nodeId: this.id,
            duration
        });

        logger.debug(
            `Node ${this.id} rendered in ${duration}ms`
        );

        return this.cachedLayout;
    }

    // ============================================================
    // CACHE MANAGEMENT
    // ============================================================

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

        this.cacheVersion++;

        this.markDirty({
            position: true,
            size: true,
            children: true
        });
    }

    // ============================================================
    // STATUS
    // ============================================================

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

    // ============================================================
    // TREE OPERATIONS
    // ============================================================

    findNodeById(id) {
        if (this.id === id) {
            return this;
        }

        for (const child of this.children) {
            const result = child.findNodeById(id);

            if (result) {
                return result;
            }
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

    // ============================================================
    // CLEANUP
    // ============================================================

    destroy() {
        // Remove listeners registered on children.
        for (const child of this.children) {
            const listener =
                this.childListeners.get(child.id);

            if (listener) {
                child.removeListener(
                    'dirty',
                    listener
                );
            }

            child.parent = null;
        }

        this.childListeners.clear();
        this.childMap.clear();
        this.childOrder = [];
        this.children = [];

        this.parent = null;

        this.removeAllListeners();

        this.cachedLayout = null;
        this.cachedSize = null;
        this.cachedPosition = null;

        logger.debug(
            `LayoutNode destroyed: ${this.id}`
        );
    }
}

export default LayoutNode;
