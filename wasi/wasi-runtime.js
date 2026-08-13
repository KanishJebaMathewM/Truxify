import { WASI } from '@wasmer/wasi';
import fs from 'fs';
import path from 'path';
import { Worker } from 'worker_threads';
import logger from '../backend/api/src/middleware/logger.js';

class WASIRuntime {
    constructor() {
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
        
        // Host filesystem access is deliberately not exposed to the WASM
        // sandbox: the WASI instance is created with no preopens (see
        // loadWasiModule) and capability paths are enforced host-side via
        // validatePath against capabilities.allowedPaths. No WasmFs mounts
        // are attached to instances, so none are created here.
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
                created: Date.now(),
                started: false
            });
            
            logger.info(`✅ WASI module loaded: ${id}`);
            return id;
            
        } catch (error) {
            logger.error('WASI module load failed:', error);
            throw error;
        }
    }

    async executeFunction(instanceId, functionName, ...args) {
        const entry = this.instances.get(instanceId);
        if (!entry) {
            throw new Error(`Instance ${instanceId} not found`);
        }

        // Start the WASI runtime exactly once — re-invoking wasi.start on
        // every call re-runs the module _start (a no-op or error after the
        // first run) which can corrupt module state across invocations.
        if (!entry.started) {
            entry.wasi.start(entry.instance);
            entry.started = true;
        }

        // Run the guest export under a real execution watchdog. Unlike the
        // previous admission-only timestamp check, this executes the call in
        // a terminable Worker so a runaway/looping module is hard-stopped
        // when capabilities.timeout elapses instead of pinning the
        // event-loop thread indefinitely.
        return withHardTimeout(entry.module, functionName, args, this.capabilities.timeout);
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

// Runs a guest export under a real execution watchdog. The call is executed
// inside a Worker so that, unlike a timestamp comparison at entry, a
// runaway/looping module can be hard-terminated via worker.terminate() when
// `timeout` elapses instead of pinning the event-loop thread indefinitely.
function withHardTimeout(module, functionName, args, timeout) {
    return new Promise((resolve, reject) => {
        const workerCode = `
            const { parentPort, workerData } = require('worker_threads');
            const { module, functionName, args } = workerData;
            try {
                const { WASI } = require('wasi');
                const wasi = new WASI({ args: [], env: {}, preopens: {} });
                const importObject = {
                    wasi_snapshot_preview1: wasi.wasiImport,
                    env: { memory: new WebAssembly.Memory({ initial: 256 }) },
                };
                const instance = new WebAssembly.Instance(module, importObject);
                // Start the WASI runtime exactly once inside the worker — the
                // module's _start must not be re-invoked on subsequent calls.
                wasi.start(instance);
                const func = instance.exports[functionName];
                if (typeof func !== 'function') {
                    throw new Error('Function ' + functionName + ' not found');
                }
                const result = func(...args);
                parentPort.postMessage({ success: true, result });
            } catch (err) {
                parentPort.postMessage({ success: false, error: err.message });
            }
        `;

        const worker = new Worker(workerCode, {
            eval: true,
            workerData: { module, functionName, args },
        });

        const timer = setTimeout(() => {
            worker.terminate();
            logger.error(`Guest function '${functionName}' timed out after ${timeout}ms`);
            reject(new Error(`Execution timeout after ${timeout}ms`));
        }, timeout);

        worker.on('message', (msg) => {
            clearTimeout(timer);
            if (msg.success) {
                resolve(msg.result);
            } else {
                reject(new Error(msg.error));
            }
        });

        worker.on('error', (err) => {
            clearTimeout(timer);
            logger.error(`Guest function worker error: ${err.message}`);
            reject(err);
        });

        worker.on('exit', (code) => {
            if (code !== 0) {
                clearTimeout(timer);
                reject(new Error(`Worker exited with code ${code}`));
            }
        });
    });
}

export default new WASIRuntime();