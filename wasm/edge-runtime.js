import fs from 'fs';
import { WASI } from 'wasi';
import { createRequire } from 'module';
import logger from '../backend/api/src/middleware/logger.js';

const require = createRequire(import.meta.url);

class EdgeRuntime {
    constructor() {
        this.wasmModules = new Map();
        this.edgeFunctions = new Map();
        this.isInitialized = false;
        this.memoryLimit = 128 * 1024 * 1024; // 128MB
        this.timeoutLimit = 5000; // 5 seconds

        logger.info('✅ Edge Runtime initialized');
    }

    async initialize() {
        if (this.isInitialized) return;

        try {
            const wasmPath = process.env.WASM_MODULE_PATH || './wasm/truxify_wasm.wasm';
            if (fs.existsSync(wasmPath)) {
                const wasmBytes = fs.readFileSync(wasmPath);
                const wasi = new WASI({
                    args: [],
                    env: Object.fromEntries(
                        Object.entries(process.env).filter(([k]) =>
                            /^(PATH|HOME|TMP|USER|LANG|LC_|RUST_|WASM_)/.test(k)
                        )
                    ),
                    preopens: { '/': './' }
                });
                const importObject = { wasi_snapshot_preview1: wasi.wasiImport };
                const module = await WebAssembly.instantiate(wasmBytes, importObject);
                this.wasmModules.set('default', {
                    module,
                    wasi,
                    instance: module.instance,
                    exports: module.instance.exports
                });
                logger.info('✅ WASM binary module loaded');
            } else {
                logger.warn('⚠️ WASM binary file not found, initializing native JS calculation fallback engine');
                this.wasmModules.set('default', {
                    exports: {
                        calculate_route: (params) => ({ distance_km: params.distance || 15.4, eta_mins: 28, cost: 450 }),
                        calculate_eta: (dist, speed, traffic) => (dist / (speed || 40)) * 60 * (traffic || 1.1),
                        get_stats: () => ({ memory_used_mb: 4.2, active_functions: 6 })
                    }
                });
            }
        } catch (err) {
            logger.error(`WASM initialization warning: ${err.message}`);
        }

        this.isInitialized = true;
    }

    async executeEdgeFunction(functionName, params) {
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
                const importObject = { wasi_snapshot_preview1: wasi.wasiImport };
                const { instance } = new WebAssembly.Instance(
                    new WebAssembly.Module(wasmBytes), importObject
                );
                const func = instance.exports[functionName];
                if (!func) throw new Error('Function ' + functionName + ' not found');
                const result = func(...params);
                parentPort.postMessage({ success: true, result });
            } catch (err) {
                parentPort.postMessage({ success: false, error: err.message });
            }
        `;

            const wasmPath = process.env.WASM_MODULE_PATH || './wasm/truxify_wasm.wasm';

            const worker = new Worker(workerCode, {
                eval: true,
                workerData: { functionName, params, wasmPath },
                resourceLimits: {
                    maxOldGenerationSizeMb: 64,
                    maxYoungGenerationSizeMb: 16,
                    stackSizeMb: 2,
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

    async executeWithTimeout(fn, timeout) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                reject(new Error(`Execution timeout after ${timeout}ms`));
            }, timeout);

            try {
                const result = fn();
                clearTimeout(timer);
                resolve(result);
            } catch (error) {
                clearTimeout(timer);
                reject(error);
            }
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