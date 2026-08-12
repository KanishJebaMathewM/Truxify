use wasi_runtime::WasiPluginExecutor;

#[test]
fn test_plugin_sandboxed_execution() {
    let executor = WasiPluginExecutor::new(64 * 1024 * 1024); // 64 MB
    let mock_wasm = vec![0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];

    let result = executor.execute_sandboxed_plugin(&mock_wasm, "carrier_tariff_data");
    assert!(result.is_ok());
    assert!(result.unwrap().contains("processed:carrier_tariff_data"));
}

#[test]
fn test_plugin_memory_boundary_violation() {
    let executor = WasiPluginExecutor::new(10); // 10 bytes limit
    let large_wasm = vec![0; 100];

    let result = executor.execute_sandboxed_plugin(&large_wasm, "data");
    assert!(result.is_err());
}
