import { WASI } from '@wasmer/wasi';
import { WasmFs } from '@wasmer/wasmfs';
import fs from 'fs';
import path from 'path';
import logger from '../backend/api/src/middleware/logger.js';

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
            
            // Path traversal protection: resolve the full path, collapse
            // traversal segments, and require the result to stay inside an
            // allowed root before the file is read.
            const resolvedPath = path.resolve(path.normalize(wasmPath));
            const allowedBaseDir = path.resolve(process.cwd());
            if (!resolvedPath.startsWith(allowedBaseDir + path.sep) && resolvedPath !== allowedBaseDir) {
                throw new Error('Security Error: Path traversal outside allowed runtime sandbox directory');
            }
            if (!resolvedPath.endsWith('.wasm')) {
                throw new Error('Security Error: Only .wasm files are permitted');
            }

            const withinAllowedRoot = this.capabilities.allowedPaths.some(p => {
                const rootBase = path.resolve(path.normalize(p)).replace(/[\/\\]+$/, '');
                return resolvedPath === rootBase || resolvedPath.startsWith(rootBase + path.sep);
            });
            if (!withinAllowedRoot) {
                throw new Error(`Security Error: Access denied: ${wasmPath}`);
            }
            
            // Read WASM file
            const wasmBytes = fs.readFileSync(resolvedPath);
            
            // Create WASI instance with capabilities. Never expose
            // process.env to untrusted WASM, and do not preopen the working
            // directory — the sandbox gets no host filesystem access by default.
            const wasi = new WASI({
                args: [],
                env: {},
                preopens: {},
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

    async readFile(instanceId, path) {
        this.validatePath(path);
        const result = await this.executeFunction(instanceId, 'wasi_read_file', path);
        return result;
    }

    async writeFile(instanceId, path, content) {
        this.validatePath(path);
        const result = await this.executeFunction(instanceId, 'wasi_write_file', path, content);
        return result;
    }

    async listDirectory(instanceId, path) {
        this.validatePath(path);
        const result = await this.executeFunction(instanceId, 'wasi_list_directory', path);
        return JSON.parse(result);
    }

    async createDirectory(instanceId, path) {
        this.validatePath(path);
        const result = await this.executeFunction(instanceId, 'wasi_create_directory', path);
        return result;
    }

    async deleteFile(instanceId, path) {
        this.validatePath(path);
        const result = await this.executeFunction(instanceId, 'wasi_delete_file', path);
        return result;
    }

    async httpRequest(instanceId, url, method, headers, body) {
        this.validateUrl(url);
        const request = JSON.stringify({ url, method, headers, body });
        const result = await this.executeFunction(instanceId, 'wasi_http_request', request);
        return JSON.parse(result);
    }

    async getTime(instanceId) {
        return await this.executeFunction(instanceId, 'wasi_get_time');
    }

    async getTimeMs(instanceId) {
        return await this.executeFunction(instanceId, 'wasi_get_time_ms');
    }

    async sleep(instanceId, ms) {
        return await this.executeFunction(instanceId, 'wasi_sleep', ms);
    }

    async getProcessId(instanceId) {
        return await this.executeFunction(instanceId, 'wasi_get_process_id');
    }

    async getEnvVar(instanceId, name) {
        return await this.executeFunction(instanceId, 'wasi_get_env_var', name);
    }

    async getCurrentDir(instanceId) {
        return await this.executeFunction(instanceId, 'wasi_get_current_dir');
    }

    validatePath(requestedPath) {
        // Path traversal protection: resolve the full path lexically
        // (collapse `.`/`..` segments), then require the resolved path to
        // stay inside an allowed root at a separator boundary. Embedded
        // traversal such as `/tmp/truxify/../../etc/passwd` resolves outside
        // every root and is rejected.
        const normalized = path.normalize(requestedPath);
        const allowed = this.capabilities.allowedPaths.some(p => {
            const rootBase = path.normalize(p).replace(/[\/\\]+$/, '');
            return normalized === rootBase || normalized.startsWith(rootBase + path.sep);
        });
        if (!allowed) {
            throw new Error(`Access denied: ${requestedPath}`);
        }
        return true;
    }

    validateUrl(url) {
        let parsed;
        try {
            parsed = new URL(url);
        } catch (err) {
            throw new Error(`Invalid URL: ${url}`);
        }
        if (!['http:', 'https:'].includes(parsed.protocol)) {
            throw new Error(`Invalid URL protocol: ${url}`);
        }
        const hostname = parsed.hostname.toLowerCase();
        // Exact host match only — an "includes" check is bypassable with
        // http://api.truxify.com.evil.com.
        const allowed = this.capabilities.allowedDomains.some(d => hostname === d.toLowerCase());
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