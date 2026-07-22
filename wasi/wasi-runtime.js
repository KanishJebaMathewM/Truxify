import { WASI } from '@wasmer/wasi';
import { WasmFs } from '@wasmer/wasmfs';
import fs from 'fs';
import path from 'path';
import logger from '../../api/src/middleware/logger.js';

class WASIRuntime {
    constructor() {
        this.wasmFs = new WasmFs();
        this.instances = new Map();
        this.isInitialized = false;
        this.capabilities = this.loadCapabilities();
        
        logger.info('✅ WASI Runtime initialized');
    }

    loadCapabilities() {
        // Capability-based security configuration
        return {
            allowedPaths: [
                '/tmp/truxify/',
                './data/',
                '/var/truxify/'
            ],
            allowedDomains: [
                'api.truxify.com',
                'localhost',
                '127.0.0.1'
            ],
            maxFileSize: 100 * 1024 * 1024, // 100MB
            maxMemory: 256 * 1024 * 1024, // 256MB
            timeout: 30000, // 30 seconds
        };
    }

    async initialize() {
        if (this.isInitialized) return;
        
        // Mount host directories to WASI
        for (const path of this.capabilities.allowedPaths) {
            if (fs.existsSync(path)) {
                this.wasmFs.mount(path, path);
                logger.info(`✅ Mounted: ${path}`);
            }
        }
        
        this.isInitialized = true;
        logger.info('✅ WASI Runtime ready');
    }

    async loadWasiModule(wasmPath) {
        try {
            await this.initialize();
            
            // Read WASM file
            const wasmBytes = fs.readFileSync(wasmPath);
            
            // Create WASI instance with capabilities
            const wasi = new WASI({
                args: [],
                env: process.env,
                preopens: {
                    '/': './'
                },
                returnOnExit: true,
            });
            
            // Create WASM instance
            const module = await WebAssembly.compile(wasmBytes);
            const instance = await WebAssembly.instantiate(module, {
                wasi_snapshot_preview1: wasi.wasiImport,
                env: {
                    memory: new WebAssembly.Memory({ initial: 256 }),
                },
            });
            
            // Store instance
            const id = `wasi_${Date.now()}`;
            this.instances.set(id, {
                instance,
                wasi,
                module,
                created: Date.now()
            });
            
            logger.info(`✅ WASI module loaded: ${id}`);
            return id;
            
        } catch (error) {
            logger.error('WASI module load failed:', error);
            throw error;
        }
    }

    async executeFunction(instanceId, functionName, ...args) {
        try {
            const entry = this.instances.get(instanceId);
            if (!entry) {
                throw new Error(`Instance ${instanceId} not found`);
            }
            
            const { instance, wasi } = entry;
            
            // Check timeout
            if (Date.now() - entry.created > this.capabilities.timeout) {
                throw new Error('Instance timeout');
            }
            
            // Execute function
            const result = instance.exports[functionName](...args);
            
            // Handle WASI
            wasi.start(instance);
            
            return result;
            
        } catch (error) {
            logger.error('Function execution failed:', error);
            throw error;
        }
    }

    async readFile(path) {
        this.validatePath(path);
        const result = await this.executeFunction('wasi_read_file', path);
        return result;
    }

    async writeFile(path, content) {
        this.validatePath(path);
        const result = await this.executeFunction('wasi_write_file', path, content);
        return result;
    }

    async listDirectory(path) {
        this.validatePath(path);
        const result = await this.executeFunction('wasi_list_directory', path);
        return JSON.parse(result);
    }

    async createDirectory(path) {
        this.validatePath(path);
        const result = await this.executeFunction('wasi_create_directory', path);
        return result;
    }

    async deleteFile(path) {
        this.validatePath(path);
        const result = await this.executeFunction('wasi_delete_file', path);
        return result;
    }

    async httpRequest(url, method, headers, body) {
        this.validateUrl(url);
        const request = JSON.stringify({ url, method, headers, body });
        const result = await this.executeFunction('wasi_http_request', request);
        return JSON.parse(result);
    }

    async getTime() {
        return await this.executeFunction('wasi_get_time');
    }

    async getTimeMs() {
        return await this.executeFunction('wasi_get_time_ms');
    }

    async sleep(ms) {
        return await this.executeFunction('wasi_sleep', ms);
    }

    async getProcessId() {
        return await this.executeFunction('wasi_get_process_id');
    }

    async getEnvVar(name) {
        return await this.executeFunction('wasi_get_env_var', name);
    }

    async getCurrentDir() {
        return await this.executeFunction('wasi_get_current_dir');
    }

    validatePath(path) {
        const allowed = this.capabilities.allowedPaths.some(p => path.startsWith(p));
        if (!allowed) {
            throw new Error(`Access denied: ${path}`);
        }
        return true;
    }

    validateUrl(url) {
        const allowed = this.capabilities.allowedDomains.some(d => url.includes(d));
        if (!allowed) {
            throw new Error(`Access denied: ${url}`);
        }
        return true;
    }

    async getStats() {
        return {
            instances: this.instances.size,
            isInitialized: this.isInitialized,
            capabilities: this.capabilities,
            timestamp: new Date().toISOString()
        };
    }

    cleanup() {
        this.instances.clear();
        logger.info('✅ WASI instances cleaned up');
    }
}

export default new WASIRuntime();