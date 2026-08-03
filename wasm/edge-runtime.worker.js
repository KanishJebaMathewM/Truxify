import fs from 'fs';
import { parentPort, workerData } from 'worker_threads';
import { WASI } from 'wasi';

const { wasmPath, functionName, params } = workerData;

async function main() {
    const wasmBytes = fs.readFileSync(wasmPath);
    const wasi = new WASI({
        version: 'preview1',
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
    const func = module.instance.exports[functionName];
    if (typeof func !== 'function') {
        throw new Error(`Function ${functionName} not found`);
    }
    const result = func(...params);
    parentPort.postMessage({ success: true, data: result });
}

main().catch((err) => {
    parentPort.postMessage({ success: false, error: err.message });
});
