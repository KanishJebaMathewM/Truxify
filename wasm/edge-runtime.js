import fs from 'fs';
import { createHash } from 'crypto';
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
                            distance / (speed * (1.0 - (trafficFactor || 0))),
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
                    }
                });
            }
        } catch (err) {
            logger.error(`WASM initialization warning: ${err.message}`);
        }

        this.isInitialized = true;
    }

    async executeEdgeFunction(functionName, params) {
        const moduleEntry = this.wasmModules.get('default');

        if (moduleEntry && moduleEntry.exports && !moduleEntry.instance && typeof moduleEntry.exports[functionName] === 'function') {
            try {
                const result = await this.executeWithTimeout(() => moduleEntry.exports[functionName](...params), this.timeoutLimit);
                return { success: true, result };
            } catch (err) {
                logger.error(`Edge function '${functionName}' failed: ${err.message}`);
                return { success: false, error: err.message };
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