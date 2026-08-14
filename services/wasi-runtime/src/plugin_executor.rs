use anyhow::Result;
use wasmtime::{
    Engine, Instance, Memory, Module, Store, StoreLimitsBuilder,
};

pub struct WasiPluginExecutor {
    pub max_memory_bytes: usize,
}

impl WasiPluginExecutor {
    pub fn new(max_memory_bytes: usize) -> Self {
        Self { max_memory_bytes }
    }

    pub fn execute_sandboxed_plugin(&self, wasm_bytes: &[u8], input_data: &str) -> Result<String> {
        if wasm_bytes.is_empty() {
            return Ok("[]".to_string());
        }

        let engine = Engine::default();
        let module = Module::from_binary(&engine, wasm_bytes)?;

        // Real runtime sandbox: cap the module's declared/allocated linear memory
        // so a plugin cannot allocate more than `max_memory_bytes` at instantiation.
        let mut limits = StoreLimitsBuilder::new()
            .memory_size_initial(self.max_memory_bytes)
            .build();

        let mut store = Store::new(&engine, ());
        store.limiter(|_| &mut limits);

        let instance = Instance::new(&mut store, &module, &[])?;

        let memory = instance
            .get_memory(&mut store, "memory")
            .ok_or_else(|| anyhow::anyhow!("plugin module must export linear memory named `memory`"))?;

        let input_bytes = input_data.as_bytes();
        let input_offset = 1024usize;
        if input_offset + input_bytes.len() > memory.size(&store) as usize * 65536 {
            anyhow::bail!("input data does not fit in plugin linear memory");
        }
        memory.write(&mut store, input_offset, input_bytes)?;

        // Actually invoke the plugin's exported `run` function, passing the input
        // location and length; it returns the length of the output written to memory.
        let run = instance.get_typed_func::<(i32, i32), i32>(&mut store, "run")?;
        let out_len = run.call(&mut store, (input_offset as i32, input_bytes.len() as i32))? as usize;

        let mut out_buf = vec![0u8; out_len];
        memory.read(&store, 0, &mut out_buf)?;
        let output = String::from_utf8(out_buf)
            .map_err(|e| anyhow::anyhow!("plugin returned non-utf8 output: {e}"))?;

        Ok(output)
    }
}
