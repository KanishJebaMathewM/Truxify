import { WASI } from '@wasmer/wasi';
import fs from 'fs';
import path from 'path';
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
            
            // Create WASM instance. wasm-bindgen modules built with
            // `wasm-pack build --target nodejs` import glue from `env`
            // (memory + __wbindgen_malloc/realloc/free/throw) in addition to
            // wasi_snapshot_preview1, so supply the exact imports the module
            // declares instead of a bare memory-only env namespace.
            const module = await WebAssembly.compile(wasmBytes);
            const { imports, bind } = this.buildWasmImportObject(module, wasi);
            const instance = await WebAssembly.instantiate(module, imports);
            bind(instance);

            // Reactor module: run the WASI start/initialize entry point once
            // at load time (as wasm-bindgen reactors require) instead of
            // calling wasi.start() after every invocation.
            if (typeof wasi.initialize === 'function') {
                wasi.initialize(instance);
            } else {
                wasi.start(instance);
            }
            
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
            
            const { instance } = entry;
            
            // Check timeout
            if (Date.now() - entry.created > this.capabilities.timeout) {
                throw new Error('Instance timeout');
            }
            
            // Execute function
            const result = instance.exports[functionName](...args);

            return result;

        } catch (error) {
            logger.error({ err: error, functionName, instanceId }, 'WASI function execution failed');
            throw error;
        }
    }

    // wasm-bindgen modules built with `wasm-pack build --target nodejs` are
    // not plain WASI binaries: besides the wasi_snapshot_preview1 namespace
    // they import wasm-bindgen glue from `env` (memory +
    // __wbindgen_malloc/realloc/free/throw). Instantiating the bare .wasm
    // without that glue throws a LinkError.
    buildWasmBindgenGlue(instanceRef) {
        const allocExport = {
            __wbindgen_malloc: ['__wbindgen_malloc', '__wbindgen_export_0'],
            __wbindgen_realloc: ['__wbindgen_realloc', '__wbindgen_export_1'],
            __wbindgen_free: ['__wbindgen_free', '__wbindgen_export_2'],
        };

        const callExport = (names, args) => {
            const exports = instanceRef.current && instanceRef.current.exports;
            for (const name of names) {
                if (exports && typeof exports[name] === 'function') {
                    return exports[name](...args);
                }
            }
            throw new Error(`wasm-bindgen allocator glue not exported (tried ${names.join(', ')})`);
        };

        return {
            __wbindgen_malloc: (...args) => callExport(allocExport.__wbindgen_malloc, args),
            __wbindgen_realloc: (...args) => callExport(allocExport.__wbindgen_realloc, args),
            __wbindgen_free: (...args) => callExport(allocExport.__wbindgen_free, args),
            __wbindgen_throw: (ptr, len) => {
                const memory = (instanceRef.current && instanceRef.current.exports.memory) || instanceRef.memory;
                if (!memory) {
                    throw new Error('wasm-bindgen threw before a memory was available');
                }
                const bytes = new Uint8Array(memory.buffer, ptr, len);
                throw new Error(new TextDecoder().decode(bytes));
            },
            __wbindgen_exn_store: () => {
                throw new Error('wasm-bindgen exception storage is not supported');
            },
        };
    }

    // Builds the import object for a wasm-bindgen module, filling in exactly
    // the `env` namespace entries the module declares (memory + allocator/
    // panic glue) plus the provided WASI namespace. Unknown imports are left
    // unprovided so a genuinely unsupported module still fails loudly instead
    // of silently no-opping.
    buildWasmImportObject(module, wasi) {
        const imports = {};
        if (wasi) {
            imports.wasi_snapshot_preview1 = wasi.wasiImport;
        }

        const instanceRef = { current: null, memory: null };
        const glue = this.buildWasmBindgenGlue(instanceRef);

        const required = WebAssembly.Module.imports(module);
        const env = {};
        for (const imp of required) {
            if (imp.module !== 'env') continue;
            if (imp.kind === 'memory') {
                instanceRef.memory = new WebAssembly.Memory({
                    initial: imp.minimum || 17,
                    maximum: imp.maximum,
                });
                env.memory = instanceRef.memory;
            } else if (typeof glue[imp.name] === 'function') {
                env[imp.name] = glue[imp.name];
            }
        }

        if (Object.keys(env).length > 0) {
            imports.env = env;
        }
        return { imports, bind: (instance) => { instanceRef.current = instance; } };
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