import eventBus from './events/index.js';

/**
 * Backward-compatible re-export.
 * All existing `import { eventBus } from '../core/events.js'` paths continue to work.
 * New code should import from './events/index.js' instead.
 */
export { eventBus };
