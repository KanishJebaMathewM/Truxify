import fs from 'fs';
import { createHash } from 'crypto';
import { WASI } from 'wasi';
import { createRequire } from 'module';
import logger from '../backend/api/src/middleware/logger.js';

const require = createRequire(import.meta.url);

// wasm-bindgen modules built with `wasm-pack build --target nodejs` are not
// plain WASI binaries: besides the wasi_snapshot_preview1 namespace they import
// wasm-bindgen glue from `env` (memory + __wbindgen_malloc/realloc/free/throw).
// Instantiating the bare .wasm without that glue throws a LinkError, which the
// old code swallowed and /wasm/* answered {success:true, data:null} for.
function buildWasmBindgenGlue(instanceRef) {
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

// Builds the import object for a wasm-bindgen module, filling in exactly the
// `env` namespace entries the module declares (memory + allocator/panic glue)
// plus the provided WASI namespace. Unknown imports are left unprovided so a
// genuinely unsupported module still fails loudly instead of silently no-opping.
function buildWasmImportObject(module, wasi) {
    const imports = {};
    if (wasi) {
        imports.wasi_snapshot_preview1 = wasi.wasiImport;
    }

    const instanceRef = { current: null, memory: null };
    const glue = buildWasmBindgenGlue(instanceRef);

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

class EdgeRuntime {
    constructor() {
        this.wasmModules = new Map();
        this.edgeFunctions = new Map();
        this.isInitialized = false;
        this.wasmError = null;
        this.memoryLimit = 128 * 1024 * 1024; // 128MB
        this.timeoutLimit = 5000; // 5 seconds

        logger.info('✅ Edge Runtime initialized');
    }

    // Native JS implementations used when the wasm binary is absent or fails
    // to instantiate, so /wasm/* keeps returning genuine results.
    jsFallbackExports() {
        return {
            calculate_route: (params) => {
                const basePrice = (params.distance || 0) * 10.0;
                const weightFactor = (params.weight || 0) / 1000.0;
                return {
                    estimated_price: basePrice * (1.0 + weightFactor * 0.5),
                    estimated_time: (params.distance || 0) / 40.0,
                    route_id: `route_${Date.now()}`,
                    status: 'calculated'
                };
            },
            process_driver_location: (drivers) => (drivers || []).map((driver) => {
                const updated = { ...driver };
                if (driver.speed > 80) updated.status = 'fast';
                else if (driver.speed > 50) updated.status = 'normal';
                else updated.status = 'slow';
                return updated;
            }),
            optimize_loads: (loads, capacity) => {
                const selected = [];
                let remaining = capacity || 0;
                (loads || []).forEach((weight, i) => {
                    if (weight <= remaining) {
                        selected.push(i);
                        remaining -= weight;
                    }
                });
                return selected;
            },
            calculate_eta: (distance, speed, trafficFactor) =>
                distance / (speed * Math.max(1.0 - (trafficFactor || 0), 0.1)),
            filter_drivers: (drivers, minRating) =>
                (drivers || []).filter((d) => d.status !== 'offline' && d.rating >= (minRating || 0)),
            aggregate_prices: (prices) =>
                prices && prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : 0,
            hash_data: (data) => createHash('sha256').update(String(data)).digest('hex'),
            compress_data: (data) => {
                if (!data || data.length === 0) return [];
                const compressed = [];
                let count = 1;
                for (let i = 1; i < data.length; i++) {
                    if (data[i] === data[i - 1]) {
                        count += 1;
                    } else {
                        compressed.push(data[i - 1], count);
                        count = 1;
                    }
                }
                compressed.push(data[data.length - 1], count);
                return compressed;
            },
            get_stats: () => ({ memory_used_mb: 4.2, active_functions: 8 })
        };
    }

    async initialize() {
        if (this.isInitialized) return;

        const wasmPath = process.env.WASM_MODULE_PATH || './wasm/truxify_wasm_routing.wasm';

        if (fs.existsSync(wasmPath)) {
            try {
                const wasmBytes = fs.readFileSync(wasmPath);
                const wasi = new WASI({
                    args: [],
                    env: Object.fromEntries(
                        Object.entries(process.env).filter(([k]) =>
                            /^(PATH|HOME|TMP|USER|LANG|LC_|RUST_|WASM_)/.test(k)
                        )
                    ),
                    // Only expose a dedicated, read-only data directory to the
                    // guest. Mounting the whole CWD ('.') would hand the guest
                    // backend source, .env files and secrets.
                    preopens: { '/data': './wasm-data' }
                });
                const module = new WebAssembly.Module(wasmBytes);
                const { imports, bind } = buildWasmImportObject(module, wasi);
                const { instance } = await WebAssembly.instantiate(module, imports);
                bind(instance);
                this.wasmModules.set('default', {
                    module,
                    wasi,
                    instance,
                    exports: instance.exports
                });
                logger.info('✅ WASM binary module loaded');
            } catch (err) {
                // A LinkError here used to be swallowed, leaving /wasm/* to answer
                // {success:true, data:null}. Record the real failure and fall back
                // to the native JS engine so callers get genuine results.
                this.wasmError = err.message;
                logger.error(`WASM module failed to load: ${err.message}`);
                this.wasmModules.set('default', {
                    exports: this.jsFallbackExports()
                });
            }
        } else {
            logger.warn('⚠️ WASM binary file not found, initializing native JS calculation fallback engine');
            this.wasmModules.set('default', {
                exports: this.jsFallbackExports()
            });
        }

        this.isInitialized = true;
    }

    async executeEdgeFunction(functionName, params) {
        const moduleEntry = this.wasmModules.get('default');
        const wasmFn = moduleEntry && moduleEntry.exports &&
            typeof moduleEntry.exports[functionName] === 'function';

        // Prefer the real wasm export; it executes off the main thread in the
        // worker below. Otherwise fall back to a native JS implementation so
        // callers get genuine results instead of null.
        if (!(wasmFn && moduleEntry.instance)) {
            const jsFallback = this.jsFallbackExports();
            const fallbackFn = wasmFn ? moduleEntry.exports[functionName] : jsFallback[functionName];
            if (typeof fallbackFn === 'function') {
                try {
                    const result = await this.executeWithTimeout(fallbackFn, this.timeoutLimit, params);
                    return { success: true, result };
                } catch (err) {
                    logger.error(`Edge function '${functionName}' failed: ${err.message}`);
                    return { success: false, error: err.message };
                }
            }
        }

        return new Promise((resolve) => {
            const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

            if (!isMainThread) return;

            const workerCode = `
            const { parentPort, workerData } = require('worker_threads');
            const { functionName, params, wasmPath } = workerData;
            try {
                const fs = require('fs');
                const { WASI } = require('wasi');
                const wasmBytes = fs.readFileSync(wasmPath);
                const wasi = new WASI({ args: [], env: {}, preopens: {} });

                // Same wasm-bindgen glue as the main thread: supply env.memory
                // and __wbindgen_* allocator/panic imports the module needs.
                let envMemory = null;
                const instanceRef = { current: null };
                const allocExport = {
                    __wbindgen_malloc: ['__wbindgen_malloc', '__wbindgen_export_0'],
                    __wbindgen_realloc: ['__wbindgen_realloc', '__wbindgen_export_1'],
                    __wbindgen_free: ['__wbindgen_free', '__wbindgen_export_2']
                };
                const callExport = (names, args) => {
                    const exports = instanceRef.current && instanceRef.current.exports;
                    for (const name of names) {
                        if (exports && typeof exports[name] === 'function') return exports[name](...args);
                    }
                    throw new Error('wasm-bindgen allocator glue not exported');
                };
                const glue = {
                    __wbindgen_malloc: (...args) => callExport(allocExport.__wbindgen_malloc, args),
                    __wbindgen_realloc: (...args) => callExport(allocExport.__wbindgen_realloc, args),
                    __wbindgen_free: (...args) => callExport(allocExport.__wbindgen_free, args),
                    __wbindgen_throw: (ptr, len) => {
                        const memory = (instanceRef.current && instanceRef.current.exports.memory) || envMemory;
                        throw new Error(new TextDecoder().decode(new Uint8Array(memory.buffer, ptr, len)));
                    },
                    __wbindgen_exn_store: () => { throw new Error('wasm-bindgen exception storage is not supported'); }
                };

                const module = new WebAssembly.Module(wasmBytes);
                const env = {};
                for (const imp of WebAssembly.Module.imports(module)) {
                    if (imp.module !== 'env') continue;
                    if (imp.kind === 'memory') {
                        envMemory = new WebAssembly.Memory({
                            initial: imp.minimum || 17,
                            maximum: imp.maximum
                        });
                        env.memory = envMemory;
                    } else if (typeof glue[imp.name] === 'function') {
                        env[imp.name] = glue[imp.name];
                    }
                }
                const importObject = { wasi_snapshot_preview1: wasi.wasiImport };
                if (Object.keys(env).length > 0) importObject.env = env;

                const instance = new WebAssembly.Instance(module, importObject);
                instanceRef.current = instance;
                const func = instance.exports[functionName];
                if (!func) throw new Error('Function ' + functionName + ' not found');
                const result = func(...params);
                parentPort.postMessage({ success: true, result });
            } catch (err) {
                parentPort.postMessage({ success: false, error: err.message });
            }
        `;

            const wasmPath = process.env.WASM_MODULE_PATH || './wasm/truxify_wasm_routing.wasm';

            const worker = new Worker(workerCode, {
                eval: true,
                workerData: { functionName, params, wasmPath },
                resourceLimits: {
                    maxOldGenerationSizeMb: 64,
                    maxYoungGenerationSizeMb: 16,
                    stackSizeMb: 2,
                    maxCPUMilliseconds: this.timeoutLimit,
                },
            });

            const timer = setTimeout(() => {
                worker.terminate();
                logger.error(`Edge function '${functionName}' timed out after ${this.timeoutLimit}ms`);
                resolve({ success: false, error: `Execution timed out after ${this.timeoutLimit}ms` });
            }, this.timeoutLimit);

            worker.on('message', (result) => {
                clearTimeout(timer);
                resolve(result);
            });

            worker.on('error', (err) => {
                clearTimeout(timer);
                logger.error(`Edge function worker error: ${err.message}`);
                resolve({ success: false, error: err.message });
            });

            worker.on('exit', (code) => {
                if (code !== 0) {
                    clearTimeout(timer);
                    resolve({ success: false, error: `Worker exited with code ${code}` });
                }
            });
        });
    }

    // Runs `fn` in a separate worker thread so that a synchronous infinite loop
    // in guest/native code can be terminated (via worker.terminate()) and cannot
    // block the main event loop. The `resourceLimits.maxCPUMilliseconds` guard
    // additionally aborts runaway CPU-bound code. `fn` must be a self-contained
    // (closure-free) function serializable via toString(), and `args` its
    // parameters.
    async executeWithTimeout(fn, timeout, args = []) {
        const { Worker } = require('worker_threads');

        return new Promise((resolve, reject) => {
            const worker = new Worker(
                `
                const { parentPort, workerData } = require('worker_threads');
                const { fnSource, args } = workerData;
                try {
                    const fn = eval('(' + fnSource + ')');
                    const result = fn(...args);
                    parentPort.postMessage({ ok: true, result });
                } catch (e) {
                    parentPort.postMessage({ ok: false, error: e.message });
                }
                `,
                {
                    eval: true,
                    workerData: { fnSource: fn.toString(), args },
                    resourceLimits: { maxCPUMilliseconds: timeout },
                }
            );

            const timer = setTimeout(() => {
                worker.terminate();
                reject(new Error(`Execution timeout after ${timeout}ms`));
            }, timeout);

            worker.on('message', (msg) => {
                clearTimeout(timer);
                if (msg.ok) resolve(msg.result);
                else reject(new Error(msg.error));
            });

            worker.on('error', (err) => {
                clearTimeout(timer);
                reject(err);
            });

            worker.on('exit', (code) => {
                if (code !== 0 && code !== 1) {
                    clearTimeout(timer);
                    reject(new Error(`Worker exited with code ${code}`));
                }
            });
        });
    }

    async calculateRoute(params) {
        const result = await this.executeEdgeFunction('calculate_route', [params]);
        if (result.success) {
            return result.result;
        }
        return null;
    }

    async processDrivers(drivers) {
        const result = await this.executeEdgeFunction('process_driver_location', [drivers]);
        if (result.success) {
            return result.result;
        }
        return null;
    }

    async optimizeLoads(loads, capacity) {
        const result = await this.executeEdgeFunction('optimize_loads', [loads, capacity]);
        if (result.success) {
            return result.result;
        }
        return null;
    }

    async calculateETA(distance, speed, trafficFactor) {
        const result = await this.executeEdgeFunction('calculate_eta', [distance, speed, trafficFactor]);
        if (result.success) {
            return result.result;
        }
        return null;
    }

    // validateOTP removed (#6331): the endpoint passed the client-supplied
    // reference value straight into the sandbox (input === correct), making
    // it a trivially bypassable OTP validator on the public API. OTP
    // validation lives server-side against stored, hashed OTPs instead.

    async filterDrivers(drivers, minRating) {
        const result = await this.executeEdgeFunction('filter_drivers', [drivers, minRating]);
        if (result.success) {
            return result.result;
        }
        return null;
    }

    async aggregatePrices(prices) {
        const result = await this.executeEdgeFunction('aggregate_prices', [prices]);
        if (result.success) {
            return result.result;
        }
        return null;
    }

    async hashData(data) {
        const result = await this.executeEdgeFunction('hash_data', [data]);
        if (result.success) {
            return result.result;
        }
        return null;
    }

    async compressData(data) {
        const result = await this.executeEdgeFunction('compress_data', [data]);
        if (result.success) {
            return result.result;
        }
        return null;
    }

    async getFunctionStats() {
        return {
            modulesLoaded: this.wasmModules.size,
            isInitialized: this.isInitialized,
            memoryLimit: this.memoryLimit,
            timeoutLimit: this.timeoutLimit,
            timestamp: new Date().toISOString()
        };
    }
}

export default new EdgeRuntime();