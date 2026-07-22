import express from 'express';
import PluginManager from './PluginManager.js';
import logger from '../../api/src/middleware/logger.js';

const router = express.Router();

// Initialize plugin manager
const pluginManager = new PluginManager();

// Register some example widgets
pluginManager.registerWidget({
    name: 'KanbanBoard',
    version: '1.0.0',
    description: 'Kanban board widget for logistics tracking',
    author: 'Truxify Team',
    render: (props) => {
        return {
            type: 'kanban',
            columns: props.columns || ['To Do', 'In Progress', 'Done'],
            cards: props.cards || [],
            title: props.title || 'Kanban Board'
        };
    },
    props: {
        title: 'Kanban Board',
        columns: ['To Do', 'In Progress', 'Done'],
        cards: []
    },
    hooks: {
        onCardMove: (card, fromColumn, toColumn) => {
            logger.info(`Card moved: ${card.id} ${fromColumn} -> ${toColumn}`);
        }
    },
    lifecycle: {
        init: async (plugin) => {
            logger.info(`KanbanBoard plugin initialized`);
        },
        destroy: async (plugin) => {
            logger.info(`KanbanBoard plugin destroyed`);
        }
    }
});

pluginManager.registerWidget({
    name: 'DataChart',
    version: '1.0.0',
    description: 'Real-time data chart widget',
    author: 'Truxify Team',
    render: (props) => {
        return {
            type: 'chart',
            chartType: props.chartType || 'line',
            data: props.data || [],
            labels: props.labels || [],
            title: props.title || 'Data Chart'
        };
    },
    props: {
        chartType: 'line',
        data: [],
        labels: [],
        title: 'Data Chart'
    }
});

pluginManager.registerWidget({
    name: 'NotificationCenter',
    version: '1.0.0',
    description: 'Real-time notification center',
    author: 'Truxify Team',
    render: (props) => {
        return {
            type: 'notifications',
            notifications: props.notifications || [],
            maxDisplay: props.maxDisplay || 5,
            title: props.title || 'Notifications'
        };
    },
    props: {
        notifications: [],
        maxDisplay: 5,
        title: 'Notifications'
    },
    hooks: {
        onNotification: (notification) => {
            logger.info(`New notification: ${notification.message}`);
        }
    }
});

// ============ Routes ============

// Register widget
router.post('/plugins/widget/register', (req, res) => {
    try {
        const config = req.body;
        if (!config.name) {
            return res.status(400).json({
                success: false,
                error: 'Widget name required'
            });
        }
        
        const success = pluginManager.registerWidget(config);
        res.json({
            success,
            data: { name: config.name, registered: success },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Register widget error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Register renderer
router.post('/plugins/renderer/register', (req, res) => {
    try {
        const config = req.body;
        if (!config.name) {
            return res.status(400).json({
                success: false,
                error: 'Renderer name required'
            });
        }
        
        const success = pluginManager.registerRenderer(config);
        res.json({
            success,
            data: { name: config.name, registered: success },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Register renderer error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Register theme
router.post('/plugins/theme/register', (req, res) => {
    try {
        const config = req.body;
        if (!config.name) {
            return res.status(400).json({
                success: false,
                error: 'Theme name required'
            });
        }
        
        const success = pluginManager.registerTheme(config);
        res.json({
            success,
            data: { name: config.name, registered: success },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Register theme error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Register extension
router.post('/plugins/extension/register', (req, res) => {
    try {
        const config = req.body;
        if (!config.name) {
            return res.status(400).json({
                success: false,
                error: 'Extension name required'
            });
        }
        
        const success = pluginManager.registerExtension(config);
        res.json({
            success,
            data: { name: config.name, registered: success },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Register extension error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Initialize plugin
router.post('/plugins/:name/init', async (req, res) => {
    try {
        const { name } = req.params;
        const success = await pluginManager.initializePlugin(name);
        
        res.json({
            success,
            data: { name, initialized: success },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Initialize plugin error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Initialize all plugins
router.post('/plugins/init-all', async (req, res) => {
    try {
        const results = await pluginManager.initializeAll();
        res.json({
            success: true,
            data: results,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Initialize all error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Destroy plugin
router.post('/plugins/:name/destroy', async (req, res) => {
    try {
        const { name } = req.params;
        const success = await pluginManager.destroyPlugin(name);
        
        res.json({
            success,
            data: { name, destroyed: success },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Destroy plugin error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Destroy all plugins
router.post('/plugins/destroy-all', async (req, res) => {
    try {
        const results = await pluginManager.destroyAll();
        res.json({
            success: true,
            data: results,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Destroy all error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Unregister plugin
router.delete('/plugins/:name', (req, res) => {
    try {
        const { name } = req.params;
        const success = pluginManager.unregister(name);
        
        res.json({
            success,
            data: { name, unregistered: success },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Unregister plugin error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get plugin
router.get('/plugins/:name', (req, res) => {
    try {
        const { name } = req.params;
        const plugin = pluginManager.getPlugin(name);
        
        if (!plugin) {
            return res.status(404).json({
                success: false,
                error: 'Plugin not found'
            });
        }
        
        res.json({
            success: true,
            data: {
                name: plugin.name,
                version: plugin.version,
                description: plugin.description,
                author: plugin.author,
                category: plugin.category,
                isActive: plugin.isActive,
                props: plugin.props,
                metadata: plugin.metadata,
                dependencies: plugin.dependencies,
                registeredAt: plugin.registeredAt
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Get plugin error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get widgets
router.get('/plugins/widgets', (req, res) => {
    try {
        const widgets = pluginManager.getWidgets();
        res.json({
            success: true,
            data: widgets.map(w => ({
                name: w.name,
                version: w.version,
                description: w.description,
                isActive: w.isActive,
                props: w.props
            })),
            count: widgets.length,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Get widgets error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Render widget
router.post('/plugins/widget/:name/render', (req, res) => {
    try {
        const { name } = req.params;
        const props = req.body;
        
        const result = pluginManager.renderWidget(name, props);
        
        if (result === null) {
            return res.status(404).json({
                success: false,
                error: 'Widget not found or inactive'
            });
        }
        
        res.json({
            success: true,
            data: result,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Render widget error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Execute hook
router.post('/plugins/hook/:hookName', async (req, res) => {
    try {
        const { hookName } = req.params;
        const args = req.body.args || [];
        
        const results = await pluginManager.executeHook(hookName, ...args);
        
        res.json({
            success: true,
            data: results,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Execute hook error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get hooks
router.get('/plugins/hooks', (req, res) => {
    try {
        const hooks = pluginManager.getHooks();
        res.json({
            success: true,
            data: hooks,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Get hooks error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get stats
router.get('/plugins/stats', (req, res) => {
    try {
        const stats = pluginManager.getStats();
        res.json({
            success: true,
            data: stats,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Stats error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

export default router;