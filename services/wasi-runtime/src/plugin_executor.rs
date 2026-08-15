use anyhow::Result;
use wasmtime::{
    Config, Engine, Instance, Memory, Module, Store, StoreLimitsBuilder, Trap,
};

/// Maximum number of fuel units a plugin may consume before it is terminated.
/// Wasmtime consumes one fuel unit per wasm instruction; this bounds a plugin
/// to roughly 1e9 instructions, preventing an infinite loop from pinning the
/// calling thread indefinitely (CPU-exhaustion / DoS).
const MAX_FUEL: u64 = 1_000_000_000;

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

        let mut config = Config::new();
        config.consume_fuel(true);
        let engine = Engine::new(&config)?;
        let module = Module::from_binary(&engine, wasm_bytes)?;

        // Real runtime sandbox: cap both the module's initial AND maximum
        // linear memory so a plugin cannot grow memory beyond
        // `max_memory_bytes`, which would otherwise widen the blast radius of
        // any memory-abuse attempt.
        let mut limits = StoreLimitsBuilder::new()
            .memory_size_initial(self.max_memory_bytes)
            .memory_size_max(self.max_memory_bytes)
            .build();

        let mut store = Store::new(&engine, ());
        store.limiter(|_| &mut limits);
        // Bounded CPU: terminate the plugin once it exhausts its fuel budget
        // so an unbounded loop cannot hang the worker.
        store.set_fuel(MAX_FUEL)?;

        let instance = Instance::new(&mut store, &module, &[])?;

        let memory = instance
            .get_memory(&mut store, "memory")
            .ok_or_else(|| anyhow::anyhow!("plugin module must export linear memory named `memory`"))?;

        let input_bytes = input_data.as_bytes();
        let input_offset = 1024usize;
        let mem_bytes = memory.size(&store) as usize * 65536;

        // The output region is placed immediately after the input so the guest
        // cannot clobber the input, and so the host reads output from a location
        // the guest was explicitly told to write to. Previously the host read
        // from offset 0 (where the guest was never told to write), which silently
        // returned garbage for any real plugin that wrote its output elsewhere.
        let out_offset = input_offset
            .checked_add(input_bytes.len())
            .ok_or_else(|| anyhow::anyhow!("input length overflow"))?;

        let out_cap = mem_bytes - out_offset;

        if out_offset > mem_bytes {
            anyhow::bail!("input data does not fit in plugin linear memory");
        }
        if out_offset > mem_bytes {
            anyhow::bail!("plugin output region does not fit in linear memory");
        }

        memory.write(&mut store, input_offset, input_bytes)?;

        // ABI: run(in_ptr, in_len, out_ptr, out_cap) -> out_len.
        // The host tells the guest exactly where to write its output and how much
        // room is available; it must never trust a guest-supplied length blindly.
        let run = instance.get_typed_func::<(i32, i32, i32, i32), i32>(&mut store, "run")?;
        let out_len = match run.call(
            &mut store,
            (
                input_offset as i32,
                input_bytes.len() as i32,
                out_offset as i32,
                (out_cap.min(i32::MAX as usize)) as i32,
            ),
        ) {
            Ok(len) => len as usize,
            // A fuel-exhaustion trap means the plugin exceeded its instruction
            // budget (e.g. an infinite loop). Surface it as a clear error
            // instead of letting the call hang forever.
            Err(e) if matches!(e, Trap::OutOfFuel) => {
                anyhow::bail!("plugin exceeded instruction/fuel limit (possible infinite loop)")
            }
            Err(e) => return Err(e.into()),
        };

        // Bounds-check the guest-reported length against the agreed capacity
        // before allocating or reading. This prevents a malicious guest from
        // triggering a multi-gigabyte host allocation (host OOM DoS) via a bogus
        // `out_len` (e.g. returning -1 => ~4 GiB).
        if out_len > out_cap {
            anyhow::bail!(
                "plugin reported output length {out_len} exceeds available capacity {out_cap}"
            );
        }

        let mut out_buf = vec![0u8; out_len];
        memory.read(&store, out_offset, &mut out_buf)?;
        let output = String::from_utf8(out_buf)
            .map_err(|e| anyhow::anyhow!("plugin returned non-utf8 output: {e}"))?;

        Ok(output)
    }
}
