use wasi_runtime::WasiPluginExecutor;

// Minimal, hand-encoded WASM module (no external deps needed for the test).
// Exports linear memory (1 page) and a `run` function with signature
// (i32, i32, i32, i32) -> i32: the host passes (in_ptr, in_len, out_ptr,
// out_cap) and the plugin must write its output to `out_ptr` and return the
// number of bytes written. This module writes the fixed string "sandboxed"
// (9 bytes) at `out_ptr` and returns 9, ignoring its inputs. This proves the
// executor actually instantiates and runs a real module rather than echoing
// input, and that output is read from the location the guest was told to use.
const MODULE_WASM: &[u8] = &[
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, // magic + version
    // type section: func (i32, i32, i32, i32) -> i32
    0x01, 0x09, 0x01, 0x60, 0x04, 0x7f, 0x7f, 0x7f, 0x7f, 0x01, 0x7f,
    // function section: 1 function of type 0
    0x03, 0x02, 0x01, 0x00,
    // memory section: 1 memory, min 1 page (64 KiB)
    0x05, 0x03, 0x01, 0x00, 0x01,
    // export section: "memory" (mem 0) and "run" (func 0)
    0x07, 0x10, 0x02, 0x06, 0x6d, 0x65, 0x6d, 0x6f, 0x72, 0x79, 0x02, 0x00, 0x03, 0x72, 0x75,
    0x6e, 0x00, 0x00,
    // code section: 1 function body. run writes "sandboxed" at local 2 (out_ptr)
    // and returns 9.
    0x0a, 0x60, 0x01, 0x5e, 0x00,
    0x20, 0x02, 0x41, 0x00, 0x6a, 0x41, 0x73, 0x3a, 0x00, 0x00, // mem[out_ptr+0] = 's'
    0x20, 0x02, 0x41, 0x01, 0x6a, 0x41, 0x61, 0x3a, 0x00, 0x00, // mem[out_ptr+1] = 'a'
    0x20, 0x02, 0x41, 0x02, 0x6a, 0x41, 0x6e, 0x3a, 0x00, 0x00, // mem[out_ptr+2] = 'n'
    0x20, 0x02, 0x41, 0x03, 0x6a, 0x41, 0x64, 0x3a, 0x00, 0x00, // mem[out_ptr+3] = 'd'
    0x20, 0x02, 0x41, 0x04, 0x6a, 0x41, 0x62, 0x3a, 0x00, 0x00, // mem[out_ptr+4] = 'b'
    0x20, 0x02, 0x41, 0x05, 0x6a, 0x41, 0x6f, 0x3a, 0x00, 0x00, // mem[out_ptr+5] = 'o'
    0x20, 0x02, 0x41, 0x06, 0x6a, 0x41, 0x78, 0x3a, 0x00, 0x00, // mem[out_ptr+6] = 'x'
    0x20, 0x02, 0x41, 0x07, 0x6a, 0x41, 0x65, 0x3a, 0x00, 0x00, // mem[out_ptr+7] = 'e'
    0x20, 0x02, 0x41, 0x08, 0x6a, 0x41, 0x64, 0x3a, 0x00, 0x00, // mem[out_ptr+8] = 'd'
    0x41, 0x09, // i32.const 9
    0x0b, // end
];

// A malicious module whose `run` ignores its inputs and returns -1 (i32), which
// the host would otherwise cast to a ~4 GiB `usize` and try to allocate. The
// executor must reject this before allocating.
const MALICIOUS_WASM: &[u8] = &[
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, // magic + version
    // type section: func (i32, i32, i32, i32) -> i32
    0x01, 0x09, 0x01, 0x60, 0x04, 0x7f, 0x7f, 0x7f, 0x7f, 0x01, 0x7f,
    // function section: 1 function of type 0
    0x03, 0x02, 0x01, 0x00,
    // memory section: 1 memory, min 1 page (64 KiB)
    0x05, 0x03, 0x01, 0x00, 0x01,
    // export section: "memory" (mem 0) and "run" (func 0)
    0x07, 0x10, 0x02, 0x06, 0x6d, 0x65, 0x6d, 0x6f, 0x72, 0x79, 0x02, 0x00, 0x03, 0x72, 0x75,
    0x6e, 0x00, 0x00,
    // code section: run returns i32.const -1 (0x7f).
    0x0a, 0x06, 0x01, 0x04, 0x00, 0x41, 0x7f, 0x0b,
];

#[test]
fn test_plugin_sandboxed_execution() {
    let executor = WasiPluginExecutor::new(64 * 1024 * 1024); // 64 MB
    let result = executor
        .execute_sandboxed_plugin(MODULE_WASM, "carrier_tariff_data")
        .expect("plugin should execute under the sandbox");
    // The plugin writes its output after the input; the host must read from the
    // agreed output location, not a hardcoded offset 0.
    assert_eq!(result, "sandboxed");
}

#[test]
fn test_plugin_memory_boundary_violation() {
    // 10 bytes is far below the module's declared 1-page (64 KiB) memory,
    // so the sandbox must reject it at instantiation.
    let executor = WasiPluginExecutor::new(10);
    let result = executor.execute_sandboxed_plugin(MODULE_WASM, "data");
    assert!(result.is_err());
}

#[test]
fn test_plugin_rejects_oversized_output_length() {
    // A guest returning a bogus (huge) length must be rejected before the host
    // attempts any allocation, preventing a guest-triggered host OOM DoS.
    let executor = WasiPluginExecutor::new(64 * 1024 * 1024); // 64 MB
    let result = executor.execute_sandboxed_plugin(MALICIOUS_WASM, "data");
    assert!(result.is_err());
}
