import { EventEmitter } from 'events';
import logger from '../../api/src/middleware/logger.js';

class WidgetPlugin {
    constructor(config) {
        this.name = config.name;
        this.version = config.version || '1.0.0';
        this.description = config.description || '';
        this.author = config.author || '';
        this.render = config.render || null;
        this.metadata = config.metadata || {};
        this.props = config.props || {};
        this.hooks = config.hooks || {};
        this.lifecycle = config.lifecycle || {};
        this.dependencies = config.dependencies || [];
        this.entryPoint = config.entryPoint || null;
        this.styles = config.styles || null;
        this.registeredAt = Date.now();
        this.isActive = true;
        this.instance = null;
    }
    
    async initialize() {
        if (this.lifecycle.init) {
            await this.lifecycle.init(this);
        }
        this.instance = this;
        return this;
    }
    
    async destroy() {
        if (this.lifecycle.destroy) {
            await this.lifecycle.destroy(this);
        }
        this.isActive = false;
        this.instance = null;
        return this;
    }
    
    render(props = {}) {
        if (this.render) {
            return this.render({ ...this.props, ...props });
        }
        return null;
    }
}

class PluginManager extends EventEmitter {
    constructor() {
        super();
        this.plugins = new Map();
        this.registry = new Map();
        this.hooks = new Map();
        this.metadata = new Map();
        this.initialized = false;
        
        // Categories
        this.categories = {
            WIDGET: 'widget',
            RENDERER: 'renderer',
            THEME: 'theme',
            EXTENSION: 'extension'
        };
        
        logger.info('✅ PluginManager initialized');
    }
    
    // ============ Registration ============
    
    registerWidget(config) {
        const plugin = new WidgetPlugin({
            ...config,
            category: this.categories.WIDGET
        });
        
        return this.register(plugin);
    }
    
    registerRenderer(config) {
        const plugin = new WidgetPlugin({
            ...config,
            category: this.categories.RENDERER
        });
        
        return this.register(plugin);
    }
    
    registerTheme(config) {
        const plugin = new WidgetPlugin({
            ...config,
            category: this.categories.THEME
        });
        
        return this.register(plugin);
    }
    
    registerExtension(config) {
        const plugin = new WidgetPlugin({
            ...config,
            category: this.categories.EXTENSION
        });
        
        return this.register(plugin);
    }
    
    register(plugin) {
        if (this.plugins.has(plugin.name)) {
            logger.warn(`Plugin ${plugin.name} already registered`);
            return false;
        }
        
        // Check dependencies
        for (const dep of plugin.dependencies) {
            if (!this.plugins.has(dep)) {
                logger.warn(`Dependency ${dep} not found for plugin ${plugin.name}`);
                return false;
            }
        }
        
        this.plugins.set(plugin.name, plugin);
        this.registry.set(plugin.name, plugin);
        
        // Register hooks
        if (plugin.hooks) {
            for (const [hookName, handler] of Object.entries(plugin.hooks)) {
                this.registerHook(hookName, plugin.name, handler);
            }
        }
        
        // Store metadata
        this.metadata.set(plugin.name, {
            name: plugin.name,
            version: plugin.version,
            description: plugin.description,
            author: plugin.author,
            category: plugin.category,
            registeredAt: plugin.registeredAt
        });
        
        this.emit('pluginRegistered', { name: plugin.name, category: plugin.category });
        logger.info(`✅ Plugin registered: ${plugin.name} (${plugin.category})`);
        
        return true;
    }
    
    // ============ Hook System ============
    
    registerHook(hookName, pluginName, handler) {
        if (!this.hooks.has(hookName)) {
            this.hooks.set(hookName, []);
        }
        
        this.hooks.get(hookName).push({
            plugin: pluginName,
            handler: handler
        });
        
        logger.debug(`Hook registered: ${hookName} -> ${pluginName}`);
    }
    
    async executeHook(hookName, ...args) {
        const hooks = this.hooks.get(hookName) || [];
        const results = [];
        
        for (const hook of hooks) {
            try {
                const result = await hook.handler(...args);
                results.push({ plugin: hook.plugin, result });
            } catch (error) {
                logger.error(`Hook ${hookName} failed for ${hook.plugin}: ${error.message}`);
                results.push({ plugin: hook.plugin, error: error.message });
            }
        }
        
        return results;
    }
    
    // ============ Plugin Management ============
    
