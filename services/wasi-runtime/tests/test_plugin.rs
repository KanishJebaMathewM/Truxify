use wasi_runtime::WasiPluginExecutor;

// Minimal, hand-encoded WASM module (no external deps needed for the test).
// Exports linear memory (1 page) and a `run` function with signature
// (i32, i32) -> i32 that writes the fixed string "sandboxed" to memory[0..9]
// and returns its length, ignoring its inputs. This proves the executor
// actually instantiates and runs a real module rather than echoing input.
const MODULE_WASM: &[u8] = &[
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, // magic + version
    // type section: func (i32, i32) -> i32
    0x01, 0x07, 0x01, 0x60, 0x02, 0x7f, 0x7f, 0x01, 0x7f,
    // function section: 1 function of type 0
    0x03, 0x02, 0x01, 0x00,
    // memory section: 1 memory, min 1 page (64 KiB)
    0x05, 0x03, 0x01, 0x00, 0x01,
    // export section: "memory" (mem 0) and "run" (func 0)
    0x07, 0x10, 0x02, 0x06, 0x6d, 0x65, 0x6d, 0x6f, 0x72, 0x79, 0x02, 0x00, 0x03, 0x72, 0x75, 0x6e,
    0x00, 0x00,
    // code section: 1 function body
    0x0a, 0x45, 0x01, 0x43, 0x00,
    // run: store "sandboxed" (9 bytes) at offset 0, return 9
    0x41, 0x00, 0x41, 0x73, 0x50, 0x00, 0x00, // mem[0] = 's'
    0x41, 0x00, 0x41, 0x61, 0x50, 0x00, 0x01, // mem[1] = 'a'
    0x41, 0x00, 0x41, 0x6e, 0x50, 0x00, 0x02, // mem[2] = 'n'
    0x41, 0x00, 0x41, 0x64, 0x50, 0x00, 0x03, // mem[3] = 'd'
    0x41, 0x00, 0x41, 0x62, 0x50, 0x00, 0x04, // mem[4] = 'b'
    0x41, 0x00, 0x41, 0x6f, 0x50, 0x00, 0x05, // mem[5] = 'o'
    0x41, 0x00, 0x41, 0x78, 0x50, 0x00, 0x06, // mem[6] = 'x'
    0x41, 0x00, 0x41, 0x65, 0x50, 0x00, 0x07, // mem[7] = 'e'
    0x41, 0x00, 0x41, 0x64, 0x50, 0x00, 0x08, // mem[8] = 'd'
    0x41, 0x09, // i32.const 9
    0x0b, // end
];

#[test]
fn test_plugin_sandboxed_execution() {
    let executor = WasiPluginExecutor::new(64 * 1024 * 1024); // 64 MB
    let result = executor
        .execute_sandboxed_plugin(MODULE_WASM, "carrier_tariff_data")
        .expect("plugin should execute under the sandbox");
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
