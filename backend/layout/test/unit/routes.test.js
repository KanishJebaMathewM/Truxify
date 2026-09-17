import { describe, it, expect, vi, beforeEach } from 'vitest';
import LayoutEngine from '../../LayoutEngine.js';
import LayoutNode from '../../LayoutNode.js';

vi.mock('../../../api/src/middleware/logger.js', () => ({
    default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() }
}));

describe('LayoutEngine', () => {
    let engine;
    let root;

    beforeEach(() => {
        engine = new LayoutEngine();
        root = new LayoutNode({ id: 'root', type: 'container', width: 1000, height: 800 });
        root.measure = vi.fn();
        root.render = vi.fn();
        root.findNodeById = vi.fn((id) => (id === 'root' ? root : null));
        engine.setRoot(root);
    });

    it('should initialize with empty metrics and dirty nodes', () => {
        expect(engine.getDirtyNodes()).toEqual([]);
        expect(engine.getMetrics().totalLayouts).toBe(0);
    });

    it('should processLayout synchronously without throwing', () => {
        engine.addDirtyNode('root');
        expect(() => engine.processLayout()).not.toThrow();
        expect(engine.getDirtyNodes()).toEqual([]);
    });

    it('should return layout tree via getLayoutTree', () => {
        root.serialize = vi.fn(() => ({ id: 'root', children: [] }));
        const tree = engine.getLayoutTree();
        expect(tree).toEqual({ id: 'root', children: [] });
    });

    it('should return metrics via getMetrics', () => {
        const metrics = engine.getMetrics();
        expect(metrics).toHaveProperty('totalLayouts');
        expect(metrics).toHaveProperty('totalMeasures');
    });

    it('should return node stats via getNodeStats', () => {
        root.findNodeById.mockReturnValue({
            id: 'test', type: 'container', size: { width: 100, height: 100 }, position: { x: 0, y: 0 }
        });
        const stats = engine.getNodeStats('test');
        expect(stats).toEqual({
            id: 'test',
            type: 'container',
            width: 100,
            height: 100,
            x: 0,
            y: 0,
            isDirty: false
        });
    });

    it('should process batch updates', () => {
        const child = {
            id: 'child', size: { width: 50, height: 50 }, position: { x: 0, y: 0 },
            markDirty: vi.fn()
        };
        root.findNodeById.mockReturnValue(child);

        const processed = engine.batchUpdate([{ nodeId: 'child', changes: { size: { width: 60 } } }]);

        expect(processed.has('child')).toBe(true);
        expect(child.markDirty).toHaveBeenCalled();
    });
});