    async initializePlugin(name) {
        const plugin = this.plugins.get(name);
        if (!plugin) {
            logger.warn(`Plugin ${name} not found`);
            return false;
        }
        
        if (plugin.isActive) {
            return true;
        }
        
        try {
            await plugin.initialize();
            this.emit('pluginInitialized', { name });
            logger.info(`✅ Plugin initialized: ${name}`);
            return true;
        } catch (error) {
            logger.error(`Failed to initialize plugin ${name}: ${error.message}`);
            return false;
        }
    }
    
    async initializeAll() {
        const results = [];
        
        for (const [name, plugin] of this.plugins) {
            if (!plugin.isActive) {
                const success = await this.initializePlugin(name);
                results.push({ name, success });
            }
        }
        
        this.initialized = true;
        this.emit('allInitialized', { count: results.length });
        logger.info(`✅ All plugins initialized (${results.length})`);
        
        return results;
    }
    
    async destroyPlugin(name) {
        const plugin = this.plugins.get(name);
        if (!plugin) {
            logger.warn(`Plugin ${name} not found`);
            return false;
        }
        
        if (!plugin.isActive) {
            return true;
        }
        
        try {
            await plugin.destroy();
            this.emit('pluginDestroyed', { name });
            logger.info(`✅ Plugin destroyed: ${name}`);
            return true;
        } catch (error) {
            logger.error(`Failed to destroy plugin ${name}: ${error.message}`);
            return false;
        }
    }
    
    async destroyAll() {
        const results = [];
        
        for (const [name, plugin] of this.plugins) {
            if (plugin.isActive) {
                const success = await this.destroyPlugin(name);
                results.push({ name, success });
            }
        }
        
        this.initialized = false;
        this.emit('allDestroyed', { count: results.length });
        logger.info(`✅ All plugins destroyed (${results.length})`);
        
        return results;
    }
    
    unregister(name) {
        const plugin = this.plugins.get(name);
        if (!plugin) {
            logger.warn(`Plugin ${name} not found`);
            return false;
        }
        
        if (plugin.isActive) {
            logger.warn(`Cannot unregister active plugin ${name}`);
            return false;
        }
        
        this.plugins.delete(name);
        this.registry.delete(name);
        this.metadata.delete(name);
        
        // Remove hooks
        for (const [hookName, hooks] of this.hooks) {
            this.hooks.set(hookName, hooks.filter(h => h.plugin !== name));
        }
        
        this.emit('pluginUnregistered', { name });
        logger.info(`✅ Plugin unregistered: ${name}`);
        
        return true;
    }
    
    // ============ Query ============
    
    getPlugin(name) {
        return this.plugins.get(name);
    }
    
    getPlugins(category = null) {
        if (category) {
            return Array.from(this.plugins.values())
                .filter(p => p.category === category);
        }
        return Array.from(this.plugins.values());
    }
    
    getWidgets() {
        return this.getPlugins(this.categories.WIDGET);
    }
    
    getRenderers() {
        return this.getPlugins(this.categories.RENDERER);
    }
    
    getThemes() {
        return this.getPlugins(this.categories.THEME);
    }
    
    getExtensions() {
        return this.getPlugins(this.categories.EXTENSION);
    }
    
    getActivePlugins() {
        return Array.from(this.plugins.values())
            .filter(p => p.isActive);
    }
    
    getPluginMetadata(name) {
        return this.metadata.get(name);
    }
    
    getAllMetadata() {
        return Array.from(this.metadata.values());
    }
    
    getHooks() {
        const hooks = {};
        for (const [name, handlers] of this.hooks) {
            hooks[name] = handlers.map(h => h.plugin);
        }
        return hooks;
    }
    
    // ============ Rendering ============
    
    renderWidget(name, props = {}) {
        const plugin = this.plugins.get(name);
        if (!plugin || plugin.category !== this.categories.WIDGET) {
            logger.warn(`Widget ${name} not found`);
            return null;
        }
        
        if (!plugin.isActive) {
            logger.warn(`Widget ${name} is inactive`);
            return null;
        }
        
        return plugin.render(props);
    }
    
    renderAllWidgets(props = {}) {
        const results = {};
        for (const [name, plugin] of this.plugins) {
            if (plugin.category === this.categories.WIDGET && plugin.isActive) {
                results[name] = plugin.render(props);
            }
        }
        return results;
    }
    
    // ============ Stats ============
    
    getStats() {
        return {
            total: this.plugins.size,
            active: this.getActivePlugins().length,
            inactive: this.plugins.size - this.getActivePlugins().length,
            categories: {
                widget: this.getWidgets().length,
                renderer: this.getRenderers().length,
                theme: this.getThemes().length,
                extension: this.getExtensions().length
            },
            hooks: this.hooks.size,
            initialized: this.initialized,
            timestamp: new Date().toISOString()
        };
    }
}

export default PluginManager;